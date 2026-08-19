/**
 * 3D 办公室 × 目标模式：映射层纯函数单测。
 * 覆盖：8 槽初始化、角色→槽位分配、子 Agent 状态→场景状态、进度估计、任务摘要。
 */
import { describe, expect, it } from 'vitest'
import type { SubAgentProgress } from '@shared/types'
import {
  OFFICE_SLOTS,
  assignSlot,
  buildInitialOfficeAgents,
  envelopeRole,
  estimateProgress,
  subagentStatusToOffice,
  summarizeTask,
} from '@/services/office/mapping'

describe('office/mapping: buildInitialOfficeAgents', () => {
  it('构造 8 个全空闲工位', () => {
    const agents = buildInitialOfficeAgents()
    expect(agents).toHaveLength(8)
    expect(agents.map((a) => a.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(agents.every((a) => a.status === 'idle')).toBe(true)
    expect(agents.every((a) => a.progress === 0)).toBe(true)
    expect(agents.every((a) => Array.isArray(a.logs) && a.logs.length === 0)).toBe(true)
  })

  it('槽位静态信息与 office-v3 agentsData 对齐', () => {
    expect(OFFICE_SLOTS[0]).toMatchObject({ id: 1, role: '架构总监', codeName: 'Director-01' })
    expect(OFFICE_SLOTS[6]).toMatchObject({ id: 7, role: '自动化测试-1', codeName: 'QA-07' })
  })
})

describe('office/mapping: assignSlot', () => {
  it('固定角色命中专属槽位', () => {
    expect(assignSlot('tm-requirement-analyst', new Set())).toBe(2)
    expect(assignSlot('tm-ui-developer', new Set())).toBe(3)
    expect(assignSlot('tm-tester', new Set())).toBe(7)
  })

  it('developer 池按 4→5→6 分配，满则返回 null', () => {
    const occupied = new Set<number>()
    expect(assignSlot('tm-developer', occupied)).toBe(4)
    occupied.add(4)
    expect(assignSlot('tm-developer', occupied)).toBe(5)
    occupied.add(5)
    expect(assignSlot('tm-developer', occupied)).toBe(6)
    occupied.add(6)
    expect(assignSlot('tm-developer', occupied)).toBeNull()
  })

  it('tester 池 7→8，全满返回 null', () => {
    const occupied = new Set([7])
    expect(assignSlot('tm-tester', occupied)).toBe(8)
    expect(assignSlot('tm-tester', new Set([7, 8]))).toBeNull()
  })

  it('兼容不带 tm- 前缀的内建角色名', () => {
    expect(assignSlot('developer', new Set())).toBe(4)
    expect(assignSlot('tester', new Set())).toBe(7)
  })

  it('未知角色返回 null', () => {
    expect(assignSlot('unknown-role', new Set())).toBeNull()
  })
})

describe('office/mapping: subagentStatusToOffice', () => {
  it('running → working（含思考的子状态由桥接层按 steps 细化）', () => {
    expect(subagentStatusToOffice('running')).toBe('working')
  })
  it('done → completed', () => {
    expect(subagentStatusToOffice('done')).toBe('completed')
  })
  it('error / stopped → error', () => {
    expect(subagentStatusToOffice('error')).toBe('error')
    expect(subagentStatusToOffice('stopped')).toBe('error')
  })
})

describe('office/mapping: estimateProgress', () => {
  const base: SubAgentProgress = {
    status: 'running',
    sessionId: 's1',
    name: 'tm-developer',
    task: 'task',
    startedAt: 0,
    thinking: '',
    steps: [],
    toolCallCount: 0,
    tokenCount: 0,
  }

  it('终态为 100%', () => {
    expect(estimateProgress({ ...base, status: 'done' })).toBe(100)
    expect(estimateProgress({ ...base, status: 'error' })).toBe(100)
    expect(estimateProgress({ ...base, status: 'stopped' })).toBe(100)
  })

  it('按工具调用步数分级', () => {
    expect(estimateProgress({ ...base, toolCallCount: 0 })).toBe(25)
    expect(estimateProgress({ ...base, toolCallCount: 2 })).toBe(40)
    expect(estimateProgress({ ...base, toolCallCount: 5 })).toBe(60)
    expect(estimateProgress({ ...base, toolCallCount: 10 })).toBe(85)
  })
})

describe('office/mapping: summarizeTask', () => {
  it('超长任务截断为一行并加省略号', () => {
    const long = 'a'.repeat(120)
    const s = summarizeTask(long, 60)
    expect(s).toHaveLength(61)
    expect(s.endsWith('…')).toBe(true)
  })
  it('空任务给占位文案', () => {
    expect(summarizeTask('')).toBe('（无任务描述）')
  })
  it('压缩换行', () => {
    expect(summarizeTask('a\nb\nc')).toBe('a b c')
  })
})

describe('office/mapping: envelopeRole', () => {
  it('从任务信封 frontmatter 提取 to 角色', () => {
    const task = `---
from: supervisor
to: tm-developer
type: task
---
实现 xxx`
    expect(envelopeRole(task)).toBe('tm-developer')
  })
  it('无信封时返回 null', () => {
    expect(envelopeRole('普通任务描述')).toBeNull()
  })
})
