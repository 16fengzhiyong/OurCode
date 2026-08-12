import { useRef, useEffect } from 'react'
import { monaco, OURCODE_DARK_THEME, OURCODE_LIGHT_THEME } from '@/editor/monacoSetup'
import { useI18n } from '@/i18n/useI18n'

interface DiffViewProps {
  original: string
  modified: string
  language: string
  onClose: () => void
  /** Header title — defaults to the generic diff label. Pass the file name for
   *  the central-editor diff view. */
  title?: string
  /** When provided, renders a "revert this change" button in the header. */
  onRevert?: () => void
  /** Optional banner above the editor (e.g. "no pre-edit snapshot found"). */
  notice?: string
}

export default function DiffView({ original, modified, language, onClose, title, onRevert, notice }: DiffViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const t = useI18n()

  useEffect(() => {
    if (!containerRef.current) return

    const isDark = document.documentElement.classList.contains('dark')
    const diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
      automaticLayout: true,
      readOnly: true,
      renderSideBySide: true,
      enableSplitViewResizing: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      theme: isDark ? OURCODE_DARK_THEME : OURCODE_LIGHT_THEME,
    })

    const originalModel = monaco.editor.createModel(original, language)
    const modifiedModel = monaco.editor.createModel(modified, language)

    diffEditor.setModel({
      original: originalModel,
      modified: modifiedModel,
    })

    editorRef.current = diffEditor

    return () => {
      originalModel.dispose()
      modifiedModel.dispose()
      diffEditor.dispose()
    }
  }, [original, modified, language])

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 bg-nova-surface border-b border-nova-border shrink-0">
        <span className="text-sm text-nova-text-primary font-medium truncate" title={title}>
          {title || t('editor.diffTitle')}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {onRevert && (
            <button
              onClick={onRevert}
              className="px-2.5 py-1 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded-md hover:bg-red-500/30 transition-colors flex items-center gap-1"
              title="回退此变更"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 3-6.7" />
                <path d="M3 4v5h5" />
              </svg>
              回退此变更
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 text-nova-text-muted hover:text-nova-text-primary rounded transition-colors"
            title={t('common.close')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      {notice && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 text-xs bg-amber-500/15 text-amber-400 border-b border-amber-500/20">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
          <span>{notice}</span>
        </div>
      )}
      <div ref={containerRef} className="flex-1" />
    </div>
  )
}
