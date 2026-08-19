import { useEffect, useRef, useState } from 'react'
import ChatMessages from './ChatMessages'
import AgentTraceView from './AgentTraceView'
import ChatInput from './ChatInput'
import ChatSidebar from './ChatSidebar'
import QuestionConfirmBar from './QuestionConfirmBar'
import ArenaModal from './ArenaModal'
import WorkflowModal from './WorkflowModal'
import ModelSelector from './ModelSelector'
import WaveLogo from './WaveLogo'
import { useChatStore } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'
import { useUIStore } from '@/stores/uiStore'
import { useI18n } from '@/i18n/useI18n'
import { statusBadge } from '@/services/targetMode/targetModeService'
import type { ChatSession } from '@/types'
import { resolveThinkingLevel } from '@/types'

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-7 h-7 flex items-center justify-center rounded-md text-nova-text-muted hover:text-nova-text-primary hover:bg-nova-hover transition-colors"
      title={title}
    >
      {children}
    </button>
  )
}

/** Inline-editable conversation title in the chat header — click to rename;
 *  Enter/blur commits, Esc cancels. Persists via renameSession. */
function SessionTitleEditor({ session }: { session: ChatSession }) {
  const renameSession = useChatStore((s) => s.renameSession)
  const t = useI18n()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  // Switching sessions mid-edit must abandon the draft — otherwise the blur
  // commit (with the stale draft) would rename the NEW session to the old one.
  const sessionId = session.id
  useEffect(() => {
    setEditing(false)
  }, [sessionId])

  const startEdit = () => {
    setDraft(session.title)
    setEditing(true)
  }

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== session.title) renameSession(session.id, trimmed)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') setEditing(false)
        }}
        className="w-[180px] text-[11px] px-1.5 py-0.5 rounded border border-nova-accent/50 bg-nova-input-bg text-nova-text-primary outline-none"
        placeholder={t('chat.renameSessionPrompt')}
        title={t('chat.renameSessionPrompt')}
      />
    )
  }

  return (
    <button
      onClick={startEdit}
      className="group/title flex items-center gap-1 min-w-0 max-w-[220px] text-[11px] text-nova-text-secondary hover:text-nova-text-primary transition-colors"
      title={t('chat.renameTitleHint')}
    >
      {/* min-w-0 is required for truncate to work inside a flex row */}
      <span className="min-w-0 truncate">{session.title || t('chat.untitled')}</span>
      <svg
        className="w-3 h-3 shrink-0 opacity-0 group-hover/title:opacity-60 transition-opacity"
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      >
        <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    </button>
  )
}

