import { useState } from 'react'
import { useI18n } from '@/i18n/useI18n'

interface ThinkingBlockProps {
  content: string
  defaultExpanded?: boolean
}

export default function ThinkingBlock({ content, defaultExpanded = false }: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const t = useI18n()

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="flex items-center gap-1.5 px-2 py-1 text-[13px] leading-none
                   text-nova-text-muted hover:text-nova-text-secondary hover:bg-nova-hover/50
                   transition-colors select-none w-full text-left rounded"
      >
        <svg
          className="w-2.5 h-2.5 shrink-0 transition-transform"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 18l6-6-6-6" />
        </svg>
        <span>{t('chat.thinkingTitle')}</span>
      </button>
    )
  }

  return (
    <div className="border-l-2 border-nova-accent/25">
      <button
        onClick={() => setIsExpanded(false)}
        className="flex items-center gap-1.5 px-2 py-1 text-[13px] leading-none
                   text-nova-text-muted hover:text-nova-text-secondary transition-colors
                   select-none w-full text-left"
      >
        <svg
          className="w-2.5 h-2.5 shrink-0 rotate-90 transition-transform"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 18l6-6-6-6" />
        </svg>
        <span>{t('chat.thinkingTitle')}</span>
      </button>
      <div className="px-2 pb-2 text-[13px] text-nova-text-muted whitespace-pre-wrap leading-[1.5] opacity-80">
        {content}
      </div>
    </div>
  )
}
