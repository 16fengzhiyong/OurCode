import { PluginManifest, PluginInfo, PluginPermission, PluginStatus, PluginMessage, ExtensionAPI } from './types'
import { getFileContent } from '@/editor/modelRegistry'

// Lazy store imports to avoid circular dependency
let _editorStore: any = null
let _chatStore: any = null
let _uiStore: any = null

async function getEditorStore() {
  if (!_editorStore) {
    const mod = await import('@/stores/editorStore')
    _editorStore = mod.useEditorStore
  }
  return _editorStore
}

async function getChatStore() {
  if (!_chatStore) {
    const mod = await import('@/stores/chatStore')
    _chatStore = mod.useChatStore
  }
  return _chatStore
}

async function getUIStore() {
  if (!_uiStore) {
    const mod = await import('@/stores/uiStore')
    _uiStore = mod.useUIStore
  }
  return _uiStore
}

/**
 * PluginManager handles plugin lifecycle:
 * - Installation (download + extract)
 * - Activation (create Worker sandbox + inject API)
 * - Deactivation (terminate Worker)
 * - Uninstallation (remove files)
 * - Permission management
 */
export class PluginManager {
  private plugins: Map<string, PluginInfo> = new Map()
  private workers: Map<string, Worker> = new Map()
  private messageHandlers: Map<string, (msg: PluginMessage) => void> = new Map()
  private cleanupHandlers: Map<string, () => void> = new Map()

  // Plugin-contributed UI elements
  readonly pluginPanels: Map<string, { pluginId: string; title: string; render: () => HTMLElement }> = new Map()
  readonly statusBarItems: Map<string, { pluginId: string; text: string; position: 'left' | 'right' }> = new Map()
  readonly pluginCommands: Map<string, { pluginId: string; handler: (...args: any[]) => void }> = new Map()
  readonly pluginKeybindings: Map<string, { pluginId: string; command: string }> = new Map()

  constructor(private storagePath: string) {}

  /** Get all installed plugins */
  getPlugins(): PluginInfo[] {
    return Array.from(this.plugins.values())
  }

  /** Get plugin by ID */
  getPlugin(id: string): PluginInfo | undefined {
    return this.plugins.get(id)
  }

  /** Install a plugin from manifest + code */
  async install(manifest: PluginManifest, code: string): Promise<PluginInfo> {
    // Validate manifest
    this.validateManifest(manifest)

    // Request permissions from user
    const enabledPermissions = await this.requestPermissions(manifest.permissions)

    const plugin: PluginInfo = {
      manifest,
      status: 'installed',
      installPath: `${this.storagePath}/${manifest.id}`,
      enabledPermissions,
    }

    // Store plugin code and manifest
    await this.savePluginFiles(manifest.id, manifest, code)

    this.plugins.set(manifest.id, plugin)
    this.persistPlugins()

    return plugin
  }

  /** Activate a plugin (create Worker sandbox) */
  async activate(id: string): Promise<void> {
    const plugin = this.plugins.get(id)
    if (!plugin) throw new Error(`Plugin ${id} not found`)
    if (plugin.status === 'active') return

    try {
      // Load plugin code
      const code = await this.loadPluginCode(id)

      // Create sandboxed Worker
      const worker = this.createSandboxedWorker(id, code, plugin.enabledPermissions)

      this.workers.set(id, worker)
      plugin.status = 'active'
      plugin.error = undefined

      this.persistPlugins()
    } catch (error: any) {
      plugin.status = 'error'
      plugin.error = error.message
      this.persistPlugins()
      throw error
    }
  }

