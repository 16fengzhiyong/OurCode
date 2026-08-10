import { useState, useMemo } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'
import FileTree from './FileTree'
import projectLogo from '@/assets/ourcode-logo.png'
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

/** Leading status indicator for a session row — priority: needs-input bubble
 *  (需求 3) > running spinner (需求 2) > plain dot. */
function SessionStatusDot({ running, needsAttention, color }: {
  running: boolean
  needsAttention: boolean
  color?: string
}) {
  if (needsAttention) {
    // Message-bubble icon: this conversation is waiting for the user
    return (
      <span className="shrink-0" style={{ color: color || 'var(--accent)' }} title="该会话需要处理">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </span>
    )
  }
  if (running) {
    return <span className="w-2 h-2 border-2 border-nova-accent/40 border-t-nova-accent rounded-full animate-spin shrink-0" />
  }
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${color ? '' : 'bg-nova-text-muted/50'}`}
      style={color ? { background: color } : undefined}
    />
  )
}

export default function ProjectListPanel() {
  const {
    rootPath, setRootPath, recentProjects, projectListView, activeProjectPath,
    enterProject, backToProjectList, setActiveSidebarTab,
  } = useUIStore()
  const sessions = useChatStore((s) => s.sessions)
  const runningSessionIds = useChatStore((s) => s.runningSessionIds)
  const pendingQuestion = useChatStore((s) => s.pendingQuestion)
  const pendingApproval = useChatStore((s) => s.pendingApproval)
  const batchApproval = useChatStore((s) => s.batchApproval)
  const setActiveSession = useChatStore((s) => s.setActiveSession)
  const createSession = useChatStore((s) => s.createSession)
  const t = useI18n()

  const [searchQuery, setSearchQuery] = useState('')
  const [showMoreSessions, setShowMoreSessions] = useState<Set<string>>(new Set())

  // Sessions waiting on the user (question / tool approval / batch approval /
  // plan approval) — shown as a message-bubble icon in the list (需求 3).
  const attentionSessionIds = useMemo(() => {
    const ids = new Set<string>()
    if (pendingQuestion?.sessionId) ids.add(pendingQuestion.sessionId)
    if (pendingApproval?.sessionId) ids.add(pendingApproval.sessionId)
    if (batchApproval?.sessionId) ids.add(batchApproval.sessionId)
    for (const s of sessions) if (s.planStatus === 'pending_approval') ids.add(s.id)
    return ids
  }, [pendingQuestion, pendingApproval, batchApproval, sessions])

  // Collect unique projects from recentProjects + sessions' projectPath.
  // Recently opened projects keep their open-order (most recent first) so the
  // list doesn't re-sort/jump when a chat session is created or updated —
  // previously a new session bumped the project's recency key and the whole
  // list shifted, which read as "the project list collapses by itself".
  const projects = useMemo(() => {
    const map = new Map<string, { name: string; path: string; lastOpened: number; sessionCount: number }>()

    // Recently opened projects keep their open-order (most recent first) with a
    // stable recency key, so creating/updating sessions never re-sorts the list.
    recentProjects.forEach((rp, idx) => {
      const name = rp.split(/[/\\]/).pop() || rp
      map.set(rp, { name, path: rp, lastOpened: (recentProjects.length - idx) * 1000, sessionCount: 0 })
    })

    // Projects only known from chat sessions go after the recent ones, ordered
    // by their latest session activity.
    const sessionOnly: Array<{ name: string; path: string; lastOpened: number; sessionCount: number }> = []
    const byPath = new Map<string, { name: string; path: string; lastOpened: number; sessionCount: number }>()

    for (const s of sessions) {
      if (!s.projectPath) continue
      if (map.has(s.projectPath)) {
        map.get(s.projectPath)!.sessionCount++
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
                className={`group flex items-center gap-2.5 px-3 py-2.5 mx-1.5 rounded-lg cursor-pointer transition-all border ${
                  isCurrent
                    ? 'bg-nova-accent/10 border-nova-accent/40'
                    : 'border-transparent hover:bg-nova-hover hover:border-nova-border'
                }`}
                onClick={() => handleEnterProject(project.path)}
              >
                <img
                  src={projectLogo}
                  alt={project.name}
                  className="w-8 h-8 rounded-md object-cover shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-nova-text-primary truncate">
                    {project.name}
                  </div>
                  <div className="text-[10px] text-nova-text-muted truncate font-mono mt-0.5">
                    {project.path}
                  </div>
                </div>
                {/* 新建对话 — the right-panel new-chat button now lives on each
                    project item (hover reveals it) */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleNewSessionForProject(project.path)
                  }}
                  className="p-1 rounded text-nova-text-muted hover:text-nova-accent hover:bg-nova-accent/10 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                  title={t('chat.newChat')}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
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
                      className="flex items-center gap-1.5 px-2 py-1 mx-0.5 rounded cursor-pointer hover:bg-nova-hover transition-colors text-[11px]"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleSessionClick(session.id)
                      }}
                    >
                      <SessionStatusDot
                        running={runningSessionIds.includes(session.id)}
                        needsAttention={attentionSessionIds.has(session.id)}
                        color={color.fg}
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

        {/* Sessions without a project binding — keep them visible so history
            never "disappears" from the left panel */}
        {orphanSessions.length > 0 && (
          <div className="mt-2 pt-2 border-t border-nova-border mx-1.5">
            <div className="px-2 pb-1 text-[10px] font-medium text-nova-text-muted uppercase tracking-wider">
              {t('chat.orphanSessions')} ({orphanSessions.length})
            </div>
            {orphanSessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center gap-1.5 px-2 py-1 mx-0.5 rounded cursor-pointer hover:bg-nova-hover transition-colors text-[11px]"
                onClick={() => handleSessionClick(session.id)}
              >
                <SessionStatusDot
                  running={runningSessionIds.includes(session.id)}
                  needsAttention={attentionSessionIds.has(session.id)}
                />
                <span className="flex-1 truncate text-nova-text-secondary">
                  {session.title}
                </span>
                <span className="text-[9px] text-nova-text-muted shrink-0">
                  {formatTime(session.updatedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
