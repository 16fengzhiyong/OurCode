import { create } from 'zustand'
import type * as monaco from 'monaco-editor'
import { OpenFile, UserPreferences, DEFAULT_PREFERENCES, LANGUAGE_MAP } from '@/types'
import {
  getFileContent,
  getModel,
  registerModel,
  unregisterModel,
  registerLoader,
  appendText,
  setModelEol,
  setModelLanguage,
  yieldToEventLoop,
  waitForLoad,
} from '@/editor/modelRegistry'
import type { FileStreamChunk } from '@shared/types'

// Files larger than this ask for confirmation before opening (they take a lot
// of memory — a few hundred MB of text needs GBs of RAM in the editor model).
const LARGE_FILE_CONFIRM_BYTES = 50 * 1024 * 1024

// Files larger than this are loaded as plain text (no syntax highlighting). The
// tokenizer is what makes a huge file unusable — Monaco also skips tokenization
// for files above its own large-file threshold, so highlighting would be gone
// anyway. Plain text keeps the whole file editable with bounded CPU cost.
export const PLAINTEXT_THRESHOLD_BYTES = 20 * 1024 * 1024

// Files larger than this don't load the full content into the editor model at
// all — Monaco's setValue on a multi-hundred-MB string blocks the renderer for
// seconds and burns gigabytes of RAM. Instead we open a *read-only preview*
// limited to this many characters from the head of the file (≈ a few thousand
// lines), so the user can locate the section they care about and re-open with a
// smaller slice. This matches VS Code's "File is too large to open" behaviour.
export const READONLY_PREVIEW_BYTES = 100 * 1024 * 1024
export const READONLY_PREVIEW_CHARS = 500 * 1024 // ≈ 500 KB / a few thousand lines

// Models larger than this are saved to disk in bounded chunks (streamed write)
// instead of shipping the whole document string over IPC and encoding it in a
// single synchronous pass in the main process.
const STREAMED_SAVE_THRESHOLD = 4 * 1024 * 1024

// Paths with an in-flight save. Autosave fires every second and a large
// streamed save runs for many seconds, so without this set each tick would
// start another concurrent save of the same file (markDirty(false) only runs
// when the first save finishes). Guarded in saveFile.
const savingFiles = new Set<string>()

export interface Panel {
  id: string
  tabOrder: string[]
  activeFilePath: string | null
}

interface EditorState {
  // Panel model
  panels: Record<string, Panel>
  panelOrder: string[]
  activePanelId: string
  splitDirection: 'horizontal' | 'vertical'
  splitRatios: number[] // one ratio per boundary

  // Global file content (shared across panels)
  openFiles: OpenFile[]
  preferences: UserPreferences

  // Backward-compatible: derived from active panel
  activeFilePath: string | null
  tabOrder: string[]
  cursorPosition: { line: number; column: number } | null

  // Actions
  setCursorPosition: (pos: { line: number; column: number }) => void
  loadPreferences: () => Promise<void>
  savePreferences: (prefs: Partial<UserPreferences>) => Promise<void>
  updatePreferences: (prefs: Partial<UserPreferences>) => void

  // Panel actions
  setActivePanel: (panelId: string) => void
  splitPanel: (direction: 'horizontal' | 'vertical') => void
  closePanel: (panelId: string) => void
  resizeSplit: (index: number, ratio: number) => void
  cyclePanelFocus: () => void

  // File actions (panel-aware)
  openFile: (path: string, panelId?: string) => Promise<void>
  closeFile: (path: string, panelId?: string) => void
  closeFileGlobally: (path: string) => void
  setActiveFile: (path: string, panelId?: string) => void
  newFile: () => string
  reorderTabs: (fromIndex: number, toIndex: number, panelId?: string) => void
  moveTabToPanel: (path: string, fromPanelId: string, toPanelId: string, insertIndex?: number) => void
  saveFile: (path: string) => Promise<void>
  saveAll: () => Promise<void>
  markDirty: (path: string, isDirty?: boolean) => void
  setFileEncoding: (path: string, encoding: string) => void
  revertFile: (path: string) => Promise<void>
  updateFileContent: (path: string, content: string) => void

  getActiveFile: () => OpenFile | undefined
  getLanguageByPath: (path: string) => string
}

let panelCounter = 0
const createPanelId = () => `panel-${++panelCounter}`

