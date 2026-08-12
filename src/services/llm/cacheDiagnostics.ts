/**
 * Prompt-cache break diagnostics — a lightweight take on Claude Code's
 * `promptCacheBreakDetection`. Every LLM request signs its byte-stable prefix
 * (system prompt + tool definitions). When the next request reports few cache
 * reads despite an unchanged signature, we diff the two signatures to name the
 * component that busted the cache (a changed tool description/schema is the
 * classic culprit — e.g. MCP or skill tools embedding dynamic lists).
 *
 * This is diagnostic only: it never modifies requests, just explains misses.
 * State lives in a module Map keyed by session id (not persisted).
 */

/** djb2 — fast stable string hash (Claude Code uses the same family). */
export function djb2Hash(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0
  }
  return h >>> 0
}

/** Tool definitions arrive in the wire format
 *  ({ type: 'function', function: { name, description, parameters } }). */
export interface WireToolDef {
  type?: string
  function?: { name: string; description?: string; parameters?: unknown }
  name?: string
  description?: string
  inputSchema?: unknown
}

export interface ToolSignature {
  /** Hash of the whole tools segment (names + descriptions + schemas). */
  hash: number
  /** Per-tool hash so a break can name the exact tool that changed. */
  perTool: Record<string, number>
}

export function toolSignature(toolDefinitions: WireToolDef[]): ToolSignature {
  const perTool: Record<string, number> = {}
  let acc = 'tools:'
  for (const t of toolDefinitions) {
    const fn = t.function ?? t
    const name = fn.name ?? t.name ?? ''
    const description = fn.description ?? t.description ?? ''
    // inputSchema / parameters — whichever shape the caller provided
    const schema = t.inputSchema ?? (fn as { parameters?: unknown }).parameters ?? {}
    const h = djb2Hash(`${name}\n${description}\n${JSON.stringify(schema)}`)
    perTool[name] = h
    acc += `${name}:${h};`
  }
  return { hash: djb2Hash(acc), perTool }
}

export interface RequestSignature {
  systemHash: number
  toolsHash: number
  perTool: Record<string, number>
}

/** Per-session signature of the most recent request. */
const prevBySession = new Map<string, RequestSignature>()
/** Per-session flag: has the provider ever reported any cache-read tokens? */
const seenCacheReadBySession = new Map<string, boolean>()

export function rememberRequestSignature(sessionId: string, sig: RequestSignature): void {
  prevBySession.set(sessionId, sig)
}

export function getPreviousSignature(sessionId: string): RequestSignature | undefined {
  return prevBySession.get(sessionId)
}

export function resetSessionSignature(sessionId: string): void {
  prevBySession.delete(sessionId)
  seenCacheReadBySession.delete(sessionId)
}

/** Record cache-read tokens reported by the provider (0 means none this request). */
export function recordCacheRead(sessionId: string, tokens: number): void {
  if (tokens > 0) seenCacheReadBySession.set(sessionId, true)
}

/**
 * Whether this provider has EVER reported cache reads. Guards the "unexpected
 * miss" diagnostic: a relay that drops cache stats always reports 0, so without
 * this we'd cry "cache miss" on every round even though the provider just
 * doesn't report caching at all.
 */
export function hasSeenCacheRead(sessionId: string): boolean {
  return seenCacheReadBySession.get(sessionId) === true
}

export interface CacheBreakReport {
  /** Human-readable causes, e.g. ['工具列表变化（mcp__github__list_repos）'] */
  causes: string[]
}

/** Diff the previous request's stable-prefix signature against the current one
 *  and explain why the provider cache could not hit. */
export function analyzeCacheBreak(prev: RequestSignature, curr: RequestSignature): CacheBreakReport {
  const causes: string[] = []
  if (prev.systemHash !== curr.systemHash) {
    causes.push('系统提示词变化')
  }
  if (prev.toolsHash !== curr.toolsHash) {
    const names = new Set([...Object.keys(prev.perTool), ...Object.keys(curr.perTool)])
    const changed: string[] = []
    for (const n of names) {
      if (prev.perTool[n] !== curr.perTool[n]) changed.push(n)
    }
    causes.push(changed.length > 0 ? `工具列表变化（${changed.join('、')}）` : '工具列表变化')
  }
  if (causes.length === 0) {
    // System + tools byte-identical, yet the provider reported no cache reads —
    // the ~5min TTL expired between turns, or the mid-conversation breakpoint
    // slid past the shared prefix.
    causes.push('system+工具未变但缓存未命中（可能 5 分钟 TTL 过期，或断点位置前移）')
  }
  return { causes }
}
