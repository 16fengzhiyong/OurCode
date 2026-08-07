import { useState, useMemo } from 'react'
import { useI18n } from '@/i18n/useI18n'
import type { TranslationKey } from '@/i18n'

interface ToolCallBlockProps {
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, any> }>
  toolResults?: Array<{ toolCallId: string; name: string; result: string; isError?: boolean }>
  /** When embedded inside a parent collapse (e.g. unified process block), skip outer toggle */
  embedded?: boolean
}

const TOOL_ICONS: Record<string, string> = {
  read_file: '📄', list_directory: '📁', get_directory_tree: '🌳',
  search_files: '🔍', search_in_files: '🔎', write_file: '✏️',
  edit_file: '🔧', create_directory: '📂', delete_file: '🗑️',
  run_command: '⚡', manage_todo: '✅', submit_plan: '📋',
  ask_user_question: '❓', web_search: '🌐', read_url: '🔗',
}

const TOOL_LABEL_KEYS: Record<string, TranslationKey> = {
  read_file: 'tool.readFile', list_directory: 'tool.listDirectory', get_directory_tree: 'tool.getDirectoryTree',
  search_files: 'tool.searchFiles', search_in_files: 'tool.searchInFiles', write_file: 'tool.writeFile',
  edit_file: 'tool.editFile', create_directory: 'tool.createDirectory', delete_file: 'tool.deleteFile',
  run_command: 'tool.runCommand', manage_todo: 'tool.manageTodo', submit_plan: 'tool.submitPlan',
  ask_user_question: 'tool.askUserQuestion', web_search: 'tool.webSearch', read_url: 'tool.readUrl',
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
    case 'search_files': return tc.arguments.pattern || ''
    case 'search_in_files': return tc.arguments.query || ''
    case 'run_command': return tc.arguments.command?.slice(0, 50) || ''
    case 'manage_todo': return `${tc.arguments.todos?.length || 0} items`
    case 'submit_plan': return tc.arguments.title || ''
    case 'ask_user_question': return tc.arguments.question?.slice(0, 40) || ''
    case 'web_search': return tc.arguments.query || ''
    case 'read_url': return tc.arguments.url || ''
    default:
      if (tc.name.startsWith('mcp__')) return tc.name.slice('mcp__'.length).split('__').pop() || tc.name
      return JSON.stringify(tc.arguments).slice(0, 40)
  }
}

/** Group tool calls by type, preserving order of first appearance */
function groupByType(toolCalls: ToolCallBlockProps['toolCalls']) {
  const groups: Array<{ name: string; tools: typeof toolCalls }> = []
  const seen = new Set<string>()
  for (const tc of toolCalls) {
    if (seen.has(tc.name)) {
      const existing = groups.find((g) => g.name === tc.name)
      if (existing) existing.tools.push(tc)
    } else {
      seen.add(tc.name)
      groups.push({ name: tc.name, tools: [tc] })
    }
  }
  return groups
}

