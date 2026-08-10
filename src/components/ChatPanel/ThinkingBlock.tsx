import { useState } from 'react'
import { useI18n } from '@/i18n/useI18n'

interface ThinkingBlockProps {
  content: string
  defaultExpanded?: boolean
}

/** Collapsible "thinking" card — vibrant-gradient variant: glass card with a
 *  violet accent, chevron rotate, and soft hover glow (see .thinking-card). */
export default function ThinkingBlock({ content, defaultExpanded = false }: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const t = useI18n()

  return (
    <div className={`thinking-card rounded-xl overflow-hidden ${isExpanded ? 'open' : ''}`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2.5 cursor-pointer select-none transition-colors"
      >
        <span className="flex items-center gap-2 text-accent-purple">
          <svg
            className="w-[15px] h-[15px]"
            fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"
            strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M12 4.5a2.5 2.5 0 0 1 2.5 2.5c0 1.2.4 1.9 1.2 2.6a4.2 4.2 0 0 1 1.3 3.1c0 2.1-1.6 3.8-3.7 3.8H11a4 4 0 0 1-4-4c0-.8.2-1.5.6-2.1" />
            <path d="M12 2.5v2M12 19.5v2M3.5 9h2M18.5 9h2M5.6 4.6l1.4 1.4M17 14.9l1.4 1.4" opacity=".7" />
          </svg>
          <span className="text-[11px] font-bold uppercase tracking-[0.08em]">{t('chat.thinkingTitle')}</span>
        </span>
        <svg
          className={`w-4 h-4 text-nova-text-muted transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {isExpanded && (
        <div className="px-4 pb-3.5 pt-2 border-t border-nova-border text-[13px] text-nova-text-muted whitespace-pre-wrap leading-[1.6] opacity-80">
          {content}
        </div>
      )}
    </div>
  )
}
