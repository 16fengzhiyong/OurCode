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

/** A single change as reported by the Monaco diff editor (line ranges are
 *  1-based inclusive; a side with no lines has its start/end at 0). */
export interface DiffChangeRange {
  originalStartLineNumber: number
  originalEndLineNumber: number
  modifiedStartLineNumber: number
  modifiedEndLineNumber: number
}

/** Find the parsed git hunk that contains a Monaco change (matched by old-line
 *  or new-line overlap). Returns null when the change can't be located — the
 *  caller then falls back to the whole-hunk patch or no-ops. */
export function findHunkForChange(parsed: ParsedDiff, change: DiffChangeRange): DiffHunk | null {
  const oStart = change.originalStartLineNumber
  const oEnd = change.originalEndLineNumber
  const mStart = change.modifiedStartLineNumber
  const mEnd = change.modifiedEndLineNumber
  for (const hunk of parsed.hunks) {
    for (const l of hunk.lines) {
      if (l.type === 'del' && l.oldLine !== undefined && l.oldLine >= oStart && l.oldLine <= oEnd) return hunk
      if (l.type === 'add' && l.newLine !== undefined && l.newLine >= mStart && l.newLine <= mEnd) return hunk
    }
  }
  return null
}

/**
 * Build a patch that covers ONLY one Monaco change (plus up to 3 lines of
 * context on each side), reusing the exact line text from the parsed git diff
 * so `\ No newline at end of file` markers and whitespace stay intact.
 *
 * This is what makes the central diff's per-change revert/stage work like
 * VS Code's gutter arrows: `git apply` can be scoped to a single change even
 * when several changes sit inside one git hunk. Returns null when the change
 * can't be isolated reliably (the caller falls back to the whole hunk).
 */
export function buildChangePatch(file: string, parsed: ParsedDiff, change: DiffChangeRange): string | null {
  const hunk = findHunkForChange(parsed, change)
  if (!hunk) return null

  const hasOld = change.originalStartLineNumber > 0 && change.originalEndLineNumber >= change.originalStartLineNumber
  const hasNew = change.modifiedStartLineNumber > 0 && change.modifiedEndLineNumber >= change.modifiedStartLineNumber
  const oStart = hasOld ? change.originalStartLineNumber : -1
  const oEnd = hasOld ? change.originalEndLineNumber : -1
  const mStart = hasNew ? change.modifiedStartLineNumber : -1
  const mEnd = hasNew ? change.modifiedEndLineNumber : -1

  // The change's lines in this hunk: a contiguous del/add block. `\ No newline
  // at end of file` markers may follow the last content line (EOF edits) —
  // allow them inside the block so a last-line change is still isolatable.
  let firstIdx = -1
  let lastIdx = -1
  for (let i = 0; i < hunk.lines.length; i++) {
    const l = hunk.lines[i]
    const inRange =
      (l.type === 'del' && l.oldLine !== undefined && l.oldLine >= oStart && l.oldLine <= oEnd) ||
      (l.type === 'add' && l.newLine !== undefined && l.newLine >= mStart && l.newLine <= mEnd)
    if (inRange) {
      if (firstIdx === -1) firstIdx = i
      lastIdx = i
    }
  }
  if (firstIdx === -1) return null

  const block: DiffLine[] = []
  for (let i = firstIdx; i <= lastIdx; i++) {
    const l = hunk.lines[i]
    if (l.noNewlineMarker) {
      block.push(l)
      continue
    }
    if (l.type !== 'del' && l.type !== 'add') return null // another change sits between — bail
    block.push(l)
  }

  // Context from the hunk itself (exact text). Markers never precede a change
  // block (they only appear at EOF) and are excluded from the context limit.
  const ctxBefore: DiffLine[] = []
  for (let i = firstIdx - 1; i >= 0 && ctxBefore.length < 3; i--) {
    const l = hunk.lines[i]
    if (l.type !== 'ctx' || l.noNewlineMarker) break
    ctxBefore.unshift(l)
  }
  const ctxAfter: DiffLine[] = []
  for (let i = lastIdx + 1; i < hunk.lines.length && ctxAfter.length < 3; i++) {
    const l = hunk.lines[i]
    if (l.type !== 'ctx') break
    ctxAfter.push(l)
    if (l.noNewlineMarker) break // EOF marker — nothing follows
  }

  const delCount = block.filter((l) => l.type === 'del').length
  const addCount = block.filter((l) => l.type === 'add').length
  const ctxBeforeCount = ctxBefore.length
  const ctxAfterCount = ctxAfter.filter((l) => !l.noNewlineMarker).length
  const oldCount = ctxBeforeCount + delCount + ctxAfterCount
  const newCount = ctxBeforeCount + addCount + ctxAfterCount

  // Hunk start positions follow git's own convention: with leading context it's
  // the first context line; at the very start of a file a pure insertion has
  // oldStart 0 and a pure deletion has newStart 0 (count 0 on the empty side).
  let oldStart: number
  let newStart: number
  if (ctxBefore.length > 0) {
    oldStart = ctxBefore[0].oldLine ?? 0
    newStart = ctxBefore[0].newLine ?? 0
  } else {
    const firstDel = block.find((l) => l.type === 'del')
    const firstAdd = block.find((l) => l.type === 'add')
    if (delCount > 0 && addCount > 0) {
      oldStart = firstDel?.oldLine ?? 0
      newStart = firstAdd?.newLine ?? 0
    } else if (delCount > 0) {
      oldStart = firstDel?.oldLine ?? 0
      newStart = 0
    } else {
      oldStart = 0
      newStart = firstAdd?.newLine ?? 0
    }
  }

  const old = parsed.oldHeader || `a/${file}`
  const next = parsed.newHeader || `b/${file}`
  const oldSide = oldCount === 1 ? `${oldStart}` : `${oldStart},${oldCount}`
  const newSide = newCount === 1 ? `${newStart}` : `${newStart},${newCount}`
  const lines = [
    ...ctxBefore.map((l) => ` ${l.text}`),
    ...block.map((l) => (l.noNewlineMarker ? `\\${l.text}` : l.type === 'add' ? `+${l.text}` : `-${l.text}`)),
    ...ctxAfter.map((l) => (l.noNewlineMarker ? `\\${l.text}` : ` ${l.text}`)),
  ]
  return `--- ${old}\n+++ ${next}\n@@ -${oldSide} +${newSide} @@\n${lines.join('\n')}\n`
}
