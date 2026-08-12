import { useUIStore } from '@/stores/uiStore'
import { t as moduleT } from '@/i18n'

export interface GitExecResult {
  success: boolean
  output: string
  error?: string
}

/** Resolve the repo-relative path of a file to an absolute path (uses uiStore.rootPath). */
export function resolveRepoPath(repoFile: string): string {
  const rootPath = useUIStore.getState().rootPath
  if (!rootPath) return repoFile
  const sep = rootPath.includes('/') ? '/' : '\\'
  return rootPath.replace(/[/\\]$/, '') + sep + repoFile
}

/** Run a git command in the current project root (stdout trimmed, like the
 *  rest of the app's git usage). */
export async function runGitCommand(args: string[], input?: string): Promise<GitExecResult> {
  const rootPath = useUIStore.getState().rootPath
  if (!rootPath) return { success: false, output: '', error: moduleT('git.noFolder') }
  return window.electronAPI.gitExec(rootPath, args, input)
}

/** Run a git command returning UNTRIMMED stdout — used for byte-exact blob
 *  reads (`git show :file` / `git show HEAD:file`) so the central diff's left
 *  side keeps its trailing newline and leading whitespace. */
export async function runGitCommandRaw(args: string[], input?: string): Promise<GitExecResult> {
  const rootPath = useUIStore.getState().rootPath
  if (!rootPath) return { success: false, output: '', error: moduleT('git.noFolder') }
  return window.electronAPI.gitExecRaw(rootPath, args, input)
}

// ── Git-change notifications ────────────────────────────────────────────────
// After a mutation from the central diff editor, the sidebar (and anything else
// showing git state) must refresh. A tiny pub-sub keeps that decoupled — no
// component needs to reach into another component's state.
type GitChangeListener = () => void
const gitChangeListeners = new Set<GitChangeListener>()

export function onGitChanged(listener: GitChangeListener): () => void {
  gitChangeListeners.add(listener)
  return () => {
    gitChangeListeners.delete(listener)
  }
}

export function notifyGitChanged(): void {
  gitChangeListeners.forEach((l) => l())
}

export interface GitDiffSides {
  /** Left side of the diff (HEAD / index version). '' when the file is untracked. */
  original: string
  /** Right side of the diff (index / working-tree version). '' for deleted files. */
  modified: string
  /** Raw `git diff [--cached]` text for this file (parsed for hunk patches). */
  diffText: string
  /** False once the diff is empty (e.g. after reverting everything). */
  hasChanges: boolean
}

/**
 * Fetch both sides of a file's git diff plus the raw diff text.
 * - unstaged (index vs worktree): original = index blob, modified = file on disk
 * - staged (HEAD vs index): original = HEAD blob, modified = index blob
 * - untracked: original = '', modified = file on disk
 * - commit (<hash>): original = <hash>^ blob, modified = <hash> blob (read-only history)
 * Missing sides (e.g. a file added in the index, or deleted on disk) fall back
 * to '' — the diff then shows a pure addition / deletion.
 */
export async function fetchGitDiffSides(
  repoFile: string,
  staged: boolean,
  untracked = false,
  commitHash?: string,
): Promise<GitDiffSides> {
  if (untracked) {
    const modified = await readWorktree(repoFile)
    return { original: '', modified, diffText: '', hasChanges: true }
  }

  if (commitHash) {
    // History mode: left = parent of the commit, right = the commit itself.
    // The root commit has no parent — the left side falls back to ''.
    const diffRes = await runGitCommand(['show', '--format=', '--no-renames', commitHash, '--', repoFile])
    const diffText = diffRes.success ? diffRes.output : ''
    const original = await readBlobOrEmpty(repoFile, `${commitHash}^:`)
    const modified = await readBlobOrEmpty(repoFile, `${commitHash}:`)
    return { original, modified, diffText, hasChanges: diffText.length > 0 }
  }

  const diffRes = await runGitCommand(staged ? ['diff', '--cached', '--', repoFile] : ['diff', '--', repoFile])
  const diffText = diffRes.success ? diffRes.output : ''

  // Staged → compare HEAD against the index; unstaged → compare the index
  // against the worktree. git show errors for a side that doesn't exist yet
  // (added / deleted files) — that side becomes ''.
  const original = staged
    ? await readBlobOrEmpty(repoFile, 'HEAD:')
    : await readBlobOrEmpty(repoFile, ':')

  const modified = staged
    ? await readBlobOrEmpty(repoFile, ':')
    : await readWorktree(repoFile)

  return { original, modified, diffText, hasChanges: diffText.length > 0 }
}

/** `git show <rev>:<file>` with '' fallback when the side doesn't exist. */
async function readBlobOrEmpty(repoFile: string, rev: string): Promise<string> {
  const res = await runGitCommandRaw(['show', `${rev}${repoFile}`])
  return res.success ? res.output : ''
}

async function readWorktree(repoFile: string): Promise<string> {
  try {
    const res = await window.electronAPI.readFile(resolveRepoPath(repoFile))
    return res.content
  } catch {
    return '' // deleted on disk
  }
}
