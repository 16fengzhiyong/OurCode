import { describe, it, expect, afterAll } from 'vitest'
import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { MCPManager } from '../services/mcp-manager'

const FIXTURE = join(__dirname, 'fixtures', 'mock-mcp-http-server.js')

/** Spawn the mock HTTP server and resolve once it reports its port. */
function startHttpServer(mode: string): Promise<{ port: number; proc: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [FIXTURE, mode], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const timer = setTimeout(() => { proc.kill(); reject(new Error('mock http server 启动超时')) }, 5000)
    proc.stdout?.on('data', (d: Buffer) => {
      out += d.toString()
      const m = /PORT:(\d+)/.exec(out)
      if (m) {
        clearTimeout(timer)
        resolve({ port: Number(m[1]), proc })
      }
    })
    proc.stderr?.on('data', (d: Buffer) => {
      if (!out.includes('PORT:')) {
        clearTimeout(timer)
        reject(new Error(`mock http server stderr: ${d.toString()}`))
      }
    })
    proc.on('exit', () => {
      clearTimeout(timer)
      reject(new Error('mock http server 提前退出'))
    })
  })
}

function waitForEvent<T>(emitter: MCPManager, event: string, timeoutMs: number, predicate?: (p: T) => boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, handler)
      reject(new Error(`等待事件 "${event}" 超时`))
    }, timeoutMs)
    const handler = (payload: T) => {
      if (predicate && !predicate(payload)) return
      clearTimeout(timer)
      emitter.off(event, handler)
      resolve(payload)
    }
    emitter.on(event, handler)
  })
}

const tempRoots: string[] = []
const children: ChildProcess[] = []
const managers: MCPManager[] = []

afterAll(async () => {
  for (const m of managers) m.stopAll()
  for (const c of children) { try { c.kill() } catch { /* ignore */ } }
  // Give child processes a beat to release any directory locks before cleanup
  await new Promise((r) => setTimeout(r, 50))
  for (const dir of tempRoots) {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true })
        break
      } catch {
        await new Promise((r) => setTimeout(r, 100))
      }
    }
  }
})

async function connect(mode: string, overrides: Record<string, any> = {}): Promise<MCPManager> {
  const { port, proc } = await startHttpServer(mode)
  children.push(proc)

  const dir = join(__dirname, 'fixtures', `mcp-http-config-${mode}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  mkdirSync(dir, { recursive: true })
  tempRoots.push(dir)
  writeFileSync(
    join(dir, 'mcp_config.json'),
    JSON.stringify({
      mcpServers: {
        mock: { serverUrl: `http://127.0.0.1:${port}/mcp`, ...overrides },
      },
    }),
    'utf-8',
  )

  const mcp = new MCPManager({ requestTimeoutMs: 3_000, restart: { baseDelayMs: 50, maxRetries: 3 } })
  managers.push(mcp)
  const ready = waitForEvent(mcp, 'ready', 5_000)
  await mcp.loadConfig(dir)
  await ready
  return mcp
}

describe('MCPManager HTTP transport (Streamable HTTP)', () => {
  it('connects, lists tools and calls a tool over application/json', async () => {
    const mcp = await connect('json')
    const tools = await mcp.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['echo', 'fail_tool'])

    const result = await mcp.callTool('mock', 'echo', { text: 'hi' })
    expect(JSON.stringify(result)).toContain('echo:hi')

    await expect(mcp.callTool('mock', 'fail_tool', {})).rejects.toThrow('故意失败')
  })

  it('exposes resources and prompts over HTTP', async () => {
    const mcp = await connect('json')

    const resources = await mcp.listResources()
    expect(resources[0].uri).toBe('mock://greeting')
    const resource = await mcp.readResource('mock', 'mock://greeting')
    expect(JSON.stringify(resource)).toContain('hello from mock http')

    const prompts = await mcp.listPrompts()
    expect(prompts[0].name).toBe('greet')
    const prompt = await mcp.getPrompt('mock', 'greet', { who: 'world' })
    expect(JSON.stringify(prompt)).toContain('hello world')
  })

  it('parses text/event-stream responses without spurious reconnects', async () => {
    const mcp = await connect('sse')
    const tools = await mcp.listTools()
    expect(tools.map((t) => t.name)).toContain('echo')

    const result = await mcp.callTool('mock', 'echo', { text: 'sse' })
    expect(JSON.stringify(result)).toContain('echo:sse')

    // Gracefully open SSE streams must NOT trigger a reconnect
    let restarted = false
    mcp.on('ready', (p: { restarted?: boolean }) => { if (p.restarted) restarted = true })
    await new Promise((r) => setTimeout(r, 300))
    expect(restarted).toBe(false)
  })

  it('reconnects with a fresh handshake after a broken stream', async () => {
    const mcp = await connect('sse-destroy')
    const tools = await mcp.listTools() // this response's stream is destroyed mid-flight
    expect(tools.map((t) => t.name)).toContain('echo')

    const restarted = waitForEvent<{ server: string; restarted?: boolean }>(mcp, 'ready', 5_000, (p) => !!p.restarted)
    const info = await restarted
    expect(info.server).toBe('mock')

    // The reconnected session is functional
    const again = await mcp.listTools()
    expect(again.map((t) => t.name)).toContain('echo')
  })

  it('rejects unsupported protocols and surfaces the error', async () => {
    const dir = join(__dirname, 'fixtures', `mcp-http-bad-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    tempRoots.push(dir)
    writeFileSync(
      join(dir, 'mcp_config.json'),
      JSON.stringify({ mcpServers: { bad: { serverUrl: 'ftp://example.com/mcp' } } }),
      'utf-8',
    )

    const mcp = new MCPManager({ requestTimeoutMs: 500, restart: { baseDelayMs: 10, maxRetries: 1 } })
    managers.push(mcp)
    const errors: string[] = []
    mcp.on('error', (e: Error) => errors.push(e.message))
    await mcp.loadConfig(dir)
    expect(errors.some((m) => m.includes('ftp') || m.includes('不支持的'))).toBe(true)
  })
})
