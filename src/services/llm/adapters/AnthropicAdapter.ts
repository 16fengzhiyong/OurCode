import { ApiConfigGroup, LLMRequest, LLMStreamChunk, LLMToolCall } from '@/types'
import { LLMAdapter } from '../types'

const ANTHROPIC_MODELS = [
  'claude-sonnet-4-20250514',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229',
  'claude-3-haiku-20240307',
]

export class AnthropicAdapter implements LLMAdapter {
  async *sendRequest(req: LLMRequest, config: ApiConfigGroup): AsyncGenerator<LLMStreamChunk> {
    const url = `${config.baseUrl.replace(/\/+$/, '')}/messages`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      ...config.customHeaders,
    }

    // Anthropic: separate system message from messages array
    let systemPrompt = ''
    const messages = req.messages
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

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`Anthropic API 请求失败 (${response.status}): ${errorText || response.statusText}`)
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