  /** Deactivate a plugin (terminate Worker) */
  deactivate(id: string): void {
    const worker = this.workers.get(id)
    if (worker) {
      worker.terminate()
      this.workers.delete(id)
    }

    // Run cleanup handler
    const cleanup = this.cleanupHandlers.get(id)
    if (cleanup) {
      cleanup()
      this.cleanupHandlers.delete(id)
    }

    // Remove message handler
    this.messageHandlers.delete(id)

    // Remove plugin-contributed UI elements
    for (const [panelId, panel] of this.pluginPanels) {
      if (panel.pluginId === id) this.pluginPanels.delete(panelId)
    }
    for (const [itemId, item] of this.statusBarItems) {
      if (item.pluginId === id) this.statusBarItems.delete(itemId)
    }
    for (const [cmdId, cmd] of this.pluginCommands) {
      if (cmd.pluginId === id) this.pluginCommands.delete(cmdId)
    }
    for (const [key, binding] of this.pluginKeybindings) {
      if (binding.pluginId === id) this.pluginKeybindings.delete(key)
    }

    const plugin = this.plugins.get(id)
    if (plugin) {
      plugin.status = 'disabled'
      this.persistPlugins()
    }
  }

  /** Uninstall a plugin */
  async uninstall(id: string): Promise<void> {
    this.deactivate(id)
    this.plugins.delete(id)
    await this.removePluginFiles(id)
    this.persistPlugins()
  }

  /** Toggle plugin enabled/disabled */
  async toggle(id: string): Promise<void> {
    const plugin = this.plugins.get(id)
    if (!plugin) return

    if (plugin.status === 'active') {
      this.deactivate(id)
    } else {
      await this.activate(id)
    }
  }

  /** Update plugin permissions */
  updatePermissions(id: string, permissions: PluginPermission[]): void {
    const plugin = this.plugins.get(id)
    if (!plugin) return
    plugin.enabledPermissions = permissions
    this.persistPlugins()
  }

  /** Send message to a plugin */
  sendMessage(pluginId: string, message: PluginMessage): void {
    const worker = this.workers.get(pluginId)
    if (worker) {
      worker.postMessage(message)
    }
  }

