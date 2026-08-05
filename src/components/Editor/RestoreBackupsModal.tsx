import { useState } from 'react'
import type { BackupEntry } from '@shared/types'
import { useEditorStore } from '@/stores/editorStore'
import { useI18n } from '@/i18n/useI18n'
import { getLocale } from '@/i18n'

interface RestoreBackupsModalProps {
  backups: BackupEntry[]
  onClose: () => void
}

/** Shown on startup when the previous session left unsaved buffers behind. */
export default function RestoreBackupsModal({ backups: initial, onClose }: RestoreBackupsModalProps) {
  const [backups, setBackups] = useState<BackupEntry[]>(initial)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const t = useI18n()

  const fileName = (p: string) => p.split(/[/\\]/).pop() || p

  const restore = async (entry: BackupEntry) => {
    setBusyPath(entry.filePath)
    setError(null)
    try {
      const data = await window.electronAPI.readBackup(entry.filePath)
      if (!data) {
        setError(t('editor.backupInvalid', { name: fileName(entry.filePath) }))
        setBackups((prev) => prev.filter((b) => b.filePath !== entry.filePath))
        return
      }
      await useEditorStore.getState().restoreFromBackup(entry.filePath, data.content, data.encoding, data.hasBom)
      await window.electronAPI.deleteBackup(entry.filePath)
      setBackups((prev) => prev.filter((b) => b.filePath !== entry.filePath))
    } catch (e) {
      setError(t('editor.restoreFailed', { error: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusyPath(null)
    }
  }

  const discard = async (entry: BackupEntry) => {
    setBusyPath(entry.filePath)
    await window.electronAPI.deleteBackup(entry.filePath).catch(() => {})
    setBackups((prev) => prev.filter((b) => b.filePath !== entry.filePath))
    setBusyPath(null)
  }

  const restoreAll = async () => {
    for (const b of backups) {
      await restore(b)
      if (error) break
    }
  }

  const discardAll = async () => {
    await window.electronAPI.clearBackups().catch(() => {})
    setBackups([])
  }

  if (backups.length === 0) return null

  const formatTime = (ms: number) => {
    const d = new Date(ms)
    return d.toLocaleString(getLocale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={t('editor.backupsDialog')} className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-nova-surface border border-nova-border rounded-xl shadow-2xl w-[560px] max-h-[70vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-nova-border">
          <h2 className="text-lg font-semibold text-nova-text-primary">{t('editor.backupsDialog')}</h2>
          <p className="text-xs text-nova-text-muted mt-1">
            {t('editor.backupsDesc')}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {error && (
            <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
              {error}
            </div>
          )}
          {backups.map((entry) => (
            <div key={entry.filePath} className="flex items-center gap-3 px-3 py-2.5 bg-nova-bg border border-nova-border rounded-lg">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-nova-text-primary truncate">{fileName(entry.filePath)}</div>
                <div className="text-[11px] text-nova-text-muted truncate mt-0.5">
                  {entry.filePath} · {formatTime(entry.mtime)} · {(entry.size / 1024).toFixed(1)} KB
                </div>
              </div>
              <button
                onClick={() => restore(entry)}
                disabled={busyPath === entry.filePath}
                className="px-3 py-1 text-xs font-medium bg-nova-accent text-white rounded-md hover:opacity-90 disabled:opacity-40 shrink-0"
              >
                {busyPath === entry.filePath ? t('editor.restoring') : t('editor.restore')}
              </button>
              <button
                onClick={() => discard(entry)}
                disabled={busyPath === entry.filePath}
                className="px-3 py-1 text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 rounded-md hover:bg-red-500/20 disabled:opacity-40 shrink-0"
              >
                {t('editor.discard')}
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-nova-border">
          <button
            onClick={discardAll}
            className="px-3 py-1.5 text-xs text-nova-text-muted hover:text-red-400 transition-colors"
          >
            {t('editor.discardAll')}
          </button>
          <button
            onClick={restoreAll}
            className="px-4 py-1.5 text-xs font-medium bg-nova-accent text-white rounded-md hover:opacity-90"
          >
            {t('editor.restoreAll')}
          </button>
        </div>
      </div>
    </div>
  )
}
