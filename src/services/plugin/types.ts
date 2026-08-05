/**
 * Plugin System Types
 * Defines the extension API, plugin manifest, and sandbox interfaces.
 */

/** Plugin manifest (package.json-like) */
export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  main: string // Entry point file
  permissions: PluginPermission[]
  contributes?: {
    commands?: PluginCommand[]
    keybindings?: PluginKeybinding[]
    themes?: PluginTheme[]
    languages?: PluginLanguage[]
  }
}

/** Plugin permissions */
export type PluginPermission =
  | 'editor.read'
  | 'editor.write'
  | 'file.read'
  | 'file.write'
  | 'ai.chat'
  | 'ai.completion'
  | 'ui.panel'
  | 'ui.statusbar'
  | 'terminal.read'
  | 'terminal.write'
  | 'network'

/** Plugin command contribution */
export interface PluginCommand {
  id: string
  title: string
  category?: string
  icon?: string
}

/** Plugin keybinding contribution */
export interface PluginKeybinding {
  command: string
  key: string
  when?: string
}

/** Plugin theme contribution */
export interface PluginTheme {
  id: string
  label: string
  path: string
}

/** Plugin language contribution */
export interface PluginLanguage {
  id: string
  extensions: string[]
  configuration?: string
}

/** Plugin runtime state */
export type PluginStatus = 'installed' | 'active' | 'error' | 'disabled'

export interface PluginInfo {
  manifest: PluginManifest
  status: PluginStatus
  installPath: string
  enabledPermissions: PluginPermission[]
  error?: string
}

/** Extension API exposed to plugins */
export interface ExtensionAPI {
  // Editor operations
  editor: {
    getActiveFile: () => { path: string; content: string; language: string } | null
    insertText: (text: string) => void
    replaceSelection: (text: string) => void
    getSelection: () => string
    onDidChangeContent: (callback: (content: string) => void) => () => void
  }

  // File system
  fs: {
    readFile: (path: string) => Promise<string>
    writeFile: (path: string, content: string) => Promise<void>
    listDir: (path: string) => Promise<Array<{ name: string; isDirectory: boolean }>>
    exists: (path: string) => Promise<boolean>
  }

  // AI chat
  ai: {
    sendMessage: (content: string) => Promise<string>
    onMessage: (callback: (message: { role: string; content: string }) => void) => () => void
  }

  // UI registration
  ui: {
    registerPanel: (id: string, title: string, render: () => HTMLElement) => void
    unregisterPanel: (id: string) => void
    registerStatusBarItem: (id: string, text: string, position: 'left' | 'right') => void
    showNotification: (message: string, type: 'info' | 'warning' | 'error') => void
  }

  // Commands
  commands: {
    registerCommand: (id: string, handler: (...args: any[]) => void) => void
    executeCommand: (id: string, ...args: any[]) => Promise<any>
  }

  // Keyboard shortcuts
  keybindings: {
    registerKeybinding: (key: string, command: string) => void
  }

  // Workspace
  workspace: {
    getRootPath: () => string | null
    getOpenFiles: () => string[]
    getActiveFile: () => string | null
  }
}

/** Plugin message for Worker communication */
export interface PluginMessage {
  type: 'call' | 'event' | 'error' | 'ready'
  id: string
  method?: string
  args?: any[]
  data?: any
  error?: string
}