  /** Create extension API for a plugin with permission enforcement */
  private createExtensionAPI(pluginId: string, permissions: PluginPermission[]): ExtensionAPI {
    const hasPerm = (perm: PluginPermission) => permissions.includes(perm)

    // Store registered panels and listeners for cleanup
    const registeredPanels = new Set<string>()
    const contentListeners = new Set<() => void>()
    const messageListeners = new Set<(msg: { role: string; content: string }) => void>()

    // Cleanup function called on deactivation
    this.cleanupHandlers.set(pluginId, () => {
      registeredPanels.clear()
      contentListeners.forEach((fn) => fn())
      contentListeners.clear()
      messageListeners.forEach((fn) => fn({ role: '', content: '' }))
      messageListeners.clear()
    })

    const api: ExtensionAPI = {
      editor: {
        getActiveFile: () => {
          if (!hasPerm('editor.read')) return null
          const store = _editorStore?.getState?.()
          if (!store) return null
          const activeFile = store.openFiles.find((f: any) => f.path === store.activeFilePath)
          if (!activeFile) return null
          // Live text from the editor model; the store only keeps the initial copy
          return { path: activeFile.path, content: getFileContent(activeFile.path, activeFile.content), language: activeFile.language }
        },
        insertText: (text: string) => {
          if (!hasPerm('editor.write')) throw new Error('Permission denied: editor.write required')
          const editor = (window as any).__monacoEditor
          if (editor) {
            const selection = editor.getSelection()
            editor.executeEdits('plugin', [{ range: selection, text }])
          }
        },
        replaceSelection: (text: string) => {
          if (!hasPerm('editor.write')) throw new Error('Permission denied: editor.write required')
          const editor = (window as any).__monacoEditor
          if (editor) {
            const selection = editor.getSelection()
            editor.executeEdits('plugin', [{ range: selection, text }])
          }
        },
        getSelection: () => {
          if (!hasPerm('editor.read')) return ''
          const editor = (window as any).__monacoEditor
          if (!editor) return ''
          return editor.getModel()?.getValueInRange(editor.getSelection()) || ''
        },
        onDidChangeContent: (callback: (content: string) => void) => {
          if (!hasPerm('editor.read')) return () => {}
          const editor = (window as any).__monacoEditor
          if (!editor) return () => {}
          const disposable = editor.onDidChangeModelContent(() => {
            callback(editor.getValue())
          })
          const unsubscribe = () => disposable.dispose()
          contentListeners.add(unsubscribe)
          return () => {
            unsubscribe()
            contentListeners.delete(unsubscribe)
          }
        },
      },
      fs: {
        readFile: async (path: string) => {
          if (!hasPerm('file.read')) throw new Error('Permission denied: file.read required')
          const result = await window.electronAPI.readFile(path)
          return result.content
        },
        writeFile: async (path: string, content: string) => {
          if (!hasPerm('file.write')) throw new Error('Permission denied: file.write required')
          await window.electronAPI.writeFile(path, content, 'utf-8')
        },
        listDir: async (path: string) => {
          if (!hasPerm('file.read')) throw new Error('Permission denied: file.read required')
          const entries = await window.electronAPI.listDir(path)
          return entries.map((e: any) => ({ name: e.name, isDirectory: e.isDirectory }))
        },
        exists: async (path: string) => {
          if (!hasPerm('file.read')) return false
          try {
            await window.electronAPI.stat(path)
            return true
          } catch {
            return false
          }
        },
      },
      ai: {
        sendMessage: async (content: string) => {
          if (!hasPerm('ai.chat')) throw new Error('Permission denied: ai.chat required')
          const chatStore = _chatStore?.getState?.()
          if (!chatStore) throw new Error('Chat store not available')
          return new Promise<string>((resolve) => {
            const unsub = _chatStore.subscribe((state: any) => {
              if (!state.isLoading && state.streamingContent === '') {
                const session = state.sessions.find((s: any) => s.id === state.activeSessionId)
                const lastAssistant = [...(session?.messages || [])].reverse().find((m: any) => m.role === 'assistant')
                messageListeners.delete(unsub)
                unsub()
                resolve(lastAssistant?.content || '')
              }
            })
            messageListeners.add(unsub as any)
            chatStore.sendMessage(content)
          })
        },
        onMessage: (callback: (message: { role: string; content: string }) => void) => {
          if (!hasPerm('ai.chat')) return () => {}
          const unsub = _chatStore.subscribe((state: any) => {
            if (state.streamingContent) {
              callback({ role: 'assistant', content: state.streamingContent })
            }
          })
          messageListeners.add(unsub)
          return () => {
            unsub()
            messageListeners.delete(unsub)
          }
        },
      },
      ui: {
        registerPanel: (id: string, title: string, render: () => HTMLElement) => {
          if (!hasPerm('ui.panel')) throw new Error('Permission denied: ui.panel required')
          registeredPanels.add(id)
          // Store panel registration for sidebar rendering
          this.pluginPanels.set(id, { pluginId, title, render })
        },
        unregisterPanel: (id: string) => {
          if (!hasPerm('ui.panel')) throw new Error('Permission denied: ui.panel required')
          registeredPanels.delete(id)
          this.pluginPanels.delete(id)
        },
        registerStatusBarItem: (id: string, text: string, position: 'left' | 'right') => {
          if (!hasPerm('ui.statusbar')) throw new Error('Permission denied: ui.statusbar required')
          this.statusBarItems.set(id, { pluginId, text, position })
        },
        showNotification: (message: string, type: 'info' | 'warning' | 'error') => {
          // Notifications are always allowed
          const uiStore = _uiStore?.getState?.()
          if (uiStore?.showNotification) {
            uiStore.showNotification(message, type)
          }
        },
      },
      commands: {
        registerCommand: (id: string, handler: (...args: any[]) => void) => {
          this.pluginCommands.set(id, { pluginId, handler })
        },
        executeCommand: async (id: string, ...args: any[]) => {
          const cmd = this.pluginCommands.get(id)
          if (!cmd) throw new Error(`Command ${id} not found`)
          return cmd.handler(...args)
        },
      },
      keybindings: {
        registerKeybinding: (key: string, command: string) => {
          this.pluginKeybindings.set(key, { pluginId, command })
        },
      },
      workspace: {
        getRootPath: () => {
          const el = document.getElementById('file-tree-root')
          return el?.getAttribute('data-root-path') || null
        },
        getOpenFiles: () => {
          const store = _editorStore?.getState?.()
          return store?.openFiles?.map((f: any) => f.path) || []
        },
        getActiveFile: () => {
          const store = _editorStore?.getState?.()
          return store?.activeFilePath || null
        },
      },
    }

    return api
  }

