import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  parseAgentFrontmatter,
  loadAgentDefinition,
  SubagentGuard,
  CONTROL_TOOLS,
  isPathWithin,
  resolveAllowedRoot,
} from '@/services/subagents/subagentDefinitions'

describe('parseAgentFrontmatter', () => {
  it('parses scalar and array fields from frontmatter', () => {
    const content = [
      '---',
      'name: reviewer',
      'description: 审查员',
      'tools: [read_file, list_directory, web_search]',
      'allowedPaths: src, tests',
      'maxIterations: 5',
      'maxTokensBudget: 10000',
      'temperature: 0.3',
      'model: gpt-4o',
      '---',
      '你是审查员',
    ].join('\n')
    const parsed = parseAgentFrontmatter(content, 'fallback')
    expect(parsed.name).toBe('reviewer')
    expect(parsed.description).toBe('审查员')
    expect(parsed.systemPrompt).toBe('你是审查员')
    expect(parsed.frontmatter.tools).toBe('[read_file, list_directory, web_search]')
    expect(parsed.frontmatter.allowedpaths).toBe('src, tests')
    expect(parsed.frontmatter.maxiterations).toBe('5')
  })

  it('falls back to the file name and tolerates missing frontmatter', () => {
    const parsed = parseAgentFrontmatter('只有正文，没有前matter', 'code-reviewer')
    expect(parsed.name).toBe('code-reviewer')
    expect(parsed.systemPrompt).toBe('只有正文，没有前matter')
  })
})

