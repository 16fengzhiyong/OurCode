import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AnthropicAdapter } from '@/services/llm/adapters/AnthropicAdapter'
import { ApiConfigGroup, LLMRequest } from '@/types'

vi.mock('@/services/llm/http', () => ({ llmFetch: vi.fn() }))
import { llmFetch } from '@/services/llm/http'

const llmFetchMock = llmFetch as unknown as ReturnType<typeof vi.fn>

const config: ApiConfigGroup = {
  id: 'g1',
  name: 'Anthropic',
  baseUrl: 'https://api.anthropic.com',
  apiKey: 'sk-ant-test',
  systemPrompt: '',
  defaultModel: '',
  provider: 'anthropic',
  customHeaders: {},
  createdAt: 0,
  updatedAt: 0,
}

function baseRequest(): LLMRequest {
  return {
    model: 'claude-sonnet-4-20250514',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'first question' },
      {
        role: 'assistant',
        content: 'let me look',
        toolCalls: [{ id: 'tc_1', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } }],
      },
      { role: 'tool', content: 'found nothing', toolCallId: 'tc_1' },
      { role: 'user', content: 'final turn' },
    ],
    temperature: 0,
    maxTokens: 2048,
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0,
    stream: true,
    tools: [
      { type: 'function', function: { name: 'search', description: 'search the web', parameters: { type: 'object', properties: { q: { type: 'string' } } } } },
    ],
  }
}

/** Small prompt — below the prompt-caching token minimum (2048 estimated). */
function smallRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return { ...baseRequest(), ...overrides }
}

/** Large prompt — comfortably above the prompt-caching token minimum. */
function largeRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    ...baseRequest(),
    messages: [
      { role: 'system', content: 'x'.repeat(9000) },
      { role: 'user', content: 'first question' },
      { role: 'user', content: 'final turn' },
    ],
    ...overrides,
  }
}

/** SSE body that immediately stops the stream. */
function sseStop(): Response {
  const text = `data: ${JSON.stringify({ type: 'message_stop' })}\n\n`
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ type: 'error', error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function drain(adapter: AnthropicAdapter, req: LLMRequest): Promise<any[]> {
  const chunks: any[] = []
  for await (const c of adapter.sendRequest(req, config)) chunks.push(c)
  return chunks
}

beforeEach(() => {
  llmFetchMock.mockReset().mockResolvedValue(sseStop())
})

describe('AnthropicAdapter — prompt caching (cache_control)', () => {
  it('adds cache_control breakpoints + beta header when the prompt is large enough', async () => {
    await drain(new AnthropicAdapter(), largeRequest({ providerCache: true }))

    expect(llmFetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = llmFetchMock.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['anthropic-beta']).toBe('prompt-caching-2024-07-31')

    const body = JSON.parse(init.body)
    // system → block array with cache_control
    expect(body.system).toEqual([{ type: 'text', text: 'x'.repeat(9000), cache_control: { type: 'ephemeral' } }])
    // last tool carries the breakpoint
    const lastTool = body.tools[body.tools.length - 1]
    expect(lastTool.cache_control).toEqual({ type: 'ephemeral' })

    // mid-conversation breakpoint: the second-to-last plain-text user message
    // is converted to a block array with cache_control
    expect(body.messages[body.messages.length - 2].content).toEqual([
      { type: 'text', text: 'first question', cache_control: { type: 'ephemeral' } },
    ])
    // only one mid-conversation breakpoint was injected
    const breakpoints = body.messages.filter((m: any) =>
      Array.isArray(m.content) && m.content.some((b: any) => b.cache_control)
    )
    expect(breakpoints).toHaveLength(1)
  })

  it('emits a plain string system and no cache_control when providerCache is absent', async () => {
    await drain(new AnthropicAdapter(), largeRequest())

    const [url, init] = llmFetchMock.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['anthropic-beta']).toBeUndefined()

    const body = JSON.parse(init.body)
    expect(typeof body.system).toBe('string')
    expect(JSON.stringify(body)).not.toContain('cache_control')
  })

  it('skips cache_control when the prompt is below the token minimum', async () => {
    // Small prompt: emitting breakpoints would trip the provider's
    // "cache_control blocks must be at least 1024 tokens" 400 error.
    const chunks = await drain(new AnthropicAdapter(), smallRequest({ providerCache: true }))

    expect(chunks.some((c) => c.done)).toBe(true)
    const body = JSON.parse(llmFetchMock.mock.calls[0][1].body)
    expect(JSON.stringify(body)).not.toContain('cache_control')
    // The beta header is still harmless to send; the guard is on the breakpoints.
    expect(llmFetchMock.mock.calls[0][1].headers['anthropic-beta']).toBe('prompt-caching-2024-07-31')
  })

  it('retries once without cache_control when the provider rejects with a caching 400', async () => {
    llmFetchMock
      .mockResolvedValueOnce(jsonError(400, 'prompt_caching: cache_control blocks must be at least 1024 tokens'))
      .mockResolvedValueOnce(sseStop())

    const chunks = await drain(new AnthropicAdapter(), largeRequest({ providerCache: true }))

    expect(llmFetchMock).toHaveBeenCalledTimes(2)
    // Retry body has no cache_control anywhere
    const retryBody = JSON.parse(llmFetchMock.mock.calls[1][1].body)
    expect(JSON.stringify(retryBody)).not.toContain('cache_control')
    // Retry still carries the beta header (harmless without breakpoints)
    expect(llmFetchMock.mock.calls[1][1].headers['anthropic-beta']).toBe('prompt-caching-2024-07-31')
    // Stream completed normally
    expect(chunks.some((c) => c.done)).toBe(true)
  })

  it('keeps the final user message untouched (no cache_control on the last turn)', async () => {
    await drain(new AnthropicAdapter(), largeRequest({ providerCache: true }))

    const body = JSON.parse(llmFetchMock.mock.calls[0][1].body)
    const last = body.messages[body.messages.length - 1]
    expect(last.role).toBe('user')
    expect(last.content).toBe('final turn')
  })

  it('handles tool-only histories without crashing the breakpoint search', async () => {
    const req = largeRequest({ providerCache: true })
    req.messages = [
      { role: 'system', content: 'x'.repeat(9000) },
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc_9', type: 'function', function: { name: 'f', arguments: '{}' } }],
      },
      { role: 'tool', content: 'ok', toolCallId: 'tc_9' },
    ]
    await drain(new AnthropicAdapter(), req)

    const body = JSON.parse(llmFetchMock.mock.calls[0][1].body)
    // walk back: tool result (array) → assistant tool call (array) → 'go' (string)
    expect(body.messages[0].content).toEqual([{ type: 'text', text: 'go', cache_control: { type: 'ephemeral' } }])
  })
})
