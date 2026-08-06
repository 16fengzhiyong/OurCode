import { useState, useMemo } from 'react'
import { useConfigStore } from '@/stores/configStore'
import { lookupModelMetadata } from '@/types'

interface ModelCompareViewProps {
  onClose: () => void
}

/** Provider colors */
const PROVIDER_COLORS: Record<string, string> = {
  openai: '#10a37f', anthropic: '#d47757', google: '#4285f4', deepseek: '#4f46e5', groq: '#f97316', other: '#2563eb',
}

function getProviderFromModelId(modelId: string): string {
  const lower = modelId.toLowerCase()
  if (lower.startsWith('gpt') || lower.startsWith('o1') || lower.startsWith('o3')) return 'openai'
  if (lower.startsWith('claude')) return 'anthropic'
  if (lower.startsWith('gemini')) return 'google'
  if (lower.startsWith('deepseek')) return 'deepseek'
  return 'other'
}

/** Pricing data */
const PRICING: Record<string, { input: string; output: string }> = {
  'gpt-4o': { input: '$5.00', output: '$15.00' },
  'gpt-4o-mini': { input: '$0.15', output: '$0.60' },
  'gpt-4-turbo': { input: '$10.00', output: '$30.00' },
  'gpt-3.5-turbo': { input: '$0.50', output: '$1.50' },
  'claude-3-opus': { input: '$15.00', output: '$75.00' },
  'claude-3-sonnet': { input: '$3.00', output: '$15.00' },
  'claude-3-haiku': { input: '$0.25', output: '$1.25' },
  'deepseek-chat': { input: '$0.27', output: '$1.10' },
  'deepseek-coder': { input: '$0.27', output: '$1.10' },
  'deepseek-reasoner': { input: '$0.55', output: '$2.19' },
  'gemini-1.5-pro': { input: '$3.50', output: '$10.50' },
  'gemini-1.5-flash': { input: '$0.075', output: '$0.30' },
}

export default function ModelCompareView({ onClose }: ModelCompareViewProps) {
  const { models } = useConfigStore()
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

  const getPricing = (id: string) => PRICING[id] || PRICING[id.split('/').pop() || ''] || { input: 'N/A', output: 'N/A' }

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-nova-surface border border-nova-border rounded-xl shadow-2xl w-[800px] max-w-[95vw] max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-nova-border">
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            <h2 className="text-sm font-semibold text-nova-text-primary">模型对比</h2>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 text-[11px] bg-nova-hover text-nova-text-secondary rounded-md hover:text-nova-text-primary transition-colors flex items-center gap-1">
              <span>+ 添加模型</span>
            </button>
            <button onClick={onClose} className="p-1.5 text-nova-text-muted hover:text-nova-text-primary hover:bg-nova-hover rounded transition-colors">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        {/* Model selector */}
        <div className="px-4 py-3 border-b border-nova-border">
          <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索模型..."
            className="w-full px-3 py-2 bg-nova-input-bg border border-nova-border rounded-lg text-sm text-nova-text-primary outline-none focus:border-nova-accent/50 mb-2" />
          <div className="flex flex-wrap gap-1.5">
            {filteredModels.slice(0, 30).map((m) => (
              <button key={m.id} onClick={() => toggleModel(m.id)}
                className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${
                  selectedModels.includes(m.id)
                    ? 'border-nova-accent bg-nova-accent/10 text-nova-accent'
                    : 'border-nova-border text-nova-text-secondary hover:border-nova-accent/50'
                }`}>
                {m.id.split('/').pop() || m.id}
              </button>
            ))}
          </div>
        </div>

        {/* Compare cards */}
        {selectedModels.length > 0 ? (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(selectedModels.length, 3)}, 1fr)` }}>
              {selectedModels.map((id) => {
                const model = models.find((m) => m.id === id)
                const meta = lookupModelMetadata(id)
                const provider = getProviderFromModelId(id)
                const pricing = getPricing(id)
                const displayName = id.split('/').pop() || id

                return (
                  <div key={id} className="bg-nova-card border border-nova-border rounded-xl p-3.5 hover:border-nova-border-strong transition-colors">
                    {/* Card header */}
                    <div className="flex items-center gap-2 mb-2.5">
                      <div className="w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0"
                        style={{ background: `${PROVIDER_COLORS[provider] || '#2563eb'}20`, color: PROVIDER_COLORS[provider] || '#2563eb' }}>
                        {provider.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-[13px] font-semibold text-nova-text-primary truncate">{displayName}</div>
                        <div className="text-[10px] text-nova-text-muted">{provider}</div>
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-nova-text-muted">上下文窗口</span>
                        <span className="text-[11px] font-medium text-nova-text-primary">
                          {meta?.contextWindow
                            ? meta.contextWindow >= 1048576 ? `${Math.round(meta.contextWindow / 1048576)}M tokens`
                            : `${Math.round(meta.contextWindow / 1000)}K tokens`
                            : 'N/A'}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-nova-text-muted">知识截止</span>
                        <span className="text-[11px] font-medium text-nova-text-primary">2024</span>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-nova-text-muted">视觉能力</span>
                        <span className={`text-[11px] font-medium ${meta?.vision ? 'text-green-400' : 'text-red-400'}`}>
                          {meta?.vision ? '✓ 支持' : '✗ 不支持'}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-nova-text-muted">函数调用</span>
                        <span className={`text-[11px] font-medium ${meta?.functionCall ? 'text-green-400' : 'text-red-400'}`}>
                          {meta?.functionCall ? '✓ 支持' : '✗ 不支持'}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-nova-text-muted">输入价格</span>
                        <span className="text-[11px] font-medium text-nova-text-primary">{pricing.input}/1M</span>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-nova-text-muted">输出价格</span>
                        <span className="text-[11px] font-medium text-nova-text-primary">{pricing.output}/1M</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-nova-text-muted text-sm">
            请先选择要对比的模型（最多 4 个）
          </div>
        )}
      </div>
    </div>
  )
}
