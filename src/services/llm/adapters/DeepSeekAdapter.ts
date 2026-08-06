import { LLMRequest, LLMStreamChunk, ApiConfigGroup } from '@/types'
import { LLMAdapter } from '../types'

/**
 * DeepSeek adapter — uses OpenAI-compatible API with DeepSeek-specific features
 * Supports: deepseek-chat, deepseek-coder, deepseek-reasoner
 */
export class DeepSeekAdapter implements LLMAdapter {
  async *sendRequest(req: LLMRequest, config: ApiConfigGroup, signal?: AbortSignal): AsyncGenerator<LLMStreamChunk> {
    const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      ...config.customHeaders,
    }

    const body = {
      model: req.model,
      messages: req.messages.map((m: { role: string; content: string; toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>; toolCallId?: string }) => {
        const msg: Record<string, any> = { role: m.role, content: m.content }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          msg.tool_calls = m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.function.name, arguments: tc.function.arguments },
          }))
        }
        if (m.role === 'tool' && m.toolCallId) {
          msg.tool_call_id = m.toolCallId
        }
        return msg
      }),
      temperature: req.temperature,
      max_tokens: req.maxTokens || undefined,
      top_p: req.topP,
      frequency_penalty: req.frequencyPenalty,
      presence_penalty: req.presencePenalty,
      stream: req.stream,
    }
    // Add tools if provided
    if (req.tools && req.tools.length > 0) {
      ;(body as any).tools = req.tools
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`DeepSeek API error (${response.status}): ${errorText}`)
    }

    if (req.stream && response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') {
            yield { content: '', done: true }
            return
          }

          try {
            const json = JSON.parse(data)
            const delta = json.choices?.[0]?.delta

            if (delta?.reasoning_content) {
              yield { content: '', thinking: delta.reasoning_content, done: false }
            }
            if (delta?.content) {
              yield { content: delta.content, done: false }
            }

            if (json.usage) {
              yield {
                content: '',
                done: false,
                usage: {
                  promptTokens: json.usage.prompt_tokens,
                  completionTokens: json.usage.completion_tokens,
                },
              }
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      yield { content: '', done: true }
    } else {
      const json = await response.json()
      const content = json.choices?.[0]?.message?.content || ''
      const thinking = json.choices?.[0]?.message?.reasoning_content || ''

      yield {
        content,
        thinking: thinking || undefined,
        done: true,
        usage: json.usage
          ? { promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens }
          : undefined,
      }
    }
  }

  async fetchModels(config: ApiConfigGroup, signal?: AbortSignal): Promise<string[]> {
    try {
      const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/models`, {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          ...config.customHeaders,
        },
        signal,
      })

      if (response.ok) {
        const data = await response.json()
        return data.data?.map((m: { id: string }) => m.id) || []
      }
    } catch {
      // Fall through to hardcoded list
    }

    return [
      'deepseek-chat',
      'deepseek-coder',
      'deepseek-reasoner',
    ]
  }
}
