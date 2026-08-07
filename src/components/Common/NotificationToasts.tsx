import { useEffect } from 'react'
import { useUIStore, AppNotification } from '@/stores/uiStore'

/** How long a toast stays on screen before auto-dismissing (matches the undo toast). */
const NOTIFICATION_DURATION = 5000

const TYPE_COLORS: Record<AppNotification['type'], string> = {
  info: 'var(--info)',
  warning: 'var(--yellow)',
  error: 'var(--red)',
}

/** One toast: owns its auto-dismiss timer so it is cleared on manual close. */
function NotificationToast({ notification, onDismiss }: { notification: AppNotification; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(notification.id), NOTIFICATION_DURATION)
    return () => clearTimeout(timer)
  }, [notification.id, onDismiss])

  return (
    <div
      className="flex items-start gap-2.5 px-3 py-2.5 bg-nova-surface border border-nova-border border-l-2 rounded-lg shadow-xl animate-slide-in max-w-sm pointer-events-auto"
      style={{ borderLeftColor: TYPE_COLORS[notification.type] }}
      role="status"
    >
      <span className="flex-1 text-xs text-nova-text-secondary break-words leading-relaxed">
        {notification.message}
      </span>
      <button
        onClick={() => onDismiss(notification.id)}
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

/**
 * Global notification toasts — the visible surface for uiStore.notifications
 * (pushed via plugin api.ui.showNotification). Stacked top-right below the
 * title bar, auto-dismissed after 5s.
 */
export default function NotificationToasts() {
  const notifications = useUIStore((s) => s.notifications)
  const dismissNotification = useUIStore((s) => s.dismissNotification)

  if (notifications.length === 0) return null

  return (
    // pointer-events-none keeps the empty gutter click-through; each toast opts back in.
    <div className="fixed top-14 right-4 z-[200] flex flex-col gap-2 items-end pointer-events-none">
      {notifications.map((n) => (
        <NotificationToast key={n.id} notification={n} onDismiss={dismissNotification} />
      ))}
    </div>
  )
}
