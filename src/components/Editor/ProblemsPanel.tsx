import { useMemo } from 'react'
import { useProblemsStore, Problem, ProblemSeverity } from '@/stores/problemsStore'
import { useChatStore } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'
import { useUIStore } from '@/stores/uiStore'
import { useI18n } from '@/i18n/useI18n'
import type { TranslationKey } from '@/i18n'

const SEVERITY_STYLE: Record<ProblemSeverity, { icon: string; color: string }> = {
  error: { icon: '✕', color: '#f48771' },
  warning: { icon: '⚠', color: '#cca700' },
  info: { icon: 'ⓘ', color: '#57a3f8' },
  hint: { icon: '💡', color: '#57a3f8' },
}

const SEVERITY_LABEL_KEY: Record<ProblemSeverity, TranslationKey> = {
  error: 'editor.severityError',
  warning: 'editor.severityWarning',
  info: 'editor.severityInfo',
  hint: 'editor.severityHint',
}

export default function ProblemsPanel() {
  const problems = useProblemsStore((s) => s.problems)
  const openProblem = useProblemsStore((s) => s.openProblem)
  const toggle = useProblemsStore((s) => s.toggle)
  const t = useI18n()

  /** Windsurf-style "Explain and Fix": send the diagnostic to the chat agent */
  const explainAndFix = () => {
    const target = problems.find((p) => p.severity === 'error') || problems[0]
    if (!target) return
    const chatStore = useChatStore.getState()
    if (!chatStore.activeSessionId) {
      const configStore = useConfigStore.getState()
      if (configStore.activeConfigGroupId) {
        chatStore.createSession(configStore.activeConfigGroupId)
      }
    }
    const label = t(SEVERITY_LABEL_KEY[target.severity])
    chatStore.sendMessage(
      `（解释并修复）文件 ${target.filePath} 第 ${target.line} 行有${label}:\n\n` +
      `> ${target.message}\n\n` +
      `请解释原因并给出修复方案。如果有修复后的代码，请用代码块输出。`
    )
    useUIStore.getState().toggleChat()
  }

  // Group by file, preserving sort (errors first, then by line)
  const groups = useMemo(() => {
    const map = new Map<string, Problem[]>()
    for (const p of problems) {
      const list = map.get(p.filePath)
      if (list) list.push(p)
      else map.set(p.filePath, [p])
    }
    return Array.from(map.entries())
  }, [problems])

  const count = (sev: ProblemSeverity) => problems.filter((p) => p.severity === sev).length

  return (
    <div className="h-full flex flex-col bg-nova-bg border-t border-nova-border text-xs overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-nova-border shrink-0">
        <span className="font-medium text-nova-text-secondary mr-2">{t('editor.problems')}</span>
        <span className="px-1.5 rounded text-[10px] text-red-400 bg-red-500/10" title={t('editor.severityError')}>{count('error')}</span>
        <span className="px-1.5 rounded text-[10px] text-yellow-400 bg-yellow-500/10" title={t('editor.severityWarning')}>{count('warning')}</span>
        <span className="px-1.5 rounded text-[10px] text-[#57a3f8] bg-[#57a3f8]/10" title={t('editor.severityInfo')}>{count('info')}</span>
        <span className="flex-1" />
        <button
          onClick={explainAndFix}
          className="px-2 py-0.5 text-[10px] text-nova-accent hover:bg-nova-accent/15 rounded transition-colors"
          title={t('editor.explainFixHint')}
        >
          {t('editor.explainFix')}
        </button>
        <button
          onClick={toggle}
          className="p-0.5 text-nova-text-muted hover:text-white rounded"
          title={t('editor.closeButton')}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeWidth={2} d="M6 6l12 12M6 18L18 6" />
          </svg>
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <div className="flex items-center justify-center h-full text-nova-text-muted">
            {t('editor.problemsNone')}
          </div>
        ) : (
          groups.map(([filePath, list]) => (
            <div key={filePath}>
              <div className="px-3 py-1 font-medium text-nova-text-secondary bg-nova-surface/50 sticky top-0 flex items-center gap-2">
                <svg className="w-3.5 h-3.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6M6 4h12v16H6z" />
                </svg>
                <span className="truncate">{filePath}</span>
                <span className="ml-auto text-nova-text-muted text-[10px] shrink-0">{list.length}</span>
              </div>
              {list.map((p, i) => (
                <button
                  key={`${p.line}-${p.column}-${i}`}
                  onClick={() => openProblem(p)}
                  className="w-full text-left px-3 py-1 flex items-start gap-2 hover:bg-nova-hover hover:text-white transition-colors"
                >
                  <span className="shrink-0 mt-0.5" style={{ color: SEVERITY_STYLE[p.severity].color }}>
                    {SEVERITY_STYLE[p.severity].icon}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="text-nova-text-primary">{p.message}</span>
                    {p.source && <span className="text-nova-text-muted ml-1">[{p.source}]</span>}
                  </span>
                  <span className="text-nova-text-muted shrink-0 ml-2" title={t(SEVERITY_LABEL_KEY[p.severity])}>
                    {t('editor.lineCol', { line: p.line, col: p.column })}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
