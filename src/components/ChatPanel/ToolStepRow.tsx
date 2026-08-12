import { useState } from 'react'
import { useI18n } from '@/i18n/useI18n'
import type { TranslationKey } from '@/i18n'

export interface ToolStepRowProps {
  toolCall: { id: string; name: string; arguments: Record<string, any> }
  /** Committed result (absent ⇒ the tool is still running) */
  result?: { result: string; isError?: boolean }
  /** Explicit rejection (user declined the batch / tool approval) */
  rejected?: boolean
  /** True when no result will ever arrive (run stopped mid-batch, or a legacy
   *  session whose tool messages were stored standalone). Prevents an eternal
   *  spinner — renders a muted "not executed" state instead. */
  suspended?: boolean
}

/** Emoji icon per tool type — shown inside the row's leading icon */
const TOOL_ICONS: Record<string, string> = {
  read_file: '📄', list_directory: '📁', get_directory_tree: '🌳',
  search_files: '🔍', search_in_files: '🔎', write_file: '✏️',
  edit_file: '🔧', create_directory: '📂', delete_file: '🗑️',
  run_command: '⚡', manage_todo: '✅', submit_plan: '📋',
  ask_user_question: '❓', web_search: '🌐', read_url: '🔗',
  run_subagent: '🤖',
}

const TOOL_LABEL_KEYS: Record<string, TranslationKey> = {
  read_file: 'tool.readFile', list_directory: 'tool.listDirectory', get_directory_tree: 'tool.getDirectoryTree',
  search_files: 'tool.searchFiles', search_in_files: 'tool.searchInFiles', write_file: 'tool.writeFile',
  edit_file: 'tool.editFile', create_directory: 'tool.createDirectory', delete_file: 'tool.deleteFile',
  run_command: 'tool.runCommand', manage_todo: 'tool.manageTodo', submit_plan: 'tool.submitPlan',
  ask_user_question: 'tool.askUserQuestion', web_search: 'tool.webSearch', read_url: 'tool.readUrl',
}

/** Extract a compact display key from a tool call's arguments */
function extractKey(tc: ToolStepRowProps['toolCall']): string {
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
    case 'run_subagent': return tc.arguments.name || tc.arguments.description?.slice(0, 30) || 'sub-agent'
    default:
      if (tc.name.startsWith('mcp__')) return tc.name.slice('mcp__'.length).split('__').pop() || tc.name
      return JSON.stringify(tc.arguments).slice(0, 40)
  }
}

/** Collapse a long result to a one-line summary for the inline caption */
function summarizeResult(result: string, maxLen = 90): string {
  const flat = result.replace(/\s+/g, ' ').trim()
  return flat.length > maxLen ? flat.slice(0, maxLen) + '…' : flat
}

/**
 * One tool call rendered as its own row in the linear transcript (极简纯净版):
 * icon + mono name + compact key + status, click to expand args/result.
 * Pending rows spin in accent blue and flip to ✓/✗ in place when the result lands.
 */
export default function ToolStepRow({ toolCall, result, rejected, suspended = false }: ToolStepRowProps) {
  const [expanded, setExpanded] = useState(false)
  const t = useI18n()

  const icon = TOOL_ICONS[toolCall.name] || '🔧'
  const labelKey = TOOL_LABEL_KEYS[toolCall.name]
  const key = extractKey(toolCall)
  const isPending = !result && !rejected && !suspended
  const isError = !!result?.isError || !!rejected
  const done = !!result && !result.isError

  return (
    <div className="flex flex-col gap-1">
      {/* Status caption (one line, secondary) — pending shows spinner + 执行中 */}
      {isPending && (
        <div className="flex items-center gap-1.5 text-[11px] text-nova-text-muted pl-0.5">
          <svg className="w-3 h-3 animate-spin-slow text-nova-accent shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span className="font-mono">{t('tool.running')}…</span>
        </div>
      )}
      {suspended && (
        <div className="text-[11px] text-nova-text-muted pl-0.5">
          <span className="text-nova-text-muted mr-1">—</span>
          {t('tool.notExecuted')}
        </div>
      )}
      {done && result && (
        <div className="text-[11px] text-nova-text-muted pl-0.5 truncate" title={result.result}>
          <span className="text-success mr-1">✓</span>
          {summarizeResult(result.result)}
        </div>
      )}
      {isError && (
        <div className="text-[11px] text-nova-text-muted pl-0.5 truncate">
          <span className="text-error mr-1">✗</span>
          {rejected ? t('tool.rejected') : (result?.result ? summarizeResult(result.result) : t('tool.failed'))}
        </div>
      )}

      {/* The pill row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`inline-flex items-center gap-1.5 pl-2 pr-2 py-1 rounded-lg border transition-colors select-none text-left max-w-full ${
          expanded ? 'border-nova-accent/40 bg-nova-hover' : 'border-nova-border bg-nova-surface/40 hover:bg-nova-hover'
        } ${isPending ? 'border-nova-accent/30' : ''}`}
      >
        <span className="shrink-0 text-[13px] leading-none">{icon}</span>
        <span className="font-mono text-[11.5px] font-semibold text-nova-accent shrink-0">
          {labelKey ? t(labelKey) : toolCall.name}
        </span>
        {key && (
          <span className="font-mono text-[11px] text-nova-text-muted truncate max-w-[130px]">
            <span className="opacity-70">“</span>{key}<span className="opacity-70">”</span>
          </span>
        )}
        <span className="ml-auto shrink-0 flex items-center">
          {suspended ? (
            <span className="text-nova-text-muted text-[12px] leading-none">–</span>
          ) : isPending ? (
            <svg className="w-3 h-3 animate-spin-slow text-nova-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : isError ? (
            <span className="text-error text-[12px] leading-none">✗</span>
          ) : (
            <span className="text-success text-[12px] leading-none">✓</span>
          )}
          <svg
            className={`w-3 h-3 ml-1 text-nova-text-muted transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>

      {/* Expandable detail: args + full result */}
      {expanded && (
        <div className="ml-2 border border-nova-border rounded-lg overflow-hidden bg-nova-surface/40">
          <div className="px-2.5 pt-1.5 text-[10px] uppercase tracking-wider text-nova-text-muted font-semibold">
            {t('tool.params')}
          </div>
          <pre className="px-2.5 pb-1.5 pt-0.5 text-[11.5px] font-mono text-nova-text-secondary whitespace-pre-wrap break-all leading-[1.55] max-h-32 overflow-y-auto">
            {JSON.stringify(toolCall.arguments, null, 2)}
          </pre>
          {result && (
            <>
              <div className="px-2.5 pt-1.5 text-[10px] uppercase tracking-wider text-nova-text-muted font-semibold border-t border-nova-border/60">
                {t('tool.result')}
              </div>
              <pre className={`px-2.5 pb-2 pt-0.5 text-[11.5px] font-mono whitespace-pre-wrap break-all leading-[1.55] max-h-40 overflow-y-auto ${
                isError ? 'text-error' : 'text-nova-text-secondary'
              }`}>
                {result.result}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}
