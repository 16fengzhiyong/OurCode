import { useState, useMemo } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { useEditorStore } from '@/stores/editorStore'
import DiffView from '../Editor/DiffView'
import type { ChatSession } from '@/types'

/** File-modifying tool names */
const FILE_EDIT_TOOLS = new Set(['write_file', 'edit_file', 'delete_file', 'create_directory'])

interface FileChange {
  sessionId: string
  sessionTitle: string
  sessionTime: number
  filePath: string
  fileName: string
  toolName: string
  messageId: string
  checkpointId?: string
}

/** Extract changed files from a session's messages (toolCalls) */
function extractFileChanges(session: ChatSession): FileChange[] {
  const changes: FileChange[] = []
  for (const msg of session.messages) {
    if (!msg.toolCalls) continue
    for (const tc of msg.toolCalls) {
      if (!FILE_EDIT_TOOLS.has(tc.name)) continue
      const fp = tc.arguments?.path || tc.arguments?.filePath || tc.arguments?.target
      if (!fp || typeof fp !== 'string') continue
      changes.push({
        sessionId: session.id,
        sessionTitle: session.title,
        sessionTime: session.updatedAt,
        filePath: fp,
        fileName: fp.split(/[/\\]/).pop() || fp,
        toolName: tc.name,
        messageId: msg.id,
      })
    }
  }
  return changes
}

/** Format time for session headers */
function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) return '今天 ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

/** Resolve repo-relative path to absolute */
function resolvePath(relative: string): string {
  const rootPath = useUIStore.getState().rootPath
  if (!rootPath) return relative
  const sep = rootPath.includes('/') ? '/' : '\\'
  // If already absolute
  if (relative.startsWith(rootPath)) return relative
  return rootPath.replace(/[/\\]$/, '') + sep + relative
}

