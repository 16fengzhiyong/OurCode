import { test, expect, _electron as electron, type Page } from '@playwright/test'
import path from 'path'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

/** Robustly find the main app window (not DevTools). */
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

test.describe('Hot Exit', () => {
  test('backs up an unsaved buffer and restores it on relaunch', async () => {
    test.setTimeout(120000)

    const dir = await mkdtemp(join(tmpdir(), 'hotexit-'))
    await writeFile(join(dir, 'hello.ts'), 'hello', 'utf-8')

    try {
      // ── Launch #1: open the file, disable autosave, edit, leave unsaved ──
      const app1 = await electron.launch({ args: [path.join(__dirname, '../dist-electron/main.js')] })
      const win1 = await mainWindow(app1)

      // Clean slate: dismiss any restore modal left by a previous failed run
      if (await win1.locator('text=恢复未保存的更改').first().isVisible().catch(() => false)) {
        await win1.mouse.click(10, 10)
        await win1.waitForTimeout(300)
      }
      await win1.evaluate(() => (window as any).electronAPI.clearBackups())

      // Open the temp folder via the (stubbed) folder dialog — the stub must go
      // on the main process; the renderer's electronAPI is frozen by contextBridge
      await app1.evaluate(({ dialog }, folder) => {
        ;(dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
      }, dir)
      await win1.keyboard.press('Control+o')
      // Ctrl+O opens the folder into the PROJECT LIST (new Stitch flow) — the
      // file tree only mounts after double-clicking the project card.
      await expect(async () => {
        await win1.keyboard.press('Control+o')
        await expect(win1.locator(`text=${dir}`).first()).toBeVisible({ timeout: 4000 })
      }).toPass({ timeout: 25000 })
      await win1.locator(`text=${dir}`).first().dblclick()
      await expect(win1.locator('#file-tree-root >> text=hello.ts').first()).toBeVisible({ timeout: 8000 })

      // Open hello.ts in the editor
      await win1.locator('#file-tree-root >> text=hello.ts').first().click()
      await win1.waitForTimeout(800)

      // No autosave anymore — the buffer stays dirty until explicitly saved.

      // Type at the end of the file → dirty buffer → debounced backup. Focus
      // Monaco directly (a Playwright click waits on the blinking cursor).
      await win1.evaluate(() => {
        const ed = (window as any).__monacoEditor
        const model = ed?.getModel()
        if (ed && model) {
          const lastLine = model.getLineCount()
          ed.setPosition({ lineNumber: lastLine, column: model.getLineMaxColumn(lastLine) })
          ed.focus()
        }
      })
      await win1.keyboard.type(' world')
      await win1.waitForTimeout(2500) // backup debounce (1.5s) + margin

      const backups1 = await win1.evaluate(() => (window as any).electronAPI.listBackups())
      expect(backups1.some((b: { filePath: string }) => b.filePath.endsWith('hello.ts'))).toBe(true)

      await app1.close()
      await new Promise((r) => setTimeout(r, 500)) // let the first process exit fully

      // ── Launch #2: the restore prompt lists and restores the file ──
      const app2 = await electron.launch({ args: [path.join(__dirname, '../dist-electron/main.js')] })
      const win2 = await mainWindow(app2)
      try {
        await expect(win2.locator('text=恢复未保存的更改').first()).toBeVisible({ timeout: 8000 })
        await expect(win2.locator('text=hello.ts').first()).toBeVisible({ timeout: 3000 })

        await win2.locator('button', { hasText: '恢复' }).first().click()
        await win2.waitForTimeout(1500)

        const editorText = await win2.evaluate(() => {
          const ed = (window as any).__monacoEditor
          return ed?.getModel()?.getValue() || ''
        })
        expect(editorText).toContain('hello world')

        const backups2 = await win2.evaluate(() => (window as any).electronAPI.listBackups())
        expect(backups2).toHaveLength(0)
      } finally {
        // Never leave a backup behind, even if a mid-test assertion failed
        await win2.evaluate(() => (window as any).electronAPI.clearBackups()).catch(() => {})
        await app2.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })
})
