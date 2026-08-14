import { describe, it, expect, vi } from 'vitest'
import { withTimeout, runWithTimeout, ToolTimeoutError } from '../services/tools/withTimeout'

describe('withTimeout', () => {
  it('resolves when the promise settles before the budget', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 5000)).resolves.toBe('ok')
  })

  it('rejects with ToolTimeoutError when the budget expires first', async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 500))
    const start = Date.now()
    await expect(withTimeout(slow, 30)).rejects.toBeInstanceOf(ToolTimeoutError)
    expect(Date.now() - start).toBeLessThan(300)
  })

  it('propagates the inner rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 5000)).rejects.toThrow('boom')
  })

  it('returns the promise unchanged for non-positive budgets', async () => {
    const p = Promise.resolve('x')
    expect(withTimeout(p, 0)).toBe(p)
  })
})

describe('runWithTimeout', () => {
  it('passes the composed signal to the run function', async () => {
    let seen: AbortSignal | null = null
    const out = await runWithTimeout(
      (signal) => {
        seen = signal
        return Promise.resolve('done')
      },
      5000,
    )
    expect(out).toBe('done')
    expect(seen).toBeInstanceOf(AbortSignal)
  })

  it('aborts the run signal at the deadline with a ToolTimeoutError reason', async () => {
    const run = vi.fn((_signal: AbortSignal) => new Promise<string>((resolve) => setTimeout(() => resolve('never'), 500)))
    await expect(runWithTimeout(run, 30)).rejects.toBeInstanceOf(ToolTimeoutError)
    expect(run).toHaveBeenCalledTimes(1)
    const signal = run.mock.calls[0][0] as AbortSignal
    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBeInstanceOf(ToolTimeoutError)
  })

  it('propagates the outer abort signal and its reason', async () => {
    const outer = new AbortController()
    const reason = new Error('用户停止')
    const run = vi.fn((signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
      // cooperative tool: rejects with the abort reason
      signal.addEventListener('abort', () => reject(signal.reason))
    }))
    const pending = runWithTimeout(run, 10_000, outer.signal)
    setTimeout(() => outer.abort(reason), 10)
    await expect(pending).rejects.toThrow('用户停止')
    expect((run.mock.calls[0][0] as AbortSignal).aborted).toBe(true)
  })

  it('settles promptly on outer abort even for a tool that ignores its signal', async () => {
    const outer = new AbortController()
    const run = vi.fn(() => new Promise<string>(() => { /* never settles, ignores abort */ }))
    const pending = runWithTimeout(run, 10_000, outer.signal)
    const start = Date.now()
    setTimeout(() => outer.abort(new Error('停止')), 10)
    await expect(pending).rejects.toThrow('停止')
    expect(Date.now() - start).toBeLessThan(1000)
  })

  it('runs with the plain outer signal when timeoutMs is unset', async () => {
    const outer = new AbortController()
    let seen: AbortSignal | null = null
    const out = await runWithTimeout((signal) => { seen = signal; return Promise.resolve('ok') }, 0, outer.signal)
    expect(out).toBe('ok')
    expect(seen).toBe(outer.signal)
  })
})
