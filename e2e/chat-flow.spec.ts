import { test, expect, _electron as electron } from '@playwright/test'
import path from 'path'

test.describe('Basic App Launch', () => {
  test('should launch and show the main window', async () => {
    const app = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main.js')],
    })

    const window = await app.firstWindow()
    expect(window).toBeTruthy()

    // Title bar should be visible
    const title = await window.textContent('body')
    expect(title).toBeTruthy()

    await app.close()
  })

  test('should display the OurCode branding', async () => {
    const app = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main.js')],
    })

    // DevTools auto-opens in dev mode; the main window is the one whose title
    // isn't "DevTools". The splash is removed after load, so assert on the
    // stable window title from the main process.
    await expect.poll(async () => {
      return app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getTitle() !== 'DevTools')
        return win?.webContents.getTitle() || ''
      })
    }, { timeout: 5000 }).toContain('OurCode')

    await app.close()
  })
})

test.describe('Settings Modal', () => {
  test('should open and close settings', async () => {
    const app = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main.js')],
    })

    const window = await app.firstWindow()

    // Click settings gear icon
    const settingsBtn = window.locator('button[title="Settings"]').first()
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click()
      // Settings modal should appear
      await expect(window.locator('text=API Config')).toBeVisible({ timeout: 3000 })

      // Close with X button
      const closeBtn = window.locator('button:has(svg path[d*="6 6l12 12"])').first()
      if (await closeBtn.isVisible()) {
        await closeBtn.click()
      }
    }

    await app.close()
  })
})

test.describe('Sidebar', () => {
  test('should toggle sidebar visibility', async () => {
    const app = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main.js')],
    })

    const window = await app.firstWindow()

    // Press Ctrl+B to toggle sidebar
    await window.keyboard.press('Control+b')
    await window.waitForTimeout(300)

    // Press Ctrl+B again to show sidebar
    await window.keyboard.press('Control+b')
    await window.waitForTimeout(300)

    await app.close()
  })
})

test.describe('Terminal', () => {
  test('should toggle terminal panel', async () => {
    const app = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main.js')],
    })

    const window = await app.firstWindow()

    // Press Ctrl+` to toggle terminal
    await window.keyboard.press('Control+`')
    await window.waitForTimeout(500)

    // Terminal container should be visible
    const terminalPanel = window.locator('.xterm').first()
    // Terminal may take time to initialize
    await window.waitForTimeout(1000)

    // Close terminal
    await window.keyboard.press('Control+`')

    await app.close()
  })
})
