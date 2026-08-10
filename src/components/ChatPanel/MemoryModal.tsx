import { useState, useMemo } from 'react'
import { useMemoryStore } from '@/stores/memoryStore'
import { useI18n } from '@/i18n/useI18n'

/**
 * Memory manager — project-aware. Memories are injected into the
 * agent's system prompt when they match the current message. Project-scoped
 * memories are only used when the current project matches.
 */
export default function MemoryModal({ onClose, currentProjectPath }: { onClose: () => void; currentProjectPath: string | null }) {
  const { memories, addMemory, deleteMemory, getMemoriesByProject, getGlobalMemories, getProjectPaths } = useMemoryStore()
  const [content, setContent] = useState('')
  const [scope, setScope] = useState<'global' | 'project'>('global')
  const [justAdded, setJustAdded] = useState<string | null>(null)
  const [filterTab, setFilterTab] = useState<'all' | 'global' | 'project'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showOtherProjects, setShowOtherProjects] = useState(false)
  const t = useI18n()

  const projectName = currentProjectPath ? currentProjectPath.split(/[/\\]/).pop() || currentProjectPath : null
  const hasProject = !!currentProjectPath

  // Filtered & grouped memories
  const { filteredMemories, currentProjectMemories, globalMemories, otherProjectPaths } = useMemo(() => {
    let filtered = [...memories]
    if (filterTab === 'global') filtered = getGlobalMemories()
    else if (filterTab === 'project') filtered = memories.filter((m) => m.scope === 'project')
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter((m) => m.content.toLowerCase().includes(q))
    }
    // Sort: newest first
    filtered.sort((a, b) => b.createdAt - a.createdAt)

    const currentProj = currentProjectPath ? getMemoriesByProject(currentProjectPath) : []
    const global = getGlobalMemories()
    const allPaths = getProjectPaths()
    const other = allPaths.filter((p) => p !== currentProjectPath)

    return {
      filteredMemories: filtered,
      currentProjectMemories: currentProj,
      globalMemories: global,
      otherProjectPaths: other,
    }
  }, [memories, filterTab, searchQuery, currentProjectPath, getMemoriesByProject, getGlobalMemories, getProjectPaths])

  const handleAdd = async () => {
    if (!content.trim()) return
    if (scope === 'project' && !hasProject) return
    try {
      await addMemory(content.trim(), scope, scope === 'project' ? currentProjectPath || undefined : undefined)
      setContent('')
      setJustAdded(t('chat.memorySaved'))
      setTimeout(() => setJustAdded(null), 2000)
    } catch (error) {
      setJustAdded(`${t('chat.rememberError')}: ${error instanceof Error ? error.message : String(error)}`)
      setTimeout(() => setJustAdded(null), 4000)
    }
  }

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const shortenPath = (p: string) => {
    const parts = p.split(/[/\\]/)
    if (parts.length <= 2) return p
    return '.../' + parts.slice(-2).join('/')
  }

  const tabCounts = {
    all: memories.length,
    global: globalMemories.length,
    project: memories.filter((m) => m.scope === 'project').length,
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="w-[640px] max-w-[94vw] max-h-[85vh] flex flex-col rounded-2xl glass-modal" style={{ boxShadow: 'var(--shadow-xl)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-nova-border shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">🧠</span>
            <div>
              <strong className="text-sm text-nova-text-primary">{t('chat.memory')}</strong>
              <div className="text-[10px] text-nova-text-muted">
                {memories.length} 条记忆 · {globalMemories.length} 全局 · {tabCounts.project} 项目
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-nova-text-muted hover:text-nova-text-primary hover:bg-nova-hover p-1 rounded transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Project context bar */}
        <div className={`px-5 py-2 border-b shrink-0 flex items-center gap-2 text-[11px] ${
          hasProject ? 'bg-green-500/5 border-green-500/20' : 'bg-yellow-500/5 border-yellow-500/20'
        }`}>
          {hasProject ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-nova-text-secondary">当前项目:</span>
              <span className="font-medium text-nova-text-primary truncate">{projectName}</span>
              <span className="text-nova-text-muted ml-auto shrink-0">{currentProjectMemories.length} 条项目记忆</span>
            </>
          ) : (
            <>
              <span className="text-yellow-400">⚠️</span>
              <span className="text-yellow-400/80">未打开项目 — 项目范围记忆不可用</span>
            </>
          )}
        </div>

        {/* Filter tabs + search */}
        <div className="px-5 py-2.5 border-b border-nova-border shrink-0 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 bg-nova-hover rounded-lg p-0.5">
              {([
                { key: 'all' as const, label: '全部', icon: '📋' },
                { key: 'global' as const, label: '全局', icon: '🌐' },
                { key: 'project' as const, label: '项目', icon: '📁' },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setFilterTab(tab.key)}
                  className={`flex items-center gap-1 px-3 py-1 text-xs rounded-md transition-colors ${
                    filterTab === tab.key
                      ? 'bg-nova-card text-nova-text-primary shadow-sm'
                      : 'text-nova-text-muted hover:text-nova-text-secondary'
                  }`}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                  <span className="text-[10px] opacity-60">({tabCounts[tab.key]})</span>
                </button>
              ))}
            </div>
            <div className="flex-1 relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-nova-text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8" strokeWidth="2" /><line x1="21" y1="21" x2="16.65" y2="16.65" strokeWidth="2" />
              </svg>
              <input
                type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索记忆..."
                className="w-full pl-7 pr-2 py-1.5 bg-nova-input-bg border border-nova-border rounded-full text-[11px] text-nova-text-primary outline-none focus:border-nova-accent/50 placeholder-nova-text-muted"
              />
            </div>
          </div>
        </div>

        {/* Memory list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {filteredMemories.length === 0 ? (
            <div className="text-center py-10">
              <div className="text-3xl mb-2">🧠</div>
              <div className="text-sm text-nova-text-muted mb-1">
                {searchQuery ? '没有匹配的记忆' : filterTab === 'project' && !hasProject ? '未打开项目' : t('chat.memoryEmpty')}
              </div>
              <div className="text-[11px] text-nova-text-muted">
                {searchQuery ? '尝试其他关键词' : '添加你的第一条记忆，AI 助手将记住你的偏好'}
              </div>
            </div>
          ) : (
            <>
              {/* Current project memories section */}
              {filterTab === 'all' && currentProjectPath && currentProjectMemories.length > 0 && (
                <div className="mb-1">
                  <div className="flex items-center gap-1.5 mb-1.5 px-1">
                    <span className="text-[10px]">📁</span>
                    <span className="text-[10px] font-semibold text-nova-text-muted uppercase tracking-wider">当前项目 · {projectName}</span>
                  </div>
                  {currentProjectMemories.filter((m) => !searchQuery || m.content.toLowerCase().includes(searchQuery.toLowerCase())).map((m) => (
                    <MemoryCard key={m.id} memory={m} onDelete={deleteMemory} formatDate={formatDate} isProject />
                  ))}
                </div>
              )}

              {/* Global memories section */}
              {filterTab === 'all' && globalMemories.length > 0 && (
                <div className="mb-1">
                  <div className="flex items-center gap-1.5 mb-1.5 px-1">
                    <span className="text-[10px]">🌐</span>
                    <span className="text-[10px] font-semibold text-nova-text-muted uppercase tracking-wider">全局记忆</span>
                  </div>
                  {globalMemories.filter((m) => !searchQuery || m.content.toLowerCase().includes(searchQuery.toLowerCase())).map((m) => (
                    <MemoryCard key={m.id} memory={m} onDelete={deleteMemory} formatDate={formatDate} />
                  ))}
                </div>
              )}

              {/* Other projects section (collapsible) */}
              {filterTab === 'all' && otherProjectPaths.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowOtherProjects(!showOtherProjects)}
                    className="flex items-center gap-1.5 px-1 py-1 text-[10px] font-semibold text-nova-text-muted uppercase tracking-wider hover:text-nova-text-secondary transition-colors w-full text-left"
                  >
                    <span>{showOtherProjects ? '▾' : '▸'}</span>
                    <span>📂</span>
                    <span>其他项目记忆 ({otherProjectPaths.length})</span>
                  </button>
                  {showOtherProjects && otherProjectPaths.map((projPath) => {
                    const projMemories = memories.filter((m) => m.scope === 'project' && m.projectPath === projPath && (!searchQuery || m.content.toLowerCase().includes(searchQuery.toLowerCase())))
                    if (projMemories.length === 0) return null
                    return (
                      <div key={projPath} className="ml-4 mb-1">
                        <div className="text-[10px] text-nova-text-muted px-1 py-0.5 truncate">{shortenPath(projPath)}</div>
                        {projMemories.map((m) => (
                          <MemoryCard key={m.id} memory={m} onDelete={deleteMemory} formatDate={formatDate} isProject />
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Flat list for filtered tabs */}
              {(filterTab !== 'all') && filteredMemories.map((m) => (
                <MemoryCard key={m.id} memory={m} onDelete={deleteMemory} formatDate={formatDate} isProject={m.scope === 'project'} projectPath={m.projectPath} shortenPath={shortenPath} />
              ))}
            </>
          )}
        </div>

        {/* Add memory form */}
        <div className="px-5 py-4 border-t border-nova-border shrink-0 space-y-2">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleAdd() }}
            placeholder={hasProject ? t('chat.memoryPlaceholder') : '请先打开项目后再添加项目范围记忆'}
            rows={2}
            className="w-full px-3 py-2 text-sm bg-nova-bg border border-nova-border rounded-lg outline-none focus:border-nova-accent/60 text-nova-text-primary placeholder:text-nova-text-muted resize-none"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as 'global' | 'project')}
                className="text-xs bg-nova-input-bg text-nova-text-primary border border-nova-border rounded px-2 py-1.5 outline-none"
              >
                <option value="global">{t('chat.scopeGlobalAll')}</option>
                <option value="project" disabled={!hasProject}>
                  {t('chat.scopeProjectOnly')}{!hasProject ? ' (需要打开项目)' : ''}
                </option>
              </select>
              {!hasProject && scope === 'project' && (
                <span className="text-[10px] text-yellow-400">请先打开项目</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {justAdded && <span className="text-xs text-green-400 animate-fade-in">{justAdded}</span>}
              <button
                onClick={handleAdd}
                disabled={!content.trim() || (scope === 'project' && !hasProject)}
                className="px-4 py-1.5 text-xs text-white rounded-full disabled:opacity-30 hover:opacity-90 transition-all shadow-sm" style={{ background: 'var(--grad-brand)' }}
              >
                {t('chat.saveMemory')}
              </button>
            </div>
          </div>
          <div className="text-[10px] text-nova-text-muted">
            Ctrl+Enter 快速保存 · 全局记忆在所有项目中生效 · 项目记忆仅在当前项目中生效
          </div>
        </div>
      </div>
    </div>
  )
}

