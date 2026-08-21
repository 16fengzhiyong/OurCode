import { useRef } from 'react'
import { useDebugStore } from '@/stores/debugStore'
import { useEditorStore } from '@/stores/editorStore'
import { useI18n } from '@/i18n/useI18n'

/** Minimal DAP debug panel: launch config, session controls, breakpoints, console. */
export default function DebugPanel() {
  // Fine-grained selectors: output grows line-by-line during a debug session,
  // but adapterCommand/breakpoints/etc. churn must not re-render the console
  // list, and vice versa.
  const isRunning = useDebugStore((s) => s.isRunning)
  const adapterCommand = useDebugStore((s) => s.adapterCommand)
  const breakpoints = useDebugStore((s) => s.breakpoints)
  const output = useDebugStore((s) => s.output)
  const stoppedAt = useDebugStore((s) => s.stoppedAt)
  const error = useDebugStore((s) => s.error)
  const setAdapterCommand = useDebugStore((s) => s.setAdapterCommand)
  const setLaunchConfig = useDebugStore((s) => s.setLaunchConfig)
  const addBreakpoint = useDebugStore((s) => s.addBreakpoint)
  const removeBreakpoint = useDebugStore((s) => s.removeBreakpoint)
  const clearBreakpoints = useDebugStore((s) => s.clearBreakpoints)
  const clearOutput = useDebugStore((s) => s.clearOutput)
  const start = useDebugStore((s) => s.start)
  const stop = useDebugStore((s) => s.stop)
  const continueSession = useDebugStore((s) => s.continue)
  const pause = useDebugStore((s) => s.pause)
  const step = useDebugStore((s) => s.step)
  const toggle = useDebugStore((s) => s.toggle)
  const configRef = useRef<HTMLInputElement>(null)
  const t = useI18n()

  const activePath = useEditorStore((s) => s.activeFilePath)

  const addBreakpointAtCursor = () => {
    const editor = (window as unknown as { __monacoEditor?: { getPosition: () => { lineNumber: number } | null } }).__monacoEditor
    const line = editor?.getPosition()?.lineNumber
    if (line && activePath) addBreakpoint(activePath, line)
  }

  return (
    <div className="h-full flex flex-col bg-transparent text-xs overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-nova-border shrink-0 flex-wrap">
        <span className="font-medium text-nova-text-secondary mr-1">{t('editor.debugTitle')}</span>
        <input
          ref={configRef}
          value={adapterCommand}
          onChange={(e) => setAdapterCommand(e.target.value)}
          placeholder={t('editor.debugAdapterPlaceholder')}
          spellCheck={false}
          className="flex-1 min-w-[160px] px-2 py-0.5 bg-nova-input-bg border border-nova-border rounded text-[11px] text-nova-text-primary outline-none focus:border-nova-accent/50"
        />
        {!isRunning ? (
          <button
            onClick={() => void start()}
            className="px-2 py-0.5 rounded bg-green-600/20 text-green-400 border border-green-600/30 hover:bg-green-600/30"
          >
            {t('editor.debugStart')}
          </button>
        ) : (
          <>
            <button onClick={() => void pause()} className="px-2 py-0.5 rounded bg-nova-hover hover:bg-nova-border" title={t('editor.debugPause')}>⏸</button>
            <button onClick={() => void continueSession()} className="px-2 py-0.5 rounded bg-nova-hover hover:bg-nova-border" title={t('editor.debugContinue')}>▶</button>
            <button onClick={() => void step('over')} className="px-2 py-0.5 rounded bg-nova-hover hover:bg-nova-border" title={t('editor.debugStepOver')}>↷</button>
            <button onClick={() => void step('into')} className="px-2 py-0.5 rounded bg-nova-hover hover:bg-nova-border" title={t('editor.debugStepInto')}>↓</button>
            <button onClick={() => void step('out')} className="px-2 py-0.5 rounded bg-nova-hover hover:bg-nova-border" title={t('editor.debugStepOut')}>↑</button>
            <button onClick={() => void stop()} className="px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20" title={t('editor.debugStop')}>■</button>
          </>
        )}
        <button
          onClick={addBreakpointAtCursor}
          className="px-2 py-0.5 rounded bg-nova-hover hover:bg-nova-border"
          title={t('editor.debugAddBreakpoint')}
        >
          {t('editor.debugBreakpoint')}
        </button>
        <button onClick={() => setLaunchConfig({})} className="px-2 py-0.5 rounded bg-nova-hover hover:bg-nova-border" title={t('editor.debugResetLaunch')}>
          {t('editor.debugReset')}
        </button>
        <span className="flex-1" />
        {stoppedAt && (
          <span className="text-[10px] text-nova-accent">
            {t('editor.debugStoppedAt', { name: stoppedAt.path.split(/[/\\]/).pop() || stoppedAt.path, line: stoppedAt.line })}
          </span>
        )}
        <button onClick={toggle} className="p-0.5 text-nova-text-muted hover:text-white rounded" title={t('common.close')}>✕</button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-1 bg-red-500/10 border-b border-red-500/30 text-red-400 text-[11px] shrink-0">{error}</div>
      )}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Breakpoints */}
        <div className="w-44 shrink-0 border-r border-nova-border overflow-y-auto p-1">
          <div className="text-[10px] text-nova-text-muted px-1 py-0.5">{t('editor.debugBreakpoints', { count: breakpoints.length })}</div>
          {breakpoints.length === 0 && (
            <div className="text-[10px] text-nova-text-muted px-1 py-1">{t('editor.debugNoBreakpoints')}</div>
          )}
          {breakpoints.map((bp, i) => (
            <div key={`${bp.path}-${bp.line}-${i}`} className="flex items-center gap-1 px-1 py-0.5 hover:bg-nova-hover rounded group">
              <span className="text-red-400">●</span>
              <span className="truncate flex-1" title={bp.path}>
                {bp.path.split(/[/\\]/).pop()}:{bp.line}
              </span>
              <button
                onClick={() => removeBreakpoint(bp.path, bp.line)}
                className="opacity-0 group-hover:opacity-100 text-nova-text-muted hover:text-red-400"
                aria-label={t('editor.debugRemoveBreakpoint')}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={clearBreakpoints}
            className="text-[10px] text-nova-text-muted hover:text-red-400 px-1 py-0.5"
          >
            {t('editor.debugClearAll')}
          </button>
        </div>

        {/* Console */}
        <div className="flex-1 min-w-0 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-nova-text-muted">{t('editor.debugOutput')}</span>
            <button onClick={clearOutput} className="text-[10px] text-nova-text-muted hover:text-white">{t('editor.debugClear')}</button>
          </div>
          {output.length === 0 && <div className="text-nova-text-muted text-[10px]">{t('editor.debugOutputEmpty')}</div>}
          {output.map((line) => (
            <div key={line.id} className={line.category === 'stderr' ? 'text-red-400' : 'text-nova-text-secondary'}>
              {line.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
