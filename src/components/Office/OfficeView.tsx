import { useState } from 'react'
import CompanyPanel from './CompanyPanel'
import CompanyDashboard from './CompanyDashboard'
import OfficeProjectsPanel from './OfficeProjectsPanel'
import OfficeChatPane from './OfficeChatPane'
import { MONO } from './officeTheme'
import { useI18n } from '@/i18n/useI18n'

/** Tab 条高度（收起后大框只保留这一行）。 */
const TAB_BAR_H = 40
/** 上（看板/场景）占右列高度的比例范围与默认值。 */
const RATIO_MIN = 0.2
const RATIO_MAX = 0.8
const RATIO_DEFAULT = 0.5
const RATIO_KEY = 'office.sceneRatio'
const COLLAPSED_KEY = 'office.topCollapsed'

function loadRatio(): number {
  const v = parseFloat(localStorage.getItem(RATIO_KEY) || '')
  return Number.isFinite(v) ? Math.max(RATIO_MIN, Math.min(RATIO_MAX, v)) : RATIO_DEFAULT
}

/**
 * 「一人公司」视图：3D 智能办公室 × 目标模式的合并入口（活动栏左侧图标打开）。
 * 全窗布局 = 左侧「项目/任务」栏 + 右上「公司面板」（看板/3D 场景，可拖拽调
 * 比例、可整框收起只留 Tab 条）+ 右下「对话/任务输入」。顶部不再有内嵌工具栏
 * （人 + 一人公司 + token 比例）——窗口标题栏左上角即「OurCode 一人公司」；
 * 预算在右上公司面板看板内展示。
 * 目标（goal）在右下对话输入框输入——开启目标模式后占位符自动切换。
 */
export default function OfficeView() {
  const t = useI18n()
  // 上公司面板 / 下对话 的分割比例；拖拽后持久化，重启不重置
  const [sceneRatio, setSceneRatioState] = useState(loadRatio)
  // 右上区域 tab：看板 / 场景（3D）
  const [activeTopTab, setActiveTopTab] = useState<'dashboard' | 'scene'>('dashboard')
  // 「看板/场景」大框整体收起：只留 Tab 条，对话区吃满剩余空间
  const [topCollapsed, setTopCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1')

  const setSceneRatio = (ratio: number) => {
    setSceneRatioState(ratio)
    try { localStorage.setItem(RATIO_KEY, String(ratio)) } catch { /* ignore */ }
  }
  const toggleCollapsed = () => {
    setTopCollapsed((c) => {
      const next = !c
      try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
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
      setSceneRatio(Math.max(RATIO_MIN, Math.min(RATIO_MAX, ratio)))
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

  return (
    <div id="office3d-root" className="flex flex-col h-full min-h-0">
      {/* 主区：左项目/任务栏 + 右（上公司面板 / 下对话） */}
      <div className="flex flex-1 min-h-0">
        <OfficeProjectsPanel />

        <div className="flex-1 flex flex-col min-h-0">
          <div
            className="flex flex-col min-h-0 overflow-hidden"
            style={{ flex: topCollapsed ? `0 0 ${TAB_BAR_H}px` : `0 0 ${sceneRatio * 100}%` }}
          >
            {/* Tab 切换条 + 右侧收起/展开按钮（Monolith 极简：文字 + 墨黑下划线） */}
            <div
              className="shrink-0 flex items-center px-5"
              style={{ height: TAB_BAR_H, background: MONO.bg, borderBottom: `1px solid ${MONO.hairline}`, gap: 24 }}
            >
              {(['dashboard', 'scene'] as const).map((tab) => {
                const active = activeTopTab === tab
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTopTab(tab)}
                    className="transition-colors"
                    style={{
                      display: 'flex', alignItems: 'center', height: '100%', marginBottom: -1,
                      padding: '0 2px',
                      fontSize: 13, fontWeight: active ? 500 : 400,
                      color: active ? MONO.t1 : MONO.t3,
                      background: 'transparent', border: 'none',
                      borderBottom: `2px solid ${active ? MONO.ink : 'transparent'}`,
                      cursor: 'pointer',
                    }}
                  >
                    {tab === 'dashboard' ? t('office.dashboard') : t('office.scene')}
                  </button>
                )
              })}
              <button
                onClick={toggleCollapsed}
                title={topCollapsed ? t('office.expandPanel') : t('office.collapsePanel')}
                className="transition-colors"
                style={{
                  marginLeft: 'auto',
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '3px 8px', borderRadius: 6,
                  fontSize: 11.5, color: MONO.t3,
                  background: 'transparent', border: `1px solid ${MONO.hairline}`,
                  cursor: 'pointer',
                }}
              >
                <svg
                  width="10" height="10" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: topCollapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
                >
                  <polyline points="6 15 12 9 18 15" />
                </svg>
                {topCollapsed ? t('office.expandPanel') : t('office.collapsePanel')}
              </button>
            </div>
            {/* Tab 内容：常驻挂载，用 display 切换，避免 3D 场景反复初始化；收起时整体隐藏。
                不可见的一侧同时收到 visible=false，3D 停止渲染循环、看板停止轮询。 */}
            <div className="flex-1 min-h-0 overflow-hidden relative" style={{ display: topCollapsed ? 'none' : undefined }}>
              <div className="absolute inset-0" style={{ display: activeTopTab === 'scene' ? 'block' : 'none' }}>
                <CompanyPanel visible={activeTopTab === 'scene' && !topCollapsed} />
              </div>
              <div className="absolute inset-0" style={{ display: activeTopTab === 'dashboard' ? 'block' : 'none' }}>
                <CompanyDashboard active={activeTopTab === 'dashboard' && !topCollapsed} />
              </div>
            </div>
          </div>
          {!topCollapsed && (
            <div
              className="h-px shrink-0 cursor-row-resize transition-colors hover:bg-black/20"
              style={{ background: MONO.hairline }}
              onMouseDown={onSceneResize}
            />
          )}
          <div className="flex-1 min-h-0 overflow-hidden">
            <OfficeChatPane />
          </div>
        </div>
      </div>
    </div>
  )
}
