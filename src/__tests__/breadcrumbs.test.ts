import { describe, it, expect } from 'vitest'
import { findEnclosingSymbols } from '@/editor/breadcrumbs'

describe('findEnclosingSymbols', () => {
  const code = [
    'export class Calculator {',          // 1
    '  private value = 0',                // 2
    '  add(n: number): number {',         // 3  → method
    '    const doubled = n * 2',          // 4
    '    return doubled',                 // 5
    '  }',                                // 6
    '  subtract(n: number) {',            // 7  → method
    '    return this.value - n',          // 8
    '  }',                                // 9
    '}',                                  // 10
    'function helper() {',                // 11 → function
    '  console.log("hi")',                // 12
    '}',                                  // 13
  ]

  it('returns class + method chain at a nested cursor', () => {
    const chain = findEnclosingSymbols(code, 4)
    expect(chain.map((s) => s.name)).toEqual(['Calculator', 'add'])
    expect(chain[0].kind).toBe('class')
    expect(chain[1].kind).toBe('method')
  })

  it('returns class only at a top-level-of-class cursor', () => {
    const chain = findEnclosingSymbols(code, 2)
    expect(chain.map((s) => s.name)).toEqual(['Calculator'])
  })

  it('returns the function at a top-level function cursor', () => {
    const chain = findEnclosingSymbols(code, 12)
    expect(chain.map((s) => s.name)).toEqual(['helper'])
  })

  it('returns [] for out-of-range lines', () => {
    expect(findEnclosingSymbols(code, 0)).toEqual([])
    expect(findEnclosingSymbols(code, 99)).toEqual([])
    expect(findEnclosingSymbols([], 1)).toEqual([])
  })

  it('handles python def/class', () => {
    const py = [
      'class User:',            // 1
      '    def __init__(self):',// 2
      '        self.name = ""', // 3
    ]
    const chain = findEnclosingSymbols(py, 3)
    expect(chain.map((s) => s.name)).toEqual(['User', '__init__'])
    expect(chain[1].kind).toBe('def')
  })

  it('ignores a sibling declaration after a deeper one is found', () => {
    // A later sibling at the same indent must not be included
    const lines = [
      'function first() {',   // 1
      '  body',               // 2
      '}',                    // 3
      'function second() {',  // 4
      '  body2',              // 5
      '}',                    // 6
    ]
    const chain = findEnclosingSymbols(lines, 2)
    expect(chain.map((s) => s.name)).toEqual(['first'])
  })
})
