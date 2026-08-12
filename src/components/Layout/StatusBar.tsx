import { useState, useRef, useEffect, useCallback } from 'react'
import { useEditorStore } from '@/stores/editorStore'
import { useChatStore, estimateContextTokens } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'
import { useUIStore } from '@/stores/uiStore'
import { useProblemsStore } from '@/stores/problemsStore'
import { useI18n } from '@/i18n/useI18n'
import { t as moduleT } from '@/i18n'

export default function StatusBar() {
  // Targeted selectors — the previous whole-store subscriptions re-rendered the
  // bar on every editorStore/configStore change (each cursor move, keystroke…).
  const activeFilePath = useEditorStore((s) => s.activeFilePath)
  const cursorPosition = useEditorStore((s) => s.cursorPosition)
  const preferences = useEditorStore((s) => s.preferences)
  // Active file's display fields as primitives: no re-render when OTHER files
  // churn or on cursor moves.
  const activeFileEncoding = useEditorStore((s) => s.openFiles.find((f) => f.path === s.activeFilePath)?.encoding)
  const activeFileLineEnding = useEditorStore((s) => s.openFiles.find((f) => f.path === s.activeFilePath)?.lineEnding)
  // Derived session/group selectors return the OBJECT (stable reference unless
  // that session/group changes). The previous `s.getActiveSession()` selector
  // returned the bare FUNCTION reference (never re-renders AND never re-reads),
  // so `activeSession.messages.reduce(...)` below hit undefined at runtime.
  const activeSession = useChatStore((s) => (s.activeSessionId ? s.sessions.find((x) => x.id === s.activeSessionId) ?? null : null))
  const models = useConfigStore((s) => s.models)
  const configGroups = useConfigStore((s) => s.configGroups)
  const activeConfigGroupId = useConfigStore((s) => s.activeConfigGroupId)
  const setActiveConfigGroup = useConfigStore((s) => s.setActiveConfigGroup)
  const activeConfigGroup = useConfigStore((s) => s.configGroups.find((g) => g.id === s.activeConfigGroupId))
  const storeRootPath = useUIStore((s) => s.rootPath)
  // Git state follows the CURRENT project (the active session's bound project)
  // — the browsed folder only counts while no session exists yet.
  const gitRoot = activeSession?.projectPath ?? storeRootPath
  const t = useI18n()

  const [gitBranch, setGitBranch] = useState<string | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [showBranchMenu, setShowBranchMenu] = useState(false)
  const branchMenuRef = useRef<HTMLDivElement>(null)

  const [showEncodingMenu, setShowEncodingMenu] = useState(false)
  const [showConfigMenu, setShowConfigMenu] = useState(false)
  const encodingMenuRef = useRef<HTMLDivElement>(null)
  const configMenuRef = useRef<HTMLDivElement>(null)

  // Update state
  const [appVersion, setAppVersion] = useState('')
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'>('idle')
  const [newVersion, setNewVersion] = useState('')
  const [downloadPercent, setDownloadPercent] = useState(0)
  const [updateError, setUpdateError] = useState('')

  // Fetch git branch
  useEffect(() => {
    const fetchBranch = async () => {
      try {
        if (!gitRoot) { setGitBranch(null); return }
        const result = await window.electronAPI.gitExec(gitRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])
        if (result.success) setGitBranch(result.output.trim())
        else setGitBranch(null)
      } catch { setGitBranch(null) }
    }
    fetchBranch()
    const interval = setInterval(fetchBranch, 10000)
    return () => clearInterval(interval)
  }, [gitRoot])

  // Get app version and listen for update status
  useEffect(() => {
    const getVersion = async () => {
      try {
        const version = await window.electronAPI.getVersion()
        if (version) setAppVersion(version)
      } catch { /* ignore */ }
    }
    getVersion()

    // Listen for update status push events
    const cleanupStatus = window.electronAPI.onUpdateStatus((status) => {
      if (status.state === 'available') {
        setUpdateState('available')
        setNewVersion(status.version || '')
      } else if (status.state === 'not-available') {
        setUpdateState('idle')
      } else if (status.state === 'downloaded') {
        setUpdateState('downloaded')
      } else if (status.state === 'error') {
        setUpdateState('error')
        setUpdateError(status.message || moduleT('statusBar.checkFailed'))
      }
    })

    const cleanupProgress = window.electronAPI.onUpdateProgress((progress) => {
      setUpdateState('downloading')
      setDownloadPercent(progress.percent)
    })

    return () => {
      cleanupStatus()
      cleanupProgress()
    }
  }, [])

  const handleCheckUpdate = useCallback(async () => {
    setUpdateState('checking')
    setUpdateError('')
    const result = await window.electronAPI.checkForUpdate()
    if (result.state === 'available') {
      setUpdateState('available')
      setNewVersion(result.version || '')
    } else if (result.state === 'error') {
      setUpdateState('error')
      setUpdateError(result.message || moduleT('statusBar.checkFailed'))
    } else {
      setUpdateState('idle')
    }
  }, [])

  const handleDownloadUpdate = useCallback(async () => {
    setUpdateState('downloading')
    await window.electronAPI.downloadUpdate()
  }, [])

  const handleInstallUpdate = useCallback(() => {
    window.electronAPI.installUpdate()
  }, [])

  const fetchBranches = async () => {
    try {
      if (!gitRoot) return
      const result = await window.electronAPI.gitExec(gitRoot, ['branch', '--format=%(refname:short)'])
      if (result.success) {
        setBranches(result.output.trim().split('\n').filter(Boolean))
      }
    } catch { /* ignore */ }
  }

  const handleCheckout = async (branch: string) => {
    try {
      if (!gitRoot) return
      const result = await window.electronAPI.gitExec(gitRoot, ['checkout', branch])
      if (result.success) {
        setGitBranch(branch)
        setShowBranchMenu(false)
      }
    } catch { /* ignore */ }
  }

  // Close menus on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (encodingMenuRef.current && !encodingMenuRef.current.contains(e.target as Node)) {
        setShowEncodingMenu(false)
      }
      if (configMenuRef.current && !configMenuRef.current.contains(e.target as Node)) {
        setShowConfigMenu(false)
      }
      if (branchMenuRef.current && !branchMenuRef.current.contains(e.target as Node)) {
        setShowBranchMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Total tokens for active session — real API usage baseline + estimate for
  // messages added since (Claude Code-style), matching what the model actually
  // receives rather than the raw stored history.
  const totalTokens = activeSession ? estimateContextTokens(activeSession) : 0
  // The chat loop resolves the runtime model from the session's OWN config
  // group (session.model || sessionGroup.defaultModel) — the global active
  // group can diverge from it (startup restore, manual group switch), which
  // made the indicator show nothing while a model was actually in use.
  const sessionGroup = useConfigStore((s) =>
    activeSession ? s.configGroups.find((g) => g.id === activeSession.configGroupId) : undefined
  )
  const model = activeSession?.model || sessionGroup?.defaultModel || activeConfigGroup?.defaultModel || ''
  const modelInfo = models.find((m) => m.id === model)

  // Live diagnostics counts (replaces the previously hardcoded 0 / 0)
  const problems = useProblemsStore((s) => s.problems)
  const errorCount = problems.filter((p) => p.severity === 'error').length
  const warningCount = problems.filter((p) => p.severity === 'warning').length
  const openProblems = () => useProblemsStore.getState().setOpen(true)

  const encodings = ['UTF-8', 'GBK', 'GB2312', 'GB18030', 'ASCII', 'ISO-8859-1', 'UTF-16']

  return (
    <div className="h-[24px] text-nova-text-muted text-[11px] flex items-center px-3 select-none shrink-0 rounded-xl glass-flat">
      {/* Left side */}
      <div className="flex items-center gap-3">
        {/* Git branch — or an explicit "no git" indicator when the current
            project isn't a git repo / git isn't available */}
        {gitBranch ? (
          <div className="relative" ref={branchMenuRef}>
            <button
              className="flex items-center gap-1 opacity-90 hover:opacity-100 cursor-pointer px-1.5 rounded-full hover:bg-nova-hover"
              onClick={() => { setShowBranchMenu(!showBranchMenu); if (!showBranchMenu) fetchBranches() }}
              title={t('statusBar.switchBranch')}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#22c55e' }} />
              {gitBranch}
            </button>
            {showBranchMenu && branches.length > 0 && (
              <div className="absolute bottom-full left-0 mb-1 glass-panel rounded-lg py-1 min-w-[150px] z-50 max-h-[200px] overflow-y-auto">
                {branches.map((branch) => (
                  <button
                    key={branch}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-nova-accent/15 flex items-center gap-2 ${
                      branch === gitBranch ? 'text-white' : 'text-nova-text-secondary'
                    }`}
                    onClick={() => handleCheckout(branch)}
                  >
                    {branch === gitBranch && <span>✓</span>}
                    <span className="truncate">{branch}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <span className="flex items-center gap-1 opacity-70" title="当前项目不是 Git 仓库或未检测到 Git">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M4.9 4.9l14.2 14.2" />
            </svg>
            无git环境
          </span>
        )}

        {/* Separator */}
        <div className="w-px h-3.5" style={{ background: 'var(--border)' }} />

        {/* Errors — click to open the Problems panel */}
        <button
          className="flex items-center gap-1 cursor-pointer hover:bg-nova-hover"
          style={{ background: errorCount > 0 ? 'rgba(244,135,113,0.9)' : undefined, padding: '0 5px', borderRadius: 2 }}
          onClick={openProblems}
          title={t('statusBar.problems')}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          {errorCount}
        </button>

        {/* Warnings — click to open the Problems panel */}
        <button
          className="flex items-center gap-1 cursor-pointer hover:bg-nova-hover"
          style={{ background: warningCount > 0 ? 'rgba(204,167,0,0.9)' : undefined, padding: '0 5px', borderRadius: 2 }}
          onClick={openProblems}
          title={t('statusBar.problems')}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          {warningCount}
        </button>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3 ml-auto">
        {/* Auto-update indicator */}
        {updateState !== 'idle' && (
          <span
            className="flex items-center gap-1 px-1.5 rounded hover:bg-nova-hover cursor-pointer"
            onClick={
              updateState === 'available' ? handleDownloadUpdate
              : updateState === 'downloaded' ? handleInstallUpdate
              : updateState === 'error' ? handleCheckUpdate
              : undefined
            }
            title={t('statusBar.autoUpdate')}
          >
            {updateState === 'checking' && t('statusBar.checking')}
            {updateState === 'available' && t('statusBar.updateAvailable', { version: newVersion || '' })}
            {updateState === 'downloading' && t('statusBar.downloading', { percent: Math.round(downloadPercent) })}
            {updateState === 'downloaded' && t('statusBar.restartInstall')}
            {updateState === 'error' && `⚠ ${updateError || t('statusBar.updateFailed')}`}
          </span>
        )}

        {cursorPosition && (
          <span className="opacity-90">
            {t('statusBar.lineCol', { line: cursorPosition.line, col: cursorPosition.column })}
          </span>
        )}

        {activeFileEncoding && (
          <>
            {/* Encoding selector */}
            <div className="relative" ref={encodingMenuRef}>
              <button
                className="opacity-90 hover:opacity-100 cursor-pointer px-1 rounded hover:bg-nova-hover"
                onClick={() => setShowEncodingMenu(!showEncodingMenu)}
                title={t('statusBar.switchEncoding')}
              >
                {activeFileEncoding.toUpperCase()}
              </button>
              {showEncodingMenu && (
                <div className="absolute bottom-full left-0 mb-1 glass-panel rounded-lg py-1 min-w-[120px] z-50">
                  {encodings.map((enc) => (
                    <button
                      key={enc}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-nova-accent/15 ${
                        activeFileEncoding?.toUpperCase() === enc ? 'text-white' : 'text-nova-text-secondary'
                      }`}
                      onClick={() => {
                        // Re-encode this file with the chosen encoding on next save
                        if (activeFilePath) {
                          useEditorStore.getState().setFileEncoding(activeFilePath, enc.toLowerCase())
                        }
                        setShowEncodingMenu(false)
                      }}
                    >
                      {enc}
                      {activeFileEncoding?.toUpperCase() === enc && ' ✓'}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <span className="opacity-90">{activeFileLineEnding === 'crlf' ? 'CRLF' : 'LF'}</span>

            <span className="opacity-90">{t('statusBar.spaces', { count: preferences.tabSize })}</span>
          </>
        )}

        {/* Config group switcher */}
        {configGroups.length > 0 && (
          <div className="relative" ref={configMenuRef}>
            <button
              className="flex items-center gap-1 opacity-90 hover:opacity-100 cursor-pointer px-1 rounded hover:bg-nova-hover max-w-[140px]"
              onClick={() => setShowConfigMenu(!showConfigMenu)}
              title={t('statusBar.switchConfigGroup')}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: activeConfigGroup?.color || '#3b82f6' }} />
              <span className="truncate">{activeConfigGroup?.name || t('statusBar.notConfigured')}</span>
            </button>
            {showConfigMenu && (
              <div className="absolute bottom-full right-0 mb-1 glass-panel rounded-lg py-1 min-w-[160px] z-50 max-h-[240px] overflow-y-auto">
                {configGroups.map((g) => (
                  <button
                    key={g.id}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-nova-accent/15 flex items-center gap-2 ${
                      g.id === activeConfigGroupId ? 'text-white' : 'text-nova-text-secondary'
                    }`}
                    onClick={() => { setActiveConfigGroup(g.id); setShowConfigMenu(false) }}
                  >
                    {g.id === activeConfigGroupId && <span>✓</span>}
                    <span className="truncate">{g.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* AI model indicator */}
        {model && (
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
            <span className="opacity-90">{modelInfo?.alias || model.split('/').pop() || model}</span>
          </span>
        )}

        {/* Total tokens in active session */}
        {totalTokens > 0 && (
          <span className="opacity-70" title={t('statusBar.tokenUsage')}>
            {totalTokens.toLocaleString()} tokens
          </span>
        )}

        {/* App version — click to check for updates */}
        {appVersion && (
          <span
            className="opacity-70 hover:opacity-100 cursor-pointer"
            title={t('statusBar.checkUpdate')}
            onClick={handleCheckUpdate}
          >
            {appVersion}
          </span>
        )}
      </div>
    </div>
  )
}
