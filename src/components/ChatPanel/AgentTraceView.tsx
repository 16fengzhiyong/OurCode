import type { ChatMessage } from '@/types'
import { useChatStore } from '@/stores/chatStore'
import { useI18n } from '@/i18n/useI18n'
import ToolStepRow, { formatMs } from './ToolStepRow'

/**
 * 轨迹视图 —— 按「轮次 → 请求 → 工具调用」渲染持久化消息的详细执行记录。
 *
 * 每个 assistant 消息 = 一轮 LLM 请求：顶部渲染请求行（耗时 + 输入/输出
 * token + 首字延迟），下方渲染该轮所有工具调用（名称/参数/状态/耗时，点击
 * 展开参数与完整结果）。数据源是 session.messages，运行中随 appendToolResult
 * / addMessage 自动更新，无需读取内存态的 agentTraces。
 */
export default function AgentTraceView() {
  const t = useI18n()
  const session = useChatStore((s) => s.sessions.find((x) => x.id === s.activeSessionId))
  const isSessionRunning = useChatStore((s) => s.runningSessionIds.includes(s.activeSessionId ?? ''))
  const messages = session?.messages ?? []

  // Group into turns: a user message starts a turn; subsequent assistant
  // messages belong to it. Standalone 'tool' messages are skipped — their
  // results already render inline on the assistant message (pairing-validity
  // duplicates, see recordToolMessage in chatStore).
  const turns: Array<{ user?: ChatMessage; assistant: ChatMessage[] }> = []
  for (const m of messages) {
    if (m.role === 'user') {
      turns.push({ user: m, assistant: [] })
    } else if (m.role === 'assistant') {
      if (turns.length === 0) turns.push({ assistant: [] })
      turns[turns.length - 1].assistant.push(m)
    }
  }

  if (turns.length === 0 || messages.length === 0) {
    return (
      <div className="h-full flex items-center justify-center px-6 text-nova-text-muted text-sm">
        {t('agent.traceEmpty')}
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      {turns.map((turn, ti) => (
        <div key={ti} className="mb-4">
          {/* 轮次头：轮次号 + 用户输入预览 */}
          <div className="mb-1.5 flex items-start gap-2 px-1">
            <span className="shrink-0 text-[11px] uppercase tracking-[0.06em] font-semibold text-nova-accent">
              {t('agent.traceTurn')} {ti + 1}
            </span>
            {turn.user && (
              <span className="min-w-0 text-[12px] text-nova-text-muted truncate">
                {turn.user.content.split('\n').map((l) => l.trim()).find(Boolean) || turn.user.content}
              </span>
            )}
          </div>

          {turn.assistant.map((msg) => {
            const hasRequest =
              msg.requestStartedAt != null ||
              msg.requestDurationMs != null ||
              msg.requestTokensIn != null ||
              msg.requestTokensOut != null ||
              msg.ttftMs != null
            const toolCalls = msg.toolCalls || []

            return (
              <div key={msg.id} className="border border-nova-border rounded-lg mb-2 overflow-hidden bg-nova-surface/40">
                {/* 请求行：耗时 / 首字延迟 / 输入输出 token */}
                {hasRequest && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2.5 py-1.5 border-b border-nova-border/60 text-[11px] font-mono text-nova-text-muted">
                    <span className="inline-flex items-center gap-1 shrink-0">
                      <span className="material-symbols-outlined text-[13px] leading-none" aria-hidden>
                        bolt
                      </span>
                      {t('agent.traceRequest')}
                    </span>
                    {msg.requestDurationMs != null && (
                      <span>
                        {t('agent.traceDuration')} {formatMs(msg.requestDurationMs)}
                      </span>
                    )}
                    {msg.ttftMs != null && (
                      <span>
                        {t('agent.traceTtft')} {formatMs(msg.ttftMs)}
                      </span>
                    )}
                    {msg.requestTokensIn != null && (
                      <span>
                        {t('agent.traceTokensIn')} {msg.requestTokensIn}
                      </span>
                    )}
                    {msg.requestTokensOut != null && (
                      <span>
                        {t('agent.traceTokensOut')} {msg.requestTokensOut}
                      </span>
                    )}
                  </div>
                )}

                {/* 工具调用行 */}
                {toolCalls.length > 0 ? (
                  <div className="flex flex-wrap items-start gap-1.5 p-2">
                    {toolCalls.map((tc) => {
                      const result = msg.toolResults?.find((r) => r.toolCallId === tc.id)
                      const rejected = !!result?.isError && /用户拒绝/.test(result.result)
                      return (
                        <ToolStepRow
                          key={tc.id}
                          toolCall={tc}
                          result={result}
                          rejected={rejected}
                          suspended={!result && !rejected && !isSessionRunning}
                          durationMs={result?.durationMs}
                        />
                      )
                    })}
                  </div>
                ) : msg.content ? (
                  // 无工具调用的最终回答
                  <div className="px-2.5 py-1.5 text-[12.5px] leading-[1.65] text-nova-text-secondary whitespace-pre-wrap">
                    {msg.content}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
