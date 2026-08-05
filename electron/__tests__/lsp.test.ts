import { describe, it, expect, afterAll } from 'vitest'
import { join } from 'path'
import { LspServer } from '../services/lsp'

const MOCK = join(__dirname, 'fixtures', 'mock-lsp-server.js')
const servers: LspServer[] = []

afterAll(async () => {
  await Promise.all(servers.map((s) => s.stop().catch(() => {})))
})

describe('LspServer (stdio transport)', () => {
  it('performs the initialize handshake', async () => {
    const server = new LspServer()
    servers.push(server)
    const result = (await server.start({ command: process.execPath, args: [MOCK], cwd: __dirname })) as { capabilities?: { textDocumentSync?: number } }
    expect(result.capabilities).toBeDefined()
    expect(server.exited).toBe(false)
  })

  it('receives publishDiagnostics after didOpen', async () => {
    const server = new LspServer()
    servers.push(server)
    await server.start({ command: process.execPath, args: [MOCK], cwd: __dirname })

    const diags = new Promise<{ uri: string; diagnostics: Array<{ message: string; severity: number }> }>((resolve) => {
      server.onDiagnostics = (params) => resolve(params as never)
    })
    server.didOpen('file:///test/main.py', 'python', 'print(1)\n')

    const result = await diags
    expect(result.uri).toContain('main.py')
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0].message).toContain('MOCK')
    expect(result.diagnostics[0].severity).toBe(1)
  })

  it('surfaces spawn errors without hanging requests', async () => {
    const server = new LspServer()
    servers.push(server)
    await expect(
      server.start({ command: 'definitely-not-a-real-binary-xyz', args: [], cwd: __dirname }),
    ).rejects.toBeTruthy()
  })
})
