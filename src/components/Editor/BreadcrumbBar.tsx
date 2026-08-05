import { useMemo } from 'react'
import { findEnclosingSymbols } from '@/editor/breadcrumbs'
import { useEditorStore } from '@/stores/editorStore'

const KIND_ICON: Record<string, string> = {
  class: '⛶', interface: '◈', function: 'ƒ', method: 'ƒ', const: '◆', def: 'ƒ', other: '•',
}

/** VS Code-style breadcrumb: file path segments + the symbol chain at the cursor. */
export default function BreadcrumbBar() {
  const activeFilePath = useEditorStore((s) => s.activeFilePath)
  const cursorPosition = useEditorStore((s) => s.cursorPosition)

  const { dirs, fileName, symbols } = useMemo(() => {
    if (!activeFilePath) return { dirs: [], fileName: '', symbols: [] }
    const parts = activeFilePath.split(/[/\\]/).filter(Boolean)
    const name = parts[parts.length - 1] || activeFilePath

    // Symbol chain: tokenize cheaply from the live Monaco model
    let chain: ReturnType<typeof findEnclosingSymbols> = []
    const editor = (window as unknown as { __monacoEditor?: { getModel: () => { getLinesContent: () => string[] } | null } }).__monacoEditor
    const model = editor?.getModel()
    if (model && cursorPosition) {
      chain = findEnclosingSymbols(model.getLinesContent(), cursorPosition.line)
    }
    return { dirs: parts.slice(0, -1), fileName: name, symbols: chain }
  }, [activeFilePath, cursorPosition])

  if (!activeFilePath) return null

  return (
    <div className="flex items-center gap-1 px-3 py-0.5 text-[11px] text-nova-text-muted border-b border-nova-border-light bg-nova-editor/60 overflow-x-auto whitespace-nowrap shrink-0 select-none">
      <svg className="w-3 h-3 text-nova-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z" />
      </svg>
      {dirs.map((dir, i) => (
        <span key={`${dir}-${i}`} className="flex items-center gap-1">
          <span className="hover:text-nova-text-primary transition-colors cursor-default" title={dir}>{dir}</span>
          <span className="text-nova-text-muted/60">/</span>
        </span>
      ))}
      <span className="text-nova-text-primary font-medium">{fileName}</span>

      {symbols.length > 0 && (
        <>
          <span className="text-nova-text-muted/60 mx-0.5">›</span>
          {symbols.map((s, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-nova-text-muted/60">›</span>}
              <span className="text-nova-accent/90" title={s.kind}>
                {KIND_ICON[s.kind] ?? '•'} {s.name}
              </span>
            </span>
          ))}
        </>
      )}
    </div>
  )
}
