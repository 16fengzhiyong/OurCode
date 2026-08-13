import { test, expect, _electron as electron, type Page } from '@playwright/test'
import path from 'path'
import { mkdtemp, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

async function mainWindow(app: import('@playwright/test').ElectronApplication): Promise<Page> {
  let page: Page | null = null
  for (let i = 0; i < 40 && !page; i++) {
    for (const p of app.windows()) {
      try {
        if (await p.evaluate(() => typeof window.electronAPI !== 'undefined')) {
          page = p
          break
        }
      } catch { /* closed mid-poll */ }
    }
    if (!page) await new Promise((r) => setTimeout(r, 500))
  }
  if (!page) throw new Error('main window not found')
  return page
}

async function openProjectFile(win: Page, app: import('@playwright/test').ElectronApplication, dir: string, fileName: string): Promise<void> {
  await app.evaluate(({ dialog }, folder) => {
    ;(dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, dir)
  await win.keyboard.press('Control+o')
  await expect(async () => {
    await win.keyboard.press('Control+o')
    await expect(win.locator(`text=${dir}`).first()).toBeVisible({ timeout: 4000 })
  }).toPass({ timeout: 25000 })
  await win.locator(`text=${dir}`).first().dblclick()
  await expect(win.locator(`#file-tree-root >> text=${fileName}`).first()).toBeVisible({ timeout: 8000 })
  await win.locator(`#file-tree-root >> text=${fileName}`).first().click()
  await win.waitForTimeout(1000)
}

async function appendToEditor(win: Page, text: string): Promise<void> {
  await win.evaluate(() => {
    const ed = (window as any).__monacoEditor
    const model = ed?.getModel()
    if (ed && model) {
      const lastLine = model.getLineCount()
      ed.setPosition({ lineNumber: lastLine, column: model.getLineMaxColumn(lastLine) })
      ed.focus()
    }
  })
  await win.keyboard.type(text)
  await win.waitForTimeout(300)
}

/** The tab bar entry for `fileName` (a rounded-full tab div). */
const tabFor = (win: Page, fileName: string) => win.locator('div.rounded-full', { hasText: fileName }).last()
/** The ✕ close button of a tab (the last button inside the tab div). */
const closeBtnOf = (tab: ReturnType<typeof tabFor>) => tab.locator('button').last()
/** The Save / Don't Save / Cancel prompt. */
const prompt = (win: Page) => win.locator('[role="dialog"]:has-text("未保存的更改")').first()

async function dismissRestoreModal(win: Page): Promise<void> {
  if (await win.locator('text=恢复未保存的更改').first().isVisible().catch(() => false)) {
    await win.mouse.click(10, 10)
    await win.waitForTimeout(300)
  }
  await win.evaluate(() => (window as any).electronAPI.clearBackups())
}

test.describe('Unsaved-close flow (no autosave)', () => {
  test('dirty tab close offers Save / Don\'t Save / Cancel', async () => {
    test.setTimeout(150000)
    const dir = await mkdtemp(join(tmpdir(), 'unsaved-close-'))
    await writeFile(join(dir, 'a.ts'), 'line one\n', 'utf-8')

    const app = await electron.launch({ args: [path.join(__dirname, '../dist-electron/main.js')] })
    const win = await mainWindow(app)
    await dismissRestoreModal(win)
    await openProjectFile(win, app, dir, 'a.ts')
    await appendToEditor(win, ' EDITED')

    // Autosave must be gone: after a beat, disk still has the original text
    await win.waitForTimeout(2500)
    expect(await readFile(join(dir, 'a.ts'), 'utf-8')).toBe('line one\n')

    // Close the tab → Save / Don't Save / Cancel dialog appears
    await closeBtnOf(tabFor(win, 'a.ts')).click()
    await expect(prompt(win)).toBeVisible({ timeout: 5000 })
    await expect(prompt(win).locator('button', { hasText: '保存' })).toBeVisible()

    // Cancel → tab stays open, content intact
    await prompt(win).locator('button', { hasText: '取消' }).click()
    await expect(tabFor(win, 'a.ts')).toBeVisible()
    const modelText = await win.evaluate(() => (window as any).__monacoEditor?.getModel()?.getValue() ?? '')
    expect(modelText).toContain('EDITED')

    // Don't Save → closes, disk unchanged
    await closeBtnOf(tabFor(win, 'a.ts')).click()
    await expect(prompt(win)).toBeVisible({ timeout: 5000 })
    await prompt(win).locator('button', { hasText: /不保存/ }).click()
    await expect(tabFor(win, 'a.ts')).toHaveCount(0, { timeout: 5000 })
    expect(await readFile(join(dir, 'a.ts'), 'utf-8')).toBe('line one\n')

    await app.close()
  })

  test('dirty tab close Save writes to disk then closes', async () => {
    test.setTimeout(150000)
    const dir = await mkdtemp(join(tmpdir(), 'unsaved-save-'))
    await writeFile(join(dir, 'b.ts'), 'hello\n', 'utf-8')

    const app = await electron.launch({ args: [path.join(__dirname, '../dist-electron/main.js')] })
    const win = await mainWindow(app)
    await dismissRestoreModal(win)
    await openProjectFile(win, app, dir, 'b.ts')
    await appendToEditor(win, ' world')

    await closeBtnOf(tabFor(win, 'b.ts')).click()
    await expect(prompt(win)).toBeVisible({ timeout: 5000 })
    await prompt(win).locator('button', { hasText: '保存' }).click()

    await expect(tabFor(win, 'b.ts')).toHaveCount(0, { timeout: 5000 })
    expect(await readFile(join(dir, 'b.ts'), 'utf-8')).toBe('hello world')

    await app.close()
  })
})