export default function ToolCallBlock({ toolCalls, toolResults, embedded = false }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(embedded) // auto-expand when embedded
  const [detailId, setDetailId] = useState<string | null>(null)
  const t = useI18n()

  const getResult = (toolCallId: string) => toolResults?.find((r) => r.toolCallId === toolCallId)

  const allDone = toolCalls.every((tc) => !!getResult(tc.id))
  const hasAnyError = toolCalls.some((tc) => getResult(tc.id)?.isError)
  const pendingCount = toolCalls.filter((tc) => !getResult(tc.id)).length

  let statusIcon: string
  let statusLabel: string
  if (pendingCount > 0) {
    statusIcon = '⏳'
    statusLabel = `${pendingCount}/${toolCalls.length}`
  } else if (hasAnyError) {
    statusIcon = '✗'
    statusLabel = t('tool.completedWithError')
  } else {
    statusIcon = '✓'
    statusLabel = ''
  }

  // Group same-type tools for aggregation
  const groups = useMemo(() => groupByType(toolCalls), [toolCalls])

  return (
    <div className={embedded ? '' : 'my-1'}>
      {/* ── Collapsed summary bar (only when standalone) ── */}
      {!expanded && !embedded ? (
        <button
          onClick={() => setExpanded(true)}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[13px] leading-none
                     text-nova-text-muted hover:text-nova-text-secondary hover:bg-nova-hover/50
                     transition-colors select-none"
        >
          <svg className="w-2.5 h-2.5 shrink-0 text-nova-text-muted transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 18l6-6-6-6" />
          </svg>
          <span className="text-nova-text-muted">{t('tool.toolCallLabel')}</span>
          <span className="text-nova-text-primary font-medium">· {toolCalls.length}</span>
          <span className="text-nova-accent">· {statusIcon}</span>
        </button>
      ) : (
        /* ── Expanded / embedded list ── */
        <div className={embedded ? '' : 'border-l-2 border-nova-accent/25 ml-[5px]'}>
          {/* Header bar (skip when embedded — parent has it) */}
          {!embedded && (
            <button
              onClick={() => setExpanded(false)}
              className="flex items-center gap-1.5 px-2 py-1 text-[13px] leading-none
                         text-nova-text-muted hover:text-nova-text-secondary transition-colors select-none w-full text-left"
            >
              <svg className="w-2.5 h-2.5 shrink-0 rotate-90 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 18l6-6-6-6" />
              </svg>
              <span>{t('tool.toolCallLabel')}</span>
              <span className="text-nova-text-primary font-medium">· {toolCalls.length}</span>
              <span className="text-nova-accent">· {statusIcon}</span>
            </button>
          )}

          {/* Aggregated tool lines */}
          <div className="pb-0.5">
            {groups.map((group) => {
              const icon = TOOL_ICONS[group.name] || '🔧'
              const labelKey = TOOL_LABEL_KEYS[group.name]
              const label = labelKey ? t(labelKey) : group.name

              return (
                <div key={group.name} className="px-2">
                  {/* Aggregated type row */}
                  <div className="flex items-start gap-1.5 py-[4px] text-[13px] leading-[1.4]">
                    <span className="shrink-0 mt-px">{icon}</span>
                    <span className="text-nova-text-muted shrink-0">{label}:</span>
                    <span className="flex flex-wrap gap-x-1 gap-y-0.5 min-w-0">
                      {group.tools.map((tc) => {
                        const key = extractKey(tc)
                        const result = getResult(tc.id)
                        if (!key) return null
                        const isDetailOpen = detailId === tc.id
                        return (
                          <span key={tc.id} className="inline-flex items-center gap-0.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setDetailId(isDetailOpen ? null : tc.id)
                              }}
                              className={`px-1.5 py-px rounded text-[13px] leading-[1.4] transition-colors ${
                                isDetailOpen
                                  ? 'bg-nova-accent/20 text-nova-accent'
                                  : 'bg-[var(--hl-bg,#3a3a3a)] text-[var(--hl-text,#e0e0e0)] hover:bg-[var(--hl-bg-hover,#4a4a4a)]'
                              }`}
                            >
                              {key}
                            </button>
                            <span className={`text-[11px] ${getResult(tc.id)?.isError ? 'text-red-400' : 'text-green-400'}`}>
                              {result?.isError ? '✗' : result ? '✓' : '⏳'}
                            </span>
                          </span>
                        )
                      })}
                    </span>
                  </div>

                  {/* Detail panel for a specific tool call */}
                  {group.tools.map((tc) => {
                    if (detailId !== tc.id) return null
                    const result = getResult(tc.id)
                    return (
                      <div key={`detail-${tc.id}`} className="ml-5 mb-1 border border-nova-border rounded-md bg-nova-bg/50 overflow-hidden">
                        <div className="px-2 py-1 text-[11px] text-nova-text-muted">{t('tool.params')}</div>
                        <pre className="text-[12px] text-nova-text-secondary whitespace-pre-wrap break-all bg-nova-bg/60 px-2 py-1 max-h-20 overflow-y-auto">
                          {JSON.stringify(tc.arguments, null, 2)}
                        </pre>
                        {result && (
                          <>
                            <div className="px-2 py-1 text-[11px] text-nova-text-muted border-t border-nova-border/50">{t('tool.result')}</div>
                            <pre className={`text-[12px] whitespace-pre-wrap break-all px-2 py-1 max-h-24 overflow-y-auto ${
                              result.isError ? 'text-red-400 bg-red-500/10' : 'text-nova-text-secondary bg-nova-bg/60'
                            }`}>
                              {result.result}
                            </pre>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
