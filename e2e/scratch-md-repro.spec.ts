import { test, _electron as electron, type Page } from '@playwright/test'
import path from 'path'
import { mkdtemp, writeFile, rm, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const OUT = join(__dirname, '..', 'test-results', 'mdrepro-shots')
let shotN = 0
async function shot(win: Page, name: string) {
  await mkdir(OUT, { recursive: true })
  await win.screenshot({ path: join(OUT, `${String(shotN++).padStart(2, '0')}-${name}.png`) })
}

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

test('open an md file and screenshot', async () => {
  test.setTimeout(180000)
  const dir = await mkdtemp(join(tmpdir(), 'mdrepro-'))
  const md = `# 测试标题

这是一段 **加粗** 和 \`行内代码\` 的 Markdown 测试。

## 二级标题

- 列表项一
- 列表项二

\`\`\`ts
const a = 1
\`\`\`

> 引用块内容
`
  await writeFile(join(dir, 'README.md'), md, 'utf-8')
  await writeFile(join(dir, 'app.ts'), 'export const x = 1\n', 'utf-8')

  try {
    const app = await electron.launch({ args: [path.join(__dirname, '../dist-electron/main.js')] })
    const win = await mainWindow(app)
    await win.evaluate(() => (window as any).electronAPI.clearBackups())
    await win.waitForTimeout(2500)
    await shot(win, 'initial')

    // Try direct open via the store (fallback path) — many apps expose the store on window
    const opened = await win.evaluate(async (p) => {
      const w = window as any
      if (w.__ourcode?.openFile) { await w.__ourcode.openFile(p); return 'direct' }
      return 'no-direct-api'
    }, join(dir, 'README.md'))
    console.log('direct open result:', opened)
    await win.waitForTimeout(2000)
    await shot(win, 'after-direct-open')

    // Try the Ctrl+O flow
    await app.evaluate(({ dialog }, folder) => {
      ;(dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
    }, dir)
    await win.keyboard.press('Control+o')
    await win.waitForTimeout(1200)
    await shot(win, 'after-ctrl-o-1')
    await win.keyboard.press('Control+o')
    await win.waitForTimeout(1200)
    await shot(win, 'after-ctrl-o-2')

    const bodyText = await win.evaluate(() => document.body.innerText.slice(0, 600))
    console.log('BODY TEXT:\n', bodyText)

    await app.close()
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})
