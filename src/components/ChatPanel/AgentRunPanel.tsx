import { useEffect, useState } from 'react'
import { useChatStore } from '@/stores/chatStore'
import type { AgentRun } from '@/types'
import { useI18n } from '@/i18n/useI18n'
import type { TranslationKey } from '@/i18n'
import { TodoPanel, PlanCard } from './AgentPanel'

/**
 * Agent run panel: shows the live state of the active agent run — status,
 * elapsed time, submitted plan, and todo progress.
 * Tool-level execution detail is now rendered inline in AgentTimeline.
 * Rendered above the chat messages while an agent run belongs to this session.
 */

const RUN_STATUS_KEY: Record<AgentRun['status'], TranslationKey> = {
  running: 'agent.runStatus.running',
  creating_plan: 'agent.runStatus.creatingPlan',
  waiting_plan: 'agent.runStatus.waitingPlan',
  approved_running: 'agent.runStatus.approvedRunning',
  done: 'agent.runStatus.done',
  stopped: 'agent.runStatus.stopped',
  error: 'agent.runStatus.error',
  rejected: 'agent.runStatus.rejected',
}

const RUN_STATUS_STYLE: Record<AgentRun['status'], string> = {
  running: 'text-[#3B82F6] border-[#3B82F6]/40 bg-[#3B82F6]/10',
  creating_plan: 'text-[#3B82F6] border-[#3B82F6]/40 bg-[#3B82F6]/10',
  waiting_plan: 'text-yellow-400 border-yellow-500/40 bg-yellow-500/10',
  approved_running: 'text-[#3B82F6] border-[#3B82F6]/40 bg-[#3B82F6]/10',
  done: 'text-green-400 border-green-500/40 bg-green-500/10',
  stopped: 'text-nova-text-muted border-nova-border bg-nova-hover/30',
  error: 'text-red-400 border-red-500/40 bg-red-500/10',
  rejected: 'text-nova-text-muted border-nova-border bg-nova-hover/30',
}

interface PlanSteps { title?: string; steps?: Array<{ summary?: string; detail?: string }> }

/** Parse a stored plan (JSON {title, steps}) back into displayable steps */
function parsePlan(run: AgentRun): PlanSteps {
  try {
    const p = JSON.parse(run.plan || '{}')
    return { title: p.title, steps: Array.isArray(p.steps) ? p.steps : [] }
  } catch {
    return { title: run.plan }
  }
}

export default function AgentRunPanel({ sessionId }: { sessionId: string }) {
  const activeRun = useChatStore((s) => s.activeRun)
  const session = useChatStore((s) => s.sessions.find((x) => x.id === sessionId))
  const stopGeneration = useChatStore((s) => s.stopGeneration)
  const t = useI18n()

  // Tick once a second so the elapsed time stays live while the run is active
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!activeRun || activeRun.sessionId !== sessionId) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [activeRun, sessionId])

  if (!activeRun || activeRun.sessionId !== sessionId) return null
  const run = session?.agentRuns?.find((r) => r.id === activeRun.runId)
  if (!run) return null

  const isRunning = run.status === 'running' || run.status === 'creating_plan' || run.status === 'approved_running'
  const completedTodos = (session?.todos || []).filter((td) => td.status === 'completed').length
  const plan = parsePlan(run)
  const elapsed = Math.max(0, Math.floor(((run.finishedAt || now) - run.startedAt) / 1000))

  return (
    <div className="rounded-xl border border-nova-border bg-nova-surface/60 overflow-hidden shrink-0 animate-fade-in">
      {/* Status header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-nova-border/60 bg-nova-hover/30">
        <span className="text-xs">🤖</span>
        <span className="text-xs font-medium text-nova-text-primary">{t('chat.modeAgent')}</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] border ${RUN_STATUS_STYLE[run.status]}`}>
          {t(RUN_STATUS_KEY[run.status])}
        </span>
        <span className="text-[10px] text-nova-text-muted">
          {t('agent.elapsed', { seconds: elapsed })}
        </span>
        <span className="ml-auto flex items-center gap-2 text-[10px] text-nova-text-muted">
          <span>{t('agent.toolCalls', { count: run.toolCallCount })}</span>
          <span>{t('agent.fileChanges', { count: run.fileChangeCount })}</span>
          {isRunning && (
            <button
              onClick={stopGeneration}
              className="px-2 py-0.5 rounded text-white text-[10px] transition-opacity hover:opacity-90"
              style={{ background: 'rgba(244,135,113,0.85)' }}
            >
              {t('agent.stop')}
            </button>
          )}
        </span>
      </div>

      {/* Submitted plan (approved / awaiting / executing) */}
      {plan.title || ((plan.steps?.length ?? 0) > 0) ? (
        <div className="px-3 py-2 border-b border-nova-border/40">
          <div className="text-[11px] text-nova-accent font-medium mb-1">
            {session?.planStatus === 'approved'
              ? t('agent.planApproved')
              : session?.planStatus === 'pending_approval'
                ? t('agent.planWaiting')
                : plan.title}
          </div>
          {plan.steps && plan.steps.length > 0 && (
            <ol className="space-y-1">
              {plan.steps.map((s, i) => {
                const done = i < completedTodos
                return (
                  <li key={i} className="flex gap-1.5 text-xs items-start">
                    <span
                      className={`shrink-0 w-4 h-4 rounded-full text-[10px] flex items-center justify-center ${
                        done ? 'bg-green-500/20 text-green-400' : 'bg-nova-accent/20 text-nova-accent'
                      }`}
                    >
                      {done ? '✓' : i + 1}
                    </span>
                    <span className={`text-nova-text-secondary ${done ? 'line-through opacity-60' : ''}`}>{s.summary}</span>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      ) : null}

      {/* Plan approval buttons + todo list (agent mode) */}
      <PlanCard sessionId={sessionId} />
      <TodoPanel sessionId={sessionId} />
    </div>
  )
}
