import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ResponsesAdapter } from '@/services/llm/adapters/ResponsesAdapter'
import { ApiConfigGroup, LLMRequest } from '@/types'

vi.mock('@/services/llm/http', () => ({ llmFetch: vi.fn() }))
import { llmFetch } from '@/services/llm/http'

const llmFetchMock = llmFetch as unknown as ReturnType<typeof vi.fn>

const config: ApiConfigGroup = {
  id: 'g1',
  name: 'Gateway',
  baseUrl: 'https://api.example.com', // bare host → /v1/responses
  apiKey: 'sk-test',
  systemPrompt: '',
  defaultModel: '',
  provider: 'responses',
  customHeaders: {},
  createdAt: 0,
  updatedAt: 0,
}

function makeRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'what is the weather?' },
      {
        role: 'assistant',
        content: 'let me check',
        toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"SF"}' } }],
      },
      { role: 'tool', content: '72°F', toolCallId: 'call_1' },
      { role: 'user', content: 'thanks' },
    ],
    temperature: 0.7,
    maxTokens: 512,
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0,
    stream: false,
    tools: [{ type: 'function', function: { name: 'get_weather', description: 'weather', parameters: { type: 'object' } } }],
    ...overrides,
  }
}

function jsonResponse(payload: any): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sseResponse(events: any[]): Response {
  const text = events.map((e) => `data: ${JSON.stringify(e)}`).join('\n\n') + '\n\n'
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

beforeEach(() => {
  llmFetchMock.mockReset()
})

describe('ResponsesAdapter.sendRequest — request translation', () => {
  it('POSTs to /v1/responses and translates messages into input items', async () => {
    llmFetchMock.mockResolvedValue(jsonResponse({ id: 'r1', output: [], usage: {} }))

    const adapter = new ResponsesAdapter()
    const chunks = []
    for await (const chunk of adapter.sendRequest(makeRequest(), config)) chunks.push(chunk)

    expect(llmFetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = llmFetchMock.mock.calls[0]
    expect(url).toBe('https://api.example.com/v1/responses')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer sk-test')

    const body = JSON.parse(init.body)
    expect(body.model).toBe('gpt-4o')
    expect(body.stream).toBe(false)
    expect(body.temperature).toBe(0.7)
    expect(body.max_output_tokens).toBe(512)
    expect(body.tools).toHaveLength(1)
    expect(body.input).toEqual([
      { role: 'system', content: [{ type: 'input_text', text: 'you are helpful' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'what is the weather?' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: 'let me check' }] },
      { type: 'function_call', call_id: 'call_1', name: 'get_weather', arguments: '{"city":"SF"}' },
      { type: 'function_call_output', call_id: 'call_1', output: '72°F' },
      { role: 'user', content: [{ type: 'input_text', text: 'thanks' }] },
    ])
  })

  it('omits empty assistant text but keeps the function_call item', async () => {
    llmFetchMock.mockResolvedValue(jsonResponse({ id: 'r1', output: [], usage: {} }))

    const req = makeRequest()
    req.messages = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_2', type: 'function', function: { name: 'f', arguments: '{}' } }],
      },
    ]

    const adapter = new ResponsesAdapter()
    const chunks = []
    for await (const chunk of adapter.sendRequest(req, config)) chunks.push(chunk)

    const body = JSON.parse(llmFetchMock.mock.calls[0][1].body)
    expect(body.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'go' }] },
      { type: 'function_call', call_id: 'call_2', name: 'f', arguments: '{}' },
    ])
  })
})