export default function ChatPanel() {
  // Derived session selector (stable object reference unless THIS session
  // changes) — the old getActiveSession() function selector never re-renders.
  const activeSession = useChatStore((s) => (s.activeSessionId ? s.sessions.find((x) => x.id === s.activeSessionId) ?? null : null))
  const createSession = useChatStore((s) => s.createSession)
  const setAgentMode = useChatStore((s) => s.setAgentMode)
  const setProjectEditMode = useChatStore((s) => s.setProjectEditMode)
  const updateSessionParams = useChatStore((s) => s.updateSessionParams)
  const setTargetMode = useChatStore((s) => s.setTargetMode)
  const targetModeStatus = useChatStore((s) => s.targetModeStatus)
  const subagentProgress = useChatStore((s) => s.subagentProgress)
  const refreshTargetModeStatus = useChatStore((s) => s.refreshTargetModeStatus)
  const activeConfigGroupId = useConfigStore((s) => s.activeConfigGroupId)
  const models = useConfigStore((s) => s.models)
  const activeConfigGroup = useConfigStore((s) => s.configGroups.find((g) => g.id === s.activeConfigGroupId))
  // The session's OWN config group — the chat loop resolves the runtime model
  // from session.configGroupId, so the pill must follow it, not the globally
  // active group (they can diverge right after startup / group switching).
  const sessionConfigGroup = useConfigStore((s) =>
    activeSession ? s.configGroups.find((g) => g.id === activeSession.configGroupId) : undefined
  )
  const openSettings = useUIStore((s) => s.openSettings)
  const rootPath = useUIStore((s) => s.rootPath)
  const openMemoryManager = useUIStore((s) => s.openMemoryManager)
  const t = useI18n()
  const isChatSessionListOpen = useUIStore((s) => s.isChatSessionListOpen)
  const setChatSessionListOpen = useUIStore((s) => s.setChatSessionListOpen)
  const [showArena, setShowArena] = useState(false)
  const [showWorkflows, setShowWorkflows] = useState(false)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [view, setView] = useState<'chat' | 'trace'>('chat')

  const agentMode = activeSession?.agentMode || 'chat'
  const projectEditMode = activeSession?.projectEditMode || 'confirm_before_change'
  const targetMode = activeSession?.targetMode === true
  // Current active role for the target-mode badge (v2 改动5): the newest
  // subagent activity for this session — a running one wins over finished ones.
  const activeTargetRole = targetMode && activeSession
    ? (() => {
        const entries = Object.values(subagentProgress).filter((p) => p.sessionId === activeSession.id)
        if (entries.length === 0) return ''
        return (entries.find((p) => p.status === 'running') || entries[entries.length - 1]).name
      })()
    : ''
  // Same resolution as the agent loop (`session.model || group.defaultModel`) —
  // previously the pill fell back to nothing when session.model was empty,
  // showing "选择模型" while the conversation actually ran on the default model.
  const activeModel = activeSession?.model || sessionConfigGroup?.defaultModel || ''

  // Agent mode operates on the workspace, so it needs a project folder open.
  // The agent loop resolves the workspace from the ACTIVE SESSION's projectPath
  // first (getWorkspaceRoot → getCurrentProjectPath), so a session bound to a
  // project can run agent mode even when the file tree isn't mounted — count
  // that binding here, or restored agent sessions would degrade to chat mode
  // whenever the tree hasn't re-opened yet.
  const hasProject = Boolean(
    rootPath ||
      document.getElementById('file-tree-root')?.getAttribute('data-root-path') ||
      activeSession?.projectPath
  )
  // Without a selected project only chat is allowed — never display agent as
  // active (or let the user switch to it) when there is no workspace open.
  const effectiveAgentMode = agentMode === 'agent' && hasProject ? 'agent' : 'chat'

  const handleSwitchToAgent = () => {
    if (!hasProject) {
      useUIStore.getState().showNotification(t('chat.agentNeedsProject'), 'warning')
      return
    }
    if (activeSession) setAgentMode(activeSession.id, 'agent')
  }

  const handleNewSession = () => {
    if (activeConfigGroupId) {
      createSession(activeConfigGroupId)
    } else {
      openSettings()
    }
  }

  // While target mode is active, poll implementationStatus.md so the badge in
  // the mode bar stays in sync with the agent's own progress writes.
  useEffect(() => {
    if (effectiveAgentMode !== 'agent' || !targetMode) return
    refreshTargetModeStatus()
    const timer = setInterval(refreshTargetModeStatus, 5000)
    return () => clearInterval(timer)
  }, [effectiveAgentMode, targetMode, refreshTargetModeStatus])

  return (
    <div className="h-full flex bg-transparent chat-accent">
      {/* Session sidebar (collapsible) */}
      {isChatSessionListOpen && (
        <ChatSidebar onClose={() => setChatSessionListOpen(false)} />
      )}

      {/* Arena (parallel model comparison) */}
      {showArena && <ArenaModal onClose={() => setShowArena(false)} />}

      {/* Workflows */}
      {showWorkflows && <WorkflowModal onClose={() => setShowWorkflows(false)} />}

      <div className="flex-1 flex flex-col min-w-0 bg-nova-surface">
        {/* Chat header */}
        <div className="px-3 py-2 shrink-0">
          <div className="flex items-center justify-between gap-2">
            {/* Brand */}
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-nova-accent bg-nova-surface border border-nova-border"
              >
                <WaveLogo color="currentColor" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <strong className="text-sm block truncate leading-tight text-nova-text-primary">
                    OurCode AI
                  </strong>
                  {activeConfigGroup ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-green-500 shrink-0">
                      <span className="w-1 h-1 rounded-full bg-green-500 animate-pulse-dot" />
                      {t('chat.connected')}
                    </span>
                  ) : (
                    <button
                      onClick={openSettings}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] text-nova-text-muted bg-nova-hover hover:text-nova-text-primary border border-nova-border shrink-0 transition-colors"
                      title={t('chat.notConfigured')}
                    >
                      <span className="w-1 h-1 rounded-full bg-gray-500" />
                      {t('chat.notConfigured')}
                    </button>
                  )}
                  {/* Current conversation title — inline editable (design:
                      logo + connected + title + model + ⋮) */}
                  {activeSession && (
                    <>
                      <span className="w-px h-3 bg-nova-border shrink-0" />
                      <SessionTitleEditor session={activeSession} />
                    </>
                  )}
                </div>
                <span className="text-[10px] text-nova-text-muted block truncate">
                  {activeConfigGroup ? activeConfigGroup.name : t('chat.selectModelHint')}
                </span>
              </div>
            </div>

            {/* Model pill + mode toggle + actions */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* History (timeline) — opens the session list (design: header toolbar entry) */}
              <IconButton title={t('chat.historyHint')} onClick={() => setChatSessionListOpen(true)}>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                  <polyline points="3 3 3 8 8 8" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </IconButton>
              {activeSession && (
                <div className="relative">
                  <button
                    onClick={() => setShowModelPicker(!showModelPicker)}
                    className="pill-btn flex items-center gap-1 max-w-[150px] text-[11px] border border-nova-border bg-nova-hover/50"
                    title={t('chat.selectModel')}
                  >
                    <span className="truncate">
                      {models.find((m) => m.id === activeModel)?.alias || activeModel || t('chat.selectModel')}
                    </span>
                    <span className="text-nova-text-muted shrink-0">▾</span>
                  </button>
                  {showModelPicker && (
                    <>
                      {/* Backdrop: click anywhere to close the picker */}
                      <div className="fixed inset-0 z-40" onClick={() => setShowModelPicker(false)} />
                      <div
                        className="absolute right-0 top-full mt-1 z-50 w-[380px] max-h-[70vh] overflow-y-auto p-3 rounded-xl border shadow-2xl"
                        style={{ background: 'var(--surface)', borderColor: 'var(--border-strong)' }}
                      >
                        <ModelSelector />
                      </div>
                    </>
                  )}
                </div>
              )}
              {/* 新建对话 now lives in the LEFT sidebar (per-project item / tree
                  header) — the right panel no longer carries its own button. */}
              <div className="flex items-center gap-0.5">
                {/* ⋮ overflow menu — keeps the header clean (design: logo + connected + model + ⋮) */}
                <div className="relative">
                  <IconButton title={t('chat.more')} onClick={() => setShowMoreMenu(!showMoreMenu)}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="5" r="1.7" />
                      <circle cx="12" cy="12" r="1.7" />
                      <circle cx="12" cy="19" r="1.7" />
                    </svg>
                  </IconButton>
                  {showMoreMenu && (
                    <>
                      {/* Backdrop: click anywhere to close */}
                      <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
                      <div
                        className="absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border shadow-2xl py-1 animate-fade-in"
                        style={{ background: 'var(--surface)', borderColor: 'var(--border-strong)' }}
                      >
                        <button
                          onClick={() => { setShowArena(true); setShowMoreMenu(false) }}
                          className="w-full text-left px-3 py-1.5 text-xs text-nova-text-secondary hover:bg-nova-accent/15 hover:text-white flex items-center gap-2 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[15px] leading-none text-nova-text-muted" aria-hidden>compare_arrows</span>
                          {t('chat.arenaCompare')}
                        </button>
                        <button
                          onClick={() => { setShowWorkflows(true); setShowMoreMenu(false) }}
                          className="w-full text-left px-3 py-1.5 text-xs text-nova-text-secondary hover:bg-nova-accent/15 hover:text-white flex items-center gap-2 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[15px] leading-none text-nova-text-muted" aria-hidden>sync</span>
                          {t('chat.workflows')}
                        </button>
                        <button
                          onClick={() => { openMemoryManager(); setShowMoreMenu(false) }}
                          className="w-full text-left px-3 py-1.5 text-xs text-nova-text-secondary hover:bg-nova-accent/15 hover:text-white flex items-center gap-2 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[15px] leading-none text-nova-text-muted" aria-hidden>memory</span>
                          {t('chat.memory')}
                        </button>
                        <div className="h-px bg-nova-border my-1" />
                        <button
                          onClick={() => { openSettings(); setShowMoreMenu(false) }}
                          className="w-full text-left px-3 py-1.5 text-xs text-nova-text-secondary hover:bg-nova-accent/15 hover:text-white flex items-center gap-2 transition-colors"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                          </svg>
                          {t('chat.settings')}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Chat Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {activeSession ? (
            <>
              {/* View tabs: 对话 / 轨迹 */}
              <div className="shrink-0 px-3 pt-2 flex items-center gap-1.5 border-b border-nova-border">
                <button
                  onClick={() => setView('chat')}
                  className={`px-3 py-1 text-xs rounded-full transition-all ${view === 'chat' ? 'bg-nova-accent/10 text-nova-accent font-medium' : 'text-nova-text-muted hover:text-nova-text-primary hover:bg-nova-hover'}`}
                >
                  {t('chat.modeChat')}
                </button>
                <button
                  onClick={() => setView('trace')}
                  className={`px-3 py-1 text-xs rounded-full transition-all ${view === 'trace' ? 'bg-nova-accent/10 text-nova-accent font-medium' : 'text-nova-text-muted hover:text-nova-text-primary hover:bg-nova-hover'}`}
                >
                  {t('agent.traceTab')}
                </button>
              </div>

              {view === 'trace' ? (
                <AgentTraceView />
              ) : (
                <>
              <ChatMessages />

              {/* Mode bar — chat / agent (planning is a read-only phase of agent mode) */}
              <div className="shrink-0 px-3 py-2 border-t border-nova-border flex items-center justify-between gap-1.5 bg-transparent">
                {/* Chat / agent switch — hidden while target mode is running
                    (the pill is the single control then) */}
                {!targetMode && (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setAgentMode(activeSession.id, 'chat')}
                      className={`px-3 py-1 text-xs rounded-full transition-all ${effectiveAgentMode === 'chat' ? 'bg-nova-accent/10 text-nova-accent font-medium' : 'text-nova-text-muted hover:text-nova-text-primary hover:bg-nova-hover'}`}
                      title={t('chat.chatModeHint')}
                    >
                      {t('chat.modeChat')}
                    </button>
                    <button
                      onClick={handleSwitchToAgent}
                      disabled={!hasProject}
                      className={`px-3 py-1 text-xs rounded-full transition-all ${effectiveAgentMode === 'agent' ? 'bg-nova-accent/10 text-nova-accent font-medium' : 'text-nova-text-muted hover:text-nova-text-primary hover:bg-nova-hover'} ${!hasProject ? 'opacity-50 cursor-not-allowed' : ''}`}
                      title={hasProject ? t('chat.modeAgentHint') : t('chat.agentNeedsProject')}
                    >
                      {t('chat.modeAgent')}
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  {/* Target-mode pill: only offered in agent mode — conversation
                      mode has no target mode, so the pill stays hidden there.
                      Oval toggle, green + pulsing while on. */}
                  {effectiveAgentMode === 'agent' && (
                    <button
                      onClick={() => setTargetMode(activeSession.id, !targetMode)}
                      className={`px-3 py-1 text-xs rounded-full border transition-all select-none whitespace-nowrap ${
                        targetMode
                          ? 'text-green-500 border-green-500/40 bg-green-500/10'
                          : 'text-nova-text-muted border-nova-border hover:text-nova-text-primary hover:border-nova-accent/50'
                      }`}
                      title={t('chat.targetModeHint')}
                    >
                      {targetMode ? t('chat.targetModeOn') : t('chat.targetModeOff')}
                      {targetMode && statusBadge(targetModeStatus) && (
                        <span className="ml-1 text-green-300 font-medium">{statusBadge(targetModeStatus)}</span>
                      )}
                      {targetMode && activeTargetRole && (
                        <span className="ml-1 text-green-300/80 font-medium">· {activeTargetRole}</span>
                      )}
                    </button>
                  )}
                  {/* 思考档位 — 目标模式与编辑模式之间：关闭/低/中/高/最高。
                      关闭即不请求思考（reasoning 模型仍可能自行输出）；最高档在
                      支持预算的 provider（Anthropic/Gemini）上调满 16384 token。 */}
                  {effectiveAgentMode === 'agent' && (
                    <select
                      value={resolveThinkingLevel(activeSession.modelParams)}
                      onChange={(e) =>
                        updateSessionParams(activeSession.id, { thinkingLevel: e.target.value as 'off' | 'low' | 'medium' | 'high' | 'max' })
                      }
                      className="text-xs rounded-md px-2 py-1 border outline-none cursor-pointer transition-colors border-nova-border bg-nova-input-bg text-nova-text-primary hover:border-nova-accent focus:border-nova-accent"
                      title={t('chat.thinkingLevelLabel')}
                      style={{ backgroundImage: 'none' }}
                    >
                      <option value="off" title={t('chat.thinkingLevelOffHint')}>{t('chat.thinkingLevelOff')}</option>
                      <option value="low" title={t('chat.thinkingLevelLowHint')}>{t('chat.thinkingLevelLow')}</option>
                      <option value="medium" title={t('chat.thinkingLevelMediumHint')}>{t('chat.thinkingLevelMedium')}</option>
                      <option value="high" title={t('chat.thinkingLevelHighHint')}>{t('chat.thinkingLevelHigh')}</option>
                      <option value="max" title={t('chat.thinkingLevelMaxHint')}>{t('chat.thinkingLevelMax')}</option>
                    </select>
                  )}
                  {effectiveAgentMode === 'agent' && (
                    <select
                      value={projectEditMode}
                      onChange={(e) => setProjectEditMode(activeSession.id, e.target.value as 'confirm_before_change' | 'auto_edit' | 'plan' | 'full_access')}
                      className={`text-xs rounded-md px-2 py-1 border outline-none cursor-pointer transition-colors ${
                        projectEditMode === 'full_access'
                          ? 'border-orange-500/50 bg-orange-500/10 text-orange-400'
                          : 'border-nova-border bg-nova-input-bg text-nova-text-primary hover:border-nova-accent focus:border-nova-accent'
                      }`}
                      title={t('chat.projectEditModeLabel')}
                      style={{ backgroundImage: 'none' }}
                    >
                      <option value="confirm_before_change" title={t('chat.projectEditModeConfirmHint')}>{t('chat.projectEditModeConfirm')}</option>
                      <option value="full_access" title={t('chat.projectEditModeFullHint')} className="text-orange-400">{t('chat.projectEditModeFull')}</option>
                      {/* While target mode is on, its own workflow supersedes
                          auto_edit / plan — only manual-confirm and full-access
                          remain selectable. */}
                      {!targetMode && (
                        <>
                          <option value="auto_edit" title={t('chat.projectEditModeAutoHint')}>{t('chat.projectEditModeAuto')}</option>
                          <option value="plan" title={t('chat.projectEditModePlanHint')}>{t('chat.projectEditModePlan')}</option>
                        </>
                      )}
                    </select>
                  )}
                </div>
              </div>

              <ChatInput />
              <QuestionConfirmBar />
                </>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-4">
              <div className="text-center max-w-[320px]">
                <div
                  className="w-14 h-14 mx-auto mb-4 rounded-2xl flex items-center justify-center text-nova-accent bg-nova-surface border border-nova-border"
                >
                  <WaveLogo size={24} color="currentColor" />
                </div>
                <div className="text-xl font-semibold text-nova-text-primary mb-1">
                  OurCode AI
                </div>
                <div className="text-sm text-nova-text-muted mb-2">
                  {t('chat.emptyTitle')}
                </div>
                <div className="text-xs text-nova-text-muted mb-6 max-w-xs mx-auto leading-relaxed">
                  {t('chat.emptyDesc')}
                </div>
                <button
                  onClick={handleNewSession}
                  className="px-5 py-2 text-white rounded-lg text-sm hover:opacity-90 transition-opacity shadow-sm bg-nova-accent"
                >
                  {t('chat.startNewChat')}
                </button>
                {!activeConfigGroupId && (
                  <button
                    onClick={openSettings}
                    className="block mx-auto mt-3 text-xs text-nova-accent hover:underline"
                  >
                    {t('chat.configureApiKey')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
