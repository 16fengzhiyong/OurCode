/**
 * Arena — run the same prompt across multiple models in parallel and compare
 * (Arena mode). Each result can be adopted into the chat.
 */
import { v4 as uuidv4 } from 'uuid'
import { sendLLMRequest } from '@/services/llm/LLMClient'
import { ApiConfigGroup, UsageEvent } from '@/types'

export interface ArenaResult {
  model: string
  content: string
  error?: string
  durationMs: number
}

/** Record one arena LLM request into the usage dashboard (best-effort) */
function recordArenaUsage(model: string, configGroup: ApiConfigGroup, startedAt: number, durationMs: number, ok: boolean, opts: { error?: string; tokensIn?: number; tokensOut?: number } = {}): void {
  const event: UsageEvent = {
    id: uuidv4(),
    category: 'llm',
    name: model,
    sub: configGroup.provider,
    startedAt,
    durationMs,
    tokensIn: opts.tokensIn || 0,
    tokensOut: opts.tokensOut || 0,
    ok,
    error: opts.error,
    payload: { source: 'arena' },
  }
  window.electronAPI.recordUsage([event]).catch(() => { /* stats are best-effort */ })
  window.dispatchEvent(new CustomEvent('ourcode:usage-recorded'))
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
        let tokensIn = 0
        let tokensOut = 0
        for await (const chunk of sendLLMRequest(req, configGroup)) {
          if (chunk.content) content += chunk.content
          if (chunk.usage) {
            tokensIn = chunk.usage.promptTokens || 0
            tokensOut = chunk.usage.completionTokens || 0
          }
          if (chunk.done) break
        }
        const durationMs = Date.now() - start
        recordArenaUsage(model, configGroup, start, durationMs, true, { tokensIn, tokensOut })
        return { model, content, durationMs }
      } catch (error: any) {
        const durationMs = Date.now() - start
        recordArenaUsage(model, configGroup, start, durationMs, false, { error: error.message || '请求失败' })
        return { model, content: '', error: error.message || '请求失败', durationMs }
      }
    }),
  )
}
