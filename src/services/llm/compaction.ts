/**
 * Context compaction — replaces the pre-boundary history with an LLM summary
 * when the estimated context confirms the model's window is nearly full.
 *
 * Two invariants keep this side-effect free:
 * - Original messages are NEVER deleted: the summary lives on the session
 *   (ChatSession.summary / summaryMessageCount) and only replaces history in
 *   the REQUEST view. Storage, UI and editable history stay untouched.
 * - Compaction only fires when the estimate CONFIRMS overflow (or the provider
 *   reported a context-overflow error, which forces it). Under the threshold
 *   nothing happens; on summarizer failure the caller falls back to the
 *   existing lossy trim, so behavior degrades to today's exactly.
 */

import { ApiConfigGroup } from '@/types'
import { lookupModelMetadata } from '@shared/constants'
import { useConfigStore } from '@/stores/configStore'
import { sendLLMRequest } from './LLMClient'

/** Marker prefix of the summary system message injected into requests. */
export const SUMMARY_MARKER = '[上下文压缩]'

/** Fallback context window when the model has no metadata entry (tokens). */
export const DEFAULT_CONTEXT_WINDOW = 128_000

/**
 * Resolve a model's context window (tokens), most-specific first:
 *  user-defined custom model window → static metadata table → default.
 * Mirrors configStore.enrichModel's priority so compaction and the history
 * trim agree with what the UI shows — a custom Ollama model with an 8k window
 * must compact at 8k, not wait for the 128k default.
 */
export function getContextWindow(modelId: string): number {
  const custom = useConfigStore.getState().customModels.find((m) => m.id === modelId)
  const meta = lookupModelMetadata(modelId)
  return custom?.contextWindow || meta?.contextWindow || DEFAULT_CONTEXT_WINDOW
}
/** Trigger threshold: compact when the estimate exceeds this fraction of the
 *  model's context window (same 80% headroom trimHistoryForContext uses). */
export const DEFAULT_COMPACTION_RATIO = 0.8
/** Cap on the summarizer's input size (chars) — bounds the cost of the
 *  summarizer call itself on very large contexts (e.g. 2M-token models). */
const MAX_SUMMARIZE_CHARS = 400_000

/** Message shape the compaction logic needs (compatible with the request
 *  message type, so the rebuilt array can be assigned back directly). */
export interface CompactMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

export interface CompactOptions {
  session: { summary?: string; summaryMessageCount?: number }
  /** The request-side message array: [system, ...session messages]. */
  messages: CompactMessage[]
  /** Skip the budget check and always compact (context-overflow fallback). */
  force?: boolean
  signal?: AbortSignal
  contextWindow?: number
  ratio?: number
  compactionEnabled: boolean
  /** Calibrated token estimator (chatStore's, injected to avoid duplication). */
  estimateTokens: (text: string) => number
  /** Summary generator — injected so tests can fake it; chatStore wires the
   *  real LLM summarizer. Returns '' (or throws) on failure. */
  summarize: (input: { anchor: string; history: string }) => Promise<string>
}

export interface CompactResult {
  /** Rebuilt request array: [system, summary, ...tail] — tail starts at the
   *  current user turn, which is always kept verbatim. */
  messages: CompactMessage[]
  /** The raw summary text (persist to ChatSession.summary as the next anchor). */
  summary: string
  /** Number of session messages covered by the summary (persist to
   *  ChatSession.summaryMessageCount). */
  boundaryCount: number
}

/** Index of the last user message — everything before it is summarizable, the
 *  current user turn (and anything after it) is always kept verbatim. */
export function findKeepBoundary(messages: CompactMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i
  }
  return 0
}

export function buildSummaryBlock(summary: string): string {
  return `${SUMMARY_MARKER} 较早的对话已压缩为以下摘要，仅作背景参考：\n\n${summary}`
}

/** True for the injected summary system message (filtered from summarizer
 *  input — the previous summary is passed as the anchor instead). */
export function isSummaryMessage(m: CompactMessage): boolean {
  return m.role === 'system' && m.content.startsWith(SUMMARY_MARKER)
}

