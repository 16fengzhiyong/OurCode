/**
 * 3D 办公室 × 目标模式：桥接层（渲染进程，直接驱动场景，无 iframe）。
 *
 * 职责：把 chatStore 里的真实状态（目标模式子 Agent 进度 / 主循环相位 / 会话模式）
 * 映射为对 3D 场景的直接调用（见 OfficeDriver）。仅在目标模式会话为当前活动会话时
 * 驱动，否则复位场景。
 *
 * 设计要点：
 * - 子 Agent 进度以父 toolCallId 为键、非顺序事件流 → 用前后快照 diff 检测
 *   「启动 / 状态迁移 / 结束」，自行维护 生命周期 → 工位槽位 的分配表。
 * - 状态/交接类调用立即应用；任务/进度类更新走 200ms 合并，避免高频刷新打爆
 *   React 渲染。
 * - 纯逻辑映射见 ./mapping.ts（可单测）。
 */
import { useChatStore } from '@/stores/chatStore'
import type { AgentRunPhase, OfficeAgentState, OfficeLog, OfficeStatus, SubAgentProgress } from '@shared/types'
import {
  buildInitialOfficeAgents,
  assignSlot,
  envelopeRole,
  estimateProgress,
  summarizeTask,
  subagentStatusToOffice,
} from './mapping'

const MERGE_INTERVAL = 200 // 任务/进度合并窗口（ms）
const RECEIVE_POSE_MS = 1500 // 交接飞递时长内保持 receiving 姿态
const COMPLETED_HOLD_MS = 3000 // completed 展示时长后释放槽位
const ERROR_HOLD_MS = 5000

/** 场景驱动接口：由 OfficeView 实现（既驱动 3D 场景，也同步 React 状态）。 */
export interface OfficeDriver {
  applyInit(agents: OfficeAgentState[]): void
  applyStatus(id: number, status: OfficeStatus): void
  applyTask(id: number, task: string, progress: number, logs?: OfficeLog[]): void
  /** 从 from 向 to 飞递任务文件；落桌后调用 onComplete（from 已由宿主复位为 idle） */
  applyTransfer(fromId: number, toId: number, onComplete: () => void): void
  applyReset(): void
}

let driver: OfficeDriver | null = null
let unsubscribe: (() => void) | null = null

// 桥接内部状态（8 槽当前可视化状态 + 分配表）
const slots: OfficeAgentState[] = buildInitialOfficeAgents()
const occupied = new Set<number>()
const assignments = new Map<string, number>() // toolCallId → slot
const progressSnapshot = new Map<string, SubAgentProgress>()
let modeSnapshot = { sessionId: null as string | null, targetMode: false }
// 1 号总监（监管 Agent）状态：主循环运行相位映射 + 交接动画忙碌保护
let supervisorBusy = false
let supervisorTaskSet = false

// 任务/进度合并队列
let pending: Array<() => void> = []
let flushTimer: number | null = null

