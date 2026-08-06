/**
 * Usage statistics store — holds the aggregated dashboard payload and the
 * selected time range. Data is aggregated in the main process (SQLite GROUP BY)
 * and fetched via usage:summary; the panel refreshes on mount and after every
 * usage:recorded event (dispatched by the collectors).
 */
import { create } from 'zustand'
import type { UsageSummary } from '@/types'

interface UsageState {
  summary: UsageSummary | null
  /** Time range in days; 0 = all time */
  rangeDays: number
  loading: boolean
  error: string
  load: (rangeDays?: number) => Promise<void>
  setRange: (rangeDays: number) => void
  clear: () => Promise<void>
}

export const useUsageStore = create<UsageState>((set, get) => ({
  summary: null,
  rangeDays: 30,
  loading: false,
  error: '',

  load: async (rangeDays) => {
    const r = rangeDays ?? get().rangeDays
    set({ loading: true, error: '' })
    try {
      const summary = await window.electronAPI.getUsageSummary(r)
      set({ summary, rangeDays: r, loading: false })
    } catch (error: any) {
      set({ loading: false, error: error.message || '加载统计数据失败' })
    }
  },

  setRange: (rangeDays) => {
    get().load(rangeDays)
  },

  clear: async () => {
    await window.electronAPI.clearUsage()
    await get().load(get().rangeDays)
  },
}))
