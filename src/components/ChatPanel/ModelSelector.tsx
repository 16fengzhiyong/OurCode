import { useState, useMemo, lazy, Suspense } from 'react'
import { useConfigStore } from '@/stores/configStore'
import { useChatStore } from '@/stores/chatStore'
import { lookupModelMetadata } from '@/types'

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

export default function ModelSelector() {
  const [showParams, setShowParams] = useState(false)
  const [freeOnly, setFreeOnly] = useState(false)
  const [showFavorites, setShowFavorites] = useState(false)
  const [showCompare, setShowCompare] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [providerFilter, setProviderFilter] = useState<string>('')
  const [contextFilter, setContextFilter] = useState<string>('')
  const {
    models,
    isLoadingModels,
    modelsError,
    modelParams,
    fetchModels,
    setModelParams,
    getActiveConfigGroup,
    toggleFavorite,
  } = useConfigStore()

  const {
    activeSessionId,
    getActiveSession,
    updateSessionModel,
    updateSessionParams,
  } = useChatStore()

  const activeSession = getActiveSession()
  const currentModel = activeSession?.model || getActiveConfigGroup()?.defaultModel || ''

  // Extract unique providers from models
  const providers = useMemo(() => {
    const set = new Set(models.map((m) => getProviderFromModelId(m.id)))
    return Array.from(set).sort()
  }, [models])

  // Filter and sort models
  const filteredModels = useMemo(() => {
    let result = [...models]

    // Apply free filter
    if (freeOnly) {
      result = result.filter((m) => m.isFree)
    }

    // Apply favorites filter
    if (showFavorites) {
      result = result.filter((m) => m.isFavorite)
    }

    // Apply provider filter
    if (providerFilter) {
      result = result.filter((m) => getProviderFromModelId(m.id) === providerFilter)
    }

    // Apply context window filter
    if (contextFilter) {
      const minTokens = parseInt(contextFilter)
      result = result.filter((m) => {
        const meta = lookupModelMetadata(m.id)
        return meta?.contextWindow && meta.contextWindow >= minTokens
      })
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter((m) =>
        m.id.toLowerCase().includes(query) ||
        (m.alias && m.alias.toLowerCase().includes(query))
      )
    }

    // Sort: favorites first, then alphabetical
    result.sort((a, b) => {
      if (a.isFavorite && !b.isFavorite) return -1
      if (!a.isFavorite && b.isFavorite) return 1
      return a.id.localeCompare(b.id)
    })

    return result
  }, [models, freeOnly, showFavorites, searchQuery, providerFilter, contextFilter])

  const handleModelChange = (modelId: string) => {
    if (activeSessionId) {
      updateSessionModel(activeSessionId, modelId)
    }
  }

  const handleParamChange = (key: string, value: number) => {
    setModelParams({ [key]: value })
    if (activeSessionId) {
      updateSessionParams(activeSessionId, { [key]: value })
    }
  }

  const freeCount = models.filter((m) => m.isFree).length
  const favoriteCount = models.filter((m) => m.isFavorite).length

  return (
    <div className="space-y-2">
      {/* Model selector row */}
      <div className="flex items-center gap-2">
        <select
          value={currentModel}
          onChange={(e) => handleModelChange(e.target.value)}
          className="flex-1 py-1.5 px-3 bg-nova-input-bg text-nova-text-secondary rounded-lg border border-nova-border text-xs focus:border-nova-accent focus:outline-none"
          disabled={isLoadingModels}
        >
          <option value="">
            {isLoadingModels ? '加载模型中...' : '选择模型'}
          </option>
          {filteredModels.map((model) => {
            const meta = lookupModelMetadata(model.id)
            const parts = [model.alias || model.id]
            if (meta?.contextWindow) parts.push(`${Math.round(meta.contextWindow / 1000)}K`)
            if (meta?.vision) parts.push('👁')
            if (meta?.functionCall) parts.push('⚡')
            if (model.isFree) parts.push('免费')
            return (
              <option key={model.id} value={model.id}>
                {model.isFavorite ? '★ ' : ''}{parts.join(' | ')}
              </option>
            )
          })}
        </select>

        <button
          onClick={() => fetchModels()}
          disabled={isLoadingModels}
          className="p-1.5 rounded-lg text-nova-text-muted hover:text-text-primary hover:bg-nova-hover disabled:opacity-50 transition-colors"
          title="刷新模型"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>

        {models.length > 0 && (
          <button
            onClick={() => setShowCompare(true)}
            className="p-1.5 rounded-lg text-nova-text-muted hover:text-text-primary hover:bg-nova-hover transition-colors"
            title="对比模型"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
            </svg>
          </button>
        )}

        <button
          onClick={() => setShowParams(!showParams)}
          className={`p-1.5 rounded-lg transition-colors ${
            showParams ? 'bg-accent-btn-primary text-white' : 'text-nova-text-muted hover:text-text-primary hover:bg-nova-hover'
          }`}
          title="模型参数"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {/* Model fetch error */}
      {modelsError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] bg-red-500/10 border border-red-500/30 text-red-400">
          <span className="flex-1 truncate" title={modelsError}>模型列表获取失败: {modelsError}</span>
          <button
            onClick={() => fetchModels()}
            disabled={isLoadingModels}
            className="shrink-0 px-2 py-0.5 bg-red-500/20 text-red-300 rounded hover:bg-red-500/30 disabled:opacity-50 transition-colors"
          >
            重试
          </button>
        </div>
      )}

      {/* Filter row */}
      {models.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[100px]">
            <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-nova-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索模型..."
              className="w-full pl-6 pr-2 py-1 bg-nova-input-bg border border-nova-border rounded text-[10px] text-nova-text-primary outline-none focus:border-nova-accent/50 placeholder-nova-text-muted"
            />
          </div>

          {/* Provider filter */}
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="px-2 py-1 bg-nova-input-bg border border-nova-border rounded text-[10px] text-nova-text-secondary outline-none focus:border-nova-accent/50"
          >
            <option value="">所有提供商</option>
            {providers.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          {/* Context window filter */}
          <select
            value={contextFilter}
            onChange={(e) => setContextFilter(e.target.value)}
            className="px-2 py-1 bg-nova-input-bg border border-nova-border rounded text-[10px] text-nova-text-secondary outline-none focus:border-nova-accent/50"
          >
            <option value="">任意上下文</option>
            <option value="4096">&ge; 4K</option>
            <option value="8192">&ge; 8K</option>
            <option value="32768">&ge; 32K</option>
            <option value="65536">&ge; 64K</option>
            <option value="131072">&ge; 128K</option>
            <option value="1048576">&ge; 1M</option>
          </select>

          {/* Free filter */}
          <button
            onClick={() => setFreeOnly(!freeOnly)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors ${
              freeOnly
                ? 'bg-green-600/20 text-green-400 border border-green-600/40'
                : 'bg-nova-hover text-nova-text-muted hover:text-nova-text-secondary border border-transparent'
            }`}
          >
            <span>免费</span>
            {freeCount > 0 && <span className="opacity-70">({freeCount})</span>}
          </button>

          {/* Favorites filter */}
          <button
            onClick={() => setShowFavorites(!showFavorites)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors ${
              showFavorites
                ? 'bg-yellow-600/20 text-yellow-400 border border-yellow-600/40'
                : 'bg-nova-hover text-nova-text-muted hover:text-nova-text-secondary border border-transparent'
            }`}
          >
            <span>★</span>
            {favoriteCount > 0 && <span className="opacity-70">({favoriteCount})</span>}
          </button>
        </div>
      )}

      {/* Model list (expandable) */}
      {models.length > 0 && (freeOnly || showFavorites || searchQuery) && filteredModels.length > 0 && (
        <div className="p-2 bg-nova-bg rounded-lg border border-nova-border max-h-[120px] overflow-y-auto space-y-0.5">
          {filteredModels.slice(0, 30).map((model) => {
            const meta = lookupModelMetadata(model.id)
            return (
              <div
                key={model.id}
                className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-[10px] transition-colors ${
                  currentModel === model.id
                    ? 'bg-nova-accent/20 text-nova-accent'
                    : 'hover:bg-nova-hover text-nova-text-secondary'
                }`}
                onClick={() => handleModelChange(model.id)}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFavorite(model.id)
                  }}
                  className={`shrink-0 ${model.isFavorite ? 'text-yellow-400' : 'text-nova-text-muted hover:text-yellow-400'}`}
                  title={model.isFavorite ? '取消收藏' : '收藏'}
                >
                  {model.isFavorite ? '★' : '☆'}
                </button>
                <span className="flex-1 truncate">{model.alias || model.id}</span>
                {meta?.contextWindow && (
                  <span className="shrink-0 text-[9px] text-nova-text-muted" title="上下文窗口">
                    {meta.contextWindow >= 1048576 ? `${Math.round(meta.contextWindow / 1048576)}M` : `${Math.round(meta.contextWindow / 1000)}K`}
                  </span>
                )}
                {meta?.vision && (
                  <span className="shrink-0 text-[9px]" title="支持视觉">👁</span>
                )}
                {meta?.functionCall && (
                  <span className="shrink-0 text-[9px]" title="支持函数调用">⚡</span>
                )}
                {model.isFree && (
                  <span className="shrink-0 px-1 py-0.5 bg-green-600/20 text-green-400 rounded text-[9px]">免费</span>
                )}
              </div>
            )
          })}
          {filteredModels.length > 30 && (
            <div className="text-[10px] text-nova-text-muted text-center py-1">
              +{filteredModels.length - 30} 更多...
            </div>
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
        <div className="p-3 bg-nova-bg rounded-xl border border-nova-border space-y-3">
          {[
            { key: 'temperature', label: '温度 (Temperature)', min: 0, max: 2, step: 0.1 },
            { key: 'maxTokens', label: '最大令牌数 (Max Tokens)', min: 0, max: 128000, step: 1000 },
            { key: 'topP', label: '核采样 (Top P)', min: 0, max: 1, step: 0.05 },
            { key: 'frequencyPenalty', label: '频率惩罚', min: -2, max: 2, step: 0.1 },
            { key: 'presencePenalty', label: '存在惩罚', min: -2, max: 2, step: 0.1 },
          ].map(({ key, label, min, max, step }) => (
            <div key={key}>
              <div className="flex justify-between text-xs text-nova-text-muted mb-1">
                <span>{label}</span>
                <span>{(modelParams as any)[key] || (key === 'maxTokens' ? '无限制' : '0')}</span>
              </div>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={(modelParams as any)[key]}
                onChange={(e) => handleParamChange(key, parseFloat(e.target.value))}
                className="w-full accent-accent-blue"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
