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
  open,
} from 'fs/promises'
import type { FileHandle } from 'fs/promises'
import { join, dirname, basename } from 'path'
import { watch, FSWatcher } from 'chokidar'
import * as chardet from 'chardet'
import * as iconv from 'iconv-lite'
import { FileEntry, FileStat, FileStreamStart, FileStreamChunk } from '../../shared/types'

/**
 * Encoding detection follows the same strategy as VS Code's text-file service
 * (`src/vs/workbench/services/textfile/common/encoding.ts`): BOM first, then a
 * cheap zero-byte heuristic for BOM-less UTF-16 / binary files, and only then a
 * *sampled* chardet guess. The sample is capped at 64 KB — the same cap VS Code
 * passes to jschardet (`AUTO_ENCODING_GUESS_MAX_BYTES = 512 * 128`) — so the
 * cost is constant regardless of file size. Previously chardet ran on the whole
 * buffer: ~3s for a 17 MB file, scaling linearly and blocking the main process.
 * Files read entirely in the app (editor, global search) go through here, so
 * this also keeps search fast on large files.
 */
const ZERO_BYTE_SCAN_LEN = 512 // bytes scanned by the UTF-16 / binary heuristic
const MIN_GUESS_BYTES = 8 // below this, chardet output is noise; default to utf-8
const ENCODING_SAMPLE_SIZE = 64 * 1024 // 64 KB, matches VS Code's guess cap

// Chunked streaming reads: the editor opens files via `openStream`/`readNext` so
// a huge file is decoded chunk by chunk instead of one whole-buffer pass. This
// bounds peak memory and lets the renderer keep the UI responsive while loading.
const STREAM_HEAD_SIZE = ENCODING_SAMPLE_SIZE // first chunk doubles as the detection sample
const STREAM_CHUNK_SIZE = 1024 * 1024 // 1 MB per subsequent chunk

/** Byte-order marks, keyed by the normalized encoding name. */
const BOM_BYTES: Record<string, Buffer> = {
  'utf-8': Buffer.from([0xef, 0xbb, 0xbf]),
  'utf-16le': Buffer.from([0xff, 0xfe]),
  'utf-16be': Buffer.from([0xfe, 0xff]),
}

interface StreamState {
  fd: FileHandle
  decoder: ReturnType<typeof iconv.getDecoder>
  offset: number
  size: number
}

export class FileSystemService {
  private watchers: Map<string, FSWatcher> = new Map()
  private streamSeq = 0
  private streams = new Map<number, StreamState>()

  async readFile(filePath: string): Promise<{ content: string; encoding: string; hasBom: boolean }> {
    const buffer = await fsReadFile(filePath)
    const { encoding, hasBom } = this.detectEncodingInfo(buffer)
    const content = iconv.decode(buffer, encoding)
    return { content, encoding, hasBom }
  }

  /**
   * Start a chunked read of a file. Returns the stream id, the detected
   * encoding/BOM and the already-decoded first chunk. The rest is pulled with
   * `readNext(id)` until it returns `done: true`.
   */
  async openStream(filePath: string): Promise<FileStreamStart> {
    const fd = await open(filePath, 'r')
    try {
      const size = (await fd.stat()).size
      const head = Buffer.alloc(STREAM_HEAD_SIZE)
      const { bytesRead } = await fd.read(head, 0, STREAM_HEAD_SIZE, 0)
      const headBytes = head.subarray(0, bytesRead)
      const { encoding, hasBom } = this.detectEncodingInfo(headBytes)
      const decoder = iconv.getDecoder(encoding)
      const id = ++this.streamSeq
      this.streams.set(id, { fd, decoder, offset: bytesRead, size })
      return { id, encoding, hasBom, totalBytes: size, chunk: decoder.write(headBytes) }
    } catch (error) {
      await fd.close()
      throw error
    }
  }

  /** Pull the next decoded chunk. Returns `null` for an unknown/closed stream. */
  async readNext(id: number): Promise<FileStreamChunk | null> {
    const s = this.streams.get(id)
    if (!s) return null
    if (s.offset >= s.size) {
      return this.finishStream(id, s)
    }
    const buf = Buffer.alloc(STREAM_CHUNK_SIZE)
    const { bytesRead } = await s.fd.read(buf, 0, STREAM_CHUNK_SIZE, s.offset)
    if (bytesRead <= 0) {
      return this.finishStream(id, s)
    }
    s.offset += bytesRead
    return { chunk: s.decoder.write(buf.subarray(0, bytesRead)), done: false }
  }

  /** Abort a stream early (e.g. the user cancelled the open). */
  async closeStream(id: number): Promise<void> {
    const s = this.streams.get(id)
    if (!s) return
    this.streams.delete(id)
    await s.fd.close()
  }

  private async finishStream(id: number, s: StreamState): Promise<FileStreamChunk> {
    this.streams.delete(id)
    await s.fd.close()
    // decoder.end() flushes any trailing partial multi-byte sequence
    return { chunk: s.decoder.end() ?? '', done: true }
  }

