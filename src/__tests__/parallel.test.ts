import { describe, it, expect } from 'vitest'
import { runWithConcurrency, settleToToolResult } from '@/services/subagents/parallel'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('runWithConcurrency', () => {
  it('runs all tasks and resolves in input order', async () => {
    const order: number[] = []
    const tasks = [1, 2, 3, 4].map((n) => async () => {
      order.push(n)
      await sleep(20 - n * 4) // task 1 is slowest
      return `v${n}`
    })
    const results = await runWithConcurrency(tasks, 2)
    expect(results.map((r) => (r.ok ? r.value : null))).toEqual(['v1', 'v2', 'v3', 'v4'])
    expect(new Set(order)).toEqual(new Set([1, 2, 3, 4])) // all started
  })

  it('caps concurrency at the limit', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const tasks = [1, 2, 3, 4, 5].map((n) => async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await sleep(30)
      inFlight--
      return n
    })
    await runWithConcurrency(tasks, 2)
    expect(maxInFlight).toBe(2)
  })

  it('isolates a failing task without rejecting the batch', async () => {
    const tasks = [
      async () => 'a',
      async () => { throw new Error('boom') },
      async () => 'c',
    ]
    const results = await runWithConcurrency(tasks, 2)
    expect(results[0]).toEqual({ ok: true, value: 'a' })
    expect(results[1].ok).toBe(false)
    expect(results[2]).toEqual({ ok: true, value: 'c' })
  })

  it('handles empty task lists', async () => {
    expect(await runWithConcurrency([], 3)).toEqual([])
  })

  it('handles limit larger than the task count', async () => {
    const results = await runWithConcurrency([async () => 1, async () => 2], 10)
    expect(results.map((r) => r.value)).toEqual([1, 2])
  })
})

describe('settleToToolResult', () => {
  it('maps a fulfilled promise to a success ToolResult', async () => {
    const r = await settleToToolResult(Promise.resolve('报告内容'), 'tc-1', 'run_subagent')
    expect(r).toEqual({ toolCallId: 'tc-1', name: 'run_subagent', result: '报告内容', isError: false })
  })

  it('maps a rejected promise to an error ToolResult', async () => {
    const r = await settleToToolResult(Promise.reject(new Error('失败')), 'tc-2', 'run_subagent')
    expect(r.isError).toBe(true)
    expect(r.result).toContain('失败')
    expect(r.toolCallId).toBe('tc-2')
  })
})
