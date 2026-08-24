import { test, expect, _electron as electron, type Page, type ElectronApplication } from '@playwright/test'
import path from 'path'
import { mkdtemp, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

async function mainWindow(app: ElectronApplication): Promise<Page> {
  let page: Page | undefined
  await expect.poll(async () => {
    for (const p of app.windows()) {
      try { if (await p.evaluate(() => typeof window.electronAPI !== 'undefined')) { page = p; return true } } catch { /* */ }
    }
    return false
  }, { timeout: 30000 }).toBe(true)
  return page!
}

async function officeWindow(app: ElectronApplication, main: Page): Promise<Page> {
  let office: Page | undefined
  await expect.poll(async () => {
    for (const p of app.windows()) {
      if (p === main) continue
      try {
        if (await p.evaluate(() => typeof window.electronAPI !== 'undefined' && document.getElementById('office3d-root') !== null)) { office = p; return true }
      } catch { /* */ }
    }
    return false
  }, { timeout: 30000 }).toBe(true)
  return office!
}

test('office: double-click project opens file tree IN the office panel', async () => {
  test.setTimeout(120000)
  const dir = await mkdtemp(join(tmpdir(), 'officetree-'))
  await mkdir(join(dir, 'src'), { recursive: true })
  await writeFile(join(dir, 'src', 'main.ts'), 'export const x = 1\n', 'utf-8')
  await writeFile(join(dir, 'README.md'), '# hi\n', 'utf-8')

  const app = await electron.launch({ args: [path.join(__dirname, '../dist-electron/main.js')] })
  const main = await mainWindow(app)
  const officeBtn = main.locator('button[aria-label*="一人公司"], button[aria-label*="One-Person"], button[aria-label*="办公室"], button[aria-label*="Office"]').first()
  await expect(officeBtn).toBeVisible({ timeout: 15000 })
  await officeBtn.click()
  const office = await officeWindow(app, main)
  await expect(office.locator('#office3d-root')).toBeVisible({ timeout: 30000 })

  // 打开项目（mock 对话框）→ 树应在办公室左侧栏内就地打开，办公室视图不退出
  await app.evaluate(({ dialog }, folder) => {
    ;(dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, dir)
  const openBtn = office.locator('#office3d-root button:has-text("打开项目")').first()
  await expect(openBtn).toBeVisible({ timeout: 10000 })
  await openBtn.click()
  await office.waitForTimeout(2500)

  // 办公室视图应保持显示（不退出），且左侧栏出现该项目的文件树
  const officeStill = await office.locator('#office3d-root').isVisible().catch(() => false)
  const inPanelTree = await office.locator('#office3d-root #file-tree-root').first().isVisible().catch(() => false)
  const treeText = await office.evaluate(() => document.getElementById('file-tree-root')?.innerText || '')
  console.log('OFFICE STILL VISIBLE:', officeStill, '| IN-PANEL TREE:', inPanelTree, '| TREE:', JSON.stringify(treeText.slice(0, 80)))
  expect(officeStill).toBe(true)
  expect(inPanelTree).toBe(true)
  expect(treeText).toContain('src')

  // 双击项目卡片也应就地打开树（先返回项目列表）
  const backBtn = office.locator('#office3d-root button[title="返回项目"]').first()
  await backBtn.click()
  await office.waitForTimeout(500)
  const card = office.locator('#office3d-root div[title*="双击打开项目"]').filter({ hasText: 'officetree-' }).first()
  const n = await card.count()
  console.log('CARD COUNT:', n)
  if (n > 0) {
    await card.dblclick()
    await office.waitForTimeout(2000)
    const officeStill2 = await office.locator('#office3d-root').isVisible().catch(() => false)
    const tree2 = await office.locator('#office3d-root #file-tree-root').first().isVisible().catch(() => false)
    const taskPanel = await office.locator('aside h2:has-text("任务面板")').first().isVisible().catch(() => false)
    console.log('DBLCLICK → office still:', officeStill2, '| in-panel tree:', tree2, '| 任务面板:', taskPanel)
    expect(officeStill2).toBe(true)
    expect(tree2).toBe(true)
    expect(taskPanel).toBe(false)
  }

  // 点文件树里的文件 → 应进入工作区编辑器（办公室视图让位）
  const fileRow = office.locator('#office3d-root #file-tree-root >> text=main.ts').first()
  if (await fileRow.isVisible().catch(() => false)) {
    await fileRow.click()
    await office.waitForTimeout(2000)
    const officeGone = await office.locator('#office3d-root').isVisible().catch(() => false)
    console.log('AFTER FILE CLICK → office overlay gone:', !officeGone)
  }

  // 清理：本测试用默认 userData，把临时项目从最近列表里移除，避免污染真实数据
  try {
    await office.evaluate(() => {
      for (const k of ['recentProjects_office', 'recentProjectTimes_office']) {
        try {
          const raw = localStorage.getItem(k)
          if (!raw) continue
          const v = JSON.parse(raw)
          if (Array.isArray(v)) {
            const nv = v.filter((x) => typeof x !== 'string' || !/officetree-/.test(x))
            if (nv.length !== v.length) localStorage.setItem(k, JSON.stringify(nv))
          } else if (v && typeof v === 'object') {
            let changed = false
            for (const key of Object.keys(v)) if (/officetree-/.test(key)) { delete v[key]; changed = true }
            if (changed) localStorage.setItem(k, JSON.stringify(v))
          }
        } catch { /* ignore */ }
      }
    })
  } catch { /* window may be closed */ }

  await app.close()
})
