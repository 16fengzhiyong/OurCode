import { useState } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useI18n } from '@/i18n/useI18n'

/**
 * Ask-user-question dialog (Windsurf-style). The agent calls ask_user_question
 * when it needs clarification; the answer is fed back as the tool result.
 */
export default function QuestionDialog() {
  const pendingQuestion = useChatStore((s) => s.pendingQuestion)
  const answerQuestion = useChatStore((s) => s.answerQuestion)
  const [customAnswer, setCustomAnswer] = useState('')
  const t = useI18n()

  if (!pendingQuestion) return null

  const options = pendingQuestion.options || []

  const submit = (answer: string) => {
    setCustomAnswer('')
    answerQuestion(answer)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="w-[480px] max-w-[90vw] rounded-2xl p-5 bg-nova-surface border border-nova-border shadow-2xl">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">❓</span>
          <strong className="text-sm text-nova-text-primary">{t('chat.askUserTitle')}</strong>
        </div>
        <p className="text-sm text-nova-text-primary leading-relaxed mb-4 whitespace-pre-wrap">
          {pendingQuestion.question}
        </p>

        {options.length > 0 && (
          <div className="flex flex-col gap-2 mb-4">
            {options.map((opt, i) => (
              <button
                key={i}
                onClick={() => submit(opt)}
                className="px-3 py-2 text-left text-sm rounded-lg bg-nova-hover hover:bg-nova-accent/20 hover:text-nova-accent border border-nova-border transition-colors text-nova-text-secondary"
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={customAnswer}
            onChange={(e) => setCustomAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customAnswer.trim()) submit(customAnswer.trim())
            }}
            placeholder={options.length > 0 ? t('chat.askCustomAnswerPlaceholder') : t('chat.askAnswerPlaceholder')}
            className="flex-1 px-3 py-2 text-sm bg-nova-bg border border-nova-border rounded-lg outline-none focus:border-nova-accent/60 text-nova-text-primary placeholder:text-nova-text-muted"
          />
          <button
            onClick={() => customAnswer.trim() ? submit(customAnswer.trim()) : submit(t('chat.askNoInput'))}
            className="px-4 py-2 text-sm text-white rounded-lg hover:opacity-90 transition-opacity"
            style={{ background: 'linear-gradient(135deg, #57A3F8, #3994BC)' }}
          >
            {t('chat.send')}
          </button>
          <button
            onClick={() => submit(t('chat.askSkipped'))}
            className="px-3 py-2 text-sm text-nova-text-muted hover:text-nova-text-primary rounded-lg transition-colors"
          >
            {t('chat.skip')}
          </button>
        </div>
      </div>
    </div>
  )
}
