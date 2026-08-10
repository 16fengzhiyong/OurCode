import { useState, useMemo } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'
import FileTree from './FileTree'
import { useI18n } from '@/i18n/useI18n'

/** Project icon tiles — gradient backgrounds cycling per project (Stitch:
 *  brand blue-violet / sunset orange / green), each with a symbol. */
const PROJECT_TILES = [
  { bg: 'linear-gradient(135deg, #0ea5e9, #6366f1, #a855f7)', icon: 'bolt' },
  { bg: 'linear-gradient(135deg, #f97316, #fb7185)', icon: 'terminal' },
  { bg: 'linear-gradient(135deg, #10b981, #34d399)', icon: 'language' },
]

/** Material-symbol-like inline SVG icons used across the panel */
function TileIcon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    bolt: <path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2z" />,
    terminal: <path d="M4 6h16M4 6l5 5-5 5M9 16h11" strokeLinecap="round" strokeLinejoin="round" />,
    language: <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2c2.5 2.5 4 6.2 4 10s-1.5 7.5-4 10c-2.5-2.5-4-6.2-4-10s1.5-7.5 4-10z" />,
    chat: <path d="M4 5h16v11H8l-4 4V5z" strokeLinecap="round" strokeLinejoin="round" />,
    robot: <path d="M12 8V4M9 4h6M6 9h.01M18 9h.01M6 13h.01M18 13h.01M7 17c1 1 3 1.5 5 1.5s4-.5 5-1.5" strokeLinecap="round" strokeLinejoin="round" />,
    forum: <path d="M4 6h13v9H8l-4 3V6z" strokeLinecap="round" strokeLinejoin="round" />,
    pin: <path d="M16 3 21 8l-4.5 1.5L13 13l1.5 6.5L8 13l-4 4 3-8L3 8l6-4L12 8l1.5-4.5L16 3z" strokeLinecap="round" strokeLinejoin="round" />,
    expandMore: <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />,
    spinner: <path d="M12 3a9 9 0 1 1-9 9" strokeLinecap="round" />,
    search: <path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2-4.3-4.3" strokeLinecap="round" strokeLinejoin="round" />,
    pending: <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />,
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

/** Simple time formatting */
function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays}天前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

/** Leading status indicator for a session row (Stitch: spinner while running,
 *  primary dot when attention needed, red dot on error, slate dot otherwise). */