export default function FileChangesPanel() {
  const sessions = useChatStore((s) => s.sessions)
  const checkpoints = useChatStore((s) => s.checkpoints)
  const loadCheckpoints = useChatStore((s) => s.loadCheckpoints)
  const revertCheckpoint = useChatStore((s) => s.revertCheckpoint)
  const { openFile } = useEditorStore()

  const [diffSession, setDiffSession] = useState<FileChange | null>(null)
  const [diffContent, setDiffContent] = useState<{ original: string; modified: string; language: string } | null>(null)

  // Group file changes by session
  const groupedChanges = useMemo(() => {
    const groups: Array<{ sessionId: string; title: string; time: number; changes: FileChange[] }> = []
    const seen = new Map<string, FileChange[]>()

    for (const session of sessions) {
      const changes = extractFileChanges(session)
      if (changes.length === 0) continue
      seen.set(session.id, changes)
    }

    // Sort sessions by time desc
    const sorted = Array.from(seen.entries()).sort((a, b) => {
      const sa = sessions.find((s) => s.id === a[0])
      const sb = sessions.find((s) => s.id === b[0])
      return (sb?.updatedAt || 0) - (sa?.updatedAt || 0)
    })

    for (const [sessionId, changes] of sorted) {
      const session = sessions.find((s) => s.id === sessionId)
      if (!session) continue
      groups.push({
        sessionId,
        title: session.title,
        time: session.updatedAt,
        changes,
      })
    }

    return groups
  }, [sessions])

  const getStatusIcon = (toolName: string) => {
    switch (toolName) {
      case 'write_file': return { icon: 'A', color: '#73c991', label: 'added' }
      case 'edit_file': return { icon: 'M', color: '#e5ba7d', label: 'modified' }
      case 'delete_file': return { icon: 'D', color: '#f48771', label: 'deleted' }
      default: return { icon: 'M', color: '#e5ba7d', label: 'modified' }
    }
  }

  const handleViewDiff = async (change: FileChange) => {
    setDiffSession(change)

    // Try to find a matching checkpoint
    const sessionCheckpoints = await (async () => {
      await loadCheckpoints(change.sessionId)
      return useChatStore.getState().checkpoints
    })()

    const checkpoint = sessionCheckpoints.find(
      (c) => c.messageId === change.messageId || (c.files && c.files.some((f) => f.path === change.filePath))
    )

    let original = ''
    if (checkpoint && checkpoint.files) {
      const file = checkpoint.files.find((f) => f.path === change.filePath)
      if (file) original = file.content
    }

    // Read current file content
    let modified = ''
    const absPath = resolvePath(change.filePath)
    try {
      const result = await window.electronAPI.readFile(absPath)
      modified = result.content
    } catch {
      modified = '(文件不存在)'
    }

    const ext = change.fileName.split('.').pop() || ''
    const langMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
      html: 'html', css: 'css', json: 'json', md: 'markdown', yaml: 'yaml', yml: 'yaml',
    }

    setDiffContent({
      original: original || '(没有原始版本记录)',
      modified,
      language: langMap[ext] || ext,
    })
  }

  const handleRevert = async (change: FileChange) => {
    await loadCheckpoints(change.sessionId)
    const sessionCheckpoints = useChatStore.getState().checkpoints
    const checkpoint = sessionCheckpoints.find(
      (c) => c.messageId === change.messageId || (c.files && c.files.some((f) => f.path === change.filePath))
    )

    if (checkpoint) {
      if (confirm(`确定要回退 "${change.fileName}" 的 AI 改动吗？此操作会恢复到 AI 修改之前的内容。`)) {
        await revertCheckpoint(checkpoint.id)
        // Force file reload in editor
        window.dispatchEvent(new CustomEvent('ourcode:file-changed', { detail: change.filePath }))
      }
    } else {
      alert('没有找到该文件的检查点记录，无法回退。')
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {groupedChanges.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-nova-text-muted opacity-40 mb-3">
              <circle cx="12" cy="12" r="9" />
              <polyline points="12 7 12 12 15 15" />
            </svg>
            <div className="text-nova-text-muted text-xs">暂无 AI 文件变更记录</div>
            <div className="text-nova-text-muted/60 text-[10px] mt-1">开始一个对话让 AI 修改文件后，变更会显示在这里</div>
          </div>
        ) : (
          groupedChanges.map((group) => (
            <div key={group.sessionId} className="mb-1 mx-2">
              {/* Group header */}
              <div className="flex items-center gap-1.5 px-2 py-2 text-[10px] font-semibold text-nova-text-muted uppercase tracking-wider">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="9" />
                  <polyline points="12 7 12 12 15 15" />
                </svg>
                <span className="font-normal normal-case tracking-normal text-nova-text-secondary">
                  {group.title} — {formatTime(group.time)}
                </span>
              </div>

              {/* File rows */}
              {group.changes.map((change, i) => {
                const st = getStatusIcon(change.toolName)
                return (
                  <div
                    key={`${change.filePath}-${i}`}
                    className="flex items-center gap-2 px-2 py-1.5 mx-1 rounded group cursor-pointer hover:bg-nova-hover transition-colors text-xs"
                    onClick={() => openFile(resolvePath(change.filePath))}
                  >
                    <span
                      className="w-3.5 text-center text-[10px] font-bold shrink-0"
                      style={{ color: st.color }}
                    >
                      {st.icon}
                    </span>
                    <span className="flex-1 truncate text-nova-text-primary">
                      {change.fileName}
                    </span>
                    <button
                      className="text-[10px] text-nova-text-muted opacity-0 group-hover:opacity-100 hover:text-nova-accent transition-all bg-transparent border-none cursor-pointer px-1"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleViewDiff(change)
                      }}
                    >
                      查看变更
                    </button>
                    <button
                      className="text-[10px] text-nova-text-muted opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all bg-transparent border-none cursor-pointer px-1"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRevert(change)
                      }}
                    >
                      ↩ 回退
                    </button>
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>

      {/* Diff modal */}
      {diffContent && diffSession && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => { setDiffContent(null); setDiffSession(null) }}
        >
          <div
            className="w-[700px] max-w-[90vw] max-h-[80vh] bg-nova-surface border border-nova-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-nova-border">
              <span className="text-sm font-semibold text-nova-text-primary truncate">
                变更预览 — {diffSession.fileName}
              </span>
              <button
                onClick={() => { setDiffContent(null); setDiffSession(null) }}
                className="w-7 h-7 flex items-center justify-center rounded-md text-nova-text-muted hover:text-nova-text-primary hover:bg-nova-hover transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-hidden" style={{ minHeight: 250 }}>
              <DiffView
                original={diffContent.original}
                modified={diffContent.modified}
                language={diffContent.language}
                onClose={() => { setDiffContent(null); setDiffSession(null) }}
              />
            </div>
            <div className="flex justify-end gap-2 px-4 py-2.5 border-t border-nova-border">
              <button
                onClick={() => { setDiffContent(null); setDiffSession(null) }}
                className="px-3 py-1.5 text-xs bg-nova-hover text-nova-text-secondary rounded-md hover:text-nova-text-primary transition-colors"
              >
                关闭
              </button>
              <button
                onClick={() => {
                  setDiffContent(null)
                  handleRevert(diffSession)
                  setDiffSession(null)
                }}
                className="px-3 py-1.5 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded-md hover:bg-red-500/30 transition-colors"
              >
                ↩ 回退此变更
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
