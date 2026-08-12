import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sendLLMRequest, configureLLMCache, configureLLMRetry } from '@/services/llm/LLMClient'
import { ApiConfigGroup, LLMRequest } from '@/types'

/**
 * Auto-retry tests — the adapter fails according to a script (queue of
 * errors / null = succeed) and the test asserts how many attempts the
 * request took. Retry must only fire BEFORE any chunk was produced, and only
 * for transient failures (timeout / network / rate-limit / 5xx).
 */
const openaiBehavior = vi.hoisted(() => ({
  failures: [] as Array<Error | null>,
  /** When true the adapter yields one chunk then throws mid-stream. */
  failAfterFirstChunk: false,
  calls: [] as any[],
}))

vi.mock('@/services/llm/adapters/OpenAIAdapter', () => ({
  OpenAIAdapter: class {
    async *sendRequest(req: any) {
      openaiBehavior.calls.push(req)
      const fail = openaiBehavior.failures.shift()
      if (fail) throw fail
      yield { content: 'hello', done: false }
      if (openaiBehavior.failAfterFirstChunk) throw new Error('stream interrupted mid-way')
      yield { content: '', done: true, usage: { promptTokens: 5, completionTokens: 3 } }
    }
    async fetchModels() { return [] }
  },
}))

vi.mock('@/services/llm/responseCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/llm/responseCache')>()
  return {
    ...actual,
    fetchCachedResponse: async () => null,
    storeCachedResponse: async () => {},
  }
})

const config: ApiConfigGroup = {
  id: 'g1',
  name: 'Test',
  baseUrl: 'https://api.example.com',
  apiKey: 'sk-test',
  systemPrompt: '',
  defaultModel: '',
  provider: 'openai',
  customHeaders: {},
  createdAt: 0,
  updatedAt: 0,
}

function makeRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'hello' },
    ],
    temperature: 0,
    maxTokens: 512,
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0,
    stream: true,
    ...overrides,
  }
}

async function drain(gen: AsyncGenerator<any>): Promise<{ chunks: any[]; error?: unknown }> {
  const chunks: any[] = []
  try {
    for await (const c of gen) chunks.push(c)
  } catch (error) {
    return { chunks, error }
  }
  return { chunks }
}

beforeEach(() => {
  openaiBehavior.failures = []
  openaiBehavior.failAfterFirstChunk = false
  openaiBehavior.calls = []
  // Response cache OFF (retry tests target the retry loop, not caching).
  configureLLMCache({ responseCacheEnabled: () => false, anthropicPromptCacheEnabled: () => false })
  // Zero-delay backoff so tests don't sleep; defaults = enabled, 2 retries.
  configureLLMRetry({ enabled: () => true, maxRetries: () => 2, delay: () => 0 })
})

describe('sendLLMRequest auto-retry', () => {
  it('retries a rate-limit (429) and succeeds on the next attempt', async () => {
    openaiBehavior.failures = [new Error('API 请求失败 (429): rate limit exceeded'), null]
    const { chunks, error } = await drain(sendLLMRequest(makeRequest(), config))
    expect(error).toBeUndefined()
    expect(openaiBehavior.calls.length).toBe(2)
    expect(chunks.map((c) => c.content).join('')).toContain('hello')
  })

  it('retries a 5xx server error', async () => {
    openaiBehavior.failures = [new Error('API 请求失败 (503): overloaded'), null]
    const { error } = await drain(sendLLMRequest(makeRequest(), config))
    expect(error).toBeUndefined()
    expect(openaiBehavior.calls.length).toBe(2)
  })

  it('retries a network failure', async () => {
    openaiBehavior.failures = [new Error('Failed to fetch'), null]
    const { error } = await drain(sendLLMRequest(makeRequest(), config))
    expect(error).toBeUndefined()
    expect(openaiBehavior.calls.length).toBe(2)
  })

  it('retries an idle-timeout (AbortError is translated to 请求超时 → timeout)', async () => {
    const abortErr = Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' })
    openaiBehavior.failures = [abortErr, null]
    const { error } = await drain(sendLLMRequest(makeRequest(), config))
    expect(error).toBeUndefined()
    expect(openaiBehavior.calls.length).toBe(2)
  })

  it('never retries an auth error (401)', async () => {
    openaiBehavior.failures = [new Error('API 请求失败 (401): invalid api key')]
    const { error } = await drain(sendLLMRequest(makeRequest(), config))
    expect(error).toBeInstanceOf(Error)
    expect(openaiBehavior.calls.length).toBe(1)
  })

  it('never retries a bad request (400)', async () => {
    openaiBehavior.failures = [new Error('API 请求失败 (400): bad payload')]
    const { error } = await drain(sendLLMRequest(makeRequest(), config))
    expect(error).toBeInstanceOf(Error)
    expect(openaiBehavior.calls.length).toBe(1)
  })

  it('never retries a context-overflow rejection (the fix is compaction, not retry)', async () => {
    openaiBehavior.failures = [new Error('API 请求失败 (400): prompt is too long. reduce the length of the messages')]
    const { error } = await drain(sendLLMRequest(makeRequest(), config))
    expect(error).toBeInstanceOf(Error)
    expect(openaiBehavior.calls.length).toBe(1)
  })

  it('never retries once the stream has produced output (would replay partial content)', async () => {
    openaiBehavior.failAfterFirstChunk = true
    const { chunks, error } = await drain(sendLLMRequest(makeRequest(), config))
    expect(error).toBeInstanceOf(Error)
    expect(chunks.some((c) => c.content)).toBe(true)
    // The stream had already yielded content — the failure must surface as-is.
    expect(openaiBehavior.calls.length).toBe(1)
  })

  it('respects the configured max retries', async () => {
    configureLLMRetry({ enabled: () => true, maxRetries: () => 2, delay: () => 0 })
    openaiBehavior.failures = [
      new Error('API 请求失败 (429): a'),
      new Error('API 请求失败 (429): b'),
      new Error('API 请求失败 (429): c'),
    ]
    const { error } = await drain(sendLLMRequest(makeRequest(), config))
    expect(error).toBeInstanceOf(Error)
    // 1 initial + 2 retries = 3 attempts, then the error surfaces.
    expect(openaiBehavior.calls.length).toBe(3)
  })

  it('does not retry at all when disabled', async () => {
    configureLLMRetry({ enabled: () => false, maxRetries: () => 5, delay: () => 0 })
    openaiBehavior.failures = [new Error('API 请求失败 (429): a'), null]
    const { error } = await drain(sendLLMRequest(makeRequest(), config))
    expect(error).toBeInstanceOf(Error)
    expect(openaiBehavior.calls.length).toBe(1)
  })
})
