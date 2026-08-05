import { create } from 'zustand'
import { getPluginManager, PluginInfo, PluginManifest, PluginPermission } from '@/services/plugin'

interface PluginState {
  plugins: PluginInfo[]
  isInstalling: boolean
  error: string | null

  // Actions
  loadPlugins: () => void
  installPlugin: (manifest: PluginManifest, code: string) => Promise<void>
  uninstallPlugin: (id: string) => Promise<void>
  togglePlugin: (id: string) => Promise<void>
  updatePermissions: (id: string, permissions: PluginPermission[]) => void
  clearError: () => void
}

export const usePluginStore = create<PluginState>((set, get) => ({
  plugins: [],
  isInstalling: false,
  error: null,

  loadPlugins: () => {
    const manager = getPluginManager()
    manager.loadPlugins()
    set({ plugins: manager.getPlugins() })
  },

  installPlugin: async (manifest, code) => {
    set({ isInstalling: true, error: null })
    try {
      const manager = getPluginManager()
      await manager.install(manifest, code)
      set({ plugins: manager.getPlugins(), isInstalling: false })
    } catch (error: any) {
      set({ error: error.message, isInstalling: false })
    }
  },

  uninstallPlugin: async (id) => {
    try {
      const manager = getPluginManager()
      await manager.uninstall(id)
      set({ plugins: manager.getPlugins() })
    } catch (error: any) {
      set({ error: error.message })
    }
  },

  togglePlugin: async (id) => {
    try {
      const manager = getPluginManager()
      await manager.toggle(id)
      set({ plugins: manager.getPlugins() })
    } catch (error: any) {
      set({ error: error.message })
    }
  },

  updatePermissions: (id, permissions) => {
    const manager = getPluginManager()
    manager.updatePermissions(id, permissions)
    set({ plugins: manager.getPlugins() })
  },

  clearError: () => set({ error: null }),
}))
