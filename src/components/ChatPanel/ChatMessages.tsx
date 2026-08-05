import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useChatStore } from '@/stores/chatStore'
import ChatMessage from './ChatMessage'
import ThinkingBlock from './ThinkingBlock'
import { TodoPanel, PlanCard } from './AgentPanel'

// Common model context windows (in tokens)
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4o': 128000, 'gpt-4o-mini': 128000, 'gpt-4-turbo': 128000, 'gpt-3.5-turbo': 16385,
  'claude-3-opus': 200000, 'claude-3-sonnet': 200000, 'claude-3-haiku': 200000,
  'deepseek-chat': 64000, 'deepseek-coder': 64000, 'gemini-1.5-pro': 2000000, 'gemini-1.5-flash': 1000000,
}

export default function ChatMessages() {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const activeSession = useChatStore((s) => s.getActiveSession())
  const { isLoading, streamingContent, streamingThinking, reorderMessages, undoStack, undoDelete, switchBranch, queuedMessages, clearQueue } = useChatStore()
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [showUndoToast, setShowUndoToast] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isSelectMode, setIsSelectMode] = useState(false)

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

  // Show undo toast when undo stack changes
  useEffect(() => {
    if (undoStack.length > 0) {
      setShowUndoToast(true)
      const timer = setTimeout(() => setShowUndoToast(false), 5000)
      return () => clearTimeout(timer)
    }
  }, [undoStack.length])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeSession?.messages, streamingContent])

  const handleDragStart = useCallback((index: number, e: React.DragEvent) => {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
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
  }, [dragIndex, activeSession, reorderMessages])

  const handleDragEnd = useCallback(() => {
    setDragIndex(null)
    setOverIndex(null)
  }, [])

  if (!activeSession) return null

  const { messages } = activeSession

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
    <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
      {/* Batch select toolbar */}
      {messages.length > 0 && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setIsSelectMode(!isSelectMode); setSelectedIds(new Set()) }}
            className={`px-2 py-1 text-[10px] rounded transition-colors ${isSelectMode ? 'bg-nova-accent/20 text-nova-accent' : 'bg-nova-hover text-nova-text-muted hover:text-nova-text-secondary'}`}
          >
            {isSelectMode ? '取消选择' : '多选'}
          </button>
          {isSelectMode && selectedIds.size > 0 && (
            <>
              <span className="text-[10px] text-nova-text-muted">已选 {selectedIds.size} 条</span>
              <button
                onClick={handleBatchDelete}
                className="px-2 py-1 text-[10px] bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors"
              >
                删除选中
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
            <option value="main">主分支</option>
            {activeSession.branches.filter(b => b.id !== 'main').map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-nova-text-muted">
            共 {activeSession.branches.length} 个分支
          </span>
        </div>
      )}

      {/* Agent todo list + pending plan (Windsurf Cascade-style) */}
      <TodoPanel sessionId={activeSession.id} />
      <PlanCard sessionId={activeSession.id} />

      {/* Queued messages while the agent is working */}
      {queuedMessages.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-nova-accent/10 border border-nova-accent/25 text-xs text-nova-accent">
          <span>⏳ {queuedMessages.length} 条消息已排队，将在当前生成完成后发送</span>
          <button onClick={clearQueue} className="ml-auto hover:text-nova-text-primary transition-colors">取消</button>
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
          <span>上下文窗口已使用 {tokenWarning.percent}% (~{(tokenWarning.totalTokens / 1000).toFixed(1)}K / {(tokenWarning.contextWindow / 1000).toFixed(0)}K tokens)。考虑开始新对话以获得更好的响应质量。</span>
        </div>
      )}

      {messages.length === 0 && !isLoading && (
        <div className="flex gap-3 animate-fade-in">
          <div className="w-8 h-8 bg-nova-badge-bg rounded-[10px] flex items-center justify-center shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7c5cbf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5" />
              <path d="M8.5 8.5v.01" />
              <path d="M16 15.5v.01" />
              <path d="M12 12v.01" />
              <path d="M11 17v.01" />
              <path d="M7 14v.01" />
            </svg>
          </div>
          <div className="rounded-[18px] px-3.5 py-3 max-w-[80%] text-sm leading-relaxed text-nova-text-primary" style={{ background: '#16213e', border: '1px solid rgba(255,255,255,0.08)' }}>
            你好，我是 OurCode 智能体。我可以帮你重构代码、生成单元测试、解释项目、修复 Bug。
            <br /><br />
            你可以使用 <strong className="text-nova-accent">@文件名</strong> 引用项目中的文件作为上下文，
            也可以在编辑器中选中代码后使用右键菜单中的 <strong className="text-nova-accent">AI 操作</strong>。
          </div>
        </div>
      )}

      {messages.map((msg, index) => (
        <div
          key={msg.id}
          draggable
          onDragStart={(e) => handleDragStart(index, e)}
          onDragOver={(e) => handleDragOver(index, e)}
          onDrop={(e) => handleDrop(index, e)}
          onDragEnd={handleDragEnd}
          className={`transition-all ${
            dragIndex === index ? 'opacity-40' : ''
          } ${
            overIndex === index && dragIndex !== null && dragIndex !== index
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
      ))}

      {isLoading && (
        <div className="flex gap-3 animate-fade-in">
          <div className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #533483, #007acc)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" className="animate-pulse">
              <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5" />
            </svg>
          </div>
          <div className="rounded-[18px] px-3.5 py-3 max-w-[80%]" style={{ background: '#16213e', border: '1px solid rgba(255,255,255,0.08)' }}>
            {streamingThinking && <ThinkingBlock content={streamingThinking} />}
            {streamingContent ? (
              <div className="text-sm text-nova-text-primary whitespace-pre-wrap">
                {streamingContent}
                <span className="animate-pulse-dot text-nova-accent">▋</span>
              </div>
            ) : !streamingThinking ? (
              <div className="flex items-center gap-2 text-nova-text-muted text-sm">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full animate-think-bounce" style={{ background: '#6d6d8d' }} />
                  <span className="w-1.5 h-1.5 rounded-full animate-think-bounce" style={{ background: '#6d6d8d', animationDelay: '0.2s' }} />
                  <span className="w-1.5 h-1.5 rounded-full animate-think-bounce" style={{ background: '#6d6d8d', animationDelay: '0.4s' }} />
                </div>
                <span>思考中...</span>
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
            <span className="text-xs text-nova-text-secondary">已删除 {undoStack[undoStack.length - 1].messages.length} 条消息</span>
            <button
              onClick={() => { undoDelete(); setShowUndoToast(false) }}
              className="px-3 py-1 text-xs bg-nova-accent text-white rounded hover:opacity-90 transition-opacity"
            >
              撤销
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
