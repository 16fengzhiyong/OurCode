import { useEffect, useState } from 'react'
import { useChatStore } from '@/stores/chatStore'
import type { TodoItem } from '@/types'
import { useI18n } from '@/i18n/useI18n'
import type { TranslationKey } from '@/i18n'

/**
 * Agent status panel: shows the agent's todo list (manage_todo) and the plan
 * approval card (submit_plan) — in-chat agent task tracking.
 */

const STATUS_LABEL_KEY: Record<TodoItem['status'], TranslationKey> = {
  pending: 'agent.pending',
  in_progress: 'agent.inProgress',
  completed: 'agent.completed',
  failed: 'agent.failed',
}

/** Todo icon per status — gradient variant (spin for in-progress) */
function TodoStatusIcon({ status }: { status: TodoItem['status'] }) {
  if (status === 'completed') {
    return (
      <svg className="w-[15px] h-[15px] mt-0.5 shrink-0 text-[var(--green,#16a34a)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    )
  }
  if (status === 'failed') {
    return (
      <svg className="w-[15px] h-[15px] mt-0.5 shrink-0 text-[var(--red,#dc2626)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    )
  }
  if (status === 'in_progress') {
    return (
      <svg className="w-[15px] h-[15px] mt-0.5 shrink-0 animate-spin-slow text-[var(--accent,#0058bc)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    )
  }
  // pending
  return (
    <svg className="w-[15px] h-[15px] mt-0.5 shrink-0 text-[var(--text-muted,#64748b)] opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
    </svg>
  )
}

export function TodoPanel({ sessionId }: { sessionId: string }) {
  const session = useChatStore((s) => s.sessions.find((x) => x.id === sessionId))
  const todos = session?.todos || []
  const t = useI18n()

  if (todos.length === 0) return null

  return (
    <div className="rounded-xl border border-nova-border bg-nova-surface overflow-hidden shrink-0 relative">
      {/* Gradient accent bar (vibrant gradient variant) */}
      <div className="absolute top-0 left-0 w-16 h-1 todo-gradient-bar" />
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <svg className="w-4 h-4 text-nova-accent shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" opacity=".35" />
          <path d="M8.5 12.4l2.4 2.4 4.8-5" />
        </svg>
        <span className="text-[13px] font-bold text-nova-text-primary">{t('agent.todoList')}</span>
        <span className="text-[10px] font-semibold text-nova-accent bg-accent-10 px-2 py-0.5 rounded-full ml-auto shrink-0">
          {t('agent.doneCount', { done: todos.filter((x) => x.status === 'completed').length, total: todos.length })}
        </span>
      </div>
      <div className="px-3 pb-3 space-y-0.5 max-h-40 overflow-y-auto">
        {todos.map((todo) => (
          <div
            key={todo.id}
            className="flex items-start gap-2.5 px-1.5 py-1 rounded-md hover:bg-accent-5 transition-colors"
          >
            <TodoStatusIcon status={todo.status} />
            <span
              className={`text-[13px] min-w-0 leading-snug ${
                todo.status === 'completed'
                  ? 'line-through opacity-70 text-nova-text-muted'
                  : todo.status === 'pending'
                    ? 'opacity-60 text-nova-text-secondary'
                    : todo.status === 'in_progress'
                      ? 'font-medium text-nova-text-primary'
                      : 'text-nova-text-primary'
              }`}
            >
              {todo.content}
            </span>
            <span className="ml-auto text-[10px] shrink-0 opacity-70 pt-0.5 text-nova-text-muted">
              {t(STATUS_LABEL_KEY[todo.status])}
            </span>
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
  const isRunning = useChatStore((s) => s.runningSessionIds.includes(sessionId))
  const t = useI18n()
  // Plan-approved auto-approval (allowedPrompts-style): when checked, the
  // execution phase of this run proceeds without per-tool dialogs. Local
  // state only — it is passed once to approvePlan and cleared when the run ends.
  const [autoApprove, setAutoApprove] = useState(false)

  // A fresh plan always starts with auto-approve unchecked — don't leak the
  // choice made for a previously approved plan into the next plan's card
  // (otherwise the user could re-approve a new plan with auto-approval on
  // without noticing the checkbox was still ticked).
  useEffect(() => {
    if (session?.planStatus === 'pending_approval') setAutoApprove(false)
  }, [session?.planStatus])

  // A canceled plan stays on record (planContent kept, status 'canceled') so
  // the conversation still shows what was submitted and later canceled — the
  // user may want to manually adjust or re-approve it.
  if (!session || !session.planContent || session.planStatus === 'none') return null
  const status = session.planStatus

  let title = t('agent.executePlan')
  const steps: Array<{ summary: string; detail?: string }> = []
  try {
    const plan = JSON.parse(session.planContent)
    title = plan.title || title
    if (Array.isArray(plan.steps)) steps.push(...plan.steps)
  } catch { /* plain text plan */ }

  const renderSteps = () =>
    steps.length > 0 ? (
      <ol className="space-y-1.5">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-2 text-xs">
            <span className="shrink-0 w-4 h-4 rounded-full bg-accent-20 text-nova-accent text-[10px] flex items-center justify-center font-medium">
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
    )

  // Approved — read-only record of the executed plan
  if (status === 'approved') {
    return (
      <div className="rounded-xl border border-green-500/30 bg-green-500/5 overflow-hidden shrink-0">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-green-500/20">
          <span className="text-xs">✅</span>
          <span className="text-xs font-medium text-green-400">{title}</span>
          <span className="ml-auto text-[10px] text-green-400/80">{t('agent.planApproved')}</span>
        </div>
        <div className="px-3 py-2">{renderSteps()}</div>
      </div>
    )
  }

  // Canceled — the plan stays visible as a record, with a re-approve action
  if (status === 'canceled') {
    return (
      <div className="rounded-xl border border-nova-border bg-nova-surface overflow-hidden shrink-0 opacity-85">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-nova-border">
          <span className="text-xs">🗑️</span>
          <span className="text-xs font-medium text-nova-text-muted">{title}</span>
          <span className="ml-auto text-[10px] text-nova-text-muted">{t('agent.planCanceled')}</span>
        </div>
        <div className="px-3 py-2">
          {renderSteps()}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => approvePlan(sessionId)}
              disabled={isRunning}
              className="px-4 py-1.5 text-xs text-white rounded-lg disabled:opacity-40 hover:opacity-90 transition-opacity"
              style={{ background: 'var(--grad-brand)' }}
            >
              {t('agent.reapprovePlan')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // pending_approval — the interactive approve / modify card
  // (Stitch: 高保真玻璃拟态版 — gradient border, 批准执行 primary pill,
  //  修改计划 ghost pill)
  return (
    <div className="rounded-xl p-[1px] bg-gradient-to-br from-blue-500/30 via-purple-400/20 to-transparent shadow-[0_8px_32px_rgba(0,88,188,0.08)] shrink-0">
      <div className="bg-nova-surface backdrop-blur-xl rounded-xl">
        <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
          <span className="text-base leading-none">📋</span>
          <span className="text-[13px] font-bold text-nova-text-primary">{title}</span>
          <span className="ml-auto text-[10px] text-nova-text-muted">{t('agent.awaitingApproval')}</span>
        </div>
        <div className="px-4 pb-3.5">
          {renderSteps()}
          <label className="flex items-center gap-2 mt-3 text-[11px] text-nova-text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoApprove}
              onChange={(e) => setAutoApprove(e.target.checked)}
              className="accent-nova-accent w-3.5 h-3.5"
            />
            {t('agent.autoApproveAfterPlan')}
          </label>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => approvePlan(sessionId, { autoApprove })}
              disabled={isRunning}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-white rounded-full shadow-md disabled:opacity-40 hover:scale-[1.02] hover:opacity-90 transition-all duration-300"
              style={{ background: 'var(--accent, #0058bc)' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {t('agent.approveAndRun')}
            </button>
            <button
              onClick={() => dismissPlan(sessionId)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-nova-text-secondary rounded-full border border-nova-border bg-white/60 dark:bg-white/10 hover:bg-white/90 dark:hover:bg-white/15 transition-all duration-300"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              {t('agent.modifyPlan')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
