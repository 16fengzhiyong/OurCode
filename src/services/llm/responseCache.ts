// Client-side LLM response cache.
//
// Exact-duplicate requests (same provider + model + params + tools + messages)
// are stored in sqlite (via the llmCache* IPC bridge) and replayed without
// calling the API — saving the user's tokens. Only deterministic requests
// (temperature 0) are cached, so "regenerate" with a non-zero temperature
// still produces fresh answers.
//
// The cache key deliberately excludes apiKey/baseUrl: the same provider+model
// produces the same answer regardless of which relay serves it.

import { LLMRequest, LLMStreamChunk } from '@/types'

/** Skip caching responses larger than this (chars) to keep sqlite lean. */
export const MAX_CACHE_RESPONSE_CHARS = 500_000

/** True when the request is deterministic enough to cache (temperature 0). */
export function shouldCache(req: LLMRequest): boolean {
  const t = req.temperature ?? 0
  return t === 0
}

/** Serialize any value with a stable key order (objects sorted by key). */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v)).join(',') + ']'
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k])).join(',') + '}'
  }
  return JSON.stringify(value)
}

function fnv1a(str: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return 'fnv' + (hash >>> 0).toString(16)
}

async function sha256(text: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined') {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
    }
  } catch {
    // Non-secure context or unavailable API — fall through to FNV.
  }
  return fnv1a(text)
}

/**
 * Build a cache key for a request: provider + model + params + tools +
 * full message list, canonically serialized then hashed.
 */
export async function buildCacheKey(req: LLMRequest, provider: string): Promise<string> {
  const canonical = [
    provider,
    req.model,
    req.temperature ?? 0,
    req.topP ?? 1,
    req.frequencyPenalty ?? 0,
    req.presencePenalty ?? 0,
    req.maxTokens ?? 0,
    req.thinking ? 1 : 0,
    req.reasoningEffort || '',
    stableStringify(req.tools || []),
    stableStringify(req.messages),
  ].join('\u0001')
  return sha256(canonical)
}

export interface CachedResponse {
  chunks: LLMStreamChunk[]
  tokensIn: number
  tokensOut: number
}

function getElectronApi(): any {
  return typeof window !== 'undefined' ? (window as any).electronAPI : null
}

/** Look up a cached response. Returns null on miss or any bridge error. */
export async function fetchCachedResponse(key: string): Promise<CachedResponse | null> {
  const api = getElectronApi()
  if (!api || typeof api.llmCacheGet !== 'function') return null
  try {
    const row = await api.llmCacheGet(key)
    if (!row || typeof row.response !== 'string') return null
    const parsed = JSON.parse(row.response)
    if (!Array.isArray(parsed?.chunks) || parsed.chunks.length === 0) return null
    return {
      chunks: parsed.chunks,
      tokensIn: row.tokensIn || 0,
      tokensOut: row.tokensOut || 0,
    }
  } catch {
    return null
  }
}

/** Store a completed response. Best-effort: never throws into the caller. */
export async function storeCachedResponse(
  key: string,
  provider: string,
  model: string,
  chunks: LLMStreamChunk[],
  tokensIn: number,
  tokensOut: number,
): Promise<void> {
  const api = getElectronApi()
  if (!api || typeof api.llmCachePut !== 'function') return
  try {
    const json = JSON.stringify({
      chunks: chunks.map((c) => ({
        content: c.content,
        thinking: c.thinking,
        done: c.done,
        toolCalls: c.toolCalls,
        usage: c.usage,
      })),
    })
    if (json.length > MAX_CACHE_RESPONSE_CHARS) return
    await api.llmCachePut({ key, provider, model, response: json, tokensIn, tokensOut })
  } catch {
    // Cache is best-effort — a write failure must not break the request.
  }
}
