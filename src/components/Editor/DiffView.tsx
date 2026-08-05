import { useRef, useEffect } from 'react'
import { monaco } from '@/editor/monacoSetup'

interface DiffViewProps {
  original: string
  modified: string
  language: string
  onClose: () => void
}

export default function DiffView({ original, modified, language, onClose }: DiffViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
      automaticLayout: true,
      readOnly: true,
      renderSideBySide: true,
      enableSplitViewResizing: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      theme: 'vs-dark',
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
        <span className="text-sm text-nova-text-primary font-medium">差异对比</span>
        <button
          onClick={onClose}
          className="p-1 text-nova-text-muted hover:text-nova-text-primary rounded transition-colors"
          title="关闭"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div ref={containerRef} className="flex-1" />
    </div>
  )
}
