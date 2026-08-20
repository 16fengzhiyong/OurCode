import type { ChatMessage } from '@/types'

type ToolCall = NonNullable<ChatMessage['toolCalls']>[number]
type ToolResult = NonNullable<ChatMessage['toolResults']>[number]

/** 平铺时间线中的一条条目：用户 / AI 消息，或一次工具调用。 */
export type TraceEntry =
  | { id: string; kind: 'user'; content: string }
  | {
      id: string
      kind: 'ai'
      content: string
      thinking?: string
      /** 本轮 LLM 请求的计时/用量（旧会话可能缺失） */
      requestDurationMs?: number
      ttftMs?: number
      requestTokensIn?: number
      requestTokensOut?: number
    }
  | {
      id: string
      kind: 'tool'
      toolCall: ToolCall
      result?: ToolResult
      /** 用户显式拒绝（批量/逐个审批） */
      rejected: boolean
      /** 运行被停止且结果永不抵达（防止永久转圈，渲染「未执行」） */
      suspended: boolean
    }

/** 把持久化消息拍平成按时间顺序的条目列表：user 消息 → 用户条目，assistant
 *  消息 → AI 条目 + 其下每个工具调用各一条「工具」条目（按调用顺序交错）。
 *  role:'tool' 的配对消息跳过 —— 其结果已内联在 assistant 消息的 toolResults 上。 */
export function buildTraceEntries(messages: ChatMessage[], isSessionRunning: boolean): TraceEntry[] {
  const entries: TraceEntry[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      entries.push({ id: m.id, kind: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      entries.push({
        id: m.id,
        kind: 'ai',
        content: m.content,
        thinking: m.thinking,
        requestDurationMs: m.requestDurationMs,
        ttftMs: m.ttftMs,
        requestTokensIn: m.requestTokensIn,
        requestTokensOut: m.requestTokensOut,
      })
      for (const tc of m.toolCalls || []) {
        const result = m.toolResults?.find((r) => r.toolCallId === tc.id)
        const rejected = !!result?.isError && /用户拒绝/.test(result.result)
        entries.push({
          id: tc.id,
          kind: 'tool',
          toolCall: tc,
          result,
          rejected,
          suspended: !result && !rejected && !isSessionRunning,
        })
      }
    }
  }
  return entries
}
