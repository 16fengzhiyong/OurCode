import { useState, useEffect, useRef } from 'react'
import { useRecentFilesStore } from '@/stores/recentFilesStore'
import { useEditorStore } from '@/stores/editorStore'

/** VS Code Ctrl+R: quick list of recently opened files. */
export default function RecentFilesModal() {
  const files = useRecentFilesStore((s) => s.files)
  const setOpen = useRecentFilesStore((s) => s.setOpen)
  const removeRecentFile = useRecentFilesStore((s) => s.removeRecentFile)
  const clearRecentFiles = useRecentFilesStore((s) => s.clearRecentFiles)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')

  const filtered = files.filter((f) => {
    const name = f.split(/[/\\]/).pop() || f
    const q = query.toLowerCase()
    return !q || name.toLowerCase().includes(q) || f.toLowerCase().includes(q)
  })

  useEffect(() => {
    inputRef.current?.focus()
    setQuery('')
    setSelectedIndex(0)
  }, [])

  const openFile = async (path: string) => {
    await useEditorStore.getState().openFile(path)
    setOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[selectedIndex]) void openFile(filtered[selectedIndex])
    } else if (e.key === 'Delete' && filtered[selectedIndex]) {
      removeRecentFile(filtered[selectedIndex])
      setSelectedIndex(0)
    }
  }

  const fileName = (p: string) => p.split(/[/\\]/).pop() || p

  return (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-center pt-[15%] z-[100] backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="最近打开的文件"
        className="w-[520px] bg-nova-surface rounded-2xl shadow-2xl border border-nova-border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 border-b border-nova-border">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0) }}
            onKeyDown={handleKeyDown}
            placeholder="最近打开的文件 — 回车打开，Delete 移除"
            className="w-full bg-transparent text-nova-text-primary outline-none placeholder:text-nova-text-muted text-sm"
          />
        </div>

        <div className="max-h-[320px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-nova-text-muted text-sm">暂无最近文件</div>
          ) : (
            filtered.map((path, index) => (
              <div
                key={path}
                className={`
                  flex items-center gap-2 px-4 py-2 cursor-pointer mx-1 rounded-lg
                  ${index === selectedIndex ? 'bg-nova-accent/20' : 'hover:bg-nova-hover'}
                `}
                onClick={() => void openFile(path)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <svg className="w-3.5 h-3.5 text-nova-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6M6 4h12v16H6z" />
                </svg>
                <span className="text-sm text-nova-text-primary truncate">{fileName(path)}</span>
                <span className="text-[10px] text-nova-text-muted truncate ml-auto shrink-0 max-w-[45%]">{path}</span>
              </div>
            ))
          )}
        </div>

        {files.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-nova-border">
            <span className="text-[10px] text-nova-text-muted">共 {files.length} 条 · Delete 移除</span>
            <button
              onClick={clearRecentFiles}
              className="text-[10px] text-red-400 hover:text-red-300 transition-colors"
            >
              清空记录
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
