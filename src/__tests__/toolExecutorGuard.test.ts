import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ToolExecutor } from '../services/tools/ToolExecutor'
import { ToolCall } from '../services/tools/types'

/**
 * Read-before-write guard tests — write_file / edit_file / delete_file must
 * refuse to touch an existing file the session has never read, while new
 * files (and files the session read or just created) stay allowed.
 *
 * The tool helpers talk to `window.electronAPI`; an in-memory file system
 * stub keeps the tests hermetic.
 */
const fs = new Map<string, string>()
const electronAPI = {
  stat: vi.fn(async (p: string) => (fs.has(p) ? { path: p, modifiedAt: 0 } : null)),
  readFile: vi.fn(async (p: string) => {
    if (!fs.has(p)) throw new Error(`ENOENT: ${p}`)
    return { content: fs.get(p)! }
  }),
  writeFile: vi.fn(async (p: string, content: string) => {
    fs.set(p, content)
  }),
}

vi.stubGlobal('window', { electronAPI })

function call(executor: ToolExecutor, name: string, args: Record<string, unknown>, sessionId = 's1') {
  const tc: ToolCall = { id: 'c1', name, arguments: args }
  return executor.execute(tc, { sessionId })
}

describe('ToolExecutor read-before-write guard', () => {
  beforeEach(() => {
    fs.clear()
    fs.set('C:/proj/existing.ts', 'const a = 1\n')
  })

  it('blocks write_file to an existing file that was never read', async () => {
    const res = await call(new ToolExecutor(), 'write_file', { path: 'C:/proj/existing.ts', content: 'x' })
    expect(res.isError).toBe(true)
    expect(res.result).toContain('File has not been read yet')
    expect(fs.get('C:/proj/existing.ts')).toBe('const a = 1\n') // untouched
  })

  it('blocks edit_file and delete_file to an unread existing file', async () => {
    const executor = new ToolExecutor()
    const edit = await call(executor, 'edit_file', { path: 'C:/proj/existing.ts', oldText: 'a', newText: 'b' })
    expect(edit.isError).toBe(true)
    expect(edit.result).toContain('File has not been read yet')

    const del = await call(executor, 'delete_file', { path: 'C:/proj/existing.ts' })
    expect(del.isError).toBe(true)
    expect(del.result).toContain('File has not been read yet')
    expect(fs.has('C:/proj/existing.ts')).toBe(true)
  })

  it('allows write_file after read_file of the same path', async () => {
    const executor = new ToolExecutor()
    const read = await call(executor, 'read_file', { path: 'C:/proj/existing.ts' })
    expect(read.isError).toBeFalsy()

    const res = await call(executor, 'write_file', { path: 'C:/proj/existing.ts', content: 'const a = 2\n' })
    expect(res.isError).toBeFalsy()
    expect(fs.get('C:/proj/existing.ts')).toBe('const a = 2\n')
  })

  it('allows writing a new file without reading it, then editing it', async () => {
    const executor = new ToolExecutor()
    const write = await call(executor, 'write_file', { path: 'C:/proj/new.ts', content: 'hello' })
    expect(write.isError).toBeFalsy()
    expect(fs.get('C:/proj/new.ts')).toBe('hello')

    // The just-created file counts as known — editing it needs no separate read.
    const edit = await call(executor, 'edit_file', { path: 'C:/proj/new.ts', oldText: 'hello', newText: 'world' })
    expect(edit.isError).toBeFalsy()
    expect(fs.get('C:/proj/new.ts')).toBe('world')
  })

  it('keeps read-tracking isolated between sessions', async () => {
    const executor = new ToolExecutor()
    await call(executor, 'read_file', { path: 'C:/proj/existing.ts' }, 'session-a')

    // Another session never read it → still blocked.
    const res = await call(executor, 'write_file', { path: 'C:/proj/existing.ts', content: 'x' }, 'session-b')
    expect(res.isError).toBe(true)
    expect(res.result).toContain('File has not been read yet')
  })
})
