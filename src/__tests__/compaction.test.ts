import { describe, it, expect } from 'vitest'
import {
  maybeCompact,
  findKeepBoundary,
  buildSummaryBlock,
  isSummaryMessage,
  getContextWindow,
  DEFAULT_CONTEXT_WINDOW,
  SUMMARY_MARKER,
  CompactMessage,
} from '@/services/llm/compaction'
import { useConfigStore } from '@/stores/configStore'

/**
 * Compaction logic tests — pure orchestration with a fake summarizer, so no
 * LLM calls happen. Covers the trigger timing (estimate-confirmed overflow
 * only, or force), the request-view rebuild (original messages untouched) and
 * the fallback contract (null = caller keeps current behavior).
 */

// estimateTokens: 1 token per char for simplicity.
const est = (t: string) => t.length
const sys: CompactMessage = { role: 'system', content: 'SYSTEM PROMPT' }
const user = (content: string): CompactMessage => ({ role: 'user', content })
const assistant = (content: string): CompactMessage => ({ role: 'assistant', content })

/** Summarizer stub: records its input and returns a fixed summary. */
function fakeSummarize(spy?: { anchor: string; history: string }[]) {
  return async (input: { anchor: string; history: string }) => {
    spy?.push(input)
    return '## 目标\n完成功能 X\n## 关键细节\n文件 src/a.ts 已修改'
  }
}

function baseOpts(overrides: Partial<Parameters<typeof maybeCompact>[0]> = {}) {
  return {
    session: {},
    messages: [sys, user('u1'), assistant('a1'), user('u2')],
    compactionEnabled: true,
    estimateTokens: est,
    summarize: fakeSummarize(),
    ...overrides,
  }
}

describe('findKeepBoundary', () => {
  it('returns the index of the last user message', () => {
    expect(findKeepBoundary([sys, user('u1'), assistant('a1'), user('u2')])).toBe(3)
  })

  it('returns 0 when there is no user message', () => {
    expect(findKeepBoundary([sys])).toBe(0)
    expect(findKeepBoundary([])).toBe(0)
  })
})

describe('summary message marker', () => {
  it('buildSummaryBlock marks the message, isSummaryMessage recognizes it', () => {
    const block = buildSummaryBlock('SUM')
    expect(block.startsWith(SUMMARY_MARKER)).toBe(true)
    expect(isSummaryMessage({ role: 'system', content: block })).toBe(true)
    expect(isSummaryMessage({ role: 'system', content: 'plain system' })).toBe(false)
    expect(isSummaryMessage({ role: 'user', content: block })).toBe(false)
  })
})

describe('maybeCompact', () => {
  it('does nothing when compaction is disabled', async () => {
    const result = await maybeCompact(baseOpts({ compactionEnabled: false }))
    expect(result).toBeNull()
  })

  it('does nothing when the estimate is under the budget', async () => {
    const result = await maybeCompact(baseOpts({ contextWindow: 1000 })) // budget 800 >> 4 chars
    expect(result).toBeNull()
  })

  it('does nothing when aborted', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const result = await maybeCompact(baseOpts({ signal: ctrl.signal }))
    expect(result).toBeNull()
  })

  it('compacts only when the estimate confirms overflow, keeping the current user turn verbatim', async () => {
    const result = await maybeCompact(baseOpts({ contextWindow: 100 })) // budget 80 < 4 chars? no — messages are tiny
    expect(result).toBeNull()

    // Long history → over the 80-token budget.
    const big = [sys, user('x'.repeat(100)), assistant('y'.repeat(100)), user('CURRENT TURN')]
    const compacted = await maybeCompact(baseOpts({ messages: big, contextWindow: 200 })) // budget 160 < 200
    expect(compacted).not.toBeNull()
    expect(compacted!.summary).toContain('## 目标')
    expect(compacted!.boundaryCount).toBe(2) // user+assistant summarized, current turn kept
    // Rebuilt request: [system, summary, current turn] — nothing else.
    expect(compacted!.messages.map((m) => m.role)).toEqual(['system', 'system', 'user'])
    expect(compacted!.messages[2]).toEqual(user('CURRENT TURN'))
    expect(compacted!.messages[1].content!.startsWith(SUMMARY_MARKER)).toBe(true)
  })

  it('force skips the budget check (context-overflow fallback)', async () => {
    const tiny = [sys, user('u1'), assistant('a1'), user('u2')]
    const result = await maybeCompact(baseOpts({ messages: tiny, force: true }))
    expect(result).not.toBeNull()
  })

  it('does not summarize when only the system prompt precedes the current turn', async () => {
    const result = await maybeCompact(baseOpts({ messages: [sys, user('u1')], force: true }))
    expect(result).toBeNull()
  })

  it('passes the previous summary as the anchor and excludes the summary message from history', async () => {
    const calls: Array<{ anchor: string; history: string }> = []
    const oldBlock = buildSummaryBlock('OLD SUMMARY')
    const messages = [sys, { role: 'system', content: oldBlock }, user('new question'), assistant('answer'), user('and more')]
    const result = await maybeCompact(
      baseOpts({
        session: { summary: 'OLD SUMMARY', summaryMessageCount: 1 },
        messages,
        force: true,
        summarize: fakeSummarize(calls),
      }),
    )
    expect(result).not.toBeNull()
    expect(calls.length).toBe(1)
    expect(calls[0].anchor).toBe('OLD SUMMARY')
    // The old summary message is not re-sent as history (anchor replaces it).
    expect(calls[0].history).not.toContain(SUMMARY_MARKER)
    expect(calls[0].history).toContain('new question')
  })

  it('returns null when the summarizer throws (caller falls back to the lossy trim)', async () => {
    const result = await maybeCompact(
      baseOpts({ force: true, summarize: async () => { throw new Error('summarizer down') } }),
    )
    expect(result).toBeNull()
  })

  it('returns null when the summarizer returns empty', async () => {
    const result = await maybeCompact(baseOpts({ force: true, summarize: async () => '' }))
    expect(result).toBeNull()
  })

  it('caps the summarizer input size (bounded cost on huge contexts)', async () => {
    const calls: Array<{ anchor: string; history: string }> = []
    const big = [sys, user('x'.repeat(1_000_000)), user('CURRENT')]
    const result = await maybeCompact(
      baseOpts({ messages: big, force: true, summarize: fakeSummarize(calls) }),
    )
    expect(result).not.toBeNull()
    expect(calls[0].history.length).toBeLessThan(500_000)
  })
})

describe('getContextWindow', () => {
  it('prefers a user-defined custom model window over the static table', () => {
    const prev = useConfigStore.getState().customModels
    useConfigStore.setState({ customModels: [{ id: 'my-ollama', name: 'my-ollama', provider: 'ollama', contextWindow: 8192, createdAt: 0 }] })
    try {
      expect(getContextWindow('my-ollama')).toBe(8192)
    } finally {
      useConfigStore.setState({ customModels: prev })
    }
  })

  it('falls back to the static metadata table for known models', () => {
    expect(getContextWindow('deepseek-chat')).toBe(200000)
  })

  it('falls back to the default for unknown models', () => {
    expect(getContextWindow('totally-unknown-model-xyz')).toBe(DEFAULT_CONTEXT_WINDOW)
  })
})
