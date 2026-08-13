import { memo, useEffect, useState } from 'react'
import { getFileIconHTML } from '@/utils/fileIcons'
import { basename, isPathInside } from '@/utils/fileRefs'

interface FileChipProps {
  path: string
  /** Workspace root — needed to detect folders via fs:stat (out-of-workspace
   *  paths are rejected by the main-process guard and fall back to file icon). */
  rootPath?: string
  /** Show a remove (×) button — input box usage; message chips omit it. */
  removable?: boolean
  onRemove?: (path: string) => void
  /** Clicking a chip opens the file (message bubbles); input chips don't. */
  onOpen?: (path: string) => void
  removeLabel?: string
}

/**
 * Flat capsule chip for an attached file/folder (极简纯净版: solid surface +
 * hairline border, 14px file icon + 11px label, × close turning red on hover).
 */
function FileChip({ path, rootPath, removable, onRemove, onOpen, removeLabel }: FileChipProps) {
  const [isDir, setIsDir] = useState(false)

  // Folders show a folder icon + trailing-slash link. Only in-workspace paths
  // can be stat'ed (fs:stat is guarded by allowedRoots); failures stay files.
  useEffect(() => {
    let cancelled = false
    if (!rootPath || !isPathInside(path, rootPath)) return
    window.electronAPI
      .stat(path)
      .then((s) => {
        if (!cancelled && s?.isDirectory) setIsDir(true)
      })
      .catch(() => { /* out-of-workspace / unreadable — keep file icon */ })
    return () => {
      cancelled = true
    }
  }, [path, rootPath])

  const icon = getFileIconHTML(basename(path), isDir, false, 14)
  const clickable = !!onOpen

  return (
    <span
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onOpen(path) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpen(path)
              }
            }
          : undefined
      }
      title={path}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium max-w-[240px] ${
        clickable ? 'cursor-pointer hover:bg-nova-hover transition-colors' : ''
      }`}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border-strong)',
        color: 'var(--text-primary)',
      }}
    >
      <span className="shrink-0 flex items-center" dangerouslySetInnerHTML={icon} />
      <span className="truncate">{basename(path)}</span>
      {removable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove?.(path)
          }}
          aria-label={removeLabel}
          className="shrink-0 ml-0.5 flex items-center justify-center text-nova-text-muted hover:text-nova-error transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </span>
  )
}

export default memo(FileChip)
