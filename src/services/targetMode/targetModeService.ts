/**
 * Target-mode service: owns the `.ourcode/targemode/` state directory in the
 * workspace.
 *
 * The agent drives the actual workflow (goal doc, loops, logs) via tools, but
 * the code takes care of the bootstrap (directory skeleton + .gitignore) and
 * of surfacing the current status (round / progress) to both the system prompt
 * and the UI, so the state never depends on the model's memory.
 *
 * All fs access goes through `window.electronAPI.*` — paths are confined to
 * the project root (main-process allowedRoots guard).
 */

import { TARGET_MODE_SPEC_MD, TARGET_MODE_INDEX_INIT, TARGET_MODE_STATUS_INIT } from './spec'

const TARGET_MODE_DIR = '.ourcode/targemode'
const GITIGNORE_ENTRY = '.ourcode/targemode/'

/** Parse target-mode dir paths as `<root>/.ourcode/targemode/<rel>`. */
function join(root: string, ...rel: string[]): string {
  return [root.replace(/[\\/]+$/, ''), TARGET_MODE_DIR, ...rel].join('/')
}

/** Parse round / progress out of implementationStatus.md (loose on purpose —
 *  the file is model-maintained, so match the spec's field names leniently). */
export interface TargetModeStatus {
  round: number | null
  percent: number | null
  progressText: string
}

export function parseStatus(md: string): TargetModeStatus {
  const roundMatch = md.match(/当前轮次[：:]\s*(\d+)/)
  const percentMatch = md.match(/总体百分比[：:]\s*(\d+(?:\.\d+)?)\s*%/)
  const progressMatch = md.match(/实施进度[：:]\s*([^\n]+)/)
  return {
    round: roundMatch ? parseInt(roundMatch[1], 10) : null,
    percent: percentMatch ? parseFloat(percentMatch[1]) : null,
    progressText: progressMatch?.[1]?.trim() || '',
  }
}

/** Compact one-line badge for the mode bar, e.g. `R2 · 62%`. */
export function statusBadge(status: TargetModeStatus | null): string {
  if (!status) return ''
  const round = status.round !== null ? `R${status.round}` : 'R?'
  const percent = status.percent !== null ? ` · ${Math.round(status.percent)}%` : ''
  return round + percent
}

async function safeRead(path: string): Promise<string> {
  try {
    const { content } = await window.electronAPI.readFile(path)
    return content
  } catch {
    return ''
  }
}

async function safeWriteIfMissing(path: string, content: string): Promise<void> {
  if (await safeRead(path) !== '') return
  try {
    await window.electronAPI.writeFile(path, content, 'utf-8')
  } catch (e) {
    console.error('目标模式初始化写入失败:', path, e)
  }
}

async function safeCreateDir(path: string): Promise<void> {
  try {
    await window.electronAPI.createDir(path)
  } catch {
    // Already exists — fine (main-process mkdir is non-recursive)
  }
}

/** Ensure `.gitignore` in the project root lists `.ourcode/targemode/`. */
async function ensureGitIgnore(root: string): Promise<void> {
  const gitignorePath = `${root.replace(/[\\/]+$/, '')}/.gitignore`
  const content = await safeRead(gitignorePath)
  const lines = content.split(/\r?\n/)
  if (lines.some((l) => l.trim() === GITIGNORE_ENTRY)) return
  try {
    const addition = (content && !content.endsWith('\n') ? '\n' : '') + GITIGNORE_ENTRY + '\n'
    await window.electronAPI.writeFile(gitignorePath, content + addition, 'utf-8')
  } catch (e) {
    console.error('目标模式 .gitignore 更新失败:', e)
  }
}

/**
 * Bootstrap the `.ourcode/targemode/` skeleton (idempotent): dirs, SPEC.md,
 * index.md, implementationStatus.md, .gitignore entry. Failures are logged and
 * swallowed — target mode degrades to prompt-only rather than breaking the chat.
 */
export async function ensureInitialized(root: string): Promise<void> {
  if (!root) return
  try {
    await safeCreateDir(`${root.replace(/[\\/]+$/, '')}/.ourcode`)
    await safeCreateDir(join(root))
    await safeWriteIfMissing(join(root, 'SPEC.md'), TARGET_MODE_SPEC_MD)
    await safeWriteIfMissing(join(root, 'index.md'), TARGET_MODE_INDEX_INIT)
    await safeWriteIfMissing(join(root, 'implementationStatus.md'), TARGET_MODE_STATUS_INIT)
    await ensureGitIgnore(root)
  } catch (e) {
    console.error('目标模式初始化失败:', e)
  }
}

/** Read the current implementationStatus.md ('' when missing/unreadable). */
export async function readStatusText(root: string): Promise<string> {
  if (!root) return ''
  return safeRead(join(root, 'implementationStatus.md'))
}

/** Read + parse the current target-mode status, or null when unavailable. */
export async function readStatus(root: string): Promise<TargetModeStatus | null> {
  const md = await readStatusText(root)
  if (!md) return null
  return parseStatus(md)
}
