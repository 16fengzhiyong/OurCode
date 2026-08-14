import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SpillStore, SPILL_MAX_FILE_BYTES, SPILL_MAX_SESSION_BYTES } from '../services/spill-store'

let baseDir: string

beforeEach(async () => {
  baseDir = await fs.mkdtemp(join(tmpdir(), 'spill-test-'))
})

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true })
})

describe('SpillStore', () => {
  it('saves text under a per-session dir and returns a readable locator', async () => {
    const store = new SpillStore(baseDir)
    const locator = await store.save('sess-1', 'hello '.repeat(1000))
    expect(locator).toBeTruthy()
    expect(locator!.startsWith(baseDir)).toBe(true)
    expect(locator!.includes('sess-1')).toBe(true)
    expect(await fs.readFile(locator!, 'utf8')).toBe('hello '.repeat(1000))
  })

  it('writes with wx + 0600 (no clobber, private)', async () => {
    const store = new SpillStore(baseDir)
    const locator = (await store.save('s', 'data'))!
    // Windows does not honor POSIX modes (always reports 0o666) — only assert
    // the 0600 mode where the OS actually enforces it.
    if (process.platform !== 'win32') {
      const stat = await fs.stat(locator)
      expect(stat.mode & 0o777).toBe(0o600)
    }
    // A second save never collides with the first file
    const locator2 = (await store.save('s', 'data2'))!
    expect(locator2).not.toBe(locator)
  })

  it('returns null when the file exceeds the per-file cap', async () => {
    const store = new SpillStore(baseDir, { maxFileBytes: 16 })
    expect(await store.save('s', 'x'.repeat(32))).toBeNull()
  })

  it('returns null when the session quota is exhausted', async () => {
    const store = new SpillStore(baseDir, { maxSessionBytes: 40 })
    expect(await store.save('s', 'x'.repeat(30))).toBeTruthy()
    // 20 more would exceed the 40-byte session budget
    expect(await store.save('s', 'y'.repeat(20))).toBeNull()
  })

  it('isolates sessions from each other (per-session quota)', async () => {
    const store = new SpillStore(baseDir, { maxSessionBytes: 30 })
    expect(await store.save('a', 'x'.repeat(20))).toBeTruthy()
    expect(await store.save('b', 'y'.repeat(20))).toBeTruthy()
  })

  it('deleteSession removes the whole session dir', async () => {
    const store = new SpillStore(baseDir)
    await store.save('gone', 'data')
    await store.deleteSession('gone')
    await expect(fs.stat(join(baseDir, 'gone'))).rejects.toThrow()
  })

  it('sweep removes files older than the TTL and the empty dirs', async () => {
    const store = new SpillStore(baseDir)
    const oldLocator = (await store.save('old', 'old-data'))!
    const freshLocator = (await store.save('fresh', 'fresh-data'))!
    const old = new Date(Date.now() - 10_000)
    await fs.utimes(oldLocator, old, old)

    const removed = await store.sweep(1000)
    expect(removed).toBeGreaterThanOrEqual(1)
    await expect(fs.stat(oldLocator)).rejects.toThrow()
    await expect(fs.stat(freshLocator)).resolves.toBeTruthy()
    // the now-empty 'old' dir is removed, 'fresh' dir stays
    await expect(fs.stat(join(baseDir, 'old'))).rejects.toThrow()
    await expect(fs.stat(join(baseDir, 'fresh'))).resolves.toBeTruthy()
  })

  it('handles hostile session ids defensively', async () => {
    const store = new SpillStore(baseDir)
    const locator = await store.save('../../evil', 'x')
    expect(locator!.startsWith(baseDir)).toBe(true)
  })

  it('default caps are sane constants', () => {
    expect(SPILL_MAX_FILE_BYTES).toBe(10 * 1024 * 1024)
    expect(SPILL_MAX_SESSION_BYTES).toBe(100 * 1024 * 1024)
  })
})
