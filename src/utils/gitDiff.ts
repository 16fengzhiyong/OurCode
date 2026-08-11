/**
 * Lightweight unified-diff parser — parses `git diff` / `git diff --cached`
 * output into structured hunks so the Git panel can render a rich diff view
 * with per-hunk stage / revert actions (Stitch: 源代码管理与差异对比 高保真).
 */

export type DiffLineType = 'ctx' | 'add' | 'del'

export interface DiffLine {
  type: DiffLineType
  text: string
  oldLine?: number
  newLine?: number
  /** True when this line is a `\ No newline at end of file` marker — it must
   *  be re-emitted verbatim (no leading space) when rebuilding a patch. */
  noNewlineMarker?: boolean
}

export interface DiffHunk {
  header: string
  oldStart: number
  newStart: number
  lines: DiffLine[]
}

export interface ParsedDiff {
  file: string
  /** Original `--- a/…` / `+++ b/…` headers from the diff (needed by git apply
   *  for added/deleted files where one side is `/dev/null`). */
  oldHeader?: string
  newHeader?: string
  hunks: DiffHunk[]
  added: number
  deleted: number
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** Parse unified diff text into structured hunks (best-effort). */
export function parseGitDiff(diffText: string, file = ''): ParsedDiff {
  const hunks: DiffHunk[] = []
  let added = 0
  let deleted = 0
  let current: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0
  let oldHeader: string | undefined
  let newHeader: string | undefined

  for (const raw of diffText.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw

    if (!current && line.startsWith('--- ')) {
      oldHeader = line.slice(4)
      continue
    }
    if (!current && line.startsWith('+++ ')) {
      newHeader = line.slice(4)
      continue
    }

    const m = line.match(HUNK_RE)
    if (m) {
      if (current) hunks.push(current)
      oldLine = Number(m[1])
      newLine = Number(m[3])
      current = {
        header: line,
        oldStart: oldLine,
        newStart: newLine,
        lines: [],
      }
      continue
    }

    if (!current) continue // skip diff --git / index headers

    const prefix = line[0]
    if (prefix === '+') {
      current.lines.push({ type: 'add', text: line.slice(1), newLine })
      newLine++
      added++
    } else if (prefix === '-') {
      current.lines.push({ type: 'del', text: line.slice(1), oldLine })
      oldLine++
      deleted++
    } else {
      const noNewline = line.startsWith('\\ ')
      // The `\ No newline at end of file` marker is metadata, not a content
      // line — it must not consume a line number (git apply relies on this).
      current.lines.push({ type: 'ctx', text: line.slice(1), noNewlineMarker: noNewline })
      if (noNewline) continue
      current.lines[current.lines.length - 1].oldLine = oldLine
      current.lines[current.lines.length - 1].newLine = newLine
      oldLine++
      newLine++
    }
  }
  if (current) hunks.push(current)

  return { file, oldHeader, newHeader, hunks, added, deleted }
}

/**
 * Build a minimal patch containing a single hunk — a hunk is only valid for
 * `git apply` when prefixed with the file headers from the original diff
 * (they may be `/dev/null` for added/deleted files).
 */
export function buildHunkPatch(file: string, hunk: DiffHunk, parsed?: Pick<ParsedDiff, 'oldHeader' | 'newHeader'>): string {
  const old = parsed?.oldHeader || `a/${file}`
  const next = parsed?.newHeader || `b/${file}`
  return `--- ${old}\n+++ ${next}\n${hunk.header}\n${hunk.lines
    .map((l) => (l.noNewlineMarker ? `\\${l.text}` : l.type === 'add' ? `+${l.text}` : l.type === 'del' ? `-${l.text}` : ` ${l.text}`))
    .join('\n')}\n`
}
