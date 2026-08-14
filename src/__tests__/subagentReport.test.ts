import { describe, it, expect } from 'vitest'
import { subagentStatusLabel, mergeWriteScopes, resolveSubagentModel } from '@/services/subagents/subagentReport'
import { SubagentGuard } from '@/services/subagents/subagentDefinitions'

describe('subagentStatusLabel (v2 §11.3 — report first line from the runner state machine)', () => {
  const base = {
    aborted: false,
    finalText: '完成了',
    lastError: '',
    hitTokenBudget: false,
    iterationsLeft: 5,
  }

  it('labels a normal completion 完成', () => {
    expect(subagentStatusLabel(base)).toBe('完成')
  })

  it('labels a user-stopped run 阻塞 even with partial output', () => {
    expect(subagentStatusLabel({ ...base, aborted: true, finalText: '' })).toBe('阻塞')
    expect(subagentStatusLabel({ ...base, aborted: true, lastError: 'x' })).toBe('阻塞')
  })

  it('labels a hard error (no final text) 失败', () => {
    expect(subagentStatusLabel({ ...base, finalText: '', lastError: 'network timeout' })).toBe('失败')
  })

  it('labels budget-hit / iterations-exhausted 部分完成', () => {
    expect(subagentStatusLabel({ ...base, finalText: '', hitTokenBudget: true })).toBe('部分完成')
    expect(subagentStatusLabel({ ...base, finalText: '', iterationsLeft: 0 })).toBe('部分完成')
  })

  it('does NOT downgrade a recovered run (final text present despite tool errors)', () => {
    // A tool-result error sets lastError but the agent recovered and produced output
    expect(subagentStatusLabel({ ...base, lastError: 'tool failed' })).toBe('完成')
    // Normal completion exactly at the last allowed iteration is still 完成
    expect(subagentStatusLabel({ ...base, iterationsLeft: 0 })).toBe('完成')
  })
})

describe('mergeWriteScopes (v2 §11.2 — envelope files_to_modify → run write scope)', () => {
  it('returns the definition scope unchanged when the envelope has no paths', () => {
    expect(mergeWriteScopes(undefined, undefined)).toBeUndefined()
    expect(mergeWriteScopes(['src'], undefined)).toEqual(['src'])
    expect(mergeWriteScopes(['src'], [])).toEqual(['src'])
  })

  it('appends envelope paths to the definition scope', () => {
    expect(mergeWriteScopes(['.ourcode/targemode'], ['src/a.ts', 'src/b.ts']))
      .toEqual(['.ourcode/targemode', 'src/a.ts', 'src/b.ts'])
    expect(mergeWriteScopes(undefined, ['src/a.ts'])).toEqual(['src/a.ts'])
  })
})

describe('resolveSubagentModel (v2 §10.5 — override > session > default)', () => {
  it('prefers the envelope override, then session, then default', () => {
    expect(resolveSubagentModel('gpt-4o', 'claude', 'gemini')).toBe('gpt-4o')
    expect(resolveSubagentModel(undefined, 'claude', 'gemini')).toBe('claude')
    expect(resolveSubagentModel(undefined, undefined, 'gemini')).toBe('gemini')
    expect(resolveSubagentModel(undefined, undefined, undefined)).toBe('')
  })

  it('plain runs pass no override → resolution is unchanged', () => {
    expect(resolveSubagentModel(undefined, 'session-model', undefined)).toBe('session-model')
  })
})

describe('envelope hard isolation end-to-end (guard + merged write scope)', () => {
  // tm-developer has NO write scope (full access) — the envelope's
  // files_to_modify must narrow it to exactly the declared files.
  const developerDef = {
    name: 'tm-developer', description: '', systemPrompt: 'x', source: 'builtin' as const,
  }

  it('a full-access role becomes write-restricted to files_to_modify; reads stay open', () => {
    const writePaths = mergeWriteScopes(developerDef.allowedWritePaths, ['src/api/todo.ts'])
    const guard = new SubagentGuard({ ...developerDef, allowedWritePaths: writePaths }, 'C:/workspace')

    // declared file → allowed
    expect(guard.checkCall('write_file', { path: 'C:/workspace/src/api/todo.ts' })).toBeNull()
    // anything else → blocked
    expect(guard.checkCall('write_file', { path: 'C:/workspace/src/api/user.ts' })).toContain('超出')
    expect(guard.checkCall('edit_file', { path: 'C:/workspace/README.md' })).toContain('超出')
    // reads stay unrestricted (read scope = allowedReadPaths ?? allowedPaths)
    expect(guard.checkCall('read_file', { path: 'C:/workspace/src/api/user.ts' })).toBeNull()
    // batch write paths are checked too
    expect(guard.checkCall('multi_edit_file', {
      edits: [{ path: 'C:/workspace/src/api/todo.ts' }, { path: 'C:/workspace/README.md' }],
    })).toContain('超出')
  })

  it('a strong-boundary role keeps its own scope plus the envelope paths', () => {
    const writePaths = mergeWriteScopes(['.ourcode/targemode', 'tests'], ['tests/foo.test.ts'])
    const guard = new SubagentGuard({
      ...developerDef, name: 'tm-tester', tools: ['read_file', 'write_file'], allowedWritePaths: writePaths,
    }, 'C:/workspace')

    expect(guard.checkCall('write_file', { path: 'C:/workspace/tests/foo.test.ts' })).toBeNull()
    expect(guard.checkCall('write_file', { path: 'C:/workspace/tests/bar.test.ts' })).toBeNull() // own scope kept
    expect(guard.checkCall('write_file', { path: 'C:/workspace/src/business.ts' })).toContain('超出')
  })
})
