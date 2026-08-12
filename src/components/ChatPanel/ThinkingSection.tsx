import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/i18n/useI18n'
import ToolStepRow from './ToolStepRow'

interface ThinkingSectionProps {
  /** 模型的思考过程（流式或已提交） */
  thinking?: string
  /** 本轮的工具调用（按时间顺序） */
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, any> }>
  /** 已提交的工具结果（缺 result 的工具视为仍在运行 / 未执行） */
  toolResults?: Array<{ toolCallId: string; name: string; result: string; isError?: boolean }>
  /** 会话是否仍在运行 —— 决定无结果工具显示「执行中」还是「未执行」 */
  isSessionRunning?: boolean
  /** 运行/流式期间自动展开（defaultExpanded 变 true 时也会展开）；默认收起 */
  defaultExpanded?: boolean
}

/**
 * 可折叠「思考与执行过程」区块（Stitch: Agent 运行视图·可折叠思考版）。
 * 思考文本 + 全部工具调用行合并收纳在同一个可折叠容器里；正文/结论在容器
 * 之外独立呈现 —— 收起时只留一行摘要，展开后先是思考（💭 紫色左线），
 * 虚线分隔，再是逐个工具调用行。
 */
export default function ThinkingSection({
  thinking,
  toolCalls,
  toolResults = [],
  isSessionRunning = false,
  defaultExpanded = false,
}: ThinkingSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const t = useI18n()

  // 运行中自动展开（新轮次并入同一气泡时 defaultExpanded 变化也能生效）；
  // 只扩不缩 —— 会话结束或用户手动收起都不会被这个 effect 干扰。
  useEffect(() => {
    if (defaultExpanded) setIsExpanded(true)
  }, [defaultExpanded])

  const { pendingCount, errorCount } = useMemo(() => {
    let pending = 0
    let errors = 0
    for (const tc of toolCalls) {
      const result = toolResults.find((r) => r.toolCallId === tc.id)
      if (result?.isError) errors++
      else if (!result && isSessionRunning) pending++
    }
    return { pendingCount: pending, errorCount: errors }
  }, [toolCalls, toolResults, isSessionRunning])

  const hasContent = !!thinking || toolCalls.length > 0
  if (!hasContent) return null

  // 收起时的一行摘要：只取思考首行（无思考时头部已有工具数，不再重复）
  const collapsedPreview = thinking ? thinking.replace(/\s+/g, ' ').trim() : ''

  const statusIcon = pendingCount > 0 ? '⏳' : errorCount > 0 ? '✗' : toolCalls.length > 0 ? '✓' : null

  return (
    <div className={`rounded-lg overflow-hidden border transition-colors ${
      isExpanded ? 'border-nova-border bg-nova-surface/40' : 'border-nova-border/50 bg-nova-surface/30'
    }`}>
      {/* Header — 点击切换折叠 */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left cursor-pointer select-none group hover:bg-nova-hover/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-[16px] leading-none text-nova-text-secondary shrink-0" aria-hidden>
            psychology
          </span>
          <span className="text-[12px] font-medium text-nova-text-secondary shrink-0">
            {t('chat.thinkingProcess')}
          </span>
          {toolCalls.length > 0 && (
            <span className="text-[11px] text-nova-text-muted shrink-0">
              · {t('agent.toolCalls', { count: toolCalls.length })}
            </span>
          )}
          {statusIcon && <span className="text-[11px] shrink-0">{statusIcon}</span>}
          {!isExpanded && collapsedPreview && (
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-nova-text-muted leading-5">
              {collapsedPreview}
            </span>
          )}
        </div>
        <span
          className={`material-symbols-outlined text-[16px] leading-none text-nova-text-muted shrink-0 transition-transform duration-200 group-hover:text-nova-text-secondary ${isExpanded ? 'rotate-180' : ''}`}
          aria-hidden
        >
          expand_more
        </span>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 flex flex-col gap-3 border-t border-nova-border/50 pt-3">
          {/* 思考文本 — 紫色左线（设计：border-l-2 border-tertiary/40，斜体） */}
          {thinking && (
            <div className="relative pl-3 border-l-2 border-accent-purple/40 py-0.5">
              <p className="text-[12.5px] text-nova-text-muted leading-[1.65] whitespace-pre-wrap italic">
                <span className="mr-1 not-italic">💭</span>
                {thinking}
              </p>
            </div>
          )}

          {/* 思考 ↔ 工具调用 之间的虚线分隔 */}
          {thinking && toolCalls.length > 0 && (
            <div className="border-t border-dashed border-nova-border/70" />
          )}

          {/* 工具调用行（逐个） */}
          {toolCalls.map((tc) => {
            const result = toolResults.find((r) => r.toolCallId === tc.id)
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
        </div>
      )}
    </div>
  )
}