/** Single memory card */
function MemoryCard({ memory, onDelete, formatDate, isProject, projectPath, shortenPath }: {
  memory: import('@/types').Memory
  onDelete: (id: string) => void
  formatDate: (ts: number) => string
  isProject?: boolean
  projectPath?: string
  shortenPath?: (p: string) => string
}) {
  const [expanded, setExpanded] = useState(false)
  const isLong = memory.content.length > 120

  return (
    <div className="flex items-start gap-2 rounded-xl border border-nova-border bg-nova-card/60 px-3 py-2.5 group hover:border-nova-accent/40 hover:shadow-sm transition-all mb-1.5">
      <span
        className={`mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full shrink-0 font-medium ${
          isProject ? 'bg-purple-500/15 text-purple-400' : 'bg-blue-500/15 text-blue-400'
        }`}
      >
        {isProject ? '📁 项目' : '🌐 全局'}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-nova-text-primary whitespace-pre-wrap break-all">
          {isLong && !expanded ? memory.content.slice(0, 120) + '...' : memory.content}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] text-nova-text-muted">{formatDate(memory.createdAt)}</span>
          {isProject && projectPath && shortenPath && (
            <span className="text-[10px] text-nova-text-muted truncate">{shortenPath(projectPath)}</span>
          )}
          {isLong && (
            <button onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-nova-accent hover:underline">
              {expanded ? '收起' : '展开'}
            </button>
          )}
        </div>
      </div>
      <button
        onClick={() => onDelete(memory.id)}
        className="opacity-0 group-hover:opacity-100 text-nova-text-muted hover:text-red-400 transition-all shrink-0 p-0.5"
        title="删除记忆"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  )
}