  /** Create a sandboxed Worker for a plugin */
  private createSandboxedWorker(pluginId: string, code: string, permissions: PluginPermission[]): Worker {
    // Permission-to-API mapping for runtime enforcement
    const permissionApiMap: Record<string, string[]> = {
      'editor.read': ['editor.getActiveFile', 'editor.getSelection', 'editor.onDidChangeContent'],
      'editor.write': ['editor.insertText', 'editor.replaceSelection'],
      'file.read': ['fs.readFile', 'fs.listDir', 'fs.exists'],
      'file.write': ['fs.writeFile'],
      'ai.chat': ['ai.sendMessage', 'ai.onMessage'],
      'ai.completion': [],
      'ui.panel': ['ui.registerPanel', 'ui.unregisterPanel'],
      'ui.statusbar': ['ui.registerStatusBarItem'],
      'terminal.read': [],
      'terminal.write': [],
      'network': [],
    }

    const allowedApis = new Set<string>()
    for (const perm of permissions) {
      for (const api of permissionApiMap[perm] || []) {
        allowedApis.add(api)
      }
    }

    // Create Worker with sandbox wrapper
    const sandboxCode = `
      // Plugin sandbox
      const __pluginId = ${JSON.stringify(pluginId)};
      const __permissions = ${JSON.stringify(permissions)};
      const __allowedApis = new Set(${JSON.stringify(Array.from(allowedApis))});
      let __api = {};

      function __checkPermission(apiPath) {
        if (!__allowedApis.has(apiPath)) {
          throw new Error('Permission denied: plugin "' + __pluginId + '" does not have permission for "' + apiPath + '". Required permission not granted.');
        }
      }

      // Create permission-proxied API
      function __createProxy(api, prefix) {
        const handler = {
          get(target, prop) {
            const path = prefix + '.' + prop;
            if (typeof target[prop] === 'object' && target[prop] !== null) {
              return __createProxy(target[prop], path);
            }
            if (typeof target[prop] === 'function') {
              return function(...args) {
                __checkPermission(path);
                return target[prop](...args);
              };
            }
            return target[prop];
          }
        };
        return new Proxy(api, handler);
      }

      // Message bridge
      self.onmessage = function(e) {
        const msg = e.data;
        if (msg.type === 'init') {
          __api = msg.api;
          try {
            // Expose permission-checked API as global 'api' object
            var api = {};
            api.editor = __createProxy(__api.editor || {}, 'editor');
            api.fs = __createProxy(__api.fs || {}, 'fs');
            api.ai = __createProxy(__api.ai || {}, 'ai');
            api.ui = __createProxy(__api.ui || {}, 'ui');
            api.commands = __api.commands || {};
            api.keybindings = __api.keybindings || {};
            api.workspace = __api.workspace || {};

            ${code}
            self.postMessage({ type: 'ready', id: __pluginId });
          } catch(err) {
            self.postMessage({ type: 'error', id: __pluginId, error: err.message });
          }
        } else if (msg.type === 'call') {
          try {
            // Handle API calls from plugin
          } catch(err) {
            self.postMessage({ type: 'error', id: __pluginId, error: err.message });
          }
        }
      };
    `

    const blob = new Blob([sandboxCode], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    const worker = new Worker(url)
    URL.revokeObjectURL(url)

    // Set up message handler
    worker.onmessage = (e) => {
      const msg = e.data as PluginMessage
      this.messageHandlers.get(pluginId)?.(msg)
    }

    worker.onerror = (e) => {
      console.error(`Plugin ${pluginId} error:`, e.message)
    }

    // Initialize plugin
    const api = this.createExtensionAPI(pluginId, permissions)
    worker.postMessage({ type: 'init', id: pluginId, api })

    return worker
  }

  /** Validate plugin manifest */
  private validateManifest(manifest: PluginManifest): void {
    if (!manifest.id) throw new Error('Plugin must have an ID')
    if (!manifest.name) throw new Error('Plugin must have a name')
    if (!manifest.version) throw new Error('Plugin must have a version')
    if (!manifest.main) throw new Error('Plugin must have an entry point')
  }

  /** Request permissions from user with confirmation dialog */
  private async requestPermissions(permissions: PluginPermission[]): Promise<PluginPermission[]> {
    if (permissions.length === 0) return []

    const permissionLabels: Record<PluginPermission, string> = {
      'editor.read': 'Read editor content',
      'editor.write': 'Modify editor content',
      'file.read': 'Read files from disk',
      'file.write': 'Write files to disk',
      'ai.chat': 'Send messages to AI',
      'ai.completion': 'Request AI code completions',
      'ui.panel': 'Register custom UI panels',
      'ui.statusbar': 'Add status bar items',
      'terminal.read': 'Read terminal output',
      'terminal.write': 'Write to terminal',
      'network': 'Make network requests',
    }

    const permissionList = permissions.map((p) => `  - ${p}: ${permissionLabels[p] || p}`).join('\n')
    const message = `A plugin requests the following permissions:\n\n${permissionList}\n\nGrant these permissions?`

    const approved = confirm(message)
    if (!approved) {
      // Grant only safe read-only permissions by default
      const safeDefaults: PluginPermission[] = permissions.filter((p) =>
        p === 'editor.read' || p === 'file.read' || p === 'terminal.read'
      )
      return safeDefaults
    }

    return [...permissions]
  }

  /** Check if a plugin has a specific permission */
  hasPermission(pluginId: string, permission: PluginPermission): boolean {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) return false
    return plugin.enabledPermissions.includes(permission)
  }

