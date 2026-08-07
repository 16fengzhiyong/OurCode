import { useState, useEffect } from 'react'
import { ChatMessage as ChatMessageType } from '@/types'
import { useChatStore } from '@/stores/chatStore'
import { useEditorStore } from '@/stores/editorStore'
import { useMemoryStore } from '@/stores/memoryStore'
import { EXHAUSTED_MARKER } from '@shared/constants'
import MarkdownRenderer from '../Common/MarkdownRenderer'
import AgentTimeline from './AgentTimeline'
import WaveLogo from './WaveLogo'
import ErrorCard from './ErrorCard'
import { useI18n } from '@/i18n/useI18n'

interface ChatMessageProps {
  message: ChatMessageType
  sessionId: string
  isSelectMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
}

/** Ghost icon/label button (hover action toolbar) */
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
  const base = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-colors'
  const tone = danger
    ? 'text-[#F48771] hover:bg-[#F48771]/15'
    : accent
      ? 'text-nova-accent hover:bg-nova-accent/15'
      : 'text-nova-text-muted hover:text-nova-text-primary hover:bg-nova-hover'
  return (
    <button onClick={onClick} title={title} className={`${base} ${tone}`}>
      {children}
    </button>
  )
}

export default function ChatMessage({ message, sessionId, isSelectMode, isSelected, onToggleSelect }: ChatMessageProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)
  const [remembered, setRemembered] = useState(false)
  const t = useI18n()

  // Inline editing and batch selection only apply in history-edit mode.
  const editEnabled = useEditorStore((s) => s.preferences.chatHistoryEditMode)

  const { editMessage, regenerateFromMessage, createBranchFromMessage, continueGeneration, checkpoints, revertCheckpoint } = useChatStore()
  const addMemory = useMemoryStore((s) => s.addMemory)

  // ── Agent status for assistant header ──
  const activeRun = useChatStore((s) => s.activeRun)
  const session = useChatStore((s) => s.sessions.find((x) => x.id === sessionId))
  const lastRun = session?.agentRuns?.slice(-1)[0]
  const run = activeRun?.sessionId === sessionId
    ? session?.agentRuns?.find((r) => r.id === activeRun.runId)
    : lastRun
  const isLive = run && (run.status === 'running' || run.status === 'creating_plan' || run.status === 'approved_running' || run.status === 'waiting_plan')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!isLive) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [isLive])

  let agentBadge: { icon: string; label: string; cls: string; elapsed?: number } | null = null
  if (isLive) {
    agentBadge = { icon: '⏳', label: t('agent.runStatus.running'), cls: 'text-[#3B82F6]', elapsed: Math.floor((now - run!.startedAt) / 1000) }
  } else if (run?.status === 'done') {
    agentBadge = { icon: '✓', label: t('agent.runStatus.done'), cls: 'text-green-400', elapsed: run.finishedAt ? Math.floor((run.finishedAt - run.startedAt) / 1000) : undefined }
  } else if (run?.status === 'error') {
    agentBadge = { icon: '✗', label: t('agent.runStatus.error'), cls: 'text-red-400' }
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

  const handleRemember = () => {
    const snippet = message.content.trim().slice(0, 500)
    if (snippet) {
      addMemory(`${t('chat.memoryPrefix')}${snippet}`)
      setRemembered(true)
      setTimeout(() => setRemembered(false), 2000)
    }
  }

  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isTool = message.role === 'tool'
  const isExhausted = isAssistant && message.content.startsWith(EXHAUSTED_MARKER)

  // Process summary (thinking + tool calls) → rendered via AgentTimeline
  const hasProcess = (isAssistant && !!message.thinking) || (isAssistant && !!message.toolCalls?.length)

  // Checkpoints tied to this assistant message → "回滚修改"
  const msgCheckpoints = checkpoints.filter((c) => c.messageId === message.id)

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

      {/* Assistant avatar */}
      {!isUser && (
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ background: 'var(--grad-brand)' }}
        >
          <WaveLogo size={14} />
        </div>
      )}

      {/* Content column */}
      <div className={`min-w-0 ${isUser ? 'max-w-[80%]' : 'flex-1'}`}>
        {/* Assistant meta header */}
        {!isUser && (
          <div className="flex items-center gap-1.5 text-xs text-nova-text-muted font-medium mb-1.5 pl-0.5">
            <span>OurCode AI</span>
            {agentBadge && (
              <span className={agentBadge.cls}>
                · {agentBadge.icon} {agentBadge.label}
                {agentBadge.elapsed !== undefined && ` ${agentBadge.elapsed}s`}
              </span>
            )}
          </div>
        )}
        {/* Structured LLM error → friendly error card (never raw JSON text) */}
        {message.error ? (
          <ErrorCard error={message.error} onRetry={handleRegenerate} />
        ) : (
          <>
            {/* Bubble / content card */}
            <div
              className={isUser ? 'px-4 py-2.5 rounded-2xl rounded-tr-sm' : 'px-4 py-3 rounded-xl border'}
              style={
                isUser
                  ? {
                      background: 'var(--bubble-user)',
                      border: '1px solid var(--border-strong)',
                      color: 'var(--text-primary)',
                      transition: 'background 0.15s',
                    }
                  : {
                      background: 'var(--ai-surface)',
                      borderColor: 'var(--border-strong)',
                    }
              }
              onMouseEnter={(e) => {
                if (isUser) e.currentTarget.style.background = 'var(--bubble-user-hover)'
              }}
              onMouseLeave={(e) => {
                if (isUser) e.currentTarget.style.background = 'var(--bubble-user)'
              }}
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

            {/* Actions — hover-reveal ghost toolbar */}
            {!isEditing && (
              <div className={`flex flex-wrap items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? 'justify-end' : 'justify-start'}`}>
                {isExhausted && (
                  <GhostButton onClick={() => continueGeneration()} title={t('chat.continueRun')} accent>
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
                    {remembered ? t('chat.remembered') : t('chat.remember')}
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
