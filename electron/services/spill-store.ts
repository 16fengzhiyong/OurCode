/**
 * Tool-output spill store — main process.
 *
 * When a tool result (run_command output, MCP result…) exceeds the inline
 * budget, the full text is spilled to disk and only a bounded preview with a
 * locator goes into the chat/request history. The model can page the full text
 * back via read_file (userData is inside the fs allowlist), so no information
 * is lost — unlike plain truncation.
 *
 * Hardening (mirrors production harnesses, e.g. dsh's spill store):
 *  - random file names + `wx` (O_EXCL) create → no symlink planting or path
 *    prediction;
 *  - 0600 mode → no other local user can read spilled command output (which may
 *    contain secrets the agent ran);
 *  - per-file and per-session quotas → a runaway tool cannot fill the disk;
 *    over quota the caller falls back to plain truncation;
 *  - startup sweep removes files older than the TTL; deleting a chat session
 *    deletes its spill directory.
 */
import { promises as fs } from 'fs'
import { join, basename, dirname } from 'path'
import { randomBytes } from 'crypto'

/** Hard cap per spilled file (bytes) — well above any tool's inline budget. */
export const SPILL_MAX_FILE_BYTES = 10 * 1024 * 1024
/** Hard cap per session (bytes) — protects the disk from repeated huge spills. */
export const SPILL_MAX_SESSION_BYTES = 100 * 1024 * 1024
/** Spilled files older than this are swept at startup (7 days). */
export const SPILL_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Session ids are uuids, but defend the filesystem regardless. */
function safeDirName(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, '_')
}

export interface SpillStoreLimits {
  /** Overrides SPILL_MAX_FILE_BYTES (tests inject small values). */
  maxFileBytes?: number
  /** Overrides SPILL_MAX_SESSION_BYTES (tests inject small values). */
  maxSessionBytes?: number
}

export class SpillStore {
  private readonly maxFileBytes: number
  private readonly maxSessionBytes: number

  constructor(
    private readonly baseDir: string,
    limits: SpillStoreLimits = {},
  ) {
    this.maxFileBytes = limits.maxFileBytes ?? SPILL_MAX_FILE_BYTES
    this.maxSessionBytes = limits.maxSessionBytes ?? SPILL_MAX_SESSION_BYTES
  }

  /**
   * Save `text` under the session's spill directory and return its absolute
   * path (the locator the model can read_file). Returns null when the file is
   * over the per-file cap, the session quota is exhausted, or writing fails —
   * callers then fall back to plain truncation.
   */
  async save(sessionId: string, text: string): Promise<string | null> {
    const dir = this.sessionDir(sessionId)
    try {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    } catch {
      return null
    }

    if (Buffer.byteLength(text, 'utf8') > this.maxFileBytes) return null
    // Session quota: sum the existing files' sizes before writing.
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      let total = 0
      for (const e of entries) {
        if (!e.isFile()) continue
        try {
          const st = await fs.stat(join(dir, e.name))
          total += st.size
        } catch { /* raced delete — skip */ }
      }
      if (total + Buffer.byteLength(text, 'utf8') > this.maxSessionBytes) return null
    } catch {
      return null
    }

    const name = `${Date.now().toString(36)}-${randomBytes(8).toString('hex')}.txt`
    const target = join(dir, name)
    try {
      // 'wx' (O_EXCL) + 0600: refuse to follow an existing file (symlink
      // planting) and keep the contents private to this OS user.
      await fs.writeFile(target, text, { flag: 'wx', mode: 0o600 })
      return target
    } catch {
      return null
    }
  }

  /** Delete a session's entire spill directory (session deletion / reset). */
  async deleteSession(sessionId: string): Promise<void> {
    const dir = this.sessionDir(sessionId)
    try {
      await fs.rm(dir, { recursive: true, force: true })
    } catch { /* best-effort */ }
  }

  /** Remove spill files older than `maxAgeMs` and the now-empty dirs. */
  async sweep(maxAgeMs: number = SPILL_TTL_MS): Promise<number> {
    let removed = 0
    const now = Date.now()
    let sessions: string[]
    try {
      sessions = await fs.readdir(this.baseDir)
    } catch {
      return 0
    }
    for (const s of sessions) {
      const dir = join(this.baseDir, s)
      let entries: string[]
      try {
        entries = await fs.readdir(dir)
      } catch {
        continue
      }
      for (const name of entries) {
        const p = join(dir, name)
        try {
          const st = await fs.stat(p)
          if (st.isFile() && now - st.mtimeMs > maxAgeMs) {
            await fs.unlink(p)
            removed++
          }
        } catch { /* raced */ }
      }
      try {
        const left = await fs.readdir(dir)
        if (left.length === 0) await fs.rmdir(dir)
      } catch { /* raced */ }
    }
    return removed
  }

  private sessionDir(sessionId: string): string {
    return join(this.baseDir, safeDirName(sessionId))
  }
}

/** Convenience path helper for messages: keep only the file name. */
export function spillFileName(locator: string): string {
  return basename(locator)
}

/** Convenience path helper: the directory a locator lives in. */
export function spillDir(locator: string): string {
  return dirname(locator)
}
