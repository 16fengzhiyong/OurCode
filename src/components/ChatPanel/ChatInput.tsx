import { useState, useRef, useEffect, useCallback } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'
import ModelSelector from './ModelSelector'
import { filterSlashCommands, buildSlashPrompt, getEditorSlashContext, SlashCommand } from '@/services/commands/slashCommands'

export default function ChatInput() {
  const [input, setInput] = useState('')
  const [contextFiles, setContextFiles] = useState<string[]>([])
  const [showFileSearch, setShowFileSearch] = useState(false)
  const [fileSearchResults, setFileSearchResults] = useState<{ name: string; path: string }[]>([])
  const [selectedFileIndex, setSelectedFileIndex] = useState(0)
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileSearchRef = useRef<HTMLDivElement>(null)

  const { sendMessage, isLoading, stopGeneration } = useChatStore()
  const activeConfigGroupId = useConfigStore((s) => s.activeConfigGroupId)

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [input])

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
    if (!input.trim() || isLoading) return

    const content = input.trim()
    setInput('')
    setContextFiles([])

    await sendMessage(content, contextFiles)
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
    const slashCommands = filterSlashCommands(slashQuery)
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

  const currentModelName = activeConfigGroupId ? 'AI 模型' : '未配置'

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
        {showSlashMenu && filterSlashCommands(slashQuery).length > 0 && (
          <div
            className="absolute bottom-full left-0 right-0 mb-1 bg-nova-surface border border-nova-border rounded shadow-xl max-h-48 overflow-y-auto z-50"
          >
            {filterSlashCommands(slashQuery).map((cmd, index) => (
              <div
                key={cmd.id}
                className={`px-3 py-2 cursor-pointer text-sm flex items-center gap-2 ${
                  index === selectedSlashIndex
                    ? 'bg-[#094771] text-white'
                    : 'text-nova-text-secondary hover:bg-nova-hover'
                }`}
                onClick={() => insertSlashCommand(cmd)}
                onMouseEnter={() => setSelectedSlashIndex(index)}
              >
                <span className="text-nova-accent font-medium shrink-0">/{cmd.name}</span>
                <span className="text-nova-text-muted text-xs truncate">{cmd.description}</span>
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
                    ? 'bg-[#094771] text-white'
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
          className="overflow-hidden"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
          }}
        >
          {/* Toolbar */}
          <div className="flex items-center gap-1 px-2.5 py-1.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <button
              className="p-1 text-nova-text-muted hover:text-nova-text-primary rounded transition-colors text-xs"
              title="插入代码块"
            >
              &lt;/&gt;
            </button>
            <button
              onClick={handleAddFile}
              className="p-1 text-nova-text-muted hover:text-nova-text-primary rounded transition-colors"
              title="添加文件"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <button className="p-1 text-nova-text-muted hover:text-nova-text-primary rounded transition-colors text-xs font-medium" title="引用文件">
              @
            </button>
            <div className="w-px h-3.5 mx-0.5" style={{ background: 'rgba(255,255,255,0.08)' }} />
            <button className="p-1 text-nova-text-muted hover:text-nova-text-primary rounded transition-colors" title="模型设置">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
            </button>
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="输入消息... (Ctrl+Enter 发送)"
            rows={1}
            disabled={!activeConfigGroupId}
            className="w-full bg-transparent resize-none text-nova-text-primary text-sm outline-none max-h-[200px] placeholder:text-nova-text-muted disabled:opacity-50 px-2.5 py-2"
          />

          {/* Footer */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <span className="text-[11px] flex-1" style={{ color: '#5a5a7a' }}>
              {currentModelName} · Ctrl + Enter 发送
            </span>
            {isLoading ? (
              <button
                onClick={stopGeneration}
                className="px-3 py-1 text-xs text-red-400 hover:text-red-300 transition-colors rounded"
                style={{ background: 'rgba(244,71,71,0.15)' }}
              >
                停止
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!input.trim() || !activeConfigGroupId}
                className="px-3 py-1 text-xs text-white font-medium rounded disabled:opacity-30 hover:opacity-90 transition-opacity"
                style={{ background: 'linear-gradient(135deg, #533483, #007acc)' }}
              >
                发送
              </button>
            )}
          </div>
        </div>

        {/* Model Selector */}
        <ModelSelector />
      </div>
    </div>
  )
}
