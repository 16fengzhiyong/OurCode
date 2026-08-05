/**
 * Debug session state (single active session, VS Code launch-style). Breakpoints
 * are held here and pushed to the adapter on launch / change; DAP events update
 * the running/stopped state and the output console.
 */
import { create } from 'zustand'

export interface DebugBreakpoint {
  path: string
  line: number
}

interface DebugOutput {
  id: number
  category: string
  text: string
}

interface DebugState {
  isOpen: boolean
  isRunning: boolean
  adapterCommand: string
  launchConfig: Record<string, unknown>
  breakpoints: DebugBreakpoint[]
  output: DebugOutput[]
  stoppedAt: { path: string; line: number } | null
  error: string | null

  setOpen: (open: boolean) => void
  toggle: () => void
  setAdapterCommand: (cmd: string) => void
  setLaunchConfig: (config: Record<string, unknown>) => void
  addBreakpoint: (path: string, line: number) => void
  removeBreakpoint: (path: string, line: number) => void
  clearBreakpoints: () => void
  appendOutput: (category: string, text: string) => void
  clearOutput: () => void
  start: () => Promise<void>
  stop: () => Promise<void>
  continue: () => Promise<void>
  pause: () => Promise<void>
  step: (kind: 'over' | 'into' | 'out') => Promise<void>
}

let outputSeq = 0

export const useDebugStore = create<DebugState>((set, get) => ({
  isOpen: false,
  isRunning: false,
  adapterCommand: localStorage.getItem('debugAdapterCommand') || '',
  launchConfig: {},
  breakpoints: [],
  output: [],
  stoppedAt: null,
  error: null,

  setOpen: (open) => set({ isOpen: open }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  setAdapterCommand: (cmd) => {
    localStorage.setItem('debugAdapterCommand', cmd)
    set({ adapterCommand: cmd })
  },
  setLaunchConfig: (config) => set({ launchConfig: config }),
  addBreakpoint: (path, line) => {
    const bps = get().breakpoints
    if (bps.some((b) => b.path === path && b.line === line)) return
    const next = [...bps, { path, line }]
    set({ breakpoints: next })
    void window.electronAPI.debugSetBreakpoints(path, next.filter((b) => b.path === path).map((b) => b.line)).catch(() => {})
  },
  removeBreakpoint: (path, line) => {
    const next = get().breakpoints.filter((b) => !(b.path === path && b.line === line))
    set({ breakpoints: next })
    void window.electronAPI.debugSetBreakpoints(path, next.filter((b) => b.path === path).map((b) => b.line)).catch(() => {})
  },
  clearBreakpoints: () => set({ breakpoints: [] }),
  appendOutput: (category, text) => {
    set((s) => ({ output: [...s.output.slice(-199), { id: ++outputSeq, category, text }] }))
  },
  clearOutput: () => set({ output: [] }),

  start: async () => {
    const { adapterCommand, launchConfig, breakpoints } = get()
    if (!adapterCommand.trim()) {
      set({ error: '请先在调试面板填写调试适配器命令（如 node --inspect-brk=0 mock-adapter.js）' })
      return
    }
    const parts = adapterCommand.trim().split(/\s+/)
    const cwd = document.getElementById('file-tree-root')?.getAttribute('data-root-path') || ''
    set({ isRunning: true, error: null, stoppedAt: null })
    const res = await window.electronAPI.debugStart(parts[0], parts.slice(1), cwd, launchConfig, breakpoints)
    if (!res.ok) {
      set({ isRunning: false, error: res.error || '启动调试失败' })
    }
  },

  stop: async () => {
    await window.electronAPI.debugStop().catch(() => {})
    set({ isRunning: false, stoppedAt: null })
  },

  continue: async () => {
    await window.electronAPI.debugContinue().catch(() => {})
    set({ stoppedAt: null })
  },

  pause: async () => {
    await window.electronAPI.debugPause().catch(() => {})
  },

  step: async (kind) => {
    const api = kind === 'over' ? window.electronAPI.debugStepOver : kind === 'into' ? window.electronAPI.debugStepInto : window.electronAPI.debugStepOut
    await api().catch(() => {})
    set({ stoppedAt: null })
  },
}))

/** Subscribe to DAP events once (module side-effect). */
let subscribed = false
export function ensureDebugEventSubscription(): void {
  if (subscribed) return
  subscribed = true
  window.electronAPI.onDebugEvent('stopped', (body) => {
    const line = Number((body as any).line)
    const path = String((body as any).source?.path ?? '')
    useDebugStore.setState({ isRunning: true, stoppedAt: path ? { path, line } : null })
  })
  window.electronAPI.onDebugEvent('output', (body) => {
    const category = String((body as any).category ?? 'console')
    const text = String((body as any).output ?? '')
    if (text) useDebugStore.getState().appendOutput(category, text)
  })
  window.electronAPI.onDebugEvent('terminated', () => {
    useDebugStore.setState({ isRunning: false, stoppedAt: null })
  })
}
