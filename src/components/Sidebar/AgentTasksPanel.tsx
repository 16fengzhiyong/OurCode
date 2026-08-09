import { useMemo } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import type { AgentRun } from '@/types'
import { useI18n } from '@/i18n/useI18n'
import type { TranslationKey } from '@/i18n'

/**
 * Agent tasks panel (sidebar tab): lists the current run (across sessions) and
 * recent agent runs, with quick actions (open session / stop / delete). Also
 * hosts the per-project "always allow" tool allowlist manager.
 */

const STATUS_KEY: Record<AgentRun['status'], TranslationKey> = {
  running: 'agent.runStatus.running',
  creating_plan: 'agent.runStatus.creatingPlan',
  waiting_plan: 'agent.runStatus.waitingPlan',
  approved_running: 'agent.runStatus.approvedRunning',
  done: 'agent.runStatus.done',
  stopped: 'agent.runStatus.stopped',
  error: 'agent.runStatus.error',
  rejected: 'agent.runStatus.rejected',
}

const STATUS_STYLE: Record<AgentRun['status'], string> = {
  running: 'text-[#3B82F6] border-[#3B82F6]/40 bg-[#3B82F6]/10',
  creating_plan: 'text-[#3B82F6] border-[#3B82F6]/40 bg-[#3B82F6]/10',
  waiting_plan: 'text-yellow-400 border-yellow-500/40 bg-yellow-500/10',
  approved_running: 'text-[#3B82F6] border-[#3B82F6]/40 bg-[#3B82F6]/10',
  done: 'text-green-400 border-green-500/40 bg-green-500/10',
  stopped: 'text-nova-text-muted border-nova-border bg-nova-hover/30',
  error: 'text-red-400 border-red-500/40 bg-red-500/10',
  rejected: 'text-nova-text-muted border-nova-border bg-nova-hover/30',
}

const isRunningStatus = (s: AgentRun['status']) =>
  s === 'running' || s === 'creating_plan' || s === 'approved_running'

function formatElapsed(run: AgentRun, t: (key: TranslationKey, vars?: Record<string, string | number>) => string) {
  const secs = Math.max(0, Math.floor(((run.finishedAt || Date.now()) - run.startedAt) / 1000))
  return t('agent.elapsed', { seconds: secs })
}

