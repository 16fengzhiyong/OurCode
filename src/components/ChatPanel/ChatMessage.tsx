import { useState, useEffect } from 'react'
import { ChatMessage as ChatMessageType } from '@/types'
import { useChatStore } from '@/stores/chatStore'
import { useEditorStore } from '@/stores/editorStore'
import { useMemoryStore } from '@/stores/memoryStore'
import { useUIStore } from '@/stores/uiStore'
import { EXHAUSTED_MARKER } from '@shared/constants'
import MarkdownRenderer from '../Common/MarkdownRenderer'
import AgentTimeline from './AgentTimeline'
import { PlanCard } from './AgentPanel'
import WaveLogo from './WaveLogo'
import ErrorCard from './ErrorCard'
import MemoryPreviewModal from './MemoryPreviewModal'
import { useI18n } from '@/i18n/useI18n'

interface ChatMessageProps {
  message: ChatMessageType
  sessionId: string
  isSelectMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
}

/** Compact token count for the agent header badge (1.2K / 3.4M / 512) */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

/** Ghost icon/label button (hover action toolbar) — vibrant-gradient variant:
 *  glass pill buttons that reveal a brand-colored gradient glow on hover. */
function GhostButton({
  onClick,
  title,
  danger,
  accent,
  children,
}: {
  onClick: () => void
  title: string
  danger?: boolean
  accent?: boolean
  children: React.ReactNode
}) {
  const base =
    'group relative overflow-hidden inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold ' +
    'border border-nova-border bg-nova-surface/60 backdrop-blur transition-all duration-300 ' +
    'hover:scale-[1.05] ease-[cubic-bezier(0.34,1.56,0.64,1)]'
  const tone = danger
    ? 'text-[#F48771] hover:text-[#F48771] hover:border-[#F48771]/50'
    : accent
      ? 'text-nova-accent hover:text-nova-accent hover:border-nova-accent/50'
      : 'text-nova-text-muted hover:text-nova-text-primary hover:border-nova-border'
  const glow = danger
    ? 'bg-gradient-sunset-peach'
    : accent
      ? 'bg-gradient-blue-violet'
      : 'bg-gradient-blue-violet'
  return (
    <button onClick={onClick} title={title} className={`${base} ${tone}`}>
      <span className={`absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity ${glow}`} />
      <span className="relative z-[1] inline-flex items-center gap-1">{children}</span>
    </button>
  )
}

