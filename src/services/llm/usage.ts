// Normalized usage parsing shared by the LLM adapters.
//
// Provider cache accounting is scattered across formats — DeepSeek and most
// OpenAI-compatible relays (longcat, one-api, new-api, …) report
// prompt_cache_hit_tokens / prompt_cache_miss_tokens on the usage root, OpenAI
// reports prompt_tokens_details.cached_tokens, Anthropic reports
// cache_read_input_tokens / cache_creation_input_tokens. Older adapter code
// kept only prompt_tokens / completion_tokens, so server-side prefix-cache
// savings never reached the usage panel even when the provider billed them at
// the discounted cache-read rate.

import { LLMStreamChunk } from '@/types'

export type ParsedUsage = NonNullable<LLMStreamChunk['usage']>

/**
 * Map an OpenAI-compatible /chat/completions usage object into the normalized
 * LLMStreamChunk.usage shape. Handles both cache-reporting styles and relays
 * that drop the fields entirely (cacheReadTokens stays 0).
 */
export function mapOpenAiUsage(usage: any): ParsedUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const cachedTokens =
    typeof usage.prompt_cache_hit_tokens === 'number' ? usage.prompt_cache_hit_tokens
      : typeof usage.prompt_tokens_details?.cached_tokens === 'number' ? usage.prompt_tokens_details.cached_tokens
        : 0
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    cacheReadTokens: cachedTokens || 0,
    cacheCreationTokens: typeof usage.prompt_cache_miss_tokens === 'number' ? usage.prompt_cache_miss_tokens || 0 : 0,
  }
}

/**
 * Map an Anthropic usage object. Streaming usage arrives split across events:
 * message_start carries input_tokens + cache fields, message_delta carries only
 * output_tokens — callers merge the pieces with mergeUsage.
 */
export function mapAnthropicUsage(usage: any): ParsedUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  return {
    promptTokens: usage.input_tokens ?? 0,
    completionTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
  }
}

/** Merge a later usage snapshot over an earlier one, keeping the first non-zero
 *  value per field (Anthropic streaming: message_start → message_delta). */
export function mergeUsage(base: ParsedUsage | undefined, next: ParsedUsage | undefined): ParsedUsage | undefined {
  if (!next) return base
  if (!base) return next
  return {
    promptTokens: next.promptTokens || base.promptTokens,
    completionTokens: next.completionTokens || base.completionTokens,
    cacheReadTokens: next.cacheReadTokens || base.cacheReadTokens,
    cacheCreationTokens: next.cacheCreationTokens || base.cacheCreationTokens,
  }
}
