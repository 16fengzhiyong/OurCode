import { useState, useCallback, useEffect } from 'react'
import { useI18n } from '@/i18n/useI18n'
import { parseGitDiff, buildHunkPatch, ParsedDiff } from '@/utils/gitDiff'

interface GitDiffViewProps {
  file: string
  diffText: string
  /** Whether the diff shown is the *staged* (index) diff or the working-tree diff */
  staged: boolean
  onClose: () => void
  /** Re-run the surrounding git operations after a hunk action */
  onChanged: () => void
  runGitCommand: (args: string[], input?: string) => Promise<{ success: boolean; output: string; error?: string }>
  onEditFile: (file: string) => void
}

/** Language badge derived from file extension (Stitch: typescript badge) */
function langOf(file: string): string {
  const ext = file.split('.').pop() || ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', go: 'go', rs: 'rust', java: 'java', html: 'html', css: 'css',
    json: 'json', md: 'markdown', yaml: 'yaml', yml: 'yaml', vue: 'vue', svelte: 'svelte',
  }
  return map[ext] || ext
}

/**
 * High-fidelity Git diff viewer (Stitch: 源代码管理与差异对比 高保真).
 * Renders hunks on a dark slate canvas (code/terminal inversion of the light
 * glass workspace) with per-hunk 「暂存此块 / 撤销此块」 actions so the user
 * can fine-tune exactly what gets staged before committing.
 */
