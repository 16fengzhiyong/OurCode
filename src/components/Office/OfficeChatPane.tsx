import OfficeStream from './OfficeStream'
import InlineDecisionArea from '../ChatPanel/InlineDecisionArea'
import ChatInput from '../ChatPanel/ChatInput'
import QuestionConfirmBar from '../ChatPanel/QuestionConfirmBar'
import { MONO } from './officeTheme'
import { useChatStore } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'
import { useUIStore } from '@/stores/uiStore'
import { useI18n } from '@/i18n/useI18n'
import { statusBadge } from '@/services/targetMode/targetModeService'
import { roleLabel } from '@/services/office/mapping'
import { useThrottledValue } from '@/utils/useThrottledValue'
import { IS_OFFICE } from '@/utils/windowMode'

/**
 * 「一人公司」右下「对话/任务输入」区（V6 对话优先，占主区 58%）：
 * - 目标模式运行中：顶部「目标状态条」（最终目标 + 等宽轮次徽章；停止入口在工具栏）
 *   + 「团队执行中」工位条（运行中的子 Agent 角色实时一览）。
 * - 对话流使用一人公司专用渲染（OfficeStream）：指令 / 汇报 结构，过程收进
 *   可展开的执行明细——与 agent 模式的全量对话区分侧重点。
 * - 目标/补充指令直接在输入框输入（开启后占位符自动切换）；审批/询问决策区吸底。
 */
export default function OfficeChatPane() {
  const t = useI18n()
  const activeSession = useChatStore((s) => (s.activeSessionId ? s.sessions.find((x) => x.id === s.activeSessionId) ?? null : null))
  const targetMode = activeSession?.targetMode === true
  const targetModeStatus = useChatStore((s) => s.targetModeStatus)
  // 进度表逐次推送会高频换引用（思考节流 150ms / 每个工具步骤）；工位条只是
  // 一览，500ms 节流足够，避免整个对话面板跟着每秒重渲染多次。
  const subagentProgress = useThrottledValue(useChatStore((s) => s.subagentProgress), 500)

  // 本会话运行中的子 Agent（团队执行中工位条）；键用父级 run_subagent 的
  // toolCallId（subagentProgress 的原生键，天然唯一）。
  const runningWorkers = activeSession
    ? Object.entries(subagentProgress)
        .filter(([, p]) => p.sessionId === activeSession.id && p.status === 'running')
    : []

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

  if (!activeSession) {
    return (
      <div data-testid="office-chat-pane" className="h-full flex items-center justify-center" style={{ background: MONO.bg }}>
        <div className="text-center max-w-[280px]">
          <div style={{ fontSize: 13, color: MONO.t2, marginBottom: 12 }}>{t('office.noActiveSession')}</div>
          <button
            onClick={openChat}
            className="transition-colors hover:bg-[#F4F4F5]"
            style={{
              padding: '8px 16px', fontSize: 12, fontWeight: 500,
              color: MONO.t1, background: MONO.bg,
              border: `1px solid ${MONO.hairline}`, borderRadius: 4, cursor: 'pointer',
            }}
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

  const badge = statusBadge(targetModeStatus)

  return (
    <div data-testid="office-chat-pane" className="h-full flex flex-col min-h-0" style={{ background: MONO.bg }}>
      {/* V6：目标状态条 —— 最终目标 + 等宽徽章（停止入口在顶部工具栏） */}
      {targetMode && (
        <div
          className="shrink-0 px-5 flex items-center gap-2.5"
          style={{ height: 36, borderBottom: `1px solid ${MONO.hairline}`, background: MONO.bgSubtle }}
        >
          <span
            className="shrink-0"
            style={{
              fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace",
              fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', color: MONO.t3,
            }}
          >
            {t('office.goalLabel')}
          </span>
          <span className="truncate min-w-0 flex-1" style={{ fontSize: 12, color: MONO.t1 }} title={goalText}>
            {goalText}
          </span>
          {badge && (
            <span
              className="shrink-0"
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace",
                fontSize: 11, color: MONO.t1,
                border: `1px solid ${MONO.hairline}`, borderRadius: 999, padding: '3px 10px', lineHeight: 1,
                background: MONO.bg,
              }}
            >
              {badge}
            </span>
          )}
        </div>
      )}

      {/* 团队执行中工位条：运行中的子 Agent 一览（点看板/场景可看全貌） */}
      {runningWorkers.length > 0 && (
        <div
          className="shrink-0 px-5 py-1.5 flex items-center gap-1.5 flex-wrap overflow-hidden"
          style={{ maxHeight: 64, borderBottom: `1px solid ${MONO.hairline}` }}
        >
          <span
            className="shrink-0 mr-1"
            style={{
              fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace",
              fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', color: MONO.t3,
            }}
          >
            {t('office.teamWorking')}
          </span>
          {runningWorkers.map(([toolCallId, p]) => (
            <span
              key={toolCallId}
              className="flex items-center gap-1.5 shrink-0"
              title={p.task}
              style={{
                fontSize: 11, color: MONO.t1,
                border: `1px solid ${MONO.hairline}`, borderRadius: 999, padding: '3px 9px',
                background: MONO.bgSubtle, lineHeight: 1.4,
              }}
            >
              <span className="inline-block rounded-full animate-pulse-soft" style={{ width: 6, height: 6, background: '#22C55E' }} />
              {roleLabel(p.task, p.name)}
              <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace", fontSize: 10, color: MONO.t3 }}>
                {p.toolCallCount}
              </span>
            </span>
          ))}
        </div>
      )}

      <OfficeStream />
      <InlineDecisionArea />
      {/* 一人公司专用按钮文案：派活而非「聊天发送」，运行中显式表达为「终止」 */}
      <ChatInput idleLabelOverride="发布任务" runningLabelOverride="终止任务" />
      <QuestionConfirmBar />
    </div>
  )
}
