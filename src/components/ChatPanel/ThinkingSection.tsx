import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n/useI18n'

interface ThinkingSectionProps {
  /** 该轮次的思考文本（流式或已提交） */
  thinking?: string
  /** 运行/流式期间自动展开（defaultExpanded 变 true 时也会展开）；默认收起 */
  defaultExpanded?: boolean
  /** 流式进行中：收起状态下显示「思考中…」脉冲提示而不是首行预览，
   *  避免把内心独白刷屏给用户看；点击仍可展开查看。 */
  streaming?: boolean
}

/**
 * 单轮思考块 —— 最小化可折叠行，随真实调用顺序交错在正文流中
 * （思考 → 文字 → 工具 → 思考 → 文字 → 工具）。
 * 收起时只留「💭 思考 + 首行预览」，展开后显示完整思考文本。
 */
export default function ThinkingSection({ thinking, defaultExpanded = false, streaming = false }: ThinkingSectionProps) {
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
        <span className="flex items-center gap-1 text-nova-text-muted shrink-0">
          <span className="text-[11px] font-medium">{t('chat.thinkingTitle')}</span>
        </span>
        {!isExpanded && (streaming ? (
          <span className="min-w-0 flex-1 flex items-center gap-1.5 text-[12px] text-nova-text-muted leading-5">
            {t('chat.thinking')}…
            <span className="inline-flex gap-0.5" aria-hidden>
              <span className="w-1 h-1 rounded-full animate-think-bounce" style={{ background: '#838485' }} />
              <span className="w-1 h-1 rounded-full animate-think-bounce" style={{ background: '#838485', animationDelay: '0.2s' }} />
              <span className="w-1 h-1 rounded-full animate-think-bounce" style={{ background: '#838485', animationDelay: '0.4s' }} />
            </span>
          </span>
        ) : collapsedPreview && (
          <span className="min-w-0 flex-1 truncate text-[12px] text-nova-text-muted leading-5">
            {collapsedPreview}
          </span>
        ))}
        {isExpanded && <span className="flex-1" />}
        <span
          className={`material-symbols-outlined text-[14px] leading-none text-nova-text-muted shrink-0 transition-transform duration-200 group-hover:text-nova-text-secondary ${isExpanded ? 'rotate-180' : ''}`}
          aria-hidden
        >
          expand_more
        </span>
      </button>

      {isExpanded && (
        <div className="border-t border-nova-border/50 pt-2 px-1 pb-1.5 flex flex-col gap-1.5">
          <div className="text-[12.5px] leading-[1.65] text-nova-text-muted whitespace-pre-wrap">
            {thinking}
          </div>
          {/* Bottom collapse action — long thinking blocks can fold back up
              without hunting for the tiny header chevron */}
          <button
            onClick={() => setIsExpanded(false)}
            className="self-center flex items-center gap-1 px-2.5 py-1 text-[11px] text-nova-text-muted hover:text-nova-text-secondary hover:bg-nova-hover rounded-md transition-colors select-none shrink-0"
          >
            <span className="material-symbols-outlined text-[13px] leading-none" aria-hidden>expand_less</span>
            {t('chat.collapseProcess')}
          </button>
        </div>
      )}
    </div>
  )
}
