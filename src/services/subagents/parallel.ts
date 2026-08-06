/**
 * Parallel subagent scheduling helpers.
 *
 * The main agent may return several `run_subagent` tool calls in a single
 * batch. Each subagent run is fully self-contained (own ToolExecutor, message
 * array, permission guard, iteration/token budgets and usage recording — see
 * subagentRunner.ts), so they can safely execute concurrently. Only the
 * execution is parallelized here; approval dialogs and checkpoints stay
 * sequential inside the caller, so the human-in-the-loop surface is unchanged.
 */

export interface SettledResult<T> {
  ok: boolean
  /** Set when ok */
  value?: T
  /** Set when !ok */
  reason?: unknown
}

/**
 * Run `tasks` with at most `limit` in flight, resolving in input order.
 * Failures are captured per-task (never rejects the batch) — one failing
 * subagent must not cancel its siblings.
 */
export async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<Array<SettledResult<T>>> {
  const results: Array<SettledResult<T>> = new Array(tasks.length)
  let next = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++
      if (index >= tasks.length) return
      try {
        results[index] = { ok: true, value: await tasks[index]() }
      } catch (reason) {
        results[index] = { ok: false, reason }
      }
    }
  }

  const workers: Promise<void>[] = []
  const workerCount = Math.max(1, Math.min(limit, tasks.length))
  for (let i = 0; i < workerCount; i++) workers.push(worker())
  await Promise.all(workers)
  return results
}

/**
 * Resolve a started tool promise into a ToolResult, mapping a rejected
 * execution into an error result (so the agent loop's serial post-processing
 * can treat every result uniformly).
 */
export async function settleToToolResult<T>(
  promise: Promise<T>,
  toolCallId: string,
  name: string,
): Promise<{ toolCallId: string; name: string; result: string; isError: boolean }> {
  try {
    const value = await promise
    return { toolCallId, name, result: String(value ?? ''), isError: false }
  } catch (reason: any) {
    return {
      toolCallId,
      name,
      result: `Error: ${reason?.message || String(reason || '未知错误')}`,
      isError: true,
    }
  }
}
