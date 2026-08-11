import { describe, it, expect } from 'vitest'
import { mapOpenAiUsage, mapAnthropicUsage, mergeUsage } from '@/services/llm/usage'

describe('mapOpenAiUsage', () => {
  it('maps plain prompt/completion tokens', () => {
    expect(mapOpenAiUsage({ prompt_tokens: 10, completion_tokens: 4 })).toEqual({
      promptTokens: 10,
      completionTokens: 4,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    })
  })

  it('maps DeepSeek-style cache fields on the usage root', () => {
    expect(mapOpenAiUsage({
      prompt_tokens: 100,
      completion_tokens: 5,
      prompt_cache_hit_tokens: 80,
      prompt_cache_miss_tokens: 20,
    })).toEqual({
      promptTokens: 100,
      completionTokens: 5,
      cacheReadTokens: 80,
      cacheCreationTokens: 20,
    })
  })

  it('maps OpenAI prompt_tokens_details.cached_tokens as cache read', () => {
    expect(mapOpenAiUsage({
      prompt_tokens: 50,
      completion_tokens: 2,
      prompt_tokens_details: { cached_tokens: 45 },
    })).toEqual({
      promptTokens: 50,
      completionTokens: 2,
      cacheReadTokens: 45,
      cacheCreationTokens: 0,
    })
  })

  it('prefers DeepSeek root fields over prompt_tokens_details', () => {
    const parsed = mapOpenAiUsage({
      prompt_tokens: 50,
      completion_tokens: 2,
      prompt_cache_hit_tokens: 30,
      prompt_tokens_details: { cached_tokens: 45 },
    })!
    expect(parsed.cacheReadTokens).toBe(30)
  })

  it('returns undefined for null/undefined usage', () => {
    expect(mapOpenAiUsage(undefined)).toBeUndefined()
    expect(mapOpenAiUsage(null)).toBeUndefined()
  })
})

describe('mapAnthropicUsage', () => {
  it('maps input/output and cache tokens', () => {
    expect(mapAnthropicUsage({
      input_tokens: 200,
      output_tokens: 8,
      cache_read_input_tokens: 150,
      cache_creation_input_tokens: 50,
    })).toEqual({
      promptTokens: 200,
      completionTokens: 8,
      cacheReadTokens: 150,
      cacheCreationTokens: 50,
    })
  })

  it('defaults missing cache fields to 0', () => {
    expect(mapAnthropicUsage({ input_tokens: 10, output_tokens: 1 })).toEqual({
      promptTokens: 10,
      completionTokens: 1,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    })
  })
})

describe('mergeUsage', () => {
  it('keeps the first non-zero value per field', () => {
    const merged = mergeUsage(
      { promptTokens: 100, completionTokens: 0, cacheReadTokens: 60, cacheCreationTokens: 40 },
      { promptTokens: 0, completionTokens: 7, cacheReadTokens: 0, cacheCreationTokens: 0 },
    )!
    expect(merged.promptTokens).toBe(100)
    expect(merged.completionTokens).toBe(7)
    expect(merged.cacheReadTokens).toBe(60)
    expect(merged.cacheCreationTokens).toBe(40)
  })

  it('returns the next snapshot when there is no base', () => {
    const next = { promptTokens: 1, completionTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 0 }
    expect(mergeUsage(undefined, next)).toEqual(next)
  })

  it('returns the base when there is no next', () => {
    const base = { promptTokens: 1, completionTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 0 }
    expect(mergeUsage(base, undefined)).toEqual(base)
  })
})
