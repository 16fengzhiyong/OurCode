import { useState } from 'react'
import { useI18n } from '@/i18n/useI18n'
import ThinkingBlock from './ThinkingBlock'

interface AgentTimelineProps {
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, any> }>
  toolResults?: Array<{ toolCallId: string; name: string; result: string; isError?: boolean }>
  thinking?: string
}

/** Emoji icon per tool type — shown inside the timeline's round step icon */
const TOOL_ICONS: Record<string, string> = {
  read_file: '📄',
  list_directory: '📁',
  get_directory_tree: '🌳',
  search_files: '🔍',
  search_in_files: '🔎',
  write_file: '✏️',
  edit_file: '🔧',
  create_directory: '📂',
  delete_file: '🗑️',
  run_command: '⚡',
  manage_todo: '✅',
  submit_plan: '📋',
  ask_user_question: '❓',
  web_search: '🌐',
  read_url: '🔗',
  run_subagent: '🤖',
}

/** Extract a compact display key from a tool call's arguments */
function extractKey(tc: { name: string; arguments: Record<string, any> }): string {
  switch (tc.name) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'list_directory':
    case 'get_directory_tree':
    case 'create_directory':
    case 'delete_file':
      return tc.arguments.path?.split(/[/\\]/).pop() || tc.arguments.path || ''
    case 'search_files':
      return tc.arguments.pattern || ''
    case 'search_in_files':
      return tc.arguments.query || ''
    case 'run_command':
      return tc.arguments.command?.slice(0, 50) || ''
    case 'manage_todo':
      return `${tc.arguments.todos?.length || 0} items`
    case 'submit_plan':
      return tc.arguments.title || ''
    case 'ask_user_question':
      return tc.arguments.question?.slice(0, 40) || ''
    case 'web_search':
      return tc.arguments.query || ''
    case 'read_url':
      return tc.arguments.url || ''
    case 'run_subagent':
      return tc.arguments.name || tc.arguments.description?.slice(0, 30) || 'sub-agent'
    default:
      if (tc.name.startsWith('mcp__')) return tc.name.slice('mcp__'.length).split('__').pop() || tc.name
      return JSON.stringify(tc.arguments).slice(0, 40)
  }
}

/** Truncate a result string for compact display */
function truncateResult(result: string, maxLen = 200): string {
  if (result.length <= maxLen) return result
  return result.slice(0, maxLen) + '…'
}

/**
 * Agent execution flow — Stitch 高保真玻璃拟态版:
 * glass card header + thinking block + per-tool status chips + a vertical
 * timeline with round colored step icons.
 */
