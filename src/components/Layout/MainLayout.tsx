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
import ProblemsPanel from '../Editor/ProblemsPanel'
import RecentFilesModal from '../Editor/RecentFilesModal'
import DebugPanel from '../Editor/DebugPanel'
import { useProblemsStore } from '@/stores/problemsStore'
import { useRecentFilesStore } from '@/stores/recentFilesStore'
import { useDebugStore } from '@/stores/debugStore'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useShortcutStore, matchesShortcut } from '@/stores/shortcutStore'
import { executeCommand } from '@/services/commands/commandRegistry'

const COMPACT_BREAKPOINT = 1024
const NARROW_BREAKPOINT = 768

export default function MainLayout() {
  const {
    isSidebarVisible, sidebarWidth, chatWidth, isChatVisible, isTerminalVisible,
    terminalHeight, isCommandPaletteOpen, isQuickOpenOpen, contextMenu,
    rootPath,
  } = useUIStore()

  const { panelOrder, splitDirection, splitRatios } = useEditorStore()
  const isProblemsOpen = useProblemsStore((s) => s.isOpen)
  const isRecentFilesOpen = useRecentFilesStore((s) => s.isOpen)
  const isDebugOpen = useDebugStore((s) => s.isOpen)

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

      // Preset/custom shortcut actions all dispatch through the unified command
      // registry (same IDs the command palette and plugins use)
      const actionCommands: Array<[action: string, command: string, extraKeys?: string[]]> = [
        ['saveFile', 'saveFile'],
        ['saveAll', 'saveAll'],
        ['newFile', 'newFile'],
        ['openFolder', 'openFolder'],
        ['closeTab', 'closeTab'],
        ['find', 'find'],
        ['replace', 'replace'],
        ['toggleSidebar', 'toggleSidebar'],
        ['toggleTerminal', 'toggleTerminal', ['Ctrl+`']],
        ['toggleChat', 'toggleChat'],
        ['toggleProblems', 'toggleProblems'],
        ['toggleDebugPanel', 'toggleDebugPanel'],
        ['commandPalette', 'commandPalette'],
        ['quickOpen', 'quickOpen'],
        ['recentFiles', 'recentFiles'],
        ['zoomIn', 'zoomIn'],
        ['zoomOut', 'zoomOut'],
        ['newChatSession', 'newChatSession'],
        ['sendSelectionToAI', 'sendSelectionToAI'],
      ]
      for (const [action, command, extra] of actionCommands) {
        if (matches(action, extra)) {
          e.preventDefault()
          executeCommand(command)
          return
        }
      }

      // --- Fixed bindings (not part of the shortcut presets) ---
      if (matchesShortcut(e, 'Ctrl+Shift+X')) {
        e.preventDefault()
        executeCommand('openMarketplace')
        return
      }

      if (matchesShortcut(e, 'Ctrl+\\')) {
        e.preventDefault()
        executeCommand('splitPanelHorizontal')
        return
      }

      if (matchesShortcut(e, 'Ctrl+Shift+\\')) {
        e.preventDefault()
        executeCommand('cyclePanelFocus')
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
  }, []) // No deps — reads live store state

  // Auto-save timer — subscribes to the preference so toggling Auto Save in
  // Settings takes effect immediately (previously the effect ran once on mount
  // and the toggle only applied after a restart).
  const autoSave = useEditorStore((s) => s.preferences.autoSave)
  const autoSaveInterval = useEditorStore((s) => s.preferences.autoSaveInterval)
  useEffect(() => {
    if (!autoSave) {
      if (autoSaveTimerRef.current) { clearInterval(autoSaveTimerRef.current); autoSaveTimerRef.current = null }
      return
    }
    autoSaveTimerRef.current = setInterval(() => {
      useEditorStore.getState().openFiles.filter((f) => f.isDirty).forEach((f) => {
        useEditorStore.getState().saveFile(f.path).catch(console.error)
      })
    }, autoSaveInterval)
    return () => { if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current) }
  }, [autoSave, autoSaveInterval])

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
                      className={`${splitDirection === 'horizontal' ? 'w-1 cursor-col-resize hover:bg-nova-accent/30' : 'h-1 cursor-row-resize hover:bg-nova-accent/30'} bg-nova-border shrink-0`}
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
          {isProblemsOpen && (
            <div className="shrink-0" style={{ height: 160 }}><ProblemsPanel /></div>
          )}
          {isDebugOpen && (
            <div className="shrink-0" style={{ height: 200 }}><DebugPanel /></div>
          )}
          {isTerminalVisible && (
            <div style={{ height: isCompact ? Math.min(terminalHeight, 180) : Math.min(terminalHeight, windowWidth < 800 ? 200 : 500) }} className="border-t border-nova-border shrink-0"><TerminalPanel rootPath={rootPath} /></div>
          )}
        </div>
      </div>
      <StatusBar />
      <SettingsModal />
      {isCommandPaletteOpen && <CommandPalette />}
      {isQuickOpenOpen && rootPath && <QuickOpen rootPath={rootPath} />}
      {isRecentFilesOpen && <RecentFilesModal />}
      {contextMenu && <ContextMenu />}
      <PluginMarketplace />
    </div>
  )
}
