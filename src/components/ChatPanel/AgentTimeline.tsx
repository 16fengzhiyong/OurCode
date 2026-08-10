import { useState } from 'react'
import { useI18n } from '@/i18n/useI18n'

interface AgentTimelineProps {
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, any> }>
  toolResults?: Array<{ toolCallId: string; name: string; result: string; isError?: boolean }>
  thinking?: string
}

/** Fixed emoji icons per tool type — for rapid visual scanning */
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

export default function AgentTimeline({ toolCalls, toolResults, thinking }: AgentTimelineProps) {
  const [expanded, setExpanded] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const t = useI18n()

  const getResult = (toolCallId: string) =>
    toolResults?.find((r) => r.toolCallId === toolCallId)

  const calls = toolCalls || []
  const hasAnyError = calls.some((tc) => getResult(tc.id)?.isError)
  const pendingCount = calls.filter((tc) => !getResult(tc.id)).length

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

  return (
    <div className="workflow-wrapper">
      {/* ── Collapsed summary bar ── */}
      {!expanded ? (
        <button
          onClick={() => setExpanded(true)}
          className="timeline-toggle w-full text-left flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--hl-bg)] hover:bg-[var(--hl-bg-hover)] transition-colors"
        >
          <span className="arrow text-[10px] text-nova-text-muted">▶</span>
          <span className="text-[13px] text-nova-text-muted">🤖 {t('chat.agentExecutionFlow')}</span>
          <span
            className="text-[11px] px-2 py-px rounded-full font-semibold"
            style={{ background: 'color-mix(in srgb, var(--accent-purple, #7c3aed) 12%, transparent)', color: 'var(--accent-purple, #7c3aed)' }}
          >
            {t('chat.totalSteps', { count: stepCount })}
          </span>
          <span className="text-nova-accent text-[11px] ml-auto">{statusIcon}</span>
        </button>
      ) : (
        /* ── Expanded timeline ── */
        <>
          <button
            onClick={() => setExpanded(false)}
            className="timeline-toggle open w-full text-left flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--hl-bg)] hover:bg-[var(--hl-bg-hover)] transition-colors"
          >
            <span className="arrow open text-[10px] text-nova-text-muted">▶</span>
            <span className="text-[13px] text-nova-text-muted">🤖 {t('chat.agentExecutionFlow')}</span>
            <span
              className="text-[11px] px-2 py-px rounded-full font-semibold"
              style={{ background: 'color-mix(in srgb, var(--accent-purple, #7c3aed) 12%, transparent)', color: 'var(--accent-purple, #7c3aed)' }}
            >
              {t('chat.totalSteps', { count: stepCount })}
            </span>
            <span className="text-nova-accent text-[11px] ml-auto">{statusIcon}</span>
          </button>

          <div className="workflow-content">
            {/* ── Thinking block (interleaved at top) ── */}
            {thinking && (
              <div className="step-text-output">
                💬 {t('chat.thinkingOutput')}：{thinking}
              </div>
            )}

            {/* ── Tool call steps ── */}
            {calls.map((tc, idx) => {
              const icon = TOOL_ICONS[tc.name] || '🔧'
              const key = extractKey(tc)
              const result = getResult(tc.id)
              const isDetailOpen = detailId === tc.id
              const isSubAgent = tc.name === 'run_subagent'

              return (
                <div key={tc.id}>
                  {/* Step row */}
                  <div
                    className={`timeline-row ${idx < calls.length - 1 ? 'border-l-2 border-[var(--border-strong)] ml-[10px] pl-2.5 mb-0.5' : 'border-l-2 border-transparent ml-[10px] pl-2.5'}`}
                  >
                    <span className="step-icon">{icon}</span>
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      <span className="text-nova-text-muted text-[13px] shrink-0">
                        {t('tool.toolCallLabel')}：
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setDetailId(isDetailOpen ? null : tc.id)
                        }}
                        className={`${
                          result?.isError ? 'tool-chip-err' : result ? 'tool-chip-ok' : 'tool-chip-run'
                        } ${isDetailOpen ? 'active' : ''}`}
                      >
                        <span className="shrink-0">
                          {result?.isError ? '✗' : result ? '✓' : '⏳'}
                        </span>
                        <span>{tc.name}</span>
                        {key && (
                          <>
                            {' '}
                            <span className="param opacity-70">&quot;{key}&quot;</span>
                          </>
                        )}
                      </button>
                      {/* Status */}
                      <span
                        className={`text-[11px] shrink-0 ${
                          result?.isError ? 'text-red-400' : result ? 'text-green-400' : 'text-nova-text-muted'
                        }`}
                      >
                        {result?.isError ? '✗' : result ? '✓' : '⏳'}
                      </span>
                    </div>
                  </div>

                  {/* ── Sub-agent nested block ── */}
                  {isSubAgent && (
                    <div className="sub-agent-block">
                      <div className="text-[12px] text-[var(--hl-text)] bg-[var(--hl-bg)] inline-block px-2 py-0.5 rounded mb-1">
                        🔄 {t('chat.subAgentRunning')}
                      </div>
                      {result && (
                        <div className="text-[12px] text-nova-text-muted whitespace-pre-wrap leading-[1.5] opacity-80">
                          {truncateResult(result.result, 300)}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Detail panel (args + result) ── */}
                  {isDetailOpen && (
                    <div className="ml-[30px] mb-1.5 border border-nova-border rounded-md bg-nova-bg/50 overflow-hidden">
                      <div className="px-2 py-1 text-[11px] text-nova-text-muted">
                        {t('tool.params')}
                      </div>
                      <pre className="text-[12px] text-nova-text-secondary whitespace-pre-wrap break-all bg-nova-bg/60 px-2 py-1 max-h-20 overflow-y-auto font-mono">
                        {JSON.stringify(tc.arguments, null, 2)}
                      </pre>
                      {result && (
                        <>
                          <div className="px-2 py-1 text-[11px] text-nova-text-muted border-t border-nova-border/50">
                            {t('tool.result')}
                          </div>
                          <pre
                            className={`text-[12px] whitespace-pre-wrap break-all px-2 py-1 max-h-24 overflow-y-auto font-mono ${
                              result.isError
                                ? 'text-red-400 bg-red-500/10'
                                : 'text-nova-text-secondary bg-nova-bg/60'
                            }`}
                          >
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
        </>
      )}
    </div>
  )
}