const SUMMARIZE_SYSTEM_PROMPT = `你是对话历史压缩器。把用户提供的对话历史压缩成一段结构化的中文摘要，供后续对话作为背景参考。

要求：
- 保留：用户的核心目标、已完成的修改与决策、涉及的文件路径、未完成事项、todo 进度、计划状态、阻塞点、已知问题
- 忽略：工具执行的中间细节、重复的探索过程、临时的猜测
- 使用固定结构输出：
## 目标
## 关键细节
## 工作状态（Completed / Active / Blocked）
## 下一步
## 相关文件
- 只输出摘要本身，不要任何开场白或解释`

export function buildSummarizePrompt(anchor: string, history: string): { system: string; user: string } {
  const anchorBlock = anchor.trim()
    ? `已有摘要（请基于它更新而非重写，保留仍为真的信息，删除已过时的信息）：\n${anchor.trim()}\n`
    : ''
  return {
    system: SUMMARIZE_SYSTEM_PROMPT,
    user: `${anchorBlock}对话历史：\n${history}`,
  }
}

function renderHistoryEntry(m: CompactMessage): string {
  const label = m.role === 'user' ? '用户' : m.role === 'assistant' ? 'AI' : '工具结果'
  return `${label}: ${m.content}`
}

/**
 * Real summarizer backed by sendLLMRequest (non-streaming, bounded output).
 * Returns '' on any failure so callers fall back to the lossy trim.
 */
export async function runSummarizer(input: {
  model: string
  anchor: string
  history: string
  configGroup: ApiConfigGroup
  signal?: AbortSignal
  maxTokens?: number
  /** Called once with the billed tokens when the summarizer call completed. */
  onUsage?: (usage: { tokensIn: number; tokensOut: number }) => void
}): Promise<string> {
  const { system, user } = buildSummarizePrompt(input.anchor, input.history)
  let summary = ''
  let tokensIn = 0
  let tokensOut = 0
  for await (const chunk of sendLLMRequest(
    {
      model: input.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream: false,
      temperature: 0,
      maxTokens: input.maxTokens ?? 2000,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
    },
    input.configGroup,
  )) {
    if (input.signal?.aborted) break
    if (chunk.usage) {
      tokensIn = chunk.usage.promptTokens || 0
      tokensOut = chunk.usage.completionTokens || 0
    }
    if (chunk.content) summary += chunk.content
    if (chunk.done) break
  }
  input.onUsage?.({ tokensIn, tokensOut })
  return summary.trim()
}

/**
 * Compaction entry point. Returns the rebuilt request array + summary metadata
 * when compaction happened, or null when nothing changed (disabled, under
 * budget, nothing to summarize, summarizer failed, aborted).
 */
export async function maybeCompact(opts: CompactOptions): Promise<CompactResult | null> {
  if (!opts.compactionEnabled) return null
  if (opts.signal?.aborted) return null
  if (opts.messages.length === 0) return null

  const boundary = findKeepBoundary(opts.messages)
  // Nothing before the current user turn (system prompt only) — nothing to summarize.
  if (boundary <= 1) return null

  // Trigger only when the estimate CONFIRMS we're over the budget — under the
  // threshold the history stays untouched. (force skips the check.)
  if (!opts.force) {
    const contextWindow = opts.contextWindow ?? DEFAULT_CONTEXT_WINDOW
    const ratio = opts.ratio ?? DEFAULT_COMPACTION_RATIO
    const budget = Math.floor(contextWindow * ratio)
    const total = opts.messages.reduce((sum, m) => sum + opts.estimateTokens(m.content), 0)
    if (total <= budget) return null
  }

  // History to summarize = everything between the system prompt and the
  // current user turn. The previous summary message (if any) is excluded — it
  // is passed as the anchor so summaries update instead of rewrite.
  const history = opts.messages.slice(1, boundary).filter((m) => !isSummaryMessage(m))
  if (history.length === 0) return null

  let historyText = history.map(renderHistoryEntry).join('\n\n')
  if (historyText.length > MAX_SUMMARIZE_CHARS) {
    historyText = `…（更早的内容已省略）\n\n${historyText.slice(-MAX_SUMMARIZE_CHARS)}`
  }

  let summary: string
  try {
    summary = (await opts.summarize({ anchor: opts.session.summary || '', history: historyText })) || ''
  } catch {
    // Summarizer failure — leave the decision to the caller (lossy trim).
    return null
  }
  if (!summary.trim()) return null

  return {
    messages: [opts.messages[0], { role: 'system', content: buildSummaryBlock(summary) }, ...opts.messages.slice(boundary)],
    summary: summary.trim(),
    boundaryCount: boundary - 1,
  }
}
