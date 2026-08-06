#!/usr/bin/env node
/**
 * OurCode Git MCP Server — a dependency-free stdio implementation of the
 * Model Context Protocol (JSON-RPC 2.0, newline-delimited JSON framing).
 *
 * Spawned by the IDE's MCPManager (see electron/services/mcp-manager.ts):
 *   - works on the workspace it was spawned in (cwd = workspace root)
 *   - speaks initialize / notifications/initialized / tools/list / tools/call
 *   - also exposes one Resource (git://branch, git://status) and one Prompt
 *     (commit-message) to demonstrate Resources/Prompts support
 *
 * Run standalone for a smoke test:
 *   node mcp-servers/git-server/server.js
 */
const { execFile } = require('node:child_process')
const readline = require('node:readline')

const PROTOCOL_VERSION = '2025-03-26'

const TOOLS = [
  {
    name: 'git_status',
    description: '查看当前 git 仓库状态（未提交的变更摘要，porcelain=v1）',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'git_log',
    description: '查看最近提交历史',
    inputSchema: {
      type: 'object',
      properties: { maxCount: { type: 'number', description: '最多显示条数（默认 10）' } },
    },
  },
  {
    name: 'git_diff',
    description: '查看工作区相对 HEAD 的差异',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: '可选：限定某个文件/目录' } },
    },
  },
  {
    name: 'git_branch',
    description: '列出本地分支，并标注当前分支',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'git_commit',
    description: '提交当前暂存区的变更（危险操作：会写入 git 历史）',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: '提交信息' } },
      required: ['message'],
    },
  },
  {
    name: 'git_push',
    description: '推送当前分支到远端（危险操作：会对外发布变更）',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

const RESOURCES = [
  {
    uri: 'git://branch',
    name: '当前分支',
    mimeType: 'text/plain',
    description: '当前 git 分支名',
  },
  {
    uri: 'git://status',
    name: '工作区状态',
    mimeType: 'text/plain',
    description: '未提交变更的简要状态',
  },
]

const PROMPTS = [
  {
    name: 'commit-message',
    description: '根据变更摘要生成规范的提交信息',
    arguments: [
      { name: 'summary', description: '变更内容的一句话描述', required: true },
      { name: 'type', description: '提交类型（feat/fix/refactor/docs/test/chore）', required: false },
    ],
  },
]

// ── git helpers ────────────────────────────────────────────────────────────

function runGit(args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ error: `git ${args.join(' ')} 失败: ${stderr.trim() || error.message}` })
        return
      }
      resolve({ output: stdout.trim() })
    })
  })
}

// ── request handlers ───────────────────────────────────────────────────────

function handle(method, params) {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'ourcode-git-server', version: '0.1.0' },
      }

    case 'tools/list':
      return { tools: TOOLS }

    case 'tools/call':
      return callTool(params)

    case 'resources/list':
      return { resources: RESOURCES }

    case 'resources/read':
      return readResource(params)

    case 'prompts/list':
      return { prompts: PROMPTS }

    case 'prompts/get':
      return getPrompt(params)

    default:
      return null // unknown → protocol error by the caller
  }
}

async function callTool(params) {
  const name = params.name
  const args = params.arguments || {}
  if (name === 'git_status') {
    const r = await runGit(['status', '--porcelain=v1', '--branch'])
    return r.error ? errorResult(r.error) : { content: [{ type: 'text', text: r.output || '(工作区干净)' }] }
  }
  if (name === 'git_log') {
    const max = Math.min(Math.max(Number(args.maxCount) || 10, 1), 100)
    const r = await runGit(['log', `-${max}`, '--oneline', '--decorate'])
    return r.error ? errorResult(r.error) : { content: [{ type: 'text', text: r.output || '(无提交)' }] }
  }
  if (name === 'git_diff') {
    const argv = ['diff', '--stat']
    if (typeof args.path === 'string') argv.push('--', args.path)
    const r = await runGit(argv)
    return r.error ? errorResult(r.error) : { content: [{ type: 'text', text: r.output || '(无差异)' }] }
  }
  if (name === 'git_branch') {
    const r = await runGit(['branch'])
    return r.error ? errorResult(r.error) : { content: [{ type: 'text', text: r.output || '(无分支)' }] }
  }
  if (name === 'git_commit') {
    if (typeof args.message !== 'string' || !args.message.trim()) {
      return errorResult('git_commit 需要 message 参数')
    }
    const r = await runGit(['commit', '-m', args.message.trim()])
    return r.error ? errorResult(r.error) : { content: [{ type: 'text', text: r.output || '已提交' }] }
  }
  if (name === 'git_push') {
    const r = await runGit(['push'])
    return r.error ? errorResult(r.error) : { content: [{ type: 'text', text: r.output || '已推送' }] }
  }
  return errorResult(`未知工具: ${name}`)
}

function readResource(params) {
  const { uri } = params
  const resource = RESOURCES.find((r) => r.uri === uri)
  if (!resource) {
    return { error: { code: -32002, message: `未知资源: ${uri}` } }
  }
  // Synchronous read is fine for these two tiny resources; real servers would
  // make this async.
  let text = ''
  if (uri === 'git://branch') {
    const { execFileSync } = require('node:child_process')
    try {
      text = execFileSync('git', ['branch', '--show-current'], { cwd: process.cwd() }).toString().trim() || '(detached HEAD)'
    } catch {
      text = '(非 git 仓库)'
    }
  } else if (uri === 'git://status') {
    const { execFileSync } = require('node:child_process')
    try {
      text = execFileSync('git', ['status', '--short'], { cwd: process.cwd() }).toString().trim() || '(工作区干净)'
    } catch {
      text = '(非 git 仓库)'
    }
  }
  return { contents: [{ uri, mimeType: resource.mimeType, text }] }
}

function getPrompt(params) {
  const { name } = params
  if (name !== 'commit-message') {
    return { error: { code: -32602, message: `未知 prompt: ${name}` } }
  }
  const args = params.arguments || {}
  const type = typeof args.type === 'string' && args.type ? args.type : 'feat'
  const summary = typeof args.summary === 'string' ? args.summary : ''
  return {
    description: '生成规范的 git 提交信息',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `为以下变更生成一条规范的提交信息（格式: <type>(<scope>): <subject>）：\n\n类型: ${type}\n变更摘要: ${summary}\n\n请直接输出提交信息。`,
        },
      },
    ],
  }
}

function errorResult(message) {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  }
}

// ── I/O loop (newline-delimited JSON-RPC) ──────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let msg
  try {
    msg = JSON.parse(trimmed)
  } catch {
    return
  }
  if (typeof msg.id !== 'number') return // notification (e.g. notifications/initialized)

  Promise.resolve(handle(msg.method, msg.params || {}))
    .then((result) => {
      if (result && typeof result === 'object' && result.error) {
        const { error, ...rest } = result
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error, ...rest }) + '\n')
        return
      }
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: result ?? null }) + '\n')
    })
    .catch((error) => {
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: error.message } }) + '\n',
      )
    })
})

process.stderr.on('data', () => {}) // keep stream open / no-op
