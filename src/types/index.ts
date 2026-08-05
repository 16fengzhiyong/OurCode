// Re-export shared types
export * from '@shared/types'
export * from '@shared/constants'

// Electron API type
export interface ElectronAPI {
  // File System
  readFile: (path: string) => Promise<{ content: string; encoding: string; hasBom: boolean }>
  writeFile: (path: string, content: string, encoding: string, hasBom?: boolean) => Promise<void>
  openFileStream: (path: string) => Promise<import('@shared/types').FileStreamStart>
  readFileChunk: (id: number) => Promise<import('@shared/types').FileStreamChunk | null>
  readFileChunkBatch: (id: number, maxBytes?: number) => Promise<import('@shared/types').FileStreamChunk[] | null>
  closeFileStream: (id: number) => Promise<void>
  openWriteStream: (path: string, encoding: string, hasBom?: boolean) => Promise<number>
  writeChunk: (id: number, chunk: string) => Promise<void>
  closeWriteStream: (id: number) => Promise<void>
  abortWriteStream: (id: number) => Promise<void>
  listDir: (path: string) => Promise<import('@shared/types').FileEntry[]>
  createFile: (path: string) => Promise<void>
  createDir: (path: string) => Promise<void>
  rename: (oldPath: string, newPath: string) => Promise<void>
  delete: (path: string) => Promise<void>
  stat: (path: string) => Promise<import('@shared/types').FileStat>
  watch: (path: string) => Promise<void>
  unwatch: (path: string) => Promise<void>
  openInFinder: (path: string) => Promise<void>
  copyPath: (path: string) => Promise<void>
  copy: (src: string, dest: string) => Promise<void>
  move: (src: string, dest: string) => Promise<void>
  saveBackup: (filePath: string, content: string, encoding: string, hasBom?: boolean) => Promise<void>
  listBackups: () => Promise<import('@shared/types').BackupEntry[]>
  readBackup: (filePath: string) => Promise<{ content: string; encoding: string; hasBom: boolean } | null>
  deleteBackup: (filePath: string) => Promise<void>
  clearBackups: () => Promise<void>
  lspStart: (uri: string, command: string, args: string[], cwd: string, languageId: string, text: string) => Promise<{ ok: boolean; error?: string }>
  lspDidChange: (uri: string, version: number, text: string) => Promise<void>
  lspStop: (uri: string) => Promise<void>
  onLspDiagnostics: (callback: (payload: { uri: string; diagnostics: Array<Record<string, unknown>> }) => void) => () => void
  debugStart: (command: string, args: string[], cwd: string, launchConfig: Record<string, unknown>, breakpoints: Array<{ path: string; line: number }>) => Promise<{ ok: boolean; error?: string }>
  debugSetBreakpoints: (path: string, lines: number[]) => Promise<void>
  debugContinue: () => Promise<void>
  debugPause: () => Promise<void>
  debugStepOver: () => Promise<void>
  debugStepInto: () => Promise<void>
  debugStepOut: () => Promise<void>
  debugStop: () => Promise<void>
  onDebugEvent: (event: 'stopped' | 'output' | 'terminated', callback: (body: Record<string, unknown>) => void) => () => void
  onFileChanged: (callback: (path: string) => void) => () => void

  // Store
  getConfigGroups: () => Promise<import('@shared/types').ApiConfigGroup[]>
  saveConfigGroup: (group: any) => Promise<import('@shared/types').ApiConfigGroup>
  deleteConfigGroup: (id: string) => Promise<void>
  getSessions: () => Promise<import('@shared/types').ChatSession[]>
  saveSession: (session: any) => Promise<import('@shared/types').ChatSession>
  deleteSession: (id: string) => Promise<void>
  getPreferences: () => Promise<import('@shared/types').UserPreferences>
  savePreferences: (prefs: any) => Promise<void>
  resetAll: () => Promise<void>

  // Crypto
  encryptForExport: (text: string, password: string) => Promise<string>
  decryptForImport: (encryptedData: string, password: string) => Promise<string>

  // Dialog
  openFolder: () => Promise<string | null>
  openFile: () => Promise<string | null>
  saveFile: (defaultPath?: string) => Promise<string | null>

  // Window
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  openDevTools: () => Promise<void>
  openNewWindow: () => Promise<void>
  onMaximized: (callback: (isMaximized: boolean) => void) => () => void

  // Terminal
  termCreate: (id: string, cwd?: string) => Promise<void>
  termWrite: (id: string, data: string) => Promise<void>
  termResize: (id: string, cols: number, rows: number) => Promise<void>
  termDispose: (id: string) => Promise<void>
  onTermData: (id: string, callback: (data: string) => void) => () => void
  onTermExit: (id: string, callback: (code: number) => void) => () => void

  // Search
  searchInFiles: (dirPath: string, query: string, options?: import('@shared/types').SearchOptions) => Promise<import('@shared/types').SearchResult[]>
  searchFiles: (dirPath: string, query: string) => Promise<string[]>

  // Git
  gitExec: (cwd: string, args: string[]) => Promise<{ success: boolean; output: string; error?: string }>

  // Shell
  shellExec: (command: string, cwd?: string) => Promise<{ success: boolean; output: string; error?: string }>

  // Web fetch (web_search / read_url tools)
  webFetch: (url: string, options?: { timeoutMs?: number; maxBytes?: number }) => Promise<{
    ok: boolean; status?: number; contentType?: string; finalUrl?: string; text?: string; error?: string
  }>

  // Memories
  memoryList: () => Promise<import('@shared/types').Memory[]>
  memoryAdd: (content: string, scope?: string) => Promise<import('@shared/types').Memory>
  memoryDelete: (id: string) => Promise<void>

  // Workflows
  workflowList: () => Promise<import('@shared/types').Workflow[]>
  workflowAdd: (workflow: { name: string; description?: string; prompt: string }) => Promise<import('@shared/types').Workflow>
  workflowDelete: (id: string) => Promise<void>

  // Checkpoints (AI edit snapshots)
  checkpointList: (sessionId: string) => Promise<import('@shared/types').Checkpoint[]>
  checkpointCreate: (checkpoint: import('@shared/types').Checkpoint) => Promise<import('@shared/types').Checkpoint>
  checkpointDelete: (sessionId: string) => Promise<void>
  checkpointRevert: (checkpointId: string) => Promise<{ ok: boolean; restored: number; error?: string }>

  // MCP (Model Context Protocol)
  mcpListTools: () => Promise<Array<{ server: string; name: string; description?: string; inputSchema?: Record<string, any> }>>
  mcpCallTool: (server: string, toolName: string, args: Record<string, any>) => Promise<{ ok: boolean; result?: string; error?: string }>
  mcpReload: (rootPath: string) => Promise<{ ok: boolean; error?: string }>
  mcpToolDefinitions: () => Promise<import('@shared/types').ToolDefinition[]>

  // App
  getPath: (name: string) => Promise<string>
  getPlatform: () => Promise<string>
  resolveEnvVar: (name: string) => Promise<string>
  getVersion: () => Promise<string>
  getLocale: () => Promise<string>

  // Auto Update
  checkForUpdate: () => Promise<{ state: string; version?: string; message?: string }>
  downloadUpdate: () => Promise<{ state: string }>
  installUpdate: () => void
  onUpdateStatus: (callback: (status: { state: string; version?: string; message?: string }) => void) => () => void
  onUpdateProgress: (callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
