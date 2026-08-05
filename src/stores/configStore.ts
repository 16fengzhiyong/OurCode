import { create } from 'zustand'
import { ApiConfigGroup, ModelInfo, ModelParams, CustomModel, DEFAULT_MODEL_PARAMS, lookupModelMetadata } from '@/types'
import { fetchModels as llmFetchModels } from '@/services/llm/LLMClient'
import { v4 as uuidv4 } from 'uuid'

/** Resolve environment variable references in API key (e.g. $OPENAI_API_KEY) */
async function resolveEnvVars(value: string): Promise<string> {
  if (!value || !value.startsWith('$')) return value
  const envVarName = value.slice(1)
  try {
    const resolved = await window.electronAPI.resolveEnvVar(envVarName)
    return resolved || value
  } catch {
    return value
  }
}

export interface PromptVersion {
  content: string
  timestamp: number
}

interface ConfigState {
  configGroups: ApiConfigGroup[]
  activeConfigGroupId: string | null
  models: ModelInfo[]
  isLoadingModels: boolean
  modelParams: ModelParams
  favoriteModelIds: string[]
  promptHistory: Record<string, PromptVersion[]> // groupId -> versions
  modelsCache: Record<string, { models: string[]; timestamp: number }> // groupId -> cached models
  modelsError: string | null // error message from last model fetch
  customModels: CustomModel[] // user-added custom models

  // Actions
  loadConfigGroups: () => Promise<void>
  createConfigGroup: (group: Partial<ApiConfigGroup>) => Promise<ApiConfigGroup>
  updateConfigGroup: (id: string, updates: Partial<ApiConfigGroup>) => Promise<void>
  deleteConfigGroup: (id: string) => Promise<void>
  setActiveConfigGroup: (id: string) => void
  getActiveConfigGroup: () => ApiConfigGroup | undefined

  fetchModels: (configGroupId?: string) => Promise<void>
  setModelParams: (params: Partial<ModelParams>) => void
  toggleFavorite: (modelId: string) => void
  addCustomModel: (model: Omit<CustomModel, 'id' | 'createdAt'>) => void
  removeCustomModel: (modelId: string) => void

  // Prompt history
  savePromptVersion: (groupId: string, content: string) => void
  getPromptHistory: (groupId: string) => PromptVersion[]
  restorePromptVersion: (groupId: string, index: number) => void

  testConnection: (configGroupId: string) => Promise<{ success: boolean; message: string }>
  exportConfigGroups: (password?: string) => Promise<string>
  importConfigGroups: (data: string, password?: string) => Promise<void>
  reorderConfigGroups: (fromIndex: number, toIndex: number) => void
  resetStore: () => void
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  configGroups: [],
  activeConfigGroupId: null,
  models: [],
  isLoadingModels: false,
  modelParams: DEFAULT_MODEL_PARAMS,
  favoriteModelIds: JSON.parse(localStorage.getItem('favoriteModelIds') || '[]'),
  promptHistory: JSON.parse(localStorage.getItem('promptHistory') || '{}'),
  modelsCache: {},
  modelsError: null,
  customModels: JSON.parse(localStorage.getItem('customModels') || '[]'),

  loadConfigGroups: async () => {
    try {
      const groups = await window.electronAPI.getConfigGroups()
      // Resolve environment variable references in API keys
      const resolvedGroups = await Promise.all(
        groups.map(async (g) => ({
          ...g,
          apiKey: await resolveEnvVars(g.apiKey),
        }))
      )
      set({ configGroups: resolvedGroups })
      if (resolvedGroups.length > 0 && !get().activeConfigGroupId) {
        set({ activeConfigGroupId: resolvedGroups[0].id })
      }
    } catch (error) {
      console.error('加载配置组失败:', error instanceof Error ? error.message : 'Unknown error')
    }
  },

