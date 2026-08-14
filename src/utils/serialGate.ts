/**
 * FIFO gate that serializes concurrent entrants: each `enter()` caller awaits
 * the PREVIOUS entrant's release before proceeding, so exactly one holds the
 * "turn" at a time.
 *
 * Used to serialize per-tool approval DIALOGS in the agent loop: the executor
 * runs a round's tools concurrently (MAX_PARALLEL_TOOLS), but the store has a
 * single pendingApproval slot and one resolve-key per session — without the
 * gate, concurrent approval hooks would overwrite each other and silently
 * reject every tool but the last.
 */
export function createSerialGate(): {
  /** Resolve when it is this entrant's turn; returns the release function the
   *  caller MUST invoke (ideally in a finally) when its turn is done. */
  enter: () => Promise<() => void>
} {
  let tail: Promise<void> = Promise.resolve()
  return {
    async enter(): Promise<() => void> {
      const previous = tail
      let release: () => void = () => {}
      tail = new Promise<void>((r) => { release = r })
      await previous
      return release
    },
  }
}
