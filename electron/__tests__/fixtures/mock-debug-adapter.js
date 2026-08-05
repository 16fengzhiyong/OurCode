// Minimal DAP debug adapter used by unit tests: responds to initialize /
// setBreakpoints / launch (emits a 'stopped' event), continue (emits
// 'terminated'), and disconnect (exits).
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

function respond(msg, body) {
  send({ seq: 1, type: 'response', request_seq: msg.seq, success: true, command: msg.command, body: body ?? {} })
}

function handle(msg) {
  if (!msg || msg.type !== 'request') return
  switch (msg.command) {
    case 'initialize':
      respond(msg, { supportsConfigurationDoneRequest: true })
      break
    case 'setBreakpoints': {
      const lines = (msg.arguments.breakpoints || []).map((b) => b.line)
      respond(msg, { breakpoints: lines.map((line) => ({ verified: true, line })) })
      break
    }
    case 'launch':
      respond(msg, {})
      setTimeout(() => {
        send({ seq: 99, type: 'event', event: 'stopped', body: { reason: 'breakpoint', threadId: 1, text: 'mock stop' } })
      }, 20)
      break
    case 'configurationDone':
      respond(msg, {})
      break
    case 'continue':
      respond(msg, { allThreadsContinued: true })
      setTimeout(() => {
        send({ seq: 100, type: 'event', event: 'terminated', body: {} })
      }, 20)
      break
    case 'disconnect':
      respond(msg, {})
      setTimeout(() => process.exit(0), 10)
      break
    default:
      respond(msg, {})
  }
}
