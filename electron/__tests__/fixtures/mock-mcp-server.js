// Minimal MCP server (JSONL framing) used by unit tests of the MCPManager.
//
// Behavior switches via env vars:
//   MOCK_MCP_EXIT_AFTER=<n>  exit(0) after handling n requests (restart test)
//   MOCK_MCP_SILENT=1        answer initialize but never answer anything else (timeout test)
const readline = require('node:readline')

const EXIT_AFTER = Number(process.env.MOCK_MCP_EXIT_AFTER || 0)
const SILENT = process.env.MOCK_MCP_SILENT === '1'

let handled = 0

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function handle(msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.id !== 'number') return // notifications ignored

  if (SILENT && msg.method !== 'initialize') return

  switch (msg.method) {
    case 'initialize':
      handled++
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: 'mock-mcp', version: '1.0.0' },
        },
      })
      break

    case 'tools/list':
      handled++
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [
            { name: 'echo', description: '回显文本', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
            { name: 'secret_tool', description: '需要被禁用', inputSchema: { type: 'object', properties: {} } },
            { name: 'fail_tool', description: '总是失败', inputSchema: { type: 'object', properties: {} } },
          ],
        },
      })
      break

    case 'tools/call': {
      handled++
      const { name, arguments: args } = msg.params || {}
      if (name === 'fail_tool') {
        send({ jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: 'MOCK: 故意失败' }] } })
      } else {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text: `echo:${(args && args.text) || ''}` }] },
        })
      }
      break
    }

    case 'resources/list':
      handled++
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: { resources: [{ uri: 'mock://greeting', name: '问候语', mimeType: 'text/plain', description: '示例资源' }] },
      })
      break

    case 'resources/read':
      handled++
      send({ jsonrpc: '2.0', id: msg.id, result: { contents: [{ uri: 'mock://greeting', mimeType: 'text/plain', text: 'hello from mock' }] } })
      break

    case 'prompts/list':
      handled++
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: { prompts: [{ name: 'greet', description: '打招呼', arguments: [{ name: 'who', required: true }] }] },
      })
      break

    case 'prompts/get':
      handled++
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: { description: '打招呼', messages: [{ role: 'user', content: { type: 'text', text: `hello ${((msg.params || {}).arguments || {}).who || ''}` } }] },
      })
      break

    default:
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unknown method ${msg.method}` } })
  }

  if (EXIT_AFTER > 0 && handled >= EXIT_AFTER) {
    process.exit(0)
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  try {
    handle(JSON.parse(trimmed))
  } catch {
    /* ignore malformed input */
  }
})
