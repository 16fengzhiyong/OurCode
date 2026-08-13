import { useEffect, useState } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useI18n } from '@/i18n/useI18n'

/**
 * Ask-user-question dialog. The agent calls ask_user_question
 * when it needs clarification; the answer is fed back as the tool result.
 * Single-select options submit immediately on click (backward compatible);
 * multiSelect questions show checkboxes + a submit button and join the picked
 * options with '；'. Optional per-option preview text (e.g. ASCII mockups)
 * renders under each choice for side-by-side comparison.
 */
export default function QuestionDialog() {
  const pendingQuestion = useChatStore((s) => s.pendingQuestion)
  const answerQuestion = useChatStore((s) => s.answerQuestion)
  // Parallel conversations: only the active session's question is shown —
  // switching to the owning session reveals it again.
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  // The confirm gate (questionGate === 'confirm'/'dismissed') keeps the modal
  // hidden until the user arms it via the QuestionConfirmBar — questions that
  // fired while the user was on another session must not pop up unannounced.
  const questionGate = useChatStore((s) => s.questionGate)
  const [customAnswer, setCustomAnswer] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const t = useI18n()

  // Reset per-question state whenever a new question arrives
  useEffect(() => {
    setSelected(new Set())
    setCustomAnswer('')
  }, [pendingQuestion?.id])

  if (!pendingQuestion || pendingQuestion.sessionId !== activeSessionId) return null
  // Only explicit 'confirm'/'dismissed' block the dialog (until the user arms
  // it via the QuestionConfirmBar) — any other value, including undefined from
  // a question set without a gate, must still show or the loop would hang.
  const gate = questionGate[pendingQuestion.sessionId]
  if (gate === 'confirm' || gate === 'dismissed') return null

  const options = pendingQuestion.options || []
  const previews = pendingQuestion.preview || []
  const multiSelect = pendingQuestion.multiSelect === true

  const submit = (answer: string) => {
    setCustomAnswer('')
    answerQuestion(answer)
  }

  const toggleSelected = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const submitSelection = () => {
    const picked = options.filter((_, i) => selected.has(i))
    if (picked.length === 0) return
    submit(picked.join('；'))
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="w-[480px] max-w-[90vw] rounded-2xl p-5 glass-modal" style={{ boxShadow: 'var(--shadow-xl)' }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">❓</span>
          <strong className="text-sm text-nova-text-primary">{t('chat.askUserTitle')}</strong>
          {multiSelect && options.length > 0 && (
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-nova-accent/15 text-nova-accent">
              {t('chat.askMultiSelectHint')}
            </span>
          )}
        </div>
        <p className="text-sm text-nova-text-primary leading-relaxed mb-4 whitespace-pre-wrap">
          {pendingQuestion.question}
        </p>

        {options.length > 0 && (
          <div className="flex flex-col gap-2 mb-4">
            {options.map((opt, i) =>
              multiSelect ? (
                <label
                  key={i}
                  className={`block rounded-lg border border-nova-border transition-colors cursor-pointer ${
                    selected.has(i) ? 'bg-nova-accent/10 border-nova-accent/60' : 'bg-nova-hover'
                  }`}
                >
                  <div className="flex items-center gap-2 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(i)}
                      onChange={() => toggleSelected(i)}
                      className="accent-nova-accent w-4 h-4 shrink-0"
                    />
                    <span className="text-sm text-nova-text-secondary">{opt}</span>
                  </div>
                  {previews[i] && (
                    <pre className="mx-3 mb-2 px-2 py-1.5 text-[11px] leading-relaxed text-nova-text-muted bg-nova-bg/60 rounded max-h-32 overflow-auto whitespace-pre">
                      {previews[i]}
                    </pre>
                  )}
                </label>
              ) : (
                <div key={i} className="rounded-lg bg-nova-hover border border-nova-border overflow-hidden">
                  <button
                    onClick={() => submit(opt)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-nova-accent/20 hover:text-nova-accent transition-colors text-nova-text-secondary"
                  >
                    {opt}
                  </button>
                  {previews[i] && (
                    <pre className="mx-3 mb-2 px-2 py-1.5 text-[11px] leading-relaxed text-nova-text-muted bg-nova-bg/60 rounded max-h-32 overflow-auto whitespace-pre">
                      {previews[i]}
                    </pre>
                  )}
                </div>
              )
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          {multiSelect ? (
            <button
              onClick={submitSelection}
              disabled={selected.size === 0}
              className="px-4 py-2 text-sm text-white rounded-lg disabled:opacity-40 hover:opacity-90 transition-opacity"
              style={{ background: 'var(--grad-brand)' }}
            >
              {t('chat.askSubmitSelection')}
            </button>
          ) : (
            <>
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
                style={{ background: 'var(--grad-brand)' }}
              >
                {t('chat.send')}
              </button>
            </>
          )}
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
