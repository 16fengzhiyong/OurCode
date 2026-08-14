import { describe, it, expect } from 'vitest'
import { parseEnvelope } from '@/services/targetMode/envelope'

describe('targetMode envelope', () => {
  it('parses a valid task envelope', () => {
    const task = `---
from: supervisor
to: tm-tester
type: fix
phase: 2
status: pending
files_to_modify: [src/a.ts, src/b.ts]
files_to_read: [agents/interface_spec.md]
acceptance: 全部通过
fix_attempts: 1
model: gpt-4o
report_path: .ourcode/targemode/agents/test_report.md
---
## 任务
验证实现。
`
    const env = parseEnvelope(task)
    expect(env).not.toBeNull()
    expect(env!.to).toBe('tm-tester')
    expect(env!.type).toBe('fix')
    expect(env!.phase).toBe('2')
    expect(env!.filesToModify).toEqual(['src/a.ts', 'src/b.ts'])
    expect(env!.filesToRead).toEqual(['agents/interface_spec.md'])
    expect(env!.acceptance).toBe('全部通过')
    expect(env!.fixAttempts).toBe(1)
    expect(env!.model).toBe('gpt-4o')
    expect(env!.reportPath).toBe('.ourcode/targemode/agents/test_report.md')
    expect(env!.prompt).toContain('## 任务')
  })

  it('parses a block-scalar acceptance', () => {
    const env = parseEnvelope('---\nto: dev\nacceptance: |\n  1. 通过测试\n  2. 无回归\n---\nbody')
    expect(env!.acceptance).toBe('1. 通过测试\n2. 无回归')
  })

  it('returns null for plain tasks (no envelope frontmatter)', () => {
    expect(parseEnvelope('修复 src/a.ts 的 bug')).toBeNull()
  })

  it('returns null for frontmatter without the to: marker (not an envelope)', () => {
    expect(parseEnvelope('---\ntitle: hello\n---\nbody')).toBeNull()
  })

  it('tolerates quoted list items', () => {
    const env = parseEnvelope('---\nto: dev\nfiles_to_modify: ["src/a.ts", \'src/b.ts\']\n---\ntask')
    expect(env!.filesToModify).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('strips trailing YAML comments from list values', () => {
    const env = parseEnvelope('---\nto: dev\nfiles_to_modify: [src/a.ts]  # 允许改的文件，互不重叠\n---\ntask')
    expect(env!.filesToModify).toEqual(['src/a.ts'])
  })

  it('defaults missing numeric/list fields', () => {
    const env = parseEnvelope('---\nto: dev\n---\ntask')
    expect(env!.filesToModify).toEqual([])
    expect(env!.filesToRead).toEqual([])
    expect(env!.fixAttempts).toBe(0)
    expect(env!.model).toBeUndefined()
    expect(env!.reportPath).toBeUndefined()
  })
})
