import { useRef } from 'react'
import { useDebugStore } from '@/stores/debugStore'
import { useEditorStore } from '@/stores/editorStore'

/** Minimal DAP debug panel: launch config, session controls, breakpoints, console. */
export default function DebugPanel() {
  const {
    isRunning, adapterCommand, breakpoints, output, stoppedAt, error,
    setAdapterCommand, setLaunchConfig, addBreakpoint, removeBreakpoint, clearBreakpoints,
    clearOutput, start, stop, continue: continueSession, pause, step, toggle,
  } = useDebugStore()
  const configRef = useRef<HTMLInputElement>(null)

  const activePath = useEditorStore((s) => s.activeFilePath)

  const addBreakpointAtCursor = () => {
    const editor = (window as unknown as { __monacoEditor?: { getPosition: () => { lineNumber: number } | null } }).__monacoEditor
    const line = editor?.getPosition()?.lineNumber
    if (line && activePath) addBreakpoint(activePath, line)
  }

  return (
    <div className="h-full flex flex-col bg-nova-bg border-t border-nova-border text-xs overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-nova-border shrink-0 flex-wrap">
        <span className="font-medium text-nova-text-secondary mr-1">调试</span>
        <input
          ref={configRef}
          value={adapterCommand}
          onChange={(e) => setAdapterCommand(e.target.value)}
          placeholder="调试适配器命令，如 node mock-adapter.js"
          spellCheck={false}
          className="flex-1 min-w-[160px] px-2 py-0.5 bg-nova-input-bg border border-nova-border rounded text-[11px] text-nova-text-primary outline-none focus:border-nova-accent/50"
        />
        {!isRunning ? (
          <button
            onClick={() => void start()}
            className="px-2 py-0.5 rounded bg-green-600/20 text-green-400 border border-green-600/30 hover:bg-green-600/30"
          >
            ▶ 启动
          </button>
        ) : (
          <>
            <button onClick={() => void pause()} className="px-2 py-0.5 rounded bg-nova-hover hover:bg-nova-border" title="暂停">⏸</button>
            <button onClick={() => void continueSession()} className="px-2 py-0.5 rounded bg-nova-hover hover:bg-nova-border" title="继续">▶</button>
            <button onClick={() => void step('over')} className="px-2 py-0.5 rounded bg-nova-hover hover:bg-nova-border" title="单步跳过">↷</button>
            <button onClick={() => void step('into')} className="px-2 py-0.5 rounded bg-nova-hover hover:bg-nova-border" title="单步进入">↓</button>
            <button onClick={() => void step('out')} className="px-2 py-0.5 rounded bg-nova-hover hover:bg-nova-border" title="单步跳出">↑</button>
            <button onClick={() => void stop()} className="px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20" title="停止">■</button>
          </>
        )}
        <button
          onClick={addBreakpointAtCursor}
          className="px-2 py-0.5 rounded bg-nova-hover hover:bg-nova-border"
          title="在光标处添加断点"
        >
          ⛶ 断点
        </button>
        <button onClick={() => setLaunchConfig({})} className="px-2 py-0.5 rounded bg-nova-hover hover:bg-nova-border" title="重置启动参数">
          重置
        </button>
        <span className="flex-1" />
        {stoppedAt && (
          <span className="text-[10px] text-nova-accent">
            ⏹ 停在 {stoppedAt.path.split(/[/\\]/).pop()} 行 {stoppedAt.line}
          </span>
        )}
        <button onClick={toggle} className="p-0.5 text-nova-text-muted hover:text-white rounded" title="关闭">✕</button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-1 bg-red-500/10 border-b border-red-500/30 text-red-400 text-[11px] shrink-0">{error}</div>
      )}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Breakpoints */}
        <div className="w-44 shrink-0 border-r border-nova-border overflow-y-auto p-1">
          <div className="text-[10px] text-nova-text-muted px-1 py-0.5">断点 ({breakpoints.length})</div>
          {breakpoints.length === 0 && (
            <div className="text-[10px] text-nova-text-muted px-1 py-1">暂无 — 用「⛶ 断点」在光标处添加</div>
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
                aria-label="移除断点"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={clearBreakpoints}
            className="text-[10px] text-nova-text-muted hover:text-red-400 px-1 py-0.5"
          >
            清除全部
          </button>
        </div>

        {/* Console */}
        <div className="flex-1 min-w-0 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-nova-text-muted">输出</span>
            <button onClick={clearOutput} className="text-[10px] text-nova-text-muted hover:text-white">清空</button>
          </div>
          {output.length === 0 && <div className="text-nova-text-muted text-[10px]">（启动调试后显示 stdout/stderr）</div>}
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
