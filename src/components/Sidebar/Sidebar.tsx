import { useMemo } from 'react'
import ProjectListPanel from './ProjectListPanel'
import FileChangesPanel from './FileChangesPanel'
import AgentTasksPanel from './AgentTasksPanel'
import UsagePanel from './UsagePanel'
import GitPanel from '../Git/GitPanel'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'
import { useI18n } from '@/i18n/useI18n'

export default function Sidebar() {
  const { activeSidebarTab, toggleSidebar, rootPath, projectListView } = useUIStore()
  const t = useI18n()

  // New chat lives here now (per project item in the list view, header button
  // in the tree view) — the old "打开文件夹" quick icon is gone.
  const handleNewSession = () => {
    const configId = useConfigStore.getState().activeConfigGroupId
    if (configId) {
      useChatStore.getState().createSession(configId)
    } else {
      useUIStore.getState().openSettings()
    }
  }

  const headerTitle = useMemo(() => {
    switch (activeSidebarTab) {
      case 'files':
        return projectListView === 'tree' && rootPath
          ? (rootPath.split(/[/\\]/).pop() || '项目')
          : '项目列表'
      case 'git':
        return '代码管理'
      case 'changes':
        return '文件变更历史'
      case 'agent':
        return t('agent.tasksPanelTitle')
      case 'usage':
        return t('usage.panelTitle')
      case 'extensions':
        return '扩展'
      default:
        return ''
    }
  }, [activeSidebarTab, projectListView, rootPath])

  // Sidebar header icon
  const HeaderIcon = () => {
    if (activeSidebarTab === 'files') {
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      )
    }
    if (activeSidebarTab === 'git') {
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" />
          <line x1="6" y1="8.5" x2="6" y2="15.5" />
          <path d="M6 12C6 12 12 9 15.5 6" /><path d="M6 12C6 12 12 15 15.5 18" />
        </svg>
      )
    }
    if (activeSidebarTab === 'changes') {
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
          <path d="M14 2v6h6" />
          <path d="M12.2 17.8l.9-2.6 4.2-4.2 1.7 1.7-4.2 4.2-2.6.9z" />
        </svg>
      )
    }
    if (activeSidebarTab === 'agent') {
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="8" width="16" height="12" rx="2" />
          <path d="M12 8V4" />
          <circle cx="12" cy="3" r="1.2" />
          <path d="M9 13h.01M15 13h.01M9 17h6" />
        </svg>
      )
    }
    if (activeSidebarTab === 'usage') {
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="20" x2="4" y2="14" />
          <line x1="10" y1="20" x2="10" y2="6" />
          <line x1="16" y1="20" x2="16" y2="11" />
          <line x1="22" y1="20" x2="22" y2="3" />
          <path d="M2 20h22" />
        </svg>
      )
    }
    if (activeSidebarTab === 'extensions') {
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="2" width="8" height="8" rx="1.2" /><rect x="14" y="2" width="8" height="8" rx="1.2" />
          <rect x="2" y="14" width="8" height="8" rx="1.2" />
          <line x1="17" y1="14" x2="23" y2="14" /><line x1="20" y1="11" x2="20" y2="17" />
        </svg>
      )
    }
    return null
  }

  return (
    <div className="h-full flex flex-col bg-transparent">
      {/* Sidebar Header */}
      <div
        className="flex items-center justify-between shrink-0"
        style={{ padding: '0 12px', height: 36 }}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-nova-text-muted flex items-center">
            <HeaderIcon />
          </span>
          <span
            className="font-bold uppercase tracking-[0.08em]"
            style={{ fontSize: 11, color: 'var(--text-secondary)', letterSpacing: '0.08em' }}
          >
            {headerTitle}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {activeSidebarTab === 'files' && projectListView === 'tree' && (
            <button
              onClick={handleNewSession}
              className="w-6 h-6 flex items-center justify-center rounded text-nova-text-muted hover:text-nova-text-primary hover:bg-nova-hover transition-colors"
              title={t('chat.newChat')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          )}
          {activeSidebarTab === 'changes' && (
            <button
              onClick={() => window.location.reload()}
              className="w-6 h-6 flex items-center justify-center rounded text-nova-text-muted hover:text-nova-text-primary hover:bg-nova-hover transition-colors"
              title="刷新"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
          )}
          <button
            onClick={toggleSidebar}
            className="w-6 h-6 flex items-center justify-center rounded text-nova-text-muted hover:text-nova-text-primary hover:bg-nova-hover transition-colors"
            title={t('sidebar.collapse')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeSidebarTab === 'files' ? (
          <ProjectListPanel />
        ) : activeSidebarTab === 'git' ? (
          <GitPanel />
        ) : activeSidebarTab === 'changes' ? (
          <FileChangesPanel />
        ) : activeSidebarTab === 'agent' ? (
          <AgentTasksPanel />
        ) : activeSidebarTab === 'usage' ? (
          <UsagePanel />
        ) : null}
      </div>
    </div>
  )
}
