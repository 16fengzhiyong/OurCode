import { useEffect, useMemo } from 'react'
import { useI18n } from '@/i18n/useI18n'

interface RevertAllConfirmDialogProps {
  /** Files to be reverted (deduped paths). */
  filePaths: string[]
  /** Execute the revert of all pending files. */
  onRevert: () => void
  /** Keep the changes — do nothing. */
  onKeep: () => void
  /** Abort. */
  onClose: () => void
}

/** 点「回退全部改动」时的确认弹窗 —— 中性灰 · 极简纯净版（与
 *  RegenerateConfirmDialog 同风格）：列出一批待回退文件的完整路径，让用户
 *  明确选择「回退」还是「保留」，避免误操作一次性撤销全部改动。 */
export default function RevertAllConfirmDialog({ filePaths, onRevert, onKeep, onClose }: RevertAllConfirmDialogProps) {
  const t = useI18n()

  // Esc 关闭；确认操作后由父组件卸载，无需重复解绑。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const list = useMemo(() => Array.from(new Set(filePaths.filter(Boolean))), [filePaths])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('chat.filesChangedRevertAll')}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/20 backdrop-blur-[2px] animate-fade-in"
      onMouseDown={(e) => {
        // 点击遮罩空白处 = 保留改动
        if (e.target === e.currentTarget) onKeep()
      }}
    >
      <div className="w-[440px] max-w-[90vw] bg-white dark:bg-nova-surface rounded-[16px] shadow-[0_8px_40px_rgba(15,23,42,0.08)] flex flex-col overflow-hidden">
        {/* 头部 */}
        <div className="px-6 py-4 border-b border-slate-200/60 dark:border-white/10 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-100 to-red-100 border border-red-200/50 dark:from-warning-10 dark:to-error-20 flex items-center justify-center text-red-500 dark:text-red-400 shrink-0">
            <span className="material-symbols-outlined text-[15px] leading-none" aria-hidden>undo</span>
          </div>
          <h2 className="text-[16px] font-semibold text-slate-800 dark:text-nova-text-primary">{t('chat.filesChangedRevertAll')}</h2>
          <button
            onClick={onClose}
            title={t('common.close')}
            className="ml-auto text-slate-400 hover:text-slate-600 dark:text-nova-text-muted dark:hover:text-nova-text-primary transition-colors p-1 rounded hover:bg-slate-100 dark:hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden>close</span>
          </button>
        </div>

        {/* 正文 */}
        <div className="p-6 flex flex-col gap-4">
          <p className="text-[14px] text-slate-600 dark:text-nova-text-secondary leading-relaxed">
            {t('chat.filesChangedRevertAllBodyPre')}
            <span className="font-semibold text-slate-800 dark:text-nova-text-primary">{list.length}</span>
            {t('chat.filesChangedRevertAllBodySuffix')}
          </p>
          {list.length > 0 && (
            <div className="bg-[#f6f7fb] dark:bg-white/5 rounded-lg p-3 flex flex-col gap-2 border border-slate-200/50 dark:border-white/10 max-h-48 overflow-y-auto">
              {list.map((p) => (
                <div key={p} className="flex items-center gap-2 text-slate-700 dark:text-nova-text-secondary min-w-0">
                  <span className="material-symbols-outlined text-[15px] leading-none text-slate-400 dark:text-nova-text-muted shrink-0" aria-hidden>description</span>
                  <span className="font-mono text-[13px] truncate" title={p}>{p}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 操作条 */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-white/5 border-t border-slate-200/60 dark:border-white/10 flex items-center justify-end gap-3">
          <button
            onClick={onKeep}
            className="px-4 py-2 text-[14px] font-medium text-white bg-[#0058bc] hover:bg-[#00418f] dark:bg-nova-accent dark:hover:opacity-90 transition-colors rounded-lg shadow-sm"
          >
            {t('chat.filesChangedRevertAllKeep')}
          </button>
          <button
            onClick={onRevert}
            title={t('chat.filesChangedRevertAll')}
            className="px-4 py-2 text-[14px] font-medium text-white bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-500 transition-colors rounded-lg shadow-sm"
          >
            {t('chat.filesChangedRevertAllConfirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
