import { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'
// Light code-block syntax (极简纯净版): chat code blocks are now light panels
// in light mode; the dark theme restores github-dark colors via the
// `:root.dark .code-block .hljs-*` rules in global.css.
import 'highlight.js/styles/github.css'
import { t, getLocale } from '@/i18n'

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
  // mockup「代码块」头部：语言徽章 + 纯图标复制按钮（content_copy）。
  return `<div class="code-block"><div class="code-header"><span class="code-lang">${language}</span><button class="copy-btn" data-copy title="${t('common.copy')}" aria-label="${t('common.copy')}"><span class="material-symbols-outlined" aria-hidden="true">content_copy</span></button></div><pre><code class="hljs language-${language}">${highlighted}</code></pre></div>`
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
      // Whitelist a few rich-typography tags so AI answers can emit <mark>
      // highlights, <kbd> keys and <details>/<summary> collapsible panels —
      // nothing executable slips through (no onclick/onerror/script allowed).
      return DOMPurify.sanitize(marked.parse(content) as string, {
        ADD_TAGS: ['mark', 'kbd', 'details', 'summary'],
        ADD_ATTR: ['open'],
      })
    } catch {
      return DOMPurify.sanitize(`<p>${content}</p>`)
    }
    // Re-render the code-block Copy label when the language changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, getLocale()])

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

/** 流式 markdown 的尾随节流渲染。Agent 循环每 50ms 冲刷一次 store（见
 *  chatStore 的 STREAM_FLUSH_MS），而 marked + highlight.js + DOMPurify 对
 *  整段渐增回答的同步解析依然是每次冲刷最重的开销（O(n²) 总量）。这里把
 *  解析频率进一步限制到 STREAM_MARKDOWN_THROTTLE_MS —— 文本刷新约 8fps，
 *  对聊天肉眼无感，但大幅降低主线程阻塞；尾随定时器保证结束后必然收敛到
 *  最终 content（不会丢尾巴）。 */
const STREAM_MARKDOWN_THROTTLE_MS = 120

export function StreamingMarkdown({ content }: { content: string }) {
  const [display, setDisplay] = useState(content)
  const lastRenderAtRef = useRef(0)

  useEffect(() => {
    if (content === display) return
    const wait = Math.max(0, STREAM_MARKDOWN_THROTTLE_MS - (Date.now() - lastRenderAtRef.current))
    const id = setTimeout(() => {
      lastRenderAtRef.current = Date.now()
      setDisplay(content)
    }, wait)
    return () => clearTimeout(id)
    // Only react to new content — `display` is intentionally read from the
    // closure (the value at the time content last changed), so the timer always
    // targets the newest chunk and converges when the stream ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  return <MarkdownRenderer content={display} />
}
