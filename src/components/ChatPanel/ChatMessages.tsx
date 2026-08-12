import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useChatStore, estimateContextTokens } from '@/stores/chatStore'
import { useEditorStore } from '@/stores/editorStore'
import ChatMessage from './ChatMessage'
import ThinkingSection from './ThinkingSection'
import MarkdownRenderer from '../Common/MarkdownRenderer'
import BranchTreeModal from './BranchTreeModal'
import { TodoPanel } from './AgentPanel'
import WaveLogo from './WaveLogo'
import projectLogo from '@/assets/ourcode-logo.png'
import { useI18n } from '@/i18n/useI18n'
import type { ChatMessage as ChatMessageType } from '@/types'

// Common model context windows (in tokens)
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4o': 128000, 'gpt-4o-mini': 128000, 'gpt-4-turbo': 128000, 'gpt-3.5-turbo': 16385,
  'claude-3-opus': 200000, 'claude-3-sonnet': 200000, 'claude-3-haiku': 200000,
  'deepseek-chat': 200000, 'deepseek-coder': 200000, 'deepseek-reasoner': 200000,
  'deepseek-v4': 200000,
  'gemini-1.5-pro': 2000000, 'gemini-1.5-flash': 1000000,
}

export default function ChatMessages() {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  // Derive the active session via id + find: the selector returns the session
  // OBJECT (stable reference unless that session itself changes), so unrelated
  // store churn — other sessions streaming, checkpoints loading, queue updates —
  // never re-renders the whole conversation. (The old getActiveSession()
  // function selector returns a stable function reference and never re-renders
  // at all; it only worked because of whole-store subscriptions elsewhere.)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const activeSession = useChatStore((s) => (s.activeSessionId ? s.sessions.find((x) => x.id === s.activeSessionId) ?? null : null))
  const reorderMessages = useChatStore((s) => s.reorderMessages)
  const undoStack = useChatStore((s) => s.undoStack)
  const undoDelete = useChatStore((s) => s.undoDelete)
  const switchBranch = useChatStore((s) => s.switchBranch)
  // Loading / streaming state is per session — only the conversation the user
  // is viewing reacts to its own run; parallel sessions stream independently.
  const isThisSessionLoading = useChatStore((s) => !!activeSessionId && s.runningSessionIds.includes(activeSessionId))
  const stream = useChatStore((s) => (activeSessionId ? s.streamingBySession[activeSessionId] : undefined))
  // Idle clock: last time this session's agent produced any activity (chunk /
  // tool step / dialog). When it stays silent for > 1 min a warning badge
  // counts up the silence so the user knows the model is still "thinking".
  const lastActivityAt = useChatStore((s) => (activeSessionId ? s.streamLastActivityBySession[activeSessionId] : undefined))
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isThisSessionLoading) return
    // Re-sync immediately on any activity (new chunk resets the counter), then
    // tick every second while the session runs.
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [isThisSessionLoading, lastActivityAt])
  const idleSeconds = lastActivityAt ? Math.floor((now - lastActivityAt) / 1000) : 0
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [showUndoToast, setShowUndoToast] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [showBranchTree, setShowBranchTree] = useState(false)
  const t = useI18n()

  // History is read-only by default; editing (drag reorder / inline edit /
  // batch delete) requires the "对话历史编辑" toggle in Settings.
  const editEnabled = useEditorStore((s) => s.preferences.chatHistoryEditMode)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragLockTopRef = useRef<number | null>(null)
  // True while the user is looking at the newest messages (near the bottom).
  // While the model streams a reply we only auto-scroll when this is true —
  // reading an earlier message must never get yanked down by new output.
  const isNearBottomRef = useRef(true)

  // Context truncation warning — real API usage from the last response as the
  // baseline + a rough estimate for messages added since (Claude Code-style),
  // so the percentage tracks what the model actually receives.
  const tokenWarning = useMemo(() => {
    if (!activeSession) return null
    const totalTokens = estimateContextTokens(activeSession)
    const modelId = activeSession.model || ''
    // 精确 → 去掉 provider 前缀（a/b 形式）→ 前缀两段（deepseek-v4-flash → deepseek-v4）
    const ctxId = modelId.split('/').pop() || ''
    const contextWindow =
      MODEL_CONTEXT_WINDOWS[modelId]
      || MODEL_CONTEXT_WINDOWS[ctxId]
      || MODEL_CONTEXT_WINDOWS[ctxId.split('-').slice(0, 2).join('-')]
      || 128000
    const usage = totalTokens / contextWindow
    if (usage > 0.9) return { level: 'critical' as const, percent: Math.round(usage * 100), totalTokens, contextWindow }
    if (usage > 0.7) return { level: 'warning' as const, percent: Math.round(usage * 100), totalTokens, contextWindow }
    return null
  }, [activeSession])

  // Auto-scroll to the latest message when entering a session, when the
  // conversation grows, or while streaming. Crucially NOT when the user
  // reorders/edits history — that used to yank the whole view to the bottom
  // right after dropping a dragged message. We scroll ONLY the messages
  // container (never scrollIntoView, which would also scroll outer layout
  // containers if they ever overflow). New output only follows along while
  // the user is at the bottom — scrolling up to read an earlier message
  // pauses the auto-scroll until they return to the bottom.
  const prevLenRef = useRef(0)
  const prevSessionRef = useRef('')
  useEffect(() => {
    if (!activeSession) return
    const sid = activeSession.id
    const len = activeSession.messages.length
    const sessionChanged = sid !== prevSessionRef.current
    const grew = len > prevLenRef.current
    prevSessionRef.current = sid
    prevLenRef.current = len
    if (sessionChanged || grew || stream?.content) {
      const el = scrollRef.current
      if (!el) return
      // Entering a session resets the reading position — always follow the new
      // content; growth and streaming respect the user's scroll position.
      if (sessionChanged) {
        isNearBottomRef.current = true
      } else if (!isNearBottomRef.current) {
        return
      }
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      // chat-msg-row uses content-visibility, so rows resolve their real
      // height one frame after layout; nudge again if the first pass landed
      // short so long histories still end up at the true bottom.
      requestAnimationFrame(() => {
        if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
        }
      })
    }
  }, [activeSession, stream?.content])

  // Leaving history-edit mode resets any active batch selection.
  useEffect(() => {
    if (!editEnabled) {
      setIsSelectMode(false)
      setSelectedIds(new Set())
    }
  }, [editEnabled])

  const handleDragStart = useCallback((index: number, e: React.DragEvent) => {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
    // Lock the list's scroll position while dragging so the browser's
    // edge auto-scroll can't slide the whole conversation around.
    if (scrollRef.current) dragLockTopRef.current = scrollRef.current.scrollTop
  }, [])

  const handleDragOver = useCallback((index: number, e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setOverIndex(index)
  }, [])

  const handleDrop = useCallback((toIndex: number, e: React.DragEvent) => {
    e.preventDefault()
    if (dragIndex !== null && dragIndex !== toIndex && activeSession) {
      reorderMessages(activeSession.id, dragIndex, toIndex)
    }
    setDragIndex(null)
    setOverIndex(null)
    dragLockTopRef.current = null
  }, [dragIndex, activeSession, reorderMessages])

  const handleDragEnd = useCallback(() => {
    setDragIndex(null)
    setOverIndex(null)
    dragLockTopRef.current = null
  }, [])

  // Show undo toast when undo stack changes
  useEffect(() => {
    if (undoStack.length > 0) {
      setShowUndoToast(true)
      const timer = setTimeout(() => setShowUndoToast(false), 5000)
      return () => clearTimeout(timer)
    }
  }, [undoStack.length])

  // ── Linear transcript with turn grouping ──
  // HARD REQUIREMENT: one user message → ONE assistant bubble. Consecutive
  // assistant messages (multi-round agent runs) group into a single display
  // turn sharing one avatar/header; the events INSIDE still render linearly
  // (thinking → text → tool rows per message, nothing aggregated into a card).
  // Tool pairing messages (role='tool') are skipped — their results already
  // render inline inside the assistant message's ToolStepRow.
  const messages = useMemo(() => activeSession?.messages || [], [activeSession?.messages])
  const visibleMessages = useMemo(() => messages.filter((m) => m.role !== 'tool'), [messages])
  const turns = useMemo(() => {
    const result: Array<{ kind: 'user'; message: ChatMessageType } | { kind: 'assistant'; messages: ChatMessageType[] }> = []
    for (const m of messages) {
      if (m.role === 'tool') continue
      if (m.role === 'assistant') {
        const last = result[result.length - 1]
        if (last && last.kind === 'assistant') last.messages.push(m)
        else result.push({ kind: 'assistant', messages: [m] })
      } else {
        result.push({ kind: 'user', message: m })
      }
    }
    return result
  }, [messages])
  // True while the last committed assistant message still has tool calls awaiting
  // results — their ToolStepRows render above (spinner → ✓/✗ in place), so the
  // live turn below must stay hidden during that execution phase. NOTE: pairing
  // tool messages (role='tool') are appended AFTER the assistant message as each
  // tool finishes, so scan back past them to find the real last assistant message.
  const isToolsExecuting = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === 'tool') continue
      return (
        m.role === 'assistant' &&
        (m.toolCalls?.length || 0) > 0 &&
        m.toolCalls!.some((tc) => !m.toolResults?.some((r) => r.toolCallId === tc.id))
      )
    }
    return false
  }, [messages])

  // Defined BEFORE the early return — React hooks must run unconditionally
  // (useCallback would otherwise be called conditionally when no session is open).
  const handleBatchDelete = () => {
    if (!activeSession || selectedIds.size === 0) return
    // Single batched operation: one undo entry, one save, no cascade side-effects
    useChatStore.getState().deleteMessages(activeSession.id, Array.from(selectedIds))
    setSelectedIds(new Set())
    setIsSelectMode(false)
  }

  const toggleSelect = useCallback((msgId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(msgId)) next.delete(msgId)
      else next.add(msgId)
      return next
    })
  }, [])

  if (!activeSession) return null

  return (
    <div
      ref={scrollRef}
      onScroll={() => {
        // While a drag is active, hold the list in place so edge auto-scroll
        // doesn't slide the conversation up/down mid-drag.
        const lock = dragLockTopRef.current
        const el = scrollRef.current
        if (lock !== null && el && Math.abs(el.scrollTop - lock) > 1) el.scrollTop = lock
        // Track whether the user is near the bottom — auto-scroll during
        // streaming only follows along while they are.
        if (el) {
          isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100
        }
      }}
      className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 relative"
    >
      {/* Batch select toolbar — only in history-edit mode */}
      {editEnabled && visibleMessages.length > 0 && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setIsSelectMode(!isSelectMode); setSelectedIds(new Set()) }}
            className={`px-2 py-1 text-[10px] rounded transition-colors ${isSelectMode ? 'bg-nova-accent/20 text-nova-accent' : 'bg-nova-hover text-nova-text-muted hover:text-nova-text-secondary'}`}
          >
            {isSelectMode ? t('chat.cancelSelect') : t('chat.multiSelect')}
          </button>
          {isSelectMode && selectedIds.size > 0 && (
            <>
              <span className="text-[10px] text-nova-text-muted">{t('chat.selectedCount', { count: selectedIds.size })}</span>
              <button
                onClick={handleBatchDelete}
                className="px-2 py-1 text-[10px] bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors"
              >
                {t('chat.deleteSelected')}
              </button>
            </>
          )}
        </div>
      )}

      {/* Branch switcher */}
      {activeSession.branches && activeSession.branches.length > 0 && (
        <div className="flex items-center gap-2 px-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-nova-text-muted">
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          <select
            value={activeSession.activeBranchId || 'main'}
            onChange={(e) => switchBranch(activeSession.id, e.target.value)}
            className="bg-nova-hover text-nova-text-primary text-xs px-2 py-1 rounded border border-nova-border outline-none focus:border-nova-accent/50 cursor-pointer"
          >
            <option value="main">{t('chat.mainBranch')}</option>
            {activeSession.branches.filter(b => b.id !== 'main').map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-nova-text-muted">
            {t('chat.branchCount', { count: activeSession.branches.length })}
          </span>
          <button
            onClick={() => setShowBranchTree(true)}
            className="text-[10px] text-nova-accent hover:text-white transition-colors bg-nova-accent/15 px-2 py-0.5 rounded"
            title={t('chat.branchTreeHint')}
          >
            {t('chat.branchView')}
          </button>
        </div>
      )}

      {showBranchTree && activeSession && (
        <BranchTreeModal sessionId={activeSession.id} onClose={() => setShowBranchTree(false)} />
      )}

      {/* Agent todo (overview pinned above the conversation) */}
      <TodoPanel sessionId={activeSession.id} />

      {/* Context truncation warning — amber gradient banner (critical stays red) */}
      {tokenWarning && (
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs shrink-0 ${
          tokenWarning.level === 'critical'
            ? 'bg-red-500/10 border border-red-500/30 text-red-400'
            : 'banner-warning'
        }`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span className="font-medium">{t('chat.tokenWarning', {
            percent: tokenWarning.percent,
            used: (tokenWarning.totalTokens / 1000).toFixed(1),
            total: (tokenWarning.contextWindow / 1000).toFixed(0),
          })}</span>
        </div>
      )}

      {messages.length === 0 && !isThisSessionLoading && (
        <div className="flex-1 flex flex-col">
          {/* Welcome card (design: centered icon + title + description) */}
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4 min-h-0">
            <div className="w-14 h-14 rounded-2xl overflow-hidden mb-4 avatar-glow">
              <img src={projectLogo} alt="OurCode AI" className="w-full h-full object-cover" />
            </div>
            <div className="text-base font-semibold text-nova-text-primary">OurCode AI</div>
            <div className="text-xs text-nova-text-muted mt-1.5 max-w-[280px] leading-relaxed">
              {t('chat.welcomeDesc')}
            </div>
          </div>
        </div>
      )}

      {turns.map((turn) => {
        if (turn.kind === 'user') {
          // Find the real index in the unfiltered messages array for drag-drop
          const originalIndex = messages.findIndex((m) => m.id === turn.message.id)
          return (
            <div
              key={turn.message.id}
              draggable={editEnabled}
              onDragStart={editEnabled ? (e) => handleDragStart(originalIndex, e) : undefined}
              onDragOver={editEnabled ? (e) => handleDragOver(originalIndex, e) : undefined}
              onDrop={editEnabled ? (e) => handleDrop(originalIndex, e) : undefined}
              onDragEnd={editEnabled ? handleDragEnd : undefined}
              className={`chat-msg-row transition-all ${
                dragIndex === originalIndex ? 'opacity-40' : ''
              } ${
                overIndex === originalIndex && dragIndex !== null && dragIndex !== originalIndex
                  ? 'border-t-2 border-nova-accent'
                  : ''
              }`}
            >
              <ChatMessage
                message={turn.message}
                sessionId={activeSession.id}
                isSelectMode={isSelectMode}
                isSelected={selectedIds.has(turn.message.id)}
                onToggleSelect={toggleSelect}
              />
            </div>
          )
        }

        // Assistant turn — ONE bubble: one avatar/header, all rounds' events
        // flowing linearly beneath it (thinking → text → tool rows per message).
        const firstId = turn.messages[0].id
        const originalIndex = messages.findIndex((m) => m.id === firstId)
        return (
          <div
            key={`turn-${firstId}`}
            draggable={editEnabled}
            onDragStart={editEnabled ? (e) => handleDragStart(originalIndex, e) : undefined}
            onDragOver={editEnabled ? (e) => handleDragOver(originalIndex, e) : undefined}
            onDrop={editEnabled ? (e) => handleDrop(originalIndex, e) : undefined}
            onDragEnd={editEnabled ? handleDragEnd : undefined}
            className={`chat-msg-row transition-all ${
              dragIndex === originalIndex ? 'opacity-40' : ''
            } ${
              overIndex === originalIndex && dragIndex !== null && dragIndex !== originalIndex
                ? 'border-t-2 border-nova-accent'
                : ''
            }`}
          >
            <div className="flex flex-col gap-1.5">
              {turn.messages.map((msg, idx) => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  sessionId={activeSession.id}
                  isSelectMode={isSelectMode}
                  isSelected={selectedIds.has(msg.id)}
                  onToggleSelect={toggleSelect}
                  hideMeta={idx > 0}
                  hideActions={idx < turn.messages.length - 1}
                />
              ))}
            </div>
          </div>
        )
      })}

      {/* Live turn — only while the CURRENT LLM round is still streaming. Once
          the round commits (addMessage + clearStream in the agent loop) its
          thinking/text/tool rows render above from the committed message, so
          this block must NOT also appear. During tool execution the committed
          message's ToolStepRow shows the live spinner → ✓/✗ via appendToolResult. */}
      {isThisSessionLoading && !isToolsExecuting && (
        <div className="flex gap-2.5 animate-fade-in">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 avatar-glow" style={{ background: 'var(--grad-brand)' }}>
            <WaveLogo size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-xs text-nova-text-muted font-medium mb-1.5 pl-0.5">
              <span className="font-bold text-nova-text-primary">OurCode AI</span>
              <span className="flex items-center gap-1 text-nova-accent">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse-soft inline-block" />
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-nova-hover border border-nova-border">
                  {t('chat.thinking')}…
                </span>
              </span>
              {/* Idle warning — no data for > 1 min, keep counting up (the
                  stream's 10-min idle timeout aborts if nothing arrives) */}
              {idleSeconds >= 60 && (
                <span
                  className="flex items-center gap-1 text-amber-400 font-mono text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30"
                  title="模型已长时间没有输出数据，仍在等待响应"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  已 {Math.floor(idleSeconds / 60)} 分 {idleSeconds % 60} 秒无响应
                </span>
              )}
            </div>
            {/* Thinking streams auto-expanded, then collapses once committed */}
            {stream?.thinking && <ThinkingSection thinking={stream.thinking} toolCalls={[]} defaultExpanded />}
            {stream?.content ? (
              <div className="text-sm text-nova-text-primary">
                <MarkdownRenderer content={stream.content} />
                <span className="animate-pulse-dot text-nova-accent">▋</span>
              </div>
            ) : !stream?.thinking ? (
              <div className="flex items-center gap-2 text-nova-text-muted text-sm">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full animate-think-bounce" style={{ background: '#838485' }} />
                  <span className="w-1.5 h-1.5 rounded-full animate-think-bounce" style={{ background: '#838485', animationDelay: '0.2s' }} />
                  <span className="w-1.5 h-1.5 rounded-full animate-think-bounce" style={{ background: '#838485', animationDelay: '0.4s' }} />
                </div>
                <span>{t('chat.thinking')}</span>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />

      {/* Undo toast */}
      {showUndoToast && undoStack.length > 0 && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="flex items-center gap-3 px-4 py-2 bg-nova-surface border border-nova-border rounded-lg shadow-xl">
            <span className="text-xs text-nova-text-secondary">{t('chat.deletedCount', { count: undoStack[undoStack.length - 1].messages.length })}</span>
            <button
              onClick={() => { undoDelete(); setShowUndoToast(false) }}
              className="px-3 py-1 text-xs bg-nova-accent text-white rounded hover:opacity-90 transition-opacity"
            >
              {t('chat.undo')}
            </button>
            <button
              onClick={() => setShowUndoToast(false)}
              className="text-nova-text-muted hover:text-nova-text-primary"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
