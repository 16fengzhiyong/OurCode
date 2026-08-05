import { useState } from 'react'
import { useI18n } from '@/i18n/useI18n'
import type { TranslationKey } from '@/i18n'

interface ToolCallBlockProps {
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, any> }>
  toolResults?: Array<{ toolCallId: string; name: string; result: string; isError?: boolean }>
}

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
}

const TOOL_LABEL_KEYS: Record<string, TranslationKey> = {
  read_file: 'tool.readFile',
  list_directory: 'tool.listDirectory',
  get_directory_tree: 'tool.getDirectoryTree',
  search_files: 'tool.searchFiles',
  search_in_files: 'tool.searchInFiles',
  write_file: 'tool.writeFile',
  edit_file: 'tool.editFile',
  create_directory: 'tool.createDirectory',
  delete_file: 'tool.deleteFile',
  run_command: 'tool.runCommand',
  manage_todo: 'tool.manageTodo',
  submit_plan: 'tool.submitPlan',
  ask_user_question: 'tool.askUserQuestion',
  web_search: 'tool.webSearch',
  read_url: 'tool.readUrl',
}

export default function ToolCallBlock({ toolCalls, toolResults }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const t = useI18n()

  const toggle = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const getResult = (toolCallId: string) => {
    return toolResults?.find((r) => r.toolCallId === toolCallId)
  }

  return (
    <div className="my-2 space-y-1">
      {toolCalls.map((tc) => {
        const result = getResult(tc.id)
        const icon = TOOL_ICONS[tc.name] || '🔧'
        const labelKey = TOOL_LABEL_KEYS[tc.name]
        const label = labelKey ? t(labelKey) : tc.name
        const isExpanded = expanded[tc.id]
        const hasResult = !!result
        const isError = result?.isError

        return (
          <div
            key={tc.id}
            className={`rounded-lg border text-xs font-mono overflow-hidden ${
              isError
                ? 'border-red-500/30 bg-red-500/5'
                : hasResult
                  ? 'border-nova-accent/20 bg-nova-accent/5'
                  : 'border-nova-border bg-nova-surface/50'
            }`}
          >
            <button
              onClick={() => toggle(tc.id)}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-nova-hover/30 transition-colors text-left"
            >
              <span>{icon}</span>
              <span className="text-nova-text-primary font-medium">{label}</span>
              <span className="text-nova-text-muted truncate flex-1">
                {getToolSummary(tc.name, tc.arguments, t)}
              </span>
              <span className="text-nova-text-muted">
                {hasResult ? (isError ? '✗' : '✓') : '⏳'}
              </span>
              <svg
                className={`w-3 h-3 text-nova-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isExpanded && (
              <div className="border-t border-nova-border/50 px-3 py-2">
                <div className="text-nova-text-muted mb-1">{t('tool.params')}</div>
                <pre className="text-nova-text-secondary whitespace-pre-wrap break-all bg-nova-bg/50 rounded p-2 mb-2">
                  {JSON.stringify(tc.arguments, null, 2)}
                </pre>
                {result && (
                  <>
                    <div className="text-nova-text-muted mb-1">{t('tool.result')}</div>
                    <pre className={`whitespace-pre-wrap break-all rounded p-2 ${
                      isError ? 'text-red-400 bg-red-500/10' : 'text-nova-text-secondary bg-nova-bg/50'
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
  )
}

function getToolSummary(name: string, args: Record<string, any>, t: (key: TranslationKey, vars?: Record<string, string | number>) => string): string {
  switch (name) {
    case 'read_file':
      return args.path?.split(/[/\\]/).pop() || args.path
    case 'write_file':
      return args.path?.split(/[/\\]/).pop() || args.path
    case 'edit_file':
      return args.path?.split(/[/\\]/).pop() || args.path
    case 'list_directory':
      return args.path?.split(/[/\\]/).pop() || args.path
    case 'get_directory_tree':
      return args.path?.split(/[/\\]/).pop() || args.path
    case 'search_files':
      return args.pattern || ''
    case 'search_in_files':
      return args.query || ''
    case 'create_directory':
      return args.path?.split(/[/\\]/).pop() || args.path
    case 'delete_file':
      return args.path?.split(/[/\\]/).pop() || args.path
    case 'run_command':
      return args.command?.slice(0, 50) || ''
    case 'manage_todo':
      return t('tool.todoCount', { count: Array.isArray(args.todos) ? args.todos.length : 0 })
    case 'submit_plan':
      return args.title || ''
    case 'ask_user_question':
      return args.question?.slice(0, 50) || ''
    case 'web_search':
      return args.query || ''
    case 'read_url':
      return args.url || ''
    default:
      if (name.startsWith('mcp__')) return name.slice('mcp__'.length).split('__').pop() || name
      return JSON.stringify(args).slice(0, 50)
  }
}
