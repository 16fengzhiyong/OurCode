import { useChatStore } from '@/stores/chatStore'
import { useI18n } from '@/i18n/useI18n'

/**
 * Confirm bar for off-session ask_user_question (the "先确认再弹窗" gate).
 *
 * When the agent asks a question while the user is viewing a different
 * session, the question dialog stays hidden until the user switches back and
 * confirms here — then (and only then) the real QuestionDialog pops up.
 * "稍后" defers: the bar hides, but the question stays pending (bubble icon
 * remains in the session lists) and reappears when the user leaves & re-enters
 * the session.
 */
export default function QuestionConfirmBar() {
  const pendingQuestion = useChatStore((s) => s.pendingQuestion)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const questionGate = useChatStore((s) => s.questionGate)
  const setQuestionGate = useChatStore((s) => s.setQuestionGate)
  const t = useI18n()

  const isForActiveSession = pendingQuestion?.sessionId === activeSessionId
  if (!isForActiveSession || !activeSessionId) return null
  if (questionGate[activeSessionId] !== 'confirm') return null

  return (
    <div className="shrink-0 px-3 py-2 border-t border-nova-border bg-nova-surface flex items-center gap-2.5">
      <span className="text-sm shrink-0">💬</span>
      <span className="flex-1 text-xs text-nova-text-primary leading-relaxed min-w-0">
        {t('chat.questionConfirmTitle')}
      </span>
      <button
        onClick={() => setQuestionGate(activeSessionId, 'auto')}
        className="px-3 py-1 text-xs text-white rounded-lg hover:opacity-90 transition-opacity shrink-0"
        style={{ background: 'var(--accent)' }}
      >
        {t('chat.questionConfirmAction')}
      </button>
      <button
        onClick={() => setQuestionGate(activeSessionId, 'dismissed')}
        className="px-2.5 py-1 text-xs text-nova-text-muted hover:text-nova-text-primary rounded-lg transition-colors shrink-0"
      >
        {t('chat.questionConfirmLater')}
      </button>
    </div>
  )
}
