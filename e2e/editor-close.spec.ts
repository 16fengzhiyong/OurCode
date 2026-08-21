import { test, expect, _electron as electron, type Page } from '@playwright/test'
import path from 'path'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

/** Dismiss the first-run onboarding modal. It mounts only AFTER the app's
 *  async boot completes (which can take several seconds), so wait until the
 *  splash is gone and no dialog shows for a moment before giving up. */
async function dismissOnboarding(win: Page): Promise<void> {
  let readyStreak = 0
  for (let i = 0; i < 60; i++) {
    const dialog = win.locator('[role="dialog"][aria-label="欢迎使用"]').first()
    const visible = await dialog.isVisible({ timeout: 300 }).catch(() => false)
    if (visible) {
      readyStreak = 0
      const skip = dialog.locator('button', { hasText: '跳过' }).first()
      if (await skip.isVisible().catch(() => false)) {
        await skip.click()
        await win.waitForTimeout(400)
        continue
      }
      await win.waitForTimeout(300)
      continue
    }
    const splashGone = !(await win.locator('#splash-screen').isVisible().catch(() => false))
    if (splashGone) {
      readyStreak += 1
      if (readyStreak >= 4) return
    } else {
      readyStreak = 0
    }
    await win.waitForTimeout(400)
  }
}

/** Robustly find the main app window (not DevTools), dismissing the first-run
 *  onboarding modal if it shows. */
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
  await dismissOnboarding(page)
  return page
}

async function openProject(win: Page, app: import('@playwright/test').ElectronApplication, dir: string) {
  await dismissOnboarding(win)
  await app.evaluate(({ dialog }, folder) => {
    ;(dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, dir)
  await win.keyboard.press('Control+o')
  // Opening a folder may land in the tree view of the previously active
  // project — go back to the project list, then open the new folder's card
  // (recent projects render as div.group cards). Re-press Ctrl+O in the loop:
  // the first press can be lost while the window is still settling.
  await expect(async () => {
    await win.keyboard.press('Control+o')
    await win.waitForTimeout(600)
    const backBtn = win.locator('button:has-text("项目列表")').first()
    if (await backBtn.isVisible().catch(() => false)) {
      await backBtn.click()
      await win.waitForTimeout(400)
    }
    const projName = dir.split(/[/\\]/).pop() || ''
    await expect(win.locator(`div.group:has-text("${projName}")`).first()).toBeVisible({ timeout: 4000 })
  }).toPass({ timeout: 25000 })
  await dismissOnboarding(win)
  await win.locator(`div.group:has-text("${dir.split(/[/\\]/).pop()}")`).first().dblclick()
  await expect(win.locator('#file-tree-root >> text=a.ts').first()).toBeVisible({ timeout: 8000 })
}

test.describe('Editor area close', () => {
  test('closing the editor area clears tabs and does not carry them over', async () => {
    test.setTimeout(150000)

    const dir = await mkdtemp(join(tmpdir(), 'closearea-'))
    await writeFile(join(dir, 'a.ts'), 'aaa', 'utf-8')
    await writeFile(join(dir, 'b.ts'), 'bbb', 'utf-8')

    try {
      // ── Launch #1: open a.ts + b.ts, then close the editor area ──
      const app1 = await electron.launch({ args: [path.join(__dirname, '../dist-electron/main.js')] })
      const win1 = await mainWindow(app1)
      if (await win1.locator('text=恢复未保存的更改').first().isVisible().catch(() => false)) {
        await win1.mouse.click(10, 10)
        await win1.waitForTimeout(300)
      }
      await win1.evaluate(() => (window as any).electronAPI.clearBackups())
      await openProject(win1, app1, dir)

      const closeBtn = win1.locator('button[title^="关闭编辑面板"]').first()
      await win1.locator('#file-tree-root >> text=a.ts').first().click()
      await expect(closeBtn).toBeVisible({ timeout: 8000 })
      await win1.locator('#file-tree-root >> text=b.ts').first().click()
      await win1.waitForTimeout(600)

      // Click the editor-area close button
      await closeBtn.click()
      await win1.waitForTimeout(800)

      // Editor area hidden and the persisted session no longer carries a.ts/b.ts
      const closeBtnGone = !(await closeBtn.isVisible().catch(() => false))
      console.log('editor hidden after close:', closeBtnGone)
      expect(closeBtnGone).toBe(true)
      const sessionAfter = await win1.evaluate(() => localStorage.getItem('ourcode.editorSession.v1'))
      console.log('session after close:', sessionAfter)
      expect(sessionAfter === null || !sessionAfter.includes('a.ts')).toBe(true)

      // Reopen a file → ONLY a.ts comes back, b.ts must NOT be carried
      await win1.locator('#file-tree-root >> text=a.ts').first().click()
      await win1.waitForTimeout(800)
      const aTabVisible = await win1.locator('.rounded-full:has-text("a.ts")').first().isVisible().catch(() => false)
      const bTabVisible = await win1.locator('.rounded-full:has-text("b.ts")').first().isVisible().catch(() => false)
      console.log('after reopen — a.ts tab:', aTabVisible, 'b.ts tab:', bTabVisible)
      expect(aTabVisible).toBe(true)
      expect(bTabVisible).toBe(false)
      await app1.close()

      // ── Launch #2: only a.ts may come back from the session, never b.ts ──
      const app2 = await electron.launch({ args: [path.join(__dirname, '../dist-electron/main.js')] })
      const win2 = await mainWindow(app2)
      if (await win2.locator('text=恢复未保存的更改').first().isVisible().catch(() => false)) {
        await win2.mouse.click(10, 10)
        await win2.waitForTimeout(300)
      }
      await win2.waitForTimeout(3000)
      const bAfterRestart = await win2.locator('.rounded-full:has-text("b.ts")').first().isVisible().catch(() => false)
      console.log('b.ts after restart:', bAfterRestart)
      expect(bAfterRestart).toBe(false)
      await app2.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
