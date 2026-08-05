import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import { BackupService } from '../services/backup'

describe('BackupService (hot exit)', () => {
  let root: string
  let service: BackupService

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'backup-test-'))
    service = new BackupService(join(root, 'backups'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('writes a backup and lists it with metadata', async () => {
    await service.save('C:/work/src/main.ts', 'console.log(1);', 'utf-8', false)
    const entries = await service.list()
    expect(entries).toHaveLength(1)
    expect(entries[0].filePath).toBe('C:/work/src/main.ts')
    expect(entries[0].encoding).toBe('utf-8')
    expect(entries[0].size).toBeGreaterThan(0)
    expect(entries[0].mtime).toBeGreaterThan(0)
  })

  it('round-trips content through read()', async () => {
    await service.save('/tmp/a.txt', '你好 world\n', 'gbk', true)
    const data = await service.read('/tmp/a.txt')
    expect(data).not.toBeNull()
    expect(data!.content).toBe('你好 world\n')
    expect(data!.encoding).toBe('gbk')
    expect(data!.hasBom).toBe(true)
  })

  it('returns null for a path with no backup', async () => {
    expect(await service.read('/tmp/nope.txt')).toBeNull()
  })

  it('lists newest first', async () => {
    await service.save('/tmp/old.txt', 'old', 'utf-8', false)
    await new Promise((r) => setTimeout(r, 10))
    await service.save('/tmp/new.txt', 'new', 'utf-8', false)
    const entries = await service.list()
    expect(entries.map((e) => e.filePath)).toEqual(['/tmp/new.txt', '/tmp/old.txt'])
  })

  it('delete() removes the backup and its index entry', async () => {
    await service.save('/tmp/del.txt', 'x', 'utf-8', false)
    await service.delete('/tmp/del.txt')
    expect(await service.list()).toHaveLength(0)
    expect(await service.read('/tmp/del.txt')).toBeNull()
  })

  it('stores backups as hashed .bak files (no raw paths on disk)', async () => {
    await service.save('C:/weird [path] \\ x.txt', 'data', 'utf-8', false)
    const files = await readdir(join(root, 'backups'))
    // index.json + one .bak with a hex hash name
    expect(files.filter((f) => f.endsWith('.bak'))).toHaveLength(1)
    expect(files.some((f) => f.includes('weird'))).toBe(false)
  })

  it('clearAll() removes every backup', async () => {
    await service.save('/tmp/1.txt', 'a', 'utf-8', false)
    await service.save('/tmp/2.txt', 'b', 'utf-8', false)
    await service.clearAll()
    expect(await service.list()).toHaveLength(0)
    expect(await readdir(join(root, 'backups'))).toHaveLength(0)
  })

  it('keeps earlier backups when the index.json is missing (crash after write)', async () => {
    await service.save('/tmp/crash.txt', 'hello', 'utf-8', false)
    // Simulate the index being lost/corrupted (e.g. interrupted write)
    await rm(join(root, 'backups', 'index.json'), { force: true })
    const raw = await readFile(join(root, 'backups', `${createHash('sha256').update('/tmp/crash.txt').digest('hex')}.bak`), 'utf-8')
    expect(raw).toBe('hello')
  })
})