describe('loadAgentDefinition', () => {
  const root = 'C:/workspace'
  const agentFile = `${root}/.ourcode/agents/code-reviewer.md`

  const mockApi = {
    listDir: vi.fn(async (dir: string) => {
      if (dir === `${root}/.ourcode/agents`) {
        return [{ name: 'code-reviewer.md', isDirectory: false, isHidden: false }]
      }
      if (dir === 'C:/userData/agents') return []
      return []
    }),
    readFile: vi.fn(async (path: string) => {
      const files: Record<string, string> = {
        [agentFile]: [
          '---',
          'name: workspace-reviewer',
          'description: 工作区审查员',
          'tools: [read_file]',
          'allowedPaths: [src]',
          'maxIterations: 4',
          '---',
          '只读审查。',
        ].join('\n'),
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

  it('loads a workspace definition file, parsing frontmatter into fields', async () => {
    const def = await loadAgentDefinition('code-reviewer', root)
    expect(def.source).toBe('workspace')
    expect(def.name).toBe('workspace-reviewer')
    expect(def.systemPrompt).toBe('只读审查。')
    expect(def.tools).toEqual(['read_file'])
    expect(def.allowedPaths).toEqual(['src'])
    expect(def.maxIterations).toBe(4)
    expect(def.path).toBe(agentFile)
  })

  it('falls back to a built-in archetype when no file matches', async () => {
    const def = await loadAgentDefinition('code-reviewer', 'C:/other-root')
    expect(def.source).toBe('builtin')
    expect(def.tools).not.toContain('write_file')
    expect(def.tools).toContain('read_file')
  })

  it('falls back to a generic definition for unknown names (never throws)', async () => {
    const def = await loadAgentDefinition('ghost-agent', 'C:/other-root')
    expect(def.source).toBe('builtin')
    expect(def.name).toBe('ghost-agent')
    expect(def.systemPrompt).toContain('ghost-agent')
    expect(def.tools).toBeUndefined()
  })
})

describe('SubagentGuard — permission isolation', () => {
  const base = (over: Partial<Parameters<typeof makeGuard>[0]> = {}) => makeGuard(over)

  function makeGuard(defOverrides: Record<string, any>) {
    const def = {
      name: 'reviewer',
      description: '',
      systemPrompt: 'x',
      tools: ['read_file', 'list_directory', 'run_command', 'mcp__git__git_status'],
      allowedPaths: ['src', 'tests'],
      blockedCommands: ['rm -rf'],
      source: 'builtin' as const,
      ...defOverrides,
    }
    return new SubagentGuard(def, 'C:/workspace')
  }

  it('always blocks control tools, even with no allowlist', () => {
    const guard = base({ tools: undefined })
    for (const t of CONTROL_TOOLS) {
      expect(guard.toolAllowed(t)).toBe(false)
      expect(guard.checkCall(t, {})).toBeTruthy()
    }
  })

  it('with no allowlist, non-control tools are allowed', () => {
    const guard = base({ tools: undefined })
    expect(guard.toolAllowed('write_file')).toBe(true)
    expect(guard.toolAllowed('run_command')).toBe(true)
  })

  it('blocks tools outside the allowlist; allows listed ones', () => {
    const guard = base()
    expect(guard.toolAllowed('read_file')).toBe(true)
    expect(guard.toolAllowed('write_file')).toBe(false)
    expect(guard.checkCall('write_file', { path: 'C:/workspace/src/a.ts' })).toContain('白名单')
  })

  it('always allows skill__ tools (pure instruction loaders)', () => {
    const guard = base()
    expect(guard.toolAllowed('skill__code-review')).toBe(true)
    expect(guard.checkCall('skill__code-review', {})).toBeNull()
  })

  it('allows MCP tools that are explicitly allowlisted', () => {
    const guard = base()
    expect(guard.toolAllowed('mcp__git__git_status')).toBe(true)
    expect(guard.checkCall('mcp__git__git_status', {})).toBeNull()
  })

  it('blocks paths outside allowedPaths, allows inside (win/posix separators)', () => {
    const guard = base()
    expect(guard.checkCall('read_file', { path: 'C:/workspace/src/a.ts' })).toBeNull()
    expect(guard.checkCall('read_file', { path: 'C:\\workspace\\src\\a.ts' })).toBeNull()
    expect(guard.checkCall('read_file', { path: 'C:/workspace/src2/evil.ts' })).toContain('超出')
    expect(guard.checkCall('read_file', { path: 'D:/elsewhere/a.ts' })).toContain('超出')
  })

  it('scopes run_command cwd and blocks dangerous command fragments', () => {
    const guard = base()
    expect(guard.checkCall('run_command', { command: 'npm test', cwd: 'C:/workspace/src' })).toBeNull()
    expect(guard.checkCall('run_command', { command: 'npm test', cwd: 'C:/workspace/node_modules' })).toContain('超出')
    expect(guard.checkCall('run_command', { command: 'rm -rf /', cwd: 'C:/workspace/src' })).toContain('禁用')
  })

  it('does not path-scope tools without a path argument', () => {
    const guard = base()
    expect(guard.checkCall('read_file', {})).toBeNull()
  })
})

describe('path helpers', () => {
  it('isPathWithin handles root boundary and case', () => {
    expect(isPathWithin('C:/workspace/src', 'C:/workspace/src/a.ts')).toBe(true)
    expect(isPathWithin('C:/workspace/src', 'C:/workspace/src')).toBe(true)
    expect(isPathWithin('C:/workspace/src', 'C:/workspace/src2/a.ts')).toBe(false)
    expect(isPathWithin('C:/workspace/src', 'C:/Workspace/src/a.ts')).toBe(true)
    expect(isPathWithin('/home/u/src', '/home/u/src/a.ts')).toBe(true)
    expect(isPathWithin('/home/u/src', '/home/u/srcx')).toBe(false)
  })

  it('resolveAllowedRoot joins relative entries and keeps absolute ones', () => {
    expect(resolveAllowedRoot('C:/workspace', 'src')).toBe('C:/workspace/src')
    expect(resolveAllowedRoot('C:/workspace', './tests')).toBe('C:/workspace/tests')
    expect(resolveAllowedRoot('C:/workspace', 'D:/abs/path')).toBe('D:/abs/path')
  })
})
