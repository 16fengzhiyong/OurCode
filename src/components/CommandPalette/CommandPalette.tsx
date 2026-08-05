import { useState, useEffect, useRef } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { useEditorStore } from '@/stores/editorStore'
import { useChatStore } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'
import { useAICommandsStore } from '@/stores/aiCommandsStore'

interface Command {
  id: string
  label: string
  shortcut?: string
  action: () => void
  category?: string
  icon?: string
}

export default function CommandPalette() {
  const { isCommandPaletteOpen, closeCommandPalette } = useUIStore()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const aiCommands = useAICommandsStore((s) => s.commands)
  const executeCommand = useAICommandsStore((s) => s.executeCommand)

  const commands: Command[] = [
    // File commands
    {
      id: 'new-file',
      label: '新建文件',
      shortcut: 'Ctrl+N',
      action: () => {
        useEditorStore.getState().newFile()
        closeCommandPalette()
      },
      category: '文件',
    },
    {
      id: 'open-folder',
      label: '打开文件夹',
      shortcut: 'Ctrl+O',
      action: async () => {
        const path = await window.electronAPI.openFolder()
        if (path) {
          useUIStore.getState().setRootPath(path)
          useUIStore.getState().setActiveSidebarTab('files')
          if (!useUIStore.getState().isSidebarVisible) {
            useUIStore.getState().toggleSidebar()
          }
        }
        closeCommandPalette()
      },
      category: '文件',
    },
    {
      id: 'save',
      label: '保存文件',
      shortcut: 'Ctrl+S',
      action: () => {
        const activeFile = useEditorStore.getState().getActiveFile()
        if (activeFile) useEditorStore.getState().saveFile(activeFile.path)
        closeCommandPalette()
      },
      category: '文件',
    },
    {
      id: 'save-all',
      label: '保存所有文件',
      shortcut: 'Ctrl+Shift+S',
      action: () => {
        useEditorStore.getState().saveAll()
        closeCommandPalette()
      },
      category: '文件',
    },
    // View commands
    {
      id: 'toggle-sidebar',
      label: '切换侧边栏',
      shortcut: 'Ctrl+B',
      action: () => {
        useUIStore.getState().toggleSidebar()
        closeCommandPalette()
      },
      category: '视图',
    },
    {
      id: 'toggle-terminal',
      label: '切换终端',
      shortcut: 'Ctrl+J',
      action: () => {
        useUIStore.getState().toggleTerminal()
        closeCommandPalette()
      },
      category: '视图',
    },
    {
      id: 'toggle-chat',
      label: '切换 AI 面板',
      shortcut: 'Ctrl+L',
      action: () => {
        useUIStore.getState().toggleChat()
        closeCommandPalette()
      },
      category: '视图',
    },
    {
      id: 'split-horizontal',
      label: '左右分屏',
      shortcut: 'Ctrl+\\',
      action: () => {
        useEditorStore.getState().splitPanel('horizontal')
        closeCommandPalette()
      },
      category: '视图',
    },
    {
      id: 'split-vertical',
      label: '上下分屏',
      action: () => {
        useEditorStore.getState().splitPanel('vertical')
        closeCommandPalette()
      },
      category: '视图',
    },
    {
      id: 'close-panel',
      label: '关闭当前分屏',
      action: () => {
        const state = useEditorStore.getState()
        if (state.panelOrder.length > 1) {
          state.closePanel(state.activePanelId)
        }
        closeCommandPalette()
      },
      category: '视图',
    },
    {
      id: 'cycle-panel',
      label: '切换分屏焦点',
      shortcut: 'Ctrl+Shift+\\',
      action: () => {
        useEditorStore.getState().cyclePanelFocus()
        closeCommandPalette()
      },
      category: '视图',
    },
    {
      id: 'settings',
      label: '打开设置',
      action: () => {
        useUIStore.getState().openSettings()
        closeCommandPalette()
      },
      category: '偏好',
    },
    // Chat commands
    {
      id: 'new-chat',
      label: '新建对话',
      action: () => {
        const activeConfigId = useConfigStore.getState().activeConfigGroupId
        if (activeConfigId) {
          useChatStore.getState().createSession(activeConfigId)
        } else {
          useConfigStore.getState().createConfigGroup({ name: '默认' }).then((group) => {
            useChatStore.getState().createSession(group.id)
          })
        }
        closeCommandPalette()
      },
      category: '对话',
    },
    {
      id: 'clear-chat',
      label: '清空对话',
      action: () => {
        const activeSession = useChatStore.getState().getActiveSession()
        if (activeSession) useChatStore.getState().clearMessages(activeSession.id)
        closeCommandPalette()
      },
      category: '对话',
    },
    {
      id: 'export-chat-md',
      label: '导出对话为 Markdown',
      action: () => {
        const activeSession = useChatStore.getState().getActiveSession()
        if (activeSession) {
          const md = useChatStore.getState().exportSession(activeSession.id, 'markdown')
          const blob = new Blob([md], { type: 'text/markdown' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `对话-${Date.now()}.md`
          a.click()
          URL.revokeObjectURL(url)
        }
        closeCommandPalette()
      },
      category: '对话',
    },
    {
      id: 'export-chat-json',
      label: '导出对话为 JSON',
      action: () => {
        const activeSession = useChatStore.getState().getActiveSession()
        if (activeSession) {
          const json = useChatStore.getState().exportSession(activeSession.id, 'json')
          const blob = new Blob([json], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `对话-${Date.now()}.json`
          a.click()
          URL.revokeObjectURL(url)
        }
        closeCommandPalette()
      },
      category: '对话',
    },
    // AI command entries
    ...aiCommands.map((cmd) => ({
      id: `ai-${cmd.id}`,
      label: `AI: ${cmd.name}`,
      icon: cmd.icon,
      action: () => {
        const selection = window.getSelection()?.toString() || ''
        const activeFile = useEditorStore.getState().getActiveFile()
        const prompt = executeCommand(cmd.id, {
          selection,
          file: activeFile?.path || '',
          language: activeFile?.language || '',
        })

        const chatStore = useChatStore.getState()
        if (!chatStore.activeSessionId) {
          const configId = useConfigStore.getState().activeConfigGroupId
          if (configId) chatStore.createSession(configId)
        }
        chatStore.sendMessage(prompt)
        useUIStore.getState().toggleChat()
        closeCommandPalette()
      },
      category: 'AI 命令',
    })),
  ]

  const filteredCommands = commands.filter((cmd) =>
    cmd.label.toLowerCase().includes(query.toLowerCase()) ||
    cmd.category?.toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    if (isCommandPaletteOpen) {
      inputRef.current?.focus()
      setQuery('')
      setSelectedIndex(0)
    }
  }, [isCommandPaletteOpen])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeCommandPalette()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = filteredCommands[selectedIndex]
      if (cmd) cmd.action()
    }
  }

  if (!isCommandPaletteOpen) return null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-center pt-[15%] z-[100] backdrop-blur-sm" onClick={closeCommandPalette}>
      <div
        className="w-[550px] bg-nova-surface rounded-2xl shadow-2xl border border-nova-border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="p-3 border-b border-nova-border">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder="输入命令或搜索..."
            className="w-full bg-transparent text-nova-text-primary outline-none placeholder:text-nova-text-muted text-sm"
          />
        </div>

        {/* Command List */}
        <div className="max-h-[350px] overflow-y-auto py-1">
          {filteredCommands.length === 0 ? (
            <div className="px-4 py-6 text-center text-nova-text-muted text-sm">无匹配命令</div>
          ) : (
            filteredCommands.map((cmd, index) => (
              <div
                key={cmd.id}
                className={`
                  flex items-center justify-between px-4 py-2 cursor-pointer mx-1 rounded-lg
                  ${index === selectedIndex ? 'bg-nova-accent/20' : 'hover:bg-nova-hover'}
                `}
                onClick={cmd.action}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {cmd.icon && <span className="text-sm">{cmd.icon}</span>}
                  <span className="text-sm text-nova-text-primary truncate">{cmd.label}</span>
                  {cmd.category && (
                    <span className="text-[10px] text-nova-text-muted px-1.5 py-0.5 bg-nova-hover rounded shrink-0">{cmd.category}</span>
                  )}
                </div>
                {cmd.shortcut && (
                  <kbd className="px-2 py-0.5 bg-nova-hover rounded-md text-[10px] text-nova-text-muted shrink-0 ml-2">
                    {cmd.shortcut}
                  </kbd>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
