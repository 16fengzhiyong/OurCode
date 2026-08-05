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

  // App
  getPath: (name: string) => Promise<string>
  getPlatform: () => Promise<string>
  resolveEnvVar: (name: string) => Promise<string>
  getVersion: () => Promise<string>

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