const syncDerivedState = (s: EditorState) => {
  const panel = s.panels[s.activePanelId]
  return {
    activeFilePath: panel?.activeFilePath ?? null,
    tabOrder: panel?.tabOrder ?? [],
  }
}

/**
 * Load a file's content into its model. Chunks are pulled over IPC in 8 MB
 * batches (a big file used to cost one round-trip per 1 MB chunk), yielding
 * between batches so the UI stays responsive, then applied with a single
 * `model.setValue` — Monaco builds the buffer in one optimized pass, which is
 * dramatically faster and less memory-fragmented than thousands of incremental
 * appends. This is the same strategy as VS Code.
 */
async function streamFileIntoModel(path: string, model: monaco.editor.ITextModel): Promise<void> {
  let streamId: number | null = null
  try {
    const stream = await window.electronAPI.openFileStream(path)
    streamId = stream.id

    // Large files get a heads-up — loading them fully takes a lot of memory
    if (stream.totalBytes > LARGE_FILE_CONFIRM_BYTES) {
      const mb = Math.round(stream.totalBytes / (1024 * 1024))
      const message = `此文件较大（约 ${mb} MB）。将以纯文本模式打开（无语法高亮）并完整加载，可能占用较多内存，确定打开吗？`
      if (!window.confirm(message)) {
        await window.electronAPI.closeFileStream(stream.id)
        useEditorStore.getState().closeFileGlobally(path)
        return
      }
    }

    // Above the threshold the file opens as plain text — the whole point of the
    // mode is to keep it editable without paying tokenization cost. Switch the
    // model language now (it was created before the size was known).
    const plainText = stream.totalBytes > PLAINTEXT_THRESHOLD_BYTES
    if (plainText) {
      setModelLanguage(model, 'plaintext')
    }
    const lineEnding = stream.chunk.includes('\r\n') ? 'crlf' : 'lf'
    useEditorStore.setState((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path
          ? {
              ...f,
              encoding: stream.encoding,
              hasBom: stream.hasBom,
              size: stream.totalBytes,
              lineEnding,
              plainText,
            }
          : f,
      ),
    }))

    // Pull chunks in 8 MB batches — a big file used to cost one IPC round-trip
    // per 1 MB chunk (~800 for an 800 MB file); batching cuts that ~8x. Group
    // them so no single string exceeds V8's ~536M-char limit for two-byte
    // strings, then apply the groups in as few operations as possible: the
    // first via setValue (one optimized buffer build, like VS Code) and the
    // rest by appending. Fewer, larger operations are dramatically faster than
    // many incremental appends on a growing model. Yielding every few batches
    // keeps the window responsive (spinner, tab switching) while loading.
    const READ_BATCH_BYTES = 8 * 1024 * 1024
    const YIELD_EVERY_BATCHES = 4
    const MAX_JOIN_CHARS = 400 * 1024 * 1024
    const groups: string[][] = [[stream.chunk]]
    let groupChars = stream.chunk.length
    let batchCount = 0
    // Progress for the loading overlay: approximate the raw bytes pulled (each
    // batch asks for READ_BATCH_BYTES), capped at 99 so the UI never shows 100%
    // while the final buffer build (`setValue`) is still pending.
    let bytesRead = stream.chunk.length
    for (;;) {
      // Cancel if the model was disposed (file closed globally) mid-load
      if (getModel(path) !== model) {
        await window.electronAPI.closeFileStream(stream.id)
        return
      }
      const res: FileStreamChunk[] | null = await window.electronAPI.readFileChunkBatch(stream.id, READ_BATCH_BYTES)
      if (!res || res.length === 0) break
      bytesRead += READ_BATCH_BYTES
      const progress = Math.min(99, Math.round((bytesRead / stream.totalBytes) * 100))
      useEditorStore.setState((s) => ({
        openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, loadProgress: progress } : f)),
      }))
      let done = false
      for (const chunkRes of res) {
        const chunk = chunkRes.chunk
        if (groupChars + chunk.length > MAX_JOIN_CHARS) {
          groups.push([chunk])
          groupChars = chunk.length
        } else {
          groups[groups.length - 1].push(chunk)
          groupChars += chunk.length
        }
        if (chunkRes.done) {
          done = true
          break
        }
      }
      if (done) break
      if (++batchCount % YIELD_EVERY_BATCHES === 0) await yieldToEventLoop()
    }
    streamId = null

    setModelEol(model, lineEnding)
    model.setValue(groups[0].join(''))
    for (let i = 1; i < groups.length; i++) {
      appendText(model, groups[i].join(''))
    }
  } catch (error) {
    console.error('Failed to stream file:', error)
    if (streamId !== null) {
      await window.electronAPI.closeFileStream(streamId).catch(() => {})
    }
  } finally {
    // Mark loaded even on failure so the editor stays usable
    useEditorStore.setState((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, isLoading: false, isDirty: false } : f,
      ),
    }))
  }
}

