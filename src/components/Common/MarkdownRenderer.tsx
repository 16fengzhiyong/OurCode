import { useEffect, useMemo, useRef } from 'react'
import { marked } from 'marked'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'
import 'highlight.js/styles/github-dark.css'

interface MarkdownRendererProps {
  content: string
}

// Custom renderer
const renderer = new marked.Renderer()

// Override code block rendering using a generic approach
// (accepts both the newer object form {text, lang} and the legacy (code, infostring) form)
renderer.code = function (...args: any[]) {
  const first = args[0]
  const text = typeof first === 'object' ? first.text : first
  const lang = typeof first === 'object' ? first.lang : args[1]
  const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
  const highlighted = hljs.highlight(text, { language }).value
  // NOTE: no inline onclick here — blocked by CSP and an injection vector.
  // Copy is handled via event delegation in the container (see useEffect below).
  return `<div class="code-block"><div class="code-header"><span class="code-lang">${language}</span><button class="copy-btn" data-copy>Copy</button></div><pre><code class="hljs language-${language}">${highlighted}</code></pre></div>`
}

marked.use({
  gfm: true,
  breaks: true,
  renderer,
})

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const html = useMemo(() => {
    try {
      // Sanitize the rendered HTML to prevent XSS from AI/tool output
      // (marked >= v5 no longer sanitizes; DOMPurify strips scripts/event handlers)
      return DOMPurify.sanitize(marked.parse(content) as string)
    } catch {
      return DOMPurify.sanitize(`<p>${content}</p>`)
    }
  }, [content])

  // Event-delegated copy button (works under CSP, no inline handlers)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.copy-btn')
      if (!btn) return
      const codeEl = btn.closest('.code-block')?.querySelector('code')
      if (codeEl) {
        navigator.clipboard.writeText(codeEl.textContent || '').catch(() => { /* ignore */ })
      }
    }

    container.addEventListener('click', handleClick)
    return () => container.removeEventListener('click', handleClick)
  }, [])

  return (
    <div
      ref={containerRef}
      className="markdown-body text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
