import { ApiConfigGroup, LLMRequest, LLMStreamChunk } from '@/types'
import { LLMAdapter } from '../types'

const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
]

export class GeminiAdapter implements LLMAdapter {
  async *sendRequest(req: LLMRequest, config: ApiConfigGroup, signal?: AbortSignal): AsyncGenerator<LLMStreamChunk> {
    const stream = req.stream ? 'streamGenerateContent' : 'generateContent'
    const url = `${config.baseUrl.replace(/\/+$/, '')}/v1beta/models/${req.model}:${stream}?key=${config.apiKey}`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.customHeaders,
    }

    // Convert messages to Gemini format
    const systemInstruction = req.messages.find((m) => m.role === 'system')
    const contents = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))

    const body: Record<string, any> = {
      contents,
      generationConfig: {
        temperature: req.temperature,
        topP: req.topP,
        maxOutputTokens: req.maxTokens > 0 ? req.maxTokens : undefined,
      },
    }

    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction.content }] }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`Gemini API 请求失败 (${response.status}): ${errorText || response.statusText}`)
    }

    if (!req.stream) {
      const data = await response.json()
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
      const usage = data.usageMetadata
      yield {
        content,
        done: false,
        usage: usage ? { promptTokens: usage.promptTokenCount || 0, completionTokens: usage.candidatesTokenCount || 0 } : undefined,
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

          // Gemini uses JSON array streaming, find individual objects
          const jsonMatch = trimmed.match(/\{"candidates":\[.*?\]\}/)
          if (!jsonMatch) continue

          try {
            const json = JSON.parse(jsonMatch[0])
            const text = json.candidates?.[0]?.content?.parts?.[0]?.text
            const usage = json.usageMetadata

            if (text) {
              yield {
                content: text,
                done: false,
                usage: usage ? { promptTokens: usage.promptTokenCount || 0, completionTokens: usage.candidatesTokenCount || 0 } : undefined,
              }
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }

      yield { content: '', done: true }
    } finally {
      reader.releaseLock()
    }
  }

  async fetchModels(config: ApiConfigGroup, signal?: AbortSignal): Promise<string[]> {
    try {
      const url = `${config.baseUrl.replace(/\/+$/, '')}/v1beta/models?key=${config.apiKey}`
      const response = await fetch(url, { signal })
      if (!response.ok) {
        throw new Error(`获取模型列表失败 (${response.status})`)
      }
      const data = await response.json()
      const models = (data.models || [])
        .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => m.name.replace('models/', ''))
        .sort()
      return models.length > 0 ? models : GEMINI_MODELS
    } catch {
      return GEMINI_MODELS
    }
  }
}
