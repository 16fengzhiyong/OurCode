import { describe, it, expect, vi } from 'vitest'
import { resolveThinkingLevel, normalizeReasoningEffort, ModelParams, LLMRequest } from '@/types'
import { DeepSeekAdapter } from '@/services/llm/adapters/DeepSeekAdapter'
import { AnthropicAdapter } from '@/services/llm/adapters/AnthropicAdapter'
import { ApiConfigGroup } from '@/types'

vi.mock('@/services/llm/http', () => ({ llmFetch: vi.fn() }))
import { llmFetch } from '@/services/llm/http'

const llmFetchMock = llmFetch as unknown as ReturnType<typeof vi.fn>

function baseParams(overrides: Partial<ModelParams> = {}): ModelParams {
  return {
    temperature: 1.0,
    maxTokens: 0,
    topP: 1.0,
    frequencyPenalty: 0,
    presencePenalty: 0,
    thinking: false,
    reasoningEffort: 'high',
    ...overrides,
  }
}

const config: ApiConfigGroup = {
  id: 'g1',
  name: 'Test',
  baseUrl: 'https://api.example.com',
  apiKey: 'sk-test',
  systemPrompt: '',
  defaultModel: '',
  provider: 'deepseek',
  customHeaders: {},
  createdAt: 0,
  updatedAt: 0,
}

describe('resolveThinkingLevel', () => {
  it('prefers the unified thinkingLevel field', () => {
    expect(resolveThinkingLevel(baseParams({ thinkingLevel: 'max' }))).toBe('max')
    expect(resolveThinkingLevel(baseParams({ thinkingLevel: 'off' }))).toBe('off')
  })

  it('falls back to thinking + reasoningEffort for legacy sessions', () => {
    expect(resolveThinkingLevel(baseParams({ thinking: true, reasoningEffort: 'medium' }))).toBe('medium')
    expect(resolveThinkingLevel(baseParams({ thinking: false, reasoningEffort: 'high' }))).toBe('off')
  })
})

describe('normalizeReasoningEffort', () => {
  it('maps max down to high for OpenAI-style providers', () => {
    expect(normalizeReasoningEffort('max')).toBe('high')
    expect(normalizeReasoningEffort('low')).toBe('low')
    expect(normalizeReasoningEffort('medium')).toBe('medium')
    expect(normalizeReasoningEffort(undefined)).toBe('high')
  })
})

function jsonResponse(payload: any): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    model: 'deepseek-chat',
    messages: [{ role: 'system', content: 'hi' }, { role: 'user', content: 'hello' }],
    temperature: 1.0,
    maxTokens: 0,
    topP: 1.0,
    frequencyPenalty: 0,
    presencePenalty: 0,
    stream: false,
    ...overrides,
  }
}

async function collectAll<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of gen) out.push(item)
  return out
}

function capturedBody(): any {
  const [, init] = llmFetchMock.mock.calls[llmFetchMock.mock.calls.length - 1]
  return JSON.parse(init.body)
}

describe('DeepSeekAdapter thinking wiring', () => {
  it('sends thinking + normalized effort when thinking is on (max → high)', async () => {
    llmFetchMock.mockResolvedValue(jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'ok', reasoning_content: 'think…' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }))
    const adapter = new DeepSeekAdapter()
    await collectAll(adapter.sendRequest(
      makeRequest({ thinking: true, reasoningEffort: 'max' }),
      config,
    ))
    const body = capturedBody()
    expect(body.thinking).toEqual({ type: 'enabled' })
    expect(body.reasoning_effort).toBe('high')
  })

  it('omits thinking params entirely when thinking is off', async () => {
    llmFetchMock.mockResolvedValue(jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }))
    const adapter = new DeepSeekAdapter()
    await collectAll(adapter.sendRequest(
      makeRequest({ thinking: false, reasoningEffort: undefined }),
      config,
    ))
    const body = capturedBody()
    expect(body.thinking).toBeUndefined()
    expect(body.reasoning_effort).toBeUndefined()
  })
})

describe('AnthropicAdapter max budget', () => {
  it('maps max effort to a 16384-token thinking budget', async () => {
    llmFetchMock.mockResolvedValue(jsonResponse({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 5, output_tokens: 5 },
    }))
    const adapter = new AnthropicAdapter()
    await collectAll(adapter.sendRequest(
      makeRequest({
        model: 'claude-sonnet-4-5',
        thinking: true,
        reasoningEffort: 'max',
        maxTokens: 8192,
      }),
      { ...config, provider: 'anthropic', apiFormat: 'anthropic' },
    ))
    const body = capturedBody()
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 16384 })
  })
})
