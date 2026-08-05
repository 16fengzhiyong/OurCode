import { useState, useRef, useEffect, useCallback } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { useEditorStore } from '@/stores/editorStore'
import { useChatStore } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'

interface MenuItem {
  label: string
  shortcut?: string
  action?: () => void
  separator?: boolean
  disabled?: boolean
}

interface MenuGroup {
  label: string
  items: MenuItem[]
}

export default function TitleBar() {
  const { openSettings, toggleSidebar, toggleTerminal, toggleChat, openCommandPalette, openMarketplace } = useUIStore()
  const isMaximized = useUIStore((s) => s.isMaximized)

  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Track this window's own maximize state (per-window events from main)
  useEffect(() => {
    window.electronAPI.isMaximized().then((v) => useUIStore.getState().setMaximized(v))
    return window.electronAPI.onMaximized((v) => useUIStore.getState().setMaximized(v))
  }, [])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleMinimize = useCallback(() => window.electronAPI.minimize(), [])
  const handleMaximize = useCallback(() => window.electronAPI.maximize(), [])
  const handleClose = useCallback(() => window.electronAPI.close(), [])

  const menus: MenuGroup[] = [
    {
      label: '文件',
      items: [
        { label: '新建文件', shortcut: 'Ctrl+N', action: () => {
          useEditorStore.getState().newFile()
        }},
        { separator: true, label: '' },
        { label: '打开文件夹', shortcut: 'Ctrl+O', action: async () => {
          const path = await window.electronAPI.openFolder()
          if (path) {
            useUIStore.getState().setRootPath(path)
            useUIStore.getState().setActiveSidebarTab('files')
            if (!useUIStore.getState().isSidebarVisible) {
              useUIStore.getState().toggleSidebar()
            }
          }
        }},
        { separator: true, label: '' },
        { label: '保存', shortcut: 'Ctrl+S', action: () => {
          const afp = useEditorStore.getState().activeFilePath
          if (afp) useEditorStore.getState().saveFile(afp)
        }},
        { label: '全部保存', shortcut: 'Ctrl+Shift+S', action: () => useEditorStore.getState().saveAll() },
        { separator: true, label: '' },
        { label: '新窗口', action: () => window.electronAPI.openNewWindow() },
        { label: '偏好设置', action: openSettings },
      ],
    },
    {
      label: '编辑',
      items: [
        { label: '撤销', shortcut: 'Ctrl+Z', action: () => document.execCommand('undo') },
        { label: '重做', shortcut: 'Ctrl+Y', action: () => document.execCommand('redo') },
        { separator: true, label: '' },
        { label: '剪切', shortcut: 'Ctrl+X', action: () => document.execCommand('cut') },
        { label: '复制', shortcut: 'Ctrl+C', action: () => document.execCommand('copy') },
        { label: '粘贴', shortcut: 'Ctrl+V', action: () => document.execCommand('paste') },
        { separator: true, label: '' },
        { label: '查找', shortcut: 'Ctrl+F', action: () => {
          const editor = (window as any).__monacoEditor
          if (editor) editor.trigger('keyboard', 'actions.find', null)
        }},
        { label: '替换', shortcut: 'Ctrl+H', action: () => {
          const editor = (window as any).__monacoEditor
          if (editor) editor.trigger('keyboard', 'editor.action.startFindReplaceAction', null)
        }},
        { separator: true, label: '' },
        { label: '命令面板', shortcut: 'Ctrl+Shift+P', action: openCommandPalette },
      ],
    },
    {
      label: '选择',
      items: [
        { label: '全选', shortcut: 'Ctrl+A', action: () => document.execCommand('selectAll') },
        { label: '展开选区', shortcut: 'Shift+Alt+→', disabled: true },
        { label: '收缩选区', shortcut: 'Shift+Alt+←', disabled: true },
      ],
    },
    {
      label: '查看',
      items: [
        { label: '命令面板', shortcut: 'Ctrl+Shift+P', action: openCommandPalette },
        { separator: true, label: '' },
        { label: '切换侧边栏', shortcut: 'Ctrl+B', action: toggleSidebar },
        { label: '切换终端', shortcut: 'Ctrl+J', action: toggleTerminal },
        { label: '切换AI面板', shortcut: 'Ctrl+L', action: toggleChat },
      ],
    },
    {
      label: '转到',
      items: [
        { label: '转到文件', shortcut: 'Ctrl+P', action: () => useUIStore.getState().openQuickOpen() },
        { separator: true, label: '' },
        { label: '转到符号', shortcut: 'Ctrl+Shift+O', disabled: true },
        { label: '转到行号', shortcut: 'Ctrl+G', disabled: true },
        { separator: true, label: '' },
        { label: '转到定义', shortcut: 'F12', disabled: true },
        { label: '转到引用', shortcut: 'Shift+F12', disabled: true },
      ],
    },
    {
      label: '运行',
      items: [
        { label: '开始调试', shortcut: 'F5', disabled: true },
        { label: '运行无调试', shortcut: 'Ctrl+F5', disabled: true },
        { separator: true, label: '' },
        { label: '停止', shortcut: 'Shift+F5', disabled: true },
        { label: '重启', shortcut: 'Ctrl+Shift+F5', disabled: true },
      ],
    },
    {
      label: '智能体',
      items: [
        { label: '新建对话', action: () => {
          const configStore = useConfigStore.getState()
          if (configStore.activeConfigGroupId) {
            useChatStore.getState().createSession(configStore.activeConfigGroupId)
          } else {
            openSettings()
          }
        }},
        { label: '清空当前对话', action: () => {
          const session = useChatStore.getState().getActiveSession()
          if (session) useChatStore.getState().clearMessages(session.id)
        }},
        { separator: true, label: '' },
        { label: '导出对话为 Markdown', action: () => {
          const session = useChatStore.getState().getActiveSession()
          if (session) {
            const md = useChatStore.getState().exportSession(session.id, 'markdown')
            const blob = new Blob([md], { type: 'text/markdown' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `对话-${Date.now()}.md`
            a.click()
            URL.revokeObjectURL(url)
          }
        }},
        { label: '导出对话为 JSON', action: () => {
          const session = useChatStore.getState().getActiveSession()
          if (session) {
            const json = useChatStore.getState().exportSession(session.id, 'json')
            const blob = new Blob([json], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `对话-${Date.now()}.json`
            a.click()
            URL.revokeObjectURL(url)
          }
        }},
      ],
    },
    {
      label: '终端',
      items: [
        { label: '新建终端', shortcut: 'Ctrl+`', action: toggleTerminal },
        { separator: true, label: '' },
        { label: '终端面板', shortcut: 'Ctrl+J', action: toggleTerminal },
      ],
    },
    {
      label: '扩展',
      items: [
        { label: '扩展市场', shortcut: 'Ctrl+Shift+X', action: openMarketplace },
      ],
    },
    {
      label: '帮助',
      items: [
        { label: '报告问题', action: () => {
          window.open('https://github.com/anthropics/claude-code/issues', '_blank')
        }},
        { label: '功能建议', action: () => {
          window.open('https://github.com/anthropics/claude-code/issues', '_blank')
        }},
        { separator: true, label: '' },
        { label: '导出所有数据', action: async () => {
          try {
            const sessions = await window.electronAPI.getSessions()
            const configs = await window.electronAPI.getConfigGroups()
            const data = JSON.stringify({ sessions, configs: configs.map((c: any) => ({ ...c, apiKey: '***' })) }, null, 2)
            const blob = new Blob([data], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `ourcode-backup-${Date.now()}.json`
            a.click()
            URL.revokeObjectURL(url)
          } catch (e) { console.error(e) }
        }},
        { label: '清除所有数据', action: () => {
          if (confirm('确定要清除所有数据？此操作不可恢复！')) {
            localStorage.clear()
            window.location.reload()
          }
        }},
        { separator: true, label: '' },
        { label: '开发者工具', action: () => {
          window.electronAPI.openDevTools?.()
        }},
      ],
    },
  ]

  const handleMenuClick = (menuLabel: string) => {
    setActiveMenu(activeMenu === menuLabel ? null : menuLabel)
  }

  const handleItemClick = (item: MenuItem) => {
    if (!item.disabled && item.action) {
      item.action()
    }
    setActiveMenu(null)
  }

  return (
    <div className="h-12 flex items-center drag-region select-none shrink-0" style={{ background: '#323233', borderBottom: '1px solid #252525' }}>
      {/* Logo */}
      <div className="flex items-center px-4 gap-2 no-drag">
        <div
          className="w-3.5 h-3.5 rounded-full animate-logo-pulse shrink-0"
          style={{ background: 'radial-gradient(circle, #7c5cbf 0%, #007acc 100%)', boxShadow: '0 0 6px #7c5cbf88' }}
        />
        <span className="text-xs text-[#8d8d8d]">
          星云智码 IDE
        </span>
      </div>

      {/* Menu bar */}
      <div className="flex items-center h-full no-drag" ref={menuRef}>
        {menus.map((menu) => (
          <div key={menu.label} className="relative">
            <button
              className={`h-12 px-2.5 text-xs transition-colors ${
                activeMenu === menu.label
                  ? 'bg-nova-hover text-white'
                  : 'text-nova-text-secondary hover:text-nova-text-primary hover:bg-nova-hover/50'
              }`}
              onClick={() => handleMenuClick(menu.label)}
              onMouseEnter={() => activeMenu && setActiveMenu(menu.label)}
            >
              {menu.label}
            </button>

            {activeMenu === menu.label && (
              <div className="absolute top-full left-0 bg-nova-surface border border-nova-border rounded shadow-xl py-1 min-w-[200px] z-[100] animate-fade-in">
                {menu.items.map((item, index) =>
                  item.separator ? (
                    <div key={index} className="h-px bg-nova-border my-1" />
                  ) : (
                    <button
                      key={item.label}
                      className={`w-full text-left px-4 py-1.5 text-xs flex items-center justify-between gap-4 ${
                        item.disabled
                          ? 'text-nova-text-muted cursor-default'
                          : 'text-nova-text-secondary hover:bg-[#094771] hover:text-white'
                      }`}
                      onClick={() => handleItemClick(item)}
                      disabled={item.disabled}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && (
                        <span className="text-nova-text-muted text-[11px]">{item.shortcut}</span>
                      )}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right controls */}
      <div className="flex items-center gap-1 pr-2 no-drag">
        {/* Window controls */}
        <button
          onClick={handleMinimize}
          className="p-2 text-nova-text-muted hover:text-white hover:bg-nova-hover transition-colors"
          title="最小化"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeWidth={2} d="M5 12h14" />
          </svg>
        </button>
        <button
          onClick={handleMaximize}
          className="p-2 text-nova-text-muted hover:text-white hover:bg-nova-hover transition-colors"
          title={isMaximized ? '还原' : '最大化'}
        >
          {isMaximized ? (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="5" y="8" width="11" height="11" rx="1" strokeWidth={2} />
              <path strokeLinecap="round" strokeWidth={2} d="M8 5v1h7a2 2 0 0 1 2 2v7h1" />
            </svg>
          ) : (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="5" y="5" width="14" height="14" rx="1" strokeWidth={2} />
            </svg>
          )}
        </button>
        <button
          onClick={handleClose}
          className="p-2 text-nova-text-muted hover:text-white transition-colors"
          title="关闭"
          onMouseEnter={(e) => { e.currentTarget.style.background = '#e81123' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeWidth={2} d="M6 6l12 12M6 18L18 6" />
          </svg>
        </button>
      </div>
    </div>
  )
}
