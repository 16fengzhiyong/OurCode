// Minimal MCP Streamable HTTP server used by unit tests of the HTTP transport.
//
// Usage: node mock-mcp-http-server.js <mode>   (mode: json | sse | sse-destroy)
// Prints "PORT:<n>" to stdout once listening.
//
//  - json:         responds to every POST with a single application/json body
//  - sse:          responds with text/event-stream and keeps streams open
//  - sse-destroy:  same, but destroys the stream right after tools/list —
//                  exercising the client's broken-connection reconnect path
const http = require('node:http')

const MODE = process.argv[2] || 'json'

const TOOLS = [
  { name: 'echo', description: '回显文本', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
  { name: 'fail_tool', description: '总是失败', inputSchema: { type: 'object', properties: {} } },
]
const RESOURCES = [{ uri: 'mock://greeting', name: '问候语', mimeType: 'text/plain', description: '示例资源' }]
const PROMPTS = [{ name: 'greet', description: '打招呼', arguments: [{ name: 'who', required: true }] }]

function respond(method, params) {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'mock-mcp-http', version: '1.0.0' },
      }
    case 'tools/list':
      return { tools: TOOLS }
    case 'tools/call':
      if (params.name === 'fail_tool') {
        return { isError: true, content: [{ type: 'text', text: 'MOCK HTTP: 故意失败' }] }
      }
      return { content: [{ type: 'text', text: `echo:${(params.arguments || {}).text || ''}` }] }
    case 'resources/list':
      return { resources: RESOURCES }
    case 'resources/read':
      return { contents: [{ uri: params.uri, mimeType: 'text/plain', text: 'hello from mock http' }] }
    case 'prompts/list':
      return { prompts: PROMPTS }
    case 'prompts/get':
      return { description: '打招呼', messages: [{ role: 'user', content: { type: 'text', text: `hello ${(params.arguments || {}).who || ''}` } }] }
    default:
      return null
  }
}

function handleRequest(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405).end()
    return
  }
  let body = ''
  req.setEncoding('utf-8')
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    let msg
    try {
      msg = JSON.parse(body)
    } catch {
      res.writeHead(400).end()
      return
    }
    // Notifications (no id) — ignore
    if (typeof msg.id !== 'number') {
      res.writeHead(202).end()
      return
    }
    const result = respond(msg.method, msg.params || {})

    if (MODE === 'json') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'mcp-session-id': 'sess-123',
        'MCP-Protocol-Version': '2025-03-26',
      })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }))
      return
    }

    // SSE mode
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'mcp-session-id': 'sess-123',
      'MCP-Protocol-Version': '2025-03-26',
    })
    res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n`)

    if (MODE === 'sse-destroy' && msg.method === 'tools/list') {
      // Abrupt teardown — the client must treat this as a broken connection
      setTimeout(() => res.destroy(), 50)
    }
    // otherwise keep the stream open (client manages per-request streams)
  })
}

const server = http.createServer(handleRequest)
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  process.stdout.write(`PORT:${port}\n`)
})
