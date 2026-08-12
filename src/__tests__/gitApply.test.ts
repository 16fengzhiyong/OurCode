import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseGitDiff, buildChangePatch, DiffChangeRange, ParsedDiff } from '../utils/gitDiff'

/**
 * Integration tests for buildChangePatch: create a real temp git repo, produce
 * actual `git diff` output, build single-change patches from it and verify the
 * real `git apply` accepts them (and that applying reverses exactly one change).
 *
 * These are skipped when git is not installed.
 */

function git(cwd: string, args: string[], input?: string): string {
  // -c core.autocrlf=false keeps the LF line endings we write on Windows.
  // Output is trimmed to match production (main.ts gitExec trims stdout).
  return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, input, encoding: 'utf-8' }).trim()
}

let hasGit = true
try {
  git(process.cwd(), ['--version'])
} catch {
  hasGit = false
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitapply-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'test@test.local'])
  git(dir, ['config', 'user.name', 'Test'])
  return dir
}

function commitAll(dir: string, message: string): void {
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', message])
}

/** Derive Monaco-like change ranges from git's parsed hunks: one change per
 *  contiguous del/add run (what the diff editor reports as an ILineChange). */
function changesFromParsed(parsed: ParsedDiff): DiffChangeRange[] {
  const changes: DiffChangeRange[] = []
  let cur: DiffChangeRange | null = null
  const flush = () => {
    if (cur) {
      changes.push(cur)
      cur = null
    }
  }
  for (const hunk of parsed.hunks) {
    for (const l of hunk.lines) {
      if (l.type === 'del' || l.type === 'add') {
        if (!cur) {
          cur = { originalStartLineNumber: 0, originalEndLineNumber: 0, modifiedStartLineNumber: 0, modifiedEndLineNumber: 0 }
        }
        if (l.type === 'del') {
          if (cur.originalStartLineNumber === 0 || l.oldLine! < cur.originalStartLineNumber) cur.originalStartLineNumber = l.oldLine!
          if (l.oldLine! > cur.originalEndLineNumber) cur.originalEndLineNumber = l.oldLine!
        } else {
          if (cur.modifiedStartLineNumber === 0 || l.newLine! < cur.modifiedStartLineNumber) cur.modifiedStartLineNumber = l.newLine!
          if (l.newLine! > cur.modifiedEndLineNumber) cur.modifiedEndLineNumber = l.newLine!
        }
      } else if (l.type === 'ctx' && !l.noNewlineMarker) {
        flush()
      }
    }
    flush()
  }
  return changes
}

function applyPatch(dir: string, patch: string, reverse = true, cached = false): void {
  const args = ['apply', ...(cached ? ['--cached'] : []), ...(reverse ? ['-R'] : []), '--whitespace=nowarn', '-']
  execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: dir, input: patch, encoding: 'utf-8' })
}

