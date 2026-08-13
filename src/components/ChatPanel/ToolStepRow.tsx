import { useState } from 'react'
import { useI18n } from '@/i18n/useI18n'
import type { TranslationKey } from '@/i18n'
import SubAgentProgressBlock from './SubAgentProgressBlock'

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

/**
 * Material Symbols Outlined 图标（Stitch「全工具增强版」设计）——
 * 每个工具类型一个符号名；设计稿未覆盖的工具按同类语义映射。
 */
const TOOL_ICONS: Record<string, string> = {
  read_file: 'description', read_multiple_files: 'collections_bookmark', list_directory: 'folder', get_directory_tree: 'account_tree',
  search_files: 'search', search_in_files: 'search', write_file: 'save',
  edit_file: 'edit', multi_edit_file: 'content_cut', create_directory: 'create_new_folder', delete_file: 'delete',
  run_command: 'terminal', manage_todo: 'task_alt', submit_plan: 'assignment',
  ask_user_question: 'help', web_search: 'language', read_url: 'link',
  run_subagent: 'smart_toy', send_message: 'forum',
  git_status: 'info', git_diff: 'difference', git_log: 'history', git_branch: 'call_split',
  git_add: 'add_box', git_push: 'publish', git_commit: 'commit', git_init: 'rocket_launch',
}

const TOOL_LABEL_KEYS: Record<string, TranslationKey> = {
  read_file: 'tool.readFile', read_multiple_files: 'tool.readMultipleFiles', list_directory: 'tool.listDirectory', get_directory_tree: 'tool.getDirectoryTree',
  search_files: 'tool.searchFiles', search_in_files: 'tool.searchInFiles', write_file: 'tool.writeFile',
  edit_file: 'tool.editFile', multi_edit_file: 'tool.multiEditFile', create_directory: 'tool.createDirectory', delete_file: 'tool.deleteFile',
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
    case 'read_multiple_files': {
      const paths = tc.arguments.paths?.length || 0
      return `${paths} files`
    }
    case 'multi_edit_file': {
      const edits = tc.arguments.edits?.length || 0
      return `${edits} edits`
    }
    case 'search_files': return tc.arguments.pattern || ''
    case 'search_in_files': return tc.arguments.query || ''
    case 'run_command': return tc.arguments.command?.slice(0, 50) || ''
    case 'manage_todo': return `${tc.arguments.todos?.length || 0} items`
    case 'submit_plan': return tc.arguments.title || ''
    case 'ask_user_question': return tc.arguments.question?.slice(0, 40) || ''
    case 'web_search': return tc.arguments.query || ''
    case 'read_url': return tc.arguments.url || ''
    case 'run_subagent': return tc.arguments.name || tc.arguments.description?.slice(0, 30) || 'sub-agent'
    case 'send_message': return tc.arguments.targetSessionId || tc.arguments.targetTitle || ''
    default:
      if (tc.name.startsWith('mcp__')) return tc.name.slice('mcp__'.length).split('__').pop() || tc.name
      return JSON.stringify(tc.arguments).slice(0, 40)
  }
}

/** Collapse a long result to a one-line summary (shown on the pill's tooltip) */
function summarizeResult(result: string, maxLen = 90): string {
  const flat = result.replace(/\s+/g, ' ').trim()
  return flat.length > maxLen ? flat.slice(0, maxLen) + '…' : flat
}

/**
 * 单个工具调用行（Stitch「全工具增强版」设计）：圆角胶囊
 *  = Material 图标 + mono 工具名 + 琥珀色 key chip + 分隔线 + 状态，
 *  点击展开参数/完整结果。Pending 胶囊带蓝色描边与旋转 spinner。
 */
export default function ToolStepRow({ toolCall, result, rejected, suspended = false }: ToolStepRowProps) {
  const [expanded, setExpanded] = useState(false)
  const t = useI18n()

  const icon = TOOL_ICONS[toolCall.name] || (toolCall.name.startsWith('mcp__') ? 'extension' : 'bolt')
  const labelKey = TOOL_LABEL_KEYS[toolCall.name]
  const key = extractKey(toolCall)
  const isPending = !result && !rejected && !suspended
  const isError = !!result?.isError || !!rejected

  const pillCls = expanded
    ? 'border-nova-accent/40 bg-nova-hover'
    : isPending
      ? 'border-nova-accent/30 bg-nova-accent/5'
      : 'border-nova-border/60 bg-nova-card/60 hover:bg-nova-hover/60'

  return (
    <div className="flex flex-col gap-1">
      {/* The pill row */}
      <button
        onClick={() => setExpanded(!expanded)}
        title={
          isPending ? t('tool.running')
          : suspended ? t('tool.notExecuted')
          : rejected ? t('tool.rejected')
          : result?.result ? summarizeResult(result.result) : undefined
        }
        className={`inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 rounded-full border transition-colors select-none text-left max-w-full ${pillCls}`}
      >
        <span className="material-symbols-outlined text-[14px] leading-none text-nova-text-secondary shrink-0" aria-hidden>
          {icon}
        </span>
        <span className="font-mono text-[11.5px] text-nova-text-primary shrink-0">
          {labelKey ? t(labelKey) : toolCall.name}
        </span>
        {key && (
          <span className="font-mono text-[11px] text-nova-text-secondary bg-nova-hover px-1.5 py-0.5 rounded truncate max-w-[150px]">
            “{key}”
          </span>
        )}
        <span className="w-px h-3 bg-nova-border/60 mx-0.5 shrink-0" aria-hidden />
        {/* Status */}
        {suspended ? (
          <span className="text-nova-text-muted text-[12px] leading-none shrink-0">–</span>
        ) : isPending ? (
          <span className="material-symbols-outlined text-[14px] leading-none text-nova-accent animate-spin-slow shrink-0" aria-hidden>
            progress_activity
          </span>
        ) : isError ? (
          <span className="material-symbols-outlined text-[14px] leading-none text-error shrink-0" aria-hidden>
            close
          </span>
        ) : (
          <span className="material-symbols-outlined text-[14px] leading-none text-success shrink-0" aria-hidden>
            check
          </span>
        )}
        {/* Chevron — 展开/收起 */}
        <span
          className={`material-symbols-outlined text-[14px] leading-none text-nova-text-muted shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        >
          expand_more
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
              <div className="px-2.5 pt-1.5 flex items-center justify-between border-t border-nova-border/60">
                <span className="text-[10px] uppercase tracking-wider text-nova-text-muted font-semibold">
                  {t('tool.result')}
                </span>
                <button
                  onClick={() => { navigator.clipboard.writeText(result.result).catch(() => { /* ignore */ }) }}
                  title={t('common.copy')}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-nova-hover border border-nova-border text-nova-text-muted hover:text-nova-text-primary hover:border-nova-accent/40 transition-colors"
                >
                  {t('common.copy')}
                </button>
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

      {/* 子智能体（run_subagent）：胶囊下方内嵌实时执行进度面板 —— 思考、
          内部工具调用与结果边执行边显示，不再等到最终报告才可见 */}
      {toolCall.name === 'run_subagent' && (
        <SubAgentProgressBlock toolCallId={toolCall.id} />
      )}
    </div>
  )
}
