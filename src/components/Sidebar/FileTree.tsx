import { useState, useEffect, useCallback, useRef } from 'react'
import FileTreeNode from './FileTreeNode'
import { FileEntry } from '@/types'
import { useEditorStore } from '@/stores/editorStore'
import LoadingSpinner from '../Common/LoadingSpinner'
import { useI18n } from '@/i18n/useI18n'

interface FileTreeProps {
  rootPath: string
}

export default function FileTree({ rootPath }: FileTreeProps) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set([rootPath]))
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const { openFile } = useEditorStore()
  const activeFilePath = useEditorStore((s) => s.activeFilePath)
  const { showHiddenFiles } = useEditorStore((s) => s.preferences)
  const t = useI18n()

  // Drag scroll lock: while dragging a file, hold the tree's scroll position so
  // the browser's edge auto-scroll can't slide the whole tree up/down mid-drag.
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragLockTopRef = useRef<number | null>(null)

  // Mirror expandedDirs in a ref so the watcher callback never sees a stale closure
  const expandedDirsRef = useRef(expandedDirs)
  useEffect(() => { expandedDirsRef.current = expandedDirs }, [expandedDirs])

  const loadFiles = useCallback(async (dirPath: string) => {
    try {
      const entries = await window.electronAPI.listDir(dirPath)
      return entries
    } catch (error) {
      console.error('Failed to load files:', error)
      return []
    }
  }, [])

  // Load root files (and re-load children of every expanded directory, so a
  // watcher-triggered refresh does NOT flatten the tree)
  const refreshTree = useCallback(async (initial = false) => {
    if (initial) setIsLoading(true)
    const rootEntries = await loadFiles(rootPath)

    const rebuildChildren = async (entries: FileEntry[]): Promise<FileEntry[]> => {
      for (const entry of entries) {
        if (entry.isDirectory && expandedDirsRef.current.has(entry.path)) {
          const children = await loadFiles(entry.path)
          entry.children = await rebuildChildren(children)
        }
      }
      return entries
    }

    const tree = await rebuildChildren(rootEntries)
    setFiles(tree)
    if (initial) setIsLoading(false)
  }, [rootPath, loadFiles])

  // Fetch git status and apply to file entries
  const fetchGitStatus = useCallback(async () => {
    try {
      const result = await window.electronAPI.gitExec(rootPath, ['status', '--porcelain=v1'])
      if (!result.success) return
      const statusMap = new Map<string, string>()
      for (const line of result.output.split('\n').filter(Boolean)) {
        const status = line.slice(0, 2).trim()
        const filePath = line.slice(3)
        if (status === 'M' || status === 'MM') statusMap.set(filePath, 'modified')
        else if (status === 'A') statusMap.set(filePath, 'added')
        else if (status === 'D') statusMap.set(filePath, 'deleted')
        else if (status.startsWith('R')) statusMap.set(filePath, 'renamed')
        else if (status === '??') statusMap.set(filePath, 'added')
      }
      // Apply status to file entries
      setFiles(prev => applyGitStatus(prev, statusMap, rootPath))
    } catch { /* ignore git errors */ }
  }, [rootPath])

  // Watch for file changes, then load the tree. fs:* calls are rejected by the
  // main process until the root is registered (via this fs:watch), so the first
  // listDir must wait for it — a mount-time listDir that raced the watch used
  // to fail and leave the tree empty on every fresh open.
  useEffect(() => {
    let cancelled = false
    window.electronAPI.watch(rootPath)
      .then(() => {
        if (cancelled) return
        refreshTree(true)
        fetchGitStatus()
      })
      .catch(() => {
        // Watcher failed to start (e.g. MCP config error) — load the tree
        // anyway; the root may have been registered before the failure.
        if (!cancelled) refreshTree(true)
      })
    const unsubscribe = window.electronAPI.onFileChanged(() => {
      // Reload files while preserving the expanded directory structure
      refreshTree()
    })

    return () => {
      cancelled = true
      window.electronAPI.unwatch(rootPath)
      unsubscribe()
    }
  }, [rootPath, refreshTree, fetchGitStatus])

  // Git status badges refresh on a timer; the initial fetch happens once the
  // watcher is active (see the watch effect above, where the root is already
  // registered so the git call is not rejected).
  useEffect(() => {
    const interval = setInterval(fetchGitStatus, 15000)
    return () => clearInterval(interval)
  }, [fetchGitStatus])

  const toggleDir = async (path: string) => {
    const newExpanded = new Set(expandedDirs)
    if (newExpanded.has(path)) {
      newExpanded.delete(path)
    } else {
      newExpanded.add(path)
      // Load children if not loaded
      const entry = findEntry(files, path)
      if (entry && !entry.children) {
        const children = await loadFiles(path)
        updateEntryChildren(files, path, children)
        setFiles([...files])
      }
    }
    setExpandedDirs(newExpanded)
  }

  const handleFileClick = (path: string, isDirectory: boolean) => {
    if (isDirectory) {
      toggleDir(path)
    } else {
      openFile(path)
    }
  }

  const filteredFiles = searchQuery
    ? filterFiles(files, searchQuery)
    : showHiddenFiles
    ? files
    : files.filter((f) => !f.isHidden)

  return (
    <div className="h-full flex flex-col" id="file-tree-root" data-root-path={rootPath}>
      {/* Search — glass capsule with leading icon (Stitch 资源管理器) */}
      <div className="p-2 pb-1">
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
            placeholder={t('sidebar.searchFiles')}
            className="w-full bg-nova-input-bg border border-nova-border rounded-full py-1.5 pl-9 pr-4 text-[11px] text-nova-text-primary placeholder-nova-text-muted focus:border-accent-60 focus:ring-2 focus:ring-accent-20 focus:outline-none transition-all"
          />
        </div>
      </div>

      {/* File Tree */}
      <div
        ref={scrollRef}
        onDragStartCapture={() => {
          if (scrollRef.current) dragLockTopRef.current = scrollRef.current.scrollTop
        }}
        onDragEndCapture={() => { dragLockTopRef.current = null }}
        onScroll={() => {
          const lock = dragLockTopRef.current
          const el = scrollRef.current
          if (lock !== null && el && Math.abs(el.scrollTop - lock) > 1) el.scrollTop = lock
        }}
        className="flex-1 overflow-y-auto bg-white/95 dark:bg-black/40 shadow-inner"
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner size="md" text={t('sidebar.loading')} />
          </div>
        ) : (filteredFiles.map((entry) => (
          <FileTreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            isExpanded={expandedDirs.has(entry.path)}
            onToggle={toggleDir}
            onClick={handleFileClick}
            searchQuery={searchQuery}
            onRefresh={() => refreshTree()}
            activePath={activeFilePath}
          />
        )))}
      </div>
    </div>
  )
}