export default function ChatMessage({ message, sessionId, isSelectMode, isSelected, onToggleSelect }: ChatMessageProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)
  const [remembered, setRemembered] = useState(false)
  const [isRemembering, setIsRemembering] = useState(false)
  const [previewMemory, setPreviewMemory] = useState<{ content: string; projectPath: string } | null>(null)
  const t = useI18n()

  // Inline editing and batch selection only apply in history-edit mode.
  const editEnabled = useEditorStore((s) => s.preferences.chatHistoryEditMode)

  const { editMessage, regenerateFromMessage, createBranchFromMessage, continueGeneration, checkpoints, revertCheckpoint } = useChatStore()
  const condenseMemory = useMemoryStore((s) => s.condenseMemory)

  // ── Agent status for assistant header ──
  // Per-session active run: with parallel conversations each session owns its
  // own run; a non-running session falls back to its latest run record.
  const activeRun = useChatStore((s) => s.activeRuns[sessionId])
  const session = useChatStore((s) => s.sessions.find((x) => x.id === sessionId))
  // agentRuns is newest-first (startAgentRun prepends); when no run is live
  // (restored sessions start with an empty activeRuns) fall back to the NEWEST
  // record — the oldest one would show stale status/tokens.
  const lastRun = session?.agentRuns?.[0]
  const run = activeRun
    ? session?.agentRuns?.find((r) => r.id === activeRun.runId)
    : lastRun
  // A run paused for plan approval is NOT actively running — lumping it into
  // isLive rendered a forever-ticking "⏳ 运行中" after submit_plan, which read
  // as stuck/failed (and hid the fact that the plan was actually submitted).
  // waiting_plan gets its own label and no elapsed counter.
  const isLive = run && (run.status === 'running' || run.status === 'creating_plan' || run.status === 'approved_running')
  const isWaitingPlan = run?.status === 'waiting_plan'
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!isLive) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [isLive])

  let agentBadge: { icon: string; label: string; cls: string; elapsed?: number; tokens?: number } | null = null
  if (isLive) {
    agentBadge = { icon: '⏳', label: t('agent.runStatus.running'), cls: 'text-[#3B82F6]', elapsed: Math.floor((now - run!.startedAt) / 1000) }
  } else if (isWaitingPlan) {
    agentBadge = { icon: '📋', label: t('agent.runStatus.waitingPlan'), cls: 'text-yellow-400' }
  } else if (run?.status === 'done' || run?.status === 'stopped' || run?.status === 'error') {
    const runTokens = (run.tokensIn || 0) + (run.tokensOut || 0)
    const statusLabel = run.status === 'done'
      ? t('agent.runStatus.done')
      : run.status === 'stopped'
        ? t('agent.runStatus.stopped')
        : t('agent.runStatus.error')
    agentBadge = {
      icon: run.status === 'error' ? '✗' : '✓',
      label: statusLabel,
      cls: run.status === 'error' ? 'text-red-400' : 'text-green-400',
      elapsed: run.finishedAt ? Math.floor((run.finishedAt - run.startedAt) / 1000) : undefined,
      tokens: runTokens > 0 ? runTokens : undefined,
    }
  }

  const handleSaveEdit = () => {
    editMessage(sessionId, message.id, editContent)
    setIsEditing(false)
  }

  const handleCancelEdit = () => {
    setEditContent(message.content)
    setIsEditing(false)
  }

  const handleRegenerate = () => {
    regenerateFromMessage(sessionId, message.id)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content)
  }

  const handleRemember = async () => {
    // Memories are project-scoped — a project must be open to remember.
    const projectPath = useUIStore.getState().rootPath || session?.projectPath
    if (!projectPath) {
      useUIStore.getState().showNotification(t('chat.rememberNoProject'), 'warning')
      return
    }
    if (isRemembering) return

    // Build a compact conversation context (last ~10 messages up to this one),
    // so the AI can condense the *context* rather than pasting the raw reply.
    const allMessages = session?.messages || []
    const selfIndex = allMessages.findIndex((m) => m.id === message.id)
    const contextMessages = (selfIndex === -1 ? allMessages : allMessages.slice(0, selfIndex + 1)).slice(-10)
    let conversation = contextMessages
      .map((m) => `${m.role === 'user' ? '用户' : m.role === 'assistant' ? 'AI' : '工具'}: ${m.content}`)
      .join('\n\n')
    if (conversation.length > 6000) conversation = conversation.slice(-6000)

    setIsRemembering(true)
    try {
      // Condense first, then let the user review/edit before writing to memory.
      const condensed = await condenseMemory(conversation, projectPath, session?.model)
      setPreviewMemory({ content: condensed, projectPath })
    } catch (error) {
      useUIStore.getState().showNotification(
        `${t('chat.rememberError')}: ${error instanceof Error ? error.message : String(error)}`,
        'error',
      )
    } finally {
      setIsRemembering(false)
    }
  }

  const handlePreviewSaved = (scope: 'project' | 'global') => {
    setPreviewMemory(null)
    setRemembered(true)
    useUIStore.getState().showNotification(
      scope === 'project' ? t('chat.rememberedProject') : t('chat.rememberedGlobal'),
      'success',
    )
    setTimeout(() => setRemembered(false), 2000)
  }

  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isTool = message.role === 'tool'
  const isExhausted = isAssistant && message.content.startsWith(EXHAUSTED_MARKER)

  // Process summary (thinking + tool calls) → rendered via AgentTimeline
  const hasProcess = (isAssistant && !!message.thinking) || (isAssistant && !!message.toolCalls?.length)

  // Checkpoints tied to this assistant message → "回滚修改".
  // The store's checkpoint list is per active session — scope defensively by
  // session so parallel sessions can't show each other's checkpoints.
  const msgCheckpoints = checkpoints.filter((c) => c.sessionId === sessionId && c.messageId === message.id)

  const handleRevertMessage = async () => {
    for (const cp of msgCheckpoints) {
      await revertCheckpoint(cp.id)
    }
  }

  // Tool result messages — no longer rendered as separate messages.
  // Tool results are now displayed inline within the corresponding assistant
  // message's ToolCallBlock (via the toolResults prop).
  // Legacy tool messages from older sessions are filtered out in ChatMessages.tsx.
  if (isTool) return null

  return (
    <div className={`group animate-fade-in ${isUser ? 'flex justify-end' : 'flex gap-2.5'}`}>
      {/* Memory review/edit preview — shown after the AI condenses the chat */}
      {previewMemory && (
        <MemoryPreviewModal
          content={previewMemory.content}
          projectPath={previewMemory.projectPath}
          onCancel={() => setPreviewMemory(null)}
          onSaved={handlePreviewSaved}
        />
      )}

      {/* Batch select checkbox — only in history-edit mode */}
      {isSelectMode && editEnabled && (
        <label className="flex items-start pt-2 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={isSelected || false}
            onChange={() => onToggleSelect?.(message.id)}
            className="w-3.5 h-3.5 accent-nova-accent rounded"
          />
        </label>
      )}

      {/* Assistant avatar — brand gradient + soft violet glow */}
      {!isUser && (
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 avatar-glow"
          style={{ background: 'var(--grad-brand)' }}
        >
          <WaveLogo size={16} />
        </div>
      )}

      {/* Content column */}
      <div className={`min-w-0 ${isUser ? 'max-w-[80%]' : 'flex-1'}`}>
        {/* Assistant meta header */}
        {!isUser && (
          <div className="flex items-center gap-1.5 text-xs text-nova-text-muted font-medium mb-1.5 pl-0.5">
            <span className="font-bold text-nova-text-primary">OurCode AI</span>
            {agentBadge && (
              <span className={`flex items-center gap-1 ${agentBadge.cls}`}>
                {agentBadge.icon === '⏳' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse-soft inline-block" />
                )}
                · {agentBadge.icon} {agentBadge.label}
                {agentBadge.elapsed !== undefined && ` ${agentBadge.elapsed}s`}
                {agentBadge.tokens !== undefined && ` · ${formatTokens(agentBadge.tokens)} ${t('statusBar.tokens')}`}
              </span>
            )}
          </div>
        )}
        {/* Structured LLM error → friendly error card (never raw JSON text) */}
        {message.error ? (
          <ErrorCard error={message.error} onRetry={handleRegenerate} />
        ) : (
          <>
            {/* Bubble / content card — user: gradient tinted glass; AI: glass panel */}
            <div
              className={isUser ? 'px-4 py-2.5 bubble-user' : 'px-4 py-3 rounded-xl border'}
              style={
                isUser
                  ? { color: 'var(--text-primary)' }
                  : {
                      background: 'var(--ai-surface)',
                      borderColor: 'var(--border-strong)',
                    }
              }
            >
              {/* Agent execution timeline (thinking + tool calls) */}
              {hasProcess && (
                <div className="mb-1.5">
                  <AgentTimeline
                    toolCalls={message.toolCalls}
                    toolResults={message.toolResults}
                    thinking={message.thinking}
                  />
                </div>
              )}

              {/* Edited indicator */}
              {message.editedAt && (
                <div className="text-[10px] text-nova-text-muted mb-1 italic">{t('chat.edited')}</div>
              )}

              {/* Content */}
              {isEditing ? (
                <div>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full p-2 bg-nova-bg text-text-primary rounded-lg border border-nova-border focus:border-nova-accent focus:outline-none min-h-[80px] font-mono text-sm resize-none"
                    rows={3}
                  />
                  <div className="flex justify-end gap-2 mt-2">
                    <button
                      onClick={handleCancelEdit}
                      className="px-3 py-1 text-xs bg-nova-hover rounded-lg hover:bg-nova-border transition-colors text-nova-text-secondary"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      className="px-3 py-1 text-xs bg-nova-accent rounded-lg hover:opacity-90 transition-opacity text-white"
                    >
                      {t('common.save')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-sm leading-relaxed">
                  {isAssistant ? (
                    <MarkdownRenderer content={message.content} />
                  ) : (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  )}
                </div>
              )}
            </div>

            {/* Submitted plan — rendered inline inside the assistant message
                that called submit_plan (approve/cancel, or the kept record) */}
            {isAssistant && (message.toolCalls || []).some((tc) => tc.name === 'submit_plan') && (
              <PlanCard sessionId={sessionId} />
            )}

            {/* Actions — hover-reveal ghost toolbar */}
            {!isEditing && (
              <div className={`flex flex-wrap items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? 'justify-end' : 'justify-start'}`}>
                {isExhausted && (
                  <GhostButton onClick={() => continueGeneration(sessionId)} title={t('chat.continueRun')} accent>
                    ▶ {t('chat.continueRun')}
                  </GhostButton>
                )}
                {isAssistant && msgCheckpoints.length > 0 && (
                  <GhostButton onClick={handleRevertMessage} title={t('chat.rollbackHint')} danger>
                    {t('chat.rollback')}
                  </GhostButton>
                )}
                {editEnabled && (
                  <GhostButton onClick={() => setIsEditing(true)} title={t('chat.editMessage')}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    {t('chat.edit')}
                  </GhostButton>
                )}
                {isAssistant && (
                  <GhostButton onClick={handleRegenerate} title={t('chat.regenerate')}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                    {t('chat.regenerate')}
                  </GhostButton>
                )}
                {isAssistant && !isExhausted && (
                  <GhostButton onClick={handleRemember} title={t('chat.rememberHint')}>
                    {isRemembering ? (
                      <>
                        <span className="w-3 h-3 border-2 border-nova-accent/30 border-t-nova-accent rounded-full animate-spin inline-block align-[-2px]" />
                        {t('chat.remembering')}
                      </>
                    ) : remembered ? t('chat.remembered') : t('chat.remember')}
                  </GhostButton>
                )}
                <GhostButton
                  onClick={() => createBranchFromMessage(sessionId, message.id)}
                  title={t('chat.branchFromMessage')}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                  {t('chat.branch')}
                </GhostButton>
                <GhostButton onClick={handleCopy} title={t('common.copy')}>
                  {t('common.copy')}
                </GhostButton>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
