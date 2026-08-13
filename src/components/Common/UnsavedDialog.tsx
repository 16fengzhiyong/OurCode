import { useEffect, useRef } from 'react'
import { useUnsavedStore, UnsavedChoice } from '@/stores/unsavedStore'
import { useI18n } from '@/i18n/useI18n'

/**
 * Save / Don't Save / Cancel prompt for closing a dirty file. Rendered once in
 * the layout; the request/response flow lives in useUnsavedStore (components
 * await `ask()` and the dialog resolves it via `settle()`).
 */
export default function UnsavedDialog() {
  const isOpen = useUnsavedStore((s) => s.isOpen)
  const fileName = useUnsavedStore((s) => s.fileName)
  const settle = useUnsavedStore((s) => s.settle)
  const t = useI18n()
  const saveRef = useRef<HTMLButtonElement>(null)

  const choose = (choice: UnsavedChoice) => settle(choice)

  useEffect(() => {
    if (isOpen) saveRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle('cancel')
      if (e.key === 'Enter') settle('save')
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, settle])

  if (!isOpen) return null

  return (
    <div role="dialog" aria-modal="true" aria-label={t('editor.unsavedTitle')} className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="glass-modal rounded-xl shadow-2xl w-full max-w-md mx-4 animate-fade-in">
        <div className="p-5">
          <h3 className="text-lg font-semibold text-nova-text-primary mb-2">{t('editor.unsavedTitle')}</h3>
          <p className="text-nova-text-secondary text-sm">{t('editor.unsavedMessage', { name: fileName })}</p>
        </div>
        <div className="flex justify-end gap-3 px-5 pb-5">
          <button
            onClick={() => choose('cancel')}
            className="px-4 py-2 text-sm rounded-lg bg-nova-hover text-nova-text-secondary hover:text-nova-text-primary transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={() => choose('discard')}
            className="px-4 py-2 text-sm rounded-lg bg-nova-hover text-nova-text-secondary hover:text-red-400 transition-colors"
          >
            {t('editor.discardAndClose')}
          </button>
          <button
            ref={saveRef}
            onClick={() => choose('save')}
            className="px-4 py-2 text-sm rounded-lg bg-nova-accent hover:opacity-90 text-white transition-colors"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