describe('ResponsesAdapter.sendRequest — non-streaming', () => {
  it('parses output_text content, function_call items and usage', async () => {
    llmFetchMock.mockResolvedValue(jsonResponse({
      id: 'r1',
      output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'It is ' }, { type: 'output_text', text: '72°F' }] },
        { type: 'function_call', call_id: 'call_9', name: 'lookup', arguments: '{"q":"1"}' },
      ],
      usage: { input_tokens: 12, output_tokens: 7 },
    }))

    const adapter = new ResponsesAdapter()
    const chunks = []
    for await (const chunk of adapter.sendRequest(makeRequest(), config)) chunks.push(chunk)

    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toEqual({
      content: 'It is 72°F',
      done: false,
      toolCalls: [{ id: 'call_9', type: 'function', function: { name: 'lookup', arguments: '{"q":"1"}' } }],
      usage: { promptTokens: 12, completionTokens: 7 },
    })
    expect(chunks[1]).toEqual({ content: '', done: true })
  })

  it('throws a friendly error on non-OK status', async () => {
    llmFetchMock.mockResolvedValue(new Response('bad key', { status: 401, statusText: 'Unauthorized' }))

    const adapter = new ResponsesAdapter()
    await expect(async () => {
      for await (const _ of adapter.sendRequest(makeRequest(), config)) { /* drain */ }
    }).rejects.toThrow('API 请求失败 (401)')
  })
})

describe('ResponsesAdapter.sendRequest — streaming', () => {
  it('yields text deltas, thinking, tool calls and usage from SSE events', async () => {
    llmFetchMock.mockResolvedValue(sseResponse([
      { type: 'response.output_text.delta', item_id: 'm1', output_index: 0, delta: 'The ' },
      { type: 'response.output_text.delta', item_id: 'm1', output_index: 0, delta: 'temp' },
      { type: 'response.reasoning_summary_text.delta', item_id: 'm1', delta: 'reasoning…' },
      { type: 'response.function_call_arguments.delta', item_id: 'fc1', output_index: 0, delta: '{"cit' },
      { type: 'response.function_call_arguments.delta', item_id: 'fc1', output_index: 0, delta: 'y":"SF"}' },
      {
        type: 'response.output_item.done',
        output: { type: 'function_call', id: 'fc1', call_id: 'call_3', name: 'get_weather', arguments: '{"city":"SF"}' },
      },
      {
        type: 'response.completed',
        response: { usage: { input_tokens: 5, output_tokens: 3 } },
      },
    ]))

    const adapter = new ResponsesAdapter()
    const chunks = []
    for await (const chunk of adapter.sendRequest(makeRequest({ stream: true }), config)) chunks.push(chunk)

    expect(chunks[0]).toEqual({ content: 'The ', done: false })
    expect(chunks[1]).toEqual({ content: 'temp', done: false })
    expect(chunks[2]).toEqual({ content: '', thinking: 'reasoning…', done: false })

    const last = chunks[chunks.length - 1]
    expect(last.done).toBe(true)
    expect(last.toolCalls).toEqual([{ id: 'call_3', type: 'function', function: { name: 'get_weather', arguments: '{"city":"SF"}' } }])
    expect(last.usage).toEqual({ promptTokens: 5, completionTokens: 3 })
  })

  it('ends with a plain done chunk when no tool calls were made', async () => {
    llmFetchMock.mockResolvedValue(sseResponse([
      { type: 'response.output_text.delta', item_id: 'm1', output_index: 0, delta: 'hi' },
      { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1 } } },
    ]))

    const adapter = new ResponsesAdapter()
    const chunks = []
    for await (const chunk of adapter.sendRequest(makeRequest({ stream: true }), config)) chunks.push(chunk)

    expect(chunks).toHaveLength(2)
    expect(chunks[1]).toEqual({ content: '', done: true, usage: { promptTokens: 1, completionTokens: 1 } })
  })
})

describe('ResponsesAdapter.fetchModels', () => {
  it('calls /v1/models and returns sorted model ids', async () => {
    llmFetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'b-model' }, { id: 'a-model' }] }))

    const adapter = new ResponsesAdapter()
    const models = await adapter.fetchModels(config)

    expect(llmFetchMock).toHaveBeenCalledTimes(1)
    expect(llmFetchMock.mock.calls[0][0]).toBe('https://api.example.com/v1/models')
    expect(models).toEqual(['a-model', 'b-model'])
  })
})
