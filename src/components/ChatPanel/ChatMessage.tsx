import { useState } from 'react'
import { ChatMessage as ChatMessageType } from '@/types'
import { useChatStore } from '@/stores/chatStore'
import { useMemoryStore } from '@/stores/memoryStore'
import { EXHAUSTED_MARKER } from '@shared/constants'
import ThinkingBlock from './ThinkingBlock'
import MarkdownRenderer from '../Common/MarkdownRenderer'
import ToolCallBlock from './ToolCallBlock'
import WaveLogo from './WaveLogo'
import { useI18n } from '@/i18n/useI18n'

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

/** Ghost icon/label button (Windsurf hover action toolbar) */
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
  const [applied, setApplied] = useState(false)
  const [remembered, setRemembered] = useState(false)
  const t = useI18n()

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
      addMemory(`${t('chat.memoryPrefix')}${snippet}`)
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

  // Tool result messages - compact card aligned under the assistant avatar
  if (isTool) {
    return (
      <div className="pl-10 group animate-fade-in">
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
    )
  }

  return (
    <div className={`group animate-fade-in ${isUser ? 'flex justify-end' : 'flex gap-2.5'}`}>
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

      {/* Assistant avatar */}
      {!isUser && (
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ background: 'linear-gradient(135deg, #57A3F8, #3994BC)' }}
        >
          <WaveLogo size={14} />
        </div>
      )}

      {/* Content column */}
      <div className={`min-w-0 ${isUser ? 'max-w-[80%]' : 'flex-1'}`}>
        {/* Bubble — user messages render as a subtle translucent bubble */}
        <div
          className={isUser ? 'px-3.5 py-2 rounded-[12px]' : 'px-0.5'}
          style={isUser ? {
            background: 'var(--bubble-user)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            transition: 'background 0.15s',
          } : undefined}
          onMouseEnter={(e) => {
            if (isUser) e.currentTarget.style.background = 'var(--bubble-user-hover)'
          }}
          onMouseLeave={(e) => {
            if (isUser) e.currentTarget.style.background = 'var(--bubble-user)'
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

        {/* Actions — hover-reveal ghost toolbar (Windsurf style) */}
        {!isEditing && (
          <div className={`flex flex-wrap items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? 'justify-end' : 'justify-start'}`}>
            {isExhausted && (
              <GhostButton onClick={() => continueGeneration()} title={t('chat.continueRun')} accent>
                ▶ {t('chat.continueRun')}
              </GhostButton>
            )}
            {isAssistant && codeBlock && (
              <GhostButton onClick={handleApplyToEditor} title={t('chat.applyToEditorHint')} accent>
                {applied ? t('chat.applied') : t('chat.applyToEditor')}
              </GhostButton>
            )}
            {isAssistant && msgCheckpoints.length > 0 && (
              <GhostButton onClick={handleRevertMessage} title={t('chat.rollbackHint')} danger>
                {t('chat.rollback')}
              </GhostButton>
            )}
            <GhostButton onClick={() => setIsEditing(true)} title={t('chat.editMessage')}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              {t('chat.edit')}
            </GhostButton>
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
      </div>
    </div>
  )
}
