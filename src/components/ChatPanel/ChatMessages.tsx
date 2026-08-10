import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useEditorStore } from '@/stores/editorStore'
import ChatMessage from './ChatMessage'
import ThinkingBlock from './ThinkingBlock'
import MarkdownRenderer from '../Common/MarkdownRenderer'
import BranchTreeModal from './BranchTreeModal'
import { TodoPanel } from './AgentPanel'
import WaveLogo from './WaveLogo'
import projectLogo from '@/assets/ourcode-logo.png'
import { useI18n } from '@/i18n/useI18n'

// Common model context windows (in tokens)
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4o': 128000, 'gpt-4o-mini': 128000, 'gpt-4-turbo': 128000, 'gpt-3.5-turbo': 16385,
  'claude-3-opus': 200000, 'claude-3-sonnet': 200000, 'claude-3-haiku': 200000,
  'deepseek-chat': 64000, 'deepseek-coder': 64000, 'gemini-1.5-pro': 2000000, 'gemini-1.5-flash': 1000000,
}

/** Stable empty-queue reference — returning a fresh [] from the selector would
 *  re-render ChatMessages on every store update (e.g. each streaming chunk of
 *  a parallel conversation), since zustand compares with Object.is. */
const EMPTY_QUEUE: string[] = []

export default function ChatMessages() {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const activeSession = useChatStore((s) => s.getActiveSession())
  const { reorderMessages, undoStack, undoDelete, switchBranch, clearQueue } = useChatStore()
  // Streaming / loading state is per session — only the conversation the user
  // is viewing reacts to its own run; parallel sessions stream independently.
  const activeSessionId = activeSession?.id || ''
  const isThisSessionLoading = useChatStore((s) => !!activeSessionId && s.runningSessionIds.includes(activeSessionId))
  const stream = useChatStore((s) => (activeSessionId ? s.streamingBySession[activeSessionId] : undefined))
  const queuedMessages = useChatStore((s) => (activeSessionId ? (s.queuedMessagesBySession[activeSessionId] ?? EMPTY_QUEUE) : EMPTY_QUEUE))
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

  // Context truncation warning
  const tokenWarning = useMemo(() => {
    if (!activeSession) return null
    const totalTokens = activeSession.messages.reduce((sum, m) => sum + (m.tokenCount || 0), 0)
    const modelId = activeSession.model || ''
    const contextWindow = MODEL_CONTEXT_WINDOWS[modelId] || MODEL_CONTEXT_WINDOWS[modelId.split('/').pop() || ''] || 128000
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
  // containers if they ever overflow).
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
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
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

  // ── Message merging ──
  // Merge all consecutive assistant messages between user messages into
  // a single display entry. Combines tool calls, results, and thinking from
  // intermediate messages; uses the last message's content as the final answer.
  const messages = useMemo(() => activeSession?.messages || [], [activeSession?.messages])
  const displayMessages = useMemo(() => {
    const result: typeof messages = []
    let i = 0
    while (i < messages.length) {
      const msg = messages[i]
      if (msg.role === 'tool') { i++; continue }

      if (msg.role === 'assistant') {
        const mergedToolCalls = [...(msg.toolCalls || [])]
        const mergedToolResults = [...(msg.toolResults || [])]
        let mergedThinking = msg.thinking || ''
        let lastContent = msg.content
        let last = msg
        let j = i + 1
        while (j < messages.length) {
          const next = messages[j]
          if (next.role === 'tool') { j++; continue }
          if (next.role === 'assistant') {
            // Merge this assistant into the group
            if (next.toolCalls) mergedToolCalls.push(...next.toolCalls)
            if (next.toolResults) mergedToolResults.push(...next.toolResults)
            if (next.thinking) mergedThinking += (mergedThinking ? '\n\n' : '') + next.thinking
            lastContent = next.content
            last = next
            j++
          } else {
            break // next user message — stop merging
          }
        }
        result.push({
          ...last,
          content: lastContent,
          toolCalls: mergedToolCalls.length > 0 ? mergedToolCalls : undefined,
          toolResults: mergedToolResults.length > 0 ? mergedToolResults : undefined,
          thinking: mergedThinking || undefined,
        })
        i = j
      } else {
        result.push(msg); i++
      }
    }
    return result
  }, [messages])

  if (!activeSession) return null

  const handleBatchDelete = () => {
    if (!activeSession || selectedIds.size === 0) return
    // Single batched operation: one undo entry, one save, no cascade side-effects
    useChatStore.getState().deleteMessages(activeSession.id, Array.from(selectedIds))
    setSelectedIds(new Set())
    setIsSelectMode(false)
  }

  const toggleSelect = (msgId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(msgId)) next.delete(msgId)
      else next.add(msgId)
      return next
    })
  }

  return (
    <div
      ref={scrollRef}
      onScroll={() => {
        // While a drag is active, hold the list in place so edge auto-scroll
        // doesn't slide the conversation up/down mid-drag.
        const lock = dragLockTopRef.current
        const el = scrollRef.current
        if (lock !== null && el && Math.abs(el.scrollTop - lock) > 1) el.scrollTop = lock
      }}
      className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 relative"
    >
      {/* Decorative gradient glow (vibrant-gradient variant) — top-right aura,
          matches the Stitch chat design; pointer-events-none so it never
          blocks scrolling or message interactions. */}
      <div
        className="pointer-events-none absolute top-[-80px] right-[-60px] w-[360px] h-[280px] rounded-full opacity-[0.14]"
        style={{ background: 'radial-gradient(ellipse at center, #0ea5e9 0%, #6366f1 45%, transparent 70%)' }}
      />
      <div
        className="pointer-events-none absolute top-[120px] right-[-100px] w-[280px] h-[220px] rounded-full opacity-[0.08]"
        style={{ background: 'radial-gradient(ellipse at center, #a855f7 0%, transparent 70%)' }}
      />
      {/* Batch select toolbar — only in history-edit mode */}
      {editEnabled && displayMessages.length > 0 && (
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

      {/* Queued messages while the agent is working — violet gradient banner */}
      {queuedMessages.length > 0 && (
        <div className="banner-queue flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs shrink-0">
          <svg className="w-[15px] h-[15px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 22h14M5 2h14" />
            <path d="M17 2v4a5 5 0 0 1-5 5 5 5 0 0 1-5-5V2" />
            <path d="M17 22v-4a5 5 0 0 0-5-5 5 5 0 0 0-5 5v4" />
          </svg>
          <span className="font-medium">{t('chat.queuedBanner', { count: queuedMessages.length })}</span>
          <button onClick={() => clearQueue(activeSessionId)} className="ml-auto font-semibold transition-colors">{t('common.cancel')}</button>
        </div>
      )}

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

      {displayMessages
        .map((msg, _displayIndex) => {
          // Find the real index in the unfiltered messages array for drag-drop
          const originalIndex = messages.findIndex((m) => m.id === msg.id)
          return (
        <div
          key={msg.id}
          draggable={editEnabled}
          onDragStart={editEnabled ? (e) => handleDragStart(originalIndex, e) : undefined}
          onDragOver={editEnabled ? (e) => handleDragOver(originalIndex, e) : undefined}
          onDrop={editEnabled ? (e) => handleDrop(originalIndex, e) : undefined}
          onDragEnd={editEnabled ? handleDragEnd : undefined}
          className={`transition-all ${
            dragIndex === originalIndex ? 'opacity-40' : ''
          } ${
            overIndex === originalIndex && dragIndex !== null && dragIndex !== originalIndex
              ? 'border-t-2 border-nova-accent'
              : ''
          }`}
        >
          <ChatMessage
            message={msg}
            sessionId={activeSession.id}
            isSelectMode={isSelectMode}
            isSelected={selectedIds.has(msg.id)}
            onToggleSelect={toggleSelect}
          />
        </div>
            )
          })}

      {isThisSessionLoading && (
        <div className="flex gap-2.5 animate-fade-in">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 avatar-glow" style={{ background: 'var(--grad-brand)' }}>
            <WaveLogo size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-nova-text-muted font-medium mb-1.5 pl-0.5">
              <span className="font-bold text-nova-text-primary">OurCode AI</span>
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse-soft inline-block" />
            </div>
            {stream?.thinking && <ThinkingBlock content={stream.thinking} defaultExpanded />}
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
