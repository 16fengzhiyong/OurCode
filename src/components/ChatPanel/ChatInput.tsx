import { useState, useRef, useEffect, useCallback } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'
import { useUIStore } from '@/stores/uiStore'
import { filterSlashCommands, buildSlashPrompt, getEditorSlashContext, getAllSlashCommands, SLASH_COMMANDS, SlashCommand } from '@/services/commands/slashCommands'
import { takePendingVibeReplace } from '@/services/vibeReplace'
import { useI18n } from '@/i18n/useI18n'
import type { TranslationKey } from '@/i18n'
import { dragSource } from '../Sidebar/FileTreeNode'
import FileChip from './FileChip'
import { isPathInside, makeFileLink, extractPathsFromUriList } from '@/utils/fileRefs'

/** Localized description for a slash command (falls back to the stored text). */
const slashDescription = (cmd: SlashCommand, t: (key: TranslationKey, vars?: Record<string, string | number>) => string) =>
  t(('slashCommands.' + cmd.id) as TranslationKey)

/** Stable empty-queue reference — a fresh [] from the selector would re-render
 *  ChatInput on every store update (e.g. each streaming chunk of a parallel
 *  conversation), since zustand compares with Object.is. */
const EMPTY_QUEUE: string[] = []

/**
 * Resolve the absolute path of a dropped File. Prefers the preload's
 * webUtils.getPathForFile bridge, then falls back to the legacy File.path
 * that Electron ≤ 31 still exposes. Without the fallback, a stale preload
 * (app started before the bridge was added) makes every OS drop silently
 * no-op. Returns '' when the file has no resolvable path.
 */
function resolveFilePath(file: File): string {
  const api = (window as any).electronAPI
  if (api?.getPathForFile) {
    try {
      const p: unknown = api.getPathForFile(file)
      if (typeof p === 'string' && p) return p
    } catch {
      /* bridge unavailable/throws — try the legacy path below */
    }
  }
  const legacy = (file as any).path
  return typeof legacy === 'string' ? legacy : ''
}

/**
 * Extract absolute paths from a drop's DataTransfer through every channel that
 * can carry them. Some drag sources / environments don't populate
 * `dataTransfer.files` on drop even though the drag was accepted (dragover
 * showed the hint); the files may still be reachable via `items` or the
 * `text/uri-list` payload (file:// URLs). Returns [] when nothing resolved.
 */
