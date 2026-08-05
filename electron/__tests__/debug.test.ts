import { describe, it, expect, afterAll } from 'vitest'
import { join } from 'path'
import { DebugAdapterClient } from '../services/debug'

const MOCK = join(__dirname, 'fixtures', 'mock-debug-adapter.js')
const clients: DebugAdapterClient[] = []

afterAll(async () => {
  await Promise.all(clients.map((c) => c.stop().catch(() => {})))
})

describe('DebugAdapterClient (DAP stdio)', () => {
  it('runs initialize → launch → stopped → continue → terminated', async () => {
    const client = new DebugAdapterClient()
    clients.push(client)
    await client.start(process.execPath, [MOCK], __dirname)

    // launch → adapter emits 'stopped'
    const stopped = new Promise<Record<string, unknown>>((resolve) => {
      client.onStopped = (body) => resolve(body)
    })
    await client.launch({ program: 'prog' })
    const stop = await stopped
    expect(stop.reason).toBe('breakpoint')

    // continue → adapter emits 'terminated'
    const terminated = new Promise<Record<string, unknown>>((resolve) => {
      client.onTerminated = (body) => resolve(body)
    })
    await client.continueReq()
    const end = await terminated
    expect(end).toBeDefined()
    expect(client.exited).toBe(false)
  })

  it('setBreakpoints verifies requested lines', async () => {
    const client = new DebugAdapterClient()
    clients.push(client)
    await client.start(process.execPath, [MOCK], __dirname)

    const res = (await client.setBreakpoints('file:///main.py', [3, 7])) as { breakpoints: Array<{ verified: boolean; line: number }> }
    expect(res.breakpoints).toHaveLength(2)
    expect(res.breakpoints[0].verified).toBe(true)
    expect(res.breakpoints[1].line).toBe(7)
  })
})
