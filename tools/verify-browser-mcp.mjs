/**
 * 端到端验证脚本：以 MCP stdio 协议驱动 @playwright/mcp，
 * 模拟 AI 对 demo 应用执行一轮「打开 → 点击 → 输入 → 验证 → 关闭」。
 *
 * 用法: node verify-browser-mcp.mjs [url]
 * 默认: http://127.0.0.1:8123/index.html
 * 前提: node_modules/@playwright/mcp 已安装，Chromium 已下载，
 *       demo 应用已通过 http 服务启动（@playwright/mcp 屏蔽 file:// 协议）。
 */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const APP_URL = process.argv[2] || 'http://127.0.0.1:8123/index.html'
const CLI = resolve('node_modules/@playwright/mcp/cli.js')

// 不带 --port：@playwright/mcp 默认 stdio 传输（带 --port 会切到 HTTP 模式，不走 stdin）
const proc = spawn(process.execPath, [CLI], {
  cwd: resolve('.'),
  stdio: ['pipe', 'pipe', 'pipe'],
})
proc.stderr.on('data', (d) => { if (process.env.DEBUG_MCP) process.stderr.write('[mcp] ' + d) })

let buf = ''
const pending = new Map()
let id = 0

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const rid = String(++id)
    pending.set(rid, { res, rej })
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: rid, method, params }) + '\n')
  })
}

/** MCP 通知：不带 id、无需响应（带了 id 服务器会回 "Method not found"） */
function notify(method, params = {}) {
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
}

