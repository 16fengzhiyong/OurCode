/**
 * Checkpoint capture — snapshots the file(s) a write tool is about to touch so
 * the user can revert. Shared by the main agent loop and subagents so every
 * AI-initiated file mutation is revertable (Windsurf-style checkpoints).
 */
import { v4 as uuidv4 } from 'uuid'
import type { Checkpoint } from '@/types'

export async function captureCheckpoint(
  sessionId: string,
  tc: { name: string; arguments?: Record<string, any> },
  messageId?: string,
): Promise<Checkpoint | null> {
  const target = tc.arguments?.path
  if (typeof target !== 'string' || !target) return null

  const files: Array<{ path: string; content: string; existed: boolean }> = []
  if (tc.name !== 'create_directory') {
    try {
      const { content } = await window.electronAPI.readFile(target)
      files.push({ path: target, content, existed: true })
    } catch {
      // File doesn't exist yet (write_file creating a new file)
      files.push({ path: target, content: '', existed: false })
    }
  }

  if (files.length === 0) return null

  const checkpoint: Checkpoint = {
    id: uuidv4(),
    sessionId,
    createdAt: Date.now(),
    label: `${tc.name} → ${target.split(/[/\\]/).pop() || target}`,
    messageId: messageId || undefined,
    files,
  }

  await window.electronAPI.checkpointCreate(checkpoint)
  return checkpoint
}
