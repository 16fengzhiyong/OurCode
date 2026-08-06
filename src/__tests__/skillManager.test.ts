import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  parseSkillFrontmatter,
  listSkills,
  buildSkillIndex,
  toSkillToolDefinitions,
  loadSkillContent,
} from '@/services/skills/skillManager'

/**
 * Skill Manager tests — a mocked workspace filesystem:
 *   .ourcode/skills/design/SKILL.md   (frontmatter: name/description)
 *   .claude/skills/review/skill.md    (no frontmatter → dir-name fallbacks)
 */
const root = 'C:/workspace'
const files: Record<string, string> = {
  'C:/workspace/.ourcode/skills/design/SKILL.md': [
    '---',
    'name: design',
    'description: 设计系统规范',
    '---',
    '# Design',
    '遵循设计系统的视觉规范。',
  ].join('\n'),
  'C:/workspace/.claude/skills/review/skill.md': '# Code Review\n逐行审查代码质量。',
}

const mockApi = {
  listDir: vi.fn(async (dir: string) => {
    if (dir === `${root}/.ourcode/skills`) return [{ name: 'design', isDirectory: true, isHidden: false }]
    if (dir === `${root}/.claude/skills`) return [{ name: 'review', isDirectory: true, isHidden: false }]
    if (dir === `${root}/skills`) return []
    return []
  }),
  readFile: vi.fn(async (path: string) => ({ content: files[path] || '', encoding: 'utf-8' })),
  stat: vi.fn(async () => ({ size: 1, isFile: true, isDirectory: false, createdAt: 1, modifiedAt: 1000 })),
  getPath: vi.fn(async () => 'C:/userData'),
}

beforeEach(() => {
  vi.stubGlobal('window', { electronAPI: mockApi })
})

describe('parseSkillFrontmatter', () => {
  it('parses name and description from frontmatter', () => {
    const { name, description, body } = parseSkillFrontmatter(
      '---\nname: foo\n  description: "Bar baz"\n---\nbody text',
      'fallback',
    )
    expect(name).toBe('foo')
    expect(description).toBe('Bar baz')
    expect(body).toContain('body text')
    expect(body).not.toContain('description:')
  })

  it('falls back to the directory name and first content line', () => {
    const { name, description } = parseSkillFrontmatter('# Heading\nFirst line here', 'my-skill')
    expect(name).toBe('my-skill')
    expect(description).toBe('First line here')
  })

  it('ignores non-name/description frontmatter keys', () => {
    const { name, description } = parseSkillFrontmatter('---\nversion: 2\nname: only-name\n---\nbody', 'x')
    expect(name).toBe('only-name')
    expect(description).toBe('body')
  })
})

describe('listSkills', () => {
  it('discovers skills from workspace dirs and parses metadata', async () => {
    const skills = await listSkills(true, root)
    expect(skills).toHaveLength(2)
    // Sorted by name
    expect(skills[0].name).toBe('design')
    expect(skills[1].name).toBe('review')
    const design = skills.find((s) => s.name === 'design')!
    expect(design.description).toBe('设计系统规范')
    expect(design.source).toBe('workspace')
    expect(design.content).toContain('# Design')
  })

  it('caches results until files change (mtime bump invalidates)', async () => {
    const a = await listSkills(false, root)
    const b = await listSkills(false, root)
    expect(b).toBe(a) // cached array identity
  })
})

describe('skill index + tool definitions', () => {
  it('builds a compact index block', async () => {
    const index = await buildSkillIndex(root)
    expect(index).toContain('design')
    expect(index).toContain('设计系统规范')
    expect(index).toContain('skill__')
  })

  it('exposes each skill as a skill__<name> dynamic tool', async () => {
    const defs = await toSkillToolDefinitions(true, root)
    const names = defs.map((d) => d.function.name)
    expect(names).toContain('skill__design')
    expect(names).toContain('skill__review')
  })

  it('loadSkillContent returns body without frontmatter, null for unknown', async () => {
    const content = await loadSkillContent('design', root)
    expect(content).toContain('# 技能: design')
    expect(content).toContain('遵循设计系统的视觉规范')
    expect(content).not.toContain('description:')
    expect(await loadSkillContent('nope', root)).toBeNull()
  })
})
