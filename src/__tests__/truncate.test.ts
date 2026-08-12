import { describe, it, expect, beforeEach, vi } from 'vitest'
import { truncateToolOutput, DEFAULT_TOOL_OUTPUT_MAX_CHARS } from '../services/tools/truncate'
import { ToolExecutor } from '../services/tools/ToolExecutor'
import { ToolCall } from '../services/tools/types'

/**
 * Unified tool-output truncation tests — the pure function (head + notice +
 * tail) plus the ToolExecutor funnel proving every result (including the
 * currently unbounded MCP path) is capped.
 */

describe('truncateToolOutput', () => {
  it('returns short output unchanged', () => {
    expect(truncateToolOutput('hello world')).toBe('hello world')
    expect(truncateToolOutput('')).toBe('')
  })

  it('keeps output at exactly the char limit unchanged', () => {
    const text = 'x'.repeat(DEFAULT_TOOL_OUTPUT_MAX_CHARS)
    expect(truncateToolOutput(text)).toBe(text)
  })

  it('caps oversized output with head + notice + tail, head first', () => {
    const text = 'A'.repeat(60_000) + 'MIDDLE' + 'B'.repeat(60_000)
    const out = truncateToolOutput(text, { maxChars: 100_000 })
    expect(out.length).toBeLessThan(text.length)
    expect(out.startsWith('A'.repeat(60_000))).toBe(true) // head = 60% budget
    expect(out.endsWith('B'.repeat(40_000))).toBe(true) // tail = 40% budget
    expect(out).toContain('输出过长')
    expect(out).not.toContain('MIDDLE')
  })

  it('caps by line count when lines exceed the limit', () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `line-${i}`)
    const text = lines.join('\n')
    const out = truncateToolOutput(text, { maxChars: 1_000_000, maxLines: 1000 })
    expect(out.length).toBeLessThan(text.length)
    expect(out.startsWith('line-0')).toBe(true)
    expect(out.endsWith('line-4999')).toBe(true)
    expect(out).toContain('输出过长')
    const outLineCount = out.split('\n').length
    expect(outLineCount).toBeLessThan(2000) // head 600 + tail 400 + notice
  })

  it('respects custom limits', () => {
    const text = 'x'.repeat(50)
    expect(truncateToolOutput(text, { maxChars: 40 })).toContain('输出过长')
    expect(truncateToolOutput(text, { maxChars: 60 })).toBe(text)
  })
})

describe('ToolExecutor output funnel', () => {
  const electronAPI = {
    mcpCallTool: vi.fn(async () => ({ ok: true, result: 'Y'.repeat(200_000) })),
    recordUsage: vi.fn(async () => {}),
  }

  beforeEach(() => {
    electronAPI.mcpCallTool.mockClear()
    electronAPI.recordUsage.mockClear()
    vi.stubGlobal('window', { electronAPI, dispatchEvent: vi.fn() })
  })

  it('caps unbounded MCP output at the default limits', async () => {
    const executor = new ToolExecutor()
    const tc: ToolCall = { id: 'c1', name: 'mcp__server__big', arguments: {} }
    const res = await executor.execute(tc)
    expect(res.isError).toBeFalsy()
    expect(res.result.length).toBeLessThan(200_000)
    // head = 60% of 150K, tail = 40% of 150K
    expect(res.result.startsWith('Y'.repeat(90_000))).toBe(true)
    expect(res.result.endsWith('Y'.repeat(60_000))).toBe(true)
    expect(res.result).toContain('输出过长')
  })

  it('caps oversized error bodies from MCP too', async () => {
    electronAPI.mcpCallTool.mockResolvedValue({ ok: false, error: 'E'.repeat(200_000) })
    const executor = new ToolExecutor()
    const tc: ToolCall = { id: 'c1', name: 'mcp__server__big', arguments: {} }
    const res = await executor.execute(tc)
    expect(res.isError).toBe(true)
    expect(res.result.length).toBeLessThan(200_000)
    expect(res.result).toContain('输出过长')
  })

  it('passes short results through untouched', async () => {
    electronAPI.mcpCallTool.mockResolvedValue({ ok: true, result: 'short result' })
    const executor = new ToolExecutor()
    const tc: ToolCall = { id: 'c1', name: 'mcp__server__small', arguments: {} }
    const res = await executor.execute(tc)
    expect(res.isError).toBeFalsy()
    expect(res.result).toBe('short result')
  })
})
