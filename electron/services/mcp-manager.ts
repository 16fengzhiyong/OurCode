/**
 * MCP (Model Context Protocol) client — main process.
 *
 * Loads `mcp_config.json` from the workspace root and spawns each configured
 * server as a stdio child process. Communication is JSON-RPC 2.0 over stdio
 * using the MCP framing (newline-delimited JSON; LSP Content-Length framing is
 * also accepted for compatibility). Tool calls are forwarded to the server and
 * merged into the agent's tool list dynamically.
 *
 * Security: servers are user-configured, so their tool calls are trusted. We
 * still spawn without a shell (array args) and cap response sizes.
 */
import { spawn, ChildProcess } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { EventEmitter } from 'events'

export interface McpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  serverUrl?: string
  url?: string
  disabled?: boolean
  disabledTools?: string[]
  headers?: Record<string, string>
}

export interface McpToolInfo {
  server: string
  name: string
  description?: string
  inputSchema?: Record<string, any>
}

interface ServerConnection {
  proc: ChildProcess
  buffer: string
  framing: 'jsonl' | 'lsp'
  pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>
  idCounter: number
  initialized: boolean
}

const REQUEST_TIMEOUT_MS = 30_000
const MAX_MESSAGE_BYTES = 10 * 1024 * 1024

export class MCPManager extends EventEmitter {
  private connections = new Map<string, ServerConnection>()
  private config: Record<string, McpServerConfig> = {}
  private rootPath = ''

  /** Load + start servers from <root>/mcp_config.json */
  async loadConfig(rootPath: string): Promise<void> {
    this.rootPath = rootPath
    this.stopAll()
    this.config = {}

    const candidates = [
      join(rootPath, 'mcp_config.json'),
      join(rootPath, '.mcp.json'),
    ]
    let raw = ''
    for (const file of candidates) {
      if (existsSync(file)) {
        raw = readFileSync(file, 'utf-8')
        break
      }
    }
    if (!raw) return

    try {
      const parsed = JSON.parse(raw)
      this.config = parsed.mcpServers || parsed.servers || {}
    } catch (error: any) {
      this.emit('error', new Error(`mcp_config.json 解析失败: ${error.message}`))
      return
    }

    for (const [name, server] of Object.entries(this.config)) {
      if (server.disabled) continue
      if (server.serverUrl || server.url) {
        this.emit('error', new Error(`MCP 服务器 "${name}" 使用远程传输(SSE)，当前仅支持 stdio 本地服务器`))
        continue
      }
      this.startServer(name, server)
    }
  }

  private startServer(name: string, server: McpServerConfig): void {
    if (!server.command) {
      this.emit('error', new Error(`MCP 服务器 "${name}" 缺少 command`))
      return
    }
    try {
      const proc = spawn(server.command, server.args || [], {
        cwd: this.rootPath || undefined,
        env: { ...process.env, ...(server.env || {}) } as Record<string, string>,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })

      const conn: ServerConnection = {
        proc,
        buffer: '',
        framing: 'jsonl',
        pending: new Map(),
        idCounter: 1,
        initialized: false,
      }
      this.connections.set(name, conn)

      proc.stdout?.on('data', (data: Buffer) => this.onData(name, conn, data.toString('utf-8')))
      proc.stderr?.on('data', (data: Buffer) => {
        // Surfaces server-side logs without crashing anything
        this.emit('serverLog', { server: name, line: data.toString('utf-8').trim() })
      })
      proc.on('error', (error) => {
        this.emit('error', new Error(`MCP 服务器 "${name}" 启动失败: ${error.message}`))
        this.connections.delete(name)
      })
      proc.on('exit', (code) => {
        this.rejectAll(conn, new Error(`MCP 服务器 "${name}" 已退出 (code=${code})`))
        this.connections.delete(name)
      })

      this.initialize(name, conn).catch((error) => {
        this.emit('error', new Error(`MCP 服务器 "${name}" 初始化失败: ${error.message}`))
      })
    } catch (error: any) {
      this.emit('error', new Error(`MCP 服务器 "${name}" 启动失败: ${error.message}`))
    }
  }

