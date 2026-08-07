import { useState, useRef, useEffect, useCallback } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'
import { filterSlashCommands, buildSlashPrompt, getEditorSlashContext, getAllSlashCommands, SLASH_COMMANDS, SlashCommand } from '@/services/commands/slashCommands'
import { takePendingVibeReplace } from '@/services/vibeReplace'
import { AUTO_CONTINUE_KEY } from '@shared/constants'
import { useI18n } from '@/i18n/useI18n'
import type { TranslationKey } from '@/i18n'

/** Localized description for a slash command (falls back to the stored text). */
const slashDescription = (cmd: SlashCommand, t: (key: TranslationKey, vars?: Record<string, string | number>) => string) =>
  t(('slashCommands.' + cmd.id) as TranslationKey)

export default function ChatInput() {
  const [input, setInput] = useState('')
  const [contextFiles, setContextFiles] = useState<string[]>([])
  const [showFileSearch, setShowFileSearch] = useState(false)
  const [fileSearchResults, setFileSearchResults] = useState<{ name: string; path: string }[]>([])
  const [selectedFileIndex, setSelectedFileIndex] = useState(0)
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0)
  /** Static templates + skill-derived commands (skills loaded once on mount). */
  const [allSlashCommands, setAllSlashCommands] = useState<SlashCommand[]>(SLASH_COMMANDS)
  const [queuedHint, setQueuedHint] = useState(false)
  const [autoContinue, setAutoContinue] = useState(() => localStorage.getItem(AUTO_CONTINUE_KEY) === '1')
  const [autoRun, setAutoRun] = useState(false)
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<{ stop: () => void } | null>(null)
  const t = useI18n()

  const toggleAutoContinue = () => {
    setAutoContinue((prev) => {
      const next = !prev
      localStorage.setItem(AUTO_CONTINUE_KEY, next ? '1' : '0')
      return next
    })
  }

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

  const { sendMessage, isLoading, stopGeneration, queueMessage } = useChatStore()
  const activeConfigGroupId = useConfigStore((s) => s.activeConfigGroupId)
  const agentMode = useChatStore((s) => {
    const sess = s.sessions.find((x) => x.id === s.activeSessionId)
    return sess?.agentMode || 'chat'
  })

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
  // commands only carry name/description — the body stays on demand.
  useEffect(() => {
    let cancelled = false
    getAllSlashCommands()
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

  const insertFileReference = useCallback((filePath: string) => {
    const cursorPos = textareaRef.current?.selectionStart || input.length
    const textBeforeCursor = input.slice(0, cursorPos)
    const atIndex = textBeforeCursor.lastIndexOf('@')
    const textAfter = input.slice(cursorPos)

    const newInput = input.slice(0, atIndex) + `@${filePath} ` + textAfter
    setInput(newInput)
    setContextFiles((prev) => [...new Set([...prev, filePath])])
    setShowFileSearch(false)
    textareaRef.current?.focus()
  }, [input])

  const removeContextFile = useCallback((filePath: string) => {
    setContextFiles((prev) => prev.filter((f) => f !== filePath))
    setInput((prev) => prev.replace(new RegExp(`@${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'g'), ''))
  }, [])

  const handleSubmit = async () => {
    if (!input.trim()) return

    // Vibe-and-Replace: combine the user's description with the stashed selection
    const vibe = takePendingVibeReplace()
    const content = vibe
      ? `（Vibe 替换）请按我的要求改写下面的代码，直接输出替换后的完整新代码（单个代码块，不要解释）：\n\n要求: ${input.trim()}\n\n--- 当前选中代码 (${vibe.filePath}) ---\n\`\`\`${vibe.language}\n${vibe.text}\n\`\`\``
      : input.trim()

    // While the agent is working, Enter queues the message (type-ahead)
    if (isLoading) {
      queueMessage(content)
      setInput('')
      setContextFiles([])
      setQueuedHint(true)
      setTimeout(() => setQueuedHint(false), 2000)
      return
    }

    setInput('')
    setContextFiles([])

    await sendMessage(content, contextFiles, { autoRun })
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
        setContextFiles((prev) => [...new Set([...prev, filePath])])
      }
    } catch (error) {
      console.error('打开文件失败:', error)
    }
  }

  const getFileName = (path: string) => path.split(/[/\\]/).pop() || path

  return (
    <div className="border-t border-nova-border p-3">
      {/* Context Files */}
      {contextFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {contextFiles.map((file) => (
            <span
              key={file}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-nova-accent/20 text-nova-accent text-xs rounded-full"
            >
              <span>@{getFileName(file)}</span>
              <button
                onClick={() => removeContextFile(file)}
                className="hover:text-white ml-0.5"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div className="relative">
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
            placeholder={t('chat.inputPlaceholder')}
            rows={1}
            disabled={!activeConfigGroupId}
            data-ai-input
            className="w-full bg-transparent resize-none text-nova-text-primary text-sm outline-none max-h-[150px] placeholder:text-nova-text-muted disabled:opacity-50 px-3 pt-2 pb-1"
          />

          {/* Footer: hints left, voice + send/stop right */}
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <div className="flex items-center gap-1.5 text-[10px] text-nova-text-muted">
              {agentMode === 'agent' && (
                <label
                  className="flex items-center gap-1 cursor-pointer select-none hover:text-nova-text-secondary transition-colors"
                  title={t('chat.autoRunHint')}
                >
                  <input
                    type="checkbox"
                    checked={autoRun}
                    onChange={(e) => setAutoRun(e.target.checked)}
                    className="accent-nova-accent w-3 h-3"
                  />
                  {t('chat.autoRun')}
                </label>
              )}
              <label
                className="flex items-center gap-1 cursor-pointer select-none hover:text-nova-text-secondary transition-colors"
                title={t('chat.autoContinueHint')}
              >
                <input
                  type="checkbox"
                  checked={autoContinue}
                  onChange={toggleAutoContinue}
                  className="accent-nova-accent w-3 h-3"
                />
                {t('chat.autoContinue')}
              </label>
              <button
                className="p-0.5 text-nova-text-muted hover:text-nova-text-primary rounded transition-colors"
                title={t('chat.autoContinueSettingsHint')}
                onClick={() => {
                  // Future: open auto-continue settings
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
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
              {isLoading ? (
                <button
                  onClick={stopGeneration}
                  className="px-3.5 py-1.5 text-xs text-white font-medium rounded-lg transition-colors"
                  style={{ background: 'rgba(244,135,113,0.85)' }}
                >
                  {t('chat.stop')}
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={!input.trim() || !activeConfigGroupId}
                  className="bg-[#2563eb] hover:bg-[#3b82f6] text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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
