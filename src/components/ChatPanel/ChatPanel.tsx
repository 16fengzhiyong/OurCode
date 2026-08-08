import { useEffect, useState } from 'react'
import ChatMessages from './ChatMessages'
import ChatInput from './ChatInput'
import ChatSidebar from './ChatSidebar'
import ArenaModal from './ArenaModal'
import WorkflowModal from './WorkflowModal'
import ModelSelector from './ModelSelector'
import WaveLogo from './WaveLogo'
import { useChatStore } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'
import { useUIStore } from '@/stores/uiStore'
import { useI18n } from '@/i18n/useI18n'
import { statusBadge } from '@/services/targetMode/targetModeService'

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

export default function ChatPanel() {
  const activeSession = useChatStore((s) => s.getActiveSession())
  const createSession = useChatStore((s) => s.createSession)
  const setAgentMode = useChatStore((s) => s.setAgentMode)
  const setProjectEditMode = useChatStore((s) => s.setProjectEditMode)
  const setTargetMode = useChatStore((s) => s.setTargetMode)
  const targetModeStatus = useChatStore((s) => s.targetModeStatus)
  const refreshTargetModeStatus = useChatStore((s) => s.refreshTargetModeStatus)
  const { activeConfigGroupId, models } = useConfigStore()
  const activeConfigGroup = useConfigStore((s) => s.configGroups.find((g) => g.id === s.activeConfigGroupId))
  const { openSettings, rootPath, openMemoryManager } = useUIStore()
  const t = useI18n()
  const isChatSessionListOpen = useUIStore((s) => s.isChatSessionListOpen)
  const setChatSessionListOpen = useUIStore((s) => s.setChatSessionListOpen)
  const [showArena, setShowArena] = useState(false)
  const [showWorkflows, setShowWorkflows] = useState(false)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)

  const agentMode = activeSession?.agentMode || 'chat'
  const projectEditMode = activeSession?.projectEditMode || 'plan'
  const targetMode = activeSession?.targetMode === true
  const activeModel = activeSession?.model || ''

  // Agent mode operates on the workspace, so it needs a project folder open.
  const hasProject = Boolean(
    rootPath || document.getElementById('file-tree-root')?.getAttribute('data-root-path')
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
    <div className="h-full flex" style={{ background: 'var(--surface)' }}>
      {/* Session sidebar (collapsible) */}
      {isChatSessionListOpen && (
        <ChatSidebar onClose={() => setChatSessionListOpen(false)} />
      )}

      {/* Arena (parallel model comparison) */}
      {showArena && <ArenaModal onClose={() => setShowArena(false)} />}

      {/* Workflows */}
      {showWorkflows && <WorkflowModal onClose={() => setShowWorkflows(false)} />}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat header */}
        <div className="px-3 py-2 border-b shrink-0" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between gap-2">
            {/* Brand */}
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: 'var(--grad-brand)', boxShadow: '0 2px 8px #2563eb44' }}
              >
                <WaveLogo />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <strong className="text-nova-text-primary text-sm block truncate leading-tight">OurCode AI</strong>
                  {activeConfigGroup ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] text-green-500 bg-green-500/10 border border-green-500/20 shrink-0">
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
              <button
                onClick={handleNewSession}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-white hover:opacity-90 transition-opacity shrink-0"
                style={{ background: 'var(--grad-brand)', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}
                title={t('chat.newChat')}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span>{t('chat.newChat')}</span>
              </button>
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
                          onClick={() => { handleNewSession(); setShowMoreMenu(false) }}
                          className="w-full text-left px-3 py-1.5 text-xs text-nova-text-secondary hover:bg-nova-accent/15 hover:text-white flex items-center gap-2 transition-colors"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                          {t('chat.newChat')}
                        </button>
                        <button
                          onClick={() => { setShowArena(true); setShowMoreMenu(false) }}
                          className="w-full text-left px-3 py-1.5 text-xs text-nova-text-secondary hover:bg-nova-accent/15 hover:text-white flex items-center gap-2 transition-colors"
                        >
                          <span className="text-sm leading-none">⚖️</span>
                          {t('chat.arenaCompare')}
                        </button>
                        <button
                          onClick={() => { setShowWorkflows(true); setShowMoreMenu(false) }}
                          className="w-full text-left px-3 py-1.5 text-xs text-nova-text-secondary hover:bg-nova-accent/15 hover:text-white flex items-center gap-2 transition-colors"
                        >
                          <span className="text-sm leading-none">🔁</span>
                          {t('chat.workflows')}
                        </button>
                        <button
                          onClick={() => { openMemoryManager(); setShowMoreMenu(false) }}
                          className="w-full text-left px-3 py-1.5 text-xs text-nova-text-secondary hover:bg-nova-accent/15 hover:text-white flex items-center gap-2 transition-colors"
                        >
                          <span className="text-sm leading-none">🧠</span>
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
              <ChatMessages />

              {/* Mode bar — chat / agent (planning is a read-only phase of agent mode) */}
              <div className="shrink-0 px-3 py-1.5 border-t border-nova-border flex items-center justify-between gap-1.5" style={{ background: 'var(--surface)' }}>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setAgentMode(activeSession.id, 'chat')}
                    className={`px-2.5 py-1 text-xs rounded-md transition-colors ${effectiveAgentMode === 'chat' ? 'bg-[#2563eb] text-white' : 'text-nova-text-muted hover:text-nova-text-primary hover:bg-nova-hover'}`}
                    title={t('chat.chatModeHint')}
                  >
                    {t('chat.modeChat')}
                  </button>
                  <button
                    onClick={handleSwitchToAgent}
                    disabled={!hasProject}
                    className={`px-2.5 py-1 text-xs rounded-md transition-colors ${effectiveAgentMode === 'agent' ? 'bg-[#2563eb] text-white' : 'text-nova-text-muted hover:text-nova-text-primary hover:bg-nova-hover'} ${!hasProject ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title={hasProject ? t('chat.modeAgentHint') : t('chat.agentNeedsProject')}
                  >
                    {t('chat.modeAgent')}
                  </button>
                </div>
                {effectiveAgentMode === 'agent' && (
                  <>
                    <label
                      className="flex items-center gap-1 cursor-pointer select-none text-[10px] text-nova-text-muted hover:text-nova-text-secondary transition-colors"
                      title={t('chat.targetModeHint')}
                    >
                      <input
                        type="checkbox"
                        checked={targetMode}
                        onChange={(e) => setTargetMode(activeSession.id, e.target.checked)}
                        className="accent-nova-accent w-3 h-3"
                      />
                      {t('chat.targetMode')}
                      {statusBadge(targetModeStatus) && (
                        <span className="text-nova-accent font-medium">{statusBadge(targetModeStatus)}</span>
                      )}
                    </label>
                    <select
                      value={projectEditMode}
                      onChange={(e) => setProjectEditMode(activeSession.id, e.target.value as 'confirm_before_change' | 'auto_edit' | 'plan' | 'full_access')}
                      className="text-xs rounded-md px-2 py-1 border border-nova-border bg-nova-input-bg text-nova-text-primary outline-none cursor-pointer hover:border-nova-accent focus:border-nova-accent transition-colors"
                      title={t('chat.projectEditModeLabel')}
                      style={{ backgroundImage: 'none' }}
                    >
                      <option value="confirm_before_change" title={t('chat.projectEditModeConfirmHint')}>{t('chat.projectEditModeConfirm')}</option>
                      <option value="auto_edit" title={t('chat.projectEditModeAutoHint')}>{t('chat.projectEditModeAuto')}</option>
                      <option value="plan" title={t('chat.projectEditModePlanHint')}>{t('chat.projectEditModePlan')}</option>
                      <option value="full_access" title={t('chat.projectEditModeFullHint')}>{t('chat.projectEditModeFull')}</option>
                    </select>
                  </>
                )}
              </div>

              <ChatInput />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-4">
              <div className="text-center max-w-[320px]">
                <div
                  className="w-14 h-14 mx-auto mb-4 rounded-2xl flex items-center justify-center"
                  style={{ background: 'var(--grad-avatar)', boxShadow: '0 8px 24px rgba(59,130,246,0.35)' }}
                >
                  <WaveLogo size={24} />
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
                  className="px-5 py-2 text-white rounded-lg text-sm hover:opacity-90 transition-opacity shadow-lg"
                  style={{ background: 'var(--grad-brand)', boxShadow: '0 4px 14px rgba(37,99,235,0.35)' }}
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
