import { test, expect, _electron as electron, type Page, type ElectronApplication } from '@playwright/test'
import path from 'path'

// 一次性探针：主窗口底部「一人公司」入口打开独立办公室窗口 → 记录新窗口内
// 8 标签在画布中的 NDC → 拖动上下分割条 → 再记录 → 对比 NDC 是否不变
// （验证取景已冻结，拖动不再改变构图）。
async function mainWindow(app: ElectronApplication): Promise<Page> {
  let page: Page | undefined
  await expect
    .poll(async () => {
      const pages = app.windows()
      for (const p of pages) {
        const win = await app.browserWindow(p).catch(() => null)
        if (!win) continue
        const title: string = await win.evaluate((w) => w.getTitle()).catch(() => '')
        if (/OurCode/i.test(title)) { page = p; return true }
      }
      return false
    }, { timeout: 20000 })
    .toBe(true)
  return page!
}

async function openOfficeWindow(app: ElectronApplication, main: Page): Promise<Page> {
  const officeBtn = main.locator('button[aria-label*="一人公司"], button[aria-label*="One-Person"], button[aria-label*="办公室"], button[aria-label*="Office"]').first()
  await officeBtn.click()
  let office: Page | undefined
  await expect
    .poll(async () => {
      office = app.windows().find((p) => p !== main)
      return office ? true : false
    }, { timeout: 20000 })
    .toBe(true)
  await expect(office!.locator('#office3d-root')).toBeVisible({ timeout: 15000 })
  return office!
}

test('verify camera framing is frozen on drag', async () => {
  const app = await electron.launch({ args: [path.join(__dirname, '../dist-electron/main.js')] })
  const main = await mainWindow(app)
  const page = await openOfficeWindow(app, main)

  await expect(page.locator('#office3d-root canvas')).toHaveCount(1, { timeout: 15000 })
  await expect(page.locator('.office3d-tag')).toHaveCount(8, { timeout: 10000 })
  await page.waitForTimeout(1200)

  const readNDC = async () => {
    const canvas = await page.locator('#office3d-root .office3d-stage canvas').boundingBox()
    const tags = await page.locator('.office3d-tag').evaluateAll((els) =>
      els.map((el) => {
        const r = (el as HTMLElement).getBoundingClientRect()
        return { id: (el as HTMLElement).dataset.agent, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
      }),
    )
    return {
      canvas,
      tags: tags.map((t) => ({
        id: t.id,
        ndcX: ((t.cx - canvas!.x) / canvas!.width) * 2 - 1,
        ndcY: -(((t.cy - canvas!.y) / canvas!.height) * 2 - 1),
      })),
    }
  }

  const before = await readNDC()
  console.log('BEFORE canvas:', JSON.stringify(before.canvas))
  console.log('BEFORE ndc:', JSON.stringify(before.tags.map((t) => `${t.id}:${t.ndcX.toFixed(3)},${t.ndcY.toFixed(3)}`)))

  // 拖动上下分割条（场景/对话之间）向下 90px → 场景变矮、宽高比变化
  const resizer = page.locator('#office3d-root .cursor-row-resize').first()
  await resizer.hover()
  const rb = await resizer.boundingBox()
  await page.mouse.move(rb!.x + rb!.width / 2, rb!.y + rb!.height / 2)
  await page.mouse.down()
  await page.mouse.move(rb!.x + rb!.width / 2, rb!.y + rb!.height / 2 + 90, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(1500)

  const after = await readNDC()
  console.log('AFTER canvas:', JSON.stringify(after.canvas))
  console.log('AFTER ndc:', JSON.stringify(after.tags.map((t) => `${t.id}:${t.ndcX.toFixed(3)},${t.ndcY.toFixed(3)}`)))

  // 取景冻结 → 8 个标签的 NDC 基本不变（允许 ±0.025 容差，含拖动过渡帧）
  const maxDelta = Math.max(
    ...before.tags.map((t, i) => {
      const a = after.tags.find((x) => x.id === t.id)!
      return Math.max(Math.abs(a.ndcX - t.ndcX), Math.abs(a.ndcY - t.ndcY))
    }),
  )
  console.log('MAX NDC DELTA:', maxDelta.toFixed(4))
  expect(maxDelta).toBeLessThan(0.025)

  await page.screenshot({ path: 'test-results/office-view-frozen.png' })
  await app.close()
})
