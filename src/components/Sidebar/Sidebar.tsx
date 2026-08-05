import FileTree from './FileTree'
import SearchPanel from '../SearchPanel/SearchPanel'
import GitPanel from '../Git/GitPanel'
import { useUIStore } from '@/stores/uiStore'

export default function Sidebar() {
  const { activeSidebarTab, toggleSidebar, rootPath, setRootPath } = useUIStore()

  const handleOpenFolder = async () => {
    const path = await window.electronAPI.openFolder()
    if (path) {
      setRootPath(path)
    }
  }

  const headerTitle = activeSidebarTab === 'files' ? '资源管理器' : activeSidebarTab === 'search' ? '搜索' : '源代码管理'

  return (
    <div className="h-full flex flex-col bg-nova-sidebar">
      {/* Sidebar Header */}
      <div className="flex items-center justify-between px-3 h-10 border-b border-nova-border">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-nova-text-muted">{headerTitle}</span>
          <button
            onClick={handleOpenFolder}
            className="text-nova-text-muted hover:text-nova-accent transition-colors p-0.5 rounded hover:bg-nova-hover/50"
            title="打开文件夹"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <line x1="9" y1="14" x2="15" y2="14" />
            </svg>
          </button>
        </div>
        <button
          onClick={toggleSidebar}
          className="text-nova-text-muted hover:text-nova-text-primary transition-colors p-0.5 rounded hover:bg-nova-hover/50"
          title="收起侧边栏 (Ctrl+B)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeSidebarTab === 'files' ? (
          rootPath ? (
            <FileTree rootPath={rootPath} />
          ) : (
            <div className="h-full flex flex-col items-center justify-center p-4 text-center">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-nova-text-muted opacity-50 mb-3">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              <div className="text-nova-text-muted text-xs mb-4">未打开文件夹</div>
              <button
                onClick={handleOpenFolder}
                className="px-4 py-2 bg-nova-accent text-white rounded-lg text-sm hover:opacity-90 transition-opacity"
              >
                打开文件夹
              </button>
              <div className="text-nova-text-muted text-[11px] mt-4">
                或使用 <kbd className="px-1.5 py-0.5 bg-nova-hover rounded text-[10px]">Ctrl+O</kbd>
              </div>
            </div>
          )
        ) : activeSidebarTab === 'search' ? (
          <SearchPanel />
        ) : (
          <GitPanel />
        )}
      </div>
    </div>
  )
}
