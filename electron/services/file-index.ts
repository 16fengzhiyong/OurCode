import { basename } from 'path'
import picomatch from 'picomatch'
import { FileSystemService } from './file-system'
import type { FileEntry } from '../../shared/types'

/**
 * FileIndexService — 方案 B：内存增量代码库索引（Cursor 式检索）。
 *
 * 对每个已监听（watched）的项目根维护一个内存索引：
 *  - 完整文件清单（任意扩展名）→ 文件名搜索（@ 引用 / search:files）毫秒级
 *  - 源码文件内容（行数组）→ 内容关键词搜索（search:inFiles）毫秒级
 *
 * 由 fs:watch（chokidar）回调增量更新：单个文件改动原地刷新该文件，事件
 * 风暴（整目录 checkout / 批量操作）去抖后整体重建。索引是 best-effort：
 * 只有 watched 的根才会用内存索引提供服务；超预算（limited）或未监听
 * 的根回退给 main.ts 里的 ripgrep / Node 遍历（search:inFiles handler 的
 * 调用链：索引 → rg → 遍历）。
 */

/** 内容索引只索引这些源码扩展名（与 renderer context.ts 的检索口径一致） */
export const SOURCE_EXTENSIONS_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|c|cpp|h|hpp|cs|rb|php|swift|vue|svelte|html|css|scss|json|yaml|yml|sql|sh|md|toml|ini)$/

const DEFAULT_EXCLUDE_FOLDERS = ['node_modules', '.git', 'dist', 'build', 'out']
/** 索引跳过超大文件（rg / 遍历会兜底处理它们） */
const MAX_INDEX_FILE_BYTES = 5 * 1024 * 1024
/** 内容索引内存预算：达到后停止读取内容（文件清单仍是完整的，只影响内容搜索） */
const INDEX_BUDGET_BYTES = 64 * 1024 * 1024
/** 1 秒内超过该数量的事件视为「风暴」，整根重建而非逐文件更新 */
const BURST_THRESHOLD = 20
const BURST_WINDOW_MS = 1000
/** 风暴重建去抖窗口 */
const REBUILD_DEBOUNCE_MS = 400
/** 同时保留的索引根数量上限（LRU 淘汰，防长会话里切项目把内存撑爆） */
const MAX_ROOTS = 8

/**
 * 路径规范化：统一分隔符为 `/`、去尾分隔符、小写。Windows 下 `\` 与 `/`
 * 混用且大小写不敏感，若 `files` 的 key 用 `entry.path.toLowerCase()` 而查询
 * 用 `root.toLowerCase()`，分隔符不一致会导致单文件内容搜索 miss。所有以路径
 * 作 Map key / 前缀比较的地方都必须过这个函数，保证存取口径一致。
 */
function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export interface IndexedContentHit {
  filePath: string
  fileName: string
  lineNumber: number
  lineContent: string
  matchStart: number
  matchEnd: number
}

interface IndexedFile {
  abs: string
  rel: string
  size: number
  mtimeMs: number
  /** 未超预算时填充源码文件的行；非源码 / 超大文件 / 读取失败为 null */
  lines: string[] | null
}

interface RootIndex {
  root: string
  files: Map<string, IndexedFile>
  listReady: boolean
  contentReady: boolean
  limited: boolean
  watched: boolean
  building: Promise<void> | null
  rebuildTimer: ReturnType<typeof setTimeout> | null
  burstCount: number
  burstSince: number
  lastUsed: number
}

export class FileIndexService {
  private readonly indexes = new Map<string, RootIndex>()

  constructor(private readonly fs: FileSystemService) {}

  private key(root: string): string {
    return normPath(root)
  }

  private isUnder(root: string, p: string): boolean {
    const r = normPath(root)
    const path = normPath(p)
    return path === r || path.startsWith(r + '/')
  }

  /** 标记根已监听（fs:watch 时调用）并预热索引 */
  markWatched(root: string): void {
    const idx = this.getOrCreate(root)
    idx.watched = true
    this.ensureIndex(root).catch(() => { /* 索引失败不阻塞 watcher */ })
  }

  ensureIndex(root: string): Promise<void> {
    const idx = this.getOrCreate(root)
    idx.lastUsed = Date.now()
    if (idx.building) return idx.building
    if (idx.listReady) return Promise.resolve()
    idx.building = this.build(idx).finally(() => { idx!.building = null })
    this.prune()
    return idx.building
  }