function checkPatch(dir: string, patch: string, reverse = true, cached = false): boolean {
  const args = ['apply', ...(cached ? ['--cached'] : []), ...(reverse ? ['-R'] : []), '--whitespace=nowarn', '--check', '-']
  try {
    execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: dir, input: patch, encoding: 'utf-8' })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!hasGit)('buildChangePatch — real git apply', () => {
  const INITIAL = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6', 'line 7', 'line 8', 'line 9', 'line 10', 'line 11', 'line 12'].join('\n') + '\n'
  const MODIFIED = [
    'line 1', 'line 2', 'line 3', 'line 4', 'line 5 MODIFIED', 'line 6', 'line 7', 'line 8', 'line 9 MODIFIED', 'line 10', 'line 11', 'line 12',
  ].join('\n') + '\n'

  it('reverts exactly one of two changes that share a single git hunk', () => {
    const dir = makeRepo()
    try {
      writeFileSync(join(dir, 'f.txt'), INITIAL)
      commitAll(dir, 'init')
      writeFileSync(join(dir, 'f.txt'), MODIFIED)

      const parsed = parseGitDiff(git(dir, ['diff', '--', 'f.txt']), 'f.txt')
      const changes = changesFromParsed(parsed)
      expect(changes.length).toBe(2)

      const patch1 = buildChangePatch('f.txt', parsed, changes[0])!
      const patch2 = buildChangePatch('f.txt', parsed, changes[1])!
      // git must accept both precise sub-patches as reversible
      expect(checkPatch(dir, patch1, true)).toBe(true)
      expect(checkPatch(dir, patch2, true)).toBe(true)

      applyPatch(dir, patch1, true)
      const after = readFileSync(join(dir, 'f.txt'), 'utf-8')
      expect(after).toBe(
        ['line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6', 'line 7', 'line 8', 'line 9 MODIFIED', 'line 10', 'line 11', 'line 12'].join('\n') + '\n',
      )
      // Only the second change remains
      const remaining = git(dir, ['diff', '--', 'f.txt'])
      expect(remaining).toContain('+line 9 MODIFIED')
      expect(remaining).not.toContain('+line 5 MODIFIED')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('stages a single change with git apply --cached, then unstages it', () => {
    const dir = makeRepo()
    try {
      writeFileSync(join(dir, 'f.txt'), INITIAL)
      commitAll(dir, 'init')
      writeFileSync(join(dir, 'f.txt'), MODIFIED)

      const parsed = parseGitDiff(git(dir, ['diff', '--', 'f.txt']), 'f.txt')
      const changes = changesFromParsed(parsed)
      const patch1 = buildChangePatch('f.txt', parsed, changes[0])!

      expect(checkPatch(dir, patch1, false, true)).toBe(true)
      applyPatch(dir, patch1, false, true)

      const cached = git(dir, ['diff', '--cached', '--', 'f.txt'])
      expect(cached).toContain('+line 5 MODIFIED')
      expect(cached).not.toContain('+line 9 MODIFIED')
      const worktree = git(dir, ['diff', '--', 'f.txt'])
      expect(worktree).toContain('+line 9 MODIFIED')
      // git may echo "line 5 MODIFIED" in a hunk's trailing context text, so
      // assert on the actual +/- content lines, not bare substrings.
      expect(worktree).not.toContain('+line 5 MODIFIED')

      // Unstage the same change
      expect(checkPatch(dir, patch1, true, true)).toBe(true)
      applyPatch(dir, patch1, true, true)
      expect(git(dir, ['diff', '--cached', '--', 'f.txt'])).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('handles a last-line edit in a file without a trailing newline', () => {
    const dir = makeRepo()
    try {
      writeFileSync(join(dir, 'n.txt'), 'a\nb\nc') // no trailing newline
      commitAll(dir, 'init')
      writeFileSync(join(dir, 'n.txt'), 'a\nb\nc2') // still no trailing newline

      const parsed = parseGitDiff(git(dir, ['diff', '--', 'n.txt']), 'n.txt')
      const changes = changesFromParsed(parsed)
      expect(changes.length).toBe(1)
      const patch = buildChangePatch('n.txt', parsed, changes[0])!
      expect(patch).toContain('\\ No newline at end of file')
      expect(checkPatch(dir, patch, true)).toBe(true)
      applyPatch(dir, patch, true)
      expect(readFileSync(join(dir, 'n.txt'), 'utf-8')).toBe('a\nb\nc')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('stages a brand-new file from its whole-file patch', () => {
    const dir = makeRepo()
    try {
      writeFileSync(join(dir, 'f.txt'), INITIAL)
      commitAll(dir, 'init')
      writeFileSync(join(dir, 'new.txt'), 'hello\nworld\n')

      // git diff ignores untracked files; intent-to-add makes git report the
      // new file with a /dev/null header — the same shape the app patches.
      git(dir, ['add', '-N', 'new.txt'])
      const parsed = parseGitDiff(git(dir, ['diff', '--', 'new.txt']), 'new.txt')
      const changes = changesFromParsed(parsed)
      expect(changes.length).toBe(1)
      const patch = buildChangePatch('new.txt', parsed, changes[0])!
      expect(patch.startsWith('--- /dev/null')).toBe(true)
      expect(checkPatch(dir, patch, false, true)).toBe(true)

      // Drop the intent-to-add marker, then stage the new file purely via the
      // generated whole-file patch.
      git(dir, ['reset', '-q'])
      applyPatch(dir, patch, false, true)
      expect(git(dir, ['diff', '--cached', '--', 'new.txt'])).toContain('+hello')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
