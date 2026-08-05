import { test, _electron as electron, type Page } from '@playwright/test'
import path from 'path'
import { existsSync } from 'fs'

async function mainWindow(app: import('@playwright/test').ElectronApplication): Promise<Page> {
  let page: Page | null = null
  for (let i = 0; i < 20 && !page; i++) {
    for (const p of app.windows()) {
      try {
        if (await p.evaluate(() => typeof window.electronAPI !== 'undefined')) { page = p; break }
      } catch { /* closed */ }
    }
    if (!page) await new Promise((r) => setTimeout(r, 250))
  }
  if (!page) throw new Error('main window not found')
  return page
}

const EXE = path.join(__dirname, '../release/win-unpacked/OurCode IDE.exe')

test('PACKAGED app launches and renders', async () => {
  // Opt-in: only runs after `npm run dist:win` produced the unpacked app
  test.skip(!existsSync(EXE), 'release/win-unpacked not built — run npm run dist:win first')

  const app = await electron.launch({ executablePath: EXE })
  const win = await mainWindow(app)
  const title = await win.title()
  console.log('PACKAGED title =', title)
  const bodyLen = (await win.locator('body').innerText()).length
  console.log('PACKAGED body length =', bodyLen)
  if (bodyLen < 10) throw new Error('app rendered nothing')
  await app.close()
})
