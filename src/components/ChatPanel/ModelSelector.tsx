import { useState, useMemo, lazy, Suspense } from 'react'
import { useConfigStore } from '@/stores/configStore'
import { useChatStore } from '@/stores/chatStore'
import { lookupModelMetadata } from '@/types'
import { useI18n } from '@/i18n/useI18n'

const ModelCompareView = lazy(() => import('./ModelCompareView'))

/** Extract provider hint from model ID */
function getProviderFromModelId(modelId: string): string {
  const lower = modelId.toLowerCase()
  if (lower.startsWith('gpt') || lower.startsWith('o1') || lower.startsWith('o3') || lower.startsWith('chatgpt')) return 'openai'
  if (lower.startsWith('claude')) return 'anthropic'
  if (lower.startsWith('gemini') || lower.startsWith('palm')) return 'google'
  if (lower.startsWith('deepseek')) return 'deepseek'
  if (lower.startsWith('llama') || lower.startsWith('mixtral') || lower.startsWith('gemma')) return 'groq'
  if (lower.includes('qwen')) return 'alibaba'
  if (lower.includes('mistral')) return 'mistral'
  return 'other'
}

const PROVIDER_COLORS: Record<string, string> = {
  openai: '#10a37f', anthropic: '#d47757', google: '#4285f4', deepseek: '#4f46e5', groq: '#f97316', other: '#2563eb',
}

