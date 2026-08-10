#!/usr/bin/env node
/**
 * Stitch 设计系统生成脚本 — OurCode-ide 全局换肤
 *
 * 通过 Stitch MCP 端点（Streamable HTTP, 2025-03-26）直接调用工具：
 *   1. create_project            — 新建「OurCode-ide Reskin 2026」项目
 *   2. create_design_system      — 连续创建 LIGHT / DARK 两套设计系统
 *                                  种子色 #0058BC（电光蓝基因）、FIDELITY 变体、
 *                                  PLUS_JAKARTA_SANS 字体、ROUND_EIGHT 圆角
 *   3. 抓取响应中的完整 Material 3 token 集，写入 .stitch/tokens-{light,dark}.json
 *
 * 用法:
 *   node tools/stitch-design-system.mjs [--api-key <KEY>] [--seed #0058BC]
 *
 * 说明: 不依赖会话内 MCP 工具加载（配置是会话中途添加的），直接走 HTTPS，
 *       与 MCP 工具同协议、同认证。
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const STITCH_DIR = join(ROOT, '.stitch')

const argv = process.argv.slice(2)
const argVal = (name, fallback) => {
  const i = argv.indexOf(name)
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback
}

const MCP_URL = 'https://stitch.googleapis.com/mcp'
const PROTOCOL_VERSION = '2025-03-26'
const API_KEY = process.env.STITCH_API_KEY || argVal('--api-key', 'AQ.YOUR_STITCH_API_KEY')
const SEED = argVal('--seed', '#0058BC')
const PROJECT_TITLE = argVal('--project-title', 'OurCode-ide Reskin 2026')

// ─────────────────────────── MCP Streamable HTTP 客户端 ───────────────────────────

let sessionId = null

/** 发送 JSON-RPC 请求（带 id 等响应）；isNotify 时发通知（不带 id） */
async function mcp(method, params = {}, { id = 1, notify = false } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOL_VERSION,
    'X-Goog-Api-Key': API_KEY,
  }
  if (sessionId) headers['mcp-session-id'] = sessionId
  const body = notify
    ? JSON.stringify({ jsonrpc: '2.0', method, params })
    : JSON.stringify({ jsonrpc: '2.0', id, method, params })
  const res = await fetch(MCP_URL, { method: 'POST', headers, body })
  const sid = res.headers.get('mcp-session-id')
  if (sid) sessionId = sid
  const text = await res.text()
  if (res.status >= 400) throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 300)}`)
  if (notify) return null
  const dataLines = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart())
  let msg
  if (dataLines.length) msg = JSON.parse(dataLines[dataLines.length - 1])
  else msg = text.trim() ? JSON.parse(text) : {}
  if (msg.error) throw new Error(`MCP ${method} 错误: ${msg.error.message || JSON.stringify(msg.error)}`)
  return msg.result
}

async function callTool(name, args = {}) {
  const r = await mcp('tools/call', { name, arguments: args })
  if (r?.isError) {
    const text = (r.content || []).map((c) => c.text || '').join('\n')
    throw new Error(`工具 ${name} 执行失败: ${text || 'unknown'}`)
  }
  return r
}

/** 从工具结果中提取首个 text 内容并解析 JSON */
function textToJson(result) {
  const text = (result?.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('\n')
  if (!text.trim()) return result
  try { return JSON.parse(text) } catch { return text }
}

/** 从设计系统响应中抽取扁平化的命名色 token 映射 */
function extractNamedColors(designSystem) {
  const named = designSystem?.namedColors || designSystem?.theme?.namedColors || {}
  // 兼容两种形态: { color: {...} } 或 { key: value }
  const out = {}
  for (const [k, v] of Object.entries(named)) {
    if (v && typeof v === 'object') {
      for (const [k2, v2] of Object.entries(v)) out[`${k}.${k2}`] = typeof v2 === 'string' ? v2 : JSON.stringify(v2)
    } else {
      out[k] = v
    }
  }
  return out
}

// ─────────────────────────── 主流程 ───────────────────────────

async function main() {
  console.log(`🔑 使用 Stitch MCP: ${MCP_URL}`)
  console.log(`🎨 种子色 ${SEED} · 字体 PLUS_JAKARTA_SANS · 圆角 ROUND_EIGHT · 变体 FIDELITY`)

  // 1. 握手
  const init = await mcp('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'ourcode-stitch-tool', version: '1.0.0' },
  })
  console.log(`✅ 握手成功: ${init?.serverInfo?.name} ${init?.protocolVersion}`)
  await mcp('notifications/initialized', {}, { notify: true })

  // 2. 查找或新建项目
  const projectsRes = await callTool('list_projects', {})
  const projectsText = textToJson(projectsRes)
  const projects = typeof projectsText === 'string' ? (JSON.parse(projectsText)?.projects || []) : (projectsText?.projects || [])
  let project = projects.find((p) => p.title === PROJECT_TITLE)
  if (project) {
    console.log(`📁 复用项目: ${project.name} (${project.title})`)
  } else {
    const created = textToJson(await callTool('create_project', { title: PROJECT_TITLE }))
    project = created
    console.log(`📁 新建项目: ${project.name} (${project.title})`)
  }
  const projectId = project.name.split('/').pop()
  if (!projectId) throw new Error('无法确定 projectId: ' + JSON.stringify(project))

  // 3. 创建两套设计系统
  const designSystems = {}
  for (const [mode, displayName] of [['LIGHT', 'OurCode Vivid Precision — Light'], ['DARK', 'OurCode Vivid Precision — Dark']]) {
    const theme = {
      colorMode: mode,
      headlineFont: 'PLUS_JAKARTA_SANS',
      bodyFont: 'PLUS_JAKARTA_SANS',
      labelFont: 'PLUS_JAKARTA_SANS',
      roundness: 'ROUND_EIGHT',
      customColor: SEED,
      colorVariant: 'FIDELITY',
    }
    console.log(`🎨 创建 ${mode} 设计系统: ${displayName}`)
    const res = await callTool('create_design_system', { designSystem: { displayName, theme } })
    const parsed = textToJson(res)
    const ds = parsed?.designSystem || parsed || {}
    designSystems[mode.toLowerCase()] = {
      name: ds.name || parsed?.name || '',
      displayName: ds.displayName || displayName,
      theme: ds.theme || theme,
      namedColors: extractNamedColors(ds),
    }
    // 按官方技能约定：create 之后必须 update 一次以正式落主题
    if (ds.name) {
      await callTool('update_design_system', {
        name: ds.name,
        designSystem: { displayName, theme },
      })
    }
    const colorCount = Object.keys(designSystems[mode.toLowerCase()].namedColors).length
    console.log(`   ↳ name=${ds.name || '(未返回)'} · 色板 token ${colorCount} 个`)
  }

  // 4. 写入 .stitch/tokens-*.json
  mkdirSync(STITCH_DIR, { recursive: true })
  for (const mode of ['light', 'dark']) {
    const file = join(STITCH_DIR, `tokens-${mode}.json`)
    writeFileSync(file, JSON.stringify(designSystems[mode], null, 2) + '\n')
    console.log(`💾 已保存: ${file}`)
  }

  // 5. 汇总
  console.log('\n══════════════ 设计系统摘要 ══════════════')
  console.log(`项目: ${projectId} (${PROJECT_TITLE})`)
  for (const mode of ['light', 'dark']) {
    const ds = designSystems[mode]
    const nc = ds.namedColors || {}
    const pick = (k) => nc[k] || nc[k.split('.').join('.')]
    console.log(`\n[${mode.toUpperCase()}]`)
    console.log(`  primary:      ${pick('primary') || pick('color.primary') || '—'}`)
    console.log(`  on-primary:   ${pick('on-primary') || pick('color.on-primary') || '—'}`)
    console.log(`  surface:      ${pick('surface') || pick('color.surface') || '—'}`)
    console.log(`  on-surface:   ${pick('on-surface') || pick('color.on-surface') || '—'}`)
    console.log(`  background:   ${pick('background') || pick('color.background') || '—'}`)
    console.log(`  outline:      ${pick('outline') || pick('color.outline') || '—'}`)
    console.log(`  error:        ${pick('error') || pick('color.error') || '—'}`)
  }
  console.log('\n✅ 完成。token 已保存到 .stitch/，可直接用于重写 global.css 变量。')
}

main().catch((e) => {
  console.error('❌ 失败:', e.message)
  process.exit(1)
})
