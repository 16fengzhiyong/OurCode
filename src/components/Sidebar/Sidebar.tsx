import { useMemo } from 'react'
import ProjectListPanel from './ProjectListPanel'
import FileChangesPanel from './FileChangesPanel'
import GitPanel from '../Git/GitPanel'
import { useUIStore } from '@/stores/uiStore'
import { useI18n } from '@/i18n/useI18n'

export default function Sidebar() {
  const { activeSidebarTab, toggleSidebar, rootPath, setRootPath, projectListView } = useUIStore()
  const t = useI18n()

  const handleOpenFolder = async () => {
    const path = await window.electronAPI.openFolder()
    if (path) {
      setRootPath(path)
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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 15" />
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
    <div className="h-full flex flex-col bg-nova-sidebar">
      {/* Sidebar Header */}
      <div
        className="flex items-center justify-between shrink-0"
        style={{ padding: '0 12px', height: 36, borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-nova-text-muted flex items-center">
            <HeaderIcon />
          </span>
          <span
            className="font-semibold uppercase tracking-wider"
            style={{ fontSize: 11, color: 'var(--text-secondary)', letterSpacing: '0.5px' }}
          >
            {headerTitle}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {activeSidebarTab === 'files' && (
            <button
              onClick={handleOpenFolder}
              className="w-6 h-6 flex items-center justify-center rounded text-nova-text-muted hover:text-nova-text-primary hover:bg-nova-hover transition-colors"
              title={t('sidebar.openFolder')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                <line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
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
        ) : null}
      </div>
    </div>
  )
}
