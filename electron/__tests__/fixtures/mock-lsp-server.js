// Minimal LSP server used by unit tests: responds to initialize, emits one
// fixed diagnostic on textDocument/didOpen, exits on shutdown.
process.stdin.setEncoding('utf-8')
let buffer = ''
process.stdin.on('data', (chunk) => {
  buffer += chunk
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) return
    const m = /Content-Length:\s*(\d+)/i.exec(buffer.slice(0, headerEnd))
    if (!m) { buffer = buffer.slice(headerEnd + 4); continue }
    const len = Number(m[1])
    const start = headerEnd + 4
    if (buffer.length < start + len) return
    const body = buffer.slice(start, start + len)
    buffer = buffer.slice(start + len)
    try { handle(JSON.parse(body)) } catch { /* ignore */ }
  }
})

function send(msg) {
  const b = JSON.stringify(msg)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(b, 'utf-8')}\r\n\r\n${b}`)
}

function handle(msg) {
  if (!msg || typeof msg !== 'object') return
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { capabilities: { textDocumentSync: 1 } } })
  } else if (msg.method === 'textDocument/didOpen') {
    const uri = msg.params.textDocument.uri
    send({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri,
        diagnostics: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
            severity: 1,
            message: 'MOCK: intentional error',
            source: 'mock-lsp',
          },
        ],
      },
    })
  } else if (msg.method === 'shutdown') {
    send({ jsonrpc: '2.0', id: msg.id, result: null })
    setTimeout(() => process.exit(0), 10)
  }
}
