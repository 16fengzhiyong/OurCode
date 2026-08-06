import { useState, useMemo } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import FileTree from './FileTree'
import { useI18n } from '@/i18n/useI18n'

/** Color palette for project icons */
const PROJECT_COLORS = [
  { bg: 'rgba(37,99,235,0.15)', fg: '#2563eb' },
  { bg: 'rgba(168,85,247,0.15)', fg: '#a855f7' },
  { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e' },
  { bg: 'rgba(251,146,60,0.15)', fg: '#fb923c' },
  { bg: 'rgba(244,114,182,0.15)', fg: '#f472b6' },
  { bg: 'rgba(34,211,238,0.15)', fg: '#22d3ee' },
  { bg: 'rgba(250,204,21,0.15)', fg: '#facc15' },
]

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

export default function ProjectListPanel() {
  const {
    rootPath, setRootPath, recentProjects, projectListView, activeProjectPath,
    enterProject, backToProjectList, setActiveSidebarTab,
  } = useUIStore()
  const sessions = useChatStore((s) => s.sessions)
  const setActiveSession = useChatStore((s) => s.setActiveSession)
  const t = useI18n()

  const [searchQuery, setSearchQuery] = useState('')
  const [showMoreSessions, setShowMoreSessions] = useState<Set<string>>(new Set())

  // Collect unique projects from recentProjects + sessions' projectPath
  const projects = useMemo(() => {
    const map = new Map<string, { name: string; path: string; lastOpened: number; sessionCount: number }>()

    // Add all recently opened projects (ordered by recency)
    for (const rp of recentProjects) {
      const name = rp.split(/[/\\]/).pop() || rp
      map.set(rp, { name, path: rp, lastOpened: 0, sessionCount: 0 })
    }

    // Collect from sessions (enrich with session count + update lastOpened)
    for (const s of sessions) {
      if (!s.projectPath) continue
      if (!map.has(s.projectPath)) {
        const name = s.projectPath.split(/[/\\]/).pop() || s.projectPath
        map.set(s.projectPath, { name, path: s.projectPath, lastOpened: s.updatedAt, sessionCount: 1 })
      } else {
        const entry = map.get(s.projectPath)!
        entry.sessionCount++
        if (s.updatedAt > entry.lastOpened) entry.lastOpened = s.updatedAt
      }
    }

    // For projects without sessions, use their position in recentProjects as lastOpened
    let recencyIndex = recentProjects.length
    for (const [path, info] of map) {
      if (info.lastOpened === 0) {
        const idx = recentProjects.indexOf(path)
        info.lastOpened = idx >= 0 ? (recentProjects.length - idx) * 1000 : 0
      }
    }

    // Sort by lastOpened desc
    return Array.from(map.entries())
      .map(([path, info]) => ({ ...info, path }))
      .sort((a, b) => b.lastOpened - a.lastOpened)
  }, [recentProjects, sessions])

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

  const handleSessionClick = (sessionId: string) => {
    setActiveSession(sessionId)
    // Switch to chat panel
    const ui = useUIStore.getState()
    if (!ui.isChatVisible) ui.toggleChat()
  }

  // ───────────── VIEW: Project-internal file tree ─────────────
  if (projectListView === 'tree' && activeProjectPath) {
    const projectName = activeProjectPath.split(/[/\\]/).pop() || activeProjectPath

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
      {/* Search */}
      <div className="px-3 pt-2 pb-1">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索项目或对话..."
          className="w-full px-2.5 py-1.5 text-[11px] bg-nova-input-bg border border-nova-border rounded-md text-nova-text-primary placeholder-nova-text-muted focus:border-nova-accent/50 focus:outline-none transition-colors"
        />
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
              className="px-4 py-2 bg-nova-accent text-white rounded-lg text-sm hover:opacity-90 transition-opacity"
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
          const color = PROJECT_COLORS[idx % PROJECT_COLORS.length]

          return (
            <div key={project.path}>
              {/* Project item — click enters file tree */}
              <div
                className={`flex items-center gap-2.5 px-3 py-2.5 mx-1.5 rounded-lg cursor-pointer transition-all border ${
                  isCurrent
                    ? 'bg-nova-accent/10 border-nova-accent/40'
                    : 'border-transparent hover:bg-white/[0.03] hover:border-nova-border'
                }`}
                onClick={() => handleEnterProject(project.path)}
              >
                <div
                  className="w-8 h-8 rounded-md flex items-center justify-center text-sm font-bold shrink-0"
                  style={{ background: color.bg, color: color.fg }}
                >
                  {project.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-nova-text-primary truncate">
                    {project.name}
                  </div>
                  <div className="text-[10px] text-nova-text-muted truncate font-mono mt-0.5">
                    {project.path}
                  </div>
                </div>
                {isCurrent ? (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-nova-accent/15 text-nova-accent shrink-0">
                    当前
                  </span>
                ) : (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-nova-hover text-nova-text-muted shrink-0">
                    {formatTime(project.lastOpened)}
                  </span>
                )}
              </div>

              {/* Sessions under this project — always visible, filtered by projectPath */}
              {projectSessions.length > 0 && (
                <div className="ml-6 pl-2 border-l border-nova-border mb-0.5">
                  {visibleSessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex items-center gap-1.5 px-2 py-1 mx-0.5 rounded cursor-pointer hover:bg-white/[0.03] transition-colors text-[11px]"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleSessionClick(session.id)
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: color.fg }}
                      />
                      <span className="flex-1 truncate text-nova-text-secondary">
                        {session.title}
                      </span>
                      <span className="text-[9px] text-nova-text-muted shrink-0">
                        {formatTime(session.updatedAt)}
                      </span>
                    </div>
                  ))}

                  {projectSessions.length > 5 && (
                    <button
                      className="text-[10px] text-nova-accent hover:bg-nova-accent/10 px-2 py-1 rounded transition-colors w-full text-left"
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
                      {showMore ? '收起 ▲' : `展开剩余 ${projectSessions.length - 5} 条 ▼`}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
