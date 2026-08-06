/**
 * Vibe-and-Replace pending state.
 *
 * When the user picks "Vibe 替换" in the editor context menu, the selected code
 * is stashed here and the chat input is focused. On submit, the input handler
 * combines the user's natural-language description with the stashed selection.
 */

export interface PendingVibeReplace {
  text: string
  language: string
  filePath: string
}

let pending: PendingVibeReplace | null = null

export function setPendingVibeReplace(v: PendingVibeReplace | null): void {
  pending = v
}

export function takePendingVibeReplace(): PendingVibeReplace | null {
  const v = pending
  pending = null
  return v
}
