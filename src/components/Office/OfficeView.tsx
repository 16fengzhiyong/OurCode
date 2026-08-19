import { useEffect, useRef, useState } from 'react'
import { createOfficeSceneHost, type OfficeSceneHost } from '@/vendor/office3d/OfficeSceneHost'
import { statusMeta } from '@/vendor/office3d/data/agentsData.js'
import '@/vendor/office3d/office3d.css'
import { attachOfficeBridge, detachOfficeBridge } from '@/services/office/officeBridge'
import { buildInitialOfficeAgents } from '@/services/office/mapping'
import { useChatStore } from '@/stores/chatStore'
import { statusBadge } from '@/services/targetMode/targetModeService'
import type { OfficeAgentState, OfficeStatus } from '@shared/types'

/** 状态图例（与 office-v3 statusMeta 颜色对齐）。 */
const LEGEND: Array<OfficeStatus> = ['working', 'thinking', 'receiving', 'transfer', 'reviewing', 'completed', 'error', 'idle']

/**
 * 3D 智能办公室视图：直接挂载 vendored office-v3 场景（无 iframe），
 * 由 officeBridge 把目标模式的子 Agent / 主循环实时状态驱动到 8 个工位。
 */
export default function OfficeView() {
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const tagsRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<OfficeSceneHost | null>(null)
  const rafRef = useRef(0)
  const lastTagSyncRef = useRef(0)

  const [agents, setAgents] = useState<OfficeAgentState[]>(() => buildInitialOfficeAgents())
  const [selectedId, setSelectedId] = useState<number>(5)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isTargetMode, setIsTargetMode] = useState(false)
  const targetModeStatus = useChatStore((s) => s.targetModeStatus)

  // 目标模式开关状态跟随活动会话
  useEffect(() => {
    const check = () => {
      const s = useChatStore.getState()
      const session = s.sessions.find((x) => x.id === s.activeSessionId)
      setIsTargetMode(!!(session && session.targetMode))
    }
    check()
    return useChatStore.subscribe(check)
  }, [])

  // 目标模式状态由 ChatPanel 轮询维护；OfficeView 独立展示时自行每 5s 刷新
  useEffect(() => {
    const timer = window.setInterval(() => {
      const s = useChatStore.getState()
      const session = s.sessions.find((x) => x.id === s.activeSessionId)
      if (session?.targetMode) useChatStore.getState().refreshTargetModeStatus()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [])

  // 挂载 3D 场景 + 桥接；卸载时销毁
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const host = createOfficeSceneHost(stage, {
      onSelect: (id) => {
        setSelectedId(id)
        setDrawerOpen(true)
      },
    })
    hostRef.current = host

    // 悬浮标签投影循环（视图固定时降为 4Hz）
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)
      const h = hostRef.current
      const tagsEl = tagsRef.current
      if (!h || !tagsEl || !tagsEl.isConnected) return
      const now = performance.now()
      if (!h.viewDirtyCheck() && now - lastTagSyncRef.current < 250) return
      lastTagSyncRef.current = now
      const positions = h.getProjectedAgentPositions()
      for (const pos of positions) {
        const el = tagsEl.querySelector(`[data-agent="${pos.id}"]`) as HTMLElement | null
        if (!el) continue
        if (pos.visible) {
          el.style.display = 'flex'
          el.style.left = `${pos.screenX}px`
          el.style.top = `${pos.screenY}px`
        } else {
          el.style.display = 'none'
        }
      }
    }
    rafRef.current = requestAnimationFrame(loop)

    // 桥接驱动：状态/任务/交接 → 场景 + React 状态
    attachOfficeBridge({
      applyInit: (list) => setAgents(list),
      applyStatus: (id, status) => {
        setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)))
        host.setAgentStatus(id, status)
      },
      applyTask: (id, task, progress, logs) => {
        setAgents((prev) =>
          prev.map((a) => {
            if (a.id !== id) return a
            const merged = logs && logs.length > 0 ? [...logs, ...a.logs].slice(0, 50) : a.logs
            return { ...a, task, progress, logs: merged }
          }),
        )
      },
      applyTransfer: (fromId, toId, onComplete) => {
        setAgents((prev) => prev.map((a) => (a.id === fromId ? { ...a, status: 'transfer' } : a)))
        host.launchTaskTransfer(fromId, toId, onComplete)
      },
      applyReset: () => setAgents(buildInitialOfficeAgents()),
    })

    return () => {
      cancelAnimationFrame(rafRef.current)
      detachOfficeBridge()
      host.dispose()
      hostRef.current = null
    }
  }, [])

  const selectAgent = (id: number) => {
    hostRef.current?.selectAgent(id) // 触发 onSelect → setSelectedId + 打开抽屉
    setSelectedId(id)
    setDrawerOpen(true)
  }

  const badge = statusBadge(targetModeStatus)
  const selected = agents.find((a) => a.id === selectedId) ?? agents[0]
  const selectedMeta = statusMeta[selected?.status as OfficeStatus] || statusMeta.idle

  return (
    <div id="office3d-root" ref={rootRef} className="flex flex-col h-full min-h-0">
      {/* 工具栏 */}
      <div
        className="flex items-center justify-between shrink-0 px-3"
        style={{ height: 40, borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ fontSize: 15 }}>🏢</span>
          <span className="font-bold uppercase tracking-[0.08em] shrink-0" style={{ fontSize: 11, color: '#cbd5e1', letterSpacing: '0.08em' }}>
            3D 智能办公室
          </span>
          {badge && (
            <span
              className="px-2 py-0.5 rounded-full font-medium shrink-0"
              style={{ fontSize: 11, color: '#22c55e', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)' }}
            >
              目标模式 {badge}
            </span>
          )}
          <span className="text-xs shrink-0" style={{ color: isTargetMode ? '#cbd5e1' : '#94a3b8' }}>
            {isTargetMode ? '实时驱动中 · 点击工位查看详情' : '未开启目标模式 · 展示待命工位'}
          </span>
        </div>
      </div>

      {/* 场景区 */}
      <div className="relative flex-1 min-h-0">
        <div ref={stageRef} className="office3d-stage" />

        {/* 悬浮标签 */}
        <div ref={tagsRef} className="office3d-tags">
          {agents.map((a) => {
            const meta = statusMeta[a.status as OfficeStatus] || statusMeta.idle
            return (
              <div
                key={a.id}
                data-agent={a.id}
                className={`office3d-tag ${a.id === selectedId ? 'selected' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  selectAgent(a.id)
                }}
                title={`${a.id}号 ${a.role} · ${meta.label}`}
              >
                <span className="office3d-tag-dot" style={{ background: meta.color }} />
                <span>
                  {a.id} {a.role} · {meta.label}
                </span>
              </div>
            )
          })}
        </div>

        {/* 状态图例 */}
        <div
          className="absolute left-3 bottom-3 flex flex-wrap gap-x-3 gap-y-1 px-3 py-2 rounded-lg pointer-events-none"
          style={{ background: 'rgba(15,23,42,0.72)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)' }}
        >
          {LEGEND.map((s) => {
            const meta = statusMeta[s]
            return (
              <span key={s} className="flex items-center gap-1" style={{ fontSize: 11, color: '#cbd5e1' }}>
                <span className="inline-block rounded-full" style={{ width: 7, height: 7, background: meta.color }} />
                {meta.label}
              </span>
            )
          })}
        </div>

        {/* 右侧详情抽屉 */}
        <div
          className="absolute top-0 bottom-0 flex flex-col transition-transform duration-300"
          style={{
            right: 0,
            width: 320,
            transform: drawerOpen ? 'translateX(0)' : 'translateX(calc(100% - 28px))',
            background: 'rgba(15, 23, 42, 0.95)',
            borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(24px)',
            boxShadow: '-8px 0 32px rgba(0,0,0,0.5)',
            zIndex: 20,
          }}
        >
          <button
            onClick={() => setDrawerOpen((v) => !v)}
            className="absolute rounded-l-lg flex items-center justify-center"
            style={{ top: 18, left: -36, width: 36, height: 36, background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRight: 'none', color: '#cbd5e1', cursor: 'pointer' }}
          >
            {drawerOpen ? '›' : '‹'}
          </button>

          <div className="p-4 overflow-y-auto flex-1 min-h-0" style={{ minWidth: 0 }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-bold" style={{ color: '#e2e8f0' }}>
                {selected?.id}号 {selected?.role}
              </span>
              <span className="text-xs" style={{ color: '#94a3b8' }}>({selected?.codeName})</span>
            </div>
            <div
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full mb-3"
              style={{ color: selectedMeta.color, background: `rgba(${hexToRgb(selectedMeta.color)}, 0.15)` }}
            >
              <span className="inline-block rounded-full" style={{ width: 7, height: 7, background: selectedMeta.color }} />
              {selectedMeta.label}
            </div>

            <div className="text-xs font-semibold mb-1" style={{ color: '#cbd5e1' }}>
              当前任务
            </div>
            <div className="text-xs mb-2 leading-relaxed" style={{ color: '#e2e8f0' }}>
              {selected?.task || '—'}
            </div>
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${selected?.progress ?? 0}%`, background: selectedMeta.color }}
                />
              </div>
              <span className="text-xs font-medium" style={{ color: '#cbd5e1' }}>
                {selected?.status === 'completed' ? '100%' : `${selected?.progress ?? 0}%`}
              </span>
            </div>

            <div className="text-xs font-semibold mb-1" style={{ color: '#cbd5e1' }}>
              历史轨迹
            </div>
            <div className="flex flex-col gap-2">
              {(selected?.logs ?? []).slice(0, 12).map((log, i) => (
                <div key={i} className="flex gap-2">
                  <span className="mt-1 inline-block rounded-full shrink-0" style={{ width: 6, height: 6, background: selectedMeta.color }} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium truncate" style={{ color: '#e2e8f0' }}>{log.title}</span>
                      <span className="text-[10px] shrink-0" style={{ color: '#94a3b8' }}>{log.t}</span>
                    </div>
                    {log.desc && (
                      <div className="text-[11px] leading-snug" style={{ color: '#94a3b8' }}>{log.desc}</div>
                    )}
                  </div>
                </div>
              ))}
              {(selected?.logs ?? []).length === 0 && (
                <div className="text-xs" style={{ color: '#94a3b8' }}>暂无记录</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function hexToRgb(hex: string): string {
  const c = hex.replace('#', '')
  const bigint = parseInt(c, 16)
  return `${(bigint >> 16) & 255}, ${(bigint >> 8) & 255}, ${bigint & 255}`
}
