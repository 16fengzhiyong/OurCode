import { useState, useEffect, useCallback } from 'react'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useConfigStore } from '@/stores/configStore'
import { sendLLMRequest } from '@/services/llm/LLMClient'
import { runLifeguardCheck, LifeguardFinding } from '@/services/lifeguard'
import DiffView from '../Editor/DiffView'

interface GitStatus {
  file: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
  staged: boolean
}

interface GitCommit {
  hash: string
  message: string
  author: string
  date: string
}

export default function GitPanel() {
  const [gitStatus, setGitStatus] = useState<GitStatus[]>([])
  const [gitBranch, setGitBranch] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [log, setLog] = useState<GitCommit[]>([])
  const [showLog, setShowLog] = useState(false)
  const [diffContent, setDiffContent] = useState<string | null>(null)
  const [diffFile, setDiffFile] = useState<string | null>(null)
  const [monacoDiff, setMonacoDiff] = useState<{ original: string; modified: string; language: string } | null>(null)
  const [generatingCommit, setGeneratingCommit] = useState(false)

  const { openFile } = useEditorStore()

  // Get root path from store
  const getRootPath = useCallback(() => {
    return useUIStore.getState().rootPath
  }, [])

  /** Resolve a repo-relative path (from `git status --porcelain`) to an absolute path */
  const resolveFilePath = useCallback((file: string): string => {
    const rootPath = getRootPath()
    if (!rootPath) return file
    const sep = rootPath.includes('/') ? '/' : '\\'
    return rootPath.replace(/[/\\]$/, '') + sep + file
  }, [getRootPath])

  const runGitCommand = useCallback(async (args: string[]): Promise<{ success: boolean; output: string; error?: string }> => {
    const rootPath = getRootPath()
    if (!rootPath) return { success: false, output: '', error: '未打开项目文件夹' }
    return window.electronAPI.gitExec(rootPath, args)
  }, [getRootPath])

  const refreshStatus = useCallback(async () => {
    const rootPath = getRootPath()
    if (!rootPath) return

    setIsLoading(true)
    try {
      // Get current branch
      const branchResult = await runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'])
      if (branchResult.success) {
        setGitBranch(branchResult.output)
      }

      // Get status with porcelain format
      const statusResult = await runGitCommand(['status', '--porcelain=v1'])
      if (statusResult.success && statusResult.output) {
        const lines = statusResult.output.split('\n').filter(Boolean)
        const statuses: GitStatus[] = lines.map((line) => {
          const indexStatus = line[0]
          const workTreeStatus = line[1]
          const filePath = line.slice(3).replace(/^"|"$/g, '') // Remove quotes if present

          let status: GitStatus['status'] = 'modified'
          const staged = indexStatus !== ' ' && indexStatus !== '?'

          if (indexStatus === '?' && workTreeStatus === '?') {
            status = 'untracked'
          } else if (indexStatus === 'A' || workTreeStatus === 'A') {
            status = 'added'
          } else if (indexStatus === 'D' || workTreeStatus === 'D') {
            status = 'deleted'
          } else if (indexStatus === 'R' || workTreeStatus === 'R') {
            status = 'renamed'
          } else {
            status = 'modified'
          }

          return { file: filePath, status, staged }
        })
        setGitStatus(statuses)
      } else {
        setGitStatus([])
      }
    } catch (error) {
      console.error('获取 Git 状态失败:', error)
      setGitStatus([])
      setGitBranch('')
    } finally {
      setIsLoading(false)
    }
  }, [getRootPath, runGitCommand])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'modified': return { icon: 'M', color: 'text-yellow-400' }
      case 'added': return { icon: 'A', color: 'text-green-400' }
      case 'deleted': return { icon: 'D', color: 'text-red-400' }
      case 'renamed': return { icon: 'R', color: 'text-blue-400' }
      case 'untracked': return { icon: 'U', color: 'text-nova-text-muted' }
      default: return { icon: '?', color: 'text-nova-text-muted' }
    }
  }

  const handleToggleStage = async (file: string, currentlyStaged: boolean) => {
    if (currentlyStaged) {
      await runGitCommand(['reset', 'HEAD', file])
    } else {
      await runGitCommand(['add', file])
    }
    refreshStatus()
  }

  const handleStageAll = async () => {
    await runGitCommand(['add', '-A'])
    refreshStatus()
  }

  const handleUnstageAll = async () => {
    await runGitCommand(['reset', 'HEAD'])
    refreshStatus()
  }

  const handleCommit = async () => {
    if (!commitMessage.trim()) return

    // Stage all changes first
    await runGitCommand(['add', '-A'])
    const result = await runGitCommand(['commit', '-m', commitMessage.trim()])

    if (result.success) {
      setCommitMessage('')
      refreshStatus()
      setLifeguardFindings([])
    } else {
      console.error('提交失败:', result.error)
    }
  }

  // Lifeguard: pre-commit AI bug check (Windsurf-style)
  const [lifeguardFindings, setLifeguardFindings] = useState<LifeguardFinding[]>([])
  const [lifeguardRunning, setLifeguardRunning] = useState(false)
  const [lifeguardError, setLifeguardError] = useState<string | null>(null)

  const handleLifeguard = async () => {
    const configGroup = useConfigStore.getState().getActiveConfigGroup()
    if (!configGroup || !configGroup.defaultModel) {
      alert('请先配置 API 模型')
      return
    }
    const diffResult = await runGitCommand(['diff', 'HEAD'])
    const diffText = diffResult.success ? diffResult.output : ''
    if (!diffText) {
      setLifeguardFindings([])
      setLifeguardError('没有可检查的改动（工作区与 HEAD 一致）')
      return
    }
    setLifeguardRunning(true)
    setLifeguardError(null)
    try {
      const findings = await runLifeguardCheck(diffText, configGroup)
      setLifeguardFindings(findings)
    } catch (e: any) {
      setLifeguardError(e.message || 'Lifeguard 检查失败')
      setLifeguardFindings([])
    } finally {
      setLifeguardRunning(false)
    }
  }

  const handlePush = async () => {
    const result = await runGitCommand(['push'])
    if (!result.success) {
      console.error('推送失败:', result.error)
    }
  }

  const handlePull = async () => {
    const result = await runGitCommand(['pull'])
    if (!result.success) {
      console.error('拉取失败:', result.error)
    }
    refreshStatus()
  }

  const handleViewDiff = async (file: string) => {
    // Get original (HEAD) content
    const headResult = await runGitCommand(['show', `HEAD:${file}`])
    // Get current working content
    let currentContent = ''
    try {
      const fullPath = resolveFilePath(file)
      const readResult = await window.electronAPI.readFile(fullPath)
      currentContent = readResult.content
    } catch { /* file might be deleted or new */ }

    const ext = file.split('.').pop() || ''
    const langMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
      html: 'html', css: 'css', json: 'json', md: 'markdown', yaml: 'yaml', yml: 'yaml',
    }
    const language = langMap[ext] || ext

    if (headResult.success) {
      setMonacoDiff({ original: headResult.output, modified: currentContent, language })
      setDiffFile(file)
      setDiffContent(null)
    } else {
      // New file - show raw diff
      const result = await runGitCommand(['diff', file])
      if (result.success) {
        setDiffContent(result.output || '无差异')
        setDiffFile(file)
        setMonacoDiff(null)
      }
    }
  }

  const handleViewLog = async () => {
    setShowLog(true)
    const result = await runGitCommand(['log', '--oneline', '-20', '--format=%H|%s|%an|%ar'])
    if (result.success && result.output) {
      const commits = result.output.split('\n').filter(Boolean).map((line) => {
        const [hash, message, author, date] = line.split('|')
        return { hash, message, author, date }
      })
      setLog(commits)
    }
  }

  const handleGenerateCommitMessage = async () => {
    const diffResult = await runGitCommand(['diff', '--cached'])
    const diffText = diffResult.success ? diffResult.output : ''

    // Prefer the AI-generated message (Windsurf-style) when a model is configured
    const configGroup = useConfigStore.getState().getActiveConfigGroup()
    if (configGroup && configGroup.defaultModel && (diffText || gitStatus.length)) {
      setGeneratingCommit(true)
      try {
        const diff = diffText || gitStatus.map((s) => `${s.status === 'untracked' ? '新文件' : s.status} ${s.file}`).join('\n')
        const prompt = `请根据以下 git 变更生成一条简洁的提交信息（一行，中文，不要引号，不要前缀 emoji）：\n\n${diff.slice(0, 12000)}`
        const req = {
          model: configGroup.defaultModel,
          messages: [
            { role: 'system' as const, content: '你是一个 git 提交信息生成器，只输出一行提交信息。' },
            { role: 'user' as const, content: prompt },
          ],
          stream: false,
          temperature: 0.3,
          maxTokens: 80,
          topP: 1,
          frequencyPenalty: 0,
          presencePenalty: 0,
        }
        let msg = ''
        for await (const chunk of sendLLMRequest(req, configGroup)) {
          if (chunk.content) msg += chunk.content
          if (chunk.done) break
        }
        const cleaned = msg.trim().split('\n')[0].replace(/^[#\-*`"\s]+/, '').trim()
        if (cleaned) setCommitMessage(cleaned)
      } catch (error: any) {
        console.error('AI 生成提交信息失败:', error.message)
      } finally {
        setGeneratingCommit(false)
      }
      return
    }

    // Fallback: heuristic summary from the diff stat
    const statResult = await runGitCommand(['diff', '--cached', '--stat'])
    if (statResult.success && statResult.output) {
      const lines = statResult.output.split('\n').filter(Boolean)
      const summary = lines[lines.length - 1] || '更新文件'
      setCommitMessage(summary.trim())
    }
  }

  const unstagedChanges = gitStatus.filter((s) => !s.staged && s.status !== 'untracked')
  const stagedChanges = gitStatus.filter((s) => s.staged)
  const untrackedFiles = gitStatus.filter((s) => s.status === 'untracked')

  return (
    <div className="h-full flex flex-col text-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-nova-border">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-nova-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span className="text-xs font-semibold text-nova-text-secondary">源代码管理</span>
        </div>
        <div className="flex items-center gap-1">
          {gitBranch && (
            <span className="text-[10px] px-1.5 py-0.5 bg-nova-hover rounded text-nova-text-muted">
              {gitBranch}
            </span>
          )}
          <button
            onClick={refreshStatus}
            className="p-1 text-nova-text-muted hover:text-nova-text-primary rounded transition-colors"
            title="刷新"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Commit message input */}
      <div className="p-3 border-b border-nova-border">
        <textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder="提交消息 (Ctrl+Enter 提交)"
          className="w-full px-3 py-2 bg-nova-input-bg border border-nova-border rounded-lg text-xs text-nova-text-primary outline-none focus:border-nova-accent/50 resize-none"
          rows={2}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === 'Enter') {
              handleCommit()
            }
          }}
        />
        <div className="flex gap-2 mt-2">
          <button
            onClick={handleCommit}
            disabled={!commitMessage.trim()}
            className="flex-1 px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-30 transition-colors"
          >
            提交
          </button>
          <button
            onClick={handlePush}
            className="px-3 py-1.5 text-xs bg-nova-hover text-nova-text-secondary rounded-lg hover:text-nova-text-primary transition-colors"
            title="推送到远程"
          >
            推送
          </button>
          <button
            onClick={handlePull}
            className="px-3 py-1.5 text-xs bg-nova-hover text-nova-text-secondary rounded-lg hover:text-nova-text-primary transition-colors"
            title="从远程拉取"
          >
            拉取
          </button>
          <button
            onClick={() => { showLog ? setShowLog(false) : handleViewLog() }}
            className="px-3 py-1.5 text-xs bg-nova-hover text-nova-text-secondary rounded-lg hover:text-nova-text-primary transition-colors"
          >
            日志
          </button>
        </div>
        <div className="flex items-center gap-3 mt-1.5">
          <button
            onClick={handleGenerateCommitMessage}
            disabled={generatingCommit}
            className="text-[10px] text-nova-text-muted hover:text-nova-accent transition-colors disabled:opacity-40"
            title="基于暂存的更改自动生成提交消息"
          >
            {generatingCommit ? '🤖 生成中...' : '🤖 AI 生成提交消息'}
          </button>
          <button
            onClick={handleLifeguard}
            disabled={lifeguardRunning}
            className="text-[10px] text-nova-text-muted hover:text-red-400 transition-colors disabled:opacity-40"
            title="提交前用 AI 检查改动中的潜在 Bug"
          >
            {lifeguardRunning ? '🛟 检查中...' : '🛟 Lifeguard 检查'}
          </button>
        </div>

        {/* Lifeguard findings */}
        {lifeguardError && (
          <div className="mt-2 px-2 py-1.5 rounded bg-yellow-500/10 border border-yellow-500/30 text-[11px] text-yellow-400">
            {lifeguardError}
          </div>
        )}
        {lifeguardFindings.length > 0 && (
          <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
            <div className="text-[10px] text-nova-text-muted flex items-center gap-1.5">
              <span>🛟 Lifeguard 发现 {lifeguardFindings.length} 个潜在问题</span>
              <span className="ml-auto">
                {lifeguardFindings.filter((f) => f.severity === 'error').length} 错误 ·{' '}
                {lifeguardFindings.filter((f) => f.severity === 'warning').length} 警告
              </span>
            </div>
            {lifeguardFindings.map((f, i) => (
              <div
                key={i}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${
                  f.severity === 'error'
                    ? 'border-red-500/30 bg-red-500/5 text-red-300'
                    : f.severity === 'warning'
                      ? 'border-yellow-500/30 bg-yellow-500/5 text-yellow-200'
                      : 'border-sky-500/30 bg-sky-500/5 text-sky-200'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span>{f.severity === 'error' ? '✕' : f.severity === 'warning' ? '⚠' : 'ⓘ'}</span>
                  <span className="font-medium">
                    {f.severity === 'error' ? '错误' : f.severity === 'warning' ? '警告' : '提示'}
                    {f.file && <> · {f.file}{f.line ? `:${f.line}` : ''}</>}
                  </span>
                </div>
                <div className="mt-0.5">{f.message}</div>
                {f.suggestion && <div className="mt-0.5 opacity-80">建议: {f.suggestion}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Changed files */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-4 text-center text-nova-text-muted text-xs">
            加载中...
          </div>
        )}

        {!isLoading && gitStatus.length === 0 && (
          <div className="p-4 text-center text-nova-text-muted text-xs">
            {gitBranch ? '没有更改的文件' : '未检测到 Git 仓库'}
          </div>
        )}

        {/* Staged changes */}
        {stagedChanges.length > 0 && (
          <div>
            <div className="flex items-center justify-between px-3 py-1.5 bg-nova-bg">
              <span className="text-[10px] font-semibold text-nova-text-muted uppercase">已暂存</span>
              <button
                onClick={handleUnstageAll}
                className="text-[10px] text-nova-text-muted hover:text-nova-accent"
                title="取消所有暂存"
              >
                全部取消
              </button>
            </div>
            {stagedChanges.map((item) => {
              const { icon, color } = getStatusIcon(item.status)
              const fileName = item.file.split(/[/\\]/).pop() || item.file
              return (
                <div
                  key={item.file}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-nova-hover cursor-pointer group"
                >
                  <button
                    onClick={() => handleToggleStage(item.file, true)}
                    className="text-[10px] text-yellow-400 hover:text-yellow-300"
                    title="取消暂存"
                  >
                    -
                  </button>
                  <span className={`text-[10px] font-bold w-4 text-center ${color}`}>{icon}</span>
                  <span className="text-xs text-nova-text-primary truncate flex-1" onClick={() => openFile(resolveFilePath(item.file))}>{fileName}</span>
                  <button
                    onClick={() => handleViewDiff(item.file)}
                    className="text-[10px] text-nova-text-muted hover:text-nova-accent opacity-0 group-hover:opacity-100"
                    title="查看差异"
                  >
                    diff
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Unstaged changes */}
        {unstagedChanges.length > 0 && (
          <div>
            <div className="flex items-center justify-between px-3 py-1.5 bg-nova-bg">
              <span className="text-[10px] font-semibold text-nova-text-muted uppercase">更改</span>
              <button
                onClick={handleStageAll}
                className="text-[10px] text-nova-text-muted hover:text-nova-accent"
                title="暂存所有更改"
              >
                全部暂存
              </button>
            </div>
            {unstagedChanges.map((item) => {
              const { icon, color } = getStatusIcon(item.status)
              const fileName = item.file.split(/[/\\]/).pop() || item.file
              return (
                <div
                  key={item.file}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-nova-hover cursor-pointer group"
                >
                  <button
                    onClick={() => handleToggleStage(item.file, false)}
                    className="text-[10px] text-green-400 hover:text-green-300"
                    title="暂存"
                  >
                    +
                  </button>
                  <span className={`text-[10px] font-bold w-4 text-center ${color}`}>{icon}</span>
                  <span className="text-xs text-nova-text-primary truncate flex-1" onClick={() => openFile(resolveFilePath(item.file))}>{fileName}</span>
                  <button
                    onClick={() => handleViewDiff(item.file)}
                    className="text-[10px] text-nova-text-muted hover:text-nova-accent opacity-0 group-hover:opacity-100"
                    title="查看差异"
                  >
                    diff
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Untracked files */}
        {untrackedFiles.length > 0 && (
          <div>
            <div className="flex items-center justify-between px-3 py-1.5 bg-nova-bg">
              <span className="text-[10px] font-semibold text-nova-text-muted uppercase">未跟踪</span>
            </div>
            {untrackedFiles.map((item) => {
              const fileName = item.file.split(/[/\\]/).pop() || item.file
              return (
                <div
                  key={item.file}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-nova-hover cursor-pointer group"
                >
                  <button
                    onClick={() => handleToggleStage(item.file, false)}
                    className="text-[10px] text-green-400 hover:text-green-300"
                    title="添加跟踪"
                  >
                    +
                  </button>
                  <span className="text-[10px] font-bold w-4 text-center text-nova-text-muted">U</span>
                  <span className="text-xs text-nova-text-primary truncate flex-1" onClick={() => openFile(resolveFilePath(item.file))}>{fileName}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Monaco Diff view */}
      {monacoDiff && diffFile && (
        <div className="border-t border-nova-border h-[300px]">
          <DiffView
            original={monacoDiff.original}
            modified={monacoDiff.modified}
            language={monacoDiff.language}
            onClose={() => { setMonacoDiff(null); setDiffFile(null) }}
          />
        </div>
      )}

      {/* Raw diff fallback (for new files) */}
      {diffContent && diffFile && !monacoDiff && (
        <div className="border-t border-nova-border max-h-[200px] overflow-y-auto">
          <div className="flex items-center justify-between px-3 py-1.5 bg-nova-bg">
            <span className="text-[10px] text-nova-text-muted truncate">差异: {diffFile}</span>
            <button
              onClick={() => { setDiffContent(null); setDiffFile(null) }}
              className="text-nova-text-muted hover:text-nova-text-primary"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <pre className="px-3 py-2 text-[11px] text-nova-text-secondary font-mono whitespace-pre-wrap overflow-x-auto">
            {diffContent}
          </pre>
        </div>
      )}

      {/* Git Log */}
      {showLog && (
        <div className="border-t border-nova-border max-h-[200px] overflow-y-auto">
          <div className="flex items-center justify-between px-3 py-1.5 text-[10px] text-nova-text-muted bg-nova-bg">
            <span>最近提交</span>
            <button onClick={() => setShowLog(false)} className="hover:text-nova-text-primary">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {log.length === 0 ? (
            <div className="p-3 text-center text-nova-text-muted text-xs">
              暂无提交记录
            </div>
          ) : (
            log.map((commit) => (
              <div key={commit.hash} className="px-3 py-1.5 hover:bg-nova-hover">
                <div className="text-xs text-nova-text-primary truncate">{commit.message}</div>
                <div className="text-[10px] text-nova-text-muted">
                  {commit.hash.slice(0, 7)} · {commit.author} · {commit.date}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
