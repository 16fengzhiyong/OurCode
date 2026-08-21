/**
 * File view modes: files of different extensions get different editing
 * surfaces in the editor area.
 *
 * - 'html'     → Monaco editor + embedded browser preview (ourcode-file://)
 * - 'markdown' → Monaco editor + rendered markdown preview (MarkdownRenderer)
 * - 'image'    → read-only image preview (no text editing)
 * - 'code'     → plain Monaco code editing (default)
 */

export type FileViewMode = 'html' | 'markdown' | 'image' | 'code'

const HTML_EXTENSIONS = new Set(['html', 'htm'])
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx'])
const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif',
  // SVG is text but previews as an image; Monaco has no dedicated svg language
  // anyway (it falls back to plaintext).
  'svg',
])

/** Resolve the view mode for a file path (extension-based, case-insensitive). */
export function getFileViewMode(path: string): FileViewMode {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (HTML_EXTENSIONS.has(ext)) return 'html'
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
  return 'code'
}

/**
 * Build an `ourcode-file://` URL for an absolute path — the scheme the main
 * process registers to serve local files (with MIME types) to the preview
 * iframe / <img> elements, so relative resources resolve to the filesystem.
 *
 * The path is carried under a fixed `local` host: the scheme is registered as
 * *standard*, so Blink parses the authority as host/path — putting the Windows
 * drive letter (`C:/…`) directly in the path would make it the host
 * (`ourcode-file://c/Users/…`) and drop it from the path. `//local/` keeps the
 * drive letter in the path and gives relative resolution a stable base.
 */
export function previewFileUrl(path: string): string {
  const posix = path.replace(/\\/g, '/').replace(/^\/+/, '')
  return `ourcode-file://local/${encodeURI(posix)}`
}

