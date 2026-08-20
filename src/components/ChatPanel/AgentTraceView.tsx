import { useState } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useI18n } from '@/i18n/useI18n'
import type { TranslationKey } from '@/i18n'
import { formatMs } from './ToolStepRow'
import ToolCallDetails from './ToolCallDetails'
import SubAgentProgressBlock from './SubAgentProgressBlock'
import { buildTraceEntries } from './traceEntries'
import type { TraceEntry } from './traceEntries'

/**
 * 轨迹视图（平铺时间线）—— 把持久化消息按时间顺序拍平成逐条编号的列表：
 * 用户 / AI / 工具各自成条（1、2、3…），每条显示角色标签与内容预览，点击
 * 展开查看完整详情（工具：参数 + 完整结果；AI：思考 + 正文 + 请求计时）。
 * 数据源是 session.messages，运行中随 appendToolResult / addMessage 自动更新。
 */

const ROLE_KEYS: Record<TraceEntry['kind'], TranslationKey> = {
  user: 'chat.roleUser',
  ai: 'chat.roleAssistant',
  tool: 'chat.roleTool',
}

const ROLE_STYLES: Record<TraceEntry['kind'], string> = {
  user: 'bg-[#3B82F6]/15 text-[#3B82F6]',
  ai: 'bg-[#2563EB]/15 text-[#2563EB]',
  tool: 'bg-[#E5BA7D]/15 text-[#E5BA7D]',
}

