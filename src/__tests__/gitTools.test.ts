import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

/**
 * Native git tools (Claude Code style) — unit tests for helpers.runGit and the
 * git tools' argument building / cwd resolution, with window.electronAPI.gitExec
 * mocked. The real IPC (git:exec) is covered by the main-process allowlist +
 * timeout; here we only pin down the renderer-side glue.
 */

let mockGitExec: ReturnType<typeof vi.fn>

beforeEach(() => {
  mockGitExec = vi.fn(async (_cwd: string, _args: string[]) => ({ success: true, output: 'ok' }))
  vi.stubGlobal('window', { electronAPI: { gitExec: mockGitExec } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

import { runGit } from '@/services/tools/helpers'
import { createToolRegistry } from '@/services/tools/ToolRegistry'

describe('helpers.runGit', () => {
  it('runs in the given cwd and returns stdout', async () => {
    mockGitExec.mockResolvedValueOnce({ success: true, output: ' M src/a.ts' })
    const out = await runGit(['status', '--porcelain'], 'E:/proj')
    expect(mockGitExec).toHaveBeenCalledWith('E:/proj', ['status', '--porcelain'])
    expect(out).toBe(' M src/a.ts')
  })

  it('wraps failures into an Error result', async () => {
    mockGitExec.mockResolvedValueOnce({ success: false, output: '', error: 'fatal: not a git repository' })
    const out = await runGit(['log'], 'E:/proj')
    expect(out).toBe('Error: fatal: not a git repository')
  })

  it('normalizes empty output', async () => {
    mockGitExec.mockResolvedValueOnce({ success: true, output: '' })
    expect(await runGit(['branch'], 'E:/proj')).toBe('(无输出)')
  })
})

describe('native git tools', () => {
  const registry = createToolRegistry()
  const exec = (name: string, args: Record<string, any> = {}, context?: { projectPath?: string }) =>
    registry.find((t) => t.name === name)!.execute(args, context)

  it('git_status runs with the session project path', async () => {
    await exec('git_status', {}, { projectPath: 'E:/proj' })
    expect(mockGitExec).toHaveBeenCalledWith('E:/proj', ['status', '--porcelain=v1', '--branch'])
  })

  it('git_diff builds staged / stat / path variants', async () => {
    await exec('git_diff', { staged: true }, { projectPath: 'P' })
    expect(mockGitExec).toHaveBeenCalledWith('P', ['diff', '--cached'])

    await exec('git_diff', { stat: true, path: 'src/' }, { projectPath: 'P' })
    expect(mockGitExec).toHaveBeenCalledWith('P', ['diff', '--stat', '--', 'src/'])
  })

  it('git_diff truncates oversized output', async () => {
    mockGitExec.mockResolvedValueOnce({ success: true, output: 'x'.repeat(200 * 1024) })
    const out = await exec('git_diff', {}, { projectPath: 'P' })
    expect(out.length).toBeLessThan(120 * 1024 + 200)
    expect(out).toContain('已截断')
  })

  it('git_add stages a single path or everything', async () => {
    await exec('git_add', { path: 'src/a.ts' }, { projectPath: 'P' })
    expect(mockGitExec).toHaveBeenCalledWith('P', ['add', '--', 'src/a.ts'])

    await exec('git_add', {}, { projectPath: 'P' })
    expect(mockGitExec).toHaveBeenCalledWith('P', ['add', '-A'])
  })

  it('git_commit requires a message and stages all when all=true', async () => {
    mockGitExec.mockResolvedValue({ success: true, output: '' })

    const noMsg = await exec('git_commit', {}, { projectPath: 'P' })
    expect(noMsg).toContain('Error')

    await exec('git_commit', { message: 'feat: x', all: true }, { projectPath: 'P' })
    expect(mockGitExec).toHaveBeenNthCalledWith(1, 'P', ['add', '-A'])
    expect(mockGitExec).toHaveBeenNthCalledWith(2, 'P', ['commit', '-m', 'feat: x'])

    mockGitExec.mockClear()
    await exec('git_commit', { message: 'fix: y' }, { projectPath: 'P' })
    // 不带 all：不先 add，直接 commit
    expect(mockGitExec).toHaveBeenCalledTimes(1)
    expect(mockGitExec).toHaveBeenCalledWith('P', ['commit', '-m', 'fix: y'])
  })

  it('git_push passes remote/branch and defaults to bare git push', async () => {
    await exec('git_push', { remote: 'origin', branch: 'main' }, { projectPath: 'P' })
    expect(mockGitExec).toHaveBeenCalledWith('P', ['push', 'origin', 'main'])

    await exec('git_push', {}, { projectPath: 'P' })
    expect(mockGitExec).toHaveBeenCalledWith('P', ['push'])
  })

  it('git_push with only a branch fills in the default remote (origin)', async () => {
    // 只传 branch 时若拼成 `git push main` 会被 git 当成 remote 解析而报错
    await exec('git_push', { branch: 'main' }, { projectPath: 'P' })
    expect(mockGitExec).toHaveBeenCalledWith('P', ['push', 'origin', 'main'])

    await exec('git_push', { remote: 'upstream' }, { projectPath: 'P' })
    expect(mockGitExec).toHaveBeenCalledWith('P', ['push', 'upstream'])
  })

  it('git_split_commit stages and commits each group in order', async () => {
    mockGitExec.mockResolvedValue({ success: true, output: '[main abc1234] feat: x\n 1 file changed' })
    const out = await exec('git_split_commit', {
      groups: [
        { message: 'feat: 视觉扁平化', files: ['src/A.tsx', 'src/B.tsx'] },
        { message: 'fix: 输入框', files: ['src/C.tsx'] },
      ],
    }, { projectPath: 'P' })
    expect(mockGitExec.mock.calls.map((c) => c[1])).toEqual([
      ['add', '--', 'src/A.tsx', 'src/B.tsx'],
      ['commit', '-m', 'feat: 视觉扁平化'],
      ['add', '--', 'src/C.tsx'],
      ['commit', '-m', 'fix: 输入框'],
    ])
    expect(out).toContain('已按功能提交 2 组')
  })

  it('git_split_commit with empty files stages everything (git add -A)', async () => {
    mockGitExec.mockResolvedValue({ success: true, output: '[main abc] ok' })
    await exec('git_split_commit', { groups: [{ message: 'chore: x' }] }, { projectPath: 'P' })
    expect(mockGitExec).toHaveBeenCalledWith('P', ['add', '-A'])
    expect(mockGitExec).toHaveBeenCalledWith('P', ['commit', '-m', 'chore: x'])
  })

  it('git_split_commit validates groups and aborts on failure', async () => {
    expect((await exec('git_split_commit', {}, { projectPath: 'P' }))).toContain('Error')

    mockGitExec.mockResolvedValueOnce({ success: true, output: '' })
    const noMsg = await exec('git_split_commit', { groups: [{ files: ['a.ts'] }] }, { projectPath: 'P' })
    expect(noMsg).toContain('Error')

    mockGitExec.mockReset()
    mockGitExec.mockResolvedValueOnce({ success: false, output: '', error: 'pathspec did not match' })
    const addFail = await exec('git_split_commit', { groups: [{ message: 'feat: x', files: ['nope.ts'] }] }, { projectPath: 'P' })
    expect(addFail).toContain('add 失败')
  })

  it('git_log clamps maxCount', async () => {
    await exec('git_log', { maxCount: 9999 }, { projectPath: 'P' })
    expect(mockGitExec).toHaveBeenCalledWith('P', ['log', '-100', '--oneline', '--decorate'])

    await exec('git_log', {}, { projectPath: 'P' })
    expect(mockGitExec).toHaveBeenCalledWith('P', ['log', '-10', '--oneline', '--decorate'])
  })

  it('falls back to the workspace root when no project path', async () => {
    // helpers.workspaceRoot 读 DOM；测试环境给个空 DOM，让兜底路径返回空串
    vi.stubGlobal('document', { getElementById: () => null })
    const out = await exec('git_status')
    // cwd 为空串时 runGit 返回明确错误而不是抛异常
    expect(typeof out).toBe('string')
    expect(out.startsWith('Error:')).toBe(true)
  })
})
