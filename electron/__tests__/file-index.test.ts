import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, appendFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { FileIndexService } from '../services/file-index'
import { FileSystemService } from '../services/file-system'

// 用真实临时目录跑 FileIndexService（内存索引 + 增量更新 + 预算/监听门控）。
// FileSystemService 直接走 node fs，无需 Electron 环境。

const roots: string[] = []

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'file-index-'))
  roots.push(root)
  mkdirSync(join(root, 'src'))
  mkdirSync(join(root, 'node_modules'))
  writeFileSync(join(root, 'src', 'app.ts'), 'export function greet(name: string) {\n  return `hello ${name}`\n}\n')
  writeFileSync(join(root, 'src', 'util.js'), '// util\nconst TOKEN = "secret-key"\nmodule.exports = { TOKEN }\n')
  writeFileSync(join(root, 'README.md'), '# Demo\n\nhello world\n')
  writeFileSync(join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(root, 'node_modules', 'dep.js'), 'export const HIDDEN_DEP = "x"')
  writeFileSync(join(root, '.secret.ts'), 'export const hidden = 1')
  return root
}

afterEach(() => {
  for (const r of roots.splice(0)) {
    try { rmSync(r, { recursive: true, force: true }) } catch { /* 清理失败忽略 */ }
  }
})

