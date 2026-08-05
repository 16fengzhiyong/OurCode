import { useState } from 'react'
import ChatMessages from './ChatMessages'
import ChatInput from './ChatInput'
import HistoryEditor from './HistoryEditor'
import ChatSidebar from './ChatSidebar'
import MemoryModal from './MemoryModal'
import ArenaModal from './ArenaModal'
import WorkflowModal from './WorkflowModal'
import ModelSelector from './ModelSelector'
import WaveLogo from './WaveLogo'
import { useChatStore } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'
import { useUIStore } from '@/stores/uiStore'
import { useI18n } from '@/i18n/useI18n'

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="p-1.5 rounded text-nova-text-muted hover:text-nova-text-primary hover:bg-nova-hover transition-colors"
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
  const { activeConfigGroupId, models } = useConfigStore()
  const { openSettings } = useUIStore()
  const t = useI18n()
  const [showHistory, setShowHistory] = useState(true)
  const [showSessionList, setShowSessionList] = useState(false)
  const [showMemories, setShowMemories] = useState(false)
  const [showArena, setShowArena] = useState(false)
  const [showWorkflows, setShowWorkflows] = useState(false)
  const [showModelPicker, setShowModelPicker] = useState(false)

  const agentMode = activeSession?.agentMode || 'chat'
  const activeModel = activeSession?.model || ''

  const handleNewSession = () => {
    if (activeConfigGroupId) {
      createSession(activeConfigGroupId)
    } else {
      openSettings()
    }
  }

  return (
    <div className="h-full flex" style={{ background: '#191A1B' }}>
      {/* Session sidebar (collapsible) */}
      {showSessionList && (
        <ChatSidebar onClose={() => setShowSessionList(false)} />
      )}

      {/* Memory manager */}
      {showMemories && <MemoryModal onClose={() => setShowMemories(false)} />}

      {/* Arena (parallel model comparison) */}
      {showArena && <ArenaModal onClose={() => setShowArena(false)} />}

      {/* Workflows */}
      {showWorkflows && <WorkflowModal onClose={() => setShowWorkflows(false)} />}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Cascade-style header */}
        <div className="px-3 py-2 border-b shrink-0" style={{ background: '#191A1B', borderColor: '#2A2B2C' }}>
          <div className="flex items-center justify-between gap-2">
            {/* Brand */}
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => setShowSessionList(!showSessionList)}
                className="p-1.5 rounded hover:bg-nova-hover transition-colors text-nova-text-muted hover:text-nova-text-primary shrink-0"
                title={t('chat.sessionList')}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h7" />
                </svg>
              </button>
              <div
                className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                style={{ background: 'linear-gradient(135deg, #57A3F8, #3994BC)', boxShadow: '0 2px 8px #3994bc44' }}
              >
                <WaveLogo />
              </div>
              <div className="min-w-0">
                <strong className="text-nova-text-primary text-sm block truncate leading-tight">OurCode AI</strong>
                <span className="text-[10px] text-nova-text-muted flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                  {t('chat.connected')}
                </span>
              </div>
            </div>

            {/* Model pill + mode toggle + actions */}
            <div className="flex items-center gap-1.5 shrink-0">
              {activeSession && (
                <div className="relative">
                  <button
                    onClick={() => setShowModelPicker(!showModelPicker)}
                    className="pill-btn flex items-center gap-1 max-w-[150px] text-[11px]"
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
                        style={{ background: '#191A1B', borderColor: '#2A2B2C' }}
                      >
                        <ModelSelector />
                      </div>
                    </>
                  )}
                </div>
              )}
              {activeSession && (
                <div className="pill-section" title={t('chat.agentMode')}>
                  <button
                    onClick={() => setAgentMode(activeSession.id, 'chat')}
                    className={`pill-btn ${agentMode === 'chat' ? 'active' : ''}`}
                    title={t('chat.chatModeHint')}
                  >
                    {t('chat.chatMode')}
                  </button>
                  <button
                    onClick={() => setAgentMode(activeSession.id, 'plan')}
                    className={`pill-btn ${agentMode === 'plan' ? 'active' : ''}`}
                    title={t('chat.planModeHint')}
                  >
                    {t('chat.planMode')}
                  </button>
                </div>
              )}
              <div className="flex items-center gap-0.5">
                <IconButton title={t('chat.arenaCompare')} onClick={() => setShowArena(true)}>
                  <span className="text-sm leading-none">⚖️</span>
                </IconButton>
                <IconButton title={t('chat.workflows')} onClick={() => setShowWorkflows(true)}>
                  <span className="text-sm leading-none">🔁</span>
                </IconButton>
                <IconButton title={t('chat.memory')} onClick={() => setShowMemories(true)}>
                  <span className="text-sm leading-none">🧠</span>
                </IconButton>
                <IconButton title={t('chat.newChat')} onClick={handleNewSession}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </IconButton>
                <IconButton title={t('chat.settings')} onClick={openSettings}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                  </svg>
                </IconButton>
              </div>
            </div>
          </div>
        </div>

        {/* Chat Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {activeSession ? (
            <>
              <ChatMessages />
              <ChatInput />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-4">
              <div className="text-center">
                <div
                  className="text-4xl mb-3 font-bold"
                  style={{
                    background: 'linear-gradient(135deg, #57A3F8, #3994BC)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  OurCode AI
                </div>
                <div className="text-sm text-nova-text-muted mb-2">
                  {t('chat.emptyTitle')}
                </div>
                <div className="text-xs text-nova-text-muted mb-6 max-w-xs mx-auto">
                  {t('chat.emptyDesc')}
                </div>
                <button
                  onClick={handleNewSession}
                  className="px-6 py-2.5 text-white rounded-full text-sm hover:opacity-90 transition-opacity shadow-lg"
                  style={{ background: 'linear-gradient(135deg, #57A3F8, #3994BC)' }}
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

        {/* History Editor */}
        {activeSession && activeSession.messages.length > 0 && (
          <HistoryEditor
            sessionId={activeSession.id}
            isExpanded={showHistory}
            onToggle={() => setShowHistory(!showHistory)}
          />
        )}
      </div>
    </div>
  )
}