export default function AgentTimeline({ toolCalls, toolResults, thinking }: AgentTimelineProps) {
  const [expanded, setExpanded] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const t = useI18n()

  const getResult = (toolCallId: string) =>
    toolResults?.find((r) => r.toolCallId === toolCallId)

  const calls = toolCalls || []
  const hasAnyError = calls.some((tc) => getResult(tc.id)?.isError)
  const pendingCount = calls.filter((tc) => !getResult(tc.id)).length
  const doneCount = calls.length - pendingCount

  let statusIcon: string
  if (pendingCount > 0) {
    statusIcon = '⏳'
  } else if (hasAnyError) {
    statusIcon = '✗'
  } else {
    statusIcon = '✓'
  }

  const stepCount = calls.length

  // Don't render if there's nothing to show
  if (stepCount === 0 && !thinking) return null

  // Status chip class per tool (Stitch: green done / blue running / red error)
  const chipCls = (tc: { id: string }) => {
    const result = getResult(tc.id)
    if (result?.isError) return 'tool-chip-err'
    if (result) return 'tool-chip-ok'
    return 'tool-chip-run'
  }
  const chipStatus = (tc: { id: string }) => {
    const result = getResult(tc.id)
    if (result?.isError) return '✗'
    if (result) return '✓'
    return null // spinner rendered below
  }

  return (
    <div className="glass-panel rounded-xl overflow-hidden">
      {/* ── Header (Stitch: psychology icon + label-caps + step pill + status) ── */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 cursor-pointer select-none hover:bg-nova-hover transition-colors"
      >
        <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-white bg-accent-purple">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4.5a2.5 2.5 0 0 1 2.5 2.5c0 1.2.4 1.9 1.2 2.6a4.2 4.2 0 0 1 1.3 3.1c0 2.1-1.6 3.8-3.7 3.8H11a4 4 0 0 1-4-4c0-.8.2-1.5.6-2.1" />
            <path d="M12 2.5v2M12 19.5v2M3.5 9h2M18.5 9h2M5.6 4.6l1.4 1.4M17 14.9l1.4 1.4" opacity=".7" />
          </svg>
        </span>
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-accent-purple">
          {t('chat.agentExecutionFlow')}
        </span>
        <span className="text-[10px] font-semibold text-white bg-accent-purple px-2 py-0.5 rounded-full">
          {t('chat.totalSteps', { count: stepCount })}
        </span>
        <span className={`ml-auto text-[13px] font-bold ${pendingCount > 0 ? 'text-warning' : hasAnyError ? 'text-error' : 'text-success'}`}>
          {statusIcon}
        </span>
        <svg
          className={`w-4 h-4 text-nova-text-muted transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-nova-border px-3 py-3 flex flex-col gap-3">
          {/* ── Thinking block (Stitch: violet glass card) ── */}
          {thinking && <ThinkingBlock content={thinking} />}

          {/* ── Tool call chips (Stitch: colored status pills) ── */}
          {stepCount > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-nova-text-muted mb-1.5">
                {t('tool.toolCallLabel')} · {stepCount}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {calls.map((tc) => {
                  const key = extractKey(tc)
                  const isDetailOpen = detailId === tc.id
                  const status = chipStatus(tc)
                  return (
                    <button
                      key={tc.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        setDetailId(isDetailOpen ? null : tc.id)
                      }}
                      className={`${chipCls(tc)} ${isDetailOpen ? 'active' : ''}`}
                    >
                      {status ? (
                        <span className="shrink-0">{status}</span>
                      ) : (
                        <svg className="w-3 h-3 animate-spin-slow shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                      )}
                      <span>{tc.name}</span>
                      {key && <span className="opacity-70 truncate max-w-[110px]">“{key}”</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Vertical timeline (Stitch: round colored step icons + connector) ── */}
          {stepCount > 0 && (
            <div className="relative">
              <div className="absolute left-[15px] top-4 bottom-4 w-[2px] bg-nova-border" />
              <div className="flex flex-col gap-3.5">
                {calls.map((tc) => {
                  const icon = TOOL_ICONS[tc.name] || '🔧'
                  const key = extractKey(tc)
                  const result = getResult(tc.id)
                  const isDetailOpen = detailId === tc.id
                  const isSubAgent = tc.name === 'run_subagent'
                  const isPending = !result
                  const done = result && !result.isError
                  const failed = result?.isError

                  const iconBg = failed
                    ? 'bg-error text-white'
                    : done
                      ? 'bg-success text-white'
                      : 'bg-nova-accent text-white ring-2 ring-blue-500/30 shadow-[0_0_15px_rgba(0,88,188,0.4)]'

                  return (
                    <div key={tc.id}>
                      <div className="flex items-start gap-3 relative">
                        {/* Round step icon */}
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10 text-[15px] ${iconBg}`}>
                          {isPending ? (
                            <svg className="w-4 h-4 animate-spin-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                            </svg>
                          ) : (
                            <span>{icon}</span>
                          )}
                        </div>
                        {/* Step label + status */}
                        <div className="min-w-0 flex-1 pt-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-[13px] font-semibold ${failed ? 'text-error' : done ? 'text-nova-text-primary' : 'text-nova-accent'}`}>
                              {tc.name}
                            </span>
                            {key && <span className="font-mono text-[11px] text-nova-text-muted truncate">“{key}”</span>}
                          </div>
                          <div className="text-[11px] text-nova-text-muted">
                            {failed
                              ? `✗ ${t('tool.failed')}`
                              : done
                                ? `✓ ${result?.result?.length ? truncateResult(result.result, 60) : t('tool.done')}`
                                : <span className="flex items-center gap-1 text-warning animate-pulse-soft"><span className="w-1.5 h-1.5 rounded-full bg-warning" />{t('tool.running')}…</span>}
                          </div>

                          {/* Sub-agent nested card */}
                          {isSubAgent && !failed && (
                            <div className="mt-2 glass-panel rounded-md px-2.5 py-1.5 flex items-center gap-2 text-[12px]">
                              <span className="text-nova-accent animate-spin-slow inline-flex shrink-0">
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M21 12a9 9 0 1 1-9-9" />
                                  <path d="M21 3v6h-6" />
                                </svg>
                              </span>
                              <span className="font-semibold text-nova-text-secondary">{t('chat.subAgentRunning')}</span>
                              <span className="text-nova-text-muted truncate">{key}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ── Detail panel (args + result) ── */}
                      {isDetailOpen && (
                        <div className="ml-[44px] mt-1.5 border border-nova-border rounded-md bg-nova-hover overflow-hidden">
                          <div className="px-2 py-1 text-[11px] text-nova-text-muted">{t('tool.params')}</div>
                          <pre className="text-[12px] text-nova-text-secondary whitespace-pre-wrap break-all bg-nova-hover px-2 py-1 max-h-20 overflow-y-auto font-mono">
                            {JSON.stringify(tc.arguments, null, 2)}
                          </pre>
                          {result && (
                            <>
                              <div className="px-2 py-1 text-[11px] text-nova-text-muted border-t border-nova-border/50">{t('tool.result')}</div>
                              <pre className={`text-[12px] whitespace-pre-wrap break-all px-2 py-1 max-h-24 overflow-y-auto font-mono ${
                                result.isError ? 'text-error bg-error-10' : 'text-nova-text-secondary bg-nova-hover'
                              }`}>
                                {result.result}
                              </pre>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Summary footer */}
          <div className="text-[10px] text-nova-text-muted flex items-center gap-2 border-t border-nova-border pt-2">
            <span className="text-success">✓ {doneCount}</span>
            {pendingCount > 0 && <span className="text-warning">⏳ {pendingCount}</span>}
            {hasAnyError && <span className="text-error">✗</span>}
          </div>
        </div>
      )}
    </div>
  )
}
