import { describe, it, expect } from 'vitest'
import { isSilentContextOverflow } from '@/services/llm/classify'

/**
 * Silent context-overflow detection — providers/relays that accept an oversized
 * request (truncate or over-count) never throw, so the response shape has to be
 * checked directly. Mirrors Pi's isContextOverflow cases 2 & 3.
 */
describe('isSilentContextOverflow', () => {
  const win = 128000

  it('detects length-stop with zero output when the input fills the window', () => {
    expect(isSilentContextOverflow({
      finishReason: 'length',
      inputTokens: 126800, // >= 99% of 128k
      outputTokens: 0,
      contextWindow: win,
    })).toBe(true)
  })

  it('does NOT flag length-stop when the model still produced output', () => {
    expect(isSilentContextOverflow({
      finishReason: 'length',
      inputTokens: 126800,
      outputTokens: 500, // there WAS room to generate
      contextWindow: win,
    })).toBe(false)
  })

  it('does NOT flag length-stop when the input did not fill the window', () => {
    expect(isSilentContextOverflow({
      finishReason: 'length',
      inputTokens: 100000, // < 99%
      outputTokens: 0,
      contextWindow: win,
    })).toBe(false)
  })

  it('detects silent accept: provider reported input exceeding the window', () => {
    expect(isSilentContextOverflow({
      finishReason: 'stop',
      inputTokens: 129000, // > 128k — provider accepted more than we configured
      outputTokens: 100,
      contextWindow: win,
    })).toBe(true)
  })

  it('returns false for a normal in-window response', () => {
    expect(isSilentContextOverflow({
      finishReason: 'stop',
      inputTokens: 50000,
      outputTokens: 800,
      contextWindow: win,
    })).toBe(false)
  })
})
