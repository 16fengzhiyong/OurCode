import { useEffect } from 'react'
import { useUIStore, AppNotification } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { useI18n } from '@/i18n/useI18n'

/** Default auto-dismiss delay per stack — session events (bottom-right) stay
 *  longer since the user may be on another session when they appear. */
const DEFAULT_DURATION: Record<NonNullable<AppNotification['position']>, number> = {
  'top-right': 5000,
  'bottom-right': 8000,
}

const TYPE_COLORS: Record<AppNotification['type'], string> = {
  info: 'var(--info)',
  warning: 'var(--yellow)',
  error: 'var(--red)',
  success: 'var(--green)',
}

/** One toast: owns its auto-dismiss timer so it is cleared on manual close. */
function NotificationToast({ notification, onDismiss }: { notification: AppNotification; onDismiss: (id: number) => void }) {
  const t = useI18n()
  const duration = notification.duration ?? DEFAULT_DURATION[notification.position || 'top-right']
  const isBottom = notification.position === 'bottom-right'

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(notification.id), duration)
    return () => clearTimeout(timer)
  }, [notification.id, duration, onDismiss])

  const handleClick = () => {
    if (notification.sessionId) {
      // Only jump when the session still exists — a stale notification (e.g.
      // the session was deleted meanwhile) must not leave activeSessionId
      // pointing at a dead id.
      const chat = useChatStore.getState()
      if (chat.sessions.some((s) => s.id === notification.sessionId)) {
        chat.setActiveSession(notification.sessionId)
        if (!useUIStore.getState().isChatVisible) useUIStore.getState().toggleChat()
      }
    }
    onDismiss(notification.id)
  }

  return (
    <div
      role="status"
      onClick={handleClick}
      className={`flex items-start gap-2.5 px-3 py-2.5 bg-nova-surface border border-nova-border border-l-2 rounded-lg shadow-xl animate-slide-in max-w-sm pointer-events-auto ${
        isBottom ? 'cursor-pointer hover:bg-nova-hover transition-colors' : ''
      }`}
      style={{ borderLeftColor: TYPE_COLORS[notification.type] }}
    >
      <span className="flex-1 text-xs text-nova-text-secondary break-words leading-relaxed">
        {notification.message}
      </span>
      {isBottom && (
        <span className="text-[10px] text-nova-accent shrink-0 mt-0.5">{t('chat.toastJumpHint')}</span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDismiss(notification.id)
        }}
        className="text-nova-text-muted hover:text-nova-text-primary shrink-0"
        aria-label="关闭通知"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

/** One stack of toasts (top-right for plugin calls, bottom-right for session
 *  events). pointer-events-none keeps the empty gutter click-through; each
 *  toast opts back in. */
function ToastStack({ position, notifications, onDismiss }: {
  position: 'top-right' | 'bottom-right'
  notifications: AppNotification[]
  onDismiss: (id: number) => void
}) {
  if (notifications.length === 0) return null
  const isBottom = position === 'bottom-right'
  return (
    <div
      className={`fixed z-[200] flex flex-col gap-2 pointer-events-none ${
        isBottom
          ? 'bottom-4 right-4 items-end'
          : 'top-14 right-4 items-end'
      }`}
    >
      {notifications.map((n) => (
        <NotificationToast key={n.id} notification={n} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

/**
 * Global notification toasts — the visible surface for uiStore.notifications
 * (pushed via plugin api.ui.showNotification and session events). Split into
 * two stacks: top-right (plugin/info toasts, auto-dismiss 5s) and bottom-right
 * (session task-done / needs-input events, 8s, click to jump to the session).
 */
export default function NotificationToasts() {
  const notifications = useUIStore((s) => s.notifications)
  const dismissNotification = useUIStore((s) => s.dismissNotification)

  const topRight = notifications.filter((n) => n.position !== 'bottom-right')
  const bottomRight = notifications.filter((n) => n.position === 'bottom-right')

  return (
    <>
      <ToastStack position="top-right" notifications={topRight} onDismiss={dismissNotification} />
      <ToastStack position="bottom-right" notifications={bottomRight} onDismiss={dismissNotification} />
    </>
  )
}
