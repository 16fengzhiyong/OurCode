import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useI18n } from '@/i18n/useI18n'
import { readStatus, type TargetModeStatus } from '@/services/targetMode/targetModeService'
import { readSupervisorLog, listDeliverables, type LogEntry, type Deliverable } from '@/services/targetMode/dashboardData'
import {
  roleLabel,
  summarizeTask,
  roleGroup,
  ROLE_GROUPS,
  type RoleGroup,
} from '@/services/office/mapping'
import { MONO, CANVAS, GRADIENT, roleAvatar } from './officeTheme'
import { useThrottledValue } from '@/utils/useThrottledValue'
import type { SubAgentProgress } from '@shared/types'

const POLL_INTERVAL = 5000

/** 数据/状态专用等宽字体(时间戳、代号、百分比、状态词)。 */
const MONO_FONT = "'JetBrains Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace"

/** 看板发丝线色(与设计稿 rgba(15,23,42,0.08) 对齐)。 */
const HAIRLINE = 'rgba(15, 23, 42, 0.08)'

/** HH:MM 紧凑时间戳(工作记录 / 汇报条)。 */
function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 运行中任务的真实耗时(mm:ss / h:mm:ss)。 */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 工具参数摘要(工作记录里步骤的可读描述,截断到一行)。 */
function summarizeArgs(args: Record<string, any>): string {
  try {
    const s = JSON.stringify(args ?? {})
    return s.length > 44 ? s.slice(0, 44) + '…' : s
  } catch {
    return ''
  }
}

