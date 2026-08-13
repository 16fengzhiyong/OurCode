import { describe, it, expect, beforeEach, vi } from 'vitest'

// helpers.ts pulls in the context engine (skills/ignore) and the ui store —
// replace both with hermetic fakes so the module imports cleanly in Node.
vi.mock('../services/tools/context', () => ({
  loadIgnorePatterns: vi.fn(async () => {}),
  isIgnoredPath: vi.fn(() => false),
}))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: { getState: () => ({ rootPath: '' }) },
}))

import { multiEditFile, editFile, readMultipleFiles } from '../services/tools/helpers'

/** In-memory file system stub (same shape as toolExecutorGuard.test.ts) */
const fs = new Map<string, string>()
const electronAPI = {
  readFile: vi.fn(async (p: string) => {
    if (!fs.has(p)) throw new Error(`ENOENT: ${p}`)
    return { content: fs.get(p)! }
  }),
  writeFile: vi.fn(async (p: string, content: string) => {
    fs.set(p, content)
  }),
}
vi.stubGlobal('window', { electronAPI })

describe('multiEditFile', () => {
  beforeEach(() => {
    fs.clear()
    fs.set('C:/proj/a.ts', 'const a = 1\n')
    fs.set('C:/proj/b.ts', 'const b = 2\n')
  })

  it('writes nothing when any oldText does not match (two-phase)', async () => {
    const res = await multiEditFile([
      { path: 'C:/proj/a.ts', oldText: 'a', newText: 'X' },
      { path: 'C:/proj/b.ts', oldText: 'NOPE', newText: 'Y' },
    ])
    expect(res).toContain('Error')
    expect(res).toContain('C:/proj/b.ts')
    // Both files untouched — the batch is all-or-nothing on validation
    expect(fs.get('C:/proj/a.ts')).toBe('const a = 1\n')
    expect(fs.get('C:/proj/b.ts')).toBe('const b = 2\n')
  })

  it('applies all edits when every oldText matches', async () => {
    const res = await multiEditFile([
      { path: 'C:/proj/a.ts', oldText: 'a', newText: 'X' },
      { path: 'C:/proj/b.ts', oldText: 'b', newText: 'Y' },
    ])
    expect(res).toContain('2 处')
    expect(fs.get('C:/proj/a.ts')).toBe('const X = 1\n')
    expect(fs.get('C:/proj/b.ts')).toBe('const Y = 2\n')
  })

  it('replaceAll replaces every occurrence', async () => {
    fs.set('C:/proj/c.ts', 'x x x')
    const res = await multiEditFile([{ path: 'C:/proj/c.ts', oldText: 'x', newText: 'y', replaceAll: true }])
    expect(res).toContain('1 处')
    expect(fs.get('C:/proj/c.ts')).toBe('y y y')
  })

  it('applies sequential edits on the same file against in-memory state', async () => {
    const res = await multiEditFile([
      { path: 'C:/proj/a.ts', oldText: 'const a', newText: 'const A' },
      { path: 'C:/proj/a.ts', oldText: 'const A', newText: 'let A' },
    ])
    expect(res).toContain('2 处')
    expect(fs.get('C:/proj/a.ts')).toBe('let A = 1\n')
  })

  it('rejects an empty edits array', async () => {
    const res = await multiEditFile([])
    expect(res).toContain('Error')
    expect(fs.get('C:/proj/a.ts')).toBe('const a = 1\n')
  })
})

describe('editFile replaceAll', () => {
  beforeEach(() => {
    fs.clear()
    fs.set('C:/proj/d.ts', 'foo foo bar')
  })

  it('replaces only the first occurrence by default', async () => {
    await editFile('C:/proj/d.ts', 'foo', 'baz')
    expect(fs.get('C:/proj/d.ts')).toBe('baz foo bar')
  })

  it('replaces every occurrence with replaceAll', async () => {
    await editFile('C:/proj/d.ts', 'foo', 'baz', true)
    expect(fs.get('C:/proj/d.ts')).toBe('baz baz bar')
  })
})

describe('readMultipleFiles', () => {
  beforeEach(() => {
    fs.clear()
    fs.set('C:/proj/a.ts', '1\n2\n3')
  })

  it('returns each file in a ==== path ==== section', async () => {
    fs.set('C:/proj/b.ts', 'x')
    const res = await readMultipleFiles(['C:/proj/a.ts', 'C:/proj/b.ts'])
    expect(res).toContain('===== C:/proj/a.ts =====')
    expect(res).toContain('===== C:/proj/b.ts =====')
    expect(res).toContain('1: 1')
  })

  it('reports a missing file inline without dropping the others', async () => {
    const res = await readMultipleFiles(['C:/proj/a.ts', 'C:/proj/missing.ts'])
    expect(res).toContain('===== C:/proj/a.ts =====')
    expect(res).toContain('===== C:/proj/missing.ts =====')
    expect(res).toContain('读取失败')
  })

  it('caps each file at 2000 lines', async () => {
    fs.set('C:/proj/big.ts', Array.from({ length: 2100 }, (_, i) => `line ${i}`).join('\n'))
    const res = await readMultipleFiles(['C:/proj/big.ts'])
    expect(res).toContain('2000: line 1999')
    expect(res).not.toContain('2001:')
  })

  it('rejects empty paths', async () => {
    const res = await readMultipleFiles([])
    expect(res).toContain('Error')
  })
})
