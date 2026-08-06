import { ApiConfigGroup, LLMRequest, LLMStreamChunk } from '@/types'
import { LLMAdapter, ProviderType } from './types'
import { OpenAIAdapter } from './adapters/OpenAIAdapter'
import { AnthropicAdapter } from './adapters/AnthropicAdapter'
import { GeminiAdapter } from './adapters/GeminiAdapter'
import { OllamaAdapter } from './adapters/OllamaAdapter'
import { DeepSeekAdapter } from './adapters/DeepSeekAdapter'
import { GroqAdapter } from './adapters/GroqAdapter'

const REQUEST_TIMEOUT_MS = 30_000

const openaiAdapter = new OpenAIAdapter()

const adapters: Record<ProviderType, LLMAdapter> = {
  openai: openaiAdapter,
  anthropic: new AnthropicAdapter(),
  gemini: new GeminiAdapter(),
  ollama: new OllamaAdapter(),
  deepseek: new DeepSeekAdapter(),
  groq: new GroqAdapter(),
  azure: openaiAdapter, // Azure uses OpenAI-compatible format
  custom: openaiAdapter, // Custom uses OpenAI-compatible format
}

export function getAdapter(provider: ProviderType, apiFormat?: string): LLMAdapter {
  // If an explicit format override is set (and not 'auto'), use that adapter
  const resolvedProvider = (apiFormat && apiFormat !== 'auto')
    ? apiFormat as ProviderType
    : provider
  return adapters[resolvedProvider] || adapters.openai
}

export async function* sendLLMRequest(
  req: LLMRequest,
  config: ApiConfigGroup
): AsyncGenerator<LLMStreamChunk> {
  const adapter = getAdapter(config.provider, config.apiFormat)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    yield* adapter.sendRequest(req, config, controller.signal)
  } catch (error: any) {
    if (error.name === 'AbortError' || controller.signal.aborted) {
      throw new Error('请求超时，请稍后重试')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchModels(config: ApiConfigGroup): Promise<string[]> {
  const adapter = getAdapter(config.provider, config.apiFormat)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    return await adapter.fetchModels(config, controller.signal)
  } catch (error: any) {
    if (error.name === 'AbortError' || controller.signal.aborted) {
      throw new Error('获取模型列表超时，请检查网络连接后重试')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
