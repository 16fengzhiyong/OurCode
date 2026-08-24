import { test, expect, _electron as electron, type Page, type ElectronApplication } from '@playwright/test'
import path from 'path'

/**
 * 「一人公司」独立窗口冒烟测试（vendored office-v3）。
 * 主窗口底部「一人公司」入口（活动栏底部、设置上方）→ 打开独立办公室窗口 →
 * 断言新窗口 #office3d-root 内出现 WebGL canvas 与 8 个悬浮标签，且过程中无
 * office/three 相关 console 报错。办公室窗口与主窗口相互独立。
 */

async function mainWindow(app: ElectronApplication): Promise<Page> {
  // DevTools auto-opens in dev mode; 主窗口标题含 "OurCode"（与 chat-flow.spec
  // 同款判定）。窗口事件可能晚于 launch 返回，轮询等待。
  let page: Page | undefined
  await expect
    .poll(async () => {
      const pages = app.windows()
      for (const p of pages) {
        const win = await app.browserWindow(p).catch(() => null)
        if (!win) continue
        const title: string = await win.evaluate((w) => w.getTitle()).catch(() => '')
        if (/OurCode/i.test(title)) {
          page = p
          return true
        }
      }
      return false
    }, { timeout: 20000 })
    .toBe(true)
  return page!
}

/** 点击主窗口底部「一人公司」入口，等待独立办公室窗口出现并返回其 Page。 */
async function openOfficeWindow(app: ElectronApplication, main: Page): Promise<Page> {
  const officeBtn = main.locator('button[aria-label*="一人公司"], button[aria-label*="One-Person"], button[aria-label*="办公室"], button[aria-label*="Office"]').first()
  await expect(officeBtn).toBeVisible({ timeout: 15000 })
  await officeBtn.click()

  // 新窗口（独立渲染进程）—— office 模式窗口与主窗口标题相同，按 Page 身份区分。
  let office: Page | undefined
  await expect
    .poll(async () => {
      office = app.windows().find((p) => p !== main)
      return office ? true : false
    }, { timeout: 20000 })
    .toBe(true)

  // 等办公室视图挂载（场景根节点出现）
  await expect(office!.locator('#office3d-root')).toBeVisible({ timeout: 15000 })
  return office!
}

test('office view mounts the 3D scene in its own window', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '../dist-electron/main.js')],
  })
  const main = await mainWindow(app)
  const office = await openOfficeWindow(app, main)

  const consoleErrors: string[] = []
  office.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  // 场景根节点 + WebGL canvas 出现
  await expect(office.locator('#office3d-root canvas')).toHaveCount(1, { timeout: 15000 })

  // 悬浮标签渲染出 8 个
  await expect(office.locator('.office3d-tag')).toHaveCount(8, { timeout: 10000 })

  // 新布局：左侧项目/任务栏 + 右下对话区已挂载（3D 场景保持可见）
  await expect(office.locator('#office3d-root [data-testid="office-projects-panel"]')).toBeVisible()
  await expect(office.locator('#office3d-root [data-testid="office-chat-pane"]')).toBeVisible()

  // 无 office/three/WebGL 相关报错
  const relevant = consoleErrors.filter(
    (e) => /office|three|WebGL|webgl|office3d/i.test(e) && !/Autofill|DevTools/i.test(e),
  )
  expect(relevant, `console errors: ${relevant.join(' | ')}`).toEqual([])

  await app.close()
})
