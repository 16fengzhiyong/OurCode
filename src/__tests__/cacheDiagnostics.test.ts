import { describe, it, expect } from 'vitest'
import {
  djb2Hash,
  toolSignature,
  analyzeCacheBreak,
  rememberRequestSignature,
  getPreviousSignature,
  resetSessionSignature,
} from '@/services/llm/cacheDiagnostics'

describe('cacheDiagnostics', () => {
  it('djb2Hash is stable and differs across strings', () => {
    expect(djb2Hash('abc')).toBe(djb2Hash('abc'))
    expect(djb2Hash('abc')).not.toBe(djb2Hash('abd'))
  })

  it('toolSignature hashes the wire-format tool segment', () => {
    const tools = [
      { type: 'function', function: { name: 'search', description: 'search the web', parameters: { type: 'object' } } },
      { type: 'function', function: { name: 'read_file', description: 'read a file', parameters: { type: 'object' } } },
    ]
    const sig = toolSignature(tools)
    expect(sig.perTool.search).toBe(djb2Hash('search\nsearch the web\n{"type":"object"}'))
    // Changing one tool's description changes the whole segment hash
    const changed = [
      { ...tools[0], function: { ...tools[0].function, description: 'search the web v2' } },
      tools[1],
    ]
    expect(toolSignature(changed).hash).not.toBe(sig.hash)
    expect(toolSignature(changed).perTool.read_file).toBe(sig.perTool.read_file)
  })

  it('analyzeCacheBreak names the changed tool', () => {
    const tools = [
      { type: 'function', function: { name: 'search', description: 'search the web', parameters: { type: 'object' } } },
    ]
    const base: Parameters<typeof analyzeCacheBreak>[0] = { systemHash: djb2Hash('sys'), toolsHash: toolSignature(tools).hash, perTool: toolSignature(tools).perTool }
    const changedTools = [{ ...tools[0], function: { ...tools[0].function, description: 'v2' } }]
    const changed: Parameters<typeof analyzeCacheBreak>[1] = { systemHash: djb2Hash('sys'), toolsHash: toolSignature(changedTools).hash, perTool: toolSignature(changedTools).perTool }

    const report = analyzeCacheBreak(base, changed)
    expect(report.causes.some((c) => c.includes('search'))).toBe(true)
    expect(report.causes.some((c) => c.includes('系统提示词'))).toBe(false)
  })

  it('analyzeCacheBreak reports an unexpected miss when nothing changed', () => {
    const sig = { systemHash: djb2Hash('sys'), toolsHash: djb2Hash('tools'), perTool: {} }
    const report = analyzeCacheBreak(sig, sig)
    expect(report.causes.some((c) => c.includes('未变但缓存未命中'))).toBe(true)
  })

  it('per-session signature store round-trips', () => {
    const sig = { systemHash: 1, toolsHash: 2, perTool: {} }
    rememberRequestSignature('sess-1', sig)
    expect(getPreviousSignature('sess-1')).toEqual(sig)
    expect(getPreviousSignature('sess-2')).toBeUndefined()
    resetSessionSignature('sess-1')
    expect(getPreviousSignature('sess-1')).toBeUndefined()
  })
})
