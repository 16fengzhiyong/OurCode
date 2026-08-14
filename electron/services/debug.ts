/**
 * Minimal Debug Adapter Protocol client (stdio transport).
 *
 * Speaks DAP over stdin/stdout with the same Content-Length framing as LSP.
 * Implements the session essentials: initialize, launch, setBreakpoints,
 * configurationDone, continue/pause/stepping, and the stopped/output/
 * terminated events.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { scrubbedSpawnEnv } from './env-scrub'

export interface DapBreakpoint {
  path: string
  line: number
}

export class DebugAdapterClient {
  private proc: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private seq = 0
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private _exited = false

  onStopped: ((body: Record<string, unknown>) => void) | null = null
  onOutput: ((body: Record<string, unknown>) => void) | null = null
  onTerminated: ((body: Record<string, unknown>) => void) | null = null
  onStderr: ((line: string) => void) | null = null

  get exited(): boolean {
    return this._exited
  }

  async start(command: string, args: string[], cwd: string): Promise<void> {
    const proc = spawn(command, args, { cwd, shell: process.platform === 'win32', env: scrubbedSpawnEnv() })
    this.proc = proc
    proc.stdout.on('data', (d: Buffer) => this.onData(d))
    proc.stderr.on('data', (d: Buffer) => this.onStderr?.(d.toString()))
    proc.on('exit', () => {
      this._exited = true
      for (const { reject } of this.pending.values()) reject(new Error('debug adapter exited'))
      this.pending.clear()
    })
    proc.on('error', (err) => {
      this._exited = true
      for (const { reject } of this.pending.values()) reject(err)
      this.pending.clear()
    })
    await this.request('initialize', { adapterID: 'ourcode', clientID: 'ourcode', linesStartAt1: true, columnsStartAt1: true })
  }

  launch(config: Record<string, unknown>): Promise<unknown> {
    return this.request('launch', config)
  }

  setBreakpoints(path: string, lines: number[]): Promise<unknown> {
    return this.request('setBreakpoints', {
      source: { path },
      breakpoints: lines.map((line) => ({ line })),
    })
  }

  configurationDone(): Promise<unknown> {
    return this.request('configurationDone', {})
  }

  continueReq(): Promise<unknown> {
    return this.request('continue', {})
  }

  pause(): Promise<unknown> {
    return this.request('pause', {})
  }

  stepOver(): Promise<unknown> {
    return this.request('next', {})
  }

  stepInto(): Promise<unknown> {
    return this.request('stepIn', {})
  }

  stepOut(): Promise<unknown> {
    return this.request('stepOut', {})
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.write({ seq: id, type: 'request', command: method, arguments: params })
    })
  }

  async stop(): Promise<void> {
    if (!this.proc || this._exited) return
    try {
      await this.request('disconnect', {})
    } catch { /* adapter may already be gone */ }
    this.proc.kill()
  }

  private write(msg: unknown): void {
    if (!this.proc || this._exited || this.proc.stdin.destroyed) return
    const body = JSON.stringify(msg)
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`)
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf-8')
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const header = this.buffer.slice(0, headerEnd)
      const m = /Content-Length:\s*(\d+)/i.exec(header)
      if (!m) {
        this.buffer = this.buffer.slice(headerEnd + 4)
        continue
      }
      const length = Number(m[1])
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + length) return
      const body = this.buffer.slice(bodyStart, bodyStart + length)
      this.buffer = this.buffer.slice(bodyStart + length)
      try {
        this.onMessage(JSON.parse(body))
      } catch { /* malformed */ }
    }
  }

  private onMessage(msg: { type?: string; seq?: number; request_seq?: number; success?: boolean; command?: string; event?: string; body?: Record<string, unknown>; message?: string }): void {
    if (msg.type === 'response' && msg.request_seq !== undefined && this.pending.has(msg.request_seq)) {
      const p = this.pending.get(msg.request_seq)!
      this.pending.delete(msg.request_seq)
      if (msg.success) p.resolve(msg.body)
      else p.reject(new Error(msg.message || 'DAP request failed'))
      return
    }
    if (msg.type === 'event' && msg.event) {
      const body = msg.body ?? {}
      if (msg.event === 'stopped') this.onStopped?.(body)
      else if (msg.event === 'output') this.onOutput?.(body)
      else if (msg.event === 'terminated') this.onTerminated?.(body)
    }
  }
}
