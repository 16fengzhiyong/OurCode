import type { ChatError } from '@/types'
import { t } from '@/i18n'

/**
 * Parse an exception thrown by the LLM layer into a structured, user-friendly
 * ChatError. The adapters throw messages shaped like
 *   `API 请求失败 (401): {"error":{"message":"invalid api key"}}`
 * — the raw JSON body (if any) is kept in `detail` so the UI can render it in a
 * collapsible area instead of dumping it into the chat as plain text.
 */
export function parseLLMError(error: unknown): ChatError {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const codeMatch = message.match(/\((\d{3})\)/)
  const code = codeMatch ? Number(codeMatch[1]) : undefined

  let type: ChatError['type']
  if (message.includes('超时') || message.toLowerCase().includes('timeout')) {
    type = 'timeout'
  } else if (
    message.toLowerCase().includes('failed to fetch') ||
    message.toLowerCase().includes('networkerror') ||
    message.toLowerCase().includes('load failed') ||
    message.toLowerCase().includes('network') ||
    message.includes('网络')
  ) {
    type = 'network'
  } else if (code === 401 || code === 403) {
    type = 'auth'
  } else if (code === 408 || code === 429) {
    type = 'rate_limit'
  } else if (code !== undefined && code >= 500) {
    type = 'server'
  } else {
    type = 'unknown'
  }

  const friendly = {
    auth: () => t('chat.errorAuth'),
    timeout: () => t('chat.errorTimeout'),
    network: () => t('chat.errorNetwork'),
    rate_limit: () => t('chat.errorRateLimit'),
    server: () => t('chat.errorServer', { code: code ?? 500 }),
    unknown: () => t('chat.errorUnknown'),
  }[type]()

  // Everything after the status prefix, e.g. `API 请求失败 (401): ` — the raw
  // upstream error body. Only surfaced inside the card's collapsible detail.
  const detailMatch = message.match(/^[\s\S]*?\):\s*([\s\S]+)$/)
  const detail = detailMatch && detailMatch[1].trim() ? detailMatch[1].trim() : undefined

  return { code, type, message: friendly, detail }
}