// Helper functions
function findEntry(entries: FileEntry[], path: string): FileEntry | null {
  for (const entry of entries) {
    if (entry.path === path) return entry
    if (entry.children) {
      const found = findEntry(entry.children, path)
      if (found) return found
    }
  }
  return null
}

function updateEntryChildren(entries: FileEntry[], path: string, children: FileEntry[]): boolean {
  for (const entry of entries) {
    if (entry.path === path) {
      entry.children = children
      return true
    }
    if (entry.children && updateEntryChildren(entry.children, path, children)) {
      return true
    }
  }
  return false
}

function filterFiles(entries: FileEntry[], query: string): FileEntry[] {
  const lowerQuery = query.toLowerCase()
  return entries.filter((entry) => {
    if (entry.name.toLowerCase().includes(lowerQuery)) return true
    if (entry.children) {
      entry.children = filterFiles(entry.children, query)
      return entry.children.length > 0
    }
    return false
  })
}

function applyGitStatus(entries: FileEntry[], statusMap: Map<string, string>, rootPath: string): FileEntry[] {
  return entries.map(entry => {
    const relativePath = entry.path.replace(rootPath + '/', '').replace(rootPath + '\\', '')
    const status = statusMap.get(relativePath) as FileEntry['gitStatus'] || null
    const updated = { ...entry, gitStatus: status }
    if (entry.children) {
      updated.children = applyGitStatus(entry.children, statusMap, rootPath)
    }
    return updated
  })
}