/** HH:MM(当天) / MM-DD HH:MM(跨天) 文件时间戳(最新交付物)。 */
function fmtFileTime(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (d.toDateString() === new Date().toDateString()) return hhmm
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hhmm}`
}

/**
 * 角色行状态(对齐设计稿 V_K:左侧整条色条 + 右侧中文状态药片 + 悬浮窗角标)。
 * labelKey 走 i18n,渲染处用 t() 解析。
 */
const GROUP_STATUS = {
  working: { dot: '#0058bc', text: '#0058bc', pillBg: 'rgba(0, 88, 188, 0.08)', bar: '#0058bc', labelKey: 'office.statusWorking' },
  completed: { dot: '#16a34a', text: '#16a34a', pillBg: 'rgba(22, 163, 74, 0.08)', bar: 'rgba(22, 163, 74, 0.4)', labelKey: 'office.statusDone' },
  error: { dot: '#dc2626', text: '#dc2626', pillBg: 'rgba(220, 38, 38, 0.08)', bar: '#dc2626', labelKey: 'office.statusError' },
  idle: { dot: '#CBD5E1', text: '#94A3B8', pillBg: 'rgba(148, 163, 184, 0.14)', bar: 'transparent', labelKey: 'office.statusIdle' },
} as const
type GroupStatus = keyof typeof GROUP_STATUS

/** 角色组主色(「AI」徽标描边/字色,与角色章渐变呼应)。 */
const GROUP_ACCENT: Record<RoleGroup, string> = {
  产品: '#7c3aed',
  设计: '#db2777',
  研发: '#0058bc',
  测试: '#059669',
}

/** 工作记录条目(全部来自真实事件:任务开始有真实时间;工具步骤/结束态无时间戳则省略)。 */
interface WorkEntry {
  t: string | null
  kind: 'start' | 'step' | 'done' | 'error'
  title: string
  desc?: string
  meta?: string
}

interface GroupedTask {
  key: string
  p: SubAgentProgress
}

/** 子 Agent 状态排序:运行中在前,其余按启动时间倒序。 */
const rankTask = (s: SubAgentProgress['status']) => (s === 'running' ? 0 : s === 'done' ? 1 : 2)

/**
 * 「一人公司」看板 — 版本 K「融合采纳版」落地。
 *
 * 三栏布局(与设计稿对齐):
 *   栏 1 总任务进度:整体进度条 + 任务分组(进行中/已完成/失败/待办空态)
 *   栏 2 团队状态:产品/设计/研发/测试 四张角色卡(状态点 + 在做什么),
 *        点击角色卡 → 右侧工作记录切换为该角色
 *   栏 3 工作记录 · <角色>:选中角色的时间线(任务开始/工具步骤/结束态 + NOW 实时行)
 *   底部 最新状态:渐变描边汇报条(经营日志最新一条)
 *
 * 数据全部来自真实状态(subagentProgress / implementationStatus.md / supervisor.md),
 * 不造假:进度百分比来自模型自报;工作记录的时间只来自有真实时间戳的事件。
 *
 * 性能三点:
 * - active=false(场景 Tab 被切走 / 面板被收起)时停止文件轮询,回到前台立即刷新;
 * - subagentProgress 订阅走 800ms 节流(高频进度推送逐帧跟会让三栏看板每秒
 *   重渲染多次),监控粒度 1Hz 足以;
 * - 工作记录时间线只渲染最近 60 条(子任务步骤全量可达上千行 DOM,反复重建
 *   会让看板在长任务期间明显卡顿);grid 行高用 minmax(0,1fr) 保证三栏在
 *   内容超高时收缩滚动而不是整体溢出被裁(竖向展示不全)。
 */
export default function CompanyDashboard({ active = true }: { active?: boolean }) {
  const t = useI18n()

  const activeSession = useChatStore((s) =>
    s.activeSessionId ? s.sessions.find((x) => x.id === s.activeSessionId) ?? null : null,
  )
  const sessionId = activeSession?.id || ''
  const rawProgress = useChatStore((s) => s.subagentProgress)
  const subagentProgress = useThrottledValue(rawProgress, 800)

  const [status, setStatus] = useState<TargetModeStatus | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [deliverables, setDeliverables] = useState<Deliverable[]>([])

  const refresh = useCallback(async () => {
    const root = activeSession?.projectPath || ''
    if (!root) return
    const [s, l, d] = await Promise.all([readStatus(root), readSupervisorLog(root), listDeliverables(root)])
    setStatus(s)
    setLog(l)
    setDeliverables(d)
  }, [activeSession?.projectPath])

  useEffect(() => {
    if (!active) return
    refresh()
    const timer = window.setInterval(refresh, POLL_INTERVAL)
    return () => window.clearInterval(timer)
  }, [refresh, active])

  // 项目选择不在此处：项目切换统一走左侧「项目/任务」栏（双击项目/单击任务），
  // 看板只跟随当前激活会话所属的项目展示。
  const currentPath = activeSession?.projectPath ?? null

  // ── 本会话子任务 + 按角色组聚合 ────────────────────────────────────────────
  const sessionTasks = useMemo(
    () => Object.entries(subagentProgress).filter(([, p]) => p.sessionId === sessionId),
    [subagentProgress, sessionId],
  )

  const tasksByGroup = useMemo(() => {
    const map = new Map<RoleGroup, GroupedTask[]>()
    for (const [key, p] of sessionTasks) {
      const g = roleGroup(p.task, p.name)
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push({ key, p })
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => rankTask(a.p.status) - rankTask(b.p.status) || b.p.startedAt - a.p.startedAt)
    }
    return map
  }, [sessionTasks])

  // 默认选中:优先第一个有运行中任务的组,否则「研发」
  const [selectedGroup, setSelectedGroup] = useState<RoleGroup>('研发')
  useEffect(() => {
    const running = ROLE_GROUPS.find((g) => tasksByGroup.get(g)?.some((x) => x.p.status === 'running'))
    if (running) setSelectedGroup(running)
  }, [tasksByGroup])

  // ── 团队状态角色卡悬浮窗 ─────────────────────────────────────────────────
  // 对话里的角色汇报只有一句结论；完整工作内容（任务全文、每一步工具调用与
  // 参数、错误）在悬停/点击角色卡时以悬浮窗呈现。
  const [hoveredGroup, setHoveredGroup] = useState<RoleGroup | null>(null)
  const [hoverAnchor, setHoverAnchor] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  // 卡片 → 悬浮窗之间有微小间隙：离开卡片后延迟 120ms 再关闭，给鼠标跨越间隙
  // 的时间；进入悬浮窗或另一张卡片时取消挂起的关闭。
  const hoverCloseTimer = useRef<number | null>(null)
  const clearHoverClose = () => {
    if (hoverCloseTimer.current != null) {
      window.clearTimeout(hoverCloseTimer.current)
      hoverCloseTimer.current = null
    }
  }
  const scheduleHoverClose = () => {
    clearHoverClose()
    hoverCloseTimer.current = window.setTimeout(() => {
      hoverCloseTimer.current = null
      setHoveredGroup(null)
    }, 120)
  }
  const hoveredTasks = hoveredGroup ? (tasksByGroup.get(hoveredGroup) ?? []) : []

  // ── 角色组聚合状态:「在做什么」取运行中任务,无则按完成/失败/待命回落 ──
  function groupMeta(g: RoleGroup): { status: GroupStatus; doing: string } {
    const tasks = tasksByGroup.get(g) ?? []
    const running = tasks.find((x) => x.p.status === 'running')
    if (running) return { status: 'working', doing: summarizeTask(running.p.task, 30) }
    const failed = tasks.find((x) => x.p.status === 'error' || x.p.status === 'stopped')
    if (failed) return { status: 'error', doing: summarizeTask(failed.p.task, 30) }
    if (tasks.length > 0) return { status: 'completed', doing: '任务已完成' }
    return { status: 'idle', doing: '待命中 · 等待派发任务' }
  }

  // ── 选中角色的工作记录(时间线) ────────────────────────────────────────────
  const workLog = useMemo(() => {
    const tasks = tasksByGroup.get(selectedGroup) ?? []
    const out: WorkEntry[] = []
    for (const { p } of [...tasks].sort((a, b) => a.p.startedAt - b.p.startedAt)) {
      out.push({
        t: fmtTime(p.startedAt),
        kind: 'start',
        title: '开始任务',
        desc: summarizeTask(p.task, 42),
        meta: roleLabel(p.task, p.name),
      })
      for (const step of p.steps) {
        out.push({
          t: null,
          kind: step.status === 'error' ? 'error' : step.status === 'success' ? 'done' : 'step',
          title: step.name,
          desc: summarizeArgs(step.arguments),
          meta: step.status.toUpperCase(),
        })
      }
      if (p.status === 'done') {
        out.push({ t: null, kind: 'done', title: '任务完成', desc: '产出已交回监管 Agent 验收', meta: 'DONE' })
      } else if (p.status === 'error' || p.status === 'stopped') {
        out.push({
          t: null,
          kind: 'error',
          title: p.status === 'stopped' ? '已停止' : '执行异常',
          desc: p.error || '',
          meta: p.status.toUpperCase(),
        })
      }
    }
    // 时间线只保留最近 60 条:子任务步骤全量铺开可达上千行 DOM,看板 ~1Hz
    // 刷新时反复重建(卡顿主因之一);截断只牺牲「更早的过程」,最新进展完整。
    return out.slice(-60)
  }, [tasksByGroup, selectedGroup])

  const runningInGroup = (tasksByGroup.get(selectedGroup) ?? []).find((x) => x.p.status === 'running')

  // ── 汇总指标 ───────────────────────────────────────────────────────────────
  const percent = status?.percent ?? null
  const badgeRound = status?.round != null ? `R${status.round}` : null
  const runningCount = sessionTasks.filter(([, p]) => p.status === 'running').length
  const doneCount = sessionTasks.filter(([, p]) => p.status === 'done').length
  const failedCount = sessionTasks.filter(([, p]) => p.status === 'error' || p.status === 'stopped').length
  const todoCount = sessionTasks.length - runningCount - doneCount - failedCount
  const now = Date.now()

  // ── 最新状态汇报条:经营日志最新一条(真实) ─────────────────────────────────
  const latestLog = log[0] ?? null

  const headerStyle: CSSProperties = {
    padding: '10px 14px',
    borderBottom: `1px solid ${HAIRLINE}`,
    background: 'rgba(250, 250, 252, 0.6)',
  }

  return (
    <div className="h-full min-h-0 flex flex-col" style={{ background: CANVAS }}>
      {/* 顶部:当前项目看板标题（项目选择统一在左侧项目/任务栏进行） */}
      <div className="shrink-0 px-4 pt-3 pb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-[17px] font-bold truncate min-w-0" style={{ color: '#0d1c2d' }}>
            {(currentPath?.split(/[/\\]/).pop() || t('office.currentProject'))}
            <span style={{ color: '#c2c6d5', fontWeight: 400, margin: '0 6px' }}>·</span>
            {t('office.boardTitle')}
          </h1>
        </div>
      </div>

      {/* 三栏看板(对齐设计稿 V_K 的 3:5:4 栏宽——团队状态列表最宽,避免角色行挤压) */}
      <div
        className="flex-1 min-h-0 px-4 pb-2 grid gap-3"
        style={{
          minWidth: 0,
          gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 5fr) minmax(0, 4fr)',
          // 行高必须是可收缩的确定高度(minmax(0,1fr)),不能是默认 auto:
          // auto 行按内容撑高——任一栏内容超高时整行溢出面板,被底部汇报条/
          // 面板裁掉(竖向展示不全),栏内滚动区也因无确定高度而失效。
          gridTemplateRows: 'minmax(0, 1fr)',
        }}
      >
        {/* ── 栏 1:总任务进度 ── */}
        <div className="bg-white rounded-lg border flex flex-col overflow-hidden" style={{ borderColor: HAIRLINE, minWidth: 0 }}>
          <div style={headerStyle}>
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-[13px] font-bold flex items-center gap-1.5" style={{ color: '#0d1c2d' }}>
                <span style={{ fontSize: 15, color: '#0058bc' }}>◧</span>
                {t('office.totalProgress')}
              </h2>
              {badgeRound && (
                <span
                  className="shrink-0"
                  style={{
                    fontFamily: MONO_FONT, fontSize: 10, color: MONO.t2,
                    background: '#F8F9FF', border: `1px solid ${HAIRLINE}`,
                    borderRadius: 4, padding: '1px 7px',
                  }}
                >
                  {badgeRound}
                </span>
              )}
            </div>
            {/* 整体进度条:渐变填充 */}
            <div className="h-2 w-full rounded-full overflow-hidden" style={{ background: '#e5efff' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${percent != null ? Math.min(100, Math.max(0, percent)) : 0}%`,
                  background: GRADIENT.blue,
                }}
              />
            </div>
            <div className="flex justify-between mt-1.5" style={{ fontFamily: MONO_FONT, fontSize: 10.5, color: MONO.t3 }}>
              <span>{percent != null ? `${Math.round(percent)}%` : '—'}</span>
              <span>
                {doneCount}/{sessionTasks.length} {t('office.taskCount')}
              </span>
            </div>
          </div>

          {/* 任务分组:进行中 / 已完成 / 失败 / 待办 */}
          <div className="flex-1 min-h-0 overflow-y-auto p-2.5 flex flex-col gap-2">
            {sessionTasks.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-center px-4" style={{ fontSize: 12, color: MONO.t3 }}>
                {t('office.noTasks')}
              </div>
            )}
            {sessionTasks
              .slice()
              .sort((a, b) => rankTask(a[1].status) - rankTask(b[1].status) || b[1].startedAt - a[1].startedAt)
              .map(([key, p]) => {
                const tm = p.status === 'done' ? { color: '#16a34a' } : p.status === 'error' || p.status === 'stopped' ? { color: '#dc2626' } : { color: '#0058bc' }
                return (
                  <div
                    key={key}
                    className="flex items-start gap-2.5 p-2 rounded-md border"
                    style={{
                      borderColor: p.status === 'running' ? 'rgba(0,88,188,0.2)' : HAIRLINE,
                      background: p.status === 'running' ? 'rgba(232,240,255,0.25)' : '#FBFBFC',
                      position: 'relative',
                    }}
                    title={p.status === 'running' ? `${t('office.toolCalls')}: ${p.toolCallCount}` : p.error || undefined}
                  >
                    {p.status === 'running' && (
                      <span
                        className="absolute left-0 top-0 bottom-0 rounded-l-md"
                        style={{ width: 3, background: '#0058bc' }}
                      />
                    )}
                    {/* 状态指示:运行中彩虹环旋转 / 完成绿勾 / 失败红叉 */}
                    {p.status === 'running' ? (
                      <span
                        className="shrink-0 rounded-full animate-spin"
                        style={{
                          width: 15, height: 15, padding: 2, marginTop: 1,
                          background: GRADIENT.rainbow,
                          animationDuration: '2s',
                        }}
                      >
                        <span className="block w-full h-full rounded-full" style={{ background: '#fff' }} />
                      </span>
                    ) : p.status === 'done' ? (
                      <span
                        className="shrink-0 rounded-full flex items-center justify-center mt-0.5"
                        style={{ width: 15, height: 15, border: '1.5px solid #16a34a', color: '#16a34a', fontSize: 10, fontWeight: 700, background: 'rgba(22,163,74,0.08)' }}
                      >
                        ✓
                      </span>
                    ) : (
                      <span
                        className="shrink-0 rounded-full flex items-center justify-center mt-0.5"
                        style={{ width: 15, height: 15, border: '1.5px solid #dc2626', color: '#dc2626', fontSize: 10, fontWeight: 700, background: 'rgba(220,38,38,0.06)' }}
                      >
                        ✕
                      </span>
                    )}
                    <div className="flex flex-col flex-1 min-w-0">
                      <span
                        className="truncate"
                        style={{
                          fontSize: 12.5, fontWeight: 500, color: '#0d1c2d',
                          textDecoration: p.status === 'done' ? 'line-through' : undefined,
                          opacity: p.status === 'done' ? 0.55 : 1,
                        }}
                      >
                        {summarizeTask(p.task, 34)}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 min-w-0">
                        <span
                          className="shrink-0 rounded flex items-center justify-center"
                          style={{
                            width: 16, height: 16, borderRadius: 999,
                            background: roleAvatar(roleLabel(p.task, p.name)).bg,
                            color: '#fff', fontSize: 9, fontWeight: 700,
                          }}
                        >
                          {roleAvatar(roleLabel(p.task, p.name)).char}
                        </span>
                        <span className="truncate" style={{ fontFamily: MONO_FONT, fontSize: 9.5, color: MONO.t3 }}>
                          {roleLabel(p.task, p.name)}
                        </span>
                        <span className="shrink-0 ml-auto" style={{ fontFamily: MONO_FONT, fontSize: 9.5, color: tm.color, fontWeight: 600 }}>
                          {p.status === 'running'
                            ? `RUNNING ${formatDuration(now - p.startedAt)}`
                            : p.status === 'done' ? 'DONE' : 'FAILED'}
                        </span>
                      </span>
                    </div>
                  </div>
                )
              })}
            {/* 待办:暂无真实待办队列,虚线空态提示 */}
            {todoCount === 0 && sessionTasks.length > 0 && (
              <div
                className="rounded-md border border-dashed flex items-center justify-center px-3 py-2"
                style={{ borderColor: HAIRLINE, fontSize: 11, color: MONO.t3 }}
              >
                {t('office.noTodo')}
              </div>
            )}
          </div>
        </div>

        {/* ── 栏 2:团队状态(角色卡) ── */}
        <div className="bg-white rounded-lg border flex flex-col overflow-hidden" style={{ borderColor: HAIRLINE, minWidth: 0 }}>
          <div style={headerStyle}>
            <h2 className="text-[13px] font-bold flex items-center gap-1.5" style={{ color: '#0d1c2d' }}>
              <span style={{ fontSize: 15, color: MONO.t2 }}>◈</span>
              {t('office.teamStatus')}
            </h2>
          </div>
          {/* 角色列表:单列纵向行(对齐设计稿 V_K)——左侧状态色条 + 渐变角色章
              + 「AI」徽标 + 在做什么 + 右侧中文状态药片;点击切换右侧工作记录 */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-2" style={{ background: 'rgba(15,23,42,0.02)' }}>
            {ROLE_GROUPS.map((g) => {
              const meta = groupMeta(g)
              const st = GROUP_STATUS[meta.status]
              const selected = g === selectedGroup
              const avatar = roleAvatar(g)
              const working = meta.status === 'working'
              return (
                <button
                  key={g}
                  onClick={() => setSelectedGroup(g)}
                  onMouseEnter={(e) => {
                    clearHoverClose()
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    setHoverAnchor({ top: rect.bottom + 6, left: rect.left })
                    setHoveredGroup(g)
                  }}
                  onMouseLeave={scheduleHoverClose}
                  className="flex items-center gap-2.5 text-left transition-colors relative overflow-hidden"
                  style={{
                    padding: '10px 12px 10px 14px',
                    borderRadius: 8,
                    background: '#fff',
                    border: selected ? `1.5px solid #0058bc` : `1px solid ${HAIRLINE}`,
                    boxShadow: working ? '0 1px 3px rgba(15, 23, 42, 0.08)' : undefined,
                    cursor: 'pointer',
                  }}
                  title={`${t('office.viewWorkLog')}: ${g}`}
                >
                  {/* 左侧整条状态色条 */}
                  <span className="absolute" style={{ left: 0, top: 0, bottom: 0, width: 3, background: st.bar }} />
                  {/* 渐变角色章;运行中外套彩虹旋转环 */}
                  <span className="relative shrink-0" style={{ width: 28, height: 28 }}>
                    {working && (
                      <span
                        className="absolute"
                        style={{ inset: -2.5, borderRadius: 9, background: GRADIENT.rainbow, animation: 'spinRing 2.4s linear infinite' }}
                      />
                    )}
                    <span
                      className="absolute flex items-center justify-center"
                      style={{ inset: 0, borderRadius: 7, background: avatar.bg, color: '#fff', fontSize: 11, fontWeight: 700 }}
                    >
                      {avatar.char}
                    </span>
                  </span>
                  {/* 名称 + AI 徽标 + 在做什么 */}
                  <span className="flex-1 min-w-0 flex flex-col" style={{ gap: 3 }}>
                    <span className="flex items-center min-w-0" style={{ gap: 6 }}>
                      <span className="truncate text-[12.5px] font-bold" style={{ color: selected ? '#0058bc' : '#0d1c2d' }}>
                        {g}
                      </span>
                      <span
                        className="shrink-0"
                        style={{
                          fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', lineHeight: 1.5,
                          padding: '0 5px', borderRadius: 4,
                          border: `1px solid ${GROUP_ACCENT[g]}`, color: GROUP_ACCENT[g],
                        }}
                      >
                        AI
                      </span>
                    </span>
                    {/* 「在做什么」最多两行:单行 nowrap 截断在窄栏下只剩几个字,
                        看着像文字被挤掉(竖向展示不全);两行 + title 兜底完整文案 */}
                    <span className="line-clamp-2" style={{ fontSize: 11, color: MONO.t2, lineHeight: 1.5 }} title={meta.doing}>
                      {meta.doing}
                    </span>
                  </span>
                  {/* 右侧状态药片(浅底色 + 状态点 + 中文状态词),不随名称挤压换行 */}
                  <span
                    className="shrink-0 flex items-center rounded-full"
                    style={{ gap: 5, padding: '3px 9px', background: st.pillBg, whiteSpace: 'nowrap' }}
                  >
                    <span
                      className="inline-block rounded-full"
                      style={{
                        width: 6, height: 6, background: st.dot,
                        animation: working ? 'pulseSoft 1.6s ease-in-out infinite' : undefined,
                      }}
                    />
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: st.text, lineHeight: 1.4 }}>
                      {t(st.labelKey)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          {/* 最新交付物(agents/*.md 按修改时间倒序,仅真实文件,不造假) */}
          <div className="shrink-0 border-t" style={{ borderColor: HAIRLINE, background: '#fff' }}>
            <div className="flex items-center px-3.5 pt-2.5 pb-1.5">
              <span className="text-[11px] font-bold flex items-center gap-1.5" style={{ color: MONO.t2 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                {t('office.latestDeliverables')}
              </span>
            </div>
            {deliverables.length === 0 ? (
              <div className="px-3.5 pb-3" style={{ fontSize: 10.5, color: MONO.t3 }}>
                {t('office.noDeliverables')}
              </div>
            ) : (
              <div className="px-2 pb-2 flex flex-col">
                {deliverables.slice(0, 5).map((d) => (
                  <div
                    key={d.path}
                    className="flex items-center gap-2 px-1.5 py-1 rounded-md"
                    title={d.path}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={MONO.t3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span className="flex-1 min-w-0 truncate" style={{ fontSize: 11, color: '#424753' }}>
                      {d.name}
                    </span>
                    {d.modifiedAt != null && (
                      <span className="shrink-0" style={{ fontFamily: MONO_FONT, fontSize: 10, color: MONO.t3 }}>
                        {fmtFileTime(d.modifiedAt)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── 栏 3:工作记录 · <选中角色> ── */}
        <div className="bg-white rounded-lg border flex flex-col overflow-hidden relative" style={{ borderColor: HAIRLINE, minWidth: 0 }}>
          <div style={headerStyle}>
            <h2 className="text-[13px] font-bold flex items-center gap-1.5" style={{ color: '#0d1c2d' }}>
              <span style={{ fontSize: 15, color: MONO.t2 }}>◷</span>
              {t('office.workLog')}
              <span style={{ color: '#c2c6d5', fontWeight: 400, margin: '0 2px' }}>·</span>
              {selectedGroup}
            </h2>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 relative">
            {/* 时间线竖线 */}
            <div
              className="absolute"
              style={{ left: 31, top: 16, bottom: 16, width: 1, background: 'rgba(15,23,42,0.08)' }}
            />
            <div className="flex flex-col gap-4 relative">
              {workLog.length === 0 && !runningInGroup && (
                <div className="text-center py-8" style={{ fontSize: 12, color: MONO.t3 }}>
                  {t('office.noWorkLog')}
                </div>
              )}
              {workLog.map((e, i) => {
                const dotColor =
                  e.kind === 'done' ? '#16a34a' : e.kind === 'error' ? '#dc2626' : e.kind === 'start' ? '#0058bc' : '#c2c6d5'
                const titleColor = e.kind === 'error' ? '#dc2626' : '#0d1c2d'
                return (
                  <div key={i} className="flex gap-3">
                    <div className="w-7 text-right shrink-0 pt-0.5">
                      <span style={{ fontFamily: MONO_FONT, fontSize: 10, color: MONO.t3 }}>{e.t ?? ''}</span>
                    </div>
                    <span
                      className="shrink-0 rounded-full mt-1"
                      style={{ width: 10, height: 10, background: '#fff', border: `3px solid ${dotColor}`, zIndex: 1 }}
                    />
                    <div className="flex-1 min-w-0 pb-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate text-[12.5px]" style={{ color: titleColor, fontWeight: e.kind === 'start' ? 500 : 400 }}>
                          {e.title}
                        </span>
                        {e.meta && (
                          <span className="shrink-0" style={{ fontFamily: MONO_FONT, fontSize: 9, color: MONO.t3 }}>
                            {e.meta}
                          </span>
                        )}
                      </div>
                      {e.desc && (
                        <div
                          className="truncate mt-0.5"
                          style={{
                            fontFamily: e.kind === 'step' ? MONO_FONT : undefined,
                            fontSize: e.kind === 'step' ? 10.5 : 11,
                            color: e.kind === 'step' ? '#64748b' : MONO.t2,
                          }}
                        >
                          {e.desc}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              {/* NOW 实时行:选中组有运行中任务时 */}
              {runningInGroup && (
                <div className="flex gap-3">
                  <div className="w-7 text-right shrink-0 pt-0.5">
                    <span style={{ fontFamily: MONO_FONT, fontSize: 10, fontWeight: 700, color: '#0058bc' }}>
                      {t('office.nowLabel')}
                    </span>
                  </div>
                  <span
                    className="shrink-0 rounded-full animate-spin"
                    style={{
                      width: 14, height: 14, padding: 2, marginTop: 0,
                      background: GRADIENT.rainbow, animationDuration: '2s', zIndex: 1,
                    }}
                  >
                    <span className="block w-full h-full rounded-full" style={{ background: '#fff' }} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12.5px] font-medium" style={{ color: '#0058bc' }}>
                        {t('office.workInProgress')}
                      </span>
                      <span
                        className="shrink-0"
                        style={{
                          fontFamily: MONO_FONT, fontSize: 9.5, fontWeight: 600, color: '#0058bc',
                          background: '#e8f0ff', borderRadius: 4, padding: '1px 7px',
                        }}
                      >
                        RUNNING {formatDuration(now - runningInGroup.p.startedAt)}
                      </span>
                    </div>
                    <div className="w-full h-1 rounded-full mt-2 overflow-hidden" style={{ background: '#e5efff' }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, Math.max(8, Math.round((runningInGroup.p.toolCallCount / 8) * 60 + 20)))}%`,
                          background: '#0058bc',
                          animation: 'pulseSoft 1.6s ease-in-out infinite',
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 底部:最新状态汇报条(渐变描边) */}
      <div className="shrink-0 px-4 pb-3">
        <div
          className="h-10 rounded-lg flex items-center px-4 justify-between gap-3"
          style={{
            background: 'linear-gradient(white, white) padding-box, linear-gradient(90deg, #0058bc, #8b5cf6, #ec4899) border-box',
            border: '1px solid transparent',
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span style={{ color: '#0058bc', fontSize: 14 }}>◉</span>
            <span className="shrink-0 text-[12.5px] font-bold" style={{ color: '#0d1c2d' }}>
              {t('office.latestStatus')}:
            </span>
            <span className="truncate text-[12.5px]" style={{ color: '#424753' }}>
              {latestLog ? latestLog.text : t('office.noLog')}
            </span>
          </div>
          {latestLog && (
            <span className="shrink-0" style={{ fontFamily: MONO_FONT, fontSize: 10.5, color: MONO.t3 }}>
              {latestLog.time}
            </span>
          )}
        </div>
      </div>

      {/* 团队状态角色卡悬浮窗：完整工作内容（任务全文 + 工具步骤 + 错误）。
          固定定位贴卡片下方，鼠标离开卡片即消失；越界时向上翻。 */}
      {hoveredGroup && (
        <div
          onMouseEnter={clearHoverClose}
          onMouseLeave={scheduleHoverClose}
          className="fixed z-[70] rounded-xl border shadow-xl"
          style={{
            top: Math.min(hoverAnchor.top, window.innerHeight - 420),
            left: hoverAnchor.left,
            width: 340,
            maxHeight: 400,
            overflowY: 'auto',
            background: '#fff',
            borderColor: HAIRLINE,
            boxShadow: '0 12px 40px rgba(15,23,42,0.16)',
          }}
        >
          <div className="sticky top-0 flex items-center justify-between px-3.5 py-2.5 border-b" style={{ borderColor: HAIRLINE, background: '#FAFAFC' }}>
            <span className="text-[12.5px] font-bold" style={{ color: '#0d1c2d' }}>{hoveredGroup} · 工作内容</span>
            <span
              className="rounded-full"
              style={{
                fontSize: 10, fontWeight: 600, padding: '2px 8px',
                color: GROUP_STATUS[groupMeta(hoveredGroup).status].text,
                background: GROUP_STATUS[groupMeta(hoveredGroup).status].pillBg,
              }}
            >
              {t(GROUP_STATUS[groupMeta(hoveredGroup).status].labelKey)}
            </span>
          </div>
          {hoveredTasks.length === 0 && (
            <div className="px-3.5 py-6 text-center" style={{ fontSize: 11.5, color: MONO.t3 }}>
              {t('office.noWorkLog')}
            </div>
          )}
          {hoveredTasks.map(({ key, p }) => (
            <div key={key} className="px-3.5 py-3 border-b last:border-b-0" style={{ borderColor: HAIRLINE }}>
              <div className="flex items-start gap-2">
                <span
                  className="shrink-0 rounded-full flex items-center justify-center mt-0.5"
                  style={{ width: 16, height: 16, background: roleAvatar(roleLabel(p.task, p.name)).bg, color: '#fff', fontSize: 8.5, fontWeight: 700 }}
                >
                  {roleAvatar(roleLabel(p.task, p.name)).char}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-semibold" style={{ color: '#0d1c2d' }}>{roleLabel(p.task, p.name)}</span>
                    <span
                      className="shrink-0"
                      style={{
                        fontFamily: MONO_FONT, fontSize: 9, fontWeight: 600,
                        color: p.status === 'running' ? '#0058bc' : p.status === 'done' ? '#16a34a' : '#dc2626',
                      }}
                    >
                      {p.status === 'running' ? 'RUNNING' : p.status === 'done' ? 'DONE' : 'FAILED'}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11.5px] leading-relaxed break-words" style={{ color: '#424753' }}>
                    {summarizeTask(p.task, 240)}
                  </div>
                  {p.steps.length > 0 && (
                    <div className="mt-1.5 flex flex-col gap-1">
                      {p.steps.map((st) => (
                        <div key={st.id} className="flex items-start gap-1.5">
                          <span
                            className="shrink-0 mt-[3px] rounded-full"
                            style={{
                              width: 5, height: 5,
                              background: st.status === 'success' ? '#16a34a' : st.status === 'error' ? '#dc2626' : '#0058bc',
                            }}
                          />
                          <div className="min-w-0 flex-1" style={{ fontFamily: MONO_FONT, fontSize: 10, color: '#64748b' }}>
                            <span style={{ color: '#334155', fontWeight: 500 }}>{st.name}</span>
                            <span className="block truncate" title={summarizeArgs(st.arguments)}>{summarizeArgs(st.arguments)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {p.error && (
                    <div className="mt-1 text-[10.5px] leading-relaxed break-words" style={{ color: '#dc2626' }}>{p.error}</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
