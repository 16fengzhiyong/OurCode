import { app, BrowserWindow, ipcMain, dialog, shell, clipboard, net, type WebContents, type IpcMainInvokeEvent } from 'electron'
import { join, resolve, dirname, sep } from 'path'
import { existsSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { exec, execFile } from 'child_process'
import * as pty from 'node-pty'
import picomatch from 'picomatch'
import { autoUpdater, UpdateInfo } from 'electron-updater'
import { FileSystemService } from './services/file-system'
import { SQLiteStore } from './services/sqlite-store'
import { BackupService } from './services/backup'
import { LspServer } from './services/lsp'
import { DebugAdapterClient } from './services/debug'
import { MCPManager, extractMcpText, toMcpToolDefinition } from './services/mcp-manager'

const DEFAULT_EXCLUDE_FOLDERS = ['node_modules', '.git', 'dist', 'build', 'out']

// Files larger than this are skipped by search:inFiles (reading + splitting a
// multi-hundred-MB file to search it would block the main process)
const SEARCH_MAX_FILE_BYTES = 50 * 1024 * 1024

/**
 * Paths the renderer is allowed to touch. Populated from the dialogs that the
 * user explicitly opened (open folder / open file / save file) and the watched
 * project root. Every fs:* handler validates against this allowlist so that a
 * compromised renderer (e.g. via the Markdown surface) cannot read/write/delete
 * arbitrary files outside what the user opened.
 */
const allowedRoots: Set<string> = new Set()

function normalizePath(p: string): string {
  return resolve(p)
}

/** Register a directory (and everything under it) as accessible to the renderer */
function registerRoot(p: string): void {
  if (!p) return
  allowedRoots.add(normalizePath(p))
}

/** Check whether a path is inside any registered root */
function isPathAllowed(p: string): boolean {
  const normalized = normalizePath(p)
  for (const root of allowedRoots) {
    if (normalized === root || normalized.startsWith(root + sep)) return true
  }
  return false
}

/** Throw if the path is outside every registered root */
function assertPathAllowed(p: string): void {
  if (!isPathAllowed(p)) {
    throw new Error(`路径不在允许范围内: ${p}`)
  }
}

/** Validate an environment variable name (only plain identifiers may be resolved) */
function isSafeEnvVarName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
}

/** Execute a git command and return stdout */
function gitExec(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 15000, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message))
      } else {
        resolve(stdout.trim())
      }
    })
  })
}

let mainWindow: BrowserWindow | null = null
const allWindows: Set<BrowserWindow> = new Set()
let fileSystem: FileSystemService
let store: SQLiteStore
let backup: BackupService
let mcp: MCPManager

// Language servers by document URI (one per open file)
const lspServers = new Map<string, LspServer>()

// Active debug session (single, like VS Code's launch)
let debugClient: DebugAdapterClient | null = null

/** Broadcast a debug event to all windows. */
function emitDebugEvent(event: string, body: unknown): void {
  broadcast(`debug:${event}`, body)
}

/** Stop and clear the active debug session. */
async function stopDebugSession(): Promise<void> {
  if (!debugClient) return
  const client = debugClient
  debugClient = null
  await client.stop().catch(() => {})
}

/** Stop and remove the language server for a document (if any). */
async function lspStop(uri: string): Promise<void> {
  const server = lspServers.get(uri)
  if (server) {
    lspServers.delete(uri)
    await server.stop().catch(() => {})
  }
}

/** Stop every language server (app shutdown). */
async function stopAllLspServers(): Promise<void> {
  await Promise.all(Array.from(lspServers.keys()).map((uri) => lspStop(uri)))
}

interface TerminalSession {
  pty: pty.IPty
  webContents: WebContents
}
const terminals = new Map<string, TerminalSession>()

/** Broadcast a message to every open window */
function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of allWindows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  }
}

