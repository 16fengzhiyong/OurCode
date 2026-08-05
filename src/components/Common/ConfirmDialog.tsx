import { useEffect, useRef } from 'react'
import { useI18n } from '@/i18n/useI18n'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'info'
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const t = useI18n()
  const resolvedConfirm = confirmText ?? t('common.confirm')
  const resolvedCancel = cancelText ?? t('common.cancel')

  useEffect(() => {
    if (isOpen) {
      confirmRef.current?.focus()
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onConfirm, onCancel])

  if (!isOpen) return null

  const variantStyles = {
    danger: 'bg-[#F48771] hover:bg-[#f48771]/90',
    warning: 'bg-[#CCA700] hover:bg-[#cca700]/90',
    info: 'bg-nova-accent hover:opacity-90',
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={resolvedConfirm} className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="glass-panel rounded-xl shadow-2xl w-full max-w-md mx-4 animate-fade-in">
        <div className="p-5">
          <h3 className="text-lg font-semibold text-nova-text-primary mb-2">{title}</h3>
          <p className="text-nova-text-secondary text-sm">{message}</p>
        </div>
        <div className="flex justify-end gap-3 px-5 pb-5">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg bg-nova-hover text-nova-text-secondary hover:text-nova-text-primary transition-colors"
          >
            {resolvedCancel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`px-4 py-2 text-sm rounded-lg text-white transition-colors ${variantStyles[variant]}`}
          >
            {resolvedConfirm}
          </button>
        </div>
      </div>
    </div>
  )
}
