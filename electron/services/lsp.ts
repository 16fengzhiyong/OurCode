/**
 * Minimal Language Server Protocol client (stdio transport).
 *
 * Spawns a language server process and speaks JSON-RPC over stdin/stdout with
 * Content-Length framing. Only the features the editor uses are implemented:
 * initialize/initialized, textDocument/didOpen/didChange/didClose, and
 * publishDiagnostics (fed into Monaco markers → the Problems panel).
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'

export interface LspMessage {
  jsonrpc: '2.0'
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
}

export interface LspServerOptions {
  command: string
  args: string[]
  cwd: string
}

export class LspServer {
  private proc: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private seq = 0
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private _exited = false

  /** Raised on textDocument/publishDiagnostics from the server. */
  onDiagnostics: ((params: { uri: string; diagnostics: Array<Record<string, unknown>> }) => void) | null = null
  /** Raised on server stderr (for logging). */
  onStderr: ((line: string) => void) | null = null

  get exited(): boolean {
    return this._exited
  }

  /** Start the process and perform the initialize handshake (resolves with capabilities). */
  async start(opts: LspServerOptions): Promise<unknown> {
    const proc = spawn(opts.command, opts.args, { cwd: opts.cwd, shell: process.platform === 'win32' })
    this.proc = proc
    proc.stdout.on('data', (d: Buffer) => this.onData(d))
    proc.stderr.on('data', (d: Buffer) => this.onStderr?.(d.toString()))
    proc.on('exit', () => {
      this._exited = true
      for (const { reject } of this.pending.values()) reject(new Error('LSP server exited'))
      this.pending.clear()
    })
    proc.on('error', (err) => {
      this._exited = true
      for (const { reject } of this.pending.values()) reject(err)
      this.pending.clear()
    })

    // Handshake — resolve with the server's capabilities
    const result = await this.request('initialize', {
      processId: null,
      rootUri: null,
      capabilities: {
        textDocument: { synchronization: { didOpen: true, didChange: true, didClose: true } },
      },
    })
    this.notify('initialized', {})
    return result
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  didOpen(uri: string, languageId: string, text: string): void {
    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId, version: 1, text },
    })
  }

  didChange(uri: string, text: string, version: number): void {
    this.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    })
  }

  didClose(uri: string): void {
    this.notify('textDocument/didClose', { textDocument: { uri } })
  }

  async stop(): Promise<void> {
    if (!this.proc || this._exited) return
    try {
      await this.request('shutdown', null)
    } catch { /* server may already be gone */ }
    this.notify('exit', null)
    this.proc.kill()
  }

  private write(msg: LspMessage): void {
    if (!this.proc || this._exited || this.proc.stdin.destroyed) return
    const body = JSON.stringify(msg)
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`)
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf-8')
    // Parse one or more Content-Length framed messages from the buffer
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const header = this.buffer.slice(0, headerEnd)
      const m = /Content-Length:\s*(\d+)/i.exec(header)
      if (!m) {
        // Unparseable — drop the bad frame
        this.buffer = this.buffer.slice(headerEnd + 4)
        continue
      }
      const length = Number(m[1])
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + length) return
      const body = this.buffer.slice(bodyStart, bodyStart + length)
      this.buffer = this.buffer.slice(bodyStart + length)
      try {
        this.onMessage(JSON.parse(body) as LspMessage)
      } catch { /* malformed JSON — ignore */ }
    }
  }

  private onMessage(msg: LspMessage): void {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message))
      else p.resolve(msg.result)
      return
    }
    if (msg.method === 'textDocument/publishDiagnostics' && this.onDiagnostics) {
      this.onDiagnostics(msg.params as { uri: string; diagnostics: Array<Record<string, unknown>> })
    }
  }
}
