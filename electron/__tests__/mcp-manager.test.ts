import { describe, it, expect, afterAll } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { MCPManager, extractMcpText, toMcpToolDefinition } from '../services/mcp-manager'

const MOCK = join(__dirname, 'fixtures', 'mock-mcp-server.js')

/** Wait for an event (with a timeout) — rejects on failure. */
function waitForEvent<T>(emitter: MCPManager, event: string, timeoutMs: number, predicate?: (payload: T) => boolean): Promise<T> {
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

function makeConfigDir(name: string, serverOverrides: Record<string, any> = {}): string {
  const dir = join(__dirname, 'fixtures', `mcp-config-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  mkdirSync(dir, { recursive: true })
  tempRoots.push(dir)
  const config = {
    mcpServers: {
      mock: {
        command: process.execPath,
        args: [MOCK],
        env: { MOCK_MCP_SILENT: '0' },
        ...serverOverrides,
      },
    },
  }
  writeFileSync(join(dir, 'mcp_config.json'), JSON.stringify(config, null, 2), 'utf-8')
  return dir
}

afterAll(async () => {
  // Stop servers BEFORE deleting their cwd dirs — on Windows a live child
  // process holds the directory (cwd lock), making rmSync fail silently.
  // (Single afterAll: vitest runs hooks in registration order, so a separate
  // cleanup hook would run before stopAll.)
  for (const m of managers) m.stopAll()
  await new Promise((r) => setTimeout(r, 100))
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

const managers: MCPManager[] = []

function track(m: MCPManager): MCPManager {
  managers.push(m)
  return m
}

const fastManager = () =>
  track(new MCPManager({ requestTimeoutMs: 2_000, restart: { baseDelayMs: 50, maxRetries: 3 } }))

describe('MCPManager (stdio transport)', () => {
  it('performs the handshake and lists tools', async () => {
    const mcp = fastManager()
    const ready = waitForEvent(mcp, 'ready', 5_000)
    await mcp.loadConfig(makeConfigDir('basic'))
    await ready

    const tools = await mcp.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['echo', 'fail_tool', 'secret_tool'])
    expect(tools.find((t) => t.name === 'echo')?.server).toBe('mock')
  })

  it('filters disabledTools from the tool list', async () => {
    const mcp = fastManager()
    const ready = waitForEvent(mcp, 'ready', 5_000)
    await mcp.loadConfig(makeConfigDir('disabled', { disabledTools: ['secret_tool'] }))
    await ready

    const tools = await mcp.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['echo', 'fail_tool'])
  })

  it('calls a tool and surfaces error results as rejected promises', async () => {
    const mcp = fastManager()
    const ready = waitForEvent(mcp, 'ready', 5_000)
    await mcp.loadConfig(makeConfigDir('calls'))
    await ready

    const result = await mcp.callTool('mock', 'echo', { text: 'hi' })
    expect(extractMcpText(result)).toBe('echo:hi')

    await expect(mcp.callTool('mock', 'fail_tool', {})).rejects.toThrow('故意失败')
  })

  it('exposes resources and prompts', async () => {
    const mcp = fastManager()
    const ready = waitForEvent(mcp, 'ready', 5_000)
    await mcp.loadConfig(makeConfigDir('resources'))
    await ready

    const resources = await mcp.listResources()
    expect(resources).toHaveLength(1)
    expect(resources[0].uri).toBe('mock://greeting')

    const resource = await mcp.readResource('mock', 'mock://greeting')
    expect(extractMcpText(resource)).toContain('hello from mock')

    const prompts = await mcp.listPrompts()
    expect(prompts).toHaveLength(1)
    expect(prompts[0].name).toBe('greet')

    const prompt = await mcp.getPrompt('mock', 'greet', { who: 'world' })
    const text = JSON.stringify(prompt)
    expect(text).toContain('hello world')
  })

  it('auto-restarts a crashed server with backoff and re-readies', async () => {
    const mcp = fastManager()
    // The mock exits after handling 2 requests (initialize + one more)
    const ready = waitForEvent(mcp, 'ready', 5_000)
    await mcp.loadConfig(makeConfigDir('crash', { env: { MOCK_MCP_EXIT_AFTER: '2' } }))
    await ready

    // Trigger the crash: this listTools is the server's 2nd handled request
    const restarted = waitForEvent<{ server: string; restarted?: boolean }>(mcp, 'ready', 5_000, (p) => !!p.restarted)
    await mcp.listTools().catch(() => { /* may already be dead */ })
    const restartedInfo = await restarted
    expect(restartedInfo.server).toBe('mock')

    // The restarted connection is fully functional
    const tools = await mcp.listTools()
    expect(tools.map((t) => t.name)).toContain('echo')
  })

  it('gives up after maxRetries and emits failed', async () => {
    const mcp = track(new MCPManager({ requestTimeoutMs: 2_000, restart: { baseDelayMs: 10, maxRetries: 2 } }))
    const failed = waitForEvent<{ server: string; reason: string }>(mcp, 'failed', 10_000)
    await mcp.loadConfig(makeConfigDir('badcmd', { command: 'definitely-not-a-real-command-xyz' }))
    const info = await failed
    expect(info.server).toBe('mock')
    expect(info.reason).toMatch(/spawn|ENOENT|启动失败/)
  })

  it('times out unresponsive tools/call requests', async () => {
    const mcp = track(new MCPManager({ requestTimeoutMs: 300, restart: { baseDelayMs: 10, maxRetries: 1 } }))
    const ready = waitForEvent(mcp, 'ready', 5_000)
    await mcp.loadConfig(makeConfigDir('silent', { env: { MOCK_MCP_SILENT: '1' } }))
    await ready

    // listTools skips unresponsive servers (returns [])…
    expect(await mcp.listTools()).toEqual([])
    // …but a direct call surfaces the timeout
    await expect(mcp.callTool('mock', 'echo', {})).rejects.toThrow('超时')
  })

  it('stopAll kills children and suppresses restarts', async () => {
    const mcp = fastManager()
    const ready = waitForEvent(mcp, 'ready', 5_000)
    await mcp.loadConfig(makeConfigDir('stop'))
    await ready

    mcp.stopAll()
    expect(mcp.serverNames()).toEqual([])
    // Give a hypothetical restart timer a chance to fire — none should
    await new Promise((r) => setTimeout(r, 150))
    expect(mcp.serverNames()).toEqual([])
  })

  it('launches bundled servers with Electron-bundled Node (no system node)', async () => {
    // "bundled-node" spawns process.execPath with ELECTRON_RUN_AS_NODE=1, and
    // "bundled:" args resolve inside the configured bundled mcp-servers dir.
    const mcp = track(new MCPManager({
      requestTimeoutMs: 2_000,
      restart: { baseDelayMs: 50, maxRetries: 3 },
      bundledNodeDir: join(__dirname, 'fixtures'),
    }))
    const ready = waitForEvent(mcp, 'ready', 5_000)
    await mcp.loadConfig(makeConfigDir('bundled', { command: 'bundled-node', args: ['bundled:mock-mcp-server.js'] }))
    await ready

    const tools = await mcp.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['echo', 'fail_tool', 'secret_tool'])
    expect(await mcp.callTool('mock', 'echo', { text: 'hi' }).then(extractMcpText)).toBe('echo:hi')
  })

  it('fails cleanly when bundled-node is used without a bundledNodeDir', async () => {
    const mcp = fastManager()
    const errors: string[] = []
    mcp.on('error', (e: Error) => errors.push(e.message))
    const failed = waitForEvent(mcp, 'failed', 5_000)
    await mcp.loadConfig(makeConfigDir('bundled-nodir', { command: 'bundled-node', args: ['bundled:mock-mcp-server.js'] }))
    await failed
    expect(errors.some((m) => m.includes('内置 mcp-servers 目录'))).toBe(true)
  })

  it('rejects bundled: paths that escape the bundled dir', async () => {
    const mcp = track(new MCPManager({
      requestTimeoutMs: 2_000,
      restart: { baseDelayMs: 50, maxRetries: 3 },
      bundledNodeDir: join(__dirname, 'fixtures'),
    }))
    const errors: string[] = []
    mcp.on('error', (e: Error) => errors.push(e.message))
    const failed = waitForEvent(mcp, 'failed', 5_000)
    await mcp.loadConfig(makeConfigDir('bundled-escape', { command: 'bundled-node', args: ['bundled:../escaped.js'] }))
    await failed
    expect(errors.some((m) => m.includes('路径越界'))).toBe(true)
  })

  it('allows bundled: filenames that begin with ".." (still inside the dir)', async () => {
    const mcp = track(new MCPManager({
      requestTimeoutMs: 2_000,
      restart: { baseDelayMs: 50, maxRetries: 3 },
      bundledNodeDir: join(__dirname, 'fixtures'),
    }))
    const errors: string[] = []
    mcp.on('error', (e: Error) => errors.push(e.message))
    const failed = waitForEvent(mcp, 'failed', 5_000)
    // "..mock-mcp-server.js" is a single filename inside the bundled dir (the
    // file doesn't exist, so the spawn itself fails) — it must NOT be treated
    // as a path escape like "../escaped.js" is.
    await mcp.loadConfig(makeConfigDir('bundled-dotdot', { command: 'bundled-node', args: ['bundled:..mock-mcp-server.js'] }))
    await failed
    expect(errors.some((m) => m.includes('路径越界'))).toBe(false)
    // The file doesn't exist, so the spawned runtime exits with code 1 — the
    // failure must come from the process itself, not from the path guard.
    expect(errors.some((m) => /进程退出|启动失败|spawn|ENOENT/.test(m))).toBe(true)
  })
})

describe('toMcpToolDefinition', () => {
  it('maps an MCP tool to an mcp__<server>__<name> function definition', () => {
    const def = toMcpToolDefinition({ server: 'git', name: 'git_status', description: '状态', inputSchema: { type: 'object', properties: {} } })
    expect(def.function.name).toBe('mcp__git__git_status')
    expect(def.function.description).toContain('MCP:git')
    expect(def.function.parameters).toEqual({ type: 'object', properties: {} })
  })
})