function extractDroppedPaths(dt: DataTransfer | null): string[] {
  if (!dt) return []
  const paths: string[] = []

  // 1) dataTransfer.files (standard OS file drags)
  for (const file of Array.from(dt.files)) {
    const p = resolveFilePath(file)
    if (p) paths.push(p)
  }

  // 2) dataTransfer.items — file-kind items when .files came up empty. Prefer
  //    webkitGetAsEntry(): it reports the real absolute path (drive + fullPath)
  //    for BOTH files and folders, and works even when the File objects carry
  //    no path (files:0 is common on some drag sources / sandboxed renderers).
  if (paths.length === 0) {
    for (const item of Array.from(dt.items)) {
      if (item.kind !== 'file') continue
      const entry = (item as any).webkitGetAsEntry?.()
      if (entry) {
        const rootName = String(entry.filesystem?.name || '')
        const fullPath = String(entry.fullPath || '')
        if (rootName && fullPath) {
          const drive = rootName.endsWith(':') ? rootName : rootName + ':'
          paths.push(drive + fullPath.replace(/\//g, '\\'))
          continue
        }
      }
      const f = item.getAsFile()
      if (!f) continue
      const p = resolveFilePath(f)
      if (p) paths.push(p)
    }
  }

  // 3) text/uri-list → file:// URLs (last resort; some drag sources send only
  //    URI data and no File objects — e.g. browsers / virtual file items)
  if (paths.length === 0) {
    const uris = dt.getData('text/uri-list') || dt.getData('text/plain') || ''
    for (const p of extractPathsFromUriList(uris)) paths.push(p)
  }
  return paths
}

/** Whether a drag payload carries file data at all (used to decide whether an
 *  empty result is an error worth surfacing vs. a plain text drag). */
function dragHasFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false
  return Array.from(dt.types).includes('Files') || dt.files.length > 0 || Array.from(dt.items).some((i) => i.kind === 'file')
}

export default function ChatInput() {
  const [input, setInput] = useState('')
  const [contextFiles, setContextFiles] = useState<string[]>([])
  /** path → isDirectory, resolved lazily via fs:stat (in-workspace only) so
   *  chips can show a folder icon and links get a trailing slash. */
  const [dirMap, setDirMap] = useState<Record<string, boolean>>({})
  const [showFileSearch, setShowFileSearch] = useState(false)
  const [fileSearchResults, setFileSearchResults] = useState<{ name: string; path: string }[]>([])
  const [selectedFileIndex, setSelectedFileIndex] = useState(0)
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0)
  /** Static templates + skill-derived commands (skills loaded once on mount). */
  const [allSlashCommands, setAllSlashCommands] = useState<SlashCommand[]>(SLASH_COMMANDS)
  const [queuedHint, setQueuedHint] = useState(false)
  const [listening, setListening] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const recognitionRef = useRef<{ stop: () => void } | null>(null)
  const t = useI18n()

  // Voice input via the Web Speech API (Ctrl+Shift+M is taken by the Problems panel)
  const toggleVoiceInput = () => {
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
    if (!SR) {
      alert(t('chat.voiceUnsupported'))
      return
    }
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }
    try {
      const rec = new SR()
      rec.lang = 'zh-CN'
      rec.interimResults = false
      rec.continuous = false
      rec.onresult = (e: any) => {
        const text = e?.results?.[0]?.[0]?.transcript
        if (text) {
          setInput((prev) => (prev ? prev + ' ' : '') + text)
          textareaRef.current?.focus()
        }
      }
      rec.onend = () => setListening(false)
      rec.onerror = () => setListening(false)
      recognitionRef.current = rec
      rec.start()
      setListening(true)
    } catch {
      alert(t('chat.voiceStartFailed'))
      setListening(false)
    }
  }

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileSearchRef = useRef<HTMLDivElement>(null)

  const sendMessage = useChatStore((s) => s.sendMessage)
  const stopGeneration = useChatStore((s) => s.stopGeneration)
  const queueMessage = useChatStore((s) => s.queueMessage)
  const removeQueuedMessage = useChatStore((s) => s.removeQueuedMessage)
  const sendQueuedNow = useChatStore((s) => s.sendQueuedNow)
  const clearQueue = useChatStore((s) => s.clearQueue)
  // Loading/stop state is per session: while THIS conversation generates the
  // send button turns into stop; other conversations running in parallel keep
  // their own buttons (and stopping here must never abort them).
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const isThisSessionLoading = useChatStore((s) => !!s.activeSessionId && s.runningSessionIds.includes(s.activeSessionId))
  const queuedMessages = useChatStore((s) => (s.activeSessionId ? (s.queuedMessagesBySession[s.activeSessionId] ?? EMPTY_QUEUE) : EMPTY_QUEUE))
  const targetMode = useChatStore((s) => {
    const sess = s.sessions.find((x) => x.id === s.activeSessionId)
    return sess?.targetMode === true
  })
  const activeConfigGroupId = useConfigStore((s) => s.activeConfigGroupId)
  const rootPath = useUIStore((s) => s.rootPath)

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [input])

  // Listen for "run skill" actions from the usage panel: inject the skill
  // instructions into the input so the user can review before sending.
  useEffect(() => {
    const onSetInput = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      if (typeof detail === 'string') {
        setInput(detail)
        textareaRef.current?.focus()
      }
    }
    window.addEventListener('ourcode:set-chat-input', onSetInput)
    return () => window.removeEventListener('ourcode:set-chat-input', onSetInput)
  }, [])

  // Load slash commands (static templates + workspace skills). Skill-derived
  // commands only carry name/description — the body stays on demand. Skill
  // commands scope to the active session's project (global skills always listed).
  useEffect(() => {
    let cancelled = false
    const projectPath = useChatStore.getState().getActiveSession()?.projectPath
    getAllSlashCommands(projectPath)
      .then((cmds) => { if (!cancelled) setAllSlashCommands(cmds) })
      .catch(() => { if (!cancelled) setAllSlashCommands([]) })
    return () => { cancelled = true }
  }, [])

  // Detect @ trigger
  const searchFiles = useCallback(async (query: string) => {
    try {
      // Get root path from file tree
      const rootEl = document.getElementById('file-tree-root')
      const rootPath = rootEl?.getAttribute('data-root-path')
      if (!rootPath) return

      // Match by file NAME (not content) — searchInFiles searches contents,
      // which made @foo return files whose *contents* mention "foo".
      const results = await window.electronAPI.searchFiles(rootPath, query)
      setFileSearchResults(results.slice(0, 10).map((path) => ({ name: path.split(/[/\\]/).pop() || path, path })))
    } catch {
      setFileSearchResults([])
    }
  }, [])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setInput(value)

    // Check for @ trigger
    const cursorPos = e.target.selectionStart
    const textBeforeCursor = value.slice(0, cursorPos)
    const atMatch = textBeforeCursor.match(/@(\S*)$/)
    // Check for slash-command trigger ("/" at the start of a line)
    const slashMatch = textBeforeCursor.match(/(^|\n)\/(\S*)$/)

    if (atMatch) {
      setShowFileSearch(true)
      setSelectedFileIndex(0)
      searchFiles(atMatch[1])
      setShowSlashMenu(false)
    } else {
      setShowFileSearch(false)
      if (slashMatch) {
        setShowSlashMenu(true)
        setSlashQuery(slashMatch[2])
        setSelectedSlashIndex(0)
      } else {
        setShowSlashMenu(false)
      }
    }
  }, [searchFiles])

  const insertSlashCommand = useCallback((command: SlashCommand) => {
    const cursorPos = textareaRef.current?.selectionStart || input.length
    const textBeforeCursor = input.slice(0, cursorPos)
    const slashMatch = textBeforeCursor.match(/(^|\n)\/(\S*)$/)
    const slashStart = slashMatch ? cursorPos - slashMatch[2].length - 1 : 0
    const textAfter = input.slice(cursorPos)

    const prompt = buildSlashPrompt(command, getEditorSlashContext())
    const newInput = input.slice(0, slashStart) + prompt + textAfter
    setInput(newInput)
    setShowSlashMenu(false)
    // Place the cursor after the inserted prompt
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      const pos = slashStart + prompt.length
      textareaRef.current?.setSelectionRange(pos, pos)
    })
  }, [input])

  /** Workspace root — store value first, file-tree attr as fallback. */
  const effectiveRoot = useCallback(
    () => rootPath || document.getElementById('file-tree-root')?.getAttribute('data-root-path') || '',
    [rootPath],
  )

  /** Attach files as chips. Folder-ness is resolved lazily via fs:stat so
   *  chips can show a folder icon and links get a trailing slash. */
  const addContextFiles = useCallback((paths: string[]) => {
    const unique = [...new Set(paths)]
    setContextFiles((prev) => [...new Set([...prev, ...unique])])
    const root = effectiveRoot()
    for (const p of unique) {
      if (!isPathInside(p, root)) continue
      window.electronAPI
        .stat(p)
        .then((s) => {
          if (!s?.isDirectory) return
          setDirMap((m) => (m[p] ? m : { ...m, [p]: true }))
        })
        .catch(() => { /* unreadable — stays a file chip */ })
    }
  }, [effectiveRoot])

  const insertFileReference = useCallback((filePath: string) => {
    // @-picker selection: drop the dangling "@query" and attach the file as a
    // chip — no @path text goes into the message.
    const textarea = textareaRef.current
    const cursorPos = textarea?.selectionStart ?? input.length
    const textBeforeCursor = input.slice(0, cursorPos)
    const atMatch = textBeforeCursor.match(/@(\S*)$/)
    const atIndex = atMatch ? cursorPos - atMatch[1].length - 1 : cursorPos
    setInput(input.slice(0, atIndex) + input.slice(cursorPos))
    addContextFiles([filePath])
    setShowFileSearch(false)
    requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(atIndex, atIndex)
    })
  }, [input, addContextFiles])

  const removeContextFile = useCallback((filePath: string) => {
    setContextFiles((prev) => prev.filter((f) => f !== filePath))
    setDirMap((m) => {
      const { [filePath]: _drop, ...rest } = m
      return rest
    })
  }, [])

  // --- Drag & drop: OS files or file-tree nodes land here as chips ---

  const handleDragOver = (e: React.DragEvent) => {
    // Accept OS file drags and internal file-tree drags (the tree stores the
    // dragged path in the module-level dragSource AND a custom MIME type so
    // HMR module-replacement doesn't break the reference). A drag counts as a
    // file drag when it carries File objects, the 'Files' type, OR a uri-list
    // payload — Explorer delivers some files/folders as ['text/plain',
    // 'text/uri-list'] with no 'Files' type and an empty dataTransfer.files.
    const types = Array.from(e.dataTransfer.types)
    const hasOsFiles =
      e.dataTransfer.files.length > 0 || types.includes('Files') || types.includes('text/uri-list')
    const hasTreeFile =
      types.includes('application/x-ourcode-path') || !!dragSource.path
    if (!hasOsFiles && !hasTreeFile) return
    e.preventDefault()
    // Drop only fires when dropEffect is compatible with the source's
    // effectAllowed — the file tree drags with 'move', so force 'move' there,
    // otherwise Chromium rejects the drop (dragend without drop).
    e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy'
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear when leaving the container itself (children bubble dragleave)
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    // 1) External drag from the OS file manager — resolve paths through every
    //    DataTransfer channel (files / items / uri-list).
    const paths = extractDroppedPaths(e.dataTransfer)
    // 2) Internal drag from the file tree via custom MIME type (more reliable
    //    than the module-level dragSource which can get stale after HMR).
    if (paths.length === 0) {
      const treePath = e.dataTransfer.getData('application/x-ourcode-path')
      if (treePath) paths.push(treePath)
    }
    // 3) Fallback: module-level dragSource (kept for backward compatibility)
    if (paths.length === 0 && dragSource.path) {
      paths.push(dragSource.path)
    }
    if (paths.length === 0) {
      // Never fail silently: if the drop carried file data we couldn't resolve
      // (empty dataTransfer.files, stale preload, exotic drag source), tell the
      // user instead of looking like the input ignored the drag.
      if (dragHasFiles(e.dataTransfer)) {
        useUIStore.getState().showNotification(t('chat.dropPathUnavailable'), 'warning')
      }
      return
    }

    // Attach every dropped path as a chip — nothing goes into the textarea.
    addContextFiles([...new Set(paths)])
    // Clear a dangling "@" (in-progress query) the user typed before the drop.
    const textarea = textareaRef.current
    const cursorPos = textarea?.selectionStart ?? input.length
    const atMatch = input.slice(0, cursorPos).match(/@(\S*)$/)
    if (atMatch) {
      const start = cursorPos - atMatch[1].length - 1
      setInput((prev) => prev.slice(0, start) + prev.slice(cursorPos))
    }
    setShowFileSearch(false)
  }

  // Window-level file-drop safety net. A real OS drag is only delivered as a
  // `drop` when some dragover handler calls preventDefault() along the way; if
  // that gate fails for any reason (platform, drag source, stale build), the
  // input's own onDrop never fires and the drag silently does nothing. Accept
  // file drags at the document level and forward any file drop that lands
  // outside the input box into it, so attaching a file always works no matter
  // where on the window it is released.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      // Accept the drag so the drop is delivered instead of rejected. dropEffect
      // must stay compatible with the source's effectAllowed (file tree drags
      // use 'move'), otherwise Chromium rejects the drop (dragend, no drop).
      e.preventDefault()
      if (dragHasFiles(e.dataTransfer) && e.dataTransfer) {
        e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy'
      }
    }
    const onDrop = (e: DragEvent) => {
      const dt = e.dataTransfer
      // The input box handles drops on itself; other zones (file tree move, tab
      // reorder) carry no OS files, so a file drop anywhere else in the window
      // safely lands in the chat input.
      if ((e.target as HTMLElement)?.closest?.('[data-chat-drop]')) return
      e.preventDefault()
      const paths = extractDroppedPaths(dt)
      // Internal file-tree drags carry the path in a custom MIME type.
      if (paths.length === 0) {
        const treePath = dt?.getData('application/x-ourcode-path')
        if (treePath) paths.push(treePath)
      }
      if (paths.length === 0) {
        // Files arrived but none resolved to a path — say so instead of making
        // the drop look like it was ignored.
        if (dragHasFiles(dt)) {
          useUIStore.getState().showNotification(t('chat.dropPathUnavailable'), 'warning')
        }
        return
      }
      addContextFiles([...new Set(paths)])
    }
    document.addEventListener('dragover', onDragOver, true)
    document.addEventListener('drop', onDrop, true)
    return () => {
      document.removeEventListener('dragover', onDragOver, true)
      document.removeEventListener('drop', onDrop, true)
    }
  }, [t, addContextFiles])

  const handleSubmit = async () => {
    const text = input.trim()
    // Sending is allowed with only attached files (no typed text).
    if (!text && contextFiles.length === 0) return

    // Vibe-and-Replace: combine the user's description with the stashed selection
    const vibe = takePendingVibeReplace()
    const base = vibe
      ? `（Vibe 替换）请按我的要求改写下面的代码，直接输出替换后的完整新代码（单个代码块，不要解释）：\n\n要求: ${text}\n\n--- 当前选中代码 (${vibe.filePath}) ---\n\`\`\`${vibe.language}\n${vibe.text}\n\`\`\``
      : text
    // Attached files travel as markdown links: [name](./relative/path) for
    // in-workspace paths (folders get a trailing slash), [name](abs) outside.
    const root = effectiveRoot()
    const links = contextFiles.map((f) => makeFileLink(f, root, dirMap[f] === true))
    const content = [base, links.join('  ')].filter(Boolean).join('  ')

    // While the agent is working, Enter queues the message (type-ahead) —
    // scoped to the active session, so parallel conversations are unaffected.
    if (isThisSessionLoading && activeSessionId) {
      queueMessage(activeSessionId, content)
      setInput('')
      setContextFiles([])
      setDirMap({})
      setQueuedHint(true)
      setTimeout(() => setQueuedHint(false), 2000)
      return
    }

    setInput('')
    setContextFiles([])
    setDirMap({})

    if (activeSessionId) {
      await sendMessage(activeSessionId, content, contextFiles)
    }
  }

  // Apply markdown formatting to selected text
  const applyMarkdown = useCallback((before: string, after: string) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = input.slice(start, end)
    const newInput = input.slice(0, start) + before + selected + after + input.slice(end)
    setInput(newInput)
    // Restore cursor: place it after the wrapped text
    requestAnimationFrame(() => {
      textarea.focus()
      const cursorStart = start + before.length
      const cursorEnd = cursorStart + selected.length
      textarea.setSelectionRange(cursorStart, cursorEnd)
    })
  }, [input])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Markdown shortcuts (Ctrl+B, Ctrl+I, Ctrl+`)
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (e.key === 'b') {
        e.preventDefault()
        applyMarkdown('**', '**')
        return
      }
      if (e.key === 'i') {
        e.preventDefault()
        applyMarkdown('*', '*')
        return
      }
      if (e.key === '`') {
        e.preventDefault()
        applyMarkdown('`', '`')
        return
      }
    }

    // Slash-command menu navigation
    const slashCommands = filterSlashCommands(slashQuery, allSlashCommands)
    if (showSlashMenu && slashCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedSlashIndex((prev) => Math.min(prev + 1, slashCommands.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedSlashIndex((prev) => Math.max(prev - 1, 0))
        return
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        insertSlashCommand(slashCommands[selectedSlashIndex])
        return
      }
      if (e.key === 'Escape') {
        setShowSlashMenu(false)
        return
      }
    }

    // File search navigation
    if (showFileSearch && fileSearchResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedFileIndex((prev) => Math.min(prev + 1, fileSearchResults.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedFileIndex((prev) => Math.max(prev - 1, 0))
        return
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        insertFileReference(fileSearchResults[selectedFileIndex].path)
        return
      }
      if (e.key === 'Escape') {
        setShowFileSearch(false)
        return
      }
    }

    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleAddFile = async () => {
    try {
      const filePath = await window.electronAPI.openFile()
      if (filePath) {
        addContextFiles([filePath])
      }
    } catch (error) {
      console.error('打开文件失败:', error)
    }
  }

  return (
    <div className="border-t border-nova-border p-3">
      {/* Attached files — Stitch glass chips (icon + name + ×) */}
      {contextFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {contextFiles.map((file) => (
            <FileChip
              key={file}
              path={file}
              rootPath={rootPath || ''}
              removable
              onRemove={removeContextFile}
              removeLabel={t('chat.removeFile')}
            />
          ))}
        </div>
      )}

      {/* Queued messages (typed while the agent is working) — shown above the
          input so each one can be sent now or deleted before it fires. */}
      {activeSessionId && queuedMessages.length > 0 && (
        <div className="banner-queue rounded-lg mb-2 overflow-hidden">
          <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M5 22h14M5 2h14" />
              <path d="M17 2v4a5 5 0 0 1-5 5 5 5 0 0 1-5-5V2" />
              <path d="M17 22v-4a5 5 0 0 0-5-5 5 5 0 0 0-5 5v4" />
            </svg>
            <span>{t('chat.queueTitle')} · {queuedMessages.length}</span>
            <button
              onClick={() => clearQueue(activeSessionId)}
              className="ml-auto font-semibold transition-colors hover:text-nova-text-primary"
            >
              {t('chat.queueClearAll')}
            </button>
          </div>
          <div className="max-h-32 overflow-y-auto px-2 pb-2 space-y-1">
            {queuedMessages.map((msg, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs rounded px-2 py-1 hover:bg-nova-hover transition-colors">
                <span className="flex-1 min-w-0 truncate">{msg}</span>
                <button
                  onClick={() => sendQueuedNow(activeSessionId, i)}
                  title={t('chat.queueSendNow')}
                  className="shrink-0 opacity-70 hover:opacity-100 transition-opacity"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none" />
                  </svg>
                </button>
                <button
                  onClick={() => removeQueuedMessage(activeSessionId, i)}
                  title={t('chat.queueDelete')}
                  className="shrink-0 opacity-70 hover:opacity-100 transition-opacity"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input Area — also a drop target for files (OS or file tree) */}
      <div
        className={`relative ${isDragOver ? 'ring-2 ring-nova-accent/70 rounded-lg' : ''}`}
        data-chat-drop
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag-over hint: tells the user a file/folder drop will attach it as
            a chip (sent as a [name](./path) link). pointer-events-none so it
            never steals the drop from the handlers on this container. */}
        {isDragOver && (
          <div
            className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none rounded-lg"
            style={{ background: 'color-mix(in srgb, var(--accent) 16%, transparent)', border: '1.5px dashed var(--accent)' }}
          >
            <div
              className="px-3 py-1.5 rounded-full text-xs font-medium text-white shadow-sm"
              style={{ background: 'var(--accent)' }}
            >
              {t('chat.dropHint')}
            </div>
          </div>
        )}
        {/* Slash-command menu ("/" at the start of a line) */}
        {showSlashMenu && filterSlashCommands(slashQuery, allSlashCommands).length > 0 && (
          <div
            className="absolute bottom-full left-0 right-0 mb-1 bg-nova-surface border border-nova-border rounded shadow-xl max-h-48 overflow-y-auto z-50"
          >
            {filterSlashCommands(slashQuery, allSlashCommands).map((cmd, index) => (
              <div
                key={cmd.id}
                className={`px-3 py-2 cursor-pointer text-sm flex items-center gap-2 ${
                  index === selectedSlashIndex
                    ? 'bg-nova-accent/15 text-nova-text-primary'
                    : 'text-nova-text-secondary hover:bg-nova-hover'
                }`}
                onClick={() => insertSlashCommand(cmd)}
                onMouseEnter={() => setSelectedSlashIndex(index)}
              >
                <span className="text-nova-accent font-medium shrink-0">/{cmd.name}</span>
                <span className="text-nova-text-muted text-xs truncate">{slashDescription(cmd, t)}</span>
              </div>
            ))}
          </div>
        )}

        {/* @file search dropdown */}
        {showFileSearch && fileSearchResults.length > 0 && (
          <div
            ref={fileSearchRef}
            className="absolute bottom-full left-0 right-0 mb-1 bg-nova-surface border border-nova-border rounded shadow-xl max-h-48 overflow-y-auto z-50"
          >
            {fileSearchResults.map((file, index) => (
              <div
                key={file.path}
                className={`px-3 py-2 cursor-pointer text-sm flex items-center gap-2 ${
                  index === selectedFileIndex
                    ? 'bg-nova-accent/15 text-nova-text-primary'
                    : 'text-nova-text-secondary hover:bg-nova-hover'
                }`}
                onClick={() => insertFileReference(file.path)}
              >
                <span className="text-nova-text-muted text-xs">{file.path}</span>
                <span className="ml-auto">{file.name}</span>
              </div>
            ))}
          </div>
        )}

        <div
          className="overflow-hidden transition-colors focus-within:border-[#3B82F6]"
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
          }}
        >
          {/* Attachment / context buttons row (above textarea) */}
          <div className="flex gap-0.5 px-2 pt-2">
            <button
              onClick={handleAddFile}
              className="p-1 text-nova-text-muted hover:text-nova-text-primary rounded transition-colors hover:bg-nova-hover shrink-0"
              title={t('chat.addFile')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <button
              onClick={handleAddFile}
              className="p-1 text-nova-text-muted hover:text-nova-text-primary rounded transition-colors hover:bg-nova-hover shrink-0"
              title={t('chat.addAttachment')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
          </div>

          {/* Auto-grow textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={targetMode ? t('chat.targetModePlaceholder') : t('chat.inputPlaceholder')}
            rows={1}
            disabled={!activeConfigGroupId}
            data-ai-input
            className="w-full bg-transparent resize-none text-nova-text-primary text-sm outline-none max-h-[150px] placeholder:text-nova-text-muted disabled:opacity-50 px-3 pt-2 pb-1"
          />

          {/* Footer: hints left, voice + send/stop right */}
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <div className="flex items-center gap-1.5 text-[10px] text-nova-text-muted">
              {queuedHint && (
                <>
                  <span className="w-px h-3 bg-nova-border" />
                  <span className="text-nova-accent">{t('chat.queuedHint')}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleVoiceInput}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${listening ? 'bg-red-500/20 text-red-400' : 'bg-nova-hover text-nova-text-muted hover:bg-nova-border hover:text-nova-text-primary'}`}
                title={t('chat.voiceInput')}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>
              {/* While the agent works the button is "结束" — typing turns it
                  into "发送" so Enter/click queues the message (type-ahead);
                  sending or clearing the input flips it back to "结束". */}
              {isThisSessionLoading && !input.trim() ? (
                <button
                  onClick={() => activeSessionId && stopGeneration(activeSessionId)}
                  className="px-3.5 py-1.5 text-xs text-white font-medium rounded-lg transition-colors"
                  style={{ background: 'rgba(244,135,113,0.85)' }}
                >
                  {t('chat.stop')}
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={(!input.trim() && contextFiles.length === 0) || !activeConfigGroupId}
                  className="text-white text-xs font-medium px-4 py-1.5 rounded-full transition-all hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed shadow-sm"
                  style={{ background: 'var(--grad-brand)' }}
                >
                  {t('chat.send')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
