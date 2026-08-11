import { test, _electron as electron, type Page } from '@playwright/test'
import path from 'path'
import { mkdtemp, writeFile, rm } from 'fs/promises'
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

test('open md via UI and dump editor geometry', async () => {
  test.setTimeout(180000)
  const userData = await mkdtemp(join(tmpdir(), 'mdrepro-ud-'))
  const dir = await mkdtemp(join(tmpdir(), 'mdrepro-proj-'))
  await writeFile(join(dir, 'README.md'), '# 测试标题\n\n**加粗** 和 `代码`\n\n## 二级\n\n- 列表一\n', 'utf-8')

  try {
    const app = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main.js')],
      env: { ...process.env, OURCODE_USER_DATA: userData },
    })
    const proc = app.process()
    proc.stderr?.on('data', (d) => console.log('[MAIN-ERR]', String(d).slice(0, 1500)))
    const win = await mainWindow(app)
    win.on('pageerror', (err) => console.log('[PAGE-ERROR]', err.message.slice(0, 800)))
    win.on('close', () => console.log('[PAGE-CLOSED]'))
    await win.waitForTimeout(3000)

    // Dismiss any restore modal just in case
    await win.evaluate(() => {
      const m = document.querySelector('[role="dialog"]')
      if (m) m.remove()
    })

    await app.evaluate(({ dialog }, folder) => {
      ;(dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
    }, dir)

    await win.keyboard.press('Control+o')
    await win.waitForTimeout(1500)
    const projectCard = win.locator(`text=${dir}`).first()
    const cardVisible = await projectCard.isVisible().catch(() => false)
    console.log('PROJECT CARD VISIBLE:', cardVisible)
    if (cardVisible) {
      await projectCard.click()
      await win.waitForTimeout(1500)
      const treeVisible = await win.locator('#file-tree-root >> text=README.md').first().isVisible().catch(() => false)
      console.log('TREE README VISIBLE:', treeVisible)
      if (treeVisible) {
        await win.locator('#file-tree-root >> text=README.md').first().click()
        await win.waitForTimeout(2000)
      }
    }

    // Dump editor-area DOM: every element with its box, to detect overlapping
    const dump = await win.evaluate(() => {
      const editorDiv = (window as any).__monacoEditor?.getDomNode?.()
      const out: any[] = []
      const seen = new Set<Element>()
      const walk = (root: Element, depth: number) => {
        if (depth > 6) return
        for (const el of Array.from(root.children)) {
          const r = (el as HTMLElement).getBoundingClientRect()
          const cls = (el as HTMLElement).className
          out.push({
            d: depth,
            tag: el.tagName.toLowerCase(),
            cls: typeof cls === 'string' ? cls.slice(0, 80) : '',
            x: Math.round(r.x), y: Math.round(r.y),
            w: Math.round(r.width), h: Math.round(r.height),
          })
          walk(el, depth + 1)
        }
      }
      // The main editor container
      const container = editorDiv?.closest?.('.flex-1.h-full.min-h-0.relative')
      const rootEl = container || document.querySelector('.glass-chrome') || document.body
      walk(rootEl as Element, 0)
      return { monacoExists: !!editorDiv, out }
    })
    console.log('MONACO EXISTS:', dump.monacoExists)
    for (const e of dump.out) {
      if (e.w > 30 && e.h > 20) console.log(`  ${' '.repeat(e.d)}<${e.tag} class="${e.cls}"> @(${e.x},${e.y}) ${e.w}x${e.h}`)
    }
    await app.close().catch(() => {})
  } finally {
    await rm(userData, { recursive: true, force: true }).catch(() => {})
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})
