import { describe, it, expect, beforeEach, vi } from 'vitest'
import { filterSlashCommands, buildSlashPrompt, SLASH_COMMANDS, getSkillSlashCommands, getAllSlashCommands } from '@/services/commands/slashCommands'

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

  it('filters a custom source array when provided', () => {
    const custom = [{ id: 'x', name: 'alpha', description: 'first', template: 't' }]
    expect(filterSlashCommands('', custom)).toHaveLength(1)
    expect(filterSlashCommands('alp', custom).map((c) => c.id)).toEqual(['x'])
    expect(filterSlashCommands('zzz', custom)).toHaveLength(0)
    // Defaults to the built-in list when the source is omitted
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

describe('skill-derived slash commands', () => {
  const root = 'C:/workspace'
  const mockApi = {
    listDir: vi.fn(async (dir: string) => {
      if (dir === `${root}/skills`) return [{ name: 'code-review', isDirectory: true, isHidden: false }]
      if (dir === `${root}/.claude/skills`) return []
      if (dir === `${root}/.ourcode/skills`) return []
      return []
    }),
    readFile: vi.fn(async (path: string) => {
      const files: Record<string, string> = {
        [`${root}/skills/code-review/SKILL.md`]: '---\nname: code-review\ndescription: 代码审查\n---\n# 正文\n步骤一\n',
      }
      return { content: files[path] || '', encoding: 'utf-8' }
    }),
    stat: vi.fn(async () => ({ size: 1, isFile: true, isDirectory: false, createdAt: 1, modifiedAt: 1000 })),
    getPath: vi.fn(async () => 'C:/userData'),
  }

  beforeEach(() => {
    vi.stubGlobal('window', { electronAPI: mockApi })
    vi.resetModules()
  })

  it('derives one /name command per discovered skill', async () => {
    const cmds = await getSkillSlashCommands(root)
    expect(cmds).toHaveLength(1)
    const [cmd] = cmds
    expect(cmd.id).toBe('skill-code-review')
    expect(cmd.name).toBe('code-review')
    expect(cmd.description).toContain('代码审查')
  })

  it('skill templates instruct loading skill__<name> before acting', async () => {
    const [cmd] = await getSkillSlashCommands(root)
    const prompt = buildSlashPrompt(cmd, { selection: '', file: '/a/b.ts', language: 'ts' })
    expect(prompt).toContain('skill__code-review')
    expect(prompt).not.toContain('{{selection}}')
    expect(prompt).not.toContain('{{file}}')
  })

  it('getAllSlashCommands merges static and skill commands without duplication', async () => {
    const all = await getAllSlashCommands(root)
    expect(all.length).toBe(SLASH_COMMANDS.length + 1)
    const ids = new Set(all.map((c) => c.id))
    expect(ids.size).toBe(all.length)
    expect(ids.has('skill-code-review')).toBe(true)
    expect(ids.has('explain')).toBe(true)
  })
})
