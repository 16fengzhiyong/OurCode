import { describe, it, expect } from 'vitest'
import { filterSlashCommands, buildSlashPrompt, SLASH_COMMANDS } from '@/services/commands/slashCommands'

describe('slashCommands', () => {
  it('registers a set of built-in commands', () => {
    expect(SLASH_COMMANDS.length).toBeGreaterThanOrEqual(5)
    const ids = new Set(SLASH_COMMANDS.map((c) => c.id))
    expect(ids.size).toBe(SLASH_COMMANDS.length)
  })

  it('filters by name prefix', () => {
    expect(filterSlashCommands('tes').map((c) => c.id)).toContain('test')
    expect(filterSlashCommands('explain').map((c) => c.id)).toEqual(['explain'])
  })

  it('returns all commands for an empty query', () => {
    expect(filterSlashCommands('')).toHaveLength(SLASH_COMMANDS.length)
  })

  it('builds a prompt from the template with context', () => {
    const cmd = SLASH_COMMANDS.find((c) => c.id === 'explain')!
    const prompt = buildSlashPrompt(cmd, { selection: 'const x = 1', file: '/a/b.ts', language: 'ts' })
    expect(prompt).toContain('const x = 1')
    expect(prompt).toContain('```ts')
    expect(prompt).not.toContain('{{selection}}')
    expect(prompt).not.toContain('{{language}}')
  })

  it('fills a placeholder with a hint when no selection exists', () => {
    const cmd = SLASH_COMMANDS.find((c) => c.id === 'review')!
    const prompt = buildSlashPrompt(cmd, { selection: '', file: '', language: '' })
    expect(prompt).not.toContain('{{selection}}')
  })
})
