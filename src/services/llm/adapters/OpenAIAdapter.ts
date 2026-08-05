import { ApiConfigGroup, LLMRequest, LLMStreamChunk, LLMToolCall } from '@/types'
import { LLMAdapter } from '../types'

export class OpenAIAdapter implements LLMAdapter {
  async *sendRequest(req: LLMRequest, config: ApiConfigGroup, signal?: AbortSignal): AsyncGenerator<LLMStreamChunk> {
    const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      ...config.customHeaders,
    }

    const messages = req.messages.map((m) => {
      const msg: Record<string, any> = {
        role: m.role,
        content: m.content,
      }
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }))
      }
      if (m.role === 'tool' && m.toolCallId) {
        msg.tool_call_id = m.toolCallId
      }
      return msg
    })

    const body: Record<string, any> = {
      model: req.model,
      messages,
      stream: req.stream,
      temperature: req.temperature,
      top_p: req.topP,
      frequency_penalty: req.frequencyPenalty,
      presence_penalty: req.presencePenalty,
    }

    if (req.maxTokens > 0) {
      body.max_tokens = req.maxTokens
    }

    // Add tools if provided
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`API 请求失败 (${response.status}): ${errorText || response.statusText}`)
    }

    if (!req.stream) {
      const data = await response.json()
      const content = data.choices?.[0]?.message?.content || ''
      const usage = data.usage
      const toolCalls = data.choices?.[0]?.message?.tool_calls?.map((tc: any) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }))
      yield {
        content,
        done: false,
        toolCalls,
        usage: usage ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens } : undefined,
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
          if (data === '[DONE]') {
            yield { content: '', done: true }
            return
          }

          try {
            const json = JSON.parse(data)
            const delta = json.choices?.[0]?.delta
            const usage = json.usage

            if (delta?.content) {
              yield {
                content: delta.content,
                done: false,
                usage: usage ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens } : undefined,
              }
            }

            // Support reasoning_content (DeepSeek, etc.)
            if (delta?.reasoning_content) {
              yield {
                content: '',
                thinking: delta.reasoning_content,
                done: false,
              }
            }

            // Accumulate tool calls
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0
                if (!toolCallsAcc.has(idx)) {
                  toolCallsAcc.set(idx, { id: tc.id || '', name: '', arguments: '' })
                }
                const acc = toolCallsAcc.get(idx)!
                if (tc.id) acc.id = tc.id
                if (tc.function?.name) acc.name = tc.function.name
                if (tc.function?.arguments) acc.arguments += tc.function.arguments
              }
            }

            // When finish_reason is tool_calls, yield the accumulated tool calls
            const finishReason = json.choices?.[0]?.finish_reason
            if (finishReason === 'tool_calls' || finishReason === 'function_call') {
              const toolCalls: LLMToolCall[] = Array.from(toolCallsAcc.values()).map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                  name: tc.name,
                  arguments: tc.arguments,
                },
              }))
              yield { content: '', toolCalls, done: true }
              return
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  async fetchModels(config: ApiConfigGroup, signal?: AbortSignal): Promise<string[]> {
    const url = `${config.baseUrl.replace(/\/+$/, '')}/models`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      ...config.customHeaders,
    }

    const response = await fetch(url, { headers, signal })
    if (!response.ok) {
      throw new Error(`获取模型列表失败 (${response.status}): ${response.statusText}`)
    }

    const data = await response.json()
    return (data.data || []).map((m: any) => m.id).sort()
  }
}
