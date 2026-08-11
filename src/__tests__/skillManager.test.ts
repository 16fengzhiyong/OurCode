import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  parseSkillFrontmatter,
  listSkills,
  listAllSkills,
  listImportableSkills,
  buildSkillIndex,
  toSkillToolDefinitions,
  loadSkillContent,
} from '@/services/skills/skillManager'
import { useUIStore } from '@/stores/uiStore'

/**
 * Skill Manager tests — a mocked workspace filesystem. Only OUR OWN dirs are
 * discovered (.ourcode/skills, skills, <userData>/skills); other platforms'
 * dirs (.claude/skills, .agents/skills, …) are import sources only.
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
}

const mockApi = {
  listDir: vi.fn(async (dir: string) => {
    if (dir === `${root}/.ourcode/skills`) return [{ name: 'design', isDirectory: true, isHidden: false }]
    return []
  }),
  readFile: vi.fn(async (path: string) => ({ content: files[path] || '', encoding: 'utf-8' })),
  stat: vi.fn(async () => ({ size: 1, isFile: true, isDirectory: false, createdAt: 1, modifiedAt: 1000 })),
  getPath: vi.fn(async (name: string) => (name === 'home' ? 'C:/Users/tester' : 'C:/userData')),
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

describe('listSkills (own dirs only)', () => {
  it('discovers skills from our own workspace dirs and parses metadata', async () => {
    const skills = await listSkills(true, root)
    expect(skills).toHaveLength(1)
    const design = skills[0]
    expect(design.name).toBe('design')
    expect(design.description).toBe('设计系统规范')
    expect(design.source).toBe('project')
    expect(design.projectPath).toBe(root)
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
  })

  it('loadSkillContent returns body without frontmatter, null for unknown', async () => {
    const content = await loadSkillContent('design', root)
    expect(content).toContain('# 技能: design')
    expect(content).toContain('遵循设计系统的视觉规范')
    expect(content).not.toContain('description:')
    expect(await loadSkillContent('nope', root)).toBeNull()
  })
})

describe('global vs project skills', () => {
  // Global skills live in <userData>/skills (getPath → C:/userData); the mock
  // also gives the project a same-named "design" skill to exercise precedence.
  const globalFiles: Record<string, string> = {
    'C:/userData/skills/base/SKILL.md': '---\nname: base\n---\n# Base\n全局基础技能',
    'C:/userData/skills/design/SKILL.md': '---\nname: design\ndescription: 全局 design\n---\n# Design global',
    'C:/workspace/.ourcode/skills/design/SKILL.md': '---\nname: design\ndescription: 设计系统规范\n---\n# Design\n项目技能',
  }

  beforeEach(() => {
    vi.stubGlobal('window', {
      electronAPI: {
        listDir: async (dir: string) => {
          if (dir === 'C:/userData/skills') {
            return [
              { name: 'base', isDirectory: true, isHidden: false },
              { name: 'design', isDirectory: true, isHidden: false },
            ]
          }
          if (dir === `${root}/.ourcode/skills`) return [{ name: 'design', isDirectory: true, isHidden: false }]
          return []
        },
        readFile: async (path: string) => ({ content: globalFiles[path] || '', encoding: 'utf-8' }),
        stat: async () => ({ size: 1, isFile: true, isDirectory: false, createdAt: 1, modifiedAt: 1000 }),
        getPath: async (name: string) => (name === 'home' ? 'C:/Users/tester' : 'C:/userData'),
      },
    })
    useUIStore.setState({ recentProjects: [root] })
  })

  it('listSkills: a project skill shadows the same-named global skill', async () => {
    const skills = await listSkills(true, root)
    expect(skills.map((s) => s.name).sort()).toEqual(['base', 'design'])
    const design = skills.find((s) => s.name === 'design')!
    expect(design.source).toBe('project')
    expect(design.projectPath).toBe(root)
    // The shadowed global "design" is gone from the agent-facing list
    expect(skills.filter((s) => s.name === 'design')).toHaveLength(1)
    // The global-only skill is still present
    const base = skills.find((s) => s.name === 'base')!
    expect(base.source).toBe('global')
  })

  it('listAllSkills: shows both global and project skills (no cross-source dedup)', async () => {
    const skills = await listAllSkills(true)
    const design = skills.filter((s) => s.name === 'design')
    expect(design).toHaveLength(2)
    expect(design.some((s) => s.source === 'global')).toBe(true)
    expect(design.some((s) => s.source === 'project' && s.projectPath === root)).toBe(true)
    expect(skills.map((s) => s.name).sort()).toEqual(['base', 'design', 'design'])
  })
})

describe('external platform dirs: import sources, never auto-discovered', () => {
  // The same project carries skills from several platforms. Only the
  // .ourcode/skills one is usable; .claude/.agents/.zcode are import sources.
  const files: Record<string, string> = {
    'C:/workspace/.ourcode/skills/design/SKILL.md': '---\nname: design\ndescription: 自家 design\n---\n# Design\n自家版本',
    'C:/workspace/.agents/skills/design/SKILL.md': '---\nname: design\ndescription: 跨平台 design\n---\n# Design\n标准版本',
    'C:/workspace/.agents/skills/commit/SKILL.md': '---\nname: commit\n---\n# Commit\n规范提交信息',
    'C:/workspace/.claude/skills/review/SKILL.md': '# Code Review\n逐行审查代码质量。',
    'C:/workspace/.zcode/skills/naming/SKILL.md': '---\nname: naming\n---\n# Naming\n命名规范',
  }

  beforeEach(() => {
    vi.stubGlobal('window', {
      electronAPI: {
        listDir: async (dir: string) => {
          if (dir === `${root}/.ourcode/skills`) return [{ name: 'design', isDirectory: true, isHidden: false }]
          if (dir === `${root}/.agents/skills`) return [{ name: 'design', isDirectory: true, isHidden: false }, { name: 'commit', isDirectory: true, isHidden: false }]
          if (dir === `${root}/.claude/skills`) return [{ name: 'review', isDirectory: true, isHidden: false }]
          if (dir === `${root}/.zcode/skills`) return [{ name: 'naming', isDirectory: true, isHidden: false }]
          return []
        },
        readFile: async (path: string) => ({ content: files[path] || '', encoding: 'utf-8' }),
        stat: async () => ({ size: 1, isFile: true, isDirectory: false, createdAt: 1, modifiedAt: 1000 }),
        getPath: async (name: string) => (name === 'home' ? 'C:/Users/tester' : 'C:/userData'),
        authorize: async () => {},
      },
    })
    useUIStore.setState({ recentProjects: [root] })
  })

  it('listSkills ignores other platforms\' skills entirely', async () => {
    const skills = await listSkills(true, root)
    expect(skills.map((s) => s.name)).toEqual(['design'])
    expect(skills[0].origin).toBeUndefined() // SkillInfo carries no platform field
  })

  it('listImportableSkills (project) lists external dirs, tagged by origin, excluding our own', async () => {
    const importable = await listImportableSkills('project', root)
    const names = importable.map((s) => s.name).sort()
    expect(names).toEqual(['commit', 'design', 'naming', 'review'])
    expect(importable.find((s) => s.name === 'review')!.origin).toBe('claude')
    expect(importable.find((s) => s.name === 'commit')!.origin).toBe('agents')
    expect(importable.find((s) => s.name === 'naming')!.origin).toBe('zcode')
    // The same "design" from .agents is importable, alongside our own copy —
    // but our own .ourcode/skills copy is never listed as an import candidate.
    expect(importable.find((s) => s.name === 'design')!.origin).toBe('agents')
    expect(importable.filter((s) => s.name === 'design')).toHaveLength(1)
  })
})

describe('listImportableSkills (global scope — home dirs)', () => {
  // Global import sources are the home-dir skill dirs of other platforms;
  // they must NOT leak into listSkills.
  const files: Record<string, string> = {
    'C:/Users/tester/.agents/skills/lint/SKILL.md': '---\nname: lint\n---\n# Lint\n代码检查规范',
    'C:/Users/tester/.claude/skills/draft/SKILL.md': '---\nname: draft\n---\n# Draft\n草稿撰写',
  }

  beforeEach(() => {
    vi.stubGlobal('window', {
      electronAPI: {
        listDir: async (dir: string) => {
          if (dir === 'C:/Users/tester/.agents/skills') return [{ name: 'lint', isDirectory: true, isHidden: false }]
          if (dir === 'C:/Users/tester/.claude/skills') return [{ name: 'draft', isDirectory: true, isHidden: false }]
          return []
        },
        readFile: async (path: string) => ({ content: files[path] || '', encoding: 'utf-8' }),
        stat: async () => ({ size: 1, isFile: true, isDirectory: false, createdAt: 1, modifiedAt: 1000 }),
        getPath: async (name: string) => (name === 'home' ? 'C:/Users/tester' : 'C:/userData'),
        authorize: async () => {},
      },
    })
    useUIStore.setState({ recentProjects: [] })
  })

  it('lists home-dir skills as importable, tagged by origin', async () => {
    const importable = await listImportableSkills('global')
    const names = importable.map((s) => s.name).sort()
    expect(names).toEqual(['draft', 'lint'])
    expect(importable.find((s) => s.name === 'lint')!.origin).toBe('agents')
    expect(importable.find((s) => s.name === 'draft')!.origin).toBe('claude')
  })

  it('home-dir skills are not discovered as usable skills', async () => {
    const skills = await listSkills(true, root)
    expect(skills).toHaveLength(0)
  })
})