  /** Persist plugin list to storage */
  private persistPlugins(): void {
    const data = Array.from(this.plugins.values()).map((p) => ({
      manifest: p.manifest,
      status: p.status,
      installPath: p.installPath,
      enabledPermissions: p.enabledPermissions,
    }))
    localStorage.setItem('installedPlugins', JSON.stringify(data))
  }

  /** Load plugins from storage */
  loadPlugins(): void {
    try {
      const data = localStorage.getItem('installedPlugins')
      if (data) {
        const plugins = JSON.parse(data) as PluginInfo[]
        for (const plugin of plugins) {
          this.plugins.set(plugin.manifest.id, plugin)
        }
      }
    } catch {
      // Ignore corrupted data
    }
  }

  /** Save plugin files to storage */
  private async savePluginFiles(id: string, manifest: PluginManifest, code: string): Promise<void> {
    localStorage.setItem(`plugin_${id}_manifest`, JSON.stringify(manifest))
    localStorage.setItem(`plugin_${id}_code`, code)
  }

  /** Load plugin code from storage */
  private async loadPluginCode(id: string): Promise<string> {
    const code = localStorage.getItem(`plugin_${id}_code`)
    if (!code) throw new Error(`Plugin ${id} code not found`)
    return code
  }

  /** Remove plugin files from storage */
  private async removePluginFiles(id: string): Promise<void> {
    localStorage.removeItem(`plugin_${id}_manifest`)
    localStorage.removeItem(`plugin_${id}_code`)
  }
}

/** Singleton instance */
let pluginManagerInstance: PluginManager | null = null

export function getPluginManager(): PluginManager {
  if (!pluginManagerInstance) {
    pluginManagerInstance = new PluginManager('/plugins')
    pluginManagerInstance.loadPlugins()
  }
  return pluginManagerInstance
}
