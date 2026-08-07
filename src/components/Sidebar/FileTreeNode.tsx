import { useState } from 'react'
import { FileEntry } from '@/types'
import { getFileIconHTML } from '@/utils/fileIcons'
import { useUIStore } from '@/stores/uiStore'
import { useEditorStore } from '@/stores/editorStore'
import { useI18n } from '@/i18n/useI18n'

// Module-level clipboard for file copy/cut operations
const fileClipboard: { path: string | null; action: 'copy' | 'cut' | null } = { path: null, action: null }
// Module-level drag source
const dragSource: { path: string | null; isDirectory: boolean } = { path: null, isDirectory: false }

interface FileTreeNodeProps {
  entry: FileEntry
  depth: number
  isExpanded: boolean
  onToggle: (path: string) => void
  onClick: (path: string, isDirectory: boolean) => void
  searchQuery: string
  onRefresh?: () => void
}

export default function FileTreeNode({
  entry,
  depth,
  isExpanded,
  onToggle,
  onClick,
  searchQuery,
  onRefresh,
}: FileTreeNodeProps) {
  const paddingLeft = depth * 12 + 8
  const { showContextMenu } = useUIStore()
  const [isDragOver, setIsDragOver] = useState(false)
  const t = useI18n()

  const handleClick = () => {
    onClick(entry.path, entry.isDirectory)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const sep = entry.path.includes('/') ? '/' : '\\'
    const parentPath = entry.path.substring(0, entry.path.lastIndexOf(sep))
    const getDestPath = (dir: string, name: string) => `${dir}${sep}${name}`

    const commonFileItems = [
      {
        label: t('common.copy'),
        icon: '',
        action: () => { fileClipboard.path = entry.path; fileClipboard.action = 'copy' },
      },
      {
        label: t('sidebar.cut'),
        icon: '',
        action: () => { fileClipboard.path = entry.path; fileClipboard.action = 'cut' },
      },
      { separator: true, label: '' },
      {
        label: t('common.rename'),
        icon: '',
        action: async () => {
          const newName = prompt(t('sidebar.renamePrompt'), entry.name)
          if (newName && newName !== entry.name) {
            await window.electronAPI.rename(entry.path, getDestPath(parentPath, newName))
            onRefresh?.()
          }
        },
      },
      {
        label: t('common.delete'),
        icon: '',
        action: async () => {
          if (confirm(t('sidebar.deleteConfirm', { name: entry.name }))) {
            await window.electronAPI.delete(entry.path)
            onRefresh?.()
          }
        },
      },
      { separator: true, label: '' },
      {
        label: t('sidebar.copyPath'),
        icon: '',
        action: () => window.electronAPI.copyPath(entry.path),
      },
      {
        label: t('sidebar.revealInExplorer'),
        icon: '',
        action: () => window.electronAPI.openInFinder(entry.path),
      },
    ]

    const pasteItem = fileClipboard.path ? {
      label: fileClipboard.action === 'cut' ? t('sidebar.pasteMove') : t('sidebar.paste'),
      icon: '',
      action: async () => {
        if (!fileClipboard.path) return
        const srcName = fileClipboard.path.split(/[/\\]/).pop() || ''
        const dest = getDestPath(entry.path, srcName)
        try {
          if (fileClipboard.action === 'cut') {
            await window.electronAPI.move(fileClipboard.path, dest)
            fileClipboard.path = null
            fileClipboard.action = null
          } else {
            await window.electronAPI.copy(fileClipboard.path, dest)
          }
          onRefresh?.()
        } catch (err) {
          alert(t('sidebar.operationFailed', { error: String(err) }))
        }
      },
    } : null

    const items = entry.isDirectory ? [
      {
        label: t('sidebar.newFile'),
        icon: '',
        action: async () => {
          const name = prompt(t('sidebar.newFileNamePrompt'))
          if (name) {
            await window.electronAPI.createFile(getDestPath(entry.path, name))
            onRefresh?.()
          }
        },
      },
      {
        label: t('sidebar.newFolder'),
        icon: '',
        action: async () => {
          const name = prompt(t('sidebar.newFolderNamePrompt'))
          if (name) {
            await window.electronAPI.createDir(getDestPath(entry.path, name))
            onRefresh?.()
          }
        },
      },
      ...(pasteItem ? [{ separator: true, label: '' }, pasteItem] : []),
      { separator: true, label: '' },
      ...commonFileItems.slice(0, 2), // copy, cut
      ...commonFileItems.slice(2),    // separator + rename + delete + separator + copyPath + openInFinder
    ] : [
      {
        label: t('sidebar.open'),
        icon: '',
        action: () => useEditorStore.getState().openFile(entry.path),
      },
      { separator: true, label: '' },
      ...commonFileItems,
    ]

    showContextMenu(e.clientX, e.clientY, items)
  }

  const handleDragStart = (e: React.DragEvent) => {
    dragSource.path = entry.path
    dragSource.isDirectory = entry.isDirectory
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', entry.path)
  }

  const handleDragOver = (e: React.DragEvent) => {
    if (!entry.isDirectory) return
    if (!dragSource.path) return
    // Prevent dropping onto self
    if (dragSource.path === entry.path) return
    // Prevent dropping a parent folder into its own child
    const sep = dragSource.path.includes('/') ? '/' : '\\'
    if (dragSource.isDirectory && entry.path.startsWith(dragSource.path + sep)) return

    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    const src = dragSource.path
    if (!src || !entry.isDirectory) return
    if (src === entry.path) return

    const sep = src.includes('/') ? '/' : '\\'
    if (dragSource.isDirectory && entry.path.startsWith(src + sep)) return

    const srcName = src.split(/[/\\]/).pop() || ''
    const dest = `${entry.path}${sep}${srcName}`

    try {
      await window.electronAPI.move(src, dest)
      onRefresh?.()
    } catch (err) {
      alert(t('sidebar.moveFailed', { error: String(err) }))
    }
  }

  const handleDragEnd = () => {
    dragSource.path = null
    dragSource.isDirectory = false
    setIsDragOver(false)
  }

  return (
    <div>
      <div
        className={`flex items-center h-[26px] px-2 hover:bg-nova-hover cursor-pointer group rounded-md mx-2 transition-colors ${
          isDragOver ? 'bg-nova-accent/15 ring-1 ring-nova-accent/50' : ''
        }`}
        style={{ paddingLeft }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        draggable={true}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
      >
        {/* Expand/Collapse icon */}
        {entry.isDirectory ? (
          <span className="w-4 mr-1 text-text-muted text-xs">
            {isExpanded ? '▼' : '▶'}
          </span>
        ) : (
          <span className="w-4 mr-1" />
        )}

        {/* File icon */}
        <span
          className="mr-2 flex items-center"
          dangerouslySetInnerHTML={getFileIconHTML(entry.name, entry.isDirectory, isExpanded, 16)}
        />

        {/* File name */}
        <span className={`flex-1 text-[13px] truncate group-hover:text-white transition-colors ${
          entry.isDirectory ? 'text-nova-text-secondary' : 'text-nova-text-primary'
        }`}>
          {entry.name}
        </span>

        {/* Git status */}
        {entry.gitStatus && (
          <span
            className={`text-xs px-1 rounded ${
              entry.gitStatus === 'modified'
                ? 'text-[#E5BA7D]'
                : entry.gitStatus === 'added'
                ? 'text-[#73C991]'
                : entry.gitStatus === 'deleted'
                ? 'text-[#F48771]'
                : 'text-[#3B82F6]'
            }`}
          >
            {entry.gitStatus === 'modified' ? 'M' : entry.gitStatus === 'added' ? 'A' : entry.gitStatus === 'deleted' ? 'D' : 'R'}
          </span>
        )}
      </div>

      {/* Children */}
      {entry.isDirectory && isExpanded && entry.children && (
        <div>
          {entry.children.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              isExpanded={false}
              onToggle={onToggle}
              onClick={onClick}
              searchQuery={searchQuery}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}
    </div>
  )
}
