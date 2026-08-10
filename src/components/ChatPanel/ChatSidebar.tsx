import { useState, useMemo } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { useI18n } from '@/i18n/useI18n'
import { getLocale } from '@/i18n'

interface ChatSidebarProps {
  onClose: () => void
}

export default function ChatSidebar({ onClose }: ChatSidebarProps) {
  const {
    sessions,
    activeSessionId,
    runningSessionIds,
    pendingQuestion,
    pendingApproval,
    batchApproval,
    setActiveSession,
    deleteSession,
    renameSession,
    exportSession,
    importSession,
    togglePin,
    toggleArchive,
  } = useChatStore()

  const showContextMenu = useUIStore((s) => s.showContextMenu)
  const t = useI18n()
  const [searchQuery, setSearchQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  // Sessions waiting on the user (question / tool approval / batch approval /
  // plan approval) — bubble icon next to the title (same signal as the left
  // project list).
  const attentionSessionIds = useMemo(() => {
    const ids = new Set<string>()
    if (pendingQuestion?.sessionId) ids.add(pendingQuestion.sessionId)
    if (pendingApproval?.sessionId) ids.add(pendingApproval.sessionId)
    if (batchApproval?.sessionId) ids.add(batchApproval.sessionId)
    for (const s of sessions) if (s.planStatus === 'pending_approval') ids.add(s.id)
    return ids
  }, [pendingQuestion, pendingApproval, batchApproval, sessions])

  // Filter sessions based on search query, archive status, and pin sorting
  const filteredSessions = useMemo(() => {
    let list = sessions

    // Hide archived unless toggle is on
    if (!showArchived) {
      list = list.filter((s) => !s.archivedAt)
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      list = list.filter((session) => {
        if (session.title.toLowerCase().includes(query)) return true
        return session.messages.some((msg) =>
          msg.content.toLowerCase().includes(query)
        )
      })
    }

    // Sort: pinned first (by pinnedAt desc), then by updatedAt desc
    return [...list].sort((a, b) => {
      if (a.pinnedAt && !b.pinnedAt) return -1
      if (!a.pinnedAt && b.pinnedAt) return 1
      if (a.pinnedAt && b.pinnedAt) return b.pinnedAt - a.pinnedAt
      return b.updatedAt - a.updatedAt
    })
  }, [sessions, searchQuery, showArchived])

  const handleDelete = (sessionId: string) => {    if (confirm(t('chat.deleteSessionConfirm'))) {
      deleteSession(sessionId)
    }
  }

  const handleRename = (sessionId: string) => {
    const title = prompt(t('chat.renameSessionPrompt'))
    if (title?.trim()) {
      renameSession(sessionId, title.trim())
    }
  }

  const handleExport = (sessionId: string) => {
    const md = exportSession(sessionId, 'markdown')
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${t('layout.chatFilePrefix')}-${Date.now()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportJson = (sessionId: string) => {
    const json = exportSession(sessionId, 'json')
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${t('layout.chatFilePrefix')}-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault()
    e.stopPropagation()
    const session = sessions.find((s) => s.id === sessionId)
    if (!session) return

    const items = [
      {
        label: session.pinnedAt ? t('chat.unpin') : t('chat.pin'),
        icon: '📌',
        action: () => togglePin(sessionId),
      },
      { separator: true, label: '' },
      {
        label: session.archivedAt ? t('chat.unarchive') : t('chat.archive'),
        icon: '📦',
        action: () => toggleArchive(sessionId),
      },
    ]

    showContextMenu(e.clientX, e.clientY, items)
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        const reader = new FileReader()
        reader.onload = (ev) => {
          const content = ev.target?.result as string
          importSession(content)
        }
        reader.readAsText(file)
      }
    }
    input.click()
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    const locale = getLocale()

    if (isToday) {
      return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    }
    return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  }

  // Find matching message snippet for search results
  const getMatchSnippet = (sessionId: string): string | null => {
    if (!searchQuery.trim()) return null
    const session = sessions.find((s) => s.id === sessionId)
    if (!session) return null
    const query = searchQuery.toLowerCase()
    const match = session.messages.find((msg) =>
      msg.content.toLowerCase().includes(query)
    )
    if (!match) return null
    const idx = match.content.toLowerCase().indexOf(query)
    const start = Math.max(0, idx - 20)
    const end = Math.min(match.content.length, idx + query.length + 20)
    const snippet = (start > 0 ? '...' : '') + match.content.slice(start, end) + (end < match.content.length ? '...' : '')
    return snippet
  }

  return (
    <div className="w-[220px] border-r border-nova-border bg-nova-sidebar flex flex-col shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-nova-border">
        <span className="text-xs font-semibold text-nova-text-secondary">{t('chat.sessionList')}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowArchived(!showArchived)}
            className={`p-1 rounded transition-colors ${showArchived ? 'text-nova-accent bg-nova-accent/10' : 'text-nova-text-muted hover:text-nova-accent'}`}
            title={showArchived ? t('chat.hideArchive') : t('chat.showArchive')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
          </button>
          <button
            onClick={handleImport}
            className="p-1 text-nova-text-muted hover:text-nova-accent rounded transition-colors"
            title={t('chat.importSession')}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="p-1 text-nova-text-muted hover:text-nova-text-primary rounded transition-colors"
            title={t('common.close')}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search input */}
      <div className="px-3 py-2 border-b border-nova-border">
        <div className="relative">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-nova-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('chat.searchSessions')}
            className="w-full pl-7 pr-2 py-1 bg-nova-input-bg border border-nova-border rounded text-xs text-nova-text-primary outline-none focus:border-nova-accent/50 placeholder-nova-text-muted"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-nova-text-muted hover:text-nova-text-primary"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {searchQuery && (
          <div className="text-[10px] text-nova-text-muted mt-1">
            {t('chat.foundSessions', { count: filteredSessions.length })}
          </div>
        )}
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto py-1">
        {filteredSessions.length === 0 ? (
          <div className="p-4 text-center text-nova-text-muted text-xs">
            {searchQuery ? t('chat.noMatchingSessions') : t('chat.noSessions')}
          </div>
        ) : (
          filteredSessions.map((session) => {
            const isActive = session.id === activeSessionId
            const messageCount = session.messages.length
            const matchSnippet = getMatchSnippet(session.id)

            return (
              <div
                key={session.id}
                className={`
                  group px-3 py-2 cursor-pointer transition-colors
                  ${isActive ? 'bg-nova-accent/15 border-l-2 border-l-nova-accent' : 'hover:bg-nova-hover border-l-2 border-l-transparent'}
                  ${session.archivedAt ? 'opacity-60' : ''}
                `}
                onClick={() => setActiveSession(session.id)}
                onContextMenu={(e) => handleContextMenu(e, session.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className={`text-xs truncate flex items-center gap-1 ${isActive ? 'text-nova-accent font-medium' : 'text-nova-text-primary'}`}>
                      {/* Status indicator: bubble (needs input) > spinning
                          (running) > red dot (error) */}
                      {attentionSessionIds.has(session.id) ? (
                        <svg className="w-3 h-3 shrink-0 text-nova-accent" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                        </svg>
                      ) : runningSessionIds.includes(session.id) ? (
                        <span className="w-2.5 h-2.5 border-2 border-nova-accent/40 border-t-nova-accent rounded-full animate-spin shrink-0" />
                      ) : session.agentRuns?.some((r) => r.status === 'error') ? (
                        <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                      ) : null}
                      {session.pinnedAt && (
                        <svg className="w-3 h-3 shrink-0 text-nova-accent" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                        </svg>
                      )}
                      {session.title}
                    </div>
                    <div className="text-[10px] text-nova-text-muted mt-0.5">
                      {formatDate(session.updatedAt)} · {t('chat.messageCount', { count: messageCount })}
                      {session.archivedAt && t('chat.archivedSuffix')}
                    </div>
                    {matchSnippet && (
                      <div className="text-[10px] text-nova-text-muted mt-0.5 truncate italic">
                        ...{matchSnippet}...
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRename(session.id) }}
                      className="p-0.5 text-nova-text-muted hover:text-nova-text-primary rounded"
                      title={t('common.rename')}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleExport(session.id) }}
                      className="p-0.5 text-nova-text-muted hover:text-nova-text-primary rounded"
                      title={t('chat.exportMarkdown')}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleExportJson(session.id) }}
                      className="p-0.5 text-nova-text-muted hover:text-nova-text-primary rounded"
                      title={t('chat.exportJson')}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(session.id) }}
                      className="p-0.5 text-nova-text-muted hover:text-red-400 rounded"
                      title={t('common.delete')}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