/**
 * Save a model to disk in bounded chunks. Bounded IPC payloads keep the
 * renderer responsive and avoid one giant encode pass in the main process;
 * `openWriteStream`/`closeWriteStream` retain the atomic temp-file + rename
 * semantics of `writeFile`.
 */
async function streamSaveModel(
  path: string,
  model: monaco.editor.ITextModel,
  encoding: string,
  hasBom: boolean | undefined,
): Promise<void> {
  const id = await window.electronAPI.openWriteStream(path, encoding, hasBom)
  const totalLength = model.getValueLength()
  const CHUNK = 4 * 1024 * 1024
  try {
    for (let offset = 0; offset < totalLength; offset += CHUNK) {
      const end = Math.min(offset + CHUNK, totalLength)
      const startPos = model.getPositionAt(offset)
      const endPos = model.getPositionAt(end)
      const text = model.getValueInRange({
        startLineNumber: startPos.lineNumber,
        startColumn: startPos.column,
        endLineNumber: endPos.lineNumber,
        endColumn: endPos.column,
      })
      await window.electronAPI.writeChunk(id, text)
    }
  } catch (error) {
    await window.electronAPI.abortWriteStream(id).catch(() => {})
    throw error
  }
  await window.electronAPI.closeWriteStream(id)
}

const initialPanelId = createPanelId()