export default function AgentTraceView() {
  const t = useI18n()
  const session = useChatStore((s) => s.sessions.find((x) => x.id === s.activeSessionId))
  const isSessionRunning = useChatStore((s) => s.runningSessionIds.includes(s.activeSessionId ?? ''))
  const messages = session?.messages ?? []
  const entries = buildTraceEntries(messages, isSessionRunning)

  if (entries.length === 0) {
    return (
      <div className="h-full flex items-center justify-center px-6 text-nova-text-muted text-sm">
        {t('agent.traceEmpty')}
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      {entries.map((entry, i) => (
        <TraceRow key={entry.id} index={i} entry={entry} />
      ))}
    </div>
  )
}

function TraceRow({ index, entry }: { index: number; entry: TraceEntry }) {
  const t = useI18n()
  const [expanded, setExpanded] = useState(false)
  // 用户/AI 条目仅在有条目正文时可展开；工具条目始终可展开
  const hasDetails = entry.kind === 'tool' || !!entry.content || ('thinking' in entry && !!entry.thinking)

  return (
    <div className="border-b border-nova-border/40 last:border-b-0">
      <div
        role={hasDetails ? 'button' : undefined}
        tabIndex={hasDetails ? 0 : undefined}
        onClick={hasDetails ? () => setExpanded(!expanded) : undefined}
        onKeyDown={hasDetails ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded) } } : undefined}
        className={`flex items-center gap-2 px-2.5 py-1.5 ${hasDetails ? 'cursor-pointer transition-colors hover:bg-nova-hover/60' : 'cursor-default'}`}
      >
        {/* 序号 */}
        <span className="shrink-0 w-5 text-right text-[10px] tabular-nums text-nova-text-muted">{index + 1}</span>
        {/* 角色标签 */}
        <span className={`shrink-0 text-[10px] font-medium px-1.5 py-[1px] rounded-full ${ROLE_STYLES[entry.kind]}`}>
          {t(ROLE_KEYS[entry.kind])}
        </span>
        {/* 内容预览 */}
        <EntryPreview entry={entry} />
        {hasDetails && (
          <span
            className={`material-symbols-outlined text-[14px] leading-none text-nova-text-muted shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            aria-hidden
          >
            expand_more
          </span>
        )}
      </div>

      {expanded && hasDetails && (
        <div className="px-2.5 pb-2.5 pl-[38px]">
          <EntryDetails entry={entry} />
        </div>
      )}
    </div>
  )
}

/** 单行内容预览：用户/AI 取首个非空行截断；工具显示状态图标 + 工具名 + 结果摘要 */
function EntryPreview({ entry }: { entry: TraceEntry }) {
  if (entry.kind === 'tool') {
    const { toolCall, result, rejected, suspended } = entry
    const isPending = !result && !rejected && !suspended
    const isError = !!result?.isError || !!rejected
    const preview = result ? summarize(result.result) : ''
    return (
      <span className="flex items-center gap-1.5 min-w-0 flex-1">
        {suspended ? (
          <span className="text-nova-text-muted text-[12px] leading-none shrink-0">–</span>
        ) : isPending ? (
          <span className="material-symbols-outlined text-[13px] leading-none text-nova-accent animate-spin-slow shrink-0" aria-hidden>
            sync
          </span>
        ) : isError ? (
          <span className="material-symbols-outlined text-[13px] leading-none text-nova-text-muted shrink-0" aria-hidden>
            close
          </span>
        ) : (
          <span className="material-symbols-outlined text-[13px] leading-none text-nova-text-muted shrink-0" aria-hidden>
            check
          </span>
        )}
        <span className="font-mono text-[12px] text-nova-text-primary shrink-0 max-w-[140px] truncate">{toolCall.name}</span>
        {preview && <span className="truncate text-[12px] text-nova-text-secondary">{preview}</span>}
        {entry.result?.durationMs != null && (
          <span className="shrink-0 font-mono text-[10px] text-nova-text-muted/70">{formatMs(entry.result.durationMs)}</span>
        )}
      </span>
    )
  }
  return (
    <span className="min-w-0 flex-1 truncate text-[12.5px] text-nova-text-secondary">
      {firstLine(entry.content)}
    </span>
  )
}

/** 展开详情：工具显示参数/结果（+ 子智能体实时进度），用户/AI 显示思考与正文 */
function EntryDetails({ entry }: { entry: TraceEntry }) {
  const t = useI18n()

  if (entry.kind === 'tool') {
    return (
      <div className="flex flex-col gap-1.5">
        <ToolCallDetails toolCall={entry.toolCall} result={entry.result} />
        {entry.toolCall.name === 'run_subagent' && <SubAgentProgressBlock toolCallId={entry.toolCall.id} />}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {entry.kind === 'ai' && (
        <>
          {(entry.requestDurationMs != null || entry.ttftMs != null || entry.requestTokensIn != null || entry.requestTokensOut != null) && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-mono text-nova-text-muted">
              {entry.requestDurationMs != null && <span>{t('agent.traceDuration')} {formatMs(entry.requestDurationMs)}</span>}
              {entry.ttftMs != null && <span>{t('agent.traceTtft')} {formatMs(entry.ttftMs)}</span>}
              {entry.requestTokensIn != null && <span>{t('agent.traceTokensIn')} {entry.requestTokensIn}</span>}
              {entry.requestTokensOut != null && <span>{t('agent.traceTokensOut')} {entry.requestTokensOut}</span>}
            </div>
          )}
          {entry.thinking && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-nova-text-muted font-semibold">{t('chat.thinkingTitle')}</div>
              <div className="text-[12.5px] leading-[1.65] text-nova-text-muted whitespace-pre-wrap break-words">{entry.thinking}</div>
            </div>
          )}
        </>
      )}
      <div className="text-[12.5px] leading-[1.65] text-nova-text-secondary whitespace-pre-wrap break-words">{entry.content}</div>
    </div>
  )
}

/** 取首个非空行作为单行预览（保留纯空白内容原样） */
function firstLine(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean)
  return line ?? text
}

/** 折叠长结果到一行摘要 */
function summarize(result: string, maxLen = 60): string {
  const flat = result.replace(/\s+/g, ' ').trim()
  return flat.length > maxLen ? flat.slice(0, maxLen) + '…' : flat
}
