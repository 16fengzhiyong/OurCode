import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm, readdir, readFile as fsReadFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as iconv from 'iconv-lite'
import { FileSystemService } from '../services/file-system'

describe('FileSystemService.readFile (large-file safe encoding detection)', () => {
  let service: FileSystemService
  let dir: string

  beforeEach(async () => {
    service = new FileSystemService()
    dir = await mkdtemp(join(tmpdir(), 'fs-test-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const writeFixture = async (name: string, buffer: Buffer): Promise<string> => {
    const filePath = join(dir, name)
    await writeFile(filePath, buffer)
    return filePath
  }

  it('reads a UTF-8 file', async () => {
    const text = 'CREATE TABLE users (id INT); -- 测试中文注释\n'
    const filePath = await writeFixture('a.sql', iconv.encode(text, 'utf-8'))
    const { content, encoding } = await service.readFile(filePath)
    expect(encoding).toBe('utf-8')
    expect(content).toBe(text)
  })

  it('reads a UTF-8 file with BOM', async () => {
    const text = 'SELECT 1;'
    const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), iconv.encode(text, 'utf-8')])
    const filePath = await writeFixture('bom.sql', buffer)
    const { content, encoding } = await service.readFile(filePath)
    expect(encoding).toBe('utf-8')
    expect(content).toBe(text) // BOM is stripped by iconv-lite
  })

  it('reads a UTF-16LE file with BOM', async () => {
    const text = 'SELECT "测试数据";'
    const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(text, 'utf-16le')])
    const filePath = await writeFixture('u16.sql', buffer)
    const { content, encoding } = await service.readFile(filePath)
    expect(encoding).toBe('utf-16le')
    expect(content).toBe(text)
  })

  it('detects BOM-less UTF-16LE via the zero-byte heuristic', async () => {
    // chardet mislabels ASCII-dominant BOM-less UTF-16 as UTF-8; the heuristic wins
    const text = 'SELECT "id", "name", "email" FROM users; -- plain ASCII in UTF-16'
    const filePath = await writeFixture('u16-nobom.sql', iconv.encode(text, 'utf-16le'))
    const { content, encoding } = await service.readFile(filePath)
    expect(encoding).toBe('utf-16le')
    expect(content).toBe(text)
  })

  it('opens a binary file without crashing and without a garbage encoding guess', async () => {
    // PNG header + random bytes contain zero bytes → treated as binary, decoded lossily as UTF-8
    const binary = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]),
      Buffer.alloc(64, 0x0a),
    ])
    const filePath = await writeFixture('img.bin', binary)
    const { content, encoding } = await service.readFile(filePath)
    expect(encoding).toBe('utf-8') // no chardet guess on binary
    expect(typeof content).toBe('string')
  })

  it('reads a GBK file', async () => {
    const text = '这是中文注释：需求分析。'
    const filePath = await writeFixture('gbk.sql', iconv.encode(text, 'gbk'))
    const { content, encoding } = await service.readFile(filePath)
    expect(encoding).toBe('gbk')
    expect(content).toBe(text)
  })

  it('detects GBK in a large file whose first 256KB is pure ASCII', async () => {
    // ASCII header large enough to exceed the detection sample window
    const asciiHead = Buffer.from('-- "SQL dump" header\n'.repeat(30000)) // ~600 KB ASCII
    const gbkTail = iconv.encode('尾部中文注释内容。'.repeat(2000), 'gbk')
    const filePath = await writeFixture('big-mixed.sql', Buffer.concat([asciiHead, gbkTail]))
    const { content, encoding } = await service.readFile(filePath)
    expect(encoding).toBe('gbk')
    expect(content.endsWith('尾部中文注释内容。')).toBe(true)
  })

  it('preserves ASCII content of a large ASCII-only file', async () => {
    const ascii = '-- pure ascii line\n'.repeat(30000)
    const filePath = await writeFixture('big-ascii.sql', iconv.encode(ascii, 'ascii'))
    const { content } = await service.readFile(filePath)
    expect(content).toBe(ascii)
  })

  it('writes atomically via temp file + rename and leaves no temp file behind', async () => {
    const filePath = await writeFixture('atomic.txt', iconv.encode('before', 'utf-8'))
    await service.writeFile(filePath, 'after', 'utf-8')
    const { content } = await service.readFile(filePath)
    expect(content).toBe('after')
    const files = await readdir(dir)
    expect(files).toEqual(['atomic.txt'])
  })

  it('keeps the original file intact when the write fails', async () => {
    const filePath = await writeFixture('keep.txt', iconv.encode('original', 'utf-8'))
    // writing into a directory path must fail, and must not clobber the original
    await expect(service.writeFile(join(dir, 'keep.txt', 'sub'), 'x', 'utf-8')).rejects.toThrow()
    const { content } = await service.readFile(filePath)
    expect(content).toBe('original')
  })

  it('preserves the byte-order mark when saving a BOM file', async () => {
    const text = 'SELECT 1; -- 测试'
    const filePath = await writeFixture('bom-roundtrip.sql',
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), iconv.encode(text, 'utf-8')]))

    const r1 = await service.readFile(filePath)
    expect(r1.encoding).toBe('utf-8')
    expect(r1.hasBom).toBe(true)
    expect(r1.content).toBe(text)

    // Re-saving with hasBom keeps the BOM; without it the BOM is not added
    await service.writeFile(filePath, text + '\n-- more', 'utf-8', true)
    let bytes = await fsReadFile(filePath)
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect((await service.readFile(filePath)).content).toBe(text + '\n-- more')

    await service.writeFile(filePath, text, 'utf-8', false)
    bytes = await fsReadFile(filePath)
    expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf])
  })

  it('streams a multi-chunk UTF-8 file identically to a whole read', async () => {
    const text = 'CREATE TABLE t (id INT); -- 测试\n'.repeat(60000) // > 1 MB, spans chunks
    const filePath = await writeFixture('stream-big.sql', iconv.encode(text, 'utf-8'))

    const stream = await service.openStream(filePath)
    expect(stream.totalBytes).toBeGreaterThan(1024 * 1024)
    let out = stream.chunk
    for (;;) {
      const res = await service.readNext(stream.id)
      if (!res) break
      out += res.chunk
      if (res.done) break
    }
    expect(out).toBe(text)
  })

  it('streams a multi-chunk GBK file correctly across chunk boundaries', async () => {
    const text = '这是中文内容：'.repeat(80000) // > 1 MB of double-byte GBK
    const filePath = await writeFixture('stream-gbk.sql', iconv.encode(text, 'gbk'))

    const stream = await service.openStream(filePath)
    expect(stream.encoding).toBe('gbk')
    let out = stream.chunk
    for (;;) {
      const res = await service.readNext(stream.id)
      if (!res) break
      out += res.chunk
      if (res.done) break
    }
    expect(out).toBe(text)
  })

  it('aborts an in-progress stream', async () => {
    const filePath = await writeFixture('abort.txt', iconv.encode('x'.repeat(5 * 1024 * 1024), 'utf-8'))
    const stream = await service.openStream(filePath)
    await service.readNext(stream.id)
    await service.closeStream(stream.id)
    expect(await service.readNext(stream.id)).toBeNull()
  })
})