function now(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

/** 立即应用（状态/交接类，需要即时生效）。 */
function applyNow(fn: () => void): void {
  if (driver) fn()
}

/** 合并应用（任务/进度类，节流到 200ms 一并执行）。 */
function applyMerged(fn: () => void): void {
  if (!driver) return
  pending.push(fn)
  if (flushTimer == null) flushTimer = window.setTimeout(flushMerged, MERGE_INTERVAL)
}

function flushMerged(): void {
  flushTimer = null
  if (!driver) {
    pending = []
    return
  }
  const batch = pending
  pending = []
  for (const fn of batch) fn()
}

function setSlotStatus(slot: number, status: OfficeStatus): void {
  const s = slots.find((x) => x.id === slot)
  if (!s) return
  s.status = status
  applyNow(() => driver!.applyStatus(slot, status))
}

function setSlotTask(slot: number, task: string, progress: number, logs?: OfficeLog[]): void {
  const s = slots.find((x) => x.id === slot)
  if (!s) return
  s.task = task
  s.progress = progress
  applyMerged(() => driver!.applyTask(slot, task, progress, logs))
}

/**
 * 交接飞递落桌后切换到真实工作姿态。必须延迟执行——但若在这段延迟里子 Agent
 * 已经结束（completed/error 已下发），就不能再用 working 覆盖终态。
 */
function scheduleRealStatus(key: string, slot: number, status: OfficeStatus, delay: number): void {
  window.setTimeout(() => {
    if (assignments.get(key) !== slot) return
    const cur = progressSnapshot.get(key)
    if (!cur || cur.status !== 'running') return
    setSlotStatus(slot, status)
  }, delay)
}

/** 标记 1 号总监处于交接动画中：期间不派发其他指令，避免打断飞递。 */
function markSupervisorBusy(): void {
  supervisorBusy = true
  window.setTimeout(() => {
    supervisorBusy = false
  }, 3000) // 兜底：即使 onComplete 丢失也不会永久阻塞
}

function releaseSlot(key: string, slot: number, delay: number): void {
  window.setTimeout(() => {
    assignments.delete(key)
    progressSnapshot.delete(key)
    occupied.delete(slot)
    setSlotStatus(slot, 'idle')
  }, delay)
}

// ───────────────────────── 子 Agent 生命周期处理 ─────────────────────────

function onSubagentStart(key: string, p: SubAgentProgress): void {
  const role = envelopeRole(p.task) || p.name
  const slot = assignSlot(role, occupied) ?? firstFreeSlot()
  if (slot == null) return // 8 个槽全忙：本次派发不进场景（走聊天进度即可）
  assignments.set(key, slot)
  occupied.add(slot)

  const task = summarizeTask(p.task)
  const progress = estimateProgress(p)
  const realStatus: OfficeStatus = p.steps.length > 0 ? 'working' : 'thinking'

  setSlotTask(slot, task, progress, [
    { t: now(), k: 'receiving', title: '接收任务', desc: `来自监管 Agent 的派发（${role}）` },
  ])
  // 监管(1) → 执行者：3D 抛物线交接
  markSupervisorBusy()
  applyNow(() => driver!.applyTransfer(1, slot, () => { supervisorBusy = false }))
  setSlotStatus(slot, 'receiving')
  // 飞递落桌后进入真实工作姿态（若期间已结束则不覆盖终态）
  scheduleRealStatus(key, slot, realStatus, RECEIVE_POSE_MS)
}

function onSubagentUpdate(key: string, p: SubAgentProgress, prev: SubAgentProgress): void {
  const slot = assignments.get(key)
  if (slot == null) {
    // 桥接挂载时已存在的进度（attach 时按新启动处理），或已释放后的幽灵更新
    if (!progressSnapshot.has(key) || p.status !== prev.status) onSubagentStart(key, p)
    return
  }

  if (p.task !== prev.task) {
    setSlotTask(slot, summarizeTask(p.task), estimateProgress(p))
  }

  if (p.status === prev.status) {
    // 运行中：步数变化 → 进度条推进（限频由合并队列保证）
    if (p.status === 'running' && p.toolCallCount !== prev.toolCallCount) {
      setSlotTask(slot, summarizeTask(p.task), estimateProgress(p))
    }
    return
  }

  if (p.status === 'done') {
    setSlotStatus(slot, 'completed')
    setSlotTask(slot, summarizeTask(p.task), 100, [
      { t: now(), k: 'completed', title: '任务完成', desc: '产出已交回监管 Agent 验收' },
    ])
    markSupervisorBusy()
    applyNow(() => driver!.applyTransfer(slot, 1, () => { supervisorBusy = false }))
    releaseSlot(key, slot, COMPLETED_HOLD_MS)
  } else if (p.status === 'error' || p.status === 'stopped') {
    setSlotStatus(slot, 'error')
    setSlotTask(slot, summarizeTask(p.task), 100, [
      { t: now(), k: 'error', title: p.status === 'stopped' ? '已停止' : '执行异常', desc: p.error || '子 Agent 异常结束' },
    ])
    releaseSlot(key, slot, ERROR_HOLD_MS)
  } else {
    // running（从完成态被重置等少见情况）
    setSlotStatus(slot, subagentStatusToOffice(p.status))
  }
}

function firstFreeSlot(): number | null {
  for (let id = 4; id <= 8; id++) if (!occupied.has(id)) return id
  return null
}

// ───────────────────────── 快照 diff ─────────────────────────

interface ModeSnapshot {
  sessionId: string | null
  targetMode: boolean
}

function currentMode(): ModeSnapshot {
  const s = useChatStore.getState()
  const session = s.sessions.find((x) => x.id === s.activeSessionId)
  return { sessionId: s.activeSessionId, targetMode: !!(session && session.targetMode) }
}

/**
 * 主循环（监管 Agent）运行相位 → 1 号总监工位。
 * preparing/compacting/waiting = 准备/思考，streaming = 输出工作；run 结束回 idle。
 */
function syncSupervisor(phaseEntry: { phase: AgentRunPhase; since?: number; detail?: string } | undefined): void {
  const slot1 = slots.find((x) => x.id === 1)
  if (!slot1) return
  if (supervisorBusy) return // 交接动画期间不打断

  if (!phaseEntry) {
    supervisorTaskSet = false
    if (slot1.status === 'working' || slot1.status === 'thinking' || slot1.status === 'receiving') {
      setSlotStatus(1, 'idle')
    }
    return
  }

  const target: OfficeStatus = phaseEntry.phase === 'streaming' ? 'working' : 'thinking'
  if (slot1.status !== target) setSlotStatus(1, target)
  if (!supervisorTaskSet) {
    supervisorTaskSet = true
    const detail = phaseEntry.detail ? ` · ${phaseEntry.detail}` : ''
    setSlotTask(1, `监管 Agent 调度中：${phaseEntry.phase}${detail}`, 30)
  }
}

function handleStoreChange(): void {
  const cur = currentMode()
  const prev = modeSnapshot
  modeSnapshot = cur

  // 会话/模式切换 → 复位场景
  if (cur.sessionId !== prev.sessionId || cur.targetMode !== prev.targetMode) {
    resetInternal()
    if (!cur.targetMode) {
      applyNow(() => driver!.applyReset())
      return
    }
    applyNow(() => driver!.applyInit(snapshotAgents()))
  }
  if (!cur.targetMode) return

  // 主循环（监管 Agent）运行相位 → 1 号总监工位
  const phaseEntry = cur.sessionId ? useChatStore.getState().runPhaseBySession[cur.sessionId] : undefined
  syncSupervisor(phaseEntry)

  // 子 Agent 进度 diff
  const entries = useChatStore.getState().subagentProgress
  for (const [key, p] of Object.entries(entries)) {
    const prevP = progressSnapshot.get(key)
    if (!prevP) {
      onSubagentStart(key, p)
    } else if (p !== prevP) {
      onSubagentUpdate(key, p, prevP)
    }
  }
  // 记录本次快照
  progressSnapshot.clear()
  for (const [key, p] of Object.entries(entries)) progressSnapshot.set(key, p)
}

function snapshotAgents(): OfficeAgentState[] {
  return slots.map((s) => ({ ...s, logs: s.logs.slice(-20) }))
}

function resetInternal(): void {
  if (flushTimer != null) {
    window.clearTimeout(flushTimer)
    flushTimer = null
  }
  pending = []
  assignments.clear()
  progressSnapshot.clear()
  occupied.clear()
  supervisorBusy = false
  supervisorTaskSet = false
  const fresh = buildInitialOfficeAgents()
  slots.length = 0
  slots.push(...fresh)
}

// ───────────────────────── 对外 API ─────────────────────────

/** OfficeView 挂载时调用：绑定驱动、订阅 chatStore、初始化场景状态。 */
export function attachOfficeBridge(driverImpl: OfficeDriver): void {
  detachOfficeBridge()
  driver = driverImpl
  unsubscribe = useChatStore.subscribe(handleStoreChange)

  // 初始化：立即下发全量状态，再同步当前已存在的子 Agent 进度
  const mode = currentMode()
  modeSnapshot = mode
  driverImpl.applyInit(snapshotAgents())
  if (mode.targetMode) handleStoreChange()
}

/** OfficeView 卸载时调用：停止订阅、复位场景、释放驱动引用。 */
export function detachOfficeBridge(): void {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  resetInternal()
  driver?.applyReset()
  driver = null
}
