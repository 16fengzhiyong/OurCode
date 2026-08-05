import { useState } from 'react'

interface ThinkingBlockProps {
  content: string
}

export default function ThinkingBlock({ content }: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="mb-2 bg-nova-bg rounded-xl border border-nova-border overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center justify-between text-xs text-text-muted hover:text-text-secondary transition-colors"
      >
        <span className="flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5" />
          </svg>
          <span>思考过程</span>
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="transition-transform"
          style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 text-xs text-text-muted whitespace-pre-wrap border-t border-nova-border pt-2">
          {content}
        </div>
      )}
    </div>
  )
}
