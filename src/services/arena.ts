/**
 * Arena — run the same prompt across multiple models in parallel and compare
 * (Arena mode). Each result can be adopted into the chat.
 */
import { sendLLMRequest } from '@/services/llm/LLMClient'
import { ApiConfigGroup } from '@/types'

export interface ArenaResult {
  model: string
  content: string
  error?: string
  durationMs: number
}

/** Fire the same prompt at several models concurrently; one failure doesn't sink the rest */
export async function runArenaPrompt(
  prompt: string,
  models: string[],
  configGroup: ApiConfigGroup,
): Promise<ArenaResult[]> {
  const uniqueModels = Array.from(new Set(models)).filter(Boolean)
  return Promise.all(
    uniqueModels.map(async (model) => {
      const start = Date.now()
      try {
        const req = {
          model,
          messages: [
            { role: 'system' as const, content: 'You are a helpful AI coding assistant. Answer concisely and directly.' },
            { role: 'user' as const, content: prompt },
          ],
          stream: false,
          temperature: 0.4,
          maxTokens: 2000,
          topP: 1,
          frequencyPenalty: 0,
          presencePenalty: 0,
        }
        let content = ''
        for await (const chunk of sendLLMRequest(req, configGroup)) {
          if (chunk.content) content += chunk.content
          if (chunk.done) break
        }
        return { model, content, durationMs: Date.now() - start }
      } catch (error: any) {
        return { model, content: '', error: error.message || '请求失败', durationMs: Date.now() - start }
      }
    }),
  )
}
