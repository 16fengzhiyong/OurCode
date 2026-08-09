import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sendLLMRequest, configureLLMCache } from '@/services/llm/LLMClient'
import { buildCacheKey, shouldCache } from '@/services/llm/responseCache'
import { ApiConfigGroup, LLMRequest } from '@/types'

// Mock the cache persistence helpers so hits/misses are controllable without IPC.
const cacheState = vi.hoisted(() => ({
  fetch: vi.fn(async () => null),
  store: vi.fn(async () => {}),
}))

vi.mock('@/services/llm/responseCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/llm/responseCache')>()
  return {
    ...actual,
    fetchCachedResponse: cacheState.fetch,
    storeCachedResponse: cacheState.store,
  }
})

// Record the requests the adapter receives.
const openaiCalls = vi.hoisted(() => ({ reqs: [] as any[] }))
const anthropicCalls = vi.hoisted(() => ({ reqs: [] as any[] }))

vi.mock('@/services/llm/adapters/OpenAIAdapter', () => ({
  OpenAIAdapter: class {
    async *sendRequest(req: any) {
      openaiCalls.reqs.push(req)
      yield { content: 'hello', done: false, usage: { promptTokens: 5, completionTokens: 3 } }
      yield { content: '', done: true }
    }
    async fetchModels() { return [] }
  },
}))

vi.mock('@/services/llm/adapters/AnthropicAdapter', () => ({
  AnthropicAdapter: class {
    async *sendRequest(req: any) {
      anthropicCalls.reqs.push(req)
      yield { content: 'hello', done: false }
      yield { content: '', done: true }
    }
    async fetchModels() { return ['claude-test'] }
  },
}))

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

async function drain(gen: AsyncGenerator<any>): Promise<any[]> {
  const chunks: any[] = []
  for await (const c of gen) chunks.push(c)
  return chunks
}

beforeEach(() => {
  openaiCalls.reqs = []
  anthropicCalls.reqs = []
  cacheState.fetch.mockReset().mockResolvedValue(null)
  cacheState.store.mockReset().mockResolvedValue(undefined)
  // Default: response cache ON, anthropic prompt cache ON.
  configureLLMCache({ responseCacheEnabled: () => true, anthropicPromptCacheEnabled: () => true })
})

describe('buildCacheKey', () => {
  it('is stable for identical requests', async () => {
    const a = await buildCacheKey(makeRequest(), 'openai')
    const b = await buildCacheKey(makeRequest(), 'openai')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs when params or messages change', async () => {
    const base = await buildCacheKey(makeRequest(), 'openai')
    const warmer = await buildCacheKey(makeRequest({ temperature: 0.7 }), 'openai')
    const differentMsg = await buildCacheKey(makeRequest({ messages: [{ role: 'user', content: 'other' }] }), 'openai')
    const otherProvider = await buildCacheKey(makeRequest(), 'deepseek')
    expect(warmer).not.toBe(base)
    expect(differentMsg).not.toBe(base)
    expect(otherProvider).not.toBe(base)
  })

  it('ignores providerCache flag (not part of the request semantics)', async () => {
    const plain = await buildCacheKey(makeRequest(), 'openai')
    const cached = await buildCacheKey(makeRequest({ providerCache: true }), 'openai')
    expect(plain).toBe(cached)
  })
})

describe('shouldCache', () => {
  it('caches only deterministic (temperature 0) requests', () => {
    expect(shouldCache(makeRequest())).toBe(true)
    expect(shouldCache(makeRequest({ temperature: 0.5 }))).toBe(false)
    expect(shouldCache(makeRequest({ temperature: 1 }))).toBe(false)
  })
})

describe('sendLLMRequest — client-side response cache', () => {
  it('replays a cached response without calling the adapter', async () => {
    cacheState.fetch.mockResolvedValueOnce({
      chunks: [
        { content: 'cached reply', thinking: 'thought', done: false },
        { content: '', done: true },
      ],
      tokensIn: 42,
      tokensOut: 7,
    })

    const chunks = await drain(sendLLMRequest(makeRequest(), config))

    expect(openaiCalls.reqs).toHaveLength(0)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toEqual({
      content: 'cached reply',
      thinking: 'thought',
      done: false,
      cacheHit: { savedTokensIn: 42, savedTokensOut: 7 },
    })
    expect(chunks[1]).toEqual({ content: '', done: true, cacheHit: { savedTokensIn: 42, savedTokensOut: 7 } })
    expect(cacheState.store).not.toHaveBeenCalled()
  })

  it('persists a completed response on a cache miss', async () => {
    const req = makeRequest()
    await drain(sendLLMRequest(req, config))

    expect(openaiCalls.reqs).toHaveLength(1)
    expect(cacheState.fetch).toHaveBeenCalledTimes(1)
    expect(cacheState.store).toHaveBeenCalledTimes(1)
    const [key, provider, model, chunks, tokensIn, tokensOut] = cacheState.store.mock.calls[0]
    expect(provider).toBe('openai')
    expect(model).toBe('gpt-4o')
    expect(tokensIn).toBe(5)
    expect(tokensOut).toBe(3)
    expect(chunks.map((c: any) => c.content)).toEqual(['hello', ''])
    expect(key).toBe(await buildCacheKey(req, 'openai'))
  })

  it('does not cache when the consumer aborts mid-stream', async () => {
    const gen = sendLLMRequest(makeRequest(), config)
    await gen.next() // first chunk consumed
    await gen.return() // consumer breaks

    expect(cacheState.store).not.toHaveBeenCalled()
  })

  it('skips the cache entirely for non-deterministic requests', async () => {
    await drain(sendLLMRequest(makeRequest({ temperature: 0.7 }), config))

    expect(cacheState.fetch).not.toHaveBeenCalled()
    expect(cacheState.store).not.toHaveBeenCalled()
    expect(openaiCalls.reqs).toHaveLength(1)
  })

  it('skips the cache when disabled via configureLLMCache', async () => {
    configureLLMCache({ responseCacheEnabled: () => false })
    await drain(sendLLMRequest(makeRequest(), config))

    expect(cacheState.fetch).not.toHaveBeenCalled()
    expect(cacheState.store).not.toHaveBeenCalled()
    expect(openaiCalls.reqs).toHaveLength(1)
  })
})

describe('sendLLMRequest — Anthropic providerCache flag', () => {
  it('sets providerCache=true for anthropic when prompt caching is enabled', async () => {
    const anthropicConfig = { ...config, provider: 'anthropic' as const }
    await drain(sendLLMRequest(makeRequest(), anthropicConfig))

    expect(anthropicCalls.reqs).toHaveLength(1)
    expect(anthropicCalls.reqs[0].providerCache).toBe(true)
  })

  it('does not set providerCache when prompt caching is disabled', async () => {
    configureLLMCache({ anthropicPromptCacheEnabled: () => false })
    const anthropicConfig = { ...config, provider: 'anthropic' as const }
    await drain(sendLLMRequest(makeRequest(), anthropicConfig))

    expect(anthropicCalls.reqs[0].providerCache).toBeUndefined()
  })

  it('never sets providerCache for non-anthropic providers', async () => {
    await drain(sendLLMRequest(makeRequest(), config))

    expect(openaiCalls.reqs[0].providerCache).toBeUndefined()
  })
})
