import { describe, it, expect, beforeEach, vi } from 'vitest'

/** Module-level state is reset via vi.resetModules + dynamic import. */
type Budget = typeof import('@/services/targetMode/budget')

describe('targetMode budget fuse', () => {
  let handler: ((ev: Event) => void) | undefined
  const mockReadFile = vi.fn(async () => ({ content: '总消耗上限（tokens）：1000', encoding: 'utf-8' }))

  beforeEach(() => {
    handler = undefined
    mockReadFile.mockClear()
    vi.stubGlobal('window', {
      electronAPI: { readFile: mockReadFile },
      addEventListener: vi.fn((type: string, fn: any) => { if (type === 'ourcode:usage-recorded') handler = fn }),
    })
    vi.resetModules()
  })

  function fire(bySession: Record<string, { tokens: number; projectPath: string }> | undefined): void {
    handler!({ detail: bySession ? { bySession } : undefined } as Event)
  }

  it('accumulates per-session usage and reports exceeded against the budget.md limit', async () => {
    const budget: Budget = await import('@/services/targetMode/budget')
    budget.installBudgetFuse()
    expect(handler).toBeDefined()

    fire({ s1: { tokens: 600, projectPath: 'C:/w' } })
    // limit is loaded from budget.md asynchronously — let it settle
    await new Promise((r) => setTimeout(r, 0))
    expect(budget.budgetExceeded('s1')).toBe(false)

    fire({ s1: { tokens: 500, projectPath: 'C:/w' } })
    expect(budget.budgetExceeded('s1')).toBe(true)
    expect(budget.getBudgetUsage('s1').used).toBe(1100)
    expect(budget.getBudgetUsage('s1').limit).toBe(1000)
  })

  it('falls back to the default limit when budget.md is unreadable', async () => {
    mockReadFile.mockImplementationOnce(async () => { throw new Error('no file') })
    const budget: Budget = await import('@/services/targetMode/budget')
    budget.installBudgetFuse()
    fire({ s1: { tokens: 50, projectPath: 'C:/w' } })
    await new Promise((r) => setTimeout(r, 0))
    // 50 << 2M default → not exceeded
    expect(budget.budgetExceeded('s1')).toBe(false)
    expect(budget.getBudgetUsage('s1').limit).toBe(2_000_000)
  })

  it('ignores events with no payload and sessions never tracked', async () => {
    const budget: Budget = await import('@/services/targetMode/budget')
    budget.installBudgetFuse()
    fire(undefined)
    expect(budget.budgetExceeded('s1')).toBe(false)
    expect(budget.getBudgetUsage('ghost').used).toBe(0)
  })

  it('installs the listener only once', async () => {
    const budget: Budget = await import('@/services/targetMode/budget')
    budget.installBudgetFuse()
    budget.installBudgetFuse()
    const calls = (window.addEventListener as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.filter((c) => c[0] === 'ourcode:usage-recorded')).toHaveLength(1)
  })
})
