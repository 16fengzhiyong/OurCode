/**
 * Cooperative tool timeouts.
 *
 * A tool call is given a wall-clock budget (`timeoutMs`). Two mechanisms work
 * together:
 *  1. Cooperative abort — the tool receives a composed AbortSignal that fires
 *     at the deadline (and when the enclosing run's own signal fires), so
 *     well-behaved tools (fetch, spawns) cancel promptly and don't leak.
 *  2. Hard race fallback — even a tool that ignores the signal settles within
 *     the budget, returning a structured `ToolTimeoutError` the model can
 *     react to (retry / widen the budget / change strategy).
 *
 * The two timers are the same duration: whichever fires first rejects with a
 * `ToolTimeoutError`, so the call always settles in ~`timeoutMs`.
 */

/** Structured timeout error — carries a stable code so callers (and the model,
 *  via the tool-error text) can distinguish "timed out" from "failed". */
export class ToolTimeoutError extends Error {
  readonly code = 'TOOL_TIMEOUT'
  constructor(readonly timeoutMs: number) {
    super(`工具执行超过 ${timeoutMs}ms 未完成，已终止`)
    this.name = 'ToolTimeoutError'
  }
}

/** Race a promise against a wall-clock budget. Rejects with ToolTimeoutError
 *  when the budget expires first. The inner promise's late settle is swallowed
 *  (no unhandled rejection); cooperative callers abort via their own signal. */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!(timeoutMs > 0)) return promise
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new ToolTimeoutError(timeoutMs))
    }, timeoutMs)
    promise.then(
      (v) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/** Run `run(signal)` under a `timeoutMs` budget, composing the deadline with
 *  the enclosing run's abort signal:
 *   - the passed signal fires at the deadline with a ToolTimeoutError reason
 *     (cooperative tools abort mid-flight);
 *   - if the outer run is cancelled first, that reason propagates unchanged —
 *     and the race settles immediately even for tools that ignore the signal;
 *   - the hard race guarantees the call settles within the budget regardless. */
export async function runWithTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  outerSignal?: AbortSignal,
): Promise<T> {
  if (!(timeoutMs > 0)) return run(outerSignal as AbortSignal)
  const controller = new AbortController()
  const deadline = setTimeout(() => {
    if (!controller.signal.aborted) controller.abort(new ToolTimeoutError(timeoutMs))
  }, timeoutMs)
  const onOuterAbort = (): void => {
    if (!controller.signal.aborted) controller.abort(outerSignal?.reason ?? new Error('已取消'))
  }
  if (outerSignal?.aborted) onOuterAbort()
  else outerSignal?.addEventListener('abort', onOuterAbort)
  try {
    return await new Promise<T>((resolve, reject) => {
      let settled = false
      const settle = (fn: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(deadline)
        clearTimeout(timer)
        outerSignal?.removeEventListener('abort', onOuterAbortForRace)
        fn()
      }
      // Hard fallback: settle even if the tool ignores its signal.
      const onOuterAbortForRace = (): void => {
        settle(() => reject(outerSignal?.reason ?? new Error('已取消')))
      }
      const timer = setTimeout(() => settle(() => reject(new ToolTimeoutError(timeoutMs))), timeoutMs)
      if (outerSignal?.aborted) onOuterAbortForRace()
      else outerSignal?.addEventListener('abort', onOuterAbortForRace)
      run(controller.signal).then(
        (v) => settle(() => resolve(v)),
        (e) => settle(() => reject(e)),
      )
    })
  } finally {
    clearTimeout(deadline)
    outerSignal?.removeEventListener('abort', onOuterAbort)
  }
}
