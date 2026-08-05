import { contextBridge, ipcRenderer } from 'electron'
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

  // Crypto (Export/Import)
  encryptForExport: (text: string, password: string) => ipcRenderer.invoke('crypto:encryptForExport', text, password),
  decryptForImport: (encryptedData: string, password: string) => ipcRenderer.invoke('crypto:decryptForImport', encryptedData, password),

  // Dialog
  openFolder: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER),
  openFile: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FILE),
  saveFile: (defaultPath?: string) => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, defaultPath),

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

  // App
  getPath: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_PATH, name),
  getPlatform: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_PLATFORM),
  resolveEnvVar: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.APP_RESOLVE_ENV_VAR, name),
  getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),

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
