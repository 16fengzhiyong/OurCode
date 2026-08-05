import { useEffect, useRef, useState, useCallback } from 'react'
import TitleBar from './TitleBar'
import StatusBar from './StatusBar'
import ActivityBar from './ActivityBar'
import Sidebar from '../Sidebar/Sidebar'
import EditorContainer from '../Editor/EditorContainer'
import TabBar from '../Editor/TabBar'
import ChatPanel from '../ChatPanel/ChatPanel'
import TerminalPanel from '../Terminal/TerminalPanel'
import SettingsModal from '../Settings/SettingsModal'
import CommandPalette from '../CommandPalette/CommandPalette'
import QuickOpen from '../Sidebar/QuickOpen'
import ContextMenu from '../Common/ContextMenu'
import PluginMarketplace from '../Plugin/PluginMarketplace'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'
import { useShortcutStore, matchesShortcut } from '@/stores/shortcutStore'

const COMPACT_BREAKPOINT = 1024
const NARROW_BREAKPOINT = 768

export default function MainLayout() {
  const {
    isSidebarVisible, sidebarWidth, chatWidth, isChatVisible, isTerminalVisible,
    terminalHeight, isCommandPaletteOpen, isQuickOpenOpen, contextMenu,
    rootPath,
  } = useUIStore()

  const { panelOrder, splitDirection, splitRatios } = useEditorStore()

  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1400)
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Use refs for values accessed in the keyboard handler to avoid stale closures
  const isCommandPaletteOpenRef = useRef(isCommandPaletteOpen)
  const isQuickOpenOpenRef = useRef(isQuickOpenOpen)
  const contextMenuRef = useRef(contextMenu)
  const isChatVisibleRef = useRef(isChatVisible)
  useEffect(() => { isCommandPaletteOpenRef.current = isCommandPaletteOpen }, [isCommandPaletteOpen])
  useEffect(() => { isQuickOpenOpenRef.current = isQuickOpenOpen }, [isQuickOpenOpen])
  useEffect(() => { contextMenuRef.current = contextMenu }, [contextMenu])
  useEffect(() => { isChatVisibleRef.current = isChatVisible }, [isChatVisible])

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const isCompact = windowWidth < COMPACT_BREAKPOINT
  const isNarrow = windowWidth < NARROW_BREAKPOINT

  const openFolderFromShortcut = useCallback(async () => {
    const path = await window.electronAPI.openFolder()
    if (path) {
      const ui = useUIStore.getState()
      ui.setRootPath(path)
      ui.setActiveSidebarTab('files')
      if (!ui.isSidebarVisible) ui.toggleSidebar()
    }
  }, [])

  // Keyboard shortcuts — resolved live from the shortcutStore so the presets /
  // custom bindings configured in Settings actually take effect.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const shortcuts = useShortcutStore.getState()
      // matches an action's configured binding (plus any legacy extra keys)
      const matches = (action: string, extraKeys?: string[]) => {
        if (matchesShortcut(e, shortcuts.getShortcut(action))) return true
        return extraKeys?.some((k) => matchesShortcut(e, k)) ?? false
      }

      // --- File ---
      if (matches('saveFile')) {
        e.preventDefault()
        const activeFilePath = useEditorStore.getState().activeFilePath
        if (activeFilePath) useEditorStore.getState().saveFile(activeFilePath)
        return
      }

      if (matches('saveAll')) {
        e.preventDefault()
        useEditorStore.getState().saveAll()
        return
      }

      if (matches('newFile')) {
        e.preventDefault()
        useEditorStore.getState().newFile()
        return
      }

      if (matches('openFolder')) {
        e.preventDefault()
        openFolderFromShortcut()
        return
      }

      if (matches('closeTab')) {
        e.preventDefault()
        const { activeFilePath, openFiles, closeFile } = useEditorStore.getState()
        if (activeFilePath) {
          const file = openFiles.find((f) => f.path === activeFilePath)
          if (file?.isDirty) {
            if (confirm('有未保存的更改，确定关闭？')) closeFile(activeFilePath)
          } else {
            closeFile(activeFilePath)
          }
        }
        return
      }

      // --- Edit ---
      if (matches('find')) {
        e.preventDefault()
        const editor = (window as any).__monacoEditor
        if (editor) editor.trigger('keyboard', 'actions.find', null)
        return
      }

      if (matches('replace')) {
        e.preventDefault()
        const editor = (window as any).__monacoEditor
        if (editor) editor.trigger('keyboard', 'editor.action.startFindReplaceAction', null)
        return
      }

      // --- View ---
      if (matches('toggleSidebar')) {
        e.preventDefault()
        useUIStore.getState().toggleSidebar()
        return
      }

      if (matches('toggleTerminal', ['Ctrl+`'])) {
        e.preventDefault()
        useUIStore.getState().toggleTerminal()
        return
      }

      if (matches('toggleChat')) {
        e.preventDefault()
        useUIStore.getState().toggleChat()
        return
      }

      if (matches('commandPalette')) {
        e.preventDefault()
        useUIStore.getState().openCommandPalette()
        return
      }

      if (matches('quickOpen')) {
        e.preventDefault()
        useUIStore.getState().openQuickOpen()
        return
      }

      // --- Fixed bindings (not part of the shortcut presets) ---
      if (matchesShortcut(e, 'Ctrl+Shift+X')) {
        e.preventDefault()
        useUIStore.getState().openMarketplace()
        return
      }

      if (matchesShortcut(e, 'Ctrl+\\')) {
        e.preventDefault()
        useEditorStore.getState().splitPanel('horizontal')
        return
      }

      if (matchesShortcut(e, 'Ctrl+Shift+\\')) {
        e.preventDefault()
        useEditorStore.getState().cyclePanelFocus()
        return
      }

      // --- Chat / AI ---
      if (matches('newChatSession')) {
        e.preventDefault()
        const configId = useConfigStore.getState().activeConfigGroupId
        if (configId) {
          useChatStore.getState().createSession(configId)
        } else {
          useUIStore.getState().openSettings()
        }
        return
      }

      if (matches('sendSelectionToAI')) {
        e.preventDefault()
        const selection = window.getSelection()?.toString()
        if (selection) {
          const chatStore = useChatStore.getState()
          if (!chatStore.activeSessionId) {
            const configGroupId = useConfigStore.getState().activeConfigGroupId
            if (configGroupId) chatStore.createSession(configGroupId)
          }
          chatStore.sendMessage(`解释这段代码:\n\n\`\`\`\n${selection}\n\`\`\``)
          if (!useUIStore.getState().isChatVisible) useUIStore.getState().toggleChat()
        }
        return
      }

      // --- Escape: close overlays ---
      if (e.key === 'Escape') {
        const ui = useUIStore.getState()
        if (ui.isCommandPaletteOpen) ui.closeCommandPalette()
        if (ui.isQuickOpenOpen) ui.closeQuickOpen()
        if (ui.contextMenu) ui.hideContextMenu()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [openFolderFromShortcut]) // No deps — reads live store state

  // Auto-save timer
  useEffect(() => {
    if (!useEditorStore.getState().preferences.autoSave) {
      if (autoSaveTimerRef.current) { clearInterval(autoSaveTimerRef.current); autoSaveTimerRef.current = null }
      return
    }
    autoSaveTimerRef.current = setInterval(() => {
      useEditorStore.getState().openFiles.filter((f) => f.isDirty).forEach((f) => {
        useEditorStore.getState().saveFile(f.path).catch(console.error)
      })
    }, useEditorStore.getState().preferences.autoSaveInterval)
    return () => { if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current) }
  }, []) // Run once 鈥?reads from store directly

  const effectiveSidebarWidth = isCompact ? Math.min(sidebarWidth, 200) : sidebarWidth

  // Resizable panel drag handler
  const handlePanelResize = useCallback((panel: 'sidebar' | 'chat', e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = panel === 'sidebar'
      ? useUIStore.getState().sidebarWidth
      : useUIStore.getState().chatWidth

    const handleMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX
      if (panel === 'sidebar') {
        const newWidth = Math.max(150, Math.min(500, startWidth + delta))
        useUIStore.getState().setSidebarWidth(newWidth)
      } else {
        const newWidth = Math.max(250, Math.min(700, startWidth - delta))
        useUIStore.getState().setChatWidth(newWidth)
      }
    }
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }, [])

  return (
    <div className="h-full min-h-0 flex flex-col bg-nova-bg text-nova-text-primary overflow-hidden">
      <TitleBar />
      <div className="flex-1 h-full min-h-0 flex overflow-hidden">
        <ActivityBar />
        {isSidebarVisible && !(isNarrow && isChatVisible) && (
          <div style={{ width: effectiveSidebarWidth }} className="shrink-0 relative">
            <div className="h-full border-r border-nova-border"><Sidebar /></div>
            <div
              className="resizer absolute right-0 top-0 h-full z-10"
              onMouseDown={(e) => handlePanelResize('sidebar', e)}
            />
          </div>
        )}
        <div className="flex-1 h-full min-h-0 flex flex-col overflow-hidden">
          <div className={`flex-1 h-full min-h-0 flex ${isNarrow ? 'flex-col' : ''} overflow-hidden`}>
            <div className={`flex-1 h-full min-w-0 min-h-0 overflow-hidden flex ${splitDirection === 'horizontal' ? 'flex-row' : 'flex-col'}`}>
              {panelOrder.map((pid, index) => (
                <div key={pid} className="flex-1 h-full min-w-0 min-h-0 overflow-hidden flex flex-col" style={panelOrder.length > 1 && splitRatios[index - 1] ? { flex: `0 0 ${splitRatios[index - 1] * 100}%` } : undefined}>
                  <TabBar panelId={pid} />
                  <div className="flex-1 h-full min-h-0 flex flex-col"><EditorContainer panelId={pid} /></div>
                  {index < panelOrder.length - 1 && (
                    <div
                      className={`${splitDirection === 'horizontal' ? 'w-1 cursor-col-resize hover:bg-blue-500/30' : 'h-1 cursor-row-resize hover:bg-blue-500/30'} bg-nova-border shrink-0`}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        const startPos = splitDirection === 'horizontal' ? e.clientX : e.clientY
                        const container = (e.target as HTMLElement).parentElement
                        if (!container) return
                        const startSize = splitDirection === 'horizontal' ? container.offsetWidth : container.offsetHeight
                        const handleMove = (ev: MouseEvent) => {
                          const currentPos = splitDirection === 'horizontal' ? ev.clientX : ev.clientY
                          const delta = currentPos - startPos
                          const newSize = Math.max(200, startSize + delta)
                          const parent = container.parentElement
                          if (!parent) return
                          const parentSize = splitDirection === 'horizontal' ? parent.offsetWidth : parent.offsetHeight
                          const ratio = newSize / parentSize
                          useEditorStore.getState().resizeSplit(index, Math.max(0.15, Math.min(0.85, ratio)))
                        }
                        const handleUp = () => {
                          document.removeEventListener('mousemove', handleMove)
                          document.removeEventListener('mouseup', handleUp)
                          document.body.style.cursor = ''
                          document.body.style.userSelect = ''
                        }
                        document.body.style.cursor = splitDirection === 'horizontal' ? 'col-resize' : 'row-resize'
                        document.body.style.userSelect = 'none'
                        document.addEventListener('mousemove', handleMove)
                        document.addEventListener('mouseup', handleUp)
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
            {isChatVisible && !isNarrow && (
              <div
                className="resizer"
                onMouseDown={(e) => handlePanelResize('chat', e)}
              />
            )}
            {isChatVisible && (
              <div style={{ width: isNarrow ? '100%' : isCompact ? '320px' : chatWidth + 'px' }} className={`h-full ${isNarrow ? 'border-t' : 'border-l'} border-nova-border shrink-0 overflow-hidden`}><ChatPanel /></div>
            )}
          </div>
          {isTerminalVisible && (
            <div style={{ height: isCompact ? Math.min(terminalHeight, 180) : Math.min(terminalHeight, windowWidth < 800 ? 200 : 500) }} className="border-t border-nova-border shrink-0"><TerminalPanel rootPath={rootPath} /></div>
          )}
        </div>
      </div>
      <StatusBar />
      <SettingsModal />
      {isCommandPaletteOpen && <CommandPalette />}
      {isQuickOpenOpen && rootPath && <QuickOpen rootPath={rootPath} />}
      {contextMenu && <ContextMenu />}
      <PluginMarketplace />
    </div>
  )
}
