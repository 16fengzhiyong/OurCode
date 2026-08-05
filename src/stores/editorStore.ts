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
  yieldToEventLoop,
  waitForLoad,
} from '@/editor/modelRegistry'
import type { FileStreamChunk } from '@shared/types'

// Files larger than this ask for confirmation before opening (protects against
// accidentally loading a multi-GB file that would exhaust memory).
const LARGE_FILE_CONFIRM_BYTES = 50 * 1024 * 1024

// Files larger than this open as a read-only *preview* of the first
// PREVIEW_LIMIT_BYTES. A Monaco model of hundreds of MB / millions of lines
// needs multiple GB of memory and would freeze the app, so we never build one.
export const LARGE_FILE_PREVIEW_BYTES = 100 * 1024 * 1024
export const PREVIEW_LIMIT_BYTES = 20 * 1024 * 1024

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
 * Stream a file's content into its model in decoded chunks (pull-based IPC over
 * `openFileStream`/`readFileChunk`). The tab is already open; this fills the
 * model progressively and yields to the event loop between chunks, so the UI
 * never freezes even for files of hundreds of MB. `applyEdits` is used for
 * appends, which keeps the load out of the undo stack.
 */
async function streamFileIntoModel(path: string, model: monaco.editor.ITextModel): Promise<void> {
  let streamId: number | null = null
  try {
    const stream = await window.electronAPI.openFileStream(path)
    streamId = stream.id

    // Huge files never fit into a Monaco model, so they open as a read-only
    // preview of the first PREVIEW_LIMIT_BYTES.
    const isPreview = stream.totalBytes > LARGE_FILE_PREVIEW_BYTES

    if (stream.totalBytes > LARGE_FILE_CONFIRM_BYTES) {
      const mb = Math.round(stream.totalBytes / (1024 * 1024))
      const message = isPreview
        ? `此文件较大（约 ${mb} MB）。为避免卡顿，将以只读模式显示前 ${Math.round(PREVIEW_LIMIT_BYTES / (1024 * 1024))} MB 预览，确定打开吗？`
        : `此文件较大（约 ${mb} MB），确定要打开吗？`
      if (!window.confirm(message)) {
        await window.electronAPI.closeFileStream(stream.id)
        useEditorStore.getState().closeFileGlobally(path)
        return
      }
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
              isPreview,
              isReadOnly: isPreview,
            }
          : f,
      ),
    }))

    // Match the model's EOL to the file's, otherwise Monaco converts every
    // inserted '\n' into its default ('\r\n' on Windows) and the text no longer
    // round-trips byte-for-byte
    setModelEol(model, lineEnding)

    appendText(model, stream.chunk)
    await yieldToEventLoop()

    let loadedChars = stream.chunk.length
    for (;;) {
      // Cancel if the model was disposed (file closed globally) mid-load
      if (getModel(path) !== model) {
        await window.electronAPI.closeFileStream(stream.id)
        return
      }
      // Preview mode: stop pulling once the cap is reached (char count is a
      // good proxy for bytes for text files)
      if (isPreview && loadedChars >= PREVIEW_LIMIT_BYTES) {
        await window.electronAPI.closeFileStream(stream.id)
        break
      }
      const res: FileStreamChunk | null = await window.electronAPI.readFileChunk(stream.id)
      if (!res) break
      appendText(model, res.chunk)
      loadedChars += res.chunk.length
      if (res.done) break
      await yieldToEventLoop()
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

      // If only 1 panel left, reset split direction
      const newSplitDir = newPanelOrder.length <= 1 ? s.splitDirection : s.splitDirection

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
    const file = get().openFiles.find((f) => f.path === path)
    if (!file) return
    // Preview files are read-only — never write a truncated model back to disk
    if (file.isReadOnly) return

    // If the file is still streaming in, wait for it to finish first
    const pendingLoad = waitForLoad(path)
    if (pendingLoad) await pendingLoad.catch(() => {})

    // The Monaco model is the source of truth once the file is open; the store's
    // content is only the initial copy. Read the live text at save time.
    const content = getFileContent(path, file.content)

    // Untitled buffer → prompt Save As, then migrate the tab to the real path
    if (path.startsWith('/untitled/')) {
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

    try {
      // Preserve the original byte-order mark, if the file had one
      await window.electronAPI.writeFile(path, content, file.encoding, file.hasBom)
      get().markDirty(path, false)
    } catch (error) {
      console.error('Failed to save file:', error)
      throw error
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
    const current = get().openFiles.find((f) => f.path === path)
    // Preview files can't be reverted (that would re-read the whole huge file)
    if (current?.isReadOnly) return
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
