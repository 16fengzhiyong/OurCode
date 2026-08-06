import { useState, useCallback } from 'react'
import { useConfigStore } from '@/stores/configStore'
import { useChatStore } from '@/stores/chatStore'
import { runArenaPrompt, ArenaResult } from '@/services/arena'
import MarkdownRenderer from '../Common/MarkdownRenderer'
import { useI18n } from '@/i18n/useI18n'

/**
 * Arena — parallel model comparison. Run the same prompt on
 * several models and adopt the best answer into the conversation.
 */
export default function ArenaModal({ onClose }: { onClose: () => void }) {
  const models = useConfigStore((s) => s.models)
  const getActiveConfigGroup = useConfigStore((s) => s.getActiveConfigGroup)

  const activeSession = useChatStore((s) => s.getActiveSession())
  const addMessage = useChatStore((s) => s.addMessage)
  const saveSession = useChatStore((s) => s.saveSession)
  const t = useI18n()

  // Default prompt = last user message
  const lastUserMessage = [...(activeSession?.messages || [])].reverse().find((m) => m.role === 'user')
  const [prompt, setPrompt] = useState(lastUserMessage?.content || '')
  const [selected, setSelected] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<ArenaResult[]>([])
  const [error, setError] = useState<string | null>(null)

  const toggleModel = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]))
  }

  const handleRun = useCallback(async () => {
    if (!prompt.trim() || selected.length < 2) return
    const configGroup = getActiveConfigGroup()
    if (!configGroup) return
    setRunning(true)
    setError(null)
    setResults([])
    try {
      const res = await runArenaPrompt(prompt.trim(), selected, configGroup)
      setResults(res)
    } catch (e: any) {
      setError(e.message || t('chat.arenaRunFailed'))
    } finally {
      setRunning(false)
    }
  }, [prompt, selected, getActiveConfigGroup, t])

  const adopt = (result: ArenaResult) => {
    if (!activeSession || !result.content) return
    addMessage(activeSession.id, {
      role: 'assistant',
      content: result.content,
      contextFiles: [],
    })
    saveSession(activeSession.id)
    onClose()
  }

  const copy = (result: ArenaResult) => {
    navigator.clipboard.writeText(result.content)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="w-[860px] max-w-[94vw] max-h-[88vh] flex flex-col rounded-2xl bg-nova-surface border border-nova-border shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-nova-border">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚖️</span>
            <strong className="text-sm text-nova-text-primary">{t('chat.arenaCompare')}</strong>
            <span className="text-[10px] text-nova-text-muted">{t('chat.arenaSubtitle')}</span>
          </div>
          <button onClick={onClose} className="text-nova-text-muted hover:text-nova-text-primary transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 border-b border-nova-border space-y-3">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t('chat.arenaPlaceholder')}
            rows={2}
            className="w-full px-3 py-2 text-sm bg-nova-bg border border-nova-border rounded-lg outline-none focus:border-nova-accent/60 text-nova-text-primary placeholder:text-nova-text-muted resize-none"
          />
          <div>
            <div className="text-xs text-nova-text-muted mb-1.5">{t('chat.arenaSelectModels')}</div>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {models.length === 0 && (
                <span className="text-xs text-nova-text-muted">{t('chat.arenaNoModels')}</span>
              )}
              {models.map((m) => (
                <label
                  key={m.id}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs cursor-pointer transition-colors ${
                    selected.includes(m.id)
                      ? 'border-nova-accent/60 bg-nova-accent/15 text-nova-accent'
                      : 'border-nova-border text-nova-text-secondary hover:bg-nova-hover'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(m.id)}
                    onChange={() => toggleModel(m.id)}
                    className="accent-nova-accent w-3 h-3"
                  />
                  <span>{m.name || m.id}</span>
                  {m.contextWindow ? <span className="text-[9px] text-nova-text-muted">{Math.round(m.contextWindow / 1000)}K</span> : null}
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            {error && <span className="text-xs text-red-400">{error}</span>}
            <button
              onClick={handleRun}
              disabled={running || !prompt.trim() || selected.length < 2}
              className="px-4 py-1.5 text-xs text-white rounded-lg disabled:opacity-30 hover:opacity-90 transition-opacity"
              style={{ background: 'var(--grad-brand)' }}
            >
              {running ? t('chat.arenaRunning') : t('chat.arenaStart', { count: selected.length })}
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {results.length === 0 && !running && (
            <div className="text-center text-nova-text-muted text-sm py-8">
              {t('chat.arenaEmpty')}
            </div>
          )}
          <div className="grid gap-3" style={{ gridTemplateColumns: results.length > 1 ? 'repeat(auto-fit, minmax(280px, 1fr))' : '1fr' }}>
            {results.map((r) => (
              <div key={r.model} className="rounded-xl border border-nova-border bg-nova-hover/30 overflow-hidden flex flex-col">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-nova-border/60 bg-nova-hover/40">
                  <span className="text-xs font-medium text-nova-text-primary truncate">{r.model}</span>
                  <span className="ml-auto text-[10px] text-nova-text-muted shrink-0">{(r.durationMs / 1000).toFixed(1)}s</span>
                </div>
                <div className="flex-1 px-3 py-2 text-sm text-nova-text-secondary max-h-64 overflow-y-auto">
                  {r.error ? (
                    <span className="text-red-400">❌ {r.error}</span>
                  ) : (
                    <MarkdownRenderer content={r.content} />
                  )}
                </div>
                {!r.error && r.content && (
                  <div className="flex items-center gap-2 px-3 py-2 border-t border-nova-border/50">
                    <button
                      onClick={() => adopt(r)}
                      className="px-3 py-1 text-xs text-white rounded hover:opacity-90 transition-opacity"
                      style={{ background: 'var(--grad-brand)' }}
                    >
                      {t('chat.arenaAdopt')}
                    </button>
                    <button
                      onClick={() => copy(r)}
                      className="px-3 py-1 text-xs text-nova-text-muted hover:text-nova-text-primary rounded transition-colors"
                    >
                      {t('common.copy')}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {running && results.length === 0 && (
            <div className="flex items-center justify-center gap-3 text-nova-text-muted text-sm py-8">
              <span className="w-1.5 h-1.5 rounded-full animate-think-bounce" style={{ background: '#838485' }} />
              <span className="w-1.5 h-1.5 rounded-full animate-think-bounce" style={{ background: '#838485', animationDelay: '0.2s' }} />
              <span className="w-1.5 h-1.5 rounded-full animate-think-bounce" style={{ background: '#838485', animationDelay: '0.4s' }} />
              <span>{t('chat.arenaInferring')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
