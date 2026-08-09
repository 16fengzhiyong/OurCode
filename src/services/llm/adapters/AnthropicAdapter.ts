import { ApiConfigGroup, LLMRequest, LLMStreamChunk, LLMToolCall } from '@/types'
import { LLMAdapter } from '../types'
import { llmFetch } from '../http'
import { buildChatUrl } from '../endpoints'

const ANTHROPIC_MODELS = [
  'claude-sonnet-4-20250514',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229',
  'claude-3-haiku-20240307',
]

/**
 * Rough input-token estimate (chars ÷ 3.5). Used only to guard prompt caching:
 * Anthropic requires every cached segment to be ≥ 1024 tokens (2048 on some
 * models) and returns a 400 when a cache_control breakpoint sits on a smaller
 * prompt, so we skip breakpoints below a safe margin.
 */
function estimateRequestTokens(req: LLMRequest): number {
  let chars = 0
  for (const m of req.messages) {
    chars += (m.content || '').length
    for (const tc of m.toolCalls || []) {
      chars += tc.function.name.length + tc.function.arguments.length
    }
  }
  for (const t of req.tools || []) {
    chars += t.function.name.length + t.function.description.length
    chars += JSON.stringify(t.function.parameters || {}).length
  }
  return Math.ceil(chars / 3.5)
}

/** Minimum estimated input tokens before cache_control breakpoints are emitted. */
const PROMPT_CACHE_MIN_TOKENS = 2048

export class AnthropicAdapter implements LLMAdapter {
  async *sendRequest(req: LLMRequest, config: ApiConfigGroup, signal?: AbortSignal): AsyncGenerator<LLMStreamChunk> {
    const url = buildChatUrl(config.baseUrl, 'anthropic', req.model)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      ...config.customHeaders,
    }
    // Prompt caching (cache_control) needs the beta header on some gateways;
    // harmless on GA accounts.
    if (req.providerCache) {
      headers['anthropic-beta'] = 'prompt-caching-2024-07-31'
    }

    // Prompt caching minimums: each cached segment must be ≥1024 tokens (some
    // models 2048+) or the provider rejects the request with a 400. Only emit
    // breakpoints when the estimated input is comfortably above the minimum.
    const providerCache = !!(req.providerCache && estimateRequestTokens(req) >= PROMPT_CACHE_MIN_TOKENS)

