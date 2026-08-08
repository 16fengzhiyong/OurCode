import { describe, it, expect } from 'vitest'
import { parseStatus, statusBadge } from '@/services/targetMode/targetModeService'
import { TARGET_MODE_STATUS_INIT } from '@/services/targetMode/spec'

describe('targetModeService.parseStatus', () => {
  it('parses the initial status file', () => {
    const s = parseStatus(TARGET_MODE_STATUS_INIT)
    expect(s.round).toBe(0)
    expect(s.percent).toBeNull()
    expect(s.progressText).toContain('未开始')
  })

  it('parses a progressed status (round + percent)', () => {
    const md = `# 目标模式实施状态

- 当前轮次：2
- 已完成阶段数：4
- 总体百分比：62.5%
- 历史记录：
  - R1：完成 3 个阶段
  - R2：进行中
`
    const s = parseStatus(md)
    expect(s.round).toBe(2)
    expect(s.percent).toBe(62.5)
    expect(s.progressText).toBe('')
  })

  it('returns nulls for unknown fields', () => {
    const s = parseStatus('# 空的')
    expect(s.round).toBeNull()
    expect(s.percent).toBeNull()
    expect(s.progressText).toBe('')
  })

  it('tolerates full-width colons', () => {
    const s = parseStatus('当前轮次：3\n总体百分比：50%')
    expect(s.round).toBe(3)
    expect(s.percent).toBe(50)
  })
})

describe('targetModeService.statusBadge', () => {
  it('formats round + percent', () => {
    expect(statusBadge({ round: 2, percent: 62.5, progressText: '' })).toBe('R2 · 63%')
  })

  it('formats round only when percent is missing', () => {
    expect(statusBadge({ round: 0, percent: null, progressText: '' })).toBe('R0')
  })

  it('handles null status', () => {
    expect(statusBadge(null)).toBe('')
  })
})
