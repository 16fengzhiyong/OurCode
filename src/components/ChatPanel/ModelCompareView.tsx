import { useState, useMemo } from 'react'
import { useConfigStore } from '@/stores/configStore'
import { useI18n } from '@/i18n/useI18n'

interface ModelCompareViewProps {
  onClose: () => void
}

/** Model metadata for comparison (known models) */
const MODEL_METADATA: Record<string, { contextWindow: number; pricing: string; vision: boolean; functionCall: boolean }> = {
  'gpt-4o': { contextWindow: 128000, pricing: '$2.50/$10 per 1M tokens', vision: true, functionCall: true },
  'gpt-4o-mini': { contextWindow: 128000, pricing: '$0.15/$0.60 per 1M tokens', vision: true, functionCall: true },
  'gpt-4-turbo': { contextWindow: 128000, pricing: '$10/$30 per 1M tokens', vision: true, functionCall: true },
  'gpt-3.5-turbo': { contextWindow: 16385, pricing: '$0.50/$1.50 per 1M tokens', vision: false, functionCall: true },
  'claude-3-opus': { contextWindow: 200000, pricing: '$15/$75 per 1M tokens', vision: true, functionCall: true },
  'claude-3-sonnet': { contextWindow: 200000, pricing: '$3/$15 per 1M tokens', vision: true, functionCall: true },
  'claude-3-haiku': { contextWindow: 200000, pricing: '$0.25/$1.25 per 1M tokens', vision: true, functionCall: true },
  'deepseek-chat': { contextWindow: 64000, pricing: '$0.14/$0.28 per 1M tokens', vision: false, functionCall: false },
  'deepseek-coder': { contextWindow: 64000, pricing: '$0.14/$0.28 per 1M tokens', vision: false, functionCall: false },
  'deepseek-reasoner': { contextWindow: 64000, pricing: '$0.55/$2.19 per 1M tokens', vision: false, functionCall: false },
  'gemini-1.5-pro': { contextWindow: 2000000, pricing: '$3.50/$10.50 per 1M tokens', vision: true, functionCall: true },
  'gemini-1.5-flash': { contextWindow: 1000000, pricing: '$0.075/$0.30 per 1M tokens', vision: true, functionCall: true },
  'llama3-70b-8192': { contextWindow: 8192, pricing: 'Free on Groq', vision: false, functionCall: false },
  'mixtral-8x7b-32768': { contextWindow: 32768, pricing: 'Free on Groq', vision: false, functionCall: false },
}

export default function ModelCompareView({ onClose }: ModelCompareViewProps) {
  const { models } = useConfigStore()
  const t = useI18n()
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return models
    const q = searchQuery.toLowerCase()
    return models.filter((m) => m.id.toLowerCase().includes(q))
  }, [models, searchQuery])

  const toggleModel = (id: string) => {
    setSelectedModels((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id].slice(0, 4)
    )
  }

  const getMetadata = (id: string) => MODEL_METADATA[id] || MODEL_METADATA[id.split('/').pop() || '']

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-nova-surface border border-nova-border rounded-xl shadow-2xl w-[800px] max-h-[80vh] flex flex-col animate-fade-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-nova-border">
          <h2 className="text-lg font-semibold text-nova-text-primary">{t('models.compare')}</h2>
          <button onClick={onClose} className="p-1 text-nova-text-muted hover:text-nova-text-primary rounded">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-4 border-b border-nova-border">
          <div className="flex items-center gap-3">
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t('models.searchPlaceholder')} className="flex-1 px-3 py-2 bg-nova-input-bg border border-nova-border rounded-lg text-sm text-nova-text-primary outline-none focus:border-nova-accent/50" />
            <span className="text-xs text-nova-text-muted">{t('models.compareHint')}</span>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {filteredModels.slice(0, 30).map((m) => (
              <button key={m.id} onClick={() => toggleModel(m.id)} className={`px-2 py-1 text-xs rounded-lg border transition-colors ${selectedModels.includes(m.id) ? 'border-nova-accent bg-nova-accent/10 text-nova-accent' : 'border-nova-border text-nova-text-secondary hover:border-nova-accent/50'}`}>
                {m.id.split('/').pop() || m.id}
                {m.isFree && <span className="ml-1 text-green-400">{t('models.free')}</span>}
              </button>
            ))}
          </div>
        </div>

        {selectedModels.length > 0 && (
          <div className="flex-1 overflow-y-auto p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-nova-border">
                  <th className="text-left py-2 text-xs text-nova-text-muted font-medium">{t('models.feature')}</th>
                  {selectedModels.map((id) => (
                    <th key={id} className="text-center py-2 text-xs text-nova-accent font-medium">{id.split('/').pop()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-nova-border/50">
                  <td className="py-2 text-xs text-nova-text-secondary">{t('models.contextWindow')}</td>
                  {selectedModels.map((id) => {
                    const meta = getMetadata(id)
                    return <td key={id} className="text-center py-2 text-xs text-nova-text-primary">{meta ? `${(meta.contextWindow / 1000).toFixed(0)}K` : t('models.na')}</td>
                  })}
                </tr>
                <tr className="border-b border-nova-border/50">
                  <td className="py-2 text-xs text-nova-text-secondary">{t('models.pricing')}</td>
                  {selectedModels.map((id) => {
                    const meta = getMetadata(id)
                    return <td key={id} className="text-center py-2 text-xs text-nova-text-primary">{meta?.pricing || t('models.na')}</td>
                  })}
                </tr>
                <tr className="border-b border-nova-border/50">
                  <td className="py-2 text-xs text-nova-text-secondary">{t('models.visionSupport')}</td>
                  {selectedModels.map((id) => {
                    const meta = getMetadata(id)
                    return <td key={id} className="text-center py-2">{meta?.vision ? <span className="text-green-400">{t('models.yes')}</span> : <span className="text-nova-text-muted">{t('models.no')}</span>}</td>
                  })}
                </tr>
                <tr className="border-b border-nova-border/50">
                  <td className="py-2 text-xs text-nova-text-secondary">{t('models.functionCalling')}</td>
                  {selectedModels.map((id) => {
                    const meta = getMetadata(id)
                    return <td key={id} className="text-center py-2">{meta?.functionCall ? <span className="text-green-400">{t('models.yes')}</span> : <span className="text-nova-text-muted">{t('models.no')}</span>}</td>
                  })}
                </tr>
                <tr>
                  <td className="py-2 text-xs text-nova-text-secondary">{t('models.free')}</td>
                  {selectedModels.map((id) => {
                    const m = models.find((m) => m.id === id)
                    return <td key={id} className="text-center py-2">{m?.isFree ? <span className="text-green-400">{t('models.yes')}</span> : <span className="text-nova-text-muted">{t('models.no')}</span>}</td>
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {selectedModels.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-nova-text-muted text-sm">
            {t('models.selectFirst')}
          </div>
        )}
      </div>
    </div>
  )
}
