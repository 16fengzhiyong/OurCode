import { useState } from 'react'

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
}

const TOOL_LABELS: Record<string, string> = {
  read_file: '读取文件',
  list_directory: '列出目录',
  get_directory_tree: '目录树',
  search_files: '搜索文件',
  search_in_files: '搜索内容',
  write_file: '写入文件',
  edit_file: '编辑文件',
  create_directory: '创建目录',
  delete_file: '删除',
  run_command: '执行命令',
}

export default function ToolCallBlock({ toolCalls, toolResults }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

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
        const label = TOOL_LABELS[tc.name] || tc.name
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
                {getToolSummary(tc.name, tc.arguments)}
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
                <div className="text-nova-text-muted mb-1">参数:</div>
                <pre className="text-nova-text-secondary whitespace-pre-wrap break-all bg-nova-bg/50 rounded p-2 mb-2">
                  {JSON.stringify(tc.arguments, null, 2)}
                </pre>
                {result && (
                  <>
                    <div className="text-nova-text-muted mb-1">结果:</div>
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

function getToolSummary(name: string, args: Record<string, any>): string {
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
    default:
      return JSON.stringify(args).slice(0, 50)
  }
}
