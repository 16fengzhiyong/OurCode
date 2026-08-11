/**
 * Shared helpers for turning absolute file/folder paths into the markdown
 * links that get appended to a chat message when files are attached via the
 * input box (drag-drop / @ picker / paperclip).
 *
 * In-workspace paths become relative links like `[name](./relative/path)`
 * (folders keep a trailing slash: `[OurCode-ide](./OurCode-ide/)`); paths
 * outside the workspace become `[name](C:/abs/path)` with forward slashes.
 */

/** Windows drive letters are case-insensitive; treat `\` and `/` equally. */
export function isPathInside(path: string, root: string): boolean {
  if (!root) return false
  const isWin = /^[A-Za-z]:[\\/]/.test(root) || root.startsWith('\\\\')
  const p = isWin ? path.toLowerCase() : path
  const r = isWin ? root.toLowerCase() : root
  const base = r.replace(/[\\/]+$/, '')
  return p === base || p.startsWith(base + (r.includes('\\') ? '\\' : '/'))
}

/** Paths are shown in the UI with forward slashes regardless of OS. */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/')
}

/**
 * Parse `text/uri-list` / `text/plain` payloads (the way some drag sources —
 * browsers, virtual file items — deliver files when `dataTransfer.files` is
 * empty) into absolute paths. Handles `file:///C:/x` and `file://server/share`.
 */
export function extractPathsFromUriList(text: string): string[] {
  const paths: string[] = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.trim().match(/^file:\/\/(.+)$/i)
    if (!m) continue
    let rest = m[1]
    // file:///C:/a b.txt → "/C:/a b.txt" → strip the leading slash.
    // file://server/share → "server/share" → UNC → "\\server\share".
    if (rest.startsWith('/')) {
      rest = rest.slice(1)
    } else {
      rest = '\\\\' + rest
    }
    try {
      paths.push(decodeURIComponent(rest).replace(/\//g, '\\'))
    } catch {
      /* malformed URI — skip */
    }
  }
  return paths
}

export function basename(p: string): string {
  return p.split(/[/\\]/).pop() || p
}

// Markdown link destinations can't contain raw spaces / parentheses — encode
// them so `[report (final).docx](./report (final).docx)` stays well-formed and
// still round-trips back to the real path when the message renders chips.
const encodeLinkTarget = (t: string) =>
  t.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20')
const decodeLinkTarget = (t: string) =>
  t.replace(/%28/g, '(').replace(/%29/g, ')').replace(/%20/g, ' ')

/**
 * Build the markdown link text for one attached file/folder.
 * `root` is the workspace root (may be ''); `isDirectory` controls the
 * trailing slash on in-workspace relative links.
 */
export function makeFileLink(path: string, root: string, isDirectory = false): string {
  const name = basename(path)
  if (isPathInside(path, root)) {
    const baseRoot = root.replace(/[\\/]+$/, '')
    let rel = toPosixPath(path.slice(baseRoot.length)).replace(/^\/+/, '')
    if (!rel) rel = name
    return `[${name}](./${encodeLinkTarget(rel)}${isDirectory ? '/' : ''})`
  }
  return `[${name}](${encodeLinkTarget(toPosixPath(path))})`
}

/**
 * Resolve a markdown link target (`./rel`, `../rel`, or an absolute path)
 * against the workspace root back to an absolute filesystem path, or null
 * when it can't be resolved. Used by the user-message renderer to decide
 * whether a `[name](target)` link in the message content corresponds to one
 * of the attached context files (→ render as a file chip) or is just pasted
 * text (→ keep as plain text).
 */
export function resolveLinkTarget(target: string, root: string): string | null {
  const t = decodeLinkTarget(target.trim())
  if (!t) return null
  // Absolute (Windows `C:\…`/`C:/…` or UNC) — normalize to backslashes.
  if (/^[A-Za-z]:[\\/]/.test(t) || t.startsWith('\\\\')) {
    return t.replace(/\//g, '\\')
  }
  if (t.startsWith('/')) return t
  if (!root) return null
  const baseRoot = root.replace(/[\\/]+$/, '')
  const sep = baseRoot.includes('\\') ? '\\' : '/'
  const parts = baseRoot.split(/[\\/]/)
  const relParts = t.split('/')
  for (const part of relParts) {
    if (part === '.' || part === '') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  const joined = parts.join(sep)
  // Normalize a leading `/` for posix-style roots.
  return joined.startsWith(sep) ? joined : joined
}

/**
 * Split `content` into text / attached-file segments so the message renderer
 * can turn the attachments into chips. Any `[name](target)` link whose target
 * resolves to one of `contextFiles` becomes a chip; everything else (including
 * pasted links that aren't in contextFiles) stays plain text.
 */
export interface FileLinkSegment {
  kind: 'text' | 'file'
  text: string
  path?: string
}

export function splitFileLinks(content: string, contextFiles: string[], root: string): FileLinkSegment[] {
  if (!content || contextFiles.length === 0) return [{ kind: 'text', text: content }]
  const targets = new Set(contextFiles.map((p) => p.toLowerCase()))
  const segments: FileLinkSegment[] = []
  const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g
  let last = 0
  let m: RegExpExecArray | null
  let fileAdded = false
  while ((m = LINK_RE.exec(content)) !== null) {
    const target = resolveLinkTarget(m[2], root)
    const isFile = target != null && targets.has(target.toLowerCase())
    if (!isFile) continue
    if (m.index > last) segments.push({ kind: 'text', text: content.slice(last, m.index) })
    segments.push({ kind: 'file', text: m[0], path: target })
    last = m.index + m[0].length
    fileAdded = true
  }
  if (!fileAdded) return [{ kind: 'text', text: content }]
  if (last < content.length) segments.push({ kind: 'text', text: content.slice(last) })
  return segments
}
