import { useChatStore } from '@/stores/chatStore'
import type { ChatBranch } from '@shared/types'

interface BranchTreeModalProps {
  sessionId: string
  onClose: () => void
}

/**
 * Visualizes the conversation as a tree: the main branch is the trunk and each
 * forked branch hangs off the message it was created from. Clicking a branch
 * switches the active view (vs the old flat <select>).
 */
export default function BranchTreeModal({ sessionId, onClose }: BranchTreeModalProps) {
  const session = useChatStore((s) => s.sessions.find((x) => x.id === sessionId))
  const switchBranch = useChatStore((s) => s.switchBranch)

  if (!session) return null

  const activeId = session.activeBranchId || 'main'
  const branches = session.branches ?? []

  // Branch label: derive a readable name (author + message index)
  const branchName = (b: ChatBranch) => b.name || `分支 @${shorten(b.forkedFromMessageId)}`

  // Main trunk: for each main message, which branches fork from it
  const trunk = session.messages.map((msg, index) => ({
    message: msg,
    index,
    forked: branches.filter((b) => b.forkedFromMessageId === msg.id),
  }))

  const roleLabel: Record<string, string> = { user: '用户', assistant: 'AI', tool: '工具' }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="分支对话树"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-nova-surface border border-nova-border rounded-xl shadow-2xl w-[560px] max-h-[70vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-nova-border flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-nova-text-primary">对话分支树</h2>
            <p className="text-xs text-nova-text-muted mt-0.5">
              主分支 {session.messages.length} 条消息 · {branches.length} 个分支
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="p-1.5 text-nova-text-muted hover:text-white hover:bg-nova-hover rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeWidth={2} d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* Main trunk */}
          {trunk.map(({ message, index, forked }) => (
            <div key={message.id}>
              <div className="flex items-center gap-2 py-1">
                <span className="w-4 text-right text-[10px] text-nova-text-muted shrink-0">{index + 1}</span>
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    message.role === 'user' ? 'bg-blue-400' : message.role === 'tool' ? 'bg-amber-400' : 'bg-purple-400'
                  }`}
                />
                <span className="text-[10px] text-nova-text-muted w-8 shrink-0">{roleLabel[message.role] ?? message.role}</span>
                <span className="text-xs text-nova-text-primary truncate">{shorten(message.content, 60)}</span>
                {activeId === 'main' && message.id === (session.messages[index]?.id) && (
                  <span className="text-[10px] text-nova-accent shrink-0 ml-auto">◀ 当前位置</span>
                )}
              </div>

              {/* Forked branches hanging off this message */}
              {forked.length > 0 && (
                <div className="ml-7 border-l-2 border-nova-accent/40 pl-3 my-1 space-y-1">
                  {forked.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => { switchBranch(sessionId, b.id); onClose() }}
                      className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${
                        activeId === b.id
                          ? 'bg-nova-accent/20 border-nova-accent/50 text-white'
                          : 'bg-nova-bg border-nova-border text-nova-text-secondary hover:bg-nova-hover hover:text-white'
                      }`}
                    >
                      <svg className="w-3.5 h-3.5 text-nova-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                        <line x1="6" y1="3" x2="6" y2="15" />
                        <circle cx="18" cy="6" r="3" />
                        <circle cx="6" cy="18" r="3" />
                        <path d="M18 9a9 9 0 0 1-9 9" />
                      </svg>
                      <span className="truncate">{branchName(b)}</span>
                      <span className="ml-auto text-[10px] text-nova-text-muted shrink-0">{b.messages.length} 条</span>
                      {activeId === b.id && <span className="text-nova-accent shrink-0">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {branches.length === 0 && (
            <div className="text-center py-10 text-nova-text-muted text-sm">
              暂无分支。在消息上点击「分支」按钮创建。
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function shorten(text: string, max = 40): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max) + '…' : flat
}
