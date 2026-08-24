import { useEffect, useRef, useState } from 'react'
import { createOfficeSceneHost, type OfficeSceneHost } from '@/vendor/office3d/OfficeSceneHost'
import { statusMeta } from '@/vendor/office3d/data/agentsData.js'
import '@/vendor/office3d/office3d.css'
import { attachOfficeBridge, detachOfficeBridge } from '@/services/office/officeBridge'
import { buildInitialOfficeAgents } from '@/services/office/mapping'
import type { OfficeAgentState, OfficeStatus } from '@shared/types'

/** 状态图例（与 office-v3 statusMeta 颜色对齐）。 */
const LEGEND: Array<OfficeStatus> = ['working', 'thinking', 'receiving', 'transfer', 'reviewing', 'completed', 'error', 'idle']

/**
 * 「一人公司」右上「公司面板」：直接挂载 vendored office-v3 3D 场景（无 iframe），
 * 由 officeBridge 把目标模式的子 Agent / 主循环实时状态驱动到 8 个工位。
 * 悬浮标签投影、状态图例、右侧详情抽屉都在场景区内。
 */
export default function CompanyPanel() {
  const stageRef = useRef<HTMLDivElement>(null)
  const tagsRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<OfficeSceneHost | null>(null)
  const rafRef = useRef(0)
  const lastTagSyncRef = useRef(0)

  const [agents, setAgents] = useState<OfficeAgentState[]>(() => buildInitialOfficeAgents())
  const [selectedId, setSelectedId] = useState<number>(5)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 挂载 3D 场景 + 桥接；卸载时销毁
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    // 取景（推近桌面、裁掉两侧黑墙）由 OfficeScene.setCameraFraming 按容器
    // 宽高比自动处理，宿主无需传参。
    const host = createOfficeSceneHost(stage, {
      onSelect: (id) => {
        setSelectedId(id)
        setDrawerOpen(true)
      },
    })
    hostRef.current = host

    // 窗口隐藏/失焦时暂停 3D 渲染循环，避免后台空转吃 CPU/GPU；恢复时继续
    const setRunning = (running: boolean) => hostRef.current?.setRunning(running)
    const onVisibility = () => setRunning(!document.hidden)
    const onBlur = () => setRunning(false)
    const onFocus = () => setRunning(true)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    setRunning(!document.hidden)

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
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      host.dispose()
      hostRef.current = null
    }
  }, [])

  const selectAgent = (id: number) => {
    hostRef.current?.selectAgent(id) // 触发 onSelect → setSelectedId + 打开抽屉
    setSelectedId(id)
    setDrawerOpen(true)
  }

  const selected = agents.find((a) => a.id === selectedId) ?? agents[0]
  const selectedMeta = statusMeta[selected?.status as OfficeStatus] || statusMeta.idle

  return (
    <div className="relative h-full min-h-0">
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
        style={{ background: 'rgba(255,255,255,0.92)', border: '1px solid rgba(15,23,42,0.08)', boxShadow: '0 2px 8px rgba(15,23,42,0.08)' }}
      >
        {LEGEND.map((s) => {
          const meta = statusMeta[s]
          return (
            <span key={s} className="flex items-center gap-1" style={{ fontSize: 11, color: '#64748b' }}>
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
          background: '#ffffff',
          borderLeft: '1px solid rgba(15, 23, 42, 0.08)',
          boxShadow: '-8px 0 32px rgba(15,23,42,0.08)',
          zIndex: 20,
        }}
      >
        <button
          onClick={() => setDrawerOpen((v) => !v)}
          className="absolute rounded-l-lg flex items-center justify-center"
          style={{ top: 18, left: -36, width: 36, height: 36, background: '#ffffff', border: '1px solid rgba(15, 23, 42, 0.08)', borderRight: 'none', color: '#64748b', cursor: 'pointer', boxShadow: '-4px 0 12px rgba(15,23,42,0.06)' }}
        >
          {drawerOpen ? '›' : '‹'}
        </button>

        <div className="p-4 overflow-y-auto flex-1 min-h-0" style={{ minWidth: 0 }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold" style={{ color: '#0f172a' }}>
              {selected?.id}号 {selected?.role}
            </span>
            <span className="text-xs" style={{ color: '#64748b' }}>({selected?.codeName})</span>
          </div>
          <div
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full mb-3"
            style={{ color: selectedMeta.color, background: `rgba(${hexToRgb(selectedMeta.color)}, 0.1)`, border: `1px solid rgba(${hexToRgb(selectedMeta.color)}, 0.25)` }}
          >
            <span className="inline-block rounded-full" style={{ width: 7, height: 7, background: selectedMeta.color }} />
            {selectedMeta.label}
          </div>

          <div className="text-xs font-semibold mb-1" style={{ color: '#334155' }}>
            当前任务
          </div>
          <div className="text-xs mb-2 leading-relaxed" style={{ color: '#0f172a' }}>
            {selected?.task || '—'}
          </div>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(15,23,42,0.08)' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${selected?.progress ?? 0}%`, background: selectedMeta.color }}
              />
            </div>
            <span className="text-xs font-medium" style={{ color: '#334155' }}>
              {selected?.status === 'completed' ? '100%' : `${selected?.progress ?? 0}%`}
            </span>
          </div>

          <div className="text-xs font-semibold mb-1" style={{ color: '#334155' }}>
            历史轨迹
          </div>
          <div className="flex flex-col gap-2">
            {(selected?.logs ?? []).slice(0, 12).map((log, i) => (
              <div key={i} className="flex gap-2">
                <span className="mt-1 inline-block rounded-full shrink-0" style={{ width: 6, height: 6, background: selectedMeta.color }} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium truncate" style={{ color: '#0f172a' }}>{log.title}</span>
                    <span className="text-[10px] shrink-0" style={{ color: '#94a3b8' }}>{log.t}</span>
                  </div>
                  {log.desc && (
                    <div className="text-[11px] leading-snug" style={{ color: '#64748b' }}>{log.desc}</div>
                  )}
                </div>
              </div>
            ))}
            {(selected?.logs ?? []).length === 0 && (
              <div className="text-xs" style={{ color: '#64748b' }}>暂无记录</div>
            )}
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
