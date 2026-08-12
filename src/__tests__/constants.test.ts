import { describe, it, expect } from 'vitest'
import { lookupModelMetadata } from '../../shared/constants'

describe('lookupModelMetadata', () => {
  it('resolves deepseek-v4-flash to the 200K context window via prefix match', () => {
    // 用户实际使用的模型名来自 API 拉取（deepseek-v4-flash / deepseek-v4-reasoner），
    // 前缀 'deepseek-v4' 必须命中，否则 trimHistoryForContext 会回退默认 128K，
    // 200K 配置对真实会话落空
    const meta = lookupModelMetadata('deepseek-v4-flash')
    expect(meta).toBeTruthy()
    expect(meta!.contextWindow).toBe(200000)

    expect(lookupModelMetadata('deepseek-v4-reasoner')!.contextWindow).toBe(200000)
    expect(lookupModelMetadata('deepseek-chat')!.contextWindow).toBe(200000)
  })

  it('exact match wins over prefix', () => {
    expect(lookupModelMetadata('gpt-4o')!.contextWindow).toBe(128000)
    expect(lookupModelMetadata('deepseek-coder')!.contextWindow).toBe(200000)
  })

  it('returns undefined for unknown models (callers fall back to 128K)', () => {
    expect(lookupModelMetadata('unknown-model-xyz')).toBeUndefined()
  })
})
