import { create } from 'zustand'

const DEFAULT_THEME_COLOR = '#0058bc'

/** localStorage key for the last-selected project (re-opened on next launch) */
const LAST_PROJECT_KEY = 'lastProjectState'

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
  activeSidebarTab: 'files' | 'git' | 'changes' | 'agent' | 'extensions' | 'usage' | 'skills'
  rootPath: string | null
  recentProjects: string[]
  /** Last time each recent project was opened (ms epoch) — lets the project
   *  list show a real "last opened" time instead of a synthetic one. */
  recentProjectTimes: Record<string, number>

  // Chat Panel
  isChatVisible: boolean
  chatWidth: number
  chatPosition: 'right' | 'bottom'
  /** Whether the chat panel's session list (history) is open — lifted here so
   *  the activity-bar "history" icon can open it across components */
  isChatSessionListOpen: boolean

  // Editor area (middle pane) — can be hidden so the chat panel fills the width
  isEditorVisible: boolean

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

  // Skill Registry
  isSkillRegistryOpen: boolean,

  // Memory manager
  isMemoryManagerOpen: boolean,

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
  /** User-pinned order of the project list (null = default add-order). Set by
   *  drag-reordering the project list — the list never re-sorts on its own. */
  projectOrder: string[] | null
  reorderProjects: (orderedPaths: string[]) => void
  /** Re-select the last opened project after a restart (persisted via localStorage) */
  restoreLastProject: () => Promise<void>

  // Context Menu
  contextMenu: { x: number; y: number; items: ContextMenuItem[] } | null

  // Notifications (transient toast stack — surfaced by NotificationToasts)
  notifications: AppNotification[]
  showNotification: (message: string, type?: AppNotification['type'], opts?: { position?: AppNotification['position']; sessionId?: string; duration?: number }) => void
  dismissNotification: (id: number) => void

  // Actions
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  setActiveSidebarTab: (tab: 'files' | 'git' | 'changes' | 'agent' | 'extensions' | 'usage' | 'skills') => void
  setRootPath: (path: string | null) => void
  removeRecentProject: (path: string) => void

  toggleChat: () => void
  setChatWidth: (width: number) => void
  setChatPosition: (position: 'right' | 'bottom') => void
  setChatSessionListOpen: (open: boolean) => void
  toggleEditorVisible: () => void
  setEditorVisible: (visible: boolean) => void

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

  openSkillRegistry: () => void
  closeSkillRegistry: () => void

  openMemoryManager: () => void
  closeMemoryManager: () => void

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

/** A transient toast notification (plugin api.ui.showNotification et al.). */
export interface AppNotification {
  id: number
  message: string
  type: 'info' | 'warning' | 'error' | 'success'
  /** Which corner the toast stacks in — session events use the bottom-right
   *  (requirement: task-done / needs-input popups), plugin calls stay top-right. */
  position?: 'top-right' | 'bottom-right'
  /** Session this notification refers to — clicking the toast jumps to it. */
  sessionId?: string
  /** Auto-dismiss delay in ms (defaults per position: 5s top / 8s bottom). */
  duration?: number
}

/** Monotonic id source for notifications (never reused within a session). */
let _nextNotificationId = 1

