import { useMemo, useRef, useState } from 'react'
import { useChatStore, isGhostSession, sessionLastUserActivity } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'
import { useUIStore } from '@/stores/uiStore'
import { useI18n } from '@/i18n/useI18n'
import { summarizeTask, estimateProgress, roleLabel } from '@/services/office/mapping'
import FileTree from '../Sidebar/FileTree'
import { IS_OFFICE } from '@/utils/windowMode'
import type { ChatSession, SubAgentProgress } from '@shared/types'

/** 任务行前导圆形状态图标：运行中 = 彩虹渐变环旋转；完成 = 纯绿实环；失败/停止 = 纯红实环。 */
function TaskStatusRing({ status, size = 24 }: { status: SubAgentProgress['status']; size?: number }) {
  const inner = size / 24
  if (status === 'running') {
    return (
      <span className="relative shrink-0 rounded-full flex items-center justify-center" style={{ width: size, height: size, background: '#ffffff', border: '1px solid rgba(15,23,42,0.08)' }}>
        <span className="oc-ring-run animate-spin absolute inset-0 rounded-full" />
        <span className="relative rounded-full" style={{ width: 1.5 * inner, height: 1.5 * inner, background: '#0058bc' }} />
      </span>
    )
  }
  const done = status === 'done'
  return (
    <span className="relative shrink-0 rounded-full flex items-center justify-center" style={{ width: size, height: size, background: '#ffffff', border: '1px solid rgba(15,23,42,0.08)' }}>
      <span className={`${done ? 'oc-ring-done' : 'oc-ring-fail'} absolute inset-0 rounded-full`} />
      <svg className="relative" width={10 * inner} height={10 * inner} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: done ? '#16a34a' : '#dc2626' }}>
        {done
          ? <path d="M20 6 9 17l-5-5" />
          : <path d="M18 6 6 18M6 6l12 12" />}
      </svg>
    </span>
  )
}

/** 任务状态 → 状态文案 key（running / done / failed）。 */
function statusKey(status: SubAgentProgress['status']): 'running' | 'done' | 'failed' {
  if (status === 'running') return 'running'
  if (status === 'done') return 'done'
  return 'failed'
}

const STATUS_COLOR: Record<'running' | 'done' | 'failed', string> = {
  running: '#0058bc',
  done: '#16a34a',
  failed: '#dc2626',
}

/** 项目渐变瓷砖（与 agent 侧项目列表同款，暗色版）。 */
const PROJECT_TILES = [
  { bg: 'linear-gradient(135deg, #0ea5e9, #6366f1, #a855f7)', icon: 'bolt' },
  { bg: 'linear-gradient(135deg, #f97316, #fb7185)', icon: 'terminal' },
  { bg: 'linear-gradient(135deg, #10b981, #34d399)', icon: 'language' },
]

function TileIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    bolt: <path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2z" />,
    terminal: <path d="M4 17l6-6-6-6M12 19h8" />,
    language: <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 2.1A8 8 0 0 0 4.2 11H7a16 16 0 0 1 4-6.9zM13 4.1a16 16 0 0 1 4 6.9h2.8A8 8 0 0 0 13 4.1zM11 13H4.2A8 8 0 0 0 11 20zM13 13v6.9a8 8 0 0 0 6.8-6.9z" />,
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  )
}

interface TaskItem {
  id: string // 父 run_subagent 的 toolCallId（subagentProgress 的键）
  p: SubAgentProgress
  session: ChatSession
}

/**
 * 「一人公司」左侧「项目/任务」栏：
 * - 项目列表复用 agent 侧项目列表的归组逻辑（recentProjects + 会话 projectPath）。
 * - 每个项目下列出该项目下**目标模式子任务**（subagentProgress，会话 targetMode 为真），
 *   不含 agent 侧任务（agentRuns）。
 * - **双击项目卡片 → 就在本栏内就地打开该项目的文件树**（不退出办公室、不跳工作区）；
 *   单击任务 → 切到对应对话。文件树里双击文件 → 进工作区编辑器编辑。
 */
