import ChatMessages from '../ChatPanel/ChatMessages'
import InlineDecisionArea from '../ChatPanel/InlineDecisionArea'
import ChatInput from '../ChatPanel/ChatInput'
import QuestionConfirmBar from '../ChatPanel/QuestionConfirmBar'
import { useChatStore } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'
import { useUIStore } from '@/stores/uiStore'
import { useI18n } from '@/i18n/useI18n'
import { IS_OFFICE } from '@/utils/windowMode'

/**
 * 「一人公司」右下「对话/任务输入」区（V6 对话优先，占主区 58%）：
 * - 目标模式运行中：顶部一条「目标状态条」（当前目标 + 停止按钮）
 * - 精简对话：消息列表 + 内嵌决策区（工具审批/询问吸底）+ 输入框 + 确认条
 * - 目标模式的目标/补充指令直接在输入框输入（开启后占位符自动切换）
 */
export default function OfficeChatPane() {
  const t = useI18n()
  const activeSession = useChatStore((s) => (s.activeSessionId ? s.sessions.find((x) => x.id === s.activeSessionId) ?? null : null))
  const targetMode = activeSession?.targetMode === true

  const openChat = () => {
    // 办公室窗口没有「对话面板」——这里直接创建一个 office 会话（或引导配置），
    // 让目标模式输入框立即可用。
    if (IS_OFFICE) {
      const configId = useConfigStore.getState().activeConfigGroupId
      if (configId) {
        useChatStore.getState().createSession(configId, useUIStore.getState().rootPath || undefined)
        return
      }
      useUIStore.getState().openSettings()
      return
    }
    useUIStore.getState().setActiveSidebarTab('files')
  }

  const stopTargetMode = () => {
    const s = useChatStore.getState()
    const session = s.sessions.find((x) => x.id === s.activeSessionId)
    if (session) s.setTargetMode(session.id, false)
  }

  if (!activeSession) {
    return (
      <div data-testid="office-chat-pane" className="h-full flex items-center justify-center bg-nova-surface">
        <div className="text-center max-w-[280px]">
          <div className="text-sm text-nova-text-muted mb-3">{t('office.noActiveSession')}</div>
          <button
            onClick={openChat}
            className="px-4 py-2 rounded-lg text-xs font-medium text-nova-text-primary bg-nova-hover hover:bg-nova-accent/15 border border-nova-border transition-colors"
          >
            {t('office.openChat')}
          </button>
        </div>
      </div>
    )
  }

  // 当前目标：目标模式下会话的第一条用户消息（即启动时输入的最终目标）
  const goalText = (() => {
    const first = activeSession.messages.find((m) => m.role === 'user')
    const raw = (first?.content || '').replace(/\s+/g, ' ').trim()
    return raw || '—'
  })()

  return (
    <div data-testid="office-chat-pane" className="h-full flex flex-col min-h-0 bg-nova-surface">
      {/* V6：目标状态条 —— 当前目标 + 停止 */}
      {targetMode && (
        <div
          className="shrink-0 px-3 py-2 border-b flex items-center justify-between gap-2"
          style={{ borderColor: 'rgba(15,23,42,0.08)', background: '#ffffff' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] uppercase tracking-widest font-semibold shrink-0" style={{ color: '#64748b' }}>
              {t('office.goalLabel')}
            </span>
            <span className="text-[11.5px] truncate min-w-0" style={{ color: '#0f172a' }}>{goalText}</span>
          </div>
          <button
            onClick={stopTargetMode}
            className="shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-opacity hover:opacity-90"
            style={{ color: '#dc2626', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.35)', cursor: 'pointer' }}
          >
            {t('office.stopGoal')}
          </button>
        </div>
      )}
      <ChatMessages />
      <InlineDecisionArea />
      <ChatInput />
      <QuestionConfirmBar />
    </div>
  )
}