export const useUIStore = create<UIState>((set, get) => ({
  // Sidebar — starts hidden: on first launch no folder is open, so showing the
  // explorer panel would render a large empty area with nothing to fill it
  // (matches VS Code behavior when no folder/workspace is opened).
  isSidebarVisible: false,
  sidebarWidth: 330,
  activeSidebarTab: 'files',
  rootPath: null,
  recentProjects: (() => { try { return JSON.parse(localStorage.getItem('recentProjects') || '[]') } catch { return [] } })(),
  recentProjectTimes: (() => { try { return JSON.parse(localStorage.getItem('recentProjectTimes') || '{}') } catch { return {} } })(),

  // Chat Panel — wider default since the AI panel is the primary interface
  isChatVisible: true,
  chatWidth: (() => {
    try {
      const saved = Number(localStorage.getItem('chatWidth'))
      if (saved && saved >= 250) return saved
    } catch { /* ignore */ }
    return Math.max(480, typeof window !== 'undefined' ? Math.round(window.innerWidth * 0.38) : 520)
  })(),
  chatPosition: 'right',
  isChatSessionListOpen: false,

  // Editor area — closable so the chat panel can take the whole width. Defaults
  // to HIDDEN: with no open tabs there is nothing to show (the chat panel fills
  // the window instead). It only becomes visible when a file is opened, or when
  // the last session's tabs are restored on launch (see editorStore).
  isEditorVisible: (() => {
    try { return localStorage.getItem('isEditorVisible') === 'true' } catch { return false }
  })(),

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

  // Skill Registry
  isSkillRegistryOpen: false,

  // Memory manager
  isMemoryManagerOpen: false,

  // Window state
  isMaximized: false,

  // Theme — light glassmorphism is the default design direction
  theme: 'light',
  themeColor: localStorage.getItem('themeColor') || DEFAULT_THEME_COLOR,

  // Project navigation
  projectListView: 'list',
  activeProjectPath: null,
  projectOrder: (() => { try { return JSON.parse(localStorage.getItem('projectOrder') || 'null') } catch { return null } })(),

  // Context Menu
  contextMenu: null,

  // Notifications
  notifications: [],

  // Actions
  toggleSidebar: () => set((s) => ({ isSidebarVisible: !s.isSidebarVisible })),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),
  setRootPath: (path) => {
    set({ rootPath: path })
    if (path) {
      // Register the workspace root in the main-process allowlist up front.
      // The file tree only mounts in tree view, so opening a project from the
      // list view (new session / saved session / settings picker) never mounts
      // it — without this, every fs:*/search:* call for the workspace would be
      // rejected with "路径不在允许范围内".
      window.electronAPI?.authorize?.(path)
      set((s) => {
        // The project list keeps a STABLE order — a project is added once and
        // keeps its position (re-opening it never bumps it to the front). NEWLY
        // added projects land at the TOP (add order, newest first). The user
        // can pin a custom order via drag (projectOrder).
        const updated = s.recentProjects.includes(path)
          ? s.recentProjects
          : [path, ...s.recentProjects].slice(0, 20) // keep last 20
        localStorage.setItem('recentProjects', JSON.stringify(updated))
        // Record when this project was (re)opened so the list can show a real
        // "last opened" time.
        const times = { ...s.recentProjectTimes, [path]: Date.now() }
        localStorage.setItem('recentProjectTimes', JSON.stringify(times))
        return { recentProjects: updated, recentProjectTimes: times }
      })
    }
  },
  removeRecentProject: (path) => {
    set((s) => {
      const updated = s.recentProjects.filter((p) => p !== path)
      localStorage.setItem('recentProjects', JSON.stringify(updated))
      // Drop the recorded open-time too so a removed project never resurrects a stale date
      const times = { ...s.recentProjectTimes }
      delete times[path]
      localStorage.setItem('recentProjectTimes', JSON.stringify(times))
      // If removing the current project, clear rootPath too
      const newRoot = s.rootPath === path ? null : s.rootPath
      return { recentProjects: updated, recentProjectTimes: times, rootPath: newRoot }
    })
  },
  /** Persist the user's drag-pinned project order. The list never re-sorts on
   *  its own afterwards — only newly opened projects (unknown to the pinned
   *  order) land at the top. */
  reorderProjects: (orderedPaths) => {
    localStorage.setItem('projectOrder', JSON.stringify(orderedPaths))
    set({ projectOrder: orderedPaths })
  },

  toggleChat: () => set((s) => {
    // Don't allow hiding the last visible main-area panel — that would leave a
    // blank middle area with no obvious way back (same guard as closePanel).
    if (s.isChatVisible && !s.isEditorVisible) return s
    return { isChatVisible: !s.isChatVisible }
  }),
  setChatWidth: (width) => {
    localStorage.setItem('chatWidth', String(Math.round(width)))
    set({ chatWidth: width })
  },
  setChatPosition: (position) => set({ chatPosition: position }),
  setChatSessionListOpen: (open) => set({ isChatSessionListOpen: open }),
  toggleEditorVisible: () => set((s) => {
    // Don't allow hiding the last visible main-area panel (blank screen)
    if (s.isEditorVisible && !s.isChatVisible) return s
    const next = !s.isEditorVisible
    localStorage.setItem('isEditorVisible', String(next))
    return { isEditorVisible: next }
  }),
  setEditorVisible: (visible) => set((s) => {
    if (s.isEditorVisible === visible) return s
    localStorage.setItem('isEditorVisible', String(visible))
    return { isEditorVisible: visible }
  }),

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

  openSkillRegistry: () => set({ isSkillRegistryOpen: true }),
  closeSkillRegistry: () => set({ isSkillRegistryOpen: false }),

  openMemoryManager: () => set({ isMemoryManagerOpen: true }),
  closeMemoryManager: () => set({ isMemoryManagerOpen: false }),

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

  enterProject: (path) => {
    set({ projectListView: 'tree', activeProjectPath: path, rootPath: path })
    localStorage.setItem(LAST_PROJECT_KEY, JSON.stringify({ path, view: 'tree' }))
    // Belt-and-suspenders for the allowlist (see setRootPath).
    window.electronAPI?.authorize?.(path)
  },
  backToProjectList: () => {
    set({ projectListView: 'list', activeProjectPath: null })
    // Going back to the list is an explicit deselection — don't re-open the
    // project on the next launch.
    localStorage.setItem(LAST_PROJECT_KEY, JSON.stringify({ path: null, view: 'list' }))
  },
  restoreLastProject: async () => {
    let saved: { path?: string; view?: 'list' | 'tree' } | null = null
    try { saved = JSON.parse(localStorage.getItem(LAST_PROJECT_KEY) || 'null') } catch { /* ignore */ }
    const path = saved?.path
    if (!path) return
    // Only restore projects that were actually opened before (in recentProjects)
    const recent = get().recentProjects
    if (!recent.includes(path)) return
    // Verify the folder still exists on disk; otherwise fall back to the list.
    // The main process only serves fs: calls for paths the renderer authorized
    // (the allowlist is empty at startup), so authorize first — otherwise this
    // stat is rejected and the last project never restores.
    try {
      await window.electronAPI.authorize(path)
      const stat = await window.electronAPI.stat(path)
      if (!stat || !stat.isDirectory) return
    } catch {
      return
    }
    set({ projectListView: 'tree', activeProjectPath: path, rootPath: path })
  },

  showContextMenu: (x, y, items) => set({ contextMenu: { x, y, items } }),
  hideContextMenu: () => set({ contextMenu: null }),

  showNotification: (message, type = 'info', opts) => {
    const text = (message || '').trim()
    if (!text) return
    // Cap the visible stack at 5 — drop the oldest when exceeded.
    set((s) => ({
      notifications: [
        ...s.notifications,
        { id: _nextNotificationId++, message: text, type, ...(opts || {}) },
      ].slice(-5),
    }))
  },
  dismissNotification: (id) => set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),
}))
