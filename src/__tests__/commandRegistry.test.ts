import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { registerCommand, unregisterCommand, executeCommand, getCommands, hasCommand } from '@/services/commands/commandRegistry'

describe('commandRegistry', () => {
  beforeEach(() => {
    // Fresh registry per test
    for (const cmd of getCommands()) unregisterCommand(cmd.id)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers and executes a command with args', () => {
    const run = vi.fn((a: number, b: number) => a + b)
    registerCommand({ id: 'test.add', title: 'Add', run })
    expect(executeCommand('test.add', 2, 3)).toBe(5)
    expect(run).toHaveBeenCalledWith(2, 3)
  })

  it('returns undefined and warns for unknown commands', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(executeCommand('does.not.exist')).toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  it('lists and detects commands', () => {
    registerCommand({ id: 'a', title: 'A', run: () => {} })
    registerCommand({ id: 'b', title: 'B', category: 'cat', run: () => {} })
    const ids = getCommands().map((c) => c.id)
    expect(ids).toContain('a')
    expect(ids).toContain('b')
    expect(hasCommand('a')).toBe(true)
    expect(hasCommand('nope')).toBe(false)
    expect(getCommands().find((c) => c.id === 'b')?.category).toBe('cat')
  })

  it('unregisters a command', () => {
    registerCommand({ id: 'tmp', title: 'Tmp', run: () => 1 })
    expect(hasCommand('tmp')).toBe(true)
    unregisterCommand('tmp')
    expect(hasCommand('tmp')).toBe(false)
  })

  it('last registration wins for duplicate ids', () => {
    registerCommand({ id: 'dup', title: 'First', run: () => 'first' })
    registerCommand({ id: 'dup', title: 'Second', run: () => 'second' })
    expect(executeCommand('dup')).toBe('second')
  })
})