function SessionStatusDot({ running, needsAttention, hasError, color }: {
  running: boolean
  needsAttention: boolean
  hasError?: boolean
  color?: string
}) {
  if (running) {
    return (
      <span className="w-4 h-4 shrink-0 flex items-center justify-center text-primary animate-spin" title="运行中">
        <TileIcon name="spinner" size={14} />
      </span>
    )
  }
  if (needsAttention) {
    return (
      <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 ml-0.5" title="该会话需要处理" />
    )
  }
  if (hasError) {
    return <span className="w-1.5 h-1.5 rounded-full bg-error shrink-0 ml-0.5" title="运行出错" />
  }
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ml-0.5 ${color ? '' : 'bg-slate-300 dark:bg-white/30'}`}
      style={color ? { background: color } : undefined}
    />
  )
}

export default function ProjectListPanel() {
  const {
    rootPath, setRootPath, recentProjects, recentProjectTimes, projectListView, activeProjectPath,
    enterProject, backToProjectList, setActiveSidebarTab,
  } = useUIStore()
  const sessions = useChatStore((s) => s.sessions)
  const runningSessionIds = useChatStore((s) => s.runningSessionIds)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const pendingQuestion = useChatStore((s) => s.pendingQuestion)
  const pendingApproval = useChatStore((s) => s.pendingApproval)
  const batchApproval = useChatStore((s) => s.batchApproval)
  const setActiveSession = useChatStore((s) => s.setActiveSession)
  const createSession = useChatStore((s) => s.createSession)
  const t = useI18n()

  const [searchQuery, setSearchQuery] = useState('')
  const [showMoreSessions, setShowMoreSessions] = useState<Set<string>>(new Set())

  // Sessions waiting on the user (question / tool approval / batch approval /
  // plan approval) — shown as an accent "待处理" pill in the list (需求 3).
  const attentionSessionIds = useMemo(() => {
    const ids = new Set<string>()
    if (pendingQuestion?.sessionId) ids.add(pendingQuestion.sessionId)
    if (pendingApproval?.sessionId) ids.add(pendingApproval.sessionId)
    if (batchApproval?.sessionId) ids.add(batchApproval.sessionId)
    for (const s of sessions) if (s.planStatus === 'pending_approval') ids.add(s.id)
    return ids
  }, [pendingQuestion, pendingApproval, batchApproval, sessions])

  // Sessions whose last agent run errored — red dot (design: 对话历史状态).
  const errorSessionIds = useMemo(() => {
    const ids = new Set<string>()
    for (const s of sessions) if (s.agentRuns?.some((r) => r.status === 'error')) ids.add(s.id)
    return ids
  }, [sessions])

  // Collect unique projects from recentProjects + sessions' projectPath.
  // Recently opened projects keep their open-order (most recent first) so the
  // list doesn't re-sort/jump when a chat session is created or updated —
  // previously a new session bumped the project's recency key and the whole
  // list shifted, which read as "the project list collapses by itself".
  const projects = useMemo(() => {
    const map = new Map<string, { name: string; path: string; lastOpened: number; sessionCount: number }>()

    // Recently opened projects keep their open-order (most recent first) with a
    // stable recency key, so creating/updating sessions never re-sorts the list.
    // lastOpened is the REAL open time recorded in setRootPath (recentProjectTimes);
    // installs that predate timestamps fall back to session activity below.
    recentProjects.forEach((rp) => {
      const name = rp.split(/[/\\]/).pop() || rp
      map.set(rp, { name, path: rp, lastOpened: recentProjectTimes[rp] || 0, sessionCount: 0 })
    })

    // Projects only known from chat sessions go after the recent ones, ordered
    // by their latest session activity.
    const sessionOnly: Array<{ name: string; path: string; lastOpened: number; sessionCount: number }> = []
    const byPath = new Map<string, { name: string; path: string; lastOpened: number; sessionCount: number }>()

    for (const s of sessions) {
      if (!s.projectPath) continue
      if (map.has(s.projectPath)) {
        const entry = map.get(s.projectPath)!
        entry.sessionCount++
        // Projects opened before open-times were recorded have lastOpened 0 —
        // use the latest session activity as the displayed time.
        if (entry.lastOpened === 0 && s.updatedAt > entry.lastOpened) entry.lastOpened = s.updatedAt
        continue
      }
      let entry = byPath.get(s.projectPath)
      if (!entry) {
        entry = {
          name: s.projectPath.split(/[/\\]/).pop() || s.projectPath,
          path: s.projectPath,
          lastOpened: 0,
          sessionCount: 0,
        }
        byPath.set(s.projectPath, entry)
        sessionOnly.push(entry)
      }
      entry.sessionCount++
      if (s.updatedAt > entry.lastOpened) entry.lastOpened = s.updatedAt
    }
    sessionOnly.sort((a, b) => b.lastOpened - a.lastOpened)

    return [
      ...Array.from(map.entries()).map(([path, info]) => ({ ...info, path })),
      ...sessionOnly,
    ]
  }, [recentProjects, recentProjectTimes, sessions])

  // Filter by search
  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects
    const q = searchQuery.toLowerCase()
    // Also check session titles
    return projects.filter((p) => {
      if (p.name.toLowerCase().includes(q)) return true
      if (p.path.toLowerCase().includes(q)) return true
      // Check session titles matching this project
      const projectSessions = sessions.filter((s) => s.projectPath === p.path)
      return projectSessions.some((s) => s.title.toLowerCase().includes(q))
    })
  }, [projects, searchQuery, sessions])

  // Sessions for a specific project path (limited to 5, expandable)
  const getProjectSessions = (projectPath: string) => {
    return sessions
      .filter((s) => s.projectPath === projectPath)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  // Sessions created without a project binding (no folder was open at creation
  // time). They used to be invisible here — "conversations got lost" — so they
  // get their own group at the bottom of the list instead.
  const orphanSessions = useMemo(() => {
    let list = sessions.filter((s) => !s.projectPath)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter((s) => s.title.toLowerCase().includes(q))
    }
    return list.sort((a, b) => b.updatedAt - a.updatedAt)
  }, [sessions, searchQuery])

  const handleOpenFolder = async () => {
    const path = await window.electronAPI.openFolder()
    if (path) {
      setRootPath(path)
      enterProject(path)
    }
  }

  const handleEnterProject = (projectPath: string) => {
    setRootPath(projectPath)
    enterProject(projectPath)
  }

  /** "新建对话" on a project list item: the new conversation is bound to that
   *  project and becomes active, the workspace syncs to it — but the sidebar
   *  STAYS on the project list (the conversation list must not vanish). */
  const handleNewSessionForProject = (projectPath: string) => {
    const configId = useConfigStore.getState().activeConfigGroupId
    if (!configId) {
      useUIStore.getState().openSettings()
      return
    }
    createSession(configId, projectPath)
    setRootPath(projectPath)
    if (!useUIStore.getState().isChatVisible) useUIStore.getState().toggleChat()
  }

  const handleSessionClick = (sessionId: string) => {
    setActiveSession(sessionId)
    // Switch to chat panel
    const ui = useUIStore.getState()
    if (!ui.isChatVisible) ui.toggleChat()
  }

  // ───────────── VIEW: Project-internal file tree ─────────────
  if (projectListView === 'tree' && activeProjectPath) {
    return (
      <div className="h-full flex flex-col">
        {/* Back bar */}
        <button
          onClick={() => { backToProjectList(); setActiveSidebarTab('files') }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-nova-text-muted hover:text-nova-text-primary border-b border-nova-border transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          返回项目列表
        </button>
        {/* File tree */}
        <div className="flex-1 overflow-hidden">
          <FileTree rootPath={activeProjectPath} />
        </div>
      </div>
    )
  }

  // ───────────── VIEW: Project list ─────────────
  return (
    <div className="h-full flex flex-col">
      {/* Search — glass capsule with leading icon (Stitch 资源管理器) */}
      <div className="px-3 pt-2 pb-1">
        <div className="relative">
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-nova-text-muted pointer-events-none"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索项目或对话..."
            className="w-full bg-nova-input-bg border border-nova-border rounded-full py-1.5 pl-9 pr-4 text-[11px] text-nova-text-primary placeholder-nova-text-muted focus:border-nova-accent/60 focus:ring-2 focus:ring-nova-accent/20 focus:outline-none transition-all"
          />
        </div>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto py-0.5">
        {filteredProjects.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-nova-text-muted opacity-40 mb-3">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
            <div className="text-nova-text-muted text-xs mb-3">还没有打开项目</div>
            <button
              onClick={handleOpenFolder}
              className="px-4 py-2 bg-nova-accent text-white rounded-full text-sm font-semibold hover:scale-[1.02] hover:brightness-110 transition-all shadow-sm"
            >
              打开文件夹
            </button>
          </div>
        )}

        {filteredProjects.map((project, idx) => {
          const isCurrent = project.path === rootPath
          const projectSessions = getProjectSessions(project.path)
          const showMore = showMoreSessions.has(project.path)
          const visibleSessions = showMore ? projectSessions : projectSessions.slice(0, 5)
          const tile = PROJECT_TILES[idx % PROJECT_TILES.length]

          return (
            <div key={project.path} className="space-y-1">
              {/* Project card (Stitch: gradient tile + name + status badge) */}
              <div
                className={`group flex items-start gap-3 rounded-xl p-3 cursor-pointer transition-all border ${
                  isCurrent
                    ? 'bg-nova-accent/10 border-nova-accent/60'
                    : 'border-transparent hover:bg-white/50 dark:hover:bg-white/10 hover:border-glass-border'
                }`}
                onClick={() => handleEnterProject(project.path)}
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0 shadow-sm"
                  style={{ background: tile.bg }}
                >
                  <TileIcon name={tile.icon} size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-sm font-semibold text-nova-text-primary truncate pr-2">
                      {project.name}
                    </span>
                    {isCurrent ? (
                      <span className="bg-nova-accent text-white text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0">
                        当前
                      </span>
                    ) : (
                      project.lastOpened > 0 && (
                        <span className="bg-nova-hover text-nova-text-muted text-[9px] font-bold px-2 py-0.5 rounded-full tracking-wider shrink-0">
                          {formatTime(project.lastOpened)}
                        </span>
                      )
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-nova-text-muted truncate">
                    {project.path}
                  </div>
                </div>
                {/* 新建对话 — hover reveals */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleNewSessionForProject(project.path)
                  }}
                  className="p-1 rounded-full text-nova-text-muted hover:text-nova-accent hover:bg-nova-accent/10 transition-colors opacity-0 group-hover:opacity-100 shrink-0 self-center"
                  title={t('chat.newChat')}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </div>

              {/* Sessions under this project (Stitch: vertical connector line) */}
              {projectSessions.length > 0 && (
                <div className="pl-5 pr-2 space-y-0.5 relative before:content-[''] before:absolute before:left-3 before:top-2 before:bottom-2 before:w-px before:bg-glass-border">
                  {visibleSessions.map((session) => {
                    const isActive = session.id === activeSessionId
                    return (
                      <div
                        key={session.id}
                        className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                          isActive
                            ? 'bg-white/40 dark:bg-white/10 border border-nova-accent/20'
                            : 'hover:bg-white/40 dark:hover:bg-white/10'
                        }`}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSessionClick(session.id)
                        }}
                        title={`${session.title} · ${session.messages.length} 条消息`}
                      >
                        <SessionStatusDot
                          running={runningSessionIds.includes(session.id)}
                          needsAttention={attentionSessionIds.has(session.id)}
                          hasError={errorSessionIds.has(session.id)}
                        />
                        {session.pinnedAt && (
                          <span className="text-nova-accent shrink-0 flex">
                            <TileIcon name="pin" size={13} />
                          </span>
                        )}
                        <span className={`flex-1 truncate text-xs ${
                          isActive ? 'text-nova-accent font-medium' : 'text-nova-text-secondary'
                        }`}>
                          {session.title}
                        </span>
                        <span className="text-[10px] font-mono text-nova-text-muted shrink-0">
                          {formatTime(session.updatedAt)}
                        </span>
                      </div>
                    )
                  })}

                  {projectSessions.length > 5 && (
                    <button
                      className="flex items-center gap-1 pl-2 py-1 text-xs text-nova-accent hover:text-nova-accent/80 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowMoreSessions((prev) => {
                          const next = new Set(prev)
                          if (next.has(project.path)) next.delete(project.path)
                          else next.add(project.path)
                          return next
                        })
                      }}
                    >
                      {showMore ? '收起' : `展开剩余 ${projectSessions.length - 5} 条`}
                      <span className={`transition-transform ${showMore ? 'rotate-180' : ''}`}>
                        <TileIcon name="expandMore" size={12} />
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* Sessions without a project binding — keep them visible so history
            never "disappears" from the left panel (Stitch: divider + section) */}
        {orphanSessions.length > 0 && (
          <>
            <div className="h-px bg-glass-border w-full my-3" />
            <div className="pt-1">
              <h3 className="text-[11px] font-bold text-nova-text-muted tracking-wider uppercase mb-2 px-3">
                {t('chat.orphanSessions')} ({orphanSessions.length})
              </h3>
              <div className="space-y-1 px-1">
                {orphanSessions.map((session) => {
                  const isActive = session.id === activeSessionId
                  return (
                    <div
                      key={session.id}
                      className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-colors border ${
                        isActive
                          ? 'bg-white/40 dark:bg-white/10 border-nova-accent/20'
                          : 'border-transparent hover:bg-white/50 dark:hover:bg-white/10 hover:border-glass-border'
                      }`}
                      onClick={() => handleSessionClick(session.id)}
                      title={`${session.title} · ${session.messages.length} 条消息`}
                    >
                      <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 flex items-center justify-center text-nova-text-muted shrink-0">
                        <TileIcon name="forum" size={15} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs truncate ${isActive ? 'text-nova-accent font-medium' : 'text-nova-text-primary'}`}>
                          {session.title}
                        </div>
                        <div className="text-[10px] font-mono text-nova-text-muted mt-0.5">
                          {formatTime(session.updatedAt)}
                        </div>
                      </div>
                      {session.pinnedAt && (
                        <span className="text-nova-accent shrink-0 flex">
                          <TileIcon name="pin" size={12} />
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
