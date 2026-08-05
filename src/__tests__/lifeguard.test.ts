import { describe, it, expect } from 'vitest'
import { parseFindings } from '../services/lifeguard'

describe('lifeguard - parseFindings', () => {
  it('parses a clean JSON array', () => {
    const findings = parseFindings('[{"severity":"error","file":"a.ts","line":3,"message":"可能为 null"}]')
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('error')
    expect(findings[0].file).toBe('a.ts')
    expect(findings[0].line).toBe(3)
  })

  it('tolerates markdown fenced output', () => {
    const findings = parseFindings('```json\n[{"severity":"warning","message":"边界未处理"}]\n```')
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('warning')
  })

  it('tolerates prose wrapped around the array', () => {
    const raw = '发现以下问题：\n[{"severity":"error","message":"空引用"}]\n请修复。'
    const findings = parseFindings(raw)
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toBe('空引用')
  })

  it('normalizes invalid severity to info', () => {
    const findings = parseFindings('[{"severity":"critical","message":"x"}]')
    expect(findings[0].severity).toBe('info')
  })

  it('returns [] for garbage', () => {
    expect(parseFindings('no json here')).toEqual([])
    expect(parseFindings('')).toEqual([])
  })

  it('drops items without a message', () => {
    const findings = parseFindings('[{"severity":"error"},{"severity":"warning","message":"ok"}]')
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toBe('ok')
  })
})
