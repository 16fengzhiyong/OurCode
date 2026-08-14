/**
 * Target-mode global token budget fuse (§11.4 / §13.3).
 *
 * Lives entirely on the target-mode side: it listens to the
 * `ourcode:usage-recorded` event whose detail carries per-session token totals
 * for TARGET-MODE sessions only (see chatStore.flushUsageEvents and
 * subagentRunner.recordEvent — both dispatch the detail; existing listeners
 * ignore it). The main loop itself stays untouched; the fuse only gates the
 * auto-resume path (chatStore.continueGeneration) for target-mode sessions.
 *
 * The limit is read from `.ourcode/targemode/budget.md` (visible config +
 * audit); enforcement here is the code-level backstop. This module deliberately
 * does NOT import chatStore, so chatStore → budget is a one-way edge (no cycle).
 */

const DEFAULT_LIMIT = 2_000_000

interface BudgetState {
  projectPath: string
  limit: number
  used: number
}

const budgets = new Map<string, BudgetState>()

async function readLimit(projectPath: string): Promise<number> {
  if (!projectPath) return DEFAULT_LIMIT
  try {
    const { content } = await window.electronAPI.readFile(
      `${projectPath.replace(/[\\/]+$/, '')}/.ourcode/targemode/budget.md`,
    )
    const m = content?.match(/总消耗上限（tokens）[：:]\s*(\d+)/)
    if (m) return Math.max(0, parseInt(m[1], 10))
  } catch {
    // Unreadable / missing budget.md → keep the default
  }
  return DEFAULT_LIMIT
}

function ensureState(sessionId: string, projectPath: string): BudgetState {
  let s = budgets.get(sessionId)
  if (!s || s.projectPath !== projectPath) {
    s = { projectPath, limit: DEFAULT_LIMIT, used: 0 }
    budgets.set(sessionId, s)
    void readLimit(projectPath).then((limit) => {
      const cur = budgets.get(sessionId)
      if (cur) cur.limit = limit
    })
  }
  return s
}

/** Accumulate consumed tokens for a session (event listener; target-mode only
 *  because the dispatch sites already filtered to target-mode sessions). */
function accumulate(sessionId: string, projectPath: string, tokens: number): void {
  if (!sessionId || !tokens || tokens <= 0) return
  ensureState(sessionId, projectPath).used += tokens
}

/** True when the session's cumulative target-mode consumption hit the cap. */
export function budgetExceeded(sessionId: string): boolean {
  const s = budgets.get(sessionId)
  return !!s && s.used >= s.limit
}

/**
 * Re-read the limit from budget.md — so raising the cap mid-run takes effect
 * (the fuse checks this before each auto-resume attempt).
 */
export async function refreshBudgetLimit(sessionId: string): Promise<void> {
  const s = budgets.get(sessionId)
  if (!s) return
  const limit = await readLimit(s.projectPath)
  const cur = budgets.get(sessionId)
  if (cur) cur.limit = limit
}

/** Current usage for the session (0 when never tracked) — surfaced to UI/audit. */
export function getBudgetUsage(sessionId: string): { used: number; limit: number } {
  const s = budgets.get(sessionId)
  return s ? { used: s.used, limit: s.limit } : { used: 0, limit: DEFAULT_LIMIT }
}

let installed = false

/** Install the global listener once (called from the App bootstrap). */
export function installBudgetFuse(): void {
  if (installed) return
  installed = true
  window.addEventListener('ourcode:usage-recorded', ((ev: Event) => {
    const detail = (ev as CustomEvent).detail as
      | { bySession?: Record<string, { tokens: number; projectPath: string }> }
      | undefined
    if (!detail?.bySession) return
    for (const [sessionId, info] of Object.entries(detail.bySession)) {
      accumulate(sessionId, info.projectPath, info.tokens)
    }
  }) as EventListener)
}
