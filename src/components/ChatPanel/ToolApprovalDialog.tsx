import { useChatStore } from '@/stores/chatStore'

export default function ToolApprovalDialog() {
  const { pendingApproval, approveToolCall, rejectToolCall } = useChatStore()

  if (!pendingApproval) return null

  const { toolCall, preview } = pendingApproval

  return (
    <div role="dialog" aria-modal="true" aria-label="工具审批" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-nova-surface border border-nova-border rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-nova-border bg-nova-bg/50">
          <span className="text-yellow-400 text-lg">⚠️</span>
          <h3 className="text-nova-text-primary font-medium">工具调用审批</h3>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          <div>
            <span className="text-nova-text-muted text-sm">工具: </span>
            <span className="text-nova-accent font-mono text-sm">{toolCall.name}</span>
          </div>

          <div className="bg-nova-bg/50 rounded-lg p-3 border border-nova-border">
            <pre className="text-nova-text-secondary text-xs whitespace-pre-wrap font-mono">
              {preview}
            </pre>
          </div>

          {toolCall.name === 'edit_file' && toolCall.arguments.oldText && (
            <div className="space-y-1">
              <div className="text-xs text-nova-text-muted">变更预览:</div>
              <div className="bg-red-500/10 border border-red-500/20 rounded p-2">
                <div className="text-red-400 text-xs font-mono">
                  - {(toolCall.arguments.oldText || '').slice(0, 200)}
                  {(toolCall.arguments.oldText || '').length > 200 && '...'}
                </div>
              </div>
              <div className="bg-green-500/10 border border-green-500/20 rounded p-2">
                <div className="text-green-400 text-xs font-mono">
                  + {(toolCall.arguments.newText || '').slice(0, 200)}
                  {(toolCall.arguments.newText || '').length > 200 && '...'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-nova-border bg-nova-bg/30">
          <button
            onClick={rejectToolCall}
            className="px-4 py-1.5 text-sm text-nova-text-secondary hover:text-nova-text-primary border border-nova-border rounded-lg hover:bg-nova-hover transition-colors"
          >
            拒绝
          </button>
          <button
            onClick={approveToolCall}
            className="px-4 py-1.5 text-sm text-white bg-nova-accent hover:bg-nova-accent/80 rounded-lg transition-colors"
          >
            批准
          </button>
        </div>
      </div>
    </div>
  )
}
