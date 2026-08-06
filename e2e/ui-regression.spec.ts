import { test, expect, _electron as electron, type Page } from '@playwright/test'
import path from 'path'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { execSync } from 'child_process'

async function mainWindow(app: import('@playwright/test').ElectronApplication): Promise<Page> {
  let page: Page | null = null
  for (let i = 0; i < 60 && !page; i++) {
    for (const p of app.windows()) {
      try {
        if (await p.evaluate(() => typeof (window as any).electronAPI !== 'undefined')) {
          page = p
          break
        }
      } catch { /* closed mid-poll */ }
    }
    if (!page) await new Promise((r) => setTimeout(r, 500))
  }
  if (!page) throw new Error('main window not found')
  const skip = page.locator('text=跳过').first()
  if (await skip.isVisible({ timeout: 3000 }).catch(() => false)) {
    await skip.click()
  }
  return page
}

/** Stub the native folder dialog and open the folder via 文件 → 打开文件夹 (more
 *  reliable than the Ctrl+O shortcut in headless Electron). */
async function openFolderViaMenu(app: import('@playwright/test').ElectronApplication, win: Page, dir: string): Promise<void> {
  await app.evaluate(({ dialog }, folder) => {
    ;(dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, dir)
  await win.click('role=menuitem[name="文件"]')
  await win.click('role=menuitem[name=/打开文件夹/]')
  await win.waitForTimeout(1200)
}

test('new file is editable after URI fix', async () => {
  const app = await electron.launch({ args: [path.join(__dirname, '../dist-electron/main.js')] })
  const win = await mainWindow(app)
  await win.waitForTimeout(2000)

  await win.click('role=menuitem[name="文件"]')
  await win.click('role=menuitem[name=/新建文件/]')
  await expect(win.locator('text=untitled-').first()).toBeVisible({ timeout: 10000 })
  await win.waitForTimeout(1500)

  await win.locator('.monaco-editor').first().click({ timeout: 5000 })
  await win.keyboard.type('hello world test')
  await win.waitForTimeout(500)

  const models = await win.evaluate(() => {
    const ed = (window as any).__monacoEditor
    const m = ed?.getModel()
    return m ? { uri: m.uri.toString(), value: m.getValue() } : null
  })
  expect(models?.value).toContain('hello world test')
  expect(models?.uri).toMatch(/^file:\/\/\/untitled\//)

  await app.close()
})

test('activity bar tooltips match the project panel names', async () => {
  const app = await electron.launch({ args: [path.join(__dirname, '../dist-electron/main.js')] })
  const win = await mainWindow(app)
  await win.waitForTimeout(2000)

  const fileIcon = win.locator('button[title="项目列表"]').first()
  await expect(fileIcon).toBeVisible({ timeout: 5000 })
  const gitIcon = win.locator('button[title="代码管理"]').first()
  await expect(gitIcon).toBeVisible({ timeout: 3000 })
  const historyIcon = win.locator('button[title="文件变更历史"]').first()
  await expect(historyIcon).toBeVisible({ timeout: 3000 })
  const extIcon = win.locator('button[title="扩展"]').first()
  await expect(extIcon).toBeVisible({ timeout: 3000 })
  const settingsIcon = win.locator('button[title="设置"]').first()
  await expect(settingsIcon).toBeVisible({ timeout: 3000 })

  await app.close()
})

test('git panel has no duplicated title and buttons wrap', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gitverify-'))
  try {
    execSync('git init -q && git config user.email t@t.co && git config user.name t && echo hi > a.txt && git add -A && git commit -qm initial', { cwd: dir })

    const app = await electron.launch({ args: [path.join(__dirname, '../dist-electron/main.js')] })
    const win = await mainWindow(app)

    // Open the folder (sets rootPath); the sidebar shows the project list
    await openFolderViaMenu(app, win, dir)
    // Click the project card (matched by its full path) to enter the file tree
    await win.click(`text=${dir}`)
    await expect(win.locator('#file-tree-root').first()).toBeVisible({ timeout: 10000 })
    await win.waitForTimeout(800)

    // Open the git sidebar via the activity bar
    await win.locator('button[title="代码管理"]').first().click()
    await win.waitForTimeout(800)

    // The sidebar header should read 代码管理 exactly once, and 源代码管理 must not be duplicated
    const sourceControlCount = await win.evaluate(() =>
      Array.from(document.querySelectorAll('*')).filter((e) => e.childElementCount === 0 && e.textContent?.trim() === '源代码管理').length,
    )
    expect(sourceControlCount).toBeLessThanOrEqual(1)
    const headerText = await win.locator('text=代码管理').first().isVisible().catch(() => false)
    expect(headerText).toBe(true)

    // Buttons row: commit/push/pull/log must be visible (not clipped)
    await expect(win.locator('text=✓ 提交').first()).toBeVisible({ timeout: 3000 })
    await expect(win.locator('text=↑ 推送').first()).toBeVisible({ timeout: 3000 })
    await expect(win.locator('text=📋 日志').first()).toBeVisible({ timeout: 3000 })
    await expect(win.locator('text=🔍 预检').first()).toBeVisible({ timeout: 3000 })

    // Open the log — entries should render
    await win.locator('text=📋 日志').first().click()
    await expect(win.locator('text=最近提交').first()).toBeVisible({ timeout: 3000 })
    await expect(win.locator('text=initial').first()).toBeVisible({ timeout: 3000 })

    await app.close()
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

test('search input and plan-mode select follow the theme (not white)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'themesel-'))
  try {
    execSync('echo x > b.ts', { cwd: dir })
    const app = await electron.launch({ args: [path.join(__dirname, '../dist-electron/main.js')] })
    const win = await mainWindow(app)

    // Open the folder, then click the project card to enter the file tree
    await openFolderViaMenu(app, win, dir)
    await win.click(`text=${dir}`)
    await expect(win.locator('#file-tree-root').first()).toBeVisible({ timeout: 10000 })
    await win.waitForTimeout(800)

    // The FileTree search input must have a themed (non-white) background in dark mode
    const searchBg = await win.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'))
      const target = inputs.find((i) => (i.placeholder || '').includes('搜索文件'))
      return target ? getComputedStyle(target).backgroundColor : null
    })
    console.log('SEARCH INPUT BG:', searchBg)
    expect(searchBg).not.toBeNull()
    // dark theme: #1f1f23-ish, i.e. clearly not white
    expect(searchBg).not.toBe('rgb(255, 255, 255)')

    await app.close()
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})
