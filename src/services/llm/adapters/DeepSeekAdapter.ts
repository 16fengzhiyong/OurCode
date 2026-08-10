import { LLMRequest, LLMStreamChunk, ApiConfigGroup } from '@/types'
import { LLMAdapter } from '../types'
import { llmFetch } from '../http'
import { buildChatUrl, buildModelsUrl } from '../endpoints'

/**
 * DeepSeek adapter — uses OpenAI-compatible API with DeepSeek-specific features
 * Supports: deepseek-chat, deepseek-coder, deepseek-reasoner
 */
export class DeepSeekAdapter implements LLMAdapter {
  async *sendRequest(req: LLMRequest, config: ApiConfigGroup, signal?: AbortSignal): AsyncGenerator<LLMStreamChunk> {
    const url = buildChatUrl(config.baseUrl, 'openai', req.model)

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
    // DeepSeek streams omit usage unless asked — without this the run badge
    // never sees token counts.
    if (req.stream) {
      (body as any).stream_options = { include_usage: true }
    }
    // Add tools if provided
    if (req.tools && req.tools.length > 0) {
      (body as any).tools = req.tools
    }
    // Deep thinking: DeepSeek reasoning models accept both `thinking` and `reasoning_effort`
    if (req.thinking) {
      Object.assign(body, {
        thinking: { type: 'enabled' },
        reasoning_effort: req.reasoningEffort || 'high',
      })
    }

    const response = await llmFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    }, { stream: true, skipTlsVerify: !!config.skipTlsVerify })

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
      const url = buildModelsUrl(config.baseUrl, 'openai')
      if (!url) return ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner']
      const response = await llmFetch(url, {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          ...config.customHeaders,
        },
        signal,
      }, { skipTlsVerify: !!config.skipTlsVerify })

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
