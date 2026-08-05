/**
 * Recently opened files (VS Code Ctrl+R). Persisted to localStorage, most
 * recent first, deduplicated, capped at 20 entries. Untitled buffers are
 * skipped — they are throwaway and would spam the list.
 */
import { create } from 'zustand'

const MAX_RECENT = 20
const STORAGE_KEY = 'recentFiles'

interface RecentFilesState {
  files: string[]
  isOpen: boolean
  addRecentFile: (path: string) => void
  removeRecentFile: (path: string) => void
  clearRecentFiles: () => void
  setOpen: (open: boolean) => void
  toggle: () => void
}

function load(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function persist(files: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(files))
}

export const useRecentFilesStore = create<RecentFilesState>((set, get) => ({
  files: load(),
  isOpen: false,

  addRecentFile: (path) => {
    if (!path || path.startsWith('/untitled/')) return
    const files = [path, ...get().files.filter((f) => f !== path)].slice(0, MAX_RECENT)
    persist(files)
    set({ files })
  },

  removeRecentFile: (path) => {
    const files = get().files.filter((f) => f !== path)
    persist(files)
    set({ files })
  },

  clearRecentFiles: () => {
    persist([])
    set({ files: [] })
  },

  setOpen: (open) => set({ isOpen: open }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
}))