    /**
     * Build the request body. `cache` controls cache_control breakpoints; the
     * body is rebuilt from scratch on the cache fallback path so the previous
     * mutation can't leak into the retry.
     */
    const buildBody = (cache: boolean): { body: Record<string, any>; messages: any[] } => {
      // Anthropic: separate system message from messages array
      let systemPrompt = ''
      // any[] — the cache_control breakpoint below rewrites a message's content
      // into a block array, which doesn't fit the mapped union type.
      const messages: any[] = req.messages
        .filter((m) => {
          if (m.role === 'system') {
            systemPrompt = m.content
            return false
          }
          return true
        })
        .map((m) => {
          // Tool result messages for Anthropic
          if (m.role === 'tool' && m.toolCallId) {
            return {
              role: 'user' as const,
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: m.toolCallId,
                  content: m.content,
                },
              ],
            }
          }
          // Assistant messages with tool calls
          if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
            const content: any[] = []
            if (m.content) {
              content.push({ type: 'text', text: m.content })
            }
            for (const tc of m.toolCalls) {
              content.push({
                type: 'tool_use',
                id: tc.id,
                name: tc.function.name,
                input: JSON.parse(tc.function.arguments),
              })
            }
            return { role: 'assistant' as const, content }
          }
          return {
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }
        })

      const body: Record<string, any> = {
        model: req.model,
        messages,
        max_tokens: req.maxTokens > 0 ? req.maxTokens : 4096,
        stream: req.stream,
        temperature: req.temperature,
        top_p: req.topP,
      }

      // Deep thinking: Anthropic extended thinking maps effort to a token budget
      // (low/medium/high -> 2048/4096/8192). max_tokens must stay above the budget.
      if (req.thinking) {
        const effortBudgets = { low: 2048, medium: 4096, high: 8192 }
        const budget = effortBudgets[req.reasoningEffort || 'high']
        body.thinking = { type: 'enabled', budget_tokens: budget }
        if (body.max_tokens <= budget) body.max_tokens = budget + 2048
      }

      if (systemPrompt) {
        body.system = systemPrompt
      }

      // Add tools if provided (convert from OpenAI format to Anthropic format)
      if (req.tools && req.tools.length > 0) {
        body.tools = req.tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters,
        }))
      }

      // Anthropic prompt caching: mark cache_control breakpoints so the repeated
      // prefix (system + tools + conversation history) is billed at the cached
      // read rate instead of full price on every turn.
      if (cache) {
        if (typeof body.system === 'string' && body.system) {
          body.system = [{ type: 'text', text: body.system, cache_control: { type: 'ephemeral' } }]
        }
        // Cache the tools segment: the breakpoint goes on the LAST tool.
        if (Array.isArray(body.tools) && body.tools.length > 0) {
          const last = body.tools[body.tools.length - 1]
          body.tools[body.tools.length - 1] = { ...last, cache_control: { type: 'ephemeral' } }
        }
        // Mid-conversation breakpoint: walk back from the second-to-last message
        // (the final message can't carry cache_control) for a plain-text message
        // — skip tool_result / tool_use blocks — and cache the history up to it.
        // The next turn's request then shares that byte-identical prefix.
        const start = Math.max(0, messages.length - 6)
        for (let i = messages.length - 2; i >= start; i--) {
          const m = messages[i]
          if (typeof m.content === 'string' && m.content) {
            messages[i] = {
              ...m,
              content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }],
            }
            break
          }
        }
      }

      return { body, messages }
    }

    const { body } = buildBody(providerCache)
    let response = await llmFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    }, { stream: true, skipTlsVerify: !!config.skipTlsVerify })

    if (!response.ok) {
      // The provider rejected the cache_control breakpoints (usually a segment
      // below the token minimum) — retry once without prompt caching.
      let errorText = await response.text().catch(() => '')
      if (providerCache && /cache/i.test(errorText)) {
        const { body: retryBody } = buildBody(false)
        response = await llmFetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(retryBody),
          signal,
        }, { stream: true, skipTlsVerify: !!config.skipTlsVerify })
        errorText = ''
      }
      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        throw new Error(`Anthropic API 请求失败 (${response.status}): ${errText || response.statusText}`)
      }
    }

    if (!req.stream) {
      const data = await response.json()
      const textBlock = data.content?.find((b: any) => b.type === 'text')
      const toolBlocks = data.content?.filter((b: any) => b.type === 'tool_use') || []
      const toolCalls: LLMToolCall[] = toolBlocks.map((b: any) => ({
        id: b.id,
        type: 'function' as const,
        function: {
          name: b.name,
          arguments: JSON.stringify(b.input),
        },
      }))
      yield {
        content: textBlock?.text || '',
        done: false,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: data.usage ? { promptTokens: data.usage.input_tokens, completionTokens: data.usage.output_tokens } : undefined,
      }
      yield { content: '', done: true }
      return
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const toolCallsAcc: Map<number, { id: string; name: string; arguments: string }> = new Map()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()!

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)

          try {
            const json = JSON.parse(data)

            if (json.type === 'content_block_start') {
              if (json.content_block?.type === 'tool_use') {
                toolCallsAcc.set(json.index, {
                  id: json.content_block.id,
                  name: json.content_block.name,
                  arguments: '',
                })
              }
            }

            if (json.type === 'content_block_delta') {
              if (json.delta?.type === 'text_delta' && json.delta?.text) {
                yield { content: json.delta.text, done: false }
              }
              if (json.delta?.type === 'thinking_delta' && json.delta?.thinking) {
                yield { content: '', thinking: json.delta.thinking, done: false }
              }
              if (json.delta?.type === 'input_json_delta' && json.delta?.partial_json) {
                const acc = toolCallsAcc.get(json.index)
                if (acc) {
                  acc.arguments += json.delta.partial_json
                }
              }
            }

            if (json.type === 'message_delta' && json.usage) {
              yield {
                content: '',
                done: false,
                usage: { promptTokens: 0, completionTokens: json.usage.output_tokens },
              }
            }

            if (json.type === 'message_stop') {
              // Yield accumulated tool calls if any
              if (toolCallsAcc.size > 0) {
                const toolCalls: LLMToolCall[] = Array.from(toolCallsAcc.values()).map((tc) => ({
                  id: tc.id,
                  type: 'function' as const,
                  function: {
                    name: tc.name,
                    arguments: tc.arguments,
                  },
                }))
                yield { content: '', toolCalls, done: true }
              } else {
                yield { content: '', done: true }
              }
              return
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  async fetchModels(_config: ApiConfigGroup): Promise<string[]> {
    return ANTHROPIC_MODELS
  }
}
