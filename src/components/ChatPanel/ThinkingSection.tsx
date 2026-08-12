import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n/useI18n'

interface ThinkingSectionProps {
  /** 该轮次的思考文本（流式或已提交） */
  thinking?: string
  /** 运行/流式期间自动展开（defaultExpanded 变 true 时也会展开）；默认收起 */
  defaultExpanded?: boolean
}

/**
 * 单轮思考块 —— 最小化可折叠行，随真实调用顺序交错在正文流中
 * （思考 → 文字 → 工具 → 思考 → 文字 → 工具）。
 * 收起时只留「💭 思考 + 首行预览」，展开后显示完整思考文本。
 */
export default function ThinkingSection({ thinking, defaultExpanded = false }: ThinkingSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const t = useI18n()

  // 运行中自动展开（defaultExpanded 变 true 时也能生效）；只扩不缩。
  useEffect(() => {
    if (defaultExpanded) setIsExpanded(true)
  }, [defaultExpanded])

  if (!thinking) return null

  const collapsedPreview = thinking.replace(/\s+/g, ' ').trim()

  return (
    <div className={`rounded-lg overflow-hidden border transition-colors ${
      isExpanded ? 'border-nova-border/60 bg-nova-surface/40' : 'border-transparent'
    }`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-1 py-1 text-left cursor-pointer select-none group"
      >
        {/* 紫色左线 —— 思考块的唯一点缀（极简纯净版风格） */}
        <span className="w-[2px] self-stretch rounded-full bg-accent-purple/70 shrink-0" aria-hidden />
        <span className="flex items-center gap-1 text-accent-purple shrink-0">
          <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden>
            psychology
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em]">
            {t('chat.thinkingTitle')}
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
        <div className="px-1 pb-1.5 text-[12.5px] leading-[1.65] text-nova-text-muted whitespace-pre-wrap border-t border-nova-border/50 pt-2">
          {thinking}
        </div>
      )}
    </div>
  )
}
