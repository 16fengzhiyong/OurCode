import { test, expect, _electron as electron, type Page } from '@playwright/test'
import path from 'path'

/**
 * 3D 办公室视图冒烟测试（vendored office-v3）。
 * 点击活动栏「3D 智能办公室」→ 断言 #office3d-root 内出现 WebGL canvas 与
 * 8 个悬浮标签，且过程中无 office/three 相关 console 报错。
 */

async function mainWindow(app: import('@playwright/test').ElectronApplication): Promise<Page> {
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

test('office view mounts the 3D scene', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '../dist-electron/main.js')],
  })
  const window = await mainWindow(app)

  const consoleErrors: string[] = []
  window.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  // 打开 3D 办公室（活动栏图标，aria-label 来自 i18n，中英文兼容）
  const officeBtn = window.locator('button[aria-label*="办公室"], button[aria-label*="Office"]').first()
  await expect(officeBtn).toBeVisible({ timeout: 15000 })
  await officeBtn.click()

  // 场景根节点 + WebGL canvas 出现
  await expect(window.locator('#office3d-root')).toBeVisible({ timeout: 15000 })
  await expect(window.locator('#office3d-root canvas')).toHaveCount(1, { timeout: 15000 })

  // 悬浮标签渲染出 8 个
  await expect(window.locator('.office3d-tag')).toHaveCount(8, { timeout: 10000 })

  // 无 office/three/WebGL 相关报错
  const relevant = consoleErrors.filter(
    (e) => /office|three|WebGL|webgl|office3d/i.test(e) && !/Autofill|DevTools/i.test(e),
  )
  expect(relevant, `console errors: ${relevant.join(' | ')}`).toEqual([])

  await app.close()
})
