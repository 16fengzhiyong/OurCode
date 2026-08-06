import { create } from 'zustand'

const DEFAULT_THEME_COLOR = '#2563eb'

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function applyThemeColor(color: string) {
  const root = document.documentElement
  root.style.setProperty('--primary-color', color)
  root.style.setProperty('--primary-color-10', hexToRgba(color, 0.1))
  root.style.setProperty('--primary-color-20', hexToRgba(color, 0.2))
  root.style.setProperty('--primary-color-30', hexToRgba(color, 0.3))
  root.style.setProperty('--accent', color)
  root.style.setProperty('--accent-purple', color)
}

interface UIState {
  // Sidebar
  isSidebarVisible: boolean
  sidebarWidth: number
  activeSidebarTab: 'files' | 'git' | 'changes' | 'agent' | 'extensions' | 'usage'
  rootPath: string | null
  recentProjects: string[]

  // Chat Panel
  isChatVisible: boolean
  chatWidth: number
  chatPosition: 'right' | 'bottom'
  /** Whether the chat panel's session list (history) is open — lifted here so
   *  the activity-bar "history" icon can open it across components */
  isChatSessionListOpen: boolean

  // Terminal
  isTerminalVisible: boolean
  terminalHeight: number

  // Settings
  isSettingsOpen: boolean

  // Command Palette
  isCommandPaletteOpen: boolean

  // Quick Open
  isQuickOpenOpen: boolean

  // Plugin Marketplace
  isMarketplaceOpen: boolean

  // Window state
  isMaximized: boolean

  // Theme
  theme: 'light' | 'dark' | 'system'
  themeColor: string

  // Project navigation (sidebar: list ↔ file-tree)
  projectListView: 'list' | 'tree'
  activeProjectPath: string | null
  enterProject: (path: string) => void
  backToProjectList: () => void

  // Context Menu
  contextMenu: { x: number; y: number; items: ContextMenuItem[] } | null

  // Actions
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  setActiveSidebarTab: (tab: 'files' | 'git' | 'changes' | 'agent' | 'extensions' | 'usage') => void
  setRootPath: (path: string | null) => void
  removeRecentProject: (path: string) => void

  toggleChat: () => void
  setChatWidth: (width: number) => void
  setChatPosition: (position: 'right' | 'bottom') => void
  setChatSessionListOpen: (open: boolean) => void

  toggleTerminal: () => void
  setTerminalHeight: (height: number) => void

  openSettings: () => void
  closeSettings: () => void

  openCommandPalette: () => void
  closeCommandPalette: () => void

  openQuickOpen: () => void
  closeQuickOpen: () => void

  openMarketplace: () => void
  closeMarketplace: () => void

  setMaximized: (isMaximized: boolean) => void

  setTheme: (theme: 'light' | 'dark' | 'system') => void
  initTheme: (theme?: 'light' | 'dark' | 'system') => void
  setThemeColor: (color: string) => void

  showContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void
  hideContextMenu: () => void
}

export interface ContextMenuItem {
  label: string
  icon?: string
  shortcut?: string
  disabled?: boolean
  separator?: boolean
  action?: () => void
}

export const useUIStore = create<UIState>((set, get) => ({
  // Sidebar — starts hidden: on first launch no folder is open, so showing the
  // explorer panel would render a large empty area with nothing to fill it
  // (matches VS Code behavior when no folder/workspace is opened).
  isSidebarVisible: false,
  sidebarWidth: 260,
  activeSidebarTab: 'files',
  rootPath: null,
  recentProjects: (() => { try { return JSON.parse(localStorage.getItem('recentProjects') || '[]') } catch { return [] } })(),

  // Chat Panel — wider default since the AI panel is the primary interface
  isChatVisible: true,
  chatWidth: Math.max(480, typeof window !== 'undefined' ? Math.round(window.innerWidth * 0.38) : 520),
  chatPosition: 'right',
  isChatSessionListOpen: false,

  // Terminal
  isTerminalVisible: false,
  terminalHeight: 250,

  // Settings
  isSettingsOpen: false,

  // Command Palette
  isCommandPaletteOpen: false,

  // Quick Open
  isQuickOpenOpen: false,

  // Plugin Marketplace
  isMarketplaceOpen: false,

  // Window state
  isMaximized: false,

  // Theme
  theme: 'dark',
  themeColor: localStorage.getItem('themeColor') || DEFAULT_THEME_COLOR,

  // Project navigation
  projectListView: 'list',
  activeProjectPath: null,

  // Context Menu
  contextMenu: null,

  // Actions
  toggleSidebar: () => set((s) => ({ isSidebarVisible: !s.isSidebarVisible })),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),
  setRootPath: (path) => {
    set({ rootPath: path })
    if (path) {
      set((s) => {
        const filtered = s.recentProjects.filter((p) => p !== path)
        const updated = [path, ...filtered].slice(0, 20) // keep last 20
        localStorage.setItem('recentProjects', JSON.stringify(updated))
        return { recentProjects: updated }
      })
    }
  },
  removeRecentProject: (path) => {
    set((s) => {
      const updated = s.recentProjects.filter((p) => p !== path)
      localStorage.setItem('recentProjects', JSON.stringify(updated))
      // If removing the current project, clear rootPath too
      const newRoot = s.rootPath === path ? null : s.rootPath
      return { recentProjects: updated, rootPath: newRoot }
    })
  },

  toggleChat: () => set((s) => ({ isChatVisible: !s.isChatVisible })),
  setChatWidth: (width) => set({ chatWidth: width }),
  setChatPosition: (position) => set({ chatPosition: position }),
  setChatSessionListOpen: (open) => set({ isChatSessionListOpen: open }),

  toggleTerminal: () => set((s) => ({ isTerminalVisible: !s.isTerminalVisible })),
  setTerminalHeight: (height) => set({ terminalHeight: height }),

  openSettings: () => set({ isSettingsOpen: true }),
  closeSettings: () => set({ isSettingsOpen: false }),

  openCommandPalette: () => set({ isCommandPaletteOpen: true }),
  closeCommandPalette: () => set({ isCommandPaletteOpen: false }),

  openQuickOpen: () => set({ isQuickOpenOpen: true }),
  closeQuickOpen: () => set({ isQuickOpenOpen: false }),

  openMarketplace: () => set({ isMarketplaceOpen: true }),
  closeMarketplace: () => set({ isMarketplaceOpen: false }),

  setMaximized: (isMaximized) => set({ isMaximized }),

  setTheme: (theme) => {
    set({ theme })
    document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches))
  },

  initTheme: (theme?: 'light' | 'dark' | 'system') => {
    // Use the persisted preference when provided (called at startup with preferences.theme),
    // otherwise fall back to the in-memory value.
    const resolved = theme || get().theme
    const { themeColor } = get()
    document.documentElement.classList.toggle('dark', resolved === 'dark' || (resolved === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches))
    applyThemeColor(themeColor)
  },

  setThemeColor: (color) => {
    localStorage.setItem('themeColor', color)
    set({ themeColor: color })
    applyThemeColor(color)
  },

  enterProject: (path) => set({ projectListView: 'tree', activeProjectPath: path, rootPath: path }),
  backToProjectList: () => set({ projectListView: 'list', activeProjectPath: null }),

  showContextMenu: (x, y, items) => set({ contextMenu: { x, y, items } }),
  hideContextMenu: () => set({ contextMenu: null }),
}))