describe('FileIndexService', () => {
  it('builds a content index and searches source files (skips excluded/hidden)', async () => {
    const root = makeProject()
    const idx = new FileIndexService(new FileSystemService())
    idx.markWatched(root)
    await idx.ensureIndex(root)

    const hits = await idx.searchContent(root, 'secret-key', {})
    expect(hits).not.toBeNull()
    expect(hits!.map((h) => h.fileName)).toContain('util.js')

    // node_modules 与隐藏文件不进入索引
    const all = await idx.searchContent(root, 'HIDDEN_DEP', {})
    expect(all!.length).toBe(0)

    // 非源码文件（png）不参与内容索引，但参与文件名搜索
    const byName = await idx.searchFiles(root, 'logo')
    expect(byName).toContain(join(root, 'logo.png'))
  })

  it('is case-insensitive and respects filePattern', async () => {
    const root = makeProject()
    const idx = new FileIndexService(new FileSystemService())
    idx.markWatched(root)
    await idx.ensureIndex(root)

    expect((await idx.searchContent(root, 'GREET', {}))!.length).toBeGreaterThan(0)

    const tsOnly = await idx.searchContent(root, 'hello', { filePattern: '*.ts' })
    expect(tsOnly!.every((h) => h.fileName.endsWith('.ts'))).toBe(true)
    // README.md 的 hello 不应出现在 .ts 过滤结果里
    expect(tsOnly!.every((h) => h.fileName !== 'README.md')).toBe(true)
  })

  it('supports glob patterns in file-name search (search_files)', async () => {
    const root = makeProject()
    const idx = new FileIndexService(new FileSystemService())
    idx.markWatched(root)
    await idx.ensureIndex(root)

    // glob 通配符：按 basename 匹配（此前三层都是字面子串，`*.ts` 永远空）
    const ts = await idx.searchFiles(root, '*.ts')
    expect(ts).toContain(join(root, 'src', 'app.ts'))
    expect(ts!.every((p) => p.endsWith('.ts'))).toBe(true)

    const js = await idx.searchFiles(root, '*.js')
    expect(js).toContain(join(root, 'src', 'util.js'))
    // node_modules 被排除，不应出现在结果里
    expect(js!.some((p) => p.includes('node_modules'))).toBe(false)

    // 字面子串仍按原名片段命中（@ 引用场景）
    const byFragment = await idx.searchFiles(root, 'logo')
    expect(byFragment).toContain(join(root, 'logo.png'))
  })

  it('serves only watched roots; regex/wholeWord fall back to null', async () => {
    const root = makeProject()
    const idx = new FileIndexService(new FileSystemService())
    // 未 markWatched：不提供内存索引服务（回退 rg/遍历）
    await idx.ensureIndex(root)
    expect(await idx.searchContent(root, 'hello', {})).toBeNull()
    expect(await idx.searchFiles(root, 'src')).toBeNull()

    idx.markWatched(root)
    await idx.ensureIndex(root)
    // regex / wholeWord 语义不在内存索引里 → null（交给 rg/遍历）
    expect(await idx.searchContent(root, 'hel+o', { regex: true })).toBeNull()
    expect(await idx.searchContent(root, 'hello', { wholeWord: true })).toBeNull()
    expect(await idx.searchContent(root, 'hello', {})).not.toBeNull()
  })

  it('updates incrementally on file change/delete', async () => {
    const root = makeProject()
    const idx = new FileIndexService(new FileSystemService())
    idx.markWatched(root)
    await idx.ensureIndex(root)

    const target = join(root, 'src', 'app.ts')
    expect(await idx.searchContent(root, 'NEW_MARKER', {})).toHaveLength(0)

    // 改动文件 → onFileChanged 后索引能查到
    appendFileSync(target, '\nconst NEW_MARKER = 1\n')
    idx.onFileChanged(target)
    // 原地更新是异步的，等它落盘
    await new Promise((r) => setTimeout(r, 50))
    expect(await idx.searchContent(root, 'NEW_MARKER', {})).not.toHaveLength(0)

    // 删除文件 → 不再命中
    rmSync(target)
    idx.onFileChanged(target)
    await new Promise((r) => setTimeout(r, 50))
    expect(await idx.searchContent(root, 'greet', {})).toHaveLength(0)
  })

  it('searches a single file path when root is a file (not a directory)', async () => {
    const root = makeProject()
    const idx = new FileIndexService(new FileSystemService())
    idx.markWatched(root)
    await idx.ensureIndex(root)

    // search_in_files 的 path 传单个文件：应从包含它的监听根索引里命中该文件
    const target = join(root, 'src', 'app.ts')
    const hits = await idx.searchContent(target, 'greet', {})
    expect(hits).not.toBeNull()
    expect(hits!.every((h) => h.filePath === target)).toBe(true)
    expect(hits![0].lineNumber).toBe(1)

    // 正斜杠路径同样能命中：normPath 统一分隔符，Windows 下 `\`/`/` 混用不会 miss
    const forwardSlash = target.replace(/\\/g, '/')
    expect((await idx.searchContent(forwardSlash, 'greet', {}))!.length).toBeGreaterThan(0)

    // 大小写不敏感 + filePattern 与目录模式口径一致
    expect((await idx.searchContent(target, 'GREET', {}))!.length).toBeGreaterThan(0)
    expect(await idx.searchContent(target, 'greet', { filePattern: '*.js' })).toEqual([])
    // regex / wholeWord 仍交回 rg/遍历
    expect(await idx.searchContent(target, 'greet', { wholeWord: true })).toBeNull()

    // 不在任何索引根下的文件 → null（回退 rg/遍历），而不是空数组
    expect(await idx.searchContent(join(root, '..', 'outside.ts'), 'greet', {})).toBeNull()
  })

  it('caps content budget with limited flag (huge contents)', async () => {
    // 用小于预算但超单文件上限的内容验证：超大文件不索引、不崩溃
    const root = makeProject()
    writeFileSync(join(root, 'src', 'huge.ts'), `// ${'x'.repeat(6 * 1024 * 1024)} BIG_FILE\n`)
    const idx = new FileIndexService(new FileSystemService())
    idx.markWatched(root)
    await idx.ensureIndex(root)

    const hits = await idx.searchContent(root, 'BIG_FILE', {})
    // 超大文件被跳过 → 不在索引结果里（rg/遍历兜底会覆盖）
    expect(hits!.length).toBe(0)
  })
})
