import { PluginManifest, PluginInfo, PluginPermission, PluginMessage, ExtensionAPI } from './types'
import { getFileContent } from '@/editor/modelRegistry'
import { registerCommand, unregisterCommand } from '@/services/commands/commandRegistry'
// Static store imports: the stores are already statically imported by the app
// shell, so a dynamic import here would neither avoid a cycle nor split the
// bundle — it only trips Vite's "dynamic import will not move module into
// another chunk" warning.
import { useEditorStore } from '@/stores/editorStore'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'

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
  private cleanupHandlers: Map<string, () => void> = new Map()

  // Plugin-contributed UI elements
  readonly pluginPanels: Map<string, { pluginId: string; title: string; render: () => string }> = new Map()
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

    // Remove plugin-contributed UI elements
    for (const [panelId, panel] of this.pluginPanels) {
      if (panel.pluginId === id) this.pluginPanels.delete(panelId)
    }
    for (const [itemId, item] of this.statusBarItems) {
      if (item.pluginId === id) this.statusBarItems.delete(itemId)
    }
    for (const [cmdId, cmd] of this.pluginCommands) {
      if (cmd.pluginId === id) {
        this.pluginCommands.delete(cmdId)
        unregisterCommand(`plugin.${cmdId}`)
      }
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
          const store = useEditorStore.getState()
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
          const chatStore = useChatStore.getState()
          if (!chatStore) throw new Error('Chat store not available')
          return new Promise<string>((resolve) => {
            const unsub = useChatStore.subscribe((state: any) => {
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
          const unsub = useChatStore.subscribe((state: any) => {
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
        registerPanel: (id: string, title: string, render: () => string) => {
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
          useUIStore.getState().showNotification(message, type)
        },
      },
      commands: {
        registerCommand: (id: string, handler: (...args: any[]) => void) => {
          this.pluginCommands.set(id, { pluginId, handler })
          // Contribute the command to the unified registry so it shows up in
          // the command palette alongside built-in commands
          registerCommand({
            id: `plugin.${id}`,
            title: id,
            category: '插件',
            run: (...args) => handler(...args),
          })
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
          const store = useEditorStore.getState()
          return store?.openFiles?.map((f: any) => f.path) || []
        },
        getActiveFile: () => {
          const store = useEditorStore.getState()
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

    // Create Worker with sandbox wrapper. The worker never receives the real
    // extension API — postMessage would throw DataCloneError on its functions.
    // Instead it gets a MessageChannel port and every API call is an RPC
    // (path + args) executed on the main thread, with the result sent back.
    const sandboxCode = `
      // Plugin sandbox
      const __pluginId = ${JSON.stringify(pluginId)};
      const __allowedApis = new Set(${JSON.stringify(Array.from(allowedApis))});

      // Plugin-provided callbacks (functions stay in this worker — the main
      // thread invokes them by id).
      const __callbacks = new Map();
      // In-flight RPC calls waiting for a response.
      const __pending = new Map();
      let __port = null;
      let __rpcSeq = 0;
      let __cbSeq = 0;

      function __checkPermission(apiPath) {
        if (!__allowedApis.has(apiPath)) {
          throw new Error('Permission denied: plugin "' + __pluginId + '" does not have permission for "' + apiPath + '". Required permission not granted.');
        }
      }

      // Serialize a value for transit: functions become callback references.
      function __serialize(v) {
        if (typeof v === 'function') {
          const cbId = 'cb' + (++__cbSeq);
          __callbacks.set(cbId, v);
          return { __cb: cbId };
        }
        if (Array.isArray(v)) return v.map(__serialize);
        if (v && typeof v === 'object') {
          const out = {};
          for (const k of Object.keys(v)) out[k] = __serialize(v[k]);
          return out;
        }
        return v;
      }

      // RPC call: post the API path + args, resolve when the result returns.
      function __call(path, args) {
        return new Promise((resolve, reject) => {
          const id = ++__rpcSeq;
          __pending.set(id, { resolve, reject });
          __port.postMessage({ type: 'call', id, path, args: args.map(__serialize) });
        });
      }

      // Lazy API surface: every property access yields a callable that sends an
      // RPC request; permission is checked at call time against the full path.
      function __makeApi(path) {
        return new Proxy(function () {}, {
          get(target, prop) {
            if (prop === 'then' || prop === 'toJSON') return undefined;
            return __makeApi(path + '.' + prop);
          },
          apply(target, thisArg, args) {
            __checkPermission(path);
            return __call(path, args);
          },
        });
      }

      self.onmessage = function(e) {
        const msg = e.data;
        if (msg && msg.type === 'init') {
          __port = e.ports[0];
          __port.onmessage = function(m) {
            const data = m.data;
            if (data.type === 'callResult') {
              const p = __pending.get(data.id);
              if (p) { __pending.delete(data.id); p.resolve(data.result); }
            } else if (data.type === 'callError') {
              const p = __pending.get(data.id);
              if (p) { __pending.delete(data.id); p.reject(new Error(data.error)); }
            } else if (data.type === 'invoke') {
              const fn = __callbacks.get(data.cbId);
              if (fn) {
                Promise.resolve().then(() => fn(...(data.args || [])))
                  .then((result) => __port.postMessage({ type: 'cbResult', cbId: data.cbId, result }))
                  .catch((err) => __port.postMessage({ type: 'cbResult', cbId: data.cbId, error: err.message }));
              }
            }
          };
          try {
            // Expose the RPC-backed API as the global 'api' object
            var api = {
              editor: __makeApi('editor'),
              fs: __makeApi('fs'),
              ai: __makeApi('ai'),
              ui: __makeApi('ui'),
              commands: __makeApi('commands'),
              keybindings: __makeApi('keybindings'),
              workspace: __makeApi('workspace'),
            };

            ${code}
            __port.postMessage({ type: 'ready', id: __pluginId });
          } catch(err) {
            __port.postMessage({ type: 'error', id: __pluginId, error: err.message });
          }
        }
      };
    `

    const blob = new Blob([sandboxCode], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    const worker = new Worker(url)
    URL.revokeObjectURL(url)

    worker.onerror = (e) => {
      console.error(`Plugin ${pluginId} error:`, e.message)
    }

    const channel = new MessageChannel()
    const port = channel.port1
    const api = this.createExtensionAPI(pluginId, permissions)
    const callbackPending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>()

    // Args may carry { __cb } placeholders for plugin-provided callbacks
    const deserializeArgs = (args: any[]): any[] =>
      args.map((a) => (
        a && typeof a === 'object' && typeof a.__cb === 'string'
          ? (...cbArgs: any[]) => new Promise<any>((resolve, reject) => {
              callbackPending.set(a.__cb, { resolve, reject })
              port.postMessage({ type: 'invoke', cbId: a.__cb, args: cbArgs })
            })
          : a
      ))

    // Drop functions from results (they cannot cross the boundary)
    const sanitize = (v: any): any => {
      if (typeof v === 'function') return undefined
      if (Array.isArray(v)) return v.map(sanitize)
      if (v && typeof v === 'object') {
        const out: Record<string, any> = {}
        for (const k of Object.keys(v)) out[k] = sanitize(v[k])
        return out
      }
      return v
    }

    port.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'call') {
        // Resolve the target function by walking the dotted API path
        let target: any = api
        for (const key of String(msg.path).split('.')) {
          target = target == null ? undefined : target[key]
        }
        if (typeof target !== 'function') {
          port.postMessage({ type: 'callError', id: msg.id, error: `Unknown API: ${msg.path}` })
          return
        }
        Promise.resolve()
          .then(() => target(...deserializeArgs(msg.args || [])))
          .then((result) => port.postMessage({ type: 'callResult', id: msg.id, result: sanitize(result) }))
          .catch((err) => port.postMessage({ type: 'callError', id: msg.id, error: err?.message ?? String(err) }))
      } else if (msg.type === 'cbResult') {
        const p = callbackPending.get(msg.cbId)
        if (p) {
          callbackPending.delete(msg.cbId)
          if (msg.error) p.reject(new Error(msg.error))
          else p.resolve(msg.result)
        }
      } else if (msg.type === 'ready') {
        // Activation acknowledged by the sandbox
        const plugin = this.plugins.get(pluginId)
        if (plugin) {
          plugin.status = 'active'
          plugin.error = undefined
          this.persistPlugins()
        }
      } else if (msg.type === 'error') {
        const plugin = this.plugins.get(pluginId)
        if (plugin) {
          plugin.status = 'error'
          plugin.error = msg.error
          this.persistPlugins()
        }
      }
    }

    // Transfer the worker-side port; all further communication goes over it
    worker.postMessage({ type: 'init', id: pluginId }, [channel.port2])

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
