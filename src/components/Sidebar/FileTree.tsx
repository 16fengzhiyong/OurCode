import { useState, useEffect, useCallback, useRef } from 'react'
import FileTreeNode from './FileTreeNode'
import { FileEntry } from '@/types'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import LoadingSpinner from '../Common/LoadingSpinner'

interface FileTreeProps {
  rootPath: string
}

export default function FileTree({ rootPath }: FileTreeProps) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set([rootPath]))
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const { openFile } = useEditorStore()
  const { showHiddenFiles } = useEditorStore((s) => s.preferences)

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

  // Load root files
  useEffect(() => {
    refreshTree(true)
  }, [refreshTree])

  // Watch for file changes
  useEffect(() => {
    window.electronAPI.watch(rootPath)
    const unsubscribe = window.electronAPI.onFileChanged(() => {
      // Reload files while preserving the expanded directory structure
      refreshTree()
    })

    return () => {
      window.electronAPI.unwatch(rootPath)
      unsubscribe()
    }
  }, [rootPath, refreshTree])

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

  useEffect(() => {
    fetchGitStatus()
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
      {/* Search */}
      <div className="p-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索文件..."
          className="w-full px-2 py-1 bg-nova-input border border-nova-border rounded text-sm text-nova-text-primary placeholder-nova-text-muted focus:border-nova-accent/50 focus:outline-none transition-colors"
        />
      </div>

      {/* File Tree */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner size="md" text="加载文件中..." />
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