export default function AgentTasksPanel() {
  const sessions = useChatStore((s) => s.sessions)
  const activeRuns = useChatStore((s) => s.activeRuns)
  const stopGeneration = useChatStore((s) => s.stopGeneration)
  const setActiveSession = useChatStore((s) => s.setActiveSession)
  const deleteAgentRun = useChatStore((s) => s.deleteAgentRun)
  const toolAllowlist = useChatStore((s) => s.toolAllowlist)
  const clearToolAllowlist = useChatStore((s) => s.clearToolAllowlist)
  const rootPath = useUIStore((s) => s.rootPath)
  const t = useI18n()

  // With parallel conversations several runs can be live at once — list them all
  const currentRuns = useMemo(() => {
    const items: Array<{ session: (typeof sessions)[number]; run: AgentRun }> = []
    for (const active of Object.values(activeRuns)) {
      const session = sessions.find((s) => s.id === active.sessionId)
      const run = session?.agentRuns?.find((r) => r.id === active.runId)
      if (session && run) items.push({ session, run })
    }
    return items
  }, [activeRuns, sessions])

  const activeRunIds = useMemo(() => new Set(Object.values(activeRuns).map((a) => a.runId)), [activeRuns])

  const history = useMemo(() => {
    const items: Array<{ session: (typeof sessions)[number]; run: AgentRun }> = []
    for (const session of sessions) {
      for (const run of session.agentRuns || []) {
        if (activeRunIds.has(run.id)) continue
        items.push({ session, run })
      }
    }
    return items.sort((a, b) => b.run.startedAt - a.run.startedAt).slice(0, 50)
  }, [sessions, activeRunIds])

  const openSession = (sessionId: string) => {
    setActiveSession(sessionId)
    const ui = useUIStore.getState()
    if (!ui.isChatVisible) ui.toggleChat()
  }

  const allowlist = rootPath ? toolAllowlist[rootPath] || [] : []

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className="p-3 space-y-4">
        {/* Current run(s) — parallel conversations each show their live run */}
        <section>
          <div className="text-[11px] font-medium text-nova-text-muted uppercase tracking-wider mb-1.5">
            {t('agent.currentRun')}
          </div>
          {currentRuns.length > 0 ? (
            <div className="space-y-1.5">
              {currentRuns.map(({ session, run }) => (
                <TaskCard
                  key={run.id}
                  sessionTitle={session?.title}
                  run={run}
                  isActive
                  onOpen={() => openSession(session!.id)}
                  onStop={() => stopGeneration(session!.id)}
                  onDelete={() => deleteAgentRun(session!.id, run.id)}
                  t={t}
                />
              ))}
            </div>
          ) : (
            <div className="text-xs text-nova-text-muted">{t('agent.emptyTasks')}</div>
          )}
        </section>

        {/* History */}
        {history.length > 0 && (
          <section>
            <div className="text-[11px] font-medium text-nova-text-muted uppercase tracking-wider mb-1.5">
              {t('agent.history')}
            </div>
            <div className="space-y-1.5">
              {history.map(({ session, run }) => (
                <TaskCard
                  key={run.id}
                  sessionTitle={session?.title}
                  run={run}
                  onOpen={() => openSession(session!.id)}
                  onStop={() => stopGeneration(session!.id)}
                  onDelete={() => deleteAgentRun(session!.id, run.id)}
                  t={t}
                />
              ))}
            </div>
          </section>
        )}

        {/* Per-project allowlist manager */}
        <section>
          <div className="text-[11px] font-medium text-nova-text-muted uppercase tracking-wider mb-1.5">
            {t('agent.allowlistTitle')}
          </div>
          {allowlist.length === 0 ? (
            <div className="text-xs text-nova-text-muted">{t('agent.allowlistEmpty')}</div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {allowlist.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono bg-green-500/10 text-green-400 border border-green-500/20"
                >
                  {name}
                </span>
              ))}
              <button
                onClick={() => rootPath && clearToolAllowlist(rootPath)}
                className="px-2 py-0.5 rounded text-[10px] text-nova-text-muted hover:text-red-400 hover:bg-red-500/10 border border-nova-border transition-colors"
              >
                {t('agent.clearAllowlist')}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function TaskCard({
  sessionTitle,
  run,
  isActive,
  onOpen,
  onStop,
  onDelete,
  t,
}: {
  sessionTitle?: string
  run: AgentRun
  isActive?: boolean
  onOpen: () => void
  onStop: () => void
  onDelete: () => void
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
}) {
  return (
    <div
      className={`rounded-lg border p-2.5 space-y-1.5 ${
        isActive ? 'border-nova-accent/40 bg-nova-accent/5' : 'border-nova-border bg-nova-surface/60'
      }`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] border ${STATUS_STYLE[run.status]}`}>
          {t(STATUS_KEY[run.status])}
        </span>
        <span className="text-[10px] text-nova-text-muted shrink-0">{formatElapsed(run, t)}</span>
        {isActive && <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6] animate-pulse-dot shrink-0" />}
      </div>
      <div className="text-xs text-nova-text-primary leading-snug line-clamp-2 break-words">{run.task}</div>
      <div className="flex items-center gap-1 text-[10px] text-nova-text-muted">
        <span className="truncate">{sessionTitle || '—'}</span>
        <span className="shrink-0">
          {t('agent.toolCalls', { count: run.toolCallCount })} · {t('agent.fileChanges', { count: run.fileChangeCount })}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={onOpen}
          className="px-2 py-0.5 rounded text-[10px] text-nova-accent bg-nova-accent/10 hover:bg-nova-accent/20 transition-colors"
        >
          {t('agent.openSession')}
        </button>
        {isRunningStatus(run.status) && (
          <button
            onClick={onStop}
            className="px-2 py-0.5 rounded text-[10px] text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors"
          >
            {t('agent.stop')}
          </button>
        )}
        <button
          onClick={onDelete}
          className="ml-auto px-1.5 py-0.5 rounded text-[10px] text-nova-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          {t('agent.deleteRecord')}
        </button>
      </div>
    </div>
  )
}
