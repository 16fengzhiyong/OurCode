/**
 * Hot-exit backups: unsaved editor buffers are periodically mirrored to
 * <userData>/backups so a crash or force-quit never loses work (VS Code-style
 * "hot exit"). A backup is written when a file becomes dirty, removed when it
 * is saved or closed, and listed/restored on next launch.
 *
 * Each backup is a `<sha256-of-path>.bak` file plus a `index.json` mapping
 * those hashes back to the original absolute path + encoding. The hash keeps
 * arbitrary paths out of the file name on disk.
 */
import { promises as fs } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'

export interface BackupEntry {
  filePath: string
  encoding: string
  hasBom: boolean
  size: number
  mtime: number
}

export class BackupService {
  private root: string
  private indexFile: string
  private indexCache: Map<string, BackupEntry> | null = null

  constructor(backupRoot: string) {
    this.root = backupRoot
    this.indexFile = join(backupRoot, 'index.json')
  }

  private keyOf(filePath: string): string {
    return createHash('sha256').update(filePath).digest('hex')
  }

  private backupPath(filePath: string): string {
    return join(this.root, `${this.keyOf(filePath)}.bak`)
  }

  private async loadIndex(): Promise<Map<string, BackupEntry>> {
    if (this.indexCache) return this.indexCache
    const map = new Map<string, BackupEntry>()
    try {
      const raw = await fs.readFile(this.indexFile, 'utf-8')
      const entries = JSON.parse(raw) as BackupEntry[]
      for (const e of entries) map.set(this.keyOf(e.filePath), e)
    } catch {
      // No index yet
    }
    this.indexCache = map
    return map
  }

  private async persistIndex(): Promise<void> {
    if (!this.indexCache) return
    await fs.mkdir(this.root, { recursive: true })
    const entries = Array.from(this.indexCache.values())
    await fs.writeFile(this.indexFile, JSON.stringify(entries, null, 2), 'utf-8')
  }

  /** Write (or refresh) the backup for a dirty file. */
  async save(filePath: string, content: string, encoding: string, hasBom: boolean): Promise<void> {
    await fs.mkdir(this.root, { recursive: true })
    const buf = Buffer.from(content, 'utf-8')
    await fs.writeFile(this.backupPath(filePath), buf)
    const index = await this.loadIndex()
    index.set(this.keyOf(filePath), {
      filePath,
      encoding,
      hasBom,
      size: buf.byteLength,
      mtime: Date.now(),
    })
    await this.persistIndex()
  }

  /** All backup entries, newest first. */
  async list(): Promise<BackupEntry[]> {
    const index = await this.loadIndex()
    return Array.from(index.values()).sort((a, b) => b.mtime - a.mtime)
  }

  /** Read a backup back (for restore). Returns null when none exists. */
  async read(filePath: string): Promise<{ content: string; encoding: string; hasBom: boolean } | null> {
    const index = await this.loadIndex()
    const entry = index.get(this.keyOf(filePath))
    if (!entry) return null
    try {
      const buf = await fs.readFile(this.backupPath(filePath))
      return { content: buf.toString('utf-8'), encoding: entry.encoding, hasBom: entry.hasBom }
    } catch {
      return null
    }
  }

  /** Remove the backup for a file (after a save or a discard). */
  async delete(filePath: string): Promise<void> {
    const index = await this.loadIndex()
    const key = this.keyOf(filePath)
    if (index.delete(key)) {
      await fs.rm(this.backupPath(filePath), { force: true }).catch(() => {})
      await this.persistIndex()
    }
  }

  /** Remove every backup (e.g. user chose "discard all" on restart). */
  async clearAll(): Promise<void> {
    this.indexCache = new Map()
    await fs.rm(this.root, { recursive: true, force: true }).catch(() => {})
    // Leave an empty dir so subsequent saves (and this test) find it present
    await fs.mkdir(this.root, { recursive: true })
  }
}
