import { ApiConfigGroup, LLMRequest, LLMStreamChunk } from '@/types'

export interface LLMAdapter {
  sendRequest(req: LLMRequest, config: ApiConfigGroup, signal?: AbortSignal): AsyncGenerator<LLMStreamChunk>
  fetchModels(config: ApiConfigGroup, signal?: AbortSignal): Promise<string[]>
}

export type ProviderType = 'openai' | 'responses' | 'anthropic' | 'gemini' | 'ollama' | 'deepseek' | 'groq' | 'azure' | 'custom'
