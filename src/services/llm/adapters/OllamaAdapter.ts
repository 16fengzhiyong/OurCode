import { ApiConfigGroup, LLMRequest, LLMStreamChunk } from '@/types'
import { LLMAdapter } from '../types'

export class OllamaAdapter implements LLMAdapter {
  async *sendRequest(req: LLMRequest, config: ApiConfigGroup, signal?: AbortSignal): AsyncGenerator<LLMStreamChunk> {
    const url = `${config.baseUrl.replace(/\/+$/, '')}/api/chat`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.customHeaders,
    }

    const body: Record<string, any> = {
      model: req.model,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: req.stream,
      options: {
        temperature: req.temperature,
        top_p: req.topP,
        frequency_penalty: req.frequencyPenalty,
        presence_penalty: req.presencePenalty,
        num_predict: req.maxTokens > 0 ? req.maxTokens : undefined,
      },
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`Ollama API 请求失败 (${response.status}): ${errorText || response.statusText}`)
    }

    if (!req.stream) {
      const data = await response.json()
      yield {
        content: data.message?.content || '',
        done: false,
        usage: data.prompt_eval_count ? { promptTokens: data.prompt_eval_count, completionTokens: data.eval_count } : undefined,
      }
      yield { content: '', done: true }
      return
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()!

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          try {
            const json = JSON.parse(trimmed)
            const content = json.message?.content || ''
            const isDone = json.done === true

            if (content) {
              yield {
                content,
                done: false,
                usage: isDone && json.prompt_eval_count
                  ? { promptTokens: json.prompt_eval_count, completionTokens: json.eval_count }
                  : undefined,
              }
            }

            if (isDone) {
              yield { content: '', done: true }
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

  async fetchModels(config: ApiConfigGroup, signal?: AbortSignal): Promise<string[]> {
    const url = `${config.baseUrl.replace(/\/+$/, '')}/api/tags`
    const response = await fetch(url, { signal })
    if (!response.ok) {
      throw new Error(`获取 Ollama 模型列表失败 (${response.status})`)
    }
    const data = await response.json()
    return (data.models || []).map((m: any) => m.name).sort()
  }
}
