import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getModel } from '@/editor/modelRegistry'
import { previewFileUrl } from '@/editor/fileViews'
import type { FileViewMode } from '@/editor/fileViews'
import MarkdownRenderer from '@/components/Common/MarkdownRenderer'

// Debounce between the last keystroke and the live HTML preview reload, so
// rapid typing reloads at most every ~300ms instead of per keypress.
const LIVE_REFRESH_DEBOUNCE_MS = 300

interface PreviewPaneProps {
  path: string
  mode: FileViewMode
  /** Bumped by the toolbar's refresh button; forces the HTML iframe to reload. */
  refreshToken?: number
}

/** Preview of the active file when its extension has a dedicated view mode
 *  (html browser preview / markdown / image). Content comes from the live
 *  Monaco model so the preview follows edits without saving. */
export default function PreviewPane({ path, mode, refreshToken = 0 }: PreviewPaneProps) {
  if (mode === 'html') return <HtmlPreview path={path} refreshToken={refreshToken} />
  if (mode === 'markdown') return <MarkdownPreview path={path} />
  return <ImagePreview path={path} />
}

/**
 * Subscribe to a Monaco model's live content, falling back to the store's
 * initial copy until the model exists. Monaco creates the model asynchronously
 * when the tab becomes active (lazy language service), so a short poll covers
 * the gap — after that, changes arrive via onDidChangeContent.
 */
function useModelLiveContent(path: string): string | null {
  const [content, setContent] = useState<string | null>(() => getModel(path)?.getValue() ?? null)

  useEffect(() => {
    let disposed = false
    let sub: { dispose(): void } | null = null
    let timer: number | undefined

    const attach = () => {
      const model = getModel(path)
      if (!model || model.isDisposed()) return false
      sub?.dispose()
      setContent(model.getValue())
      sub = model.onDidChangeContent(() => {
        if (!disposed) setContent(model.getValue())
      })
      return true
    }

    if (!attach()) {
      timer = window.setInterval(() => {
        if (attach() && timer) window.clearInterval(timer)
      }, 150)
    }

    return () => {
      disposed = true
      if (timer) window.clearInterval(timer)
      sub?.dispose()
    }
  }, [path])

  return content
}

/** ourcode-file:// URL of a path's parent directory, trailing slash included. */
function dirUrlOf(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const dir = idx >= 0 ? path.slice(0, idx) : path
  const base = previewFileUrl(dir)
  return base.endsWith('/') ? base : `${base}/`
}

/** Resolve a markdown image href to an absolute URL. Remote/data/protocol URLs
 *  pass through; Windows drive paths map to local files; bare relative paths
 *  resolve against the markdown file's directory. */
function resolveMarkdownImageSrc(href: string, dirUrl: string): string {
  if (/^(https?:|data:|blob:|ourcode-file:|#)/i.test(href)) return href
  if (/^[a-zA-Z]:[\\/]/.test(href)) return previewFileUrl(href)
  if (href.startsWith('/')) return href
  return dirUrl + href
}

// ── HTML: embedded browser preview ──────────────────────────────────────────

function HtmlPreview({ path, refreshToken }: { path: string; refreshToken: number }) {
  const content = useModelLiveContent(path)
  const [version, setVersion] = useState(0)
  const pushedOnceRef = useRef(false)

  // Push the latest content into the main-process preview buffer and reload the
  // iframe. The buffer is awaited before the reload so the iframe never renders
  // stale disk content. The first content pushes immediately (no debounce), so
  // the preview shows the live file right away; subsequent edits are debounced
  // so rapid typing reloads at most every ~300ms. Only the newest push survives
  // (timeouts are cleared).
  useEffect(() => {
    if (content === null) return
    const push = () => {
      void window.electronAPI.setPreviewContent(path, content)
        .catch(() => { /* preview buffer is best-effort */ })
        .then(() => setVersion((v) => v + 1))
    }
    if (!pushedOnceRef.current) {
      pushedOnceRef.current = true
      push()
      return
    }
    const id = window.setTimeout(push, LIVE_REFRESH_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [content, path])

  // Manual refresh button — reload the iframe from the current buffer
  useEffect(() => {
    setVersion((v) => v + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken])

  // Drop the buffer when this pane unmounts (file closed / switched away) so
  // the protocol falls back to the on-disk content.
  useEffect(() => {
    return () => {
      void window.electronAPI.clearPreviewContent(path).catch(() => {})
    }
  }, [path])

  return (
    <iframe
      title="HTML Preview"
      className="w-full h-full border-0 bg-white"
      src={`${previewFileUrl(path)}?v=${version}`}
      sandbox="allow-scripts allow-forms allow-modals allow-popups"
    />
  )
}

// ── Markdown: rendered preview (relative local images resolved) ─────────────

function MarkdownPreview({ path }: { path: string }) {
  const content = useModelLiveContent(path) ?? ''
  const dirUrl = useMemo(() => dirUrlOf(path), [path])

  const rewriteImageSrc = useCallback(
    (href: string) => resolveMarkdownImageSrc(href, dirUrl),
    [dirUrl],
  )

  return (
    <div className="h-full overflow-y-auto px-6 py-4 bg-nova-bg">
      <MarkdownRenderer content={content} rewriteImageSrc={rewriteImageSrc} />
    </div>
  )
}

// ── Image: read-only preview ────────────────────────────────────────────────

function ImagePreview({ path }: { path: string }) {
  return (
    <div className="h-full overflow-auto flex items-center justify-center bg-nova-bg p-6">
      <img
        src={previewFileUrl(path)}
        alt=""
        draggable={false}
        className="max-w-full max-h-full object-contain"
      />
    </div>
  )
}
