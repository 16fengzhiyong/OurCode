import { useMemo } from 'react'
import { findEnclosingSymbols } from '@/editor/breadcrumbs'
import { useEditorStore } from '@/stores/editorStore'

const KIND_ICON: Record<string, string> = {
  class: '⛶', interface: '◈', function: 'ƒ', method: 'ƒ', const: '◆', def: 'ƒ', other: '•',
}

/** Cap on how many lines above the cursor are scanned for the symbol chain —
 *  a real chain (class → method → …) never spans thousands of lines, and
 *  copying the whole file per cursor move (getLinesContent) froze editing on
 *  big files. */
const SYMBOL_SCAN_LIMIT = 2000

/** VS Code-style breadcrumb: file path segments + the symbol chain at the cursor. */
export default function BreadcrumbBar() {
  const activeFilePath = useEditorStore((s) => s.activeFilePath)
  const cursorPosition = useEditorStore((s) => s.cursorPosition)
  // Symbol chain depends only on the LINE, not the column — depending on the
  // position object would re-run the up-to-2000-line scan on every keystroke.
  const cursorLine = cursorPosition?.line

  const { dirs, fileName, symbols } = useMemo(() => {
    if (!activeFilePath) return { dirs: [], fileName: '', symbols: [] }
    const parts = activeFilePath.split(/[/\\]/).filter(Boolean)
    const name = parts[parts.length - 1] || activeFilePath

    // Symbol chain: tokenize cheaply from the live Monaco model. Fetch ONLY the
    // bounded window above the cursor — line-by-line getLineContent — instead of
    // getLinesContent(), which copies the entire buffer on every cursor move.
    let chain: ReturnType<typeof findEnclosingSymbols> = []
    const editor = (window as unknown as { __monacoEditor?: { getModel: () => { getLineContent: (n: number) => string } | null } }).__monacoEditor
    const model = editor?.getModel()
    if (model && cursorLine) {
      const start = Math.max(1, cursorLine - SYMBOL_SCAN_LIMIT)
      const lines: string[] = []
      for (let n = start; n <= cursorLine; n++) lines.push(model.getLineContent(n))
      chain = findEnclosingSymbols(lines, cursorLine - start + 1)
    }
    return { dirs: parts.slice(0, -1), fileName: name, symbols: chain }
  }, [activeFilePath, cursorLine])

  if (!activeFilePath) return null

  return (
    <div className="flex items-center gap-1 px-3 py-1 text-[11px] text-nova-text-muted bg-transparent overflow-x-auto whitespace-nowrap shrink-0 select-none">
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