export default function OfficeProjectsPanel() {
  const t = useI18n()
  const recentProjects = useUIStore((s) => s.recentProjects)
  const recentProjectTimes = useUIStore((s) => s.recentProjectTimes)
  const removedProjects = useUIStore((s) => s.removedProjects)
  const projectOrder = useUIStore((s) => s.projectOrder)
  const sessions = useChatStore((s) => s.sessions)
  const subagentProgress = useChatStore((s) => s.subagentProgress)

  const currentProjectPath = useChatStore((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.projectPath ?? null)

  // 左侧栏内部视图：'projects'（项目/任务列表）| 'tree'（项目文件树，就地打开）。
  // 双击项目/打开项目都在本栏内切换，不退出办公室视图。
  const [view, setView] = useState<'projects' | 'tree'>('projects')
  const [treePath, setTreePath] = useState<string | null>(null)
  const [treeRefresh, setTreeRefresh] = useState(0)

  // 任务行「单击 = 切到该任务会话 / 双击 = 打开项目」的区分计时器：
  // 单击延时 250ms 再切换，双击到达时取消切换并交给卡片打开项目——
  // 否则双击任务行会先 setActiveSession 切到长对话（重渲染卡顿），项目反而打不开。
  const taskClickTimer = useRef<number | null>(null)
  const cancelPendingTaskClick = () => {
    if (taskClickTimer.current != null) {
      window.clearTimeout(taskClickTimer.current)
      taskClickTimer.current = null
    }
  }

  // 项目归组（复制 agent 侧 ProjectListPanel 的稳定排序逻辑）
  const projects = useMemo(() => {
    const map = new Map<string, { name: string; path: string; lastOpened: number }>()
    recentProjects.forEach((rp) => {
      map.set(rp, { name: rp.split(/[/\\]/).pop() || rp, path: rp, lastOpened: recentProjectTimes[rp] || 0 })
    })
    const sessionOnly: Array<{ name: string; path: string; lastOpened: number; firstAdded: number }> = []
    const byPath = new Map<string, { name: string; path: string; lastOpened: number; firstAdded: number }>()
    for (const s of sessions) {
      if (isGhostSession(s)) continue
      if (!s.projectPath) continue
      if (map.has(s.projectPath)) {
        const entry = map.get(s.projectPath)!
        if (entry.lastOpened === 0 && sessionLastUserActivity(s) > entry.lastOpened) entry.lastOpened = sessionLastUserActivity(s)
        continue
      }
      let entry = byPath.get(s.projectPath)
      if (!entry) {
        entry = {
          name: s.projectPath.split(/[/\\]/).pop() || s.projectPath,
          path: s.projectPath,
          lastOpened: 0,
          firstAdded: Number.MAX_SAFE_INTEGER,
        }
        byPath.set(s.projectPath, entry)
        sessionOnly.push(entry)
      }
      if (s.createdAt < entry.firstAdded) entry.firstAdded = s.createdAt
      if (sessionLastUserActivity(s) > entry.lastOpened) entry.lastOpened = sessionLastUserActivity(s)
    }
    sessionOnly.sort((a, b) => b.firstAdded - a.firstAdded)
    const removed = new Set(removedProjects)
    return [
      ...Array.from(map.entries()).map(([path, info]) => ({ ...info, path })),
      ...sessionOnly,
    ].filter((p) => !removed.has(p.path))
  }, [recentProjects, recentProjectTimes, sessions, removedProjects])

  // 用户拖拽固定的顺序优先；新项目排最前
  const displayedProjects = useMemo(() => {
    if (!projectOrder || projectOrder.length === 0) return projects
    const byPath = new Map(projects.map((p) => [p.path, p]))
    const pinned = new Set(projectOrder)
    const ordered: typeof projects = []
    for (const p of projects) if (!pinned.has(p.path)) { ordered.push(p); byPath.delete(p.path) }
    for (const path of projectOrder) {
      const p = byPath.get(path)
      if (p) { ordered.push(p); byPath.delete(path) }
    }
    return ordered
  }, [projects, projectOrder])

  // 一人公司任务：目标模式会话的子 Agent 进度，按项目归组（运行中在前，按启动时间倒序）
  const tasksByProject = useMemo(() => {
    const map = new Map<string, TaskItem[]>()
    for (const [toolCallId, p] of Object.entries(subagentProgress)) {
      const session = sessions.find((s) => s.id === p.sessionId)
      if (!session?.targetMode) continue
      const key = session.projectPath || ''
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push({ id: toolCallId, p, session })
    }
    const rank = (s: SubAgentProgress['status']) => (s === 'running' ? 0 : s === 'done' ? 1 : 2)
    for (const arr of map.values()) {
      arr.sort((a, b) => (rank(a.p.status) - rank(b.p.status)) || (b.p.startedAt - a.p.startedAt))
    }
    return map
  }, [subagentProgress, sessions])

  const handleEnterProject = (path: string) => {
    const latest = sessions
      .filter((s) => s.projectPath === path && !isGhostSession(s))
      .sort((a, b) => sessionLastUserActivity(b) - sessionLastUserActivity(a))[0]
    if (latest) {
      useChatStore.getState().setActiveSession(latest.id)
    } else if (IS_OFFICE) {
      // 办公室窗口没有「对话面板」的新建会话入口——双击一个还没有会话的项目时
      // 自动创建一个，让目标模式输入框立即可用。
      const configId = useConfigStore.getState().activeConfigGroupId
      if (configId) useChatStore.getState().createSession(configId, path)
    }
    // 同步工作区根（会话已绑定 projectPath，这里让工作区/目标模式与项目一致），
    // 但**不退出办公室视图**——文件树就在本栏内就地打开。
    useUIStore.getState().enterProject(path)
    setTreePath(path)
    setView('tree')
  }

  const handleSelectTask = (sessionId: string) => {
    useChatStore.getState().setActiveSession(sessionId)
  }

  // 办公室窗口没有左侧「对话面板」，项目需要从这里添加：选择任意文件夹作为
  // 项目，文件树同样在本栏内就地打开（不跳到工作区）。
  const handleOpenFolder = async () => {
    const path = await window.electronAPI.openFolder()
    if (!path) return
    useUIStore.getState().enterProject(path)
    // 新项目绑定一个 office 会话，方便立即启动目标模式（有会话时输入框才可见）。
    if (IS_OFFICE) {
      const configId = useConfigStore.getState().activeConfigGroupId
      if (configId && !useChatStore.getState().sessions.some((s) => s.projectPath === path)) {
        useChatStore.getState().createSession(configId, path)
      }
    }
    setTreePath(path)
    setView('tree')
  }

  // 办公室内文件树里点文件 = 打开编辑器编辑 → 进入工作区（文件树已在侧栏，编辑器立即可见）。
  const handleOpenFileFromTree = () => {
    useUIStore.getState().setActiveSidebarTab('files')
  }

  // 文件树头部「新建对话」：为当前项目建一个 office 会话，输入框立即可用。
  const handleNewSessionForTree = () => {
    if (!treePath) return
    const configId = useConfigStore.getState().activeConfigGroupId
    if (configId) useChatStore.getState().createSession(configId, treePath)
  }

  // ── 文件树视图：双击项目 / 打开项目后，就在本栏内就地展示项目文件树，
  //    不退出办公室视图、不跳到工作区的「任务面板」。点文件 = 进工作区编辑器编辑。
  if (view === 'tree' && treePath) {
    return (
      <aside
        data-testid="office-projects-panel"
        className="shrink-0 flex flex-col min-h-0"
        style={{
          width: 280,
          background: '#ffffff',
          borderRight: '1px solid rgba(15,23,42,0.08)',
        }}
      >
        <div className="p-2 border-b shrink-0 flex items-center justify-between" style={{ borderColor: 'rgba(15,23,42,0.08)' }}>
          <div className="flex items-center gap-1 min-w-0">
            <button
              onClick={() => setView('projects')}
              title={t('office.backToProjects')}
              className="flex items-center justify-center w-6 h-6 rounded-md shrink-0 transition-colors hover:bg-nova-hover"
              style={{ color: '#64748b', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span className="text-xs font-semibold truncate min-w-0" style={{ color: '#0f172a' }} title={treePath}>
              {treePath.split(/[/\\]/).pop() || treePath}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setTreeRefresh((n) => n + 1)}
              title={t('office.refreshTree')}
              className="flex items-center justify-center w-6 h-6 rounded-md transition-colors hover:bg-nova-hover"
              style={{ color: '#64748b', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
            <button
              onClick={handleNewSessionForTree}
              title={t('chat.newChat')}
              className="flex items-center justify-center w-6 h-6 rounded-md transition-colors hover:bg-nova-hover"
              style={{ color: '#64748b', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden min-h-0">
          <FileTree rootPath={treePath} refreshSignal={treeRefresh} onOpenFile={handleOpenFileFromTree} />
        </div>
      </aside>
    )
  }

  return (
    <aside
      data-testid="office-projects-panel"
      className="shrink-0 flex flex-col overflow-y-auto"
      style={{
        width: 280,
        background: '#ffffff',
        borderRight: '1px solid rgba(15,23,42,0.08)',
      }}
    >
      <div className="p-3 border-b" style={{ borderColor: 'rgba(15,23,42,0.08)' }}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: '#64748b' }}>
            {t('office.projectsPanelTitle')}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px]" style={{ color: '#94a3b8' }}>{displayedProjects.length}</span>
            <button
              onClick={handleOpenFolder}
              title={t('office.openProject')}
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-colors hover:bg-nova-hover"
              style={{ color: '#0058bc', border: '1px solid rgba(0,88,188,0.3)', background: 'rgba(0,88,188,0.06)', cursor: 'pointer' }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              {t('office.openProject')}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 p-2 flex flex-col gap-1.5">
        {displayedProjects.length === 0 && (
          <div className="text-xs text-center py-8" style={{ color: '#94a3b8' }}>{t('office.noProjects')}</div>
        )}
        {displayedProjects.map((project, idx) => {
          const isCurrent = currentProjectPath === project.path
          const tasks = tasksByProject.get(project.path) || []
          const tile = PROJECT_TILES[idx % PROJECT_TILES.length]
          return (
            <div
              key={project.path}
              onDoubleClick={() => {
                // 双击 = 打开项目。先取消挂起的任务行单击切换（否则双击任务行会先
                // 切到长对话再开项目，中间那次重渲染就是「巨卡」的来源）。
                cancelPendingTaskClick()
                handleEnterProject(project.path)
              }}
              title={t('office.doubleClickHint')}
              className="rounded-xl p-2 cursor-pointer select-none transition-colors hover:bg-nova-hover"
              style={{
                background: isCurrent ? 'rgba(0,88,188,0.06)' : '#ffffff',
                border: isCurrent ? '1px solid rgba(0,88,188,0.25)' : '1px solid rgba(15,23,42,0.08)',
                borderLeft: isCurrent ? '3px solid #0058bc' : '1px solid rgba(15,23,42,0.08)',
                boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
              }}
            >
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: tile.bg, color: '#fff' }}>
                  <TileIcon name={tile.icon} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold truncate" style={{ color: '#0f172a' }}>{project.name}</span>
                    {isCurrent && (
                      <span
                        className="px-1.5 py-px rounded-full text-[9px] font-medium shrink-0"
                        style={{ color: '#0058bc', background: 'rgba(0,88,188,0.08)', border: '1px solid rgba(0,88,188,0.3)' }}
                      >
                        {t('office.currentProject')}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] truncate" style={{ color: '#94a3b8' }}>{project.path}</div>
                </div>
                {tasks.length > 0 && (
                  <span
                    className="px-1.5 py-0.5 rounded-full text-[9.5px] font-semibold shrink-0"
                    style={{ color: '#fff', background: '#0058bc' }}
                    title={t('office.projectsPanelTitle')}
                  >
                    {tasks.length}
                  </span>
                )}
              </div>

              {/* 一人公司任务（目标模式子任务） */}
              {tasks.length > 0 ? (
                <div className="mt-1.5 ml-[6px] border-l pl-2 flex flex-col" style={{ borderColor: 'rgba(15,23,42,0.1)' }}>
                  {tasks.map(({ id, p, session }) => {
                    const sk = statusKey(p.status)
                    return (
                      <button
                        key={id}
                        onClick={() => {
                          // 单击 = 切到该任务会话（延时 250ms 区分双击）；
                          // 双击由卡片 onDoubleClick 取消本次切换并打开项目。
                          if (taskClickTimer.current != null) window.clearTimeout(taskClickTimer.current)
                          taskClickTimer.current = window.setTimeout(() => {
                            taskClickTimer.current = null
                            handleSelectTask(session.id)
                          }, 250)
                        }}
                        title={`${session.title || t('chat.untitled')} · ${summarizeTask(p.task, 120)}`}
                        className="w-full flex items-center gap-2 py-1 px-1 rounded-lg text-left transition-colors hover:bg-nova-hover"
                      >
                        <TaskStatusRing status={p.status} size={22} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-medium truncate" style={{ color: '#0f172a' }}>{roleLabel(p.task, p.name)}</span>
                            <span className="text-[9px] shrink-0" style={{ color: STATUS_COLOR[sk] }}>
                              {sk === 'running' ? t('office.taskRunning') : sk === 'done' ? t('office.taskDone') : t('office.taskFailed')}
                              {sk === 'running' ? ` · ${estimateProgress(p)}%` : ''}
                            </span>
                          </span>
                          <span className="block text-[10px] truncate" style={{ color: '#64748b' }}>{summarizeTask(p.task, 40)}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="mt-1.5 ml-1 text-[10px]" style={{ color: '#94a3b8' }}>{t('office.noTasks')}</div>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
