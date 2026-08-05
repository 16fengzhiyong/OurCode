import { useChatStore } from '@/stores/chatStore'
import type { TodoItem } from '@/types'

/**
 * Agent status panel: shows the agent's todo list (manage_todo) and the plan
 * approval card (submit_plan) — Windsurf Cascade-style in-chat task tracking.
 */

const STATUS_LABEL: Record<TodoItem['status'], string> = {
  pending: '待办',
  in_progress: '进行中',
  completed: '已完成',
  failed: '失败',
}

const STATUS_STYLE: Record<TodoItem['status'], string> = {
  pending: 'text-nova-text-muted border-nova-border',
  in_progress: 'text-[#57A3F8] border-[#57A3F8]/40 bg-[#57A3F8]/10',
  completed: 'text-green-400 border-green-500/40 bg-green-500/10',
  failed: 'text-red-400 border-red-500/40 bg-red-500/10',
}

export function TodoPanel({ sessionId }: { sessionId: string }) {
  const session = useChatStore((s) => s.sessions.find((x) => x.id === sessionId))
  const todos = session?.todos || []

  if (todos.length === 0) return null

  return (
    <div className="rounded-xl border border-nova-border bg-nova-surface/60 overflow-hidden shrink-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-nova-border/60 bg-nova-hover/30">
        <span className="text-xs">✅</span>
        <span className="text-xs font-medium text-nova-text-primary">任务列表</span>
        <span className="text-[10px] text-nova-text-muted ml-auto">
          {todos.filter((t) => t.status === 'completed').length}/{todos.length} 完成
        </span>
      </div>
      <div className="px-2 py-1.5 space-y-0.5 max-h-40 overflow-y-auto">
        {todos.map((todo) => (
          <div
            key={todo.id}
            className={`flex items-center gap-2 px-2 py-1 rounded text-xs border ${STATUS_STYLE[todo.status]}`}
          >
            <span className="shrink-0">
              {todo.status === 'completed' ? '✓' : todo.status === 'failed' ? '✗' : todo.status === 'in_progress' ? '…' : '○'}
            </span>
            <span className="text-nova-text-secondary truncate">{todo.content}</span>
            <span className="ml-auto text-[10px] shrink-0 opacity-70">{STATUS_LABEL[todo.status]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function PlanCard({ sessionId }: { sessionId: string }) {
  const session = useChatStore((s) => s.sessions.find((x) => x.id === sessionId))
  const approvePlan = useChatStore((s) => s.approvePlan)
  const dismissPlan = useChatStore((s) => s.dismissPlan)
  const isLoading = useChatStore((s) => s.isLoading)

  if (!session || session.planStatus !== 'pending_approval' || !session.planContent) return null

  let title = '执行计划'
  const steps: Array<{ summary: string; detail?: string }> = []
  try {
    const plan = JSON.parse(session.planContent)
    title = plan.title || title
    if (Array.isArray(plan.steps)) steps.push(...plan.steps)
  } catch { /* plain text plan */ }

  return (
    <div className="rounded-xl border border-nova-accent/30 bg-nova-accent/5 overflow-hidden shrink-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-nova-accent/20">
        <span className="text-xs">📋</span>
        <span className="text-xs font-medium text-nova-accent">{title}</span>
        <span className="ml-auto text-[10px] text-nova-text-muted">等待批准</span>
      </div>
      <div className="px-3 py-2">
        {steps.length > 0 ? (
          <ol className="space-y-1.5">
            {steps.map((step, i) => (
              <li key={i} className="flex gap-2 text-xs">
                <span className="shrink-0 w-4 h-4 rounded-full bg-nova-accent/20 text-nova-accent text-[10px] flex items-center justify-center font-medium">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="text-nova-text-primary">{step.summary}</div>
                  {step.detail && <div className="text-nova-text-muted text-[11px]">{step.detail}</div>}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <pre className="text-xs text-nova-text-secondary whitespace-pre-wrap">{session.planContent}</pre>
        )}
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => approvePlan(sessionId)}
            disabled={isLoading}
            className="px-4 py-1.5 text-xs text-white rounded-lg disabled:opacity-40 hover:opacity-90 transition-opacity"
            style={{ background: 'linear-gradient(135deg, #57A3F8, #3994BC)' }}
          >
            ✓ 同意并执行
          </button>
          <button
            onClick={() => dismissPlan(sessionId)}
            className="px-3 py-1.5 text-xs text-nova-text-muted hover:text-nova-text-primary rounded-lg transition-colors"
          >
            取消计划
          </button>
        </div>
      </div>
    </div>
  )
}
