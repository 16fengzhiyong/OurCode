import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  readdir,
  stat as fsStat,
  mkdir,
  rename as fsRename,
  unlink,
  rm,
  copyFile as fsCopyFile,
  cp,
} from 'fs/promises'
import { join } from 'path'
import { watch, FSWatcher } from 'chokidar'
import * as chardet from 'chardet'
import * as iconv from 'iconv-lite'
import { FileEntry, FileStat } from '../../shared/types'

export class FileSystemService {
  private watchers: Map<string, FSWatcher> = new Map()

  async readFile(filePath: string): Promise<{ content: string; encoding: string }> {
    const buffer = await fsReadFile(filePath)
    const detectedEncoding = chardet.detect(buffer) || 'utf-8'
    const encoding = this.normalizeEncoding(detectedEncoding)
    const content = iconv.decode(buffer, encoding)
    return { content, encoding }
  }

  async writeFile(filePath: string, content: string, encoding: string = 'utf-8'): Promise<void> {
    const normalizedEncoding = this.normalizeEncoding(encoding)
    const buffer = iconv.encode(content, normalizedEncoding)
    await fsWriteFile(filePath, buffer)
  }

  async listDir(dirPath: string): Promise<FileEntry[]> {
    const entries = await readdir(dirPath, { withFileTypes: true })
    const result: FileEntry[] = []

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      const isHidden = entry.name.startsWith('.')

      try {
        const stats = await fsStat(fullPath)
        result.push({
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          isHidden,
          size: entry.isFile() ? stats.size : undefined,
          modifiedAt: stats.mtimeMs,
        })
      } catch {
        result.push({
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          isHidden,
        })
      }
    }

    // Sort: directories first, then by name
    return result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  }

  async createFile(filePath: string): Promise<void> {
    await fsWriteFile(filePath, '', 'utf-8')
  }

  async createDir(dirPath: string): Promise<void> {
    await mkdir(dirPath, { recursive: true })
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await fsRename(oldPath, newPath)
  }

  async delete(filePath: string): Promise<void> {
    const stats = await fsStat(filePath)
    if (stats.isDirectory()) {
      await rm(filePath, { recursive: true, force: true })
    } else {
      await unlink(filePath)
    }
  }

  async copy(src: string, dest: string): Promise<void> {
    const stats = await fsStat(src)
    if (stats.isDirectory()) {
      await cp(src, dest, { recursive: true })
    } else {
      await fsCopyFile(src, dest)
    }
  }

  async move(src: string, dest: string): Promise<void> {
    await fsRename(src, dest)
  }

  async stat(filePath: string): Promise<FileStat> {
    const stats = await fsStat(filePath)
    return {
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      createdAt: stats.birthtimeMs,
      modifiedAt: stats.mtimeMs,
    }
  }

  watch(dirPath: string, onChange: (path: string) => void): void {
    if (this.watchers.has(dirPath)) {
      return
    }

    const watcher = watch(dirPath, {
      ignored: /(^|[/\\])\../,
      persistent: true,
      ignoreInitial: true,
      depth: 10,
    })

    watcher.on('change', (path) => onChange(path))
    watcher.on('add', (path) => onChange(path))
    watcher.on('unlink', (path) => onChange(path))

    this.watchers.set(dirPath, watcher)
  }

  unwatch(dirPath: string): void {
    const watcher = this.watchers.get(dirPath)
    if (watcher) {
      watcher.close()
      this.watchers.delete(dirPath)
    }
  }

  unwatchAll(): void {
    for (const [, watcher] of this.watchers) {
      watcher.close()
    }
    this.watchers.clear()
  }

  private normalizeEncoding(encoding: string): string {
    const lower = encoding.toLowerCase()
    if (lower === 'gb2312' || lower === 'gbk' || lower === 'gb18030') {
      return 'gbk'
    }
    if (lower.startsWith('utf-8') || lower === 'utf8') {
      return 'utf-8'
    }
    if (lower === 'ascii') {
      return 'utf-8'
    }
    return lower
  }
}
