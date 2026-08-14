import { describe, it, expect, vi, afterEach } from 'vitest'
import { ToolExecutor } from '../services/tools/ToolExecutor'
import type { ToolCall } from '../services/tools/types'

/**
 * Five-stage pipeline tests: monotonic guards (deny-only, no re-grant), pre
 * hooks (approval / checkpoint) with terminal denial, around hooks (ctx
 * override threading), post hooks, result observers, and dispose isolation.
 *
 * The pipeline's built-in post hook calls capResult → spillSave when a result
 * is over the inline budget; a tiny budget keeps spill out of these tests.
 */
const fs = new Map<string, string>()
const electronAPI = {
  spillSave: vi.fn(async () => null),
  recordUsage: vi.fn(async () => {}),
  stat: vi.fn(async (p: string) => (fs.has(p) ? { path: p, modifiedAt: 0 } : null)),
  readFile: vi.fn(async (p: string) => {
    if (!fs.has(p)) throw new Error(`ENOENT: ${p}`)
    return { content: fs.get(p)!, encoding: 'utf8', hasBom: false }
  }),
  writeFile: vi.fn(async (p: string, content: string) => { fs.set(p, content) }),
  mcpCallTool: vi.fn(async () => ({ ok: false, error: 'no server' })),
}
vi.stubGlobal('window', { electronAPI })
vi.stubGlobal('dispatchEvent', () => {})

afterEach(() => {
  fs.clear()
  fs.set('/a', 'file contents')
  vi.clearAllMocks()
})

const tc = (name: string, args: Record<string, unknown> = {}): ToolCall => ({ id: `${name}-${Math.random()}`, name, arguments: args })

describe('ToolExecutor pipeline', () => {
  it('guards are monotonic: a denial cannot be re-granted by a later guard', async () => {
    const executor = new ToolExecutor()
    const order: string[] = []
    executor.registerGuard(async () => { order.push('g1'); return 'denied by g1' })
    executor.registerGuard(async () => { order.push('g2'); return undefined })
    executor.registerPreHook(async () => { order.push('pre'); return { allow: true } })

    const res = await executor.execute(tc('read_file', { path: '/a' }), { sessionId: 's' })
    expect(res.isError).toBe(true)
    expect(res.result).toContain('denied by g1')
    expect(res.rejected).toBeUndefined() // guard denial is NOT a user rejection
    // Execution never happened — the around/core/post stages were skipped.
    expect(order).toEqual(['g1'])
  })

  it('pre-hook denial is terminal and marks the result as rejected', async () => {
    const executor = new ToolExecutor()
    const postRan: string[] = []
    executor.registerPreHook(async () => ({ deny: true, reason: '用户拒绝了此操作' }))
    executor.registerPostHook(async (_t, r) => { postRan.push('post'); return r })
    executor.registerResultObserver(() => { postRan.push('obs') })

    const res = await executor.execute(tc('read_file', { path: '/a' }), { sessionId: 's' })
    expect(res.isError).toBe(true)
    expect(res.rejected).toBe(true)
    expect(res.result).toBe('用户拒绝了此操作')
    expect(postRan).toEqual([]) // post hooks never ran
  })

  it('runs stages in order guard → pre → around → core → post → observer', async () => {
    const executor = new ToolExecutor()
    const order: string[] = []
    executor.registerGuard(async () => { order.push('guard'); return undefined })
    executor.registerPreHook(async () => { order.push('pre'); return { allow: true } })
    executor.registerAroundHook(async (_t, _c, next) => { order.push('around-in'); const r = await next(); order.push('around-out'); return r })
    executor.registerPostHook(async (_t, r) => { order.push('post'); return r })
    executor.registerResultObserver(() => { order.push('observer') })

    const res = await executor.execute(tc('read_file', { path: '/a' }), { sessionId: 's' })
    expect(res.isError).toBeFalsy()
    expect(order).toEqual(['guard', 'pre', 'around-in', 'around-out', 'post', 'observer'])
    // Note: the around hook wraps only core; post/observers run after the
    // whole around chain settles.
  })

  it('around hooks can override the context (abortSignal threading)', async () => {
    const executor = new ToolExecutor()
    let seenSignal: AbortSignal | null = null
    const composed = new AbortController().signal
    executor.registerAroundHook(async (_t, _c, next) => {
      return next({ sessionId: 's', abortSignal: composed })
    })
    // A later around hook sees the override its predecessor passed down.
    executor.registerAroundHook(async (_t, c, next) => {
      seenSignal = c.abortSignal ?? null
      return next()
    })
    await executor.execute(tc('read_file', { path: '/a' }), { sessionId: 's' })
    expect(seenSignal).toBe(composed)
  })

  it('dispose removes a hook (registration is per-run, executor is shared)', async () => {
    const executor = new ToolExecutor()
    const dispose = executor.registerPreHook(async () => ({ deny: true, reason: 'stale' }))
    // First call is denied by the hook
    const r1 = await executor.execute(tc('read_file', { path: '/a' }), { sessionId: 's' })
    expect(r1.rejected).toBe(true)
    // After dispose the same call is allowed
    dispose()
    const r2 = await executor.execute(tc('read_file', { path: '/a' }), { sessionId: 's' })
    expect(r2.isError).toBeFalsy()
  })

  it('result observers receive the final (capped) result and never throw', async () => {
    const executor = new ToolExecutor()
    const seen: string[] = []
    executor.registerResultObserver((_t, r) => { seen.push(r.result); throw new Error('observer bug') })
    executor.registerResultObserver((_t, r) => { seen.push(r.result) })
    const res = await executor.execute(tc('read_file', { path: '/a' }), { sessionId: 's' })
    expect(res.isError).toBeFalsy()
    // A throwing observer doesn't break the call, and both ran (error swallowed)
    expect(seen.length).toBe(2)
  })

  it('approval-style pre-hook denial flows through finalize as rejected (isError + rejected)', async () => {
    const executor = new ToolExecutor()
    executor.registerPreHook(async (t) => {
      if (t.name === 'write_file') return { deny: true, reason: '用户拒绝了此操作' }
      return { allow: true }
    })
    const res = await executor.execute(tc('write_file', { path: '/brand-new.txt', content: 'x' }), { sessionId: 's' })
    expect(res.rejected).toBe(true)
    expect(res.isError).toBe(true)
  })
})
