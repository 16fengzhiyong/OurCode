import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS } from '../shared/constants'

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // File System
  readFile: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.FS_READ_FILE, path),
  writeFile: (path: string, content: string, encoding: string, hasBom?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.FS_WRITE_FILE, path, content, encoding, hasBom),
  openFileStream: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.FS_OPEN_STREAM, path),
  readFileChunk: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.FS_READ_CHUNK, id),
  readFileChunkBatch: (id: number, maxBytes?: number) => ipcRenderer.invoke(IPC_CHANNELS.FS_READ_CHUNK_BATCH, id, maxBytes),
  closeFileStream: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.FS_CLOSE_STREAM, id),
  openWriteStream: (path: string, encoding: string, hasBom?: boolean) => ipcRenderer.invoke(IPC_CHANNELS.FS_OPEN_WRITE_STREAM, path, encoding, hasBom),
  writeChunk: (id: number, chunk: string) => ipcRenderer.invoke(IPC_CHANNELS.FS_WRITE_CHUNK, id, chunk),
  closeWriteStream: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.FS_CLOSE_WRITE_STREAM, id),
  abortWriteStream: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.FS_ABORT_WRITE_STREAM, id),
  listDir: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.FS_LIST_DIR, path),
  createFile: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.FS_CREATE_FILE, path),
  createDir: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.FS_CREATE_DIR, path),
  rename: (oldPath: string, newPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.FS_RENAME, oldPath, newPath),
  delete: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.FS_DELETE, path),
  stat: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.FS_STAT, path),
  watch: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.FS_WATCH, path),
  unwatch: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.FS_UNWATCH, path),
  openInFinder: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.FS_OPEN_IN_FINDER, path),
  copyPath: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.FS_COPY_PATH, path),
  copy: (src: string, dest: string) => ipcRenderer.invoke(IPC_CHANNELS.FS_COPY, src, dest),
  move: (src: string, dest: string) => ipcRenderer.invoke(IPC_CHANNELS.FS_MOVE, src, dest),

  // Hot-exit backups
  saveBackup: (filePath: string, content: string, encoding: string, hasBom?: boolean) =>
    ipcRenderer.invoke('backup:save', filePath, content, encoding, hasBom),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  readBackup: (filePath: string) => ipcRenderer.invoke('backup:read', filePath),
  deleteBackup: (filePath: string) => ipcRenderer.invoke('backup:delete', filePath),
  clearBackups: () => ipcRenderer.invoke('backup:clearAll'),

  // LSP
  lspStart: (uri: string, command: string, args: string[], cwd: string, languageId: string, text: string) =>
    ipcRenderer.invoke('lsp:start', uri, command, args, cwd, languageId, text),
  lspDidChange: (uri: string, version: number, text: string) =>
    ipcRenderer.invoke('lsp:didChange', uri, version, text),
  lspStop: (uri: string) => ipcRenderer.invoke('lsp:stop', uri),
  onLspDiagnostics: (callback: (payload: { uri: string; diagnostics: Array<Record<string, unknown>> }) => void) => {
    ipcRenderer.on('lsp:diagnostics', (_event, payload) => callback(payload))
    return () => { ipcRenderer.removeAllListeners('lsp:diagnostics') }
  },

  // Debug Adapter Protocol
  debugStart: (command: string, args: string[], cwd: string, launchConfig: Record<string, unknown>, breakpoints: Array<{ path: string; line: number }>) =>
    ipcRenderer.invoke('debug:start', command, args, cwd, launchConfig, breakpoints),
  debugSetBreakpoints: (path: string, lines: number[]) => ipcRenderer.invoke('debug:setBreakpoints', path, lines),
  debugContinue: () => ipcRenderer.invoke('debug:continue'),
  debugPause: () => ipcRenderer.invoke('debug:pause'),
  debugStepOver: () => ipcRenderer.invoke('debug:stepOver'),
  debugStepInto: () => ipcRenderer.invoke('debug:stepInto'),
  debugStepOut: () => ipcRenderer.invoke('debug:stepOut'),
  debugStop: () => ipcRenderer.invoke('debug:stop'),
  onDebugEvent: (event: 'stopped' | 'output' | 'terminated', callback: (body: Record<string, unknown>) => void) => {
    ipcRenderer.on(`debug:${event}`, (_e, body) => callback(body))
    return () => { ipcRenderer.removeAllListeners(`debug:${event}`) }
  },
  onFileChanged: (callback: (path: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.FS_FILE_CHANGED, (_event, path) => callback(path))
    return () => {
      ipcRenderer.removeAllListeners(IPC_CHANNELS.FS_FILE_CHANGED)
    }
  },

  // Store
  getConfigGroups: () => ipcRenderer.invoke(IPC_CHANNELS.STORE_GET_CONFIG_GROUPS),
  saveConfigGroup: (group: any) => ipcRenderer.invoke(IPC_CHANNELS.STORE_SAVE_CONFIG_GROUP, group),
  deleteConfigGroup: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.STORE_DELETE_CONFIG_GROUP, id),
  getSessions: () => ipcRenderer.invoke(IPC_CHANNELS.STORE_GET_SESSIONS),
  saveSession: (session: any) => ipcRenderer.invoke(IPC_CHANNELS.STORE_SAVE_SESSION, session),
  deleteSession: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.STORE_DELETE_SESSION, id),
  getPreferences: () => ipcRenderer.invoke(IPC_CHANNELS.STORE_GET_PREFERENCES),
  savePreferences: (prefs: any) => ipcRenderer.invoke(IPC_CHANNELS.STORE_SAVE_PREFERENCES, prefs),
  resetAll: () => ipcRenderer.invoke('store:resetAll'),

  // Usage statistics
  recordUsage: (events: any[]) => ipcRenderer.invoke(IPC_CHANNELS.USAGE_RECORD, events),
  getUsageSummary: (rangeDays?: number) => ipcRenderer.invoke(IPC_CHANNELS.USAGE_SUMMARY, rangeDays),
  clearUsage: () => ipcRenderer.invoke(IPC_CHANNELS.USAGE_CLEAR),

  // Crypto (Export/Import)
  encryptForExport: (text: string, password: string) => ipcRenderer.invoke('crypto:encryptForExport', text, password),
  decryptForImport: (encryptedData: string, password: string) => ipcRenderer.invoke('crypto:decryptForImport', encryptedData, password),

  // Dialog
  openFolder: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER),
  openFile: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FILE),
  saveFile: (defaultPath?: string) => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, defaultPath),

  // Drag & drop — resolve the absolute path of a file dropped from the OS
  // (renderer can't read File.path directly; webUtils must run in preload)
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  // Window
  minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
  maximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),
  close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
  isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),
  openDevTools: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_DEV_TOOLS),
  openNewWindow: () => ipcRenderer.invoke('window:openNewWindow'),
  onMaximized: (callback: (isMaximized: boolean) => void) => {
    ipcRenderer.on('window:maximized', (_event, isMaximized) => callback(isMaximized))
    return () => {
      ipcRenderer.removeAllListeners('window:maximized')
    }
  },

  // Terminal
  termCreate: (id: string, cwd?: string) => ipcRenderer.invoke(IPC_CHANNELS.TERM_CREATE, id, cwd),
  termWrite: (id: string, data: string) => ipcRenderer.invoke(IPC_CHANNELS.TERM_WRITE, id, data),
  termResize: (id: string, cols: number, rows: number) => ipcRenderer.invoke(IPC_CHANNELS.TERM_RESIZE, id, cols, rows),
  termDispose: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.TERM_DISPOSE, id),
  onTermData: (id: string, callback: (data: string) => void) => {
    const channel = `${IPC_CHANNELS.TERM_DATA}:${id}`
    ipcRenderer.on(channel, (_event, data) => callback(data))
    return () => { ipcRenderer.removeAllListeners(channel) }
  },
  onTermExit: (id: string, callback: (code: number) => void) => {
    const channel = `${IPC_CHANNELS.TERM_EXIT}:${id}`
    ipcRenderer.on(channel, (_event, code) => callback(code))
    return () => { ipcRenderer.removeAllListeners(channel) }
  },

  // Search
  searchInFiles: (dirPath: string, query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean; filePattern?: string; excludeFolders?: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.SEARCH_IN_FILES, dirPath, query, options),
  searchFiles: (dirPath: string, query: string) => ipcRenderer.invoke('search:files', dirPath, query),

  // Git
  gitExec: (cwd: string, args: string[]) => ipcRenderer.invoke(IPC_CHANNELS.GIT_EXEC, cwd, args),

  // Shell
  shellExec: (command: string, cwd?: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_EXEC, command, cwd),

  // Web fetch (web_search / read_url tools)
  webFetch: (url: string, options?: { timeoutMs?: number; maxBytes?: number }) =>
    ipcRenderer.invoke('web:fetch', url, options),

  // LLM HTTP bridge — main-process net.fetch (no CORS), supports streaming
  llmHttp: (req: {
    id: string
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
    stream?: boolean
    timeoutMs?: number
    /** Skip TLS certificate verification for this request (unsaved draft configs). */
    skipTlsVerify?: boolean
  }) => ipcRenderer.invoke('llm:http', req),
  llmHttpAbort: (id: string) => ipcRenderer.send('llm:httpAbort', id),
  onLlmHttpHeaders: (callback: (payload: { id: string; ok: boolean; status: number; statusText: string; headers: Record<string, string> }) => void) => {
    const listener = (_event: any, payload: any) => callback(payload)
    ipcRenderer.on('llm:httpHeaders', listener)
    return () => { ipcRenderer.removeListener('llm:httpHeaders', listener) }
  },
  onLlmHttpChunk: (callback: (payload: { id: string; data: string }) => void) => {
    const listener = (_event: any, payload: any) => callback(payload)
    ipcRenderer.on('llm:httpChunk', listener)
    return () => { ipcRenderer.removeListener('llm:httpChunk', listener) }
  },
  onLlmHttpDone: (callback: (payload: { id: string }) => void) => {
    const listener = (_event: any, payload: any) => callback(payload)
    ipcRenderer.on('llm:httpDone', listener)
    return () => { ipcRenderer.removeListener('llm:httpDone', listener) }
  },
  onLlmHttpError: (callback: (payload: { id: string; message: string }) => void) => {
    const listener = (_event: any, payload: any) => callback(payload)
    ipcRenderer.on('llm:httpError', listener)
    return () => { ipcRenderer.removeListener('llm:httpError', listener) }
  },

  // Memories
  memoryList: () => ipcRenderer.invoke('memory:list'),
  memoryAdd: (content: string, scope?: string, projectPath?: string) =>
    ipcRenderer.invoke('memory:add', content, scope, projectPath),
  memoryDelete: (id: string) => ipcRenderer.invoke('memory:delete', id),

  // Workflows
  workflowList: () => ipcRenderer.invoke('workflow:list'),
  workflowAdd: (workflow: { name: string; description?: string; prompt: string }) => ipcRenderer.invoke('workflow:add', workflow),
  workflowDelete: (id: string) => ipcRenderer.invoke('workflow:delete', id),

  // Checkpoints
  checkpointList: (sessionId: string) => ipcRenderer.invoke('checkpoint:list', sessionId),
  checkpointCreate: (checkpoint: any) => ipcRenderer.invoke('checkpoint:create', checkpoint),
  checkpointDelete: (sessionId: string) => ipcRenderer.invoke('checkpoint:delete', sessionId),
  checkpointRevert: (checkpointId: string) => ipcRenderer.invoke('checkpoint:revert', checkpointId),

  // MCP
  mcpListTools: () => ipcRenderer.invoke('mcp:listTools'),
  mcpCallTool: (server: string, toolName: string, args: Record<string, any>) =>
    ipcRenderer.invoke('mcp:callTool', server, toolName, args),
  mcpReload: (rootPath: string) => ipcRenderer.invoke('mcp:reload', rootPath),
  mcpGetConfig: (rootPath: string) => ipcRenderer.invoke('mcp:getConfig', rootPath),
  mcpSaveConfig: (rootPath: string, config: { mcpServers: Record<string, any> }, file?: string | null) =>
    ipcRenderer.invoke('mcp:saveConfig', rootPath, config, file),
  mcpToolDefinitions: () => ipcRenderer.invoke('mcp:toolDefinitions'),
  mcpListResources: () => ipcRenderer.invoke('mcp:listResources'),
  mcpReadResource: (server: string, uri: string) => ipcRenderer.invoke('mcp:readResource', server, uri),
  mcpListPrompts: () => ipcRenderer.invoke('mcp:listPrompts'),
  mcpGetPrompt: (server: string, name: string, args?: Record<string, any>) =>
    ipcRenderer.invoke('mcp:getPrompt', server, name, args),

  // App
  getPath: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_PATH, name),
  getPlatform: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_PLATFORM),
  resolveEnvVar: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.APP_RESOLVE_ENV_VAR, name),
  getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
  getLocale: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_LOCALE),

  // Auto Update
  checkForUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK),
  downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_DOWNLOAD),
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_INSTALL),
  onUpdateStatus: (callback: (status: { state: string; version?: string; releaseNotes?: string; releaseDate?: string; message?: string }) => void) => {
    ipcRenderer.on(IPC_CHANNELS.UPDATE_STATUS, (_event, status) => callback(status))
    return () => { ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_STATUS) }
  },
  onUpdateProgress: (callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => {
    ipcRenderer.on(IPC_CHANNELS.UPDATE_PROGRESS, (_event, progress) => callback(progress))
    return () => { ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_PROGRESS) }
  },
})
