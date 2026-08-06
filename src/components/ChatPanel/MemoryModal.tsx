import { useState } from 'react'
import { useMemoryStore } from '@/stores/memoryStore'
import { useI18n } from '@/i18n/useI18n'

/**
 * Memory manager. Memories are injected into the
 * agent's system prompt when they match the current message, so the assistant
 * remembers the user's preferences across sessions.
 */
export default function MemoryModal({ onClose }: { onClose: () => void }) {
  const { memories, addMemory, deleteMemory } = useMemoryStore()
  const [content, setContent] = useState('')
  const [scope, setScope] = useState<'global' | 'project'>('global')
  const [justAdded, setJustAdded] = useState<string | null>(null)
  const t = useI18n()

  const handleAdd = async () => {
    if (!content.trim()) return
    await addMemory(content.trim(), scope)
    setContent('')
    setJustAdded(t('chat.memorySaved'))
    setTimeout(() => setJustAdded(null), 2000)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="w-[560px] max-w-[92vw] max-h-[80vh] flex flex-col rounded-2xl bg-nova-surface border border-nova-border shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-nova-border">
          <div className="flex items-center gap-2">
            <span className="text-lg">🧠</span>
            <strong className="text-sm text-nova-text-primary">{t('chat.memory')}</strong>
          </div>
          <button onClick={onClose} className="text-nova-text-muted hover:text-nova-text-primary transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {memories.length === 0 ? (
            <div className="text-center text-nova-text-muted text-sm py-8">
              {t('chat.memoryEmpty')}
            </div>
          ) : (
            memories.map((m) => (
              <div
                key={m.id}
                className="flex items-start gap-2 rounded-lg border border-nova-border bg-nova-hover/40 px-3 py-2 group"
              >
                <span
                  className={`mt-1 text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                    m.scope === 'project' ? 'bg-nova-accent/20 text-nova-accent' : 'bg-nova-accent/20 text-nova-accent'
                  }`}
                >
                  {m.scope === 'project' ? t('chat.scopeProject') : t('chat.scopeGlobal')}
                </span>
                <p className="flex-1 text-xs text-nova-text-primary whitespace-pre-wrap break-all">{m.content}</p>
                <button
                  onClick={() => deleteMemory(m.id)}
                  className="opacity-0 group-hover:opacity-100 text-nova-text-muted hover:text-red-400 transition-all shrink-0"
                  title={t('chat.deleteMemory')}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>

        <div className="px-5 py-4 border-t border-nova-border space-y-2">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleAdd() }}
            placeholder={t('chat.memoryPlaceholder')}
            rows={2}
            className="w-full px-3 py-2 text-sm bg-nova-bg border border-nova-border rounded-lg outline-none focus:border-nova-accent/60 text-nova-text-primary placeholder:text-nova-text-muted resize-none"
          />
          <div className="flex items-center justify-between gap-2">
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as 'global' | 'project')}
              className="text-xs bg-nova-input-bg text-nova-text-primary border border-nova-border rounded px-2 py-1.5 outline-none"
            >
              <option value="global">{t('chat.scopeGlobalAll')}</option>
              <option value="project">{t('chat.scopeProjectOnly')}</option>
            </select>
            <div className="flex items-center gap-2">
              {justAdded && <span className="text-xs text-green-400">{justAdded}</span>}
              <button
                onClick={handleAdd}
                disabled={!content.trim()}
                className="px-4 py-1.5 text-xs text-white rounded-lg disabled:opacity-30 hover:opacity-90 transition-opacity"
                style={{ background: 'var(--grad-brand)' }}
              >
                {t('chat.saveMemory')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