export const useEditorStore = create<EditorState>((set, get) => ({
  // Panel state
  panels: {
    [initialPanelId]: { id: initialPanelId, tabOrder: [], activeFilePath: null },
  },
  panelOrder: [initialPanelId],
  activePanelId: initialPanelId,
  splitDirection: 'horizontal',
  splitRatios: [],

  // Global
  openFiles: [],
  preferences: DEFAULT_PREFERENCES,

  // Derived
  activeFilePath: null,
  tabOrder: [],
  cursorPosition: null,

  setCursorPosition: (pos) => set({ cursorPosition: pos }),

  loadPreferences: async () => {
    try {
      const prefs = await window.electronAPI.getPreferences()
      set({ preferences: { ...DEFAULT_PREFERENCES, ...prefs } })
    } catch (error) {
      console.error('Failed to load preferences:', error)
    }
  },

  savePreferences: async (prefs) => {
    const newPrefs = { ...get().preferences, ...prefs }
    await window.electronAPI.savePreferences(newPrefs)
    set({ preferences: newPrefs })
  },

  updatePreferences: (prefs) => {
    set((s) => ({ preferences: { ...s.preferences, ...prefs } }))
  },

  // --- Panel actions ---

  setActivePanel: (panelId) => {
    set((s) => {
      if (!s.panels[panelId]) return s
      const next = { ...s, activePanelId: panelId }
      return { ...next, ...syncDerivedState(next) }
    })
  },

  splitPanel: (direction) => {
    set((s) => {
      if (s.panelOrder.length >= 4) return s
      const newPanelId = createPanelId()
      const newPanel: Panel = { id: newPanelId, tabOrder: [], activeFilePath: null }
      const newPanels = { ...s.panels, [newPanelId]: newPanel }
      const newPanelOrder = [...s.panelOrder, newPanelId]
      const newRatios = s.splitRatios.length === 0
        ? [0.5]
        : [...s.splitRatios, 0.5]

      const next = {
        ...s,
        panels: newPanels,
        panelOrder: newPanelOrder,
        activePanelId: newPanelId,
        splitDirection: direction,
        splitRatios: newRatios,
      }
      return { ...next, ...syncDerivedState(next) }
    })
  },

  closePanel: (panelId) => {
    set((s) => {
      if (s.panelOrder.length <= 1) return s

      const closingPanel = s.panels[panelId]
      if (!closingPanel) return s

      // Move tabs from closing panel to the nearest remaining panel
      const remainingIds = s.panelOrder.filter((id) => id !== panelId)
      const targetId = remainingIds[0]
      const targetPanel = s.panels[targetId]

      const newTargetPanel: Panel = {
        ...targetPanel,
        tabOrder: [...targetPanel.tabOrder, ...closingPanel.tabOrder.filter((p) => !targetPanel.tabOrder.includes(p))],
        activeFilePath: targetPanel.activeFilePath || closingPanel.activeFilePath,
      }

      const newPanels = { ...s.panels, [targetId]: newTargetPanel }
      delete newPanels[panelId]

      const newPanelOrder = remainingIds
      const newActivePanelId = s.activePanelId === panelId ? targetId : s.activePanelId
      // Remove one ratio (keep ratios proportional to boundaries)
      const newRatios = s.splitRatios.slice(0, Math.max(0, newPanelOrder.length - 1))
      // Rebalance ratios
      if (newRatios.length > 0) {
        const total = newRatios.reduce((a, b) => a + b, 0)
        if (total > 0) {
          for (let i = 0; i < newRatios.length; i++) {
            newRatios[i] = newRatios[i] / total
          }
        }
      }

      const next = {
        ...s,
        panels: newPanels,
        panelOrder: newPanelOrder,
        activePanelId: newActivePanelId,
        splitRatios: newRatios,
      }
      return { ...next, ...syncDerivedState(next) }
    })
  },

  resizeSplit: (index, ratio) => {
    set((s) => {
      const newRatios = [...s.splitRatios]
      if (index < 0 || index >= newRatios.length) return s
      newRatios[index] = Math.max(0.1, Math.min(0.9, ratio))
      return { splitRatios: newRatios }
    })
  },

  cyclePanelFocus: () => {
    set((s) => {
      if (s.panelOrder.length <= 1) return s
      const idx = s.panelOrder.indexOf(s.activePanelId)
      const nextIdx = (idx + 1) % s.panelOrder.length
      const nextId = s.panelOrder[nextIdx]
      const next = { ...s, activePanelId: nextId }
      return { ...next, ...syncDerivedState(next) }
    })
  },

  // --- File actions ---

  openFile: async (path, panelId) => {
    const state = get()
    const targetPanelId = panelId || state.activePanelId

    // Check if file content is already loaded
    const existingFile = state.openFiles.find((f) => f.path === path)
    if (existingFile) {
      // Just activate it in the target panel
      set((s) => {
        const panel = s.panels[targetPanelId]
        if (!panel) return s
        const newPanel: Panel = {
          ...panel,
          activeFilePath: path,
          tabOrder: panel.tabOrder.includes(path) ? panel.tabOrder : [...panel.tabOrder, path],
        }
        const next = { ...s, panels: { ...s.panels, [targetPanelId]: newPanel }, activePanelId: targetPanelId }
        return { ...next, ...syncDerivedState(next) }
      })
      return
    }

    // Reserve the tab immediately (content streams in afterwards), then hand the
    // load to the editor's model via a registered loader
    const language = get().getLanguageByPath(path)
    const newFile: OpenFile = {
      path,
      content: '',
      language,
      encoding: 'utf-8',
      lineEnding: 'lf',
      isDirty: false,
      isLoading: true,
    }

    set((s) => {
      const panel = s.panels[targetPanelId]
      if (!panel) return s
      const newPanel: Panel = {
        ...panel,
        activeFilePath: path,
        tabOrder: panel.tabOrder.includes(path) ? panel.tabOrder : [...panel.tabOrder, path],
      }
      const next = {
        ...s,
        openFiles: [...s.openFiles, newFile],
        panels: { ...s.panels, [targetPanelId]: newPanel },
        activePanelId: targetPanelId,
      }
      return { ...next, ...syncDerivedState(next) }
    })

    registerLoader(path, (model) => streamFileIntoModel(path, model))
  },

  closeFile: (path, panelId) => {
    set((s) => {
      const targetPanelId = panelId || s.activePanelId
      const panel = s.panels[targetPanelId]
      if (!panel) return s

      const newTabOrder = panel.tabOrder.filter((p) => p !== path)
      const newActivePath = panel.activeFilePath === path
        ? newTabOrder[newTabOrder.length - 1] || null
        : panel.activeFilePath

      const newPanel: Panel = { ...panel, tabOrder: newTabOrder, activeFilePath: newActivePath }
      const next = { ...s, panels: { ...s.panels, [targetPanelId]: newPanel } }
      return { ...next, ...syncDerivedState(next) }
    })
  },

  closeFileGlobally: (path) => {
    set((s) => {
      // Remove from openFiles
      const newOpenFiles = s.openFiles.filter((f) => f.path !== path)

      // Remove from all panels
      const newPanels = { ...s.panels }
      for (const pid of Object.keys(newPanels)) {
        const p = newPanels[pid]
        if (p.tabOrder.includes(path)) {
          const newTabOrder = p.tabOrder.filter((tp) => tp !== path)
          const newActivePath = p.activeFilePath === path
            ? newTabOrder[newTabOrder.length - 1] || null
            : p.activeFilePath
          newPanels[pid] = { ...p, tabOrder: newTabOrder, activeFilePath: newActivePath }
        }
      }

      const next = { ...s, openFiles: newOpenFiles, panels: newPanels }
      return { ...next, ...syncDerivedState(next) }
    })
  },

  setActiveFile: (path, panelId) => {
    set((s) => {
      const targetPanelId = panelId || s.activePanelId
      const panel = s.panels[targetPanelId]
      if (!panel) return s
      const newPanel: Panel = { ...panel, activeFilePath: path }
      const next = { ...s, panels: { ...s.panels, [targetPanelId]: newPanel } }
      return { ...next, ...syncDerivedState(next) }
    })
  },

  /** Create an untitled buffer in the active panel and return its pseudo path */
  newFile: () => {
    const path = `/untitled/untitled-${Date.now()}.txt`
    const newFile: OpenFile = {
      path,
      content: '',
      language: 'plaintext',
      encoding: 'utf-8',
      lineEnding: 'lf',
      isDirty: false,
      hasBom: false,
    }
    set((s) => {
      const panel = s.panels[s.activePanelId]
      if (!panel) return s
      const newPanel: Panel = {
        ...panel,
        activeFilePath: path,
        tabOrder: panel.tabOrder.includes(path) ? panel.tabOrder : [...panel.tabOrder, path],
      }
      const next = {
        ...s,
        openFiles: [...s.openFiles, newFile],
        panels: { ...s.panels, [s.activePanelId]: newPanel },
        activePanelId: s.activePanelId,
      }
      return { ...next, ...syncDerivedState(next) }
    })
    return path
  },

  reorderTabs: (fromIndex, toIndex, panelId) => {
    set((s) => {
      const targetPanelId = panelId || s.activePanelId
      const panel = s.panels[targetPanelId]
      if (!panel) return s
      const newOrder = [...panel.tabOrder]
      const [moved] = newOrder.splice(fromIndex, 1)
      newOrder.splice(toIndex, 0, moved)
      const newPanel: Panel = { ...panel, tabOrder: newOrder }
      const next = { ...s, panels: { ...s.panels, [targetPanelId]: newPanel } }
      return { ...next, ...syncDerivedState(next) }
    })
  },

  moveTabToPanel: (path, fromPanelId, toPanelId, insertIndex) => {
    set((s) => {
      const fromPanel = s.panels[fromPanelId]
      const toPanel = s.panels[toPanelId]
      if (!fromPanel || !toPanel) return s

      // Remove from source
      const newFromTabOrder = fromPanel.tabOrder.filter((p) => p !== path)
      const newFromActive = fromPanel.activeFilePath === path
        ? newFromTabOrder[newFromTabOrder.length - 1] || null
        : fromPanel.activeFilePath

      // Add to target
      const newToTabOrder = toPanel.tabOrder.includes(path)
        ? toPanel.tabOrder
        : insertIndex !== undefined
          ? [...toPanel.tabOrder.slice(0, insertIndex), path, ...toPanel.tabOrder.slice(insertIndex)]
          : [...toPanel.tabOrder, path]

      const newPanels = {
        ...s.panels,
        [fromPanelId]: { ...fromPanel, tabOrder: newFromTabOrder, activeFilePath: newFromActive },
        [toPanelId]: { ...toPanel, tabOrder: newToTabOrder, activeFilePath: path },
      }

      const next = { ...s, panels: newPanels, activePanelId: toPanelId }
      return { ...next, ...syncDerivedState(next) }
    })
  },

  saveFile: async (path) => {
    // Guard against overlapping saves. Autosave fires every second, and a
    // large streamed save takes many seconds — without this guard each tick
    // would start another concurrent save of the same file, piling up until
    // the main process is saturated encoding/writing gigabytes.
    if (savingFiles.has(path)) return
    savingFiles.add(path)
    try {
      const file = get().openFiles.find((f) => f.path === path)
      if (!file) return

      // If the file is still streaming in, wait for it to finish first
      const pendingLoad = waitForLoad(path)
      if (pendingLoad) await pendingLoad.catch(() => {})

      // Untitled buffer → prompt Save As, then migrate the tab to the real path
      if (path.startsWith('/untitled/')) {
        // Untitled buffers are small; reading the live model text is cheap here
        const content = getFileContent(path, file.content)
        const newPath = await window.electronAPI.saveFile()
        if (!newPath) return
        await window.electronAPI.writeFile(newPath, content, file.encoding, file.hasBom)
        // Re-register the live model under the real path (and store the saved text
        // as the initial copy) so the migrated tab keeps its content
        const model = getModel(path)
        if (model) {
          registerModel(newPath, model)
          unregisterModel(path)
        }
        set((s) => {
          const newOpenFiles = s.openFiles.map((f) =>
            f.path === path ? { ...f, path: newPath, content, isDirty: false } : f
          )
          const newPanels = { ...s.panels }
          for (const pid of Object.keys(newPanels)) {
            const p = newPanels[pid]
            if (p.tabOrder.includes(path)) {
              newPanels[pid] = {
                ...p,
                tabOrder: p.tabOrder.map((tp) => (tp === path ? newPath : tp)),
                activeFilePath: p.activeFilePath === path ? newPath : p.activeFilePath,
              }
            }
          }
          const next = { ...s, openFiles: newOpenFiles, panels: newPanels }
          return { ...next, ...syncDerivedState(next) }
        })
        return
      }

      if (!file.isDirty) return

      const model = getModel(path)
      // Large models are streamed to disk in bounded chunks. Reading the whole
      // document (`getFileContent` → `model.getValue()`) is only done for small
      // files — on a multi-hundred-MB model it copies the entire buffer, and
      // autosave would trigger that copy every second while typing.
      if (model && model.getValueLength() > STREAMED_SAVE_THRESHOLD) {
        await streamSaveModel(path, model, file.encoding, file.hasBom)
      } else {
        // The Monaco model is the source of truth once the file is open; the
        // store's content is only the initial copy. Read the live text at save.
        const content = getFileContent(path, file.content)
        await window.electronAPI.writeFile(path, content, file.encoding, file.hasBom)
      }
      get().markDirty(path, false)
    } catch (error) {
      console.error('Failed to save file:', error)
      throw error
    } finally {
      savingFiles.delete(path)
    }
  },

  saveAll: async () => {
    const dirtyFiles = get().openFiles.filter((f) => f.isDirty)
    await Promise.all(dirtyFiles.map((f) => get().saveFile(f.path)))
  },

  markDirty: (path, isDirty = true) => {
    set((s) => {
      // No-op when the flag is already set so typing doesn't churn subscribers
      // (a file gets dirty on the first keystroke, not every keystroke)
      const file = s.openFiles.find((f) => f.path === path)
      if (!file || file.isDirty === isDirty) return s
      return {
        openFiles: s.openFiles.map((f) =>
          f.path === path ? { ...f, isDirty } : f
        ),
      }
    })
  },

  setFileEncoding: (path, encoding) => {
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        // Re-encode the in-memory (decoded) content with the new encoding on next save
        f.path === path ? { ...f, encoding, isDirty: true } : f
      ),
    }))
  },

  revertFile: async (path) => {
    try {
      const { content, encoding, hasBom } = await window.electronAPI.readFile(path)
      // Refresh the live model too, so the editor immediately matches disk
      // (this resets Monaco's undo history — expected for a revert)
      getModel(path)?.setValue(content)
      set((s) => ({
        openFiles: s.openFiles.map((f) =>
          f.path === path ? { ...f, content, encoding, hasBom, isDirty: false } : f
        ),
      }))
    } catch (error) {
      console.error('Failed to revert file:', error)
      throw error
    }
  },

  updateFileContent: (path, content) => {
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, content, isDirty: true } : f
      ),
    }))
  },

  getActiveFile: () => {
    const { openFiles, activeFilePath } = get()
    return openFiles.find((f) => f.path === activeFilePath)
  },

  getLanguageByPath: (path) => {
    const ext = path.split('.').pop()?.toLowerCase() || ''
    return LANGUAGE_MAP[ext] || 'plaintext'
  },
}))