  createConfigGroup: async (groupData) => {
    const group = {
      id: uuidv4(),
      name: groupData.name || '新配置组',
      baseUrl: groupData.baseUrl || 'https://api.openai.com/v1',
      apiKey: groupData.apiKey || '',
      systemPrompt: groupData.systemPrompt || '',
      defaultModel: groupData.defaultModel || '',
      provider: groupData.provider || 'openai' as const,
      customHeaders: groupData.customHeaders || {},
      color: groupData.color,
      // Append after existing groups so the persisted order stays intuitive
      sortOrder: groupData.sortOrder ?? get().configGroups.length,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const saved = await window.electronAPI.saveConfigGroup(group)
    set((s) => ({
      configGroups: [saved, ...s.configGroups],
      activeConfigGroupId: saved.id,
    }))
    return saved
  },

  updateConfigGroup: async (id, updates) => {
    const group = get().configGroups.find((g) => g.id === id)
    if (!group) return

    const updated = { ...group, ...updates }
    await window.electronAPI.saveConfigGroup(updated)
    set((s) => ({
      configGroups: s.configGroups.map((g) => (g.id === id ? updated : g)),
    }))
  },

  deleteConfigGroup: async (id) => {
    await window.electronAPI.deleteConfigGroup(id)
    set((s) => {
      const newGroups = s.configGroups.filter((g) => g.id !== id)
      return {
        configGroups: newGroups,
        activeConfigGroupId: s.activeConfigGroupId === id
          ? newGroups[0]?.id || null
          : s.activeConfigGroupId,
      }
    })
  },

  setActiveConfigGroup: (id) => {
    set({ activeConfigGroupId: id, models: [] })
    get().fetchModels(id)
  },

  getActiveConfigGroup: () => {
    const { configGroups, activeConfigGroupId } = get()
    return configGroups.find((g) => g.id === activeConfigGroupId)
  },

  fetchModels: async (configGroupId) => {
    const groupId = configGroupId || get().activeConfigGroupId
    const group = get().configGroups.find((g) => g.id === groupId)
    if (!group) return

    const enrichModel = (id: string): ModelInfo => {
      const favorites = get().favoriteModelIds
      const meta = lookupModelMetadata(id)
      const custom = get().customModels.find((c) => c.id === id)
      return {
        id,
        name: custom?.name || id,
        isFree: id.includes('free') || id.includes('gpt-3.5') || id.includes('llama') || id.includes('mistral') || id.includes('gemma'),
        isFavorite: favorites.includes(id),
        contextWindow: custom?.contextWindow || meta?.contextWindow,
        vision: custom?.vision ?? meta?.vision,
        functionCall: custom?.functionCall ?? meta?.functionCall,
      }
    }

    // Check cache (1 hour TTL)
    const cache = get().modelsCache[groupId!]
    const CACHE_TTL = 60 * 60 * 1000 // 1 hour
    if (cache && (Date.now() - cache.timestamp) < CACHE_TTL) {
      const apiModels = cache.models.map(enrichModel)
      const customForGroup = get().customModels
        .filter((c) => c.provider === group.provider)
        .map((c) => enrichModel(c.id))
      // Merge: custom models not already in API list
      const existingIds = new Set(apiModels.map((m) => m.id))
      const merged = [...apiModels, ...customForGroup.filter((m) => !existingIds.has(m.id))]
      set({ models: merged, modelsError: null })
      return
    }

    set({ isLoadingModels: true, modelsError: null })

    try {
      const modelIds = await llmFetchModels(group)

      const apiModels = modelIds.map(enrichModel)
      const customForGroup = get().customModels
        .filter((c) => c.provider === group.provider)
        .map((c) => enrichModel(c.id))
      const existingIds = new Set(apiModels.map((m) => m.id))
      const merged = [...apiModels, ...customForGroup.filter((m) => !existingIds.has(m.id))]

      // Update cache
      set((s) => ({
        models: merged,
        isLoadingModels: false,
        modelsError: null,
        modelsCache: { ...s.modelsCache, [groupId!]: { models: modelIds, timestamp: Date.now() } },
      }))
    } catch (error: any) {
      console.error('获取模型列表失败:', error)
      set({ isLoadingModels: false, modelsError: error.message || '获取模型列表失败' })
    }
  },

  setModelParams: (params) => {
    set((s) => ({
      modelParams: { ...s.modelParams, ...params },
    }))
  },

  toggleFavorite: (modelId) => {
    const { favoriteModelIds } = get()
    const newFavorites = favoriteModelIds.includes(modelId)
      ? favoriteModelIds.filter((id) => id !== modelId)
      : [...favoriteModelIds, modelId]
    localStorage.setItem('favoriteModelIds', JSON.stringify(newFavorites))
    set((s) => ({
      favoriteModelIds: newFavorites,
      models: s.models.map((m) =>
        m.id === modelId ? { ...m, isFavorite: !m.isFavorite } : m
      ),
    }))
  },

  addCustomModel: (modelData) => {
    const model: CustomModel = {
      ...modelData,
      id: modelData.name,
      createdAt: Date.now(),
    }
    set((s) => {
      const updated = [...s.customModels, model]
      localStorage.setItem('customModels', JSON.stringify(updated))
      return { customModels: updated }
    })
    // Re-fetch to merge
    get().fetchModels()
  },

  removeCustomModel: (modelId) => {
    set((s) => {
      const updated = s.customModels.filter((m) => m.id !== modelId)
      localStorage.setItem('customModels', JSON.stringify(updated))
      return {
        customModels: updated,
        models: s.models.filter((m) => m.id !== modelId),
      }
    })
  },

  savePromptVersion: (groupId, content) => {
    const { promptHistory } = get()
    const existing = promptHistory[groupId] || []
    // Don't save duplicate
    if (existing.length > 0 && existing[0].content === content) return
    const newVersion: PromptVersion = { content, timestamp: Date.now() }
    const updated = [newVersion, ...existing].slice(0, 20) // Keep last 20
    const newHistory = { ...promptHistory, [groupId]: updated }
    localStorage.setItem('promptHistory', JSON.stringify(newHistory))
    set({ promptHistory: newHistory })
  },

  getPromptHistory: (groupId) => {
    return get().promptHistory[groupId] || []
  },

  restorePromptVersion: (groupId, index) => {
    const history = get().promptHistory[groupId] || []
    const version = history[index]
    if (!version) return
    get().updateConfigGroup(groupId, { systemPrompt: version.content })
  },

  testConnection: async (configGroupId) => {
    const group = get().configGroups.find((g) => g.id === configGroupId)
    if (!group) return { success: false, message: '未找到配置组' }

    try {
      const models = await llmFetchModels(group)
      return {
        success: true,
        message: `连接成功! 发现 ${models.length} 个模型。`,
      }
    } catch (error: any) {
      return {
        success: false,
        message: `连接失败: ${error.message}`,
      }
    }
  },

  exportConfigGroups: async (password?: string) => {
    const groups = await Promise.all(get().configGroups.map(async (g) => ({
      ...g,
      apiKey: password
        ? await window.electronAPI.encryptForExport(g.apiKey, password)
        : '***',
    })))
    return JSON.stringify(groups, null, 2)
  },

  importConfigGroups: async (data, password?: string) => {
    try {
      const groups = JSON.parse(data) as Partial<ApiConfigGroup>[]
      for (const group of groups) {
        if (!group.name || !group.baseUrl) continue

        let apiKey = group.apiKey || ''

        // If key looks encrypted (contains ':'), try to decrypt
        if (apiKey && apiKey !== '***' && apiKey.includes(':') && password) {
          try {
            apiKey = await window.electronAPI.decryptForImport(apiKey, password)
          } catch {
            console.error('解密API Key失败，跳过该配置组')
            continue
          }
        }

        // Skip if key is masked and no password provided
        if (!apiKey || apiKey === '***') continue

        await get().createConfigGroup({ ...group, apiKey })
      }
    } catch (error) {
      console.error('导入配置组失败:', error instanceof Error ? error.message : 'Unknown error')
    }
  },

  reorderConfigGroups: (fromIndex, toIndex) => {
    set((s) => {
      const groups = [...s.configGroups]
      const [moved] = groups.splice(fromIndex, 1)
      groups.splice(toIndex, 0, moved)
      // Persist new order
      groups.forEach((g, i) => {
        g.sortOrder = i
        window.electronAPI.saveConfigGroup(g)
      })
      return { configGroups: groups }
    })
  },

  resetStore: () => {
    localStorage.removeItem('favoriteModelIds')
    localStorage.removeItem('promptHistory')
    localStorage.removeItem('customModels')
    set({
      configGroups: [],
      activeConfigGroupId: null,
      models: [],
      modelParams: DEFAULT_MODEL_PARAMS,
      favoriteModelIds: [],
      promptHistory: {},
      modelsCache: {},
      modelsError: null,
      customModels: [],
    })
  },
}))