  private getOrCreate(root: string): RootIndex {
    const k = this.key(root)
    const existing = this.indexes.get(k)
    if (existing) return existing
    const idx: RootIndex = {
      root,
      files: new Map(),
      listReady: false,
      contentReady: false,
      limited: false,
      watched: false,
      building: null,
      rebuildTimer: null,
      burstCount: 0,
      burstSince: 0,
      lastUsed: 0,
    }
    this.indexes.set(k, idx)
    return idx
  }

  /** 遍历 + 读取内容建索引（幂等，可安全地重复调用触发重建） */
  private async build(idx: RootIndex): Promise<void> {
    const files = new Map<string, IndexedFile>()
    let contentBytes = 0
    let limited = false
    const rootPrefix = idx.root.replace(/[\\/]+$/, '')
    await this.walkFiles(idx.root, rootPrefix, files, async (entry, rel) => {
      const file: IndexedFile = {
        abs: entry.path,
        rel,
        size: entry.size ?? 0,
        mtimeMs: entry.modifiedAt ?? 0,
        lines: null,
      }
      files.set(normPath(entry.path), file)
      // 预算耗尽后不再读任何文件内容（清单仍完整）
      if (limited) return
      if (!SOURCE_EXTENSIONS_RE.test(entry.name)) return
      if ((entry.size ?? 0) > MAX_INDEX_FILE_BYTES) return
      contentBytes += entry.size ?? 0
      if (contentBytes > INDEX_BUDGET_BYTES) {
        limited = true
        return
      }
      try {
        const { content } = await this.fs.readFile(entry.path)
        file.lines = content.split('\n')
      } catch {
        file.lines = null
      }
    })
    idx.files = files
    idx.listReady = true
    idx.contentReady = !limited
    idx.limited = limited
    idx.lastUsed = Date.now()
  }

  /** 递归遍历收集文件清单；onFile 按需读内容。entry.path 以 dir 为前缀，
   *  相对路径 = path.slice(rootPrefix.length)。 */
  private async walkFiles(
    dir: string,
    rootPrefix: string,
    files: Map<string, IndexedFile>,
    onFile: (entry: FileEntry, rel: string) => void | Promise<void>,
  ): Promise<void> {
    let entries: FileEntry[]
    try {
      entries = await this.fs.listDir(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isHidden) continue
      if (entry.isDirectory) {
        const dirName = entry.name || ''
        if (DEFAULT_EXCLUDE_FOLDERS.includes(dirName)) continue
        await this.walkFiles(entry.path, rootPrefix, files, onFile)
      } else {
        const rel = entry.path.slice(rootPrefix.length)
        await onFile(entry, rel)
      }
    }
  }

  /** 内容搜索。仅当「已监听 + 内容索引就绪 + 简单子串查询」时用内存索引；
   *  否则返回 null，让 main.ts 回退到 ripgrep / Node 遍历。 */
  async searchContent(
    root: string,
    query: string,
    opts: {
      filePattern?: string
      caseSensitive?: boolean
      wholeWord?: boolean
      regex?: boolean
      maxResults?: number
    } = {},
  ): Promise<IndexedContentHit[] | null> {
    // regex / wholeWord 语义不在内存索引里实现（交给 rg/遍历）
    if (opts.regex || opts.wholeWord) return null
    const maxResults = opts.maxResults ?? 500
    const lowerQuery = opts.caseSensitive ? query : query.toLowerCase()
    if (!lowerQuery) return []

    // 与 Node 遍历版一致：filePattern 按 basename 匹配（picomatch）
    const matcher = opts.filePattern
      ? picomatch(opts.filePattern.split(',').map((s) => s.trim()).filter(Boolean))
      : null

    // root 可能是单个文件（search_in_files 的 path 支持文件）：从包含它的已
    // 监听根索引里搜该文件；文件不在任何索引根下则返回 null 交给 rg/遍历。
    const idx = this.indexes.get(this.key(root))
    if (!idx) {
      const host = this.hostIndexOf(root)
      const file = host && host.watched && host.listReady ? host.files.get(normPath(root)) : undefined
      if (host && file && file.lines) {
        host.lastUsed = Date.now()
        if (matcher && !matcher(basename(file.abs))) return []
        return this.matchLines(file.abs, file.lines, opts.caseSensitive, lowerQuery, lowerQuery.length, maxResults)
      }
      return null
    }
    if (!idx.listReady || !idx.contentReady || !idx.watched) return null
    idx.lastUsed = Date.now()

    const hits: IndexedContentHit[] = []
    for (const file of idx.files.values()) {
      if (!file.lines) continue
      if (matcher && !matcher(basename(file.abs))) continue
      hits.push(...this.matchLines(file.abs, file.lines, opts.caseSensitive, lowerQuery, lowerQuery.length, maxResults - hits.length))
      if (hits.length >= maxResults) break
    }
    return hits
  }

