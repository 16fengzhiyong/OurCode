import { useState } from 'react'
import { ChatMessage as ChatMessageType } from '@/types'
import { useChatStore } from '@/stores/chatStore'
import { useMemoryStore } from '@/stores/memoryStore'
import { EXHAUSTED_MARKER } from '@shared/constants'
import ThinkingBlock from './ThinkingBlock'
import MarkdownRenderer from '../Common/MarkdownRenderer'
import ToolCallBlock from './ToolCallBlock'

interface ChatMessageProps {
  message: ChatMessageType
  sessionId: string
  isSelectMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
}

/** Extract the last fenced code block from a message (for "应用到编辑器") */
function extractLastCodeBlock(content: string): string | null {
  const matches = [...content.matchAll(/```[\w-]*\n?([\s\S]*?)```/g)]
  if (matches.length === 0) return null
  return matches[matches.length - 1][1]
}

/** Apply the last code block to the current editor selection */
function applyToEditor(code: string): boolean {
  try {
    const editor = (window as any).__monacoEditor
    if (!editor?.getSelection || !editor?.getModel) return false
    const selection = editor.getSelection()
    if (!selection) return false
    editor.executeEdits('ai-apply', [{ range: selection, text: code }])
    return true
  } catch {
    return false
  }
}

export default function ChatMessage({ message, sessionId, isSelectMode, isSelected, onToggleSelect }: ChatMessageProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)
  const [applied, setApplied] = useState(false)
  const [remembered, setRemembered] = useState(false)

  const { editMessage, regenerateFromMessage, createBranchFromMessage, continueGeneration, checkpoints, revertCheckpoint } = useChatStore()
  const addMemory = useMemoryStore((s) => s.addMemory)

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

  const handleApplyToEditor = () => {
    const code = extractLastCodeBlock(message.content)
    if (code && applyToEditor(code)) setApplied(true)
  }

  const handleRemember = () => {
    const snippet = message.content.trim().slice(0, 500)
    if (snippet) {
      addMemory(`用户偏好/经验: ${snippet}`)
      setRemembered(true)
      setTimeout(() => setRemembered(false), 2000)
    }
  }

  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isTool = message.role === 'tool'
  const isExhausted = isAssistant && message.content.startsWith(EXHAUSTED_MARKER)
  const codeBlock = isAssistant ? extractLastCodeBlock(message.content) : null

  // Checkpoints tied to this assistant message → "回滚修改"
  const msgCheckpoints = checkpoints.filter((c) => c.messageId === message.id)

  const handleRevertMessage = async () => {
    for (const cp of msgCheckpoints) {
      await revertCheckpoint(cp.id)
    }
  }

  // Tool result messages - compact display
  if (isTool) {
    return (
      <div className="flex gap-3 group animate-fade-in">
        <div className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0 bg-nova-badge-bg">
          <span className="text-xs">🔧</span>
        </div>
        <div className="rounded-[18px] px-3.5 py-2.5 max-w-[80%] bg-nova-surface/50 border border-nova-border/50">
          {message.toolResults && message.toolResults.length > 0 && (
            <ToolCallBlock
              toolCalls={message.toolResults.map((r) => ({
                id: r.toolCallId,
                name: r.name,
                arguments: {},
              }))}
              toolResults={message.toolResults}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`flex gap-3 group animate-fade-in ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Batch select checkbox */}
      {isSelectMode && (
        <label className="flex items-start pt-2 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={isSelected || false}
            onChange={() => onToggleSelect?.(message.id)}
            className="w-3.5 h-3.5 accent-nova-accent rounded"
          />
        </label>
      )}
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0"
        style={{
          background: isUser ? '#007acc' : 'linear-gradient(135deg, #533483, #007acc)',
        }}
      >
        {isUser ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5" />
            <path d="M8.5 8.5v.01" />
            <path d="M16 15.5v.01" />
            <path d="M12 12v.01" />
            <path d="M12 16v.01" />
            <path d="M7 14v.01" />
          </svg>
        )}
      </div>

      {/* Bubble */}
      <div
        className="rounded-[18px] px-3.5 py-2.5 max-w-[80%]"
        style={{
          background: isUser ? '#0f3460' : '#16213e',
          border: isUser ? '1px solid rgba(0,122,204,0.3)' : '1px solid rgba(255,255,255,0.08)',
          color: '#d0d0e0',
          borderBottomRightRadius: isUser ? 3 : 18,
          borderBottomLeftRadius: isUser ? 18 : 3,
        }}
      >
        {/* Thinking block */}
        {message.thinking && <ThinkingBlock content={message.thinking} />}

        {/* Tool calls */}
        {isAssistant && message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallBlock
            toolCalls={message.toolCalls}
            toolResults={message.toolResults}
          />
        )}

        {/* Edited indicator */}
        {message.editedAt && (
          <div className="text-[10px] text-text-muted mb-1 italic">已编辑</div>
        )}

        {/* Content */}
        {isEditing ? (
          <div>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full p-2 bg-nova-bg text-text-primary rounded-lg border border-nova-border focus:border-accent-blue focus:outline-none min-h-[80px] font-mono text-sm resize-none"
              rows={3}
            />
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={handleCancelEdit}
                className="px-3 py-1 text-xs bg-nova-hover rounded-lg hover:bg-nova-border transition-colors text-text-secondary"
              >
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                className="px-3 py-1 text-xs bg-accent-btn-primary rounded-lg hover:opacity-90 transition-opacity text-white"
              >
                保存
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

        {/* Actions */}
        {!isEditing && (
          <div className="flex flex-wrap items-center gap-2 mt-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
            {isExhausted && (
              <button
                onClick={() => continueGeneration()}
                className="text-xs text-nova-accent hover:text-white transition-colors flex items-center gap-1 bg-nova-accent/15 px-2 py-0.5 rounded"
              >
                ▶ 继续执行
              </button>
            )}
            {isAssistant && codeBlock && (
              <button
                onClick={handleApplyToEditor}
                className="text-xs text-nova-accent hover:text-white transition-colors flex items-center gap-1 bg-nova-accent/15 px-2 py-0.5 rounded"
              >
                {applied ? '✓ 已应用' : '⤓ 应用到编辑器'}
              </button>
            )}
            {isAssistant && msgCheckpoints.length > 0 && (
              <button
                onClick={handleRevertMessage}
                className="text-xs text-red-400 hover:text-red-300 transition-colors flex items-center gap-1 bg-red-500/10 px-2 py-0.5 rounded"
                title="回滚这条消息产生的文件修改"
              >
                ↩ 回滚修改
              </button>
            )}
            <button
              onClick={() => setIsEditing(true)}
              className="text-xs text-text-muted hover:text-accent-blue transition-colors flex items-center gap-1"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              编辑消息
            </button>
            {isAssistant && (
              <button
                onClick={handleRegenerate}
                className="text-xs text-text-muted hover:text-accent-blue transition-colors flex items-center gap-1"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                重新生成
              </button>
            )}
            {isAssistant && !isExhausted && (
              <button
                onClick={handleRemember}
                className="text-xs text-text-muted hover:text-accent-blue transition-colors flex items-center gap-1"
                title="记住这条回复中的偏好/经验"
              >
                {remembered ? '✓ 已记住' : '🧠 记住'}
              </button>
            )}
            <button
              onClick={() => createBranchFromMessage(sessionId, message.id)}
              className="text-xs text-text-muted hover:text-accent-blue transition-colors flex items-center gap-1"
              title="从此消息创建分支"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
              分支
            </button>
            <button
              onClick={handleCopy}
              className="text-xs text-text-muted hover:text-accent-blue transition-colors"
            >
              复制
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