export default function GitDiffView({ file, diffText, staged, onClose, onChanged, runGitCommand, onEditFile }: GitDiffViewProps) {
  const t = useI18n()
  const [busyHunk, setBusyHunk] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedDiff | null>(null)

  useEffect(() => {
    setParsed(parseGitDiff(diffText, file))
  }, [diffText, file])

  const applyHunk = useCallback(async (hunkIndex: number, mode: 'stage' | 'revert') => {
    if (!parsed) return
    const hunk = parsed.hunks[hunkIndex]
    setBusyHunk(String(hunkIndex))
    setNotice(null)
    const patch = buildHunkPatch(file, hunk, parsed)
    try {
      // Staged diff → unstage this hunk (reverse-apply to index).
      // Working-tree diff → stage the hunk, or discard it (reverse-apply to worktree).
      const args = staged
        ? ['apply', '--cached', '-R', '--whitespace=nowarn', '-']
        : mode === 'stage'
          ? ['apply', '--cached', '--whitespace=nowarn', '-']
          : ['apply', '-R', '--whitespace=nowarn', '-']
      const res = await runGitCommand(args, patch)
      if (!res.success) {
        setNotice(res.error || t('git.applyHunkFailed'))
        return
      }
      onChanged()
    } finally {
      setBusyHunk(null)
    }
  }, [parsed, file, staged, runGitCommand, onChanged, t])

  const applyAll = useCallback(async (mode: 'stage' | 'revert') => {
    if (!parsed) return
    setNotice(null)
    try {
      // All hunks → delegate to the plain whole-file git ops for robustness.
      const args = staged
        ? ['reset', 'HEAD', '--', file]
        : mode === 'stage'
          ? ['add', '--', file]
          : ['checkout', '--', file]
      const res = await runGitCommand(args)
      if (!res.success) {
        setNotice(res.error || t('git.applyHunkFailed'))
        return
      }
      onChanged()
    } finally {
      setBusyHunk(null)
    }
  }, [parsed, file, staged, runGitCommand, onChanged, t])

  const lang = langOf(file)
  const lineBg = (type: string) =>
    type === 'add' ? 'bg-[#16a34a]/25 text-[#d7f5dd]' : type === 'del' ? 'bg-[#dc2626]/25 text-[#fbd5d5]' : ''

  return (
    <div className="border-t border-nova-border flex flex-col bg-[#0f1420] text-slate-300 rounded-b-xl overflow-hidden">
      {/* Diff header (Stitch: file name + lang badge + diff stats + actions) */}
      <div className="flex items-center justify-between px-3 py-2 bg-white/60 dark:bg-white/5 border-b border-nova-border">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs text-nova-text-primary truncate max-w-[180px]">{file}</span>
          <span className="text-[10px] font-mono px-1.5 py-px rounded-full bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/40 shrink-0">
            {lang}
          </span>
          <div className="flex gap-1 text-[10px] font-mono shrink-0">
            <span className="text-success bg-success-10 px-1 rounded">+{parsed?.added ?? 0}</span>
            <span className="text-error bg-error-10 px-1 rounded">−{parsed?.deleted ?? 0}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {staged ? (
            <button
              onClick={() => applyAll('revert')}
              className="text-[10px] font-bold px-2 py-1 rounded-full border border-nova-border bg-white/70 dark:bg-white/10 text-nova-text-secondary hover:bg-white/90 transition-colors"
            >
              {t('git.unstageAllShort')}
            </button>
          ) : (
            <>
              <button
                onClick={() => applyAll('stage')}
                className="text-[10px] font-bold px-2 py-1 rounded-full border border-nova-border bg-white/70 dark:bg-white/10 text-nova-text-secondary hover:bg-white/90 transition-colors"
              >
                {t('git.stageAllShort')}
              </button>
              <button
                onClick={() => applyAll('revert')}
                className="text-[10px] font-bold px-2 py-1 rounded-full border border-error-20 bg-error-10 text-error hover:bg-error-20 transition-colors"
              >
                {t('git.revertAllShort')}
              </button>
            </>
          )}
          <button
            onClick={() => onEditFile(file)}
            className="text-[10px] font-bold px-2 py-1 rounded-full border border-nova-border bg-white/70 dark:bg-white/10 text-nova-text-secondary hover:bg-white/90 transition-colors"
            title={t('git.editFile')}
          >
            {t('git.editFile')}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-white/20 text-nova-text-muted transition-colors"
            title={t('common.close')}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Notice / error */}
      {notice && (
        <div className="px-3 py-1.5 text-[11px] text-warning bg-warning-10 border-b border-warning-30">{notice}</div>
      )}

      {/* Diff body — dark code canvas with hunks */}
      <div className="max-h-[320px] overflow-y-auto font-mono text-[11px] leading-[1.6]">
        {parsed && parsed.hunks.length === 0 && (
          <div className="px-3 py-4 text-center text-slate-500">{t('git.noDiffShort')}</div>
        )}
        {parsed?.hunks.map((hunk, hi) => (
          <div key={hi}>
            {/* Hunk header with per-hunk actions (Stitch: 暂存此块 / 撤销此块) */}
            <div className="group flex items-center justify-between bg-slate-800/60 px-2 py-0.5 text-slate-400 border-y border-slate-700/40">
              <span className="truncate">{hunk.header}</span>
              <span className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0">
                {staged ? (
                  <button
                    onClick={() => applyHunk(hi, 'revert')}
                    disabled={busyHunk === String(hi)}
                    className="text-[9px] uppercase font-bold px-2 py-px rounded-full bg-accent-20 text-blue-300 border border-accent-50 hover:bg-accent-40 disabled:opacity-40"
                  >
                    {t('git.unstageHunkShort')}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => applyHunk(hi, 'stage')}
                      disabled={busyHunk === String(hi)}
                      className="text-[9px] uppercase font-bold px-2 py-px rounded-full bg-accent-20 text-blue-300 border border-accent-50 hover:bg-accent-40 disabled:opacity-40"
                    >
                      {t('git.stageHunk')}
                    </button>
                    <button
                      onClick={() => applyHunk(hi, 'revert')}
                      disabled={busyHunk === String(hi)}
                      className="text-[9px] uppercase font-bold px-2 py-px rounded-full bg-error-20 text-red-300 border border-error-20 hover:bg-error-20 disabled:opacity-40"
                    >
                      {t('git.revertHunk')}
                    </button>
                  </>
                )}
              </span>
            </div>
            {/* Hunk lines with line numbers */}
            {hunk.lines.map((line, li) => (
              <div key={li} className={`flex hover:bg-white/5 ${lineBg(line.type)}`}>
                <span className="w-10 text-right pr-2 text-slate-600 select-none border-r border-slate-700/40 shrink-0">
                  {line.oldLine ?? ''}
                </span>
                <span className="w-10 text-right pr-2 text-slate-600 select-none shrink-0">{line.newLine ?? ''}</span>
                <span className="pl-2 pr-3 whitespace-pre shrink-0 select-none w-4 text-center">
                  {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}
                </span>
                <span className="whitespace-pre flex-1 min-w-0 truncate">{line.text || ' '}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
