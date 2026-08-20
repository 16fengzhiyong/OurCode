import { describe, expect, it } from 'vitest'
import { buildTraceEntries } from '@/components/ChatPanel/traceEntries'
import type { ChatMessage } from '@/types'

function msg(id: string, role: ChatMessage['role'], extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role, content: '', sortOrder: 0, contextFiles: [], tokenCount: 0, createdAt: 0, ...extra }
}

function tc(id: string, name: string) {
  return { id, name, arguments: {} }
}

describe('buildTraceEntries', () => {
  it('returns [] for empty input', () => {
    expect(buildTraceEntries([], true)).toEqual([])
  })

  it('a user message becomes a user entry', () => {
    const entries = buildTraceEntries([msg('u1', 'user', { content: 'hi' })], true)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({ id: 'u1', kind: 'user', content: 'hi' })
  })

  it('an assistant message becomes an ai entry carrying timing fields', () => {
    const entries = buildTraceEntries(
      [msg('a1', 'assistant', { content: 'ok', thinking: '…', requestDurationMs: 100, requestTokensIn: 5 })],
      true
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      id: 'a1',
      kind: 'ai',
      content: 'ok',
      thinking: '…',
      requestDurationMs: 100,
      requestTokensIn: 5,
      ttftMs: undefined,
    })
  })

  it('each tool call becomes a tool entry right after its ai entry', () => {
    const entries = buildTraceEntries(
      [msg('a1', 'assistant', { toolCalls: [tc('t1', 'read_file')], toolResults: [{ toolCallId: 't1', name: 'read_file', result: 'data' }] })],
      true
    )
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ kind: 'ai', id: 'a1' })
    expect(entries[1]).toMatchObject({ id: 't1', kind: 'tool', rejected: false, suspended: false })
  })

  it('a tool call without a result is suspended when the session is not running', () => {
    const entries = buildTraceEntries([msg('a1', 'assistant', { toolCalls: [tc('t1', 'run_command')] })], false)
    expect(entries[1]).toMatchObject({ kind: 'tool', suspended: true, rejected: false })
  })

  it('a tool call without a result stays pending (not suspended) while the session runs', () => {
    const entries = buildTraceEntries([msg('a1', 'assistant', { toolCalls: [tc('t1', 'run_command')] })], true)
    expect(entries[1]).toMatchObject({ kind: 'tool', suspended: false })
  })

  it('a user-rejected result is marked rejected, not suspended', () => {
    const entries = buildTraceEntries(
      [msg('a1', 'assistant', { toolCalls: [tc('t1', 'edit_file')], toolResults: [{ toolCallId: 't1', name: 'edit_file', result: '用户拒绝执行', isError: true }] })],
      false
    )
    expect(entries[1]).toMatchObject({ kind: 'tool', rejected: true, suspended: false })
  })

  it('tool role messages are skipped (results render inline on assistant entries)', () => {
    const entries = buildTraceEntries([msg('u1', 'user'), msg('t1', 'tool')], true)
    expect(entries.map((e) => e.id)).toEqual(['u1'])
  })

  it('user / ai / tool entries interleave in time order', () => {
    const entries = buildTraceEntries(
      [
        msg('u1', 'user', { content: 'q1' }),
        msg('a1', 'assistant', { content: 'a', toolCalls: [tc('t1', 'read_file')] }),
        msg('a2', 'assistant', { content: 'b', toolCalls: [tc('t2', 'write_file'), tc('t3', 'run_command')] }),
      ],
      true
    )
    expect(entries.map((e) => `${e.kind}:${e.id}`)).toEqual(['user:u1', 'ai:a1', 'tool:t1', 'ai:a2', 'tool:t2', 'tool:t3'])
  })
})
