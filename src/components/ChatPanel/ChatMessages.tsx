import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useEditorStore } from '@/stores/editorStore'
import ChatMessage from './ChatMessage'
import ThinkingBlock from './ThinkingBlock'
import MarkdownRenderer from '../Common/MarkdownRenderer'
import BranchTreeModal from './BranchTreeModal'
import { TodoPanel, PlanCard } from './AgentPanel'
import WaveLogo from './WaveLogo'
import { useI18n } from '@/i18n/useI18n'

// Common model context windows (in tokens)
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4o': 128000, 'gpt-4o-mini': 128000, 'gpt-4-turbo': 128000, 'gpt-3.5-turbo': 16385,
  'claude-3-opus': 200000, 'claude-3-sonnet': 200000, 'claude-3-haiku': 200000,
  'deepseek-chat': 64000, 'deepseek-coder': 64000, 'gemini-1.5-pro': 2000000, 'gemini-1.5-flash': 1000000,
}

// Suggested prompts shown on the welcome view. The display text
// is localized via its key; the prompt content stays as-is (it goes to the LLM).
const SUGGESTED_PROMPTS: Array<{ icon: string; key: 'chat.suggestExplain' | 'chat.suggestTest' | 'chat.suggestOverview' | 'chat.suggestRefactor'; prompt: string }> = [
  { icon: '✨', key: 'chat.suggestExplain', prompt: '请解释当前文件的功能和关键实现' },
  { icon: '🧪', key: 'chat.suggestTest', prompt: '请为当前文件生成单元测试' },
  { icon: '🔍', key: 'chat.suggestOverview', prompt: '请分析当前项目的结构并给出概览' },
  { icon: '♻️', key: 'chat.suggestRefactor', prompt: '请帮我重构当前代码，提高可读性和可维护性' },
]

export default function ChatMessages() {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const activeSession = useChatStore((s) => s.getActiveSession())
  const { isLoading, streamingContent, streamingThinking, runningSessionId, reorderMessages, undoStack, undoDelete, switchBranch, queuedMessages, clearQueue } = useChatStore()
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
    if (sessionChanged || grew || streamingContent) {
      const el = scrollRef.current
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }, [activeSession, streamingContent])

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
      className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4"
    >
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

      {/* Agent todo & plan cards */}
      <TodoPanel sessionId={activeSession.id} />
      <PlanCard sessionId={activeSession.id} />

      {/* Queued messages while the agent is working */}
      {queuedMessages.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-nova-accent/10 border border-nova-accent/25 text-xs text-nova-accent">
          <span>⏳ {t('chat.queuedBanner', { count: queuedMessages.length })}</span>
          <button onClick={clearQueue} className="ml-auto hover:text-nova-text-primary transition-colors">{t('common.cancel')}</button>
        </div>
      )}

      {/* Context truncation warning */}
      {tokenWarning && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
          tokenWarning.level === 'critical'
            ? 'bg-red-500/10 border border-red-500/30 text-red-400'
            : 'bg-yellow-500/10 border border-yellow-500/30 text-yellow-400'
        }`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span>{t('chat.tokenWarning', {
            percent: tokenWarning.percent,
            used: (tokenWarning.totalTokens / 1000).toFixed(1),
            total: (tokenWarning.contextWindow / 1000).toFixed(0),
          })}</span>
        </div>
      )}

      {messages.length === 0 && !isLoading && (
        <div className="flex-1 flex flex-col">
          {/* Welcome card (design: centered icon + title + description) */}
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4 min-h-0">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: 'var(--grad-avatar)', boxShadow: '0 8px 24px rgba(59,130,246,0.3)' }}
            >
              <WaveLogo size={24} />
            </div>
            <div className="text-base font-semibold text-nova-text-primary">OurCode AI</div>
            <div className="text-xs text-nova-text-muted mt-1.5 max-w-[280px] leading-relaxed">
              {t('chat.welcomeDesc')}
            </div>
          </div>

          {/* Suggested prompts */}
          <div className="pb-2">
            <div className="text-[11px] text-nova-text-muted mb-1.5 px-1">{t('chat.suggested')}</div>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => useChatStore.getState().sendMessage(p.prompt)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-nova-text-secondary bg-nova-card border border-nova-border hover:bg-nova-hover hover:text-nova-text-primary transition-colors"
                >
                  <span>{p.icon}</span>
                  {t(p.key)}
                </button>
              ))}
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


      {isLoading && activeSession?.id === runningSessionId && (
        <div className="flex gap-2.5 animate-fade-in">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: 'var(--grad-brand)' }}>
            <WaveLogo size={14} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-nova-text-muted font-medium mb-1.5 pl-0.5">
              <span>OurCode AI</span>
            </div>
            {streamingThinking && <ThinkingBlock content={streamingThinking} defaultExpanded />}
            {streamingContent ? (
              <div className="text-sm text-nova-text-primary">
                <MarkdownRenderer content={streamingContent} />
                <span className="animate-pulse-dot text-nova-accent">▋</span>
              </div>
            ) : !streamingThinking ? (
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