  private async initialize(name: string, conn: ServerConnection): Promise<void> {
    const result = await this.request(conn, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'OurCode-ide', version: '0.1.0' },
    })
    void result // serverInfo/capabilities — retained for protocol negotiation
    // Send the initialized notification (no id → notification)
    this.notify(conn, 'notifications/initialized', {})
    conn.initialized = true
    this.emit('ready', { server: name })
  }

  private onData(name: string, conn: ServerConnection, chunk: string): void {
    conn.buffer += chunk
    if (conn.buffer.length > MAX_MESSAGE_BYTES) {
      this.rejectAll(conn, new Error('MCP 消息超过大小上限'))
      return
    }

    // Detect LSP Content-Length framing on first contact
    if (conn.framing === 'jsonl' && conn.buffer.startsWith('Content-Length:')) {
      conn.framing = 'lsp'
    }

    if (conn.framing === 'lsp') {
      this.consumeLsp(name, conn)
    } else {
      this.consumeJsonl(name, conn)
    }
  }

  private consumeJsonl(name: string, conn: ServerConnection): void {
    let idx: number
    while ((idx = conn.buffer.indexOf('\n')) !== -1) {
      const line = conn.buffer.slice(0, idx).trim()
      conn.buffer = conn.buffer.slice(idx + 1)
      if (!line) continue
      try {
        this.handleMessage(conn, JSON.parse(line))
      } catch (error: any) {
        this.emit('error', new Error(`MCP 服务器消息解析失败: ${error.message}`))
      }
    }
  }

  private consumeLsp(name: string, conn: ServerConnection): void {
    // Parse Content-Length headers
    const headerEnd = conn.buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) return
    const headerText = conn.buffer.slice(0, headerEnd)
    const match = /Content-Length:\s*(\d+)/i.exec(headerText)
    if (!match) {
      conn.buffer = conn.buffer.slice(headerEnd + 4)
      return
    }
    const length = parseInt(match[1], 10)
    const bodyStart = headerEnd + 4
    if (conn.buffer.length < bodyStart + length) return
    const body = conn.buffer.slice(bodyStart, bodyStart + length)
    conn.buffer = conn.buffer.slice(bodyStart + length)
    try {
      this.handleMessage(conn, JSON.parse(body))
    } catch (error: any) {
      this.emit('error', new Error(`MCP 服务器消息解析失败: ${error.message}`))
    }
  }

  private handleMessage(conn: ServerConnection, msg: any): void {
    if (!msg || typeof msg !== 'object') return
    if (typeof msg.id === 'number' && conn.pending.has(msg.id)) {
      const { resolve, reject } = conn.pending.get(msg.id)!
      conn.pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message || 'MCP 请求错误'))
      else resolve(msg.result)
    }
    // Notifications (no id) are ignored — e.g. logging from the server
  }

  private request(conn: ServerConnection, method: string, params: any): Promise<any> {
    const id = conn.idCounter++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        conn.pending.delete(id)
        reject(new Error(`MCP 请求超时 (${method})`))
      }, REQUEST_TIMEOUT_MS)
      conn.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      conn.proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  private notify(conn: ServerConnection, method: string, params: any): void {
    conn.proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }

  private rejectAll(conn: ServerConnection, error: Error): void {
    for (const { reject } of conn.pending.values()) {
      reject(error)
    }
    conn.pending.clear()
  }

  /** List every tool across all initialized servers */
  async listTools(): Promise<McpToolInfo[]> {
    const tools: McpToolInfo[] = []
    for (const [name, conn] of this.connections) {
      if (!conn.initialized) continue
      const serverConfig = this.config[name]
      try {
        const result = await this.request(conn, 'tools/list', {})
        const items: any[] = result?.tools || []
        const disabled = new Set(serverConfig?.disabledTools || [])
        for (const tool of items) {
          if (disabled.has(tool.name)) continue
          tools.push({
            server: name,
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })
        }
      } catch {
        // Skip servers that fail to enumerate tools
      }
    }
    return tools
  }

  /** Call a tool on a specific server */
  async callTool(server: string, toolName: string, args: Record<string, any>): Promise<any> {
    const conn = this.connections.get(server)
    if (!conn || !conn.initialized) {
      throw new Error(`MCP 服务器 "${server}" 未连接`)
    }
    const result = await this.request(conn, 'tools/call', {
      name: toolName,
      arguments: args || {},
    })
    if (result?.isError) {
      const text = extractMcpText(result)
      throw new Error(text || `MCP 工具执行失败: ${toolName}`)
    }
    return result
  }

  stopAll(): void {
    for (const [name, conn] of this.connections) {
      try {
        conn.proc.kill()
      } catch { /* already dead */ }
      this.connections.delete(name)
    }
  }

  isConfigured(): boolean {
    return Object.keys(this.config).length > 0
  }

  serverNames(): string[] {
    return Array.from(this.connections.keys())
  }
}

/** Extract the human-readable text from an MCP tool result */
export function extractMcpText(result: any): string {
  if (!result || typeof result !== 'object') return String(result ?? '')
  if (typeof result.content === 'string') return result.content
  const parts: string[] = []
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item?.type === 'text' && typeof item.text === 'string') parts.push(item.text)
      else if (item?.type === 'resource') parts.push(`[资源] ${item.resource?.uri || ''}`)
    }
  }
  if (result.structuredContent) parts.push(JSON.stringify(result.structuredContent, null, 2))
  return parts.join('\n')
}

export function toMcpToolDefinition(tool: McpToolInfo): {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, any> }
} {
  const name = `mcp__${tool.server}__${tool.name}`
  return {
    type: 'function',
    function: {
      name,
      description: `[MCP:${tool.server}] ${tool.description || tool.name}`,
      parameters: tool.inputSchema || { type: 'object', properties: {} },
    },
  }
}