export default function ModelSelector() {
  const [showParams, setShowParams] = useState(false)
  const [freeOnly, setFreeOnly] = useState(false)
  const [showFavorites, setShowFavorites] = useState(false)
  const [showCompare, setShowCompare] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [providerFilter, setProviderFilter] = useState<string>('')
  const [contextFilter, setContextFilter] = useState<string>('')
  const [showModelList, setShowModelList] = useState(false)
  const t = useI18n()
  const {
    models, isLoadingModels, modelsError, modelParams,
    fetchModels, setModelParams, getActiveConfigGroup, toggleFavorite,
  } = useConfigStore()
  const { activeSessionId, getActiveSession, updateSessionModel, updateSessionParams } = useChatStore()

  const activeSession = getActiveSession()
  const currentModel = activeSession?.model || getActiveConfigGroup()?.defaultModel || ''

  // Unique providers
  const providers = useMemo(() => {
    const set = new Set(models.map((m) => getProviderFromModelId(m.id)))
    return Array.from(set).sort()
  }, [models])

  // Filter models
  const filteredModels = useMemo(() => {
    let result = [...models]
    if (freeOnly) result = result.filter((m) => m.isFree)
    if (showFavorites) result = result.filter((m) => m.isFavorite)
    if (providerFilter) result = result.filter((m) => getProviderFromModelId(m.id) === providerFilter)
    if (contextFilter) {
      const minTokens = parseInt(contextFilter)
      result = result.filter((m) => { const meta = lookupModelMetadata(m.id); return meta?.contextWindow && meta.contextWindow >= minTokens })
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((m) => m.id.toLowerCase().includes(q) || (m.alias && m.alias.toLowerCase().includes(q)))
    }
    result.sort((a, b) => { if (a.isFavorite && !b.isFavorite) return -1; if (!a.isFavorite && b.isFavorite) return 1; return a.id.localeCompare(b.id) })
    return result
  }, [models, freeOnly, showFavorites, searchQuery, providerFilter, contextFilter])

  // Favorite models (for horizontal quick-access strip)
  const favoriteModels = useMemo(() => models.filter((m) => m.isFavorite), [models])

  const handleModelChange = (modelId: string) => {
    if (activeSessionId) updateSessionModel(activeSessionId, modelId)
    setShowModelList(false)
  }

  const handleParamChange = (key: string, value: number) => {
    setModelParams({ [key]: value })
    if (activeSessionId) updateSessionParams(activeSessionId, { [key]: value })
  }

  const freeCount = models.filter((m) => m.isFree).length
  const favoriteCount = models.filter((m) => m.isFavorite).length

  return (
    <div className="space-y-2.5">
      {/* Model selector row */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowModelList(!showModelList)}
          className="flex-1 py-1.5 px-3 bg-nova-input-bg text-nova-text-secondary rounded-lg border border-nova-border text-xs text-left flex items-center gap-2 hover:border-nova-accent/40 transition-colors"
        >
          {currentModel ? (
            <>
              <span className="truncate">{currentModel}</span>
              {lookupModelMetadata(currentModel)?.contextWindow && (
                <span className="text-[10px] text-nova-text-muted shrink-0">
                  {Math.round((lookupModelMetadata(currentModel)?.contextWindow || 0) / 1000)}K
                </span>
              )}
            </>
          ) : (
            <span className="text-nova-text-muted">
              {isLoadingModels ? '加载中...' : '选择模型'}
            </span>
          )}
        </button>

        <button onClick={() => fetchModels()} disabled={isLoadingModels}
          className="p-1.5 rounded-lg text-nova-text-muted hover:text-nova-text-primary hover:bg-nova-hover disabled:opacity-50 transition-colors" title="刷新">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>

        {models.length > 0 && (
          <button onClick={() => setShowCompare(true)}
            className="p-1.5 rounded-lg text-nova-text-muted hover:text-nova-text-primary hover:bg-nova-hover transition-colors" title="模型对比">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
            </svg>
          </button>
        )}

        <button onClick={() => setShowParams(!showParams)}
          className={`p-1.5 rounded-lg transition-colors ${showParams ? 'bg-nova-accent/15 text-nova-accent' : 'text-nova-text-muted hover:text-nova-text-primary hover:bg-nova-hover'}`} title="参数设置">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {/* Error */}
      {modelsError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] bg-red-500/10 border border-red-500/30 text-red-400">
          <span className="flex-1 truncate">获取模型失败: {modelsError}</span>
          <button onClick={() => fetchModels()} disabled={isLoadingModels}
            className="shrink-0 px-2 py-0.5 bg-red-500/20 text-red-300 rounded hover:bg-red-500/30 disabled:opacity-50 transition-colors">重试</button>
        </div>
      )}

      {/* Favorites quick-access strip */}
      {favoriteModels.length > 0 && (
        <div className="flex gap-2 overflow-x-auto py-1">
          {favoriteModels.map((m) => {
            const meta = lookupModelMetadata(m.id)
            const provider = getProviderFromModelId(m.id)
            return (
              <button
                key={m.id}
                onClick={() => handleModelChange(m.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full shrink-0 border transition-all ${
                  currentModel === m.id
                    ? 'border-nova-accent bg-nova-accent/10'
                    : 'border-nova-border bg-nova-card hover:border-nova-accent/50'
                }`}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PROVIDER_COLORS[provider] || '#2563eb' }} />
                <span className="text-[11px] font-medium text-nova-text-primary">{m.alias || m.id}</span>
                {meta?.contextWindow && (
                  <span className="text-[9px] text-nova-text-muted">{Math.round(meta.contextWindow / 1000)}K</span>
                )}
                <span className="text-[10px] text-yellow-400">★</span>
              </button>
            )
          })}
          <button
            onClick={() => setShowModelList(true)}
            className="flex items-center justify-center w-9 h-9 rounded-full border border-dashed border-nova-border text-nova-text-muted hover:text-nova-text-primary hover:border-nova-accent/50 transition-colors shrink-0"
            style={{ minWidth: 36 }}
          >
            <span className="text-sm">+</span>
          </button>
        </div>
      )}

      {/* Filter chips */}
      {models.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[100px]">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-nova-text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" strokeWidth="2" /><line x1="21" y1="21" x2="16.65" y2="16.65" strokeWidth="2" />
            </svg>
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索模型..."
              className="w-full pl-7 pr-2 py-1.5 bg-nova-input-bg border border-nova-border rounded text-[11px] text-nova-text-primary outline-none focus:border-nova-accent/50 placeholder-nova-text-muted" />
          </div>

          {/* Provider filter - pill */}
          <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)}
            className="px-2.5 py-1.5 text-[11px] rounded-full border cursor-pointer transition-colors bg-nova-hover text-nova-text-muted border-transparent hover:text-nova-text-secondary hover:border-nova-border-strong outline-none"
            style={{ fontFamily: 'inherit' }}>
            <option value="">全部提供商</option>
            {providers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>

          {/* Context filter - pill */}
          <select value={contextFilter} onChange={(e) => setContextFilter(e.target.value)}
            className="px-2.5 py-1.5 text-[11px] rounded-full border cursor-pointer transition-colors bg-nova-hover text-nova-text-muted border-transparent hover:text-nova-text-secondary hover:border-nova-border-strong outline-none"
            style={{ fontFamily: 'inherit' }}>
            <option value="">上下文</option>
            <option value="32768">≥ 32K</option>
            <option value="65536">≥ 64K</option>
            <option value="131072">≥ 128K</option>
            <option value="1048576">≥ 1M</option>
          </select>

          {/* Free filter pill */}
          <button onClick={() => setFreeOnly(!freeOnly)}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-full border transition-colors whitespace-nowrap ${
              freeOnly
                ? 'bg-green-500/15 text-green-400 border-green-500/40'
                : 'bg-nova-hover text-nova-text-muted border-transparent hover:text-nova-text-secondary hover:border-nova-border-strong'
            }`}>
            免费 {freeCount > 0 && `(${freeCount})`}
          </button>

          {/* Favorites filter pill */}
          <button onClick={() => setShowFavorites(!showFavorites)}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-full border transition-colors whitespace-nowrap ${
              showFavorites
                ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/40'
                : 'bg-nova-hover text-nova-text-muted border-transparent hover:text-nova-text-secondary hover:border-nova-border-strong'
            }`}>
            ★ 收藏 {favoriteCount > 0 && `(${favoriteCount})`}
          </button>
        </div>
      )}

      {/* Model list dropdown */}
      {showModelList && filteredModels.length > 0 && (
        <div className="max-h-[200px] overflow-y-auto bg-nova-card border border-nova-border rounded-xl" style={{ animation: 'fadeIn 0.15s ease-out' }}>
          {filteredModels.slice(0, 50).map((model) => {
            const meta = lookupModelMetadata(model.id)
            const provider = getProviderFromModelId(model.id)
            return (
              <div
                key={model.id}
                className={`flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer transition-colors border-b border-nova-border last:border-b-0 ${
                  currentModel === model.id ? 'bg-nova-accent/10' : 'hover:bg-nova-hover'
                }`}
                onClick={() => handleModelChange(model.id)}
              >
                {/* Star */}
                <button onClick={(e) => { e.stopPropagation(); toggleFavorite(model.id) }}
                  className={`shrink-0 text-sm ${model.isFavorite ? 'text-yellow-400' : 'text-nova-text-muted hover:text-yellow-400'} bg-transparent border-none cursor-pointer`}>
                  {model.isFavorite ? '★' : '☆'}
                </button>

                {/* Provider icon */}
                <div className="w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ background: `${PROVIDER_COLORS[provider] || '#2563eb'}20`, color: PROVIDER_COLORS[provider] || '#2563eb' }}>
                  {provider.charAt(0).toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-nova-text-primary truncate">{model.alias || model.id}</div>
                  <div className="text-[10px] text-nova-text-muted">{provider}</div>
                </div>

                {/* Meta tags */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {meta?.contextWindow && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-nova-hover text-nova-text-muted">
                      {meta.contextWindow >= 1048576 ? `${Math.round(meta.contextWindow / 1048576)}M` : `${Math.round(meta.contextWindow / 1000)}K`}
                    </span>
                  )}
                  {meta?.vision && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-nova-accent/10 text-nova-accent">👁 视觉</span>
                  )}
                  {meta?.functionCall && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-nova-accent/10 text-nova-accent">⚡ 函数调用</span>
                  )}
                  {model.isFree && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400">免费</span>
                  )}
                </div>
              </div>
            )
          })}
          {filteredModels.length > 50 && (
            <div className="text-[10px] text-nova-text-muted text-center py-2">还有 {filteredModels.length - 50} 个模型...</div>
          )}
        </div>
      )}

      {/* Model comparison modal */}
      {showCompare && (
        <Suspense fallback={<div className="text-xs text-nova-text-muted">加载中...</div>}>
          <ModelCompareView onClose={() => setShowCompare(false)} />
        </Suspense>
      )}

      {/* Parameters panel */}
      {showParams && (
        <div className="p-3 bg-nova-card rounded-xl border border-nova-border grid grid-cols-2 gap-3.5">
          {[
            { key: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1 },
            { key: 'maxTokens', label: 'Max Tokens', min: 0, max: 128000, step: 1000 },
            { key: 'topP', label: 'Top P', min: 0, max: 1, step: 0.05 },
            { key: 'frequencyPenalty', label: 'Frequency Penalty', min: -2, max: 2, step: 0.1 },
            { key: 'presencePenalty', label: 'Presence Penalty', min: -2, max: 2, step: 0.1 },
          ].map(({ key, label, min, max, step }) => (
            <div key={key} className="flex flex-col gap-1.5">
              <div className="flex justify-between text-[11px]">
                <span className="font-medium text-nova-text-secondary">{label}</span>
                <span className="text-nova-text-muted font-mono">
                  {(modelParams as any)[key] === 0 && key === 'maxTokens' ? '无限制' : (modelParams as any)[key]}
                </span>
              </div>
              <input type="range" min={min} max={max} step={step} value={(modelParams as any)[key]}
                onChange={(e) => handleParamChange(key, parseFloat(e.target.value))}
                className="w-full accent-nova-accent" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
