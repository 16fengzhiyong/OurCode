import { describe, it, expect, vi, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ToolExecutor, configureToolOutput } from '../services/tools'
import type { ToolCall } from '../services/tools/types'

/**
 * Spill end-to-end composition test — the executor side of the contract:
 * oversized tool output is NOT truncated-and-lost; the full text is handed to
 * spillSave (which the main-process SpillStore persists — covered by
 * spill-store.test.ts), and the result the model sees is a bounded preview that
 * carries the locator so read_file can page the full output back.
 */
const electronAPI = {
  shellExec: vi.fn(async () => ({ success: true, output: 'x'.repeat(300) })),
  spillSave: vi.fn(async (_sessionId: string, _text: string) => null),
  recordUsage: vi.fn(async () => {}),
}
vi.stubGlobal('window', { electronAPI })
vi.stubGlobal('dispatchEvent', () => {})

let spillDir: string

describe('spill (executor side)', () => {
  afterEach(async () => {
    configureToolOutput(() => ({}))
    vi.clearAllMocks()
    if (spillDir) await fs.rm(spillDir, { recursive: true, force: true }).catch(() => {})
  })

  it('persists the full output and returns a bounded preview with the locator', async () => {
    spillDir = await fs.mkdtemp(join(tmpdir(), 'spill-e2e-'))
    // Mimic the main-process SpillStore.save: persist the full text, return a path.
    electronAPI.spillSave.mockImplementation(async (sessionId: string, text: string) => {
      const p = join(spillDir, `${sessionId}.txt`)
      await fs.writeFile(p, text, 'utf8')
      return p
    })
    // Tiny budget so the 300-char output spills instead of staying inline.
    configureToolOutput(() => ({ maxChars: 100, maxLines: 1000 }))

    const executor = new ToolExecutor()
    const tc: ToolCall = { id: 'c1', name: 'run_command', arguments: { command: 'echo x' } }
    const res = await executor.execute(tc, { sessionId: 's1' })

    expect(res.isError).toBeFalsy()
    // The model sees a bounded preview, NOT the full 300 chars.
    expect(res.result.length).toBeLessThan(300)
    // The preview carries the locator so read_file can page the full output.
    expect(res.result).toContain(join(spillDir, 's1.txt'))
    // The executor handed the FULL text to spillSave (nothing truncated).
    expect(electronAPI.spillSave).toHaveBeenCalledWith('s1', 'x'.repeat(300))
    // And the persisted file at the locator contains the full original output.
    const full = await fs.readFile(join(spillDir, 's1.txt'), 'utf8')
    expect(full).toBe('x'.repeat(300))
  })

  it('falls back to plain truncation when spillSave is unavailable', async () => {
    configureToolOutput(() => ({ maxChars: 100, maxLines: 1000 }))
    electronAPI.spillSave.mockResolvedValue(null) // main refused (quota / error)

    const executor = new ToolExecutor()
    const tc: ToolCall = { id: 'c2', name: 'run_command', arguments: { command: 'echo x' } }
    const res = await executor.execute(tc, { sessionId: 's1' })

    expect(res.isError).toBeFalsy()
    expect(res.result.length).toBeLessThan(300)
    expect(res.result).not.toContain('.txt') // no locator — pure truncation notice
    expect(electronAPI.spillSave).toHaveBeenCalled()
  })
})
