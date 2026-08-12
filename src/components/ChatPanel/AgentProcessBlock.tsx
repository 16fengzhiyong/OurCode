import { Fragment, useEffect, useState } from 'react'
import type { ChatMessage as ChatMessageType } from '@/types'
import { useChatStore } from '@/stores/chatStore'
import { useI18n } from '@/i18n/useI18n'
import ToolStepRow from './ToolStepRow'
import { PlanCard } from './AgentPanel'

interface AgentProcessBlockProps {
  /** 同一气泡（turn）内全部 assistant 消息，按真实轮次顺序排列 */
  messages: ChatMessageType[]
  sessionId: string
  /** 运行/流式期间自动展开（defaultExpanded 变 true 时也会展开）；默认收起 */
  defaultExpanded?: boolean
}

/**
 * 统一「思考与执行过程」折叠块 —— 一个气泡（turn）内所有轮次的思考文本与
 * 工具调用按真实顺序交错渲染在同一个可折叠块里（思考 → 文字 → 工具 → 思考
 * → 文字 → 工具），最终回答的 markdown 正文由调用方渲染在块下方。
 * 收起时只留「💭 标题 + 首行预览」，展开后显示完整过程。
 */
export default function AgentProcessBlock({ messages, sessionId, defaultExpanded = false }: AgentProcessBlockProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const t = useI18n()
  const isSessionRunning = useChatStore((s) => s.runningSessionIds.includes(sessionId))

  // 运行中自动展开（defaultExpanded 变 true 时也能生效）；只扩不缩。
  useEffect(() => {
    if (defaultExpanded) setIsExpanded(true)
  }, [defaultExpanded])

  const hasToolCalls = messages.some((m) => (m.toolCalls?.length || 0) > 0)
  const hasProcess = messages.some((m) => m.thinking || (m.toolCalls?.length || 0) > 0)
  if (!hasProcess) return null

  // 收起预览：优先第一条思考文本的首行；纯工具轮次则显示首个工具名。
  const firstThinking = messages.find((m) => m.thinking)?.thinking || ''
  const firstToolName = messages.find((m) => (m.toolCalls?.length || 0) > 0)?.toolCalls?.[0].name || ''
  const collapsedPreview = firstThinking ? firstThinking.replace(/\s+/g, ' ').trim() : firstToolName

  // 需要显示在块内的轮次（最后一条消息的正文是最终回答，由调用方渲染在块下方）
  const rounds = messages
    .map((m, i) => ({
      id: m.id,
      thinking: m.thinking,
      // 中间轮次写出的正文也属于执行过程，保留在块内（弱化显示，不丢失）
      midContent: i < messages.length - 1 ? m.content : '',
      toolCalls: m.toolCalls || [],
      toolResults: m.toolResults || [],
      hasSubmittedPlan: (m.toolCalls || []).some((tc) => tc.name === 'submit_plan'),
    }))
    .filter((r) => r.thinking || r.midContent || r.toolCalls.length > 0)

  return (
    <div className={`rounded-lg overflow-hidden border transition-colors ${
      isExpanded ? 'border-nova-border/60 bg-nova-surface/40' : 'border-transparent'
    }`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-1 py-1 text-left cursor-pointer select-none group"
      >
        {/* 紫色左线 —— 过程块的唯一点缀（与思考块同一风格） */}
        <span className="w-[2px] self-stretch rounded-full bg-accent-purple/70 shrink-0" aria-hidden />
        <span className="flex items-center gap-1 text-accent-purple shrink-0">
          <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden>
            psychology
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em]">
            {hasToolCalls ? t('chat.thinkingProcess') : t('chat.thinkingTitle')}
          </span>
        </span>
        {!isExpanded && collapsedPreview && (
          <span className="min-w-0 flex-1 truncate text-[12px] text-nova-text-muted leading-5">
            {collapsedPreview}
          </span>
        )}
        {isExpanded && <span className="flex-1" />}
        <span
          className={`material-symbols-outlined text-[14px] leading-none text-nova-text-muted shrink-0 transition-transform duration-200 group-hover:text-nova-text-secondary ${isExpanded ? 'rotate-180' : ''}`}
          aria-hidden
        >
          expand_more
        </span>
      </button>

      {isExpanded && (
        <div className="px-1 pb-1.5 pt-2 border-t border-nova-border/50 flex flex-col gap-2">
          {rounds.map((round, ri) => (
            <Fragment key={round.id}>
              {ri > 0 && <div className="h-px bg-nova-border/30" aria-hidden />}
              <div className="flex flex-col gap-1.5">
                {round.thinking && (
                  <div className="text-[12.5px] leading-[1.65] text-nova-text-muted whitespace-pre-wrap">
                    {round.thinking}
                  </div>
                )}
                {round.midContent && (
                  <div className="text-[12.5px] leading-[1.65] text-nova-text-secondary whitespace-pre-wrap">
                    {round.midContent}
                  </div>
                )}
                {round.toolCalls.map((tc) => {
                  const result = round.toolResults.find((r) => r.toolCallId === tc.id)
                  const rejected = !!result?.isError && /用户拒绝/.test(result.result)
                  return (
                    <ToolStepRow
                      key={tc.id}
                      toolCall={tc}
                      result={result}
                      rejected={rejected}
                      suspended={!result && !rejected && !isSessionRunning}
                    />
                  )
                })}
                {round.hasSubmittedPlan && <PlanCard sessionId={sessionId} />}
              </div>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
