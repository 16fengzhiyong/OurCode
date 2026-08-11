import { ApiConfigGroup, LLMRequest, LLMStreamChunk } from '@/types'
import { LLMAdapter, ProviderType } from './types'
import { OpenAIAdapter } from './adapters/OpenAIAdapter'
import { ResponsesAdapter } from './adapters/ResponsesAdapter'
import { AnthropicAdapter } from './adapters/AnthropicAdapter'
import { GeminiAdapter } from './adapters/GeminiAdapter'
import { OllamaAdapter } from './adapters/OllamaAdapter'
import { DeepSeekAdapter } from './adapters/DeepSeekAdapter'
import { GroqAdapter } from './adapters/GroqAdapter'
import { buildCacheKey, fetchCachedResponse, shouldCache, storeCachedResponse, CachedResponse } from './responseCache'

const REQUEST_TIMEOUT_MS = 120_000

const openaiAdapter = new OpenAIAdapter()

const adapters: Record<ProviderType, LLMAdapter> = {
  openai: openaiAdapter,
  responses: new ResponsesAdapter(),
  anthropic: new AnthropicAdapter(),
  gemini: new GeminiAdapter(),
  ollama: new OllamaAdapter(),
  deepseek: new DeepSeekAdapter(),
  groq: new GroqAdapter(),
  azure: new OpenAIAdapter('azure'), // Azure uses the deployments URL scheme
  custom: openaiAdapter, // Custom uses OpenAI-compatible format
}

export function getAdapter(provider: ProviderType, apiFormat?: string): LLMAdapter {
  // If an explicit format override is set (and not 'auto'), use that adapter
  const resolvedProvider = (apiFormat && apiFormat !== 'auto')
    ? apiFormat as ProviderType
    : provider
  return adapters[resolvedProvider] || adapters.openai
}

// ── Cache configuration (wired from chatStore so every sendLLMRequest caller
// ── benefits without each of them knowing about the preferences). ──────────

interface LLMCacheConfig {
  /** Client-side response cache: replay exact-duplicate deterministic requests. */
  responseCacheEnabled?: () => boolean
  /** Provider prompt-caching markers (Anthropic cache_control). */
  anthropicPromptCacheEnabled?: () => boolean
}

let responseCacheEnabled: () => boolean = () => false
let anthropicPromptCacheEnabled: () => boolean = () => true

/** Wire cache toggles (lazily evaluated per request, defaults = cache off). */
export function configureLLMCache(config: LLMCacheConfig): void {
  if (config.responseCacheEnabled) responseCacheEnabled = config.responseCacheEnabled
  if (config.anthropicPromptCacheEnabled) anthropicPromptCacheEnabled = config.anthropicPromptCacheEnabled
}

/** Replay a cached response as stream chunks, zeroing usage (no tokens billed). */
function* replayCached(cached: CachedResponse): Generator<LLMStreamChunk> {
  const marker = { savedTokensIn: cached.tokensIn, savedTokensOut: cached.tokensOut }
  for (const c of cached.chunks) {
    yield {
      content: c.content,
      thinking: c.thinking,
      done: c.done,
      toolCalls: c.toolCalls,
      cacheHit: marker,
    }
  }
}

export async function* sendLLMRequest(
  req: LLMRequest,
  config: ApiConfigGroup,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): AsyncGenerator<LLMStreamChunk> {
  const adapter = getAdapter(config.provider, config.apiFormat)
  // Trim stray whitespace/newlines so a pasted key can't silently break auth.
  const safeConfig = { ...config, apiKey: (config.apiKey || '').trim() }

  // Client-side response cache: exact-duplicate deterministic requests are
  // replayed locally instead of hitting the API (saves the user's tokens).
  let cacheKey: string | null = null
  if (responseCacheEnabled() && shouldCache(req)) {
    cacheKey = await buildCacheKey(req, config.provider)
    const hit = await fetchCachedResponse(cacheKey)
    if (hit) {
      yield* replayCached(hit)
      return
    }
  }

  // Provider prompt-caching markers (Anthropic cache_control breakpoints, DeepSeek
  // auto-caches repeated prefixes server-side) so repeated prefixes are billed
  // at the cached read rate.
  const reqWithCache = (config.provider === 'anthropic' || config.provider === 'deepseek') && anthropicPromptCacheEnabled()
    ? { ...req, providerCache: true }
    : req

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const chunks: LLMStreamChunk[] = []
  let completed = false
  let tokensIn = 0
  let tokensOut = 0

  try {
    for await (const chunk of adapter.sendRequest(reqWithCache, safeConfig, controller.signal)) {
      if (chunk.usage) {
        tokensIn = chunk.usage.promptTokens || 0
        tokensOut = chunk.usage.completionTokens || 0
      }
      chunks.push(chunk)
      yield chunk
      // Reached the natural end of the response — safe to cache below.
      if (chunk.done) {
        completed = true
        break
      }
    }
  } catch (error: any) {
    if (error.name === 'AbortError' || controller.signal.aborted) {
      throw new Error('请求超时，请稍后重试')
    }
    throw error
  } finally {
    clearTimeout(timer)
    // Abort the underlying HTTP request unconditionally. A consumer that stops
    // early (stop generation / abort) breaks out of the for-await — without
    // this the main-process fetch keeps downloading the rest of the body and
    // the renderer keeps buffering chunks for up to the 120s timeout.
    controller.abort()
    // Persist only on a completed (non-aborted, non-failed) response.
    if (cacheKey && completed) {
      void storeCachedResponse(cacheKey, config.provider, req.model, chunks, tokensIn, tokensOut)
    }
  }
}

export async function fetchModels(
  config: ApiConfigGroup,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<string[]> {
  const adapter = getAdapter(config.provider, config.apiFormat)
  const safeConfig = { ...config, apiKey: (config.apiKey || '').trim() }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await adapter.fetchModels(safeConfig, controller.signal)
  } catch (error: any) {
    if (error.name === 'AbortError' || controller.signal.aborted) {
      throw new Error('获取模型列表超时，请检查网络连接后重试')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
