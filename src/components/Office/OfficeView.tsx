import { useEffect, useState } from 'react'
import CompanyPanel from './CompanyPanel'
import OfficeProjectsPanel from './OfficeProjectsPanel'
import OfficeChatPane from './OfficeChatPane'
import { useChatStore } from '@/stores/chatStore'
import { useI18n } from '@/i18n/useI18n'
import { useShallow } from 'zustand/react/shallow'
import { statusBadge } from '@/services/targetMode/targetModeService'
import { getBudgetUsage, refreshBudgetLimit } from '@/services/targetMode/budget'
import { roleLabel } from '@/services/office/mapping'

/** budget.ts 的默认上限（无 budget.md 时的兜底显示）。 */
const DEFAULT_BUDGET_LIMIT = 2_000_000

/**
 * 「一人公司」视图：3D 智能办公室 × 目标模式的合并入口（活动栏左侧图标打开）。
 * 全窗布局 = 顶部工具栏（目标模式 启动/停止 + 状态/预算）+ 左侧「项目/任务」栏
 * + 右上「公司面板」（3D 场景）+ 右下「对话/任务输入」（精简对话）。
 * 目标（goal）在右下对话输入框输入——开启目标模式后占位符自动切换。
 */
export default function OfficeView() {
  const t = useI18n()
  const activeSession = useChatStore((s) => (s.activeSessionId ? s.sessions.find((x) => x.id === s.activeSessionId) ?? null : null))
  const targetMode = activeSession?.targetMode === true
  const targetModeStatus = useChatStore((s) => s.targetModeStatus)
  const [budget, setBudget] = useState<{ used: number; limit: number }>({ used: 0, limit: DEFAULT_BUDGET_LIMIT })
  // 上公司面板 / 下对话 的分割比例（0.2 ~ 0.8）；V6 对话优先：场景 42% / 对话 58%
  const [sceneRatio, setSceneRatio] = useState(0.42)

  // 当前目标模式「在岗角色」友好标签（最新 subagent 活动，running 优先），
  // 仅随标签字符串变化重渲染
  const activeRole = useChatStore(useShallow((s) => {
    const sid = s.activeSessionId
    if (!sid) return ''
    const mine = Object.values(s.subagentProgress).filter((p) => p.sessionId === sid)
    if (mine.length === 0) return ''
    const p = mine.find((x) => x.status === 'running') || mine[mine.length - 1]
    return roleLabel(p.task, p.name)
  }))

  // 目标模式状态/预算：本视图自持 5s 轮询（窗口隐藏时暂停）
  useEffect(() => {
    const refresh = () => {
      if (document.hidden) return
      const s = useChatStore.getState()
      const session = s.sessions.find((x) => x.id === s.activeSessionId)
      if (!session?.targetMode) return
      s.refreshTargetModeStatus()
      const sid = s.activeSessionId
      if (sid) {
        refreshBudgetLimit(sid).then(() => setBudget(getBudgetUsage(sid)))
      }
    }
    refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => window.clearInterval(timer)
  }, [])

  const toggleTargetMode = () => {
    const s = useChatStore.getState()
    const session = s.sessions.find((x) => x.id === s.activeSessionId)
    if (!session) return
    s.setTargetMode(session.id, !session.targetMode)
  }

  // 公司面板 / 对话 上下分割拖拽
  const onSceneResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const resizer = e.target as HTMLElement
    const column = resizer.parentElement
    const topPane = resizer.previousElementSibling as HTMLElement | null
    if (!column || !topPane) return
    const startY = e.clientY
    const startSize = topPane.offsetHeight
    const parentSize = column.offsetHeight
    const handleMove = (ev: MouseEvent) => {
      const ratio = (startSize + (ev.clientY - startY)) / parentSize
      setSceneRatio(Math.max(0.2, Math.min(0.8, ratio)))
    }
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }

  const badge = statusBadge(targetModeStatus)

  return (
    <div id="office3d-root" className="flex flex-col h-full min-h-0">
      {/* 工具栏：一人公司 + 目标模式控制 */}
      <div
        className="flex items-center justify-between shrink-0 px-3 gap-2"
        style={{ height: 40, background: '#ffffff', borderBottom: '1px solid rgba(15, 23, 42, 0.08)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ fontSize: 15 }}>🏢</span>
          <span className="font-bold uppercase tracking-[0.08em] shrink-0" style={{ fontSize: 11, color: '#0f172a', letterSpacing: '0.08em' }}>
            {t('activityBar.office')}
          </span>
          <span className="text-xs shrink-0 truncate" style={{ color: targetMode ? '#334155' : '#94a3b8' }}>
            {targetMode ? t('office.statusDriving') : t('office.statusIdle')}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {targetMode && badge && (
            <span
              className="px-2 py-0.5 rounded-full font-medium shrink-0"
              style={{ fontSize: 11, color: '#0058bc', background: 'rgba(0,88,188,0.08)', border: '1px solid rgba(0,88,188,0.3)' }}
            >
              目标模式 {badge}
            </span>
          )}
          {targetMode && (
            <span className="text-[11px] shrink-0" style={{ color: '#64748b' }}>
              {t('office.budget')}: {(budget.used / 1e6).toFixed(2)}M / {(budget.limit / 1e6).toFixed(2)}M
            </span>
          )}
          {targetMode && activeRole && (
            <span className="text-[11px] shrink-0 truncate max-w-[160px]" style={{ color: '#64748b' }}>
              {t('office.activeRole')}: {activeRole}
            </span>
          )}
          {activeSession ? (
            targetMode ? (
              <button
                onClick={toggleTargetMode}
                className="px-3 py-1 rounded-lg text-xs font-medium shrink-0 transition-opacity hover:opacity-90"
                style={{ color: '#dc2626', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.35)', cursor: 'pointer' }}
                title={t('chat.targetModeHint')}
              >
                {t('office.stopGoal')}
              </button>
            ) : (
              <button
                onClick={toggleTargetMode}
                className="px-3 py-1 rounded-lg text-xs font-semibold shrink-0 transition-opacity hover:opacity-90"
                style={{ color: '#fff', background: '#0058bc', border: 'none', cursor: 'pointer' }}
                title={t('chat.targetModeHint')}
              >
                {t('office.startGoal')}
              </button>
            )
          ) : (
            <button
              className="px-3 py-1 rounded-lg text-xs shrink-0 opacity-50 cursor-not-allowed"
              style={{ color: '#94a3b8', background: '#f1f5f9', border: '1px solid rgba(15,23,42,0.08)' }}
              title={t('office.noActiveSession')}
            >
              {t('office.startGoal')}
            </button>
          )}
        </div>
      </div>

      {/* 主区：左项目/任务栏 + 右（上公司面板 / 下对话） */}
      <div className="flex flex-1 min-h-0">
        <OfficeProjectsPanel />

        <div className="flex-1 flex flex-col min-h-0">
          <div className="relative min-h-0 overflow-hidden" style={{ flex: `0 0 ${sceneRatio * 100}%` }}>
            <CompanyPanel />
          </div>
          <div
            className="h-1 shrink-0 cursor-row-resize transition-colors hover:bg-nova-accent/30"
            style={{ background: 'rgba(15,23,42,0.08)' }}
            onMouseDown={onSceneResize}
          />
          <div className="flex-1 min-h-0 overflow-hidden">
            <OfficeChatPane />
          </div>
        </div>
      </div>
    </div>
  )
}