  /** 对单个文件的行数组做子串匹配（小写化口径与目录模式一致） */
  private matchLines(
    filePath: string,
    lines: string[],
    caseSensitive: boolean | undefined,
    lowerQuery: string,
    qlen: number,
    maxResults: number,
  ): IndexedContentHit[] {
    const hits: IndexedContentHit[] = []
    for (let i = 0; i < lines.length && hits.length < maxResults; i++) {
      const raw = lines[i]
      const hay = caseSensitive ? raw : raw.toLowerCase()
      const at = hay.indexOf(lowerQuery)
      if (at === -1) continue
      hits.push({
        filePath,
        fileName: basename(filePath),
        lineNumber: i + 1,
        lineContent: raw.trim(),
        matchStart: at,
        matchEnd: at + qlen,
      })
    }
    return hits
  }

  /** 找到包含指定路径（可能是文件）的索引根，用于单文件内容搜索 */
  private hostIndexOf(p: string): RootIndex | undefined {
    for (const idx of this.indexes.values()) {
      if (this.isUnder(idx.root, p)) return idx
    }
    return undefined
  }

  /** 文件名搜索。同样只在已监听的根用内存清单，否则返回 null。 */
  async searchFiles(root: string, query: string, maxResults = 50): Promise<string[] | null> {
    const idx = this.indexes.get(this.key(root))
    if (!idx || !idx.listReady || !idx.watched) return null
    if (!query) return []
    idx.lastUsed = Date.now()

    // `*`/`?`/`[]` 等 glob 元字符 → 按文件名（basename）做 glob 匹配（如 *.ts）；
    // 否则按字面子串匹配完整路径（保持 @ 引用按目录名/文件名片段命中的行为）。
    const hasGlob = /[*?[\]{}()!]/.test(query)
    const matcher = hasGlob ? picomatch(query, { dot: true }) : null
    const lower = query.toLowerCase()

    const results: string[] = []
    for (const file of idx.files.values()) {
      const hit = hasGlob
        ? matcher!(basename(file.abs))
        : file.abs.toLowerCase().includes(lower)
      if (hit) {
        results.push(file.abs)
        if (results.length >= maxResults) break
      }
    }
    return results
  }

  /** fs:watch 回调转发 —— 单个文件改动原地更新，事件风暴去抖重建 */
  onFileChanged(path: string): void {
    for (const idx of this.indexes.values()) {
      if (!this.isUnder(idx.root, path)) continue
      const now = Date.now()
      if (now - idx.burstSince > BURST_WINDOW_MS) {
        idx.burstCount = 0
        idx.burstSince = now
      }
      idx.burstCount++
      if (idx.burstCount > BURST_THRESHOLD) {
        this.scheduleRebuild(idx)
        continue
      }
      void this.updateFile(idx, path)
    }
  }

  private async updateFile(idx: RootIndex, path: string): Promise<void> {
    let stat
    try {
      stat = await this.fs.stat(path)
    } catch {
      // 文件被删除
      idx.files.delete(normPath(path))
      return
    }
    if (stat.isDirectory) {
      // 目录级变化（新建/删除子目录）→ 重建
      this.scheduleRebuild(idx)
      return
    }
    const entry: IndexedFile = {
      abs: path,
      rel: '',
      size: stat.size,
      mtimeMs: stat.modifiedAt,
      lines: null,
    }
    if (SOURCE_EXTENSIONS_RE.test(basename(path)) && stat.size <= MAX_INDEX_FILE_BYTES) {
      try {
        const { content } = await this.fs.readFile(path)
        entry.lines = content.split('\n')
      } catch {
        entry.lines = null
      }
    }
    idx.files.set(normPath(path), entry)
  }

  private scheduleRebuild(idx: RootIndex): void {
    if (idx.rebuildTimer) clearTimeout(idx.rebuildTimer)
    idx.rebuildTimer = setTimeout(() => {
      idx.rebuildTimer = null
      idx.listReady = false
      idx.contentReady = false
      idx.building = this.build(idx).finally(() => { idx.building = null })
    }, REBUILD_DEBOUNCE_MS)
  }

  /** 释放不用的根索引（LRU），防止长时间切项目后内存膨胀 */
  private prune(): void {
    if (this.indexes.size <= MAX_ROOTS) return
    const sorted = [...this.indexes.values()].sort((a, b) => a.lastUsed - b.lastUsed)
    const excess = sorted.slice(0, this.indexes.size - MAX_ROOTS)
    for (const idx of excess) {
      if (idx.rebuildTimer) clearTimeout(idx.rebuildTimer)
      this.indexes.delete(this.key(idx.root))
    }
  }
}
