import { useState } from 'react'
import { useI18n } from '@/i18n/useI18n'

interface ThinkingBlockProps {
  content: string
  /** Stream live (auto-expanded). Committed rounds default to collapsed one-liner. */
  defaultExpanded?: boolean
}

/**
 * Thinking block — 极简纯净版: violet left rule + "💭 思考" label, collapsed
 * to a truncated one-liner by default; expands on click. During live streaming
 * it auto-expands and shows the growing text with the caret in the parent.
 */
export default function ThinkingBlock({ content, defaultExpanded = false }: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const t = useI18n()
  const collapsed = !isExpanded

  return (
    <div className={`rounded-lg overflow-hidden border ${isExpanded ? 'border-nova-border bg-nova-surface/40' : 'border-transparent'} transition-colors`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-1 py-1 text-left cursor-pointer select-none group"
      >
        {/* Violet left rule — the only accent, keeps the row airy */}
        <span className="w-[2px] self-stretch rounded-full bg-accent-purple/70 shrink-0" />
        <span className="flex items-center gap-1 text-accent-purple shrink-0">
          <span className="text-[12px] leading-none">💭</span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em]">
            {t('chat.thinkingTitle')}
          </span>
        </span>
        {/* Collapsed: first line, truncated — Expanded: chevron only */}
        {collapsed ? (
          <span className="min-w-0 flex-1 truncate text-[12px] text-nova-text-muted leading-5">
            {content.replace(/\s+/g, ' ')}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <svg
          className={`w-3 h-3 text-nova-text-muted shrink-0 transition-transform duration-200 group-hover:text-nova-text-secondary ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {isExpanded && (
        <div className="px-1 pb-1.5 text-[12.5px] leading-[1.65] text-nova-text-muted whitespace-pre-wrap border-t border-nova-border/50 pt-2">
          {content}
        </div>
      )}
    </div>
  )
}
