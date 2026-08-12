/**
 * Structured LLM error classification — the single source of truth for
 * "is this failure retryable?" decisions (LLMClient's auto-retry) and for
 * semantic error kinds (context overflow → compaction) that the adapters'
 * message-string errors don't expose.
 *
 * Adapters throw `new Error(...)` with the status code embedded in the text
 * (`API 请求失败 (429): …`, `status_code=400`), and the network layer throws
 * localized message strings — the classification below is the pragmatic middle
 * ground: status-code regex + keyword matching, ordered so that specific
 * signals (cancelled / timeout / network) win over the generic status-code
 * branches.
 */

export type LLMErrorType =
  | 'timeout' // idle timeout / explicit request timeout
  | 'network' // fetch failed, connection dropped
  | 'rate_limit' // 408 / 429
  | 'auth' // 401 / 403
  | 'server' // 5xx
  | 'bad_request' // 4xx (400/404/413/415/422…)
  | 'context_overflow' // bad_request whose payload was too long for the model
  | 'cancelled' // user or consumer aborted the request
  | 'unknown'

export interface LLMErrorInfo {
  type: LLMErrorType
  /** HTTP status code when the error carries one (regex-extracted). */
  code?: number
  /** True when retrying the request has a real chance of succeeding. */
  retryable: boolean
  /** True when the provider rejected the request because the context was too
   *  long — the caller should compact the history, never retry as-is. */
  contextOverflow: boolean
}

/** Provider "prompt too long" wording (English + Chinese + common variants).
 *  Kept in one list so new providers are a one-line addition. */
const CONTEXT_OVERFLOW_PATTERNS = [
  'prompt is too long',
  'prompt too long',
  'context length',
  'context window',
  'context_window',
  'contextwindow',
  'maximum context',
  'max context',
  'context limit',
  'context_limit',
  'context overflow',
  'too many tokens',
  'token limit',
  'tokens exceed',
  'exceeded the maximum',
  'input is too long',
  'input too long',
  'maximum input',
  'max_input_tokens',
  'your input',
  'reduce the length',
  '请求超过',
  '上下文',
  '超长',
  '过长',
  '超出模型',
  '超出上下文',
  '长度超出',
  '输入过长',
  '输入超长',
  '超出生成本文的上限',
]

function extractCode(message: string): number | undefined {
  const m = message.match(/\((\d{3})\)/) ?? message.match(/status_code[=:]\s?(\d{3})/)
  return m ? Number(m[1]) : undefined
}

const lower = (s: string) => s.toLowerCase()

export function classifyLLMError(error: unknown): LLMErrorInfo {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const text = lower(message)

  const code = extractCode(message)

  // Specific signals first — they're unambiguous regardless of any status code
  // the message may also contain (e.g. relay errors embedding a 4xx).
  if (text.includes('请求已取消') || text.includes('cancelled') || text.includes('aborted')) {
    return { type: 'cancelled', code, retryable: false, contextOverflow: false }
  }
  if (text.includes('超时') || text.includes('timeout')) {
    return { type: 'timeout', code, retryable: true, contextOverflow: false }
  }
  if (
    text.includes('failed to fetch') ||
    text.includes('networkerror') ||
    text.includes('load failed') ||
    text.includes('network') ||
    text.includes('网络')
  ) {
    return { type: 'network', code, retryable: true, contextOverflow: false }
  }

  // Status-code branches (matches parseLLMError's mapping for consistency).
  if (code === 401 || code === 403) {
    return { type: 'auth', code, retryable: false, contextOverflow: false }
  }
  if (code === 408 || code === 429) {
    return { type: 'rate_limit', code, retryable: true, contextOverflow: false }
  }
  if (code !== undefined && code >= 500) {
    return { type: 'server', code, retryable: true, contextOverflow: false }
  }
  if (code !== undefined && code >= 400) {
    // 400/404/413/415/422… — the provider rejected the payload. The most
    // common cause in an agent loop is a context that outgrew the model.
    if (CONTEXT_OVERFLOW_PATTERNS.some((p) => text.includes(p))) {
      return { type: 'context_overflow', code, retryable: false, contextOverflow: true }
    }
    return { type: 'bad_request', code, retryable: false, contextOverflow: false }
  }

  // No status code in the message — it may still be an overflow rejection
  // (some relays surface the body without the code prefix).
  if (CONTEXT_OVERFLOW_PATTERNS.some((p) => text.includes(p))) {
    return { type: 'context_overflow', code, retryable: false, contextOverflow: true }
  }

  return { type: 'unknown', code, retryable: false, contextOverflow: false }
}
