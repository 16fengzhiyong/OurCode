/**
 * Memory store — persistent user memories.
 *
 * Memories are stored in SQLite (main process, optionally encrypted) and are
 * injected into the system prompt by the chat store when they match the
 * current message. A small heuristic also auto-suggests a memory when the user
 * asks the assistant to "记住" something.
 */
import { create } from 'zustand'
import { Memory } from '@/types'

interface MemoryState {
  memories: Memory[]
  loaded: boolean

  loadMemories: () => Promise<void>
  addMemory: (content: string, scope?: 'global' | 'project', projectPath?: string) => Promise<void>
  deleteMemory: (id: string) => Promise<void>
  getMemoriesByProject: (projectPath: string) => Memory[]
  getGlobalMemories: () => Memory[]
  getProjectPaths: () => string[]
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  memories: [],
  loaded: false,

  loadMemories: async () => {
    try {
      const memories = await window.electronAPI.memoryList()
      set({ memories, loaded: true })
    } catch (error) {
      console.error('加载记忆失败:', error)
      set({ loaded: true })
    }
  },

  addMemory: async (content, scope = 'global', projectPath) => {
    const trimmed = content.trim()
    if (!trimmed) return
    try {
      const memory = await window.electronAPI.memoryAdd(trimmed, scope, projectPath)
      set({ memories: [memory, ...get().memories] })
    } catch (error) {
      console.error('保存记忆失败:', error)
    }
  },

  deleteMemory: async (id) => {
    try {
      await window.electronAPI.memoryDelete(id)
      set({ memories: get().memories.filter((m) => m.id !== id) })
    } catch (error) {
      console.error('删除记忆失败:', error)
    }
  },

  getMemoriesByProject: (projectPath) => {
    return get().memories.filter((m) => m.scope === 'project' && m.projectPath === projectPath)
  },

  getGlobalMemories: () => {
    return get().memories.filter((m) => m.scope === 'global')
  },

  getProjectPaths: () => {
    const paths = new Set<string>()
    get().memories.forEach((m) => {
      if (m.scope === 'project' && m.projectPath) paths.add(m.projectPath)
    })
    return Array.from(paths).sort()
  },
}))