/** Target the window that sent an IPC request (supports multiple windows) */
function windowFromEvent(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

/** Per-window lifecycle: maximize state push + terminal cleanup on close */
function attachWindowLifecycle(win: BrowserWindow): void {
  // Capture eagerly — accessing win.webContents after 'closed' throws "Object has been destroyed"
  const wcId = win.webContents.id
  win.on('maximize', () => {
    if (!win.isDestroyed()) win.webContents.send('window:maximized', true)
  })
  win.on('unmaximize', () => {
    if (!win.isDestroyed()) win.webContents.send('window:maximized', false)
  })
  win.on('closed', () => {
    // Kill terminals owned by this window
    for (const [id, t] of terminals) {
      if (t.webContents.id === wcId) {
        t.pty.kill()
        terminals.delete(id)
      }
    }
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      // Renderers are sandboxed (like VS Code): the preload only uses the
      // sandbox-whitelisted electron APIs (contextBridge/ipcRenderer), so a
      // compromised renderer cannot reach Node.js primitives directly.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Open devtools in development
  if (is.dev) {
    mainWindow.webContents.openDevTools()
  }

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, 'renderer/index.html'))
  }

  attachWindowLifecycle(mainWindow)

  allWindows.add(mainWindow!)
  mainWindow!.on('closed', () => {
    allWindows.delete(mainWindow!)
    mainWindow = null
  })
}

function createNewWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, 'renderer/index.html'))
  }

  attachWindowLifecycle(win)

  allWindows.add(win)
  win.on('closed', () => {
    allWindows.delete(win)
  })
}