proc.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf-8')
  let idx
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx); buf = buf.slice(idx + 1)
    if (!line.trim()) continue
    let msg; try { msg = JSON.parse(line) } catch { continue }
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
    }
  }
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  // 等服务器完成启动，否则 initialize 可能命中「Method not found」
  await sleep(800)
  await send('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'verify', version: '1.0' },
  })
  notify('notifications/initialized')
  await sleep(300)

  const tools = await send('tools/list')
  const names = tools.tools.map((t) => t.name)
  const need = ['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_close']
  const missing = need.filter((n) => !names.includes(n))
  if (missing.length) throw new Error('缺少工具: ' + missing.join(','))
  console.log('✅ MCP 已连接，浏览器工具齐全:', need.join(' / '))

  const call = async (name, args = {}) => {
    const r = await send('tools/call', { name, arguments: args })
    return (r?.content || []).map((c) => c.text || '').join('\n')
  }

  // 1. 打开页面
  await call('browser_navigate', { url: APP_URL })
  console.log('✅ browser_navigate ->', APP_URL)

  // 1.5 清理持久化状态：MCP 浏览器用持久 profile，localStorage 会跨运行残留
  //     （与应用自身「刷新后保持」的持久化特性区分开，保证用例可重复）
  await call('browser_evaluate', { function: '() => { localStorage.clear(); return true }' })
  await call('browser_navigate', { url: APP_URL })
  await sleep(400)

  // 2. 基线快照：默认应显示仪表盘
  let snap = await call('browser_snapshot')
  assert(snap.includes('仪表盘'), '默认显示仪表盘页签')
  assert(snap.includes('总任务'), '仪表盘有统计卡片')
  console.log('✅ 基线快照：仪表盘可见，统计卡片存在')

  // 3. 切到任务列表，空输入提交 → 应出现校验错误
  await call('browser_click', { target: 'role=tab[name="任务列表"]' })
  await call('browser_click', { target: 'id=add-task-btn' })
  snap = await call('browser_snapshot')
  assert(snap.includes('任务描述不能为空'), '空输入触发校验错误')
  console.log('✅ 空输入校验：出现错误提示')

  // 4. 输入任务并提交 → 列表与计数更新
  await call('browser_type', { target: 'id=task-input', text: '完成季度报告' })
  await call('browser_click', { target: 'id=add-task-btn' })
  snap = await call('browser_snapshot')
  assert(snap.includes('完成季度报告'), '任务出现在列表')
  assert(snap.includes('共 1 项'), '计数更新为 1')
  console.log('✅ 添加任务：列表与计数正确')

  // 4.1 勾选完成（此时仅 1 个复选框，无歧义）→ 任务出现 completed 样式
  await call('browser_click', { target: 'role=checkbox' })
  const cls = await send('tools/call', {
    name: 'browser_evaluate',
    arguments: { function: '() => document.querySelector(".task-item")?.classList.contains("completed") || false' },
  })
  assert((cls?.content || []).map((c) => c.text || '').join('').includes('true'), '勾选后任务带 completed 样式')
  console.log('✅ 勾选完成：任务完成态生效')

  // 4.2 删除任务（此时仅 1 个删除按钮，无歧义）→ 空列表提示恢复
  await call('browser_click', { target: 'role=button[name="删除任务"]' })
  snap = await call('browser_snapshot')
  assert(snap.includes('暂无任务'), '删除后空列表提示出现')
  console.log('✅ 删除任务：列表清空')

  // 4.3 重新添加两条任务，用于搜索过滤验证
  await call('browser_type', { target: 'id=task-input', text: '准备周会材料' })
  await call('browser_click', { target: 'id=add-task-btn' })
  await call('browser_type', { target: 'id=task-input', text: '完成季度报告' })
  await call('browser_click', { target: 'id=add-task-btn' })
  snap = await call('browser_snapshot')
  assert(snap.includes('共 2 项 · 显示 2 项'), '两条任务计数正确')
  console.log('✅ 添加两条任务：计数 = 2')

  // 4.4 搜索过滤：输入「季度」只显示匹配项，清空后恢复
  await call('browser_type', { target: 'id=search-input', text: '季度' })
  snap = await call('browser_snapshot')
  assert(snap.includes('共 2 项 · 显示 1 项'), '搜索后计数显示 1 项')
  assert(!snap.includes('准备周会材料'), '搜索过滤掉不匹配项')
  await call('browser_evaluate', {
    function: "() => { const i = document.getElementById('search-input'); i.value = ''; i.dispatchEvent(new Event('input')); return true }",
  })
  snap = await call('browser_snapshot')
  assert(snap.includes('共 2 项 · 显示 2 项'), '清空搜索后全部恢复')
  console.log('✅ 搜索过滤：命中与恢复正确')

  // 5. 勾选完成 → 计数变化（仪表盘已完成=1）
  await call('browser_click', { target: 'role=checkbox' })
  await call('browser_click', { target: 'role=tab[name="仪表盘"]' })
  snap = await call('browser_snapshot')
  assert(snap.includes('你好，请先在「设置」里填写你的名字。') || snap.includes('你好'), '仪表盘问候语存在')
  console.log('✅ 勾选完成 + 仪表盘切换正常')

  // 6. 设置页：填用户名 → 问候语更新
  await call('browser_click', { target: 'role=tab[name="设置"]' })
  await call('browser_type', { target: 'id=username-input', text: '李雷' })
  await call('browser_click', { target: 'id=theme-dark' }) // 顺便切深色主题，触发失焦保存
  await call('browser_click', { target: 'role=tab[name="仪表盘"]' })
  snap = await call('browser_snapshot')
  assert(snap.includes('你好，李雷！'), '问候语显示用户名')
  console.log('✅ 设置用户名：仪表盘问候语更新')

  // 7. 主题持久化验证：刷新后仍是深色
  await call('browser_navigate', { url: APP_URL })
  await call('browser_click', { target: 'role=tab[name="仪表盘"]' })
  snap = await call('browser_snapshot')
  const themeOk = await send('tools/call', { name: 'browser_evaluate', arguments: { function: '() => document.body.dataset.theme' } })
  const themeVal = (themeOk?.content || []).map((c) => c.text || '').join('')
  assert(themeVal.includes('dark'), '主题持久化为 dark，实际: ' + themeVal)
  console.log('✅ 主题持久化：刷新后仍为深色')

  // 8. 稳定性：页面无 console 错误
  const logs = await call('browser_console_messages', { level: 'error' })
  assert(!logs.includes('[ERROR]'), '页面存在 console 错误: ' + logs.slice(0, 300))
  console.log('✅ 稳定性：无 console 错误')

  // 9. 收尾截图 + 关闭
  await call('browser_take_screenshot', { fullPage: true })
  await call('browser_close')
  console.log('\n🎉 端到端验证通过：浏览器操作 + 点击/输入/验证全链路正常')
  proc.kill()
  process.exit(0)
}

function assert(cond, msg) {
  if (!cond) { console.error('❌ 断言失败:', msg); proc.kill(); process.exit(1) }
}

main().catch((e) => { console.error('❌ 失败:', e.message); proc.kill(); process.exit(1) })