  /**
   * Detect the text encoding of a buffer (BOM, zero-byte heuristic, sampled
   * guess) and whether it started with a byte-order mark.
   */
  private detectEncodingInfo(buffer: Buffer): { encoding: string; hasBom: boolean } {
    // 1) BOM — unambiguous and cheaper than any guess
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      return { encoding: 'utf-8', hasBom: true }
    }
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
      return { encoding: 'utf-16le', hasBom: true }
    }
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
      return { encoding: 'utf-16be', hasBom: true }
    }

    // 2) zero-byte heuristic — BOM-less UTF-16 (which chardet mislabels as UTF-8)
    //    and binary files are decided here, before any guessing (same as VS Code)
    const byZeroBytes = this.detectUtf16OrBinary(buffer)
    if (byZeroBytes) return { encoding: byZeroBytes, hasBom: false }

    // 3) sampled chardet guess — constant cost, independent of file size
    if (buffer.length < MIN_GUESS_BYTES) return { encoding: 'utf-8', hasBom: false }

    let detected = chardet.detect(this.sampleAt(buffer, 0)) || 'utf-8'

    // A large file whose head is pure ASCII may still hold multibyte text further
    // in (e.g. an ASCII SQL header followed by Chinese comments). Cross-check the
    // middle and tail; prefer the first multibyte guess over a single-byte one.
    if (buffer.length > ENCODING_SAMPLE_SIZE && isSingleByteEncoding(detected)) {
      const offsets = [Math.floor(buffer.length / 2), Math.max(0, buffer.length - ENCODING_SAMPLE_SIZE)]
      for (const offset of offsets) {
        const candidate = chardet.detect(this.sampleAt(buffer, offset))
        if (candidate && !isSingleByteEncoding(candidate)) {
          detected = candidate
          break
        }
      }
    }

    return { encoding: this.normalizeEncoding(detected), hasBom: false }
  }

  private sampleAt(buffer: Buffer, offset: number): Buffer {
    return buffer.subarray(offset, offset + ENCODING_SAMPLE_SIZE)
  }

  /**
   * Scan the first bytes for zero-byte patterns (VS Code's
   * `detectEncodingFromBuffer`): consistent parity means UTF-16 LE/BE without a
   * BOM, any other zero-byte pattern means a binary file. Returns null for text
   * files (no zero bytes) so the caller falls through to chardet.
   */
  private detectUtf16OrBinary(buffer: Buffer): string | null {
    let couldBeUTF16LE = true // e.g. 0xAA 0x00
    let couldBeUTF16BE = true // e.g. 0x00 0xAA
    let containsZeroByte = false

    const len = Math.min(buffer.length, ZERO_BYTE_SCAN_LEN)
    for (let i = 0; i < len; i++) {
      const isEndian = i % 2 === 1
      const isZeroByte = buffer[i] === 0

      if (isZeroByte) containsZeroByte = true
      if (couldBeUTF16LE && (isEndian ? !isZeroByte : isZeroByte)) couldBeUTF16LE = false
      if (couldBeUTF16BE && (isEndian ? isZeroByte : !isZeroByte)) couldBeUTF16BE = false
      if (isZeroByte && !couldBeUTF16LE && !couldBeUTF16BE) break
    }

    if (containsZeroByte) {
      if (couldBeUTF16LE) return 'utf-16le'
      if (couldBeUTF16BE) return 'utf-16be'
      return 'utf-8' // binary file: decode lossily as UTF-8, skip the guess
    }
    return null
  }

  async writeFile(filePath: string, content: string, encoding: string = 'utf-8', hasBom = false): Promise<void> {
    const normalizedEncoding = this.normalizeEncoding(encoding)
    let buffer = iconv.encode(content, normalizedEncoding)
    // Preserve the original byte-order mark (VS Code does the same; stripping it
    // silently would change the file's encoding on save)
    const bom = BOM_BYTES[normalizedEncoding]
    if (hasBom && bom) {
      buffer = Buffer.concat([bom, buffer])
    }
    // Write to a temp sibling then rename, so a crash mid-write never corrupts
    // the original file (same strategy as VS Code's disk file service). The
    // dot-prefixed name is also ignored by the chokidar watcher.
    const tmpPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.tmp`)
    try {
      await fsWriteFile(tmpPath, buffer)
      await fsRename(tmpPath, filePath)
    } catch (error) {
      await rm(tmpPath, { force: true }).catch(() => {})
      throw error
    }
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

/** Single-byte encodings — a head sample that yields one of these may be
 *  masking multibyte text later in the file, so we cross-check the middle. */
function isSingleByteEncoding(encoding: string): boolean {
  return /^(ascii|iso-?8859-1|latin-?1|windows-125[0-9]|macroman|koi8-?r|ibm[0-9]+)$/i.test(encoding)
}