// Register IPC handlers
function registerIpcHandlers(): void {
  // File System handlers
  ipcMain.handle('fs:readFile', async (_event, path: string) => {
    assertPathAllowed(path)
    return fileSystem.readFile(path)
  })

  ipcMain.handle('fs:writeFile', async (_event, path: string, content: string, encoding: string, hasBom?: boolean) => {
    assertPathAllowed(path)
    return fileSystem.writeFile(path, content, encoding, hasBom)
  })

  ipcMain.handle('fs:openStream', async (_event, path: string) => {
    assertPathAllowed(path)
    return fileSystem.openStream(path)
  })

  ipcMain.handle('fs:readChunk', async (_event, id: number) => {
    return fileSystem.readNext(id)
  })

  ipcMain.handle('fs:readChunkBatch', async (_event, id: number, maxBytes?: number) => {
    return fileSystem.readBatch(id, maxBytes)
  })

  ipcMain.handle('fs:closeStream', async (_event, id: number) => {
    return fileSystem.closeStream(id)
  })

  ipcMain.handle('fs:openWriteStream', async (_event, path: string, encoding: string, hasBom?: boolean) => {
    assertPathAllowed(path)
    return fileSystem.openWriteStream(path, encoding, hasBom)
  })

  ipcMain.handle('fs:writeChunk', async (_event, id: number, chunk: string) => {
    return fileSystem.writeChunk(id, chunk)
  })

  ipcMain.handle('fs:closeWriteStream', async (_event, id: number) => {
    return fileSystem.closeWriteStream(id)
  })

  ipcMain.handle('fs:abortWriteStream', async (_event, id: number) => {
    return fileSystem.abortWriteStream(id)
  })

  ipcMain.handle('fs:listDir', async (_event, path: string) => {
    assertPathAllowed(path)
    return fileSystem.listDir(path)
  })

  ipcMain.handle('fs:createFile', async (_event, path: string) => {
    assertPathAllowed(path)
    return fileSystem.createFile(path)
  })

  ipcMain.handle('fs:createDir', async (_event, path: string) => {
    assertPathAllowed(path)
    return fileSystem.createDir(path)
  })

  ipcMain.handle('fs:rename', async (_event, oldPath: string, newPath: string) => {
    assertPathAllowed(oldPath)
    assertPathAllowed(newPath)
    return fileSystem.rename(oldPath, newPath)
  })

  ipcMain.handle('fs:delete', async (_event, path: string) => {
    assertPathAllowed(path)
    return fileSystem.delete(path)
  })

  ipcMain.handle('fs:stat', async (_event, path: string) => {
    assertPathAllowed(path)
    return fileSystem.stat(path)
  })

  ipcMain.handle('fs:watch', async (_event, path: string) => {
    registerRoot(path)
    fileSystem.watch(path, (changedPath) => {
      // Notify all windows watching this project
      broadcast('fs:fileChanged', changedPath)
    })
    // Loading a workspace also (re)loads its MCP servers
    try {
      await mcp.loadConfig(path)
    } catch (error: any) {
      console.error('MCP 配置加载失败:', error.message)
    }
  })

  ipcMain.handle('fs:unwatch', async (_event, path: string) => {
    fileSystem.unwatch(path)
  })

  ipcMain.handle('fs:openInFinder', async (_event, path: string) => {
    assertPathAllowed(path)
    shell.showItemInFolder(path)
  })

  ipcMain.handle('fs:copyPath', async (_event, path: string) => {
    clipboard.writeText(path)
  })

  ipcMain.handle('fs:copy', async (_event, src: string, dest: string) => {
    assertPathAllowed(src)
    assertPathAllowed(dest)
    return fileSystem.copy(src, dest)
  })

  ipcMain.handle('fs:move', async (_event, src: string, dest: string) => {
    assertPathAllowed(src)
    assertPathAllowed(dest)
    return fileSystem.move(src, dest)
  })

  // Hot-exit backups (unsaved dirty buffers mirrored off the real file)
  ipcMain.handle('backup:save', async (_event, filePath: string, content: string, encoding: string, hasBom?: boolean) => {
    return backup.save(filePath, content, encoding, Boolean(hasBom))
  })

  ipcMain.handle('backup:list', async () => {
    return backup.list()
  })

  ipcMain.handle('backup:read', async (_event, filePath: string) => {
    return backup.read(filePath)
  })

  ipcMain.handle('backup:delete', async (_event, filePath: string) => {
    return backup.delete(filePath)
  })

  ipcMain.handle('backup:clearAll', async () => {
    return backup.clearAll()
  })

  // LSP: start a language server for a document, push diagnostics back
  ipcMain.handle('lsp:start', async (_event, uri: string, command: string, args: string[], cwd: string, languageId: string, text: string) => {
    await lspStop(uri)
    const server = new LspServer()
    server.onDiagnostics = (params) => {
      broadcast('lsp:diagnostics', { uri: params.uri, diagnostics: params.diagnostics })
    }
    server.onStderr = (line) => {
      if (is.dev) console.debug(`[lsp:${languageId}]`, line.trimEnd())
    }
    try {
      await server.start({ command, args, cwd })
      server.didOpen(uri, languageId, text)
      lspServers.set(uri, server)
      return { ok: true as const }
    } catch (error) {
      await server.stop().catch(() => {})
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('lsp:didChange', async (_event, uri: string, version: number, text: string) => {
    lspServers.get(uri)?.didChange(uri, text, version)
  })

  ipcMain.handle('lsp:stop', async (_event, uri: string) => {
    await lspStop(uri)
  })

  // DAP: single debug session
  ipcMain.handle('debug:start', async (_event, command: string, args: string[], cwd: string, launchConfig: Record<string, unknown>, breakpoints: Array<{ path: string; line: number }>) => {
    await stopDebugSession()
    const client = new DebugAdapterClient()
    client.onStopped = (body) => emitDebugEvent('stopped', body)
    client.onOutput = (body) => emitDebugEvent('output', body)
    client.onTerminated = (body) => {
      emitDebugEvent('terminated', body)
      void stopDebugSession()
    }
    client.onStderr = (line) => {
      if (is.dev) console.debug('[dap]', line.trimEnd())
    }
    try {
      await client.start(command, args, cwd)
      debugClient = client
      // Group breakpoints by file
      const byFile = new Map<string, number[]>()
      for (const bp of breakpoints) {
        const list = byFile.get(bp.path) ?? []
        list.push(bp.line)
        byFile.set(bp.path, list)
      }
      for (const [path, lines] of byFile) {
        await client.setBreakpoints(path, lines)
      }
      await client.launch(launchConfig)
      await client.configurationDone()
      await client.continueReq()
      return { ok: true as const }
    } catch (error) {
      await client.stop().catch(() => {})
      debugClient = null
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('debug:setBreakpoints', async (_event, path: string, lines: number[]) => {
    if (!debugClient) return
    await debugClient.setBreakpoints(path, lines)
  })

  ipcMain.handle('debug:continue', async () => {
    await debugClient?.continueReq()
  })

  ipcMain.handle('debug:pause', async () => {
    await debugClient?.pause()
  })

  ipcMain.handle('debug:stepOver', async () => {
    await debugClient?.stepOver()
  })

  ipcMain.handle('debug:stepInto', async () => {
    await debugClient?.stepInto()
  })

  ipcMain.handle('debug:stepOut', async () => {
    await debugClient?.stepOut()
  })

  ipcMain.handle('debug:stop', async () => {
    await stopDebugSession()
  })

  // Store handlers
  ipcMain.handle('store:getConfigGroups', async () => {
    return store.getConfigGroups()
  })

  ipcMain.handle('store:saveConfigGroup', async (_event, group) => {
    return store.saveConfigGroup(group)
  })

  ipcMain.handle('store:deleteConfigGroup', async (_event, id: string) => {
    return store.deleteConfigGroup(id)
  })

  ipcMain.handle('crypto:encryptForExport', async (_event, text: string, password: string) => {
    return store.getCrypto().encryptForExport(text, password)
  })

  ipcMain.handle('crypto:decryptForImport', async (_event, encryptedData: string, password: string) => {
    return store.getCrypto().decryptForImport(encryptedData, password)
  })

  ipcMain.handle('store:getSessions', async () => {
    return store.getSessions()
  })

  ipcMain.handle('store:saveSession', async (_event, session) => {
    return store.saveSession(session)
  })

  ipcMain.handle('store:deleteSession', async (_event, id: string) => {
    return store.deleteSession(id)
  })

  ipcMain.handle('store:getPreferences', async () => {
    return store.getPreferences()
  })

  ipcMain.handle('store:savePreferences', async (_event, prefs) => {
    return store.savePreferences(prefs)
  })

  ipcMain.handle('store:resetAll', async () => {
    store.resetAll()
  })

  // Dialog handlers
  ipcMain.handle('dialog:openFolder', async (event) => {
    const result = await dialog.showOpenDialog(windowFromEvent(event) ?? mainWindow!, {
      properties: ['openDirectory'],
    })
    const selected = result.canceled ? null : result.filePaths[0]
    if (selected) registerRoot(selected)
    return selected
  })

  ipcMain.handle('dialog:openFile', async (event) => {
    const result = await dialog.showOpenDialog(windowFromEvent(event) ?? mainWindow!, {
      properties: ['openFile'],
    })
    const selected = result.canceled ? null : result.filePaths[0]
    if (selected) registerRoot(dirname(selected))
    return selected
  })

  ipcMain.handle('dialog:saveFile', async (event, defaultPath?: string) => {
    const result = await dialog.showSaveDialog(windowFromEvent(event) ?? mainWindow!, {
      defaultPath,
    })
    const selected = result.canceled ? null : result.filePath
    if (selected) registerRoot(dirname(selected))
    return selected
  })

  // Window handlers (target the window that sent the request)
  ipcMain.handle('window:minimize', (event) => {
    windowFromEvent(event)?.minimize()
  })

  ipcMain.handle('window:maximize', (event) => {
    const win = windowFromEvent(event)
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  ipcMain.handle('window:close', (event) => {
    windowFromEvent(event)?.close()
  })

  ipcMain.handle('window:isMaximized', (event) => {
    return windowFromEvent(event)?.isMaximized() ?? false
  })

  ipcMain.handle('window:openDevTools', (event) => {
    windowFromEvent(event)?.webContents.openDevTools()
  })

  ipcMain.handle('window:openNewWindow', () => {
    createNewWindow()
  })

  // Terminal handlers (each terminal belongs to the window that created it)
  ipcMain.handle('term:create', (event, id: string, cwd?: string) => {
    const wc = event.sender
    const shellName = process.platform === 'win32' ? 'powershell.exe' : 'bash'
    const term = pty.spawn(shellName, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd || process.cwd(),
      env: { ...process.env } as Record<string, string>,
    })

    term.onData((data) => {
      if (!wc.isDestroyed()) wc.send(`term:data:${id}`, data)
    })

    term.onExit(({ exitCode }) => {
      if (!wc.isDestroyed()) wc.send(`term:exit:${id}`, exitCode)
      terminals.delete(id)
    })

    terminals.set(id, { pty: term, webContents: wc })
  })

  ipcMain.handle('term:write', (_event, id: string, data: string) => {
    terminals.get(id)?.pty.write(data)
  })

  ipcMain.handle('term:resize', (_event, id: string, cols: number, rows: number) => {
    terminals.get(id)?.pty.resize(cols, rows)
  })

  ipcMain.handle('term:dispose', (_event, id: string) => {
    const t = terminals.get(id)
    if (t) {
      t.pty.kill()
      terminals.delete(id)
    }
  })

  // Search in files handler
  ipcMain.handle('search:inFiles', async (_event, dirPath: string, query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean; filePattern?: string; excludeFolders?: string }) => {
    assertPathAllowed(dirPath)
    const results: Array<{ filePath: string; fileName: string; lineNumber: number; lineContent: string; matchStart: number; matchEnd: number }> = []
    const maxResults = 500

    // Build exclude folder list
    const userExcludes = options?.excludeFolders
      ? options.excludeFolders.split(',').map(s => s.trim()).filter(Boolean)
      : []
    const excludeSet = new Set([...DEFAULT_EXCLUDE_FOLDERS, ...userExcludes])

    // Build file pattern matcher
    const filePatterns = options?.filePattern
      ? options.filePattern.split(',').map(s => s.trim()).filter(Boolean)
      : null
    const fileMatcher = filePatterns ? picomatch(filePatterns) : null

    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    const searchInFile = async (filePath: string) => {
      try {
        const { content } = await fileSystem.readFile(filePath)
        const lines = content.split('\n')
        const fileName = filePath.split(/[\\/]/).pop() || ''

        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
          const line = lines[i]
          let match: RegExpExecArray | null = null

          if (options?.regex) {
            try {
              const flags = options?.caseSensitive ? 'g' : 'gi'
              const re = new RegExp(query, flags)
              match = re.exec(line)
            } catch { /* invalid regex */ }
          } else {
            const escaped = escapeRegExp(query)
            const pattern = options?.wholeWord ? `\\b${escaped}\\b` : escaped
            const flags = options?.caseSensitive ? 'g' : 'gi'
            const re = new RegExp(pattern, flags)
            match = re.exec(line)
          }

          if (match) {
            results.push({
              filePath,
              fileName,
              lineNumber: i + 1,
              lineContent: line.trim(),
              matchStart: match.index,
              matchEnd: match.index + match[0].length,
            })
          }
        }
      } catch { /* skip unreadable files */ }
    }

    const walkDir = async (dir: string) => {
      if (results.length >= maxResults) return
      try {
        const entries = await fileSystem.listDir(dir)
        for (const entry of entries) {
          if (results.length >= maxResults) return
          if (entry.isHidden) continue
          if (entry.isDirectory) {
            // Skip excluded folder names
            const dirName = entry.name || entry.path.split(/[\\/]/).pop() || ''
            if (excludeSet.has(dirName)) continue
            await walkDir(entry.path)
          } else {
            // Apply file pattern filter
            if (fileMatcher && !fileMatcher(entry.name || '')) continue
            // Skip huge files — reading + splitting them to search would freeze
            // the main process
            if ((entry.size ?? 0) > SEARCH_MAX_FILE_BYTES) continue
            await searchInFile(entry.path)
          }
        }
      } catch { /* skip inaccessible dirs */ }
    }

    await walkDir(dirPath)
    return results
  })

  // Search files by name (used by @-references in the chat input)
  ipcMain.handle('search:files', async (_event, dirPath: string, query: string) => {
    assertPathAllowed(dirPath)
    const results: string[] = []
    const maxResults = 50
    const lowerQuery = (query || '').toLowerCase()

    if (!lowerQuery) return results

    const walkDir = async (dir: string) => {
      if (results.length >= maxResults) return
      try {
        const entries = await fileSystem.listDir(dir)
        for (const entry of entries) {
          if (results.length >= maxResults) return
          if (entry.isHidden) continue
          if (entry.isDirectory) {
            const dirName = entry.name || entry.path.split(/[\\/]/).pop() || ''
            if (DEFAULT_EXCLUDE_FOLDERS.includes(dirName)) continue
            await walkDir(entry.path)
          } else {
            const fileName = entry.name || ''
            if (fileName.toLowerCase().includes(lowerQuery)) {
              results.push(entry.path)
            }
          }
        }
      } catch { /* skip inaccessible dirs */ }
    }

    await walkDir(dirPath)
    return results
  })

  // Environment variable resolver
  ipcMain.handle('app:resolveEnvVar', (_event, name: string) => {
    if (!isSafeEnvVarName(name)) return ''
    return process.env[name] || ''
  })

  // ───────────────────── Web fetch (web_search / read_url tools) ─────────────────────
  // Only http(s) URLs may be fetched (no file://, no arbitrary schemes), with a
  // hard size cap so a hostile endpoint cannot balloon main-process memory.
  const MAX_WEB_BYTES = 2 * 1024 * 1024

  ipcMain.handle('web:fetch', async (_event, url: string, options?: { timeoutMs?: number; maxBytes?: number }) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { ok: false, error: '无效的 URL' }
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, error: '仅支持 http/https URL' }
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options?.timeoutMs || 15000)
    try {
      const res = await net.fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'user-agent': 'OurCode-ide/0.1', 'accept': 'text/html,text/plain,*/*' },
      })
      const sizeLimit = options?.maxBytes || MAX_WEB_BYTES
      const contentLength = Number(res.headers.get('content-length') || 0)
      if (contentLength > sizeLimit) {
        return { ok: false, status: res.status, error: `响应超过大小上限 (${sizeLimit} bytes)` }
      }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > sizeLimit) {
        return { ok: false, status: res.status, error: `响应超过大小上限 (${sizeLimit} bytes)` }
      }
      return {
        ok: res.ok,
        status: res.status,
        contentType: res.headers.get('content-type') || '',
        finalUrl: res.url || parsed.toString(),
        text: buf.toString('utf-8').slice(0, sizeLimit),
      }
    } catch (error: any) {
      const aborted = controller.signal.aborted
      return { ok: false, error: aborted ? '请求超时' : (error.message || '网络请求失败') }
    } finally {
      clearTimeout(timer)
    }
  })

  // ───────────────────── Memories ─────────────────────
  ipcMain.handle('memory:list', async () => {
    return store.getMemories()
  })

  ipcMain.handle('memory:add', async (_event, content: string, scope: string) => {
    const trimmed = (content || '').trim()
    if (!trimmed) throw new Error('记忆内容不能为空')
    return store.addMemory(trimmed, scope === 'project' ? 'project' : 'global')
  })

  ipcMain.handle('memory:delete', async (_event, id: string) => {
    store.deleteMemory(id)
  })

  // ───────────────────── Workflows ─────────────────────
  ipcMain.handle('workflow:list', async () => {
    return store.getWorkflows()
  })

  ipcMain.handle('workflow:add', async (_event, workflow: { name: string; description?: string; prompt: string }) => {
    if (!workflow?.prompt?.trim()) throw new Error('工作流内容不能为空')
    return store.addWorkflow(workflow)
  })

  ipcMain.handle('workflow:delete', async (_event, id: string) => {
    store.deleteWorkflow(id)
  })

  // ───────────────────── Checkpoints (AI edit snapshots) ─────────────────────
  ipcMain.handle('checkpoint:list', async (_event, sessionId: string) => {
    return store.getCheckpoints(sessionId)
  })

  ipcMain.handle('checkpoint:create', async (_event, checkpoint: any) => {
    if (!checkpoint?.id || !checkpoint?.sessionId) throw new Error('检查点参数不完整')
    return store.addCheckpoint(checkpoint)
  })

  ipcMain.handle('checkpoint:delete', async (_event, sessionId: string) => {
    store.deleteCheckpoints(sessionId)
  })

  // Revert a checkpoint: restore every snapshotted file (or delete it if it
  // didn't exist at snapshot time), then broadcast so open editors reload.
  ipcMain.handle('checkpoint:revert', async (_event, checkpointId: string) => {
    const allSessions = store.getSessions()
    let target: import('../shared/types').Checkpoint | null = null
    for (const session of allSessions) {
      const list = store.getCheckpoints(session.id)
      const found = list.find((c) => c.id === checkpointId)
      if (found) { target = found; break }
    }
    if (!target) return { ok: false, error: '检查点不存在' }

    let restored = 0
    for (const file of target.files) {
      try {
        if (file.existed) {
          await fileSystem.writeFile(file.path, file.content, 'utf-8', false)
        } else if (existsSync(file.path)) {
          await fileSystem.delete(file.path)
        }
        restored++
      } catch (error: any) {
        console.error(`回滚 ${file.path} 失败:`, error.message)
      }
    }
    // Notify open editors to reload the changed files
    for (const file of target.files) {
      broadcast('fs:fileChanged', file.path)
    }
    return { ok: true, restored }
  })

  // ───────────────────── MCP (Model Context Protocol) ─────────────────────
  ipcMain.handle('mcp:listTools', async () => {
    return mcp.listTools()
  })

  ipcMain.handle('mcp:callTool', async (_event, server: string, toolName: string, args: Record<string, any>) => {
    try {
      const result = await mcp.callTool(server, toolName, args || {})
      return { ok: true, result: extractMcpText(result) }
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
  })

  ipcMain.handle('mcp:reload', async (_event, rootPath: string) => {
    try {
      await mcp.loadConfig(rootPath)
      return { ok: true }
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
  })

  // Used by the renderer to build tool definitions for the LLM
  ipcMain.handle('mcp:toolDefinitions', async () => {
    const tools = await mcp.listTools()
    return tools.map((t) => toMcpToolDefinition(t))
  })

  // Git handler
  ipcMain.handle('git:exec', async (_event, cwd: string, args: string[]) => {
    try {
      if (cwd) assertPathAllowed(cwd)
      const result = await gitExec(cwd, args)
      return { success: true, output: result }
    } catch (error: any) {
      return { success: false, output: '', error: error.message }
    }
  })

  // Shell exec handler (for run_command tool)
  ipcMain.handle('shell:exec', async (_event, command: string, cwd?: string) => {
    return new Promise((resolve) => {
      try {
        if (cwd) assertPathAllowed(cwd)
      } catch (error: any) {
        resolve({ success: false, output: '', error: error.message })
        return
      }
      exec(command, {        cwd: cwd || undefined,
        timeout: 30000,
        maxBuffer: 5 * 1024 * 1024,
        shell: process.platform === 'win32' ? 'powershell.exe' : 'bash',
      }, (error: any, stdout: string, stderr: string) => {
        if (error) {
          resolve({ success: false, output: stdout || '', error: stderr || error.message })
        } else {
          resolve({ success: true, output: stdout.trim() })
        }
      })
    })
  })

  // App handlers
  ipcMain.handle('app:getPath', (_event, name: string) => {
    return app.getPath(name as any)
  })

  ipcMain.handle('app:getPlatform', () => {
    return process.platform
  })

  // System locale, used by the renderer to pick the default UI language
  // (the preference defaults to 'system' and resolves against this).
  ipcMain.handle('app:getLocale', () => {
    return app.getLocale()
  })

  // Auto Update handlers
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  if (!is.dev) {
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      broadcast('update:status', {
        state: 'available',
        version: info.version,
        releaseNotes: info.releaseNotes,
        releaseDate: info.releaseDate,
      })
    })

    autoUpdater.on('update-not-available', () => {
      broadcast('update:status', { state: 'not-available' })
    })

    autoUpdater.on('download-progress', (progress) => {
      broadcast('update:progress', {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      })
    })

    autoUpdater.on('update-downloaded', () => {
      broadcast('update:status', { state: 'downloaded' })
    })

    autoUpdater.on('error', (error) => {
      broadcast('update:status', {
        state: 'error',
        message: error.message,
      })
    })
  }

  ipcMain.handle('update:check', async () => {
    if (is.dev) {
      return { state: 'not-available' }
    }
    try {
      const result = await autoUpdater.checkForUpdates()
      if (result) {
        return {
          state: 'available',
          version: result.updateInfo.version,
          releaseNotes: result.updateInfo.releaseNotes,
          releaseDate: result.updateInfo.releaseDate,
        }
      }
      return { state: 'not-available' }
    } catch (error: any) {
      return { state: 'error', message: error.message }
    }
  })

  ipcMain.handle('update:download', async () => {
    if (is.dev) return { state: 'not-available' }
    try {
      await autoUpdater.downloadUpdate()
      return { state: 'downloading' }
    } catch (error: any) {
      return { state: 'error', message: error.message }
    }
  })

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall()
  })

  // App version handler
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion()
  })
}

// Only one instance may run at a time. A second launch (double-click while the
// dev server is up, or a stray `npm run dev`) would fight for the same GPU/disk
// cache in userData — Chromium logs "Unable to move the cache" / "Unable to
// create cache" (ERROR_ACCESS_DENIED, 0x5). Refuse the second instance and
// focus the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// App lifecycle
app.whenReady().then(() => {
  // Initialize services
  const userDataPath = app.getPath('userData')
  fileSystem = new FileSystemService()
  store = new SQLiteStore(userDataPath)
  backup = new BackupService(join(userDataPath, 'backups'))
  mcp = new MCPManager()

  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  mcp?.stopAll()
  void stopAllLspServers()
  void stopDebugSession()
  store.close()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
