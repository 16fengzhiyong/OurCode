import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../services/tools/context', () => ({
  loadIgnorePatterns: vi.fn(async () => {}),
  isIgnoredPath: vi.fn(() => false),
}))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: { getState: () => ({ rootPath: '' }) },
}))

import { multiEditFile, editFile } from '../services/tools/helpers'

const fs = new Map<string, string>()
const electronAPI = {
  readFile: vi.fn(async (p: string) => {
    if (!fs.has(p)) throw new Error(`ENOENT: ${p}`)
    return { content: fs.get(p)! }
  }),
  writeFile: vi.fn(async (p: string, content: string) => {
    fs.set(p, content)
  }),
}
vi.stubGlobal('window', { electronAPI })

describe('编辑引擎边界压力测试', () => {
  beforeEach(() => {
    fs.clear()
  })

  it('CRLF 内容：oldText 用 LF 也能模糊命中（行尾归一化）', async () => {
    fs.set('C:/p/crlf.ts', 'const a = 1\r\nconst b = 2\r\n')
    const res = await multiEditFile([{ path: 'C:/p/crlf.ts', oldText: 'const a = 1\n', newText: 'const A = 1\n' }])
    // 精确路径其实就能命中（indexOf 用 LF 在 CRLF 文件里也能找到 "const a = 1\n" 吗？不行——CRLF 文件里 "const a = 1\r\n" 不含 "const a = 1\n"）
    expect(res).toContain('已批量编辑 1 处')
    expect(fs.get('C:/p/crlf.ts')).toBe('const A = 1\r\nconst b = 2\r\n')
  })

  it('行内空白折叠：oldText 双空格命中文件单空格', async () => {
    fs.set('C:/p/ws.ts', 'x = foo();\n')
    const res = await multiEditFile([{ path: 'C:/p/ws.ts', oldText: 'x  =  foo();', newText: 'y = bar();' }])
    expect(res).toContain('模糊匹配')
    expect(fs.get('C:/p/ws.ts')).toBe('y = bar();\n')
  })

  it('context 位于文件末尾也能匹配', async () => {
    fs.set('C:/p/eof.ts', 'const a = 1\nconst b = 2')
    const res = await multiEditFile([
      { path: 'C:/p/eof.ts', oldText: 'const b', newText: 'const B', context: '= 2' },
    ])
    expect(res).toContain('1 处')
    expect(fs.get('C:/p/eof.ts')).toBe('const a = 1\nconst B = 2')
  })

  it('多行 oldText 每行尾随空格：归一化命中且整段替换', async () => {
    // 每行都有尾随空格（常见于编辑过的文件），oldText 不带
    fs.set('C:/p/trail.ts', 'function f() {  \n  return 1  \n}  \n')
    const res = await multiEditFile([{ path: 'C:/p/trail.ts', oldText: 'function f() {\n  return 1\n}', newText: 'function f() {\n  return 2\n}' }])
    expect(res).toContain('模糊匹配')
    expect(fs.get('C:/p/trail.ts')).toBe('function f() {\n  return 2\n}  \n')
  })

  it('fuzzy 唯一目标但相似文本出现在注释里 → 歧义拒绝（fail-safe，不误写）', async () => {
    fs.set('C:/p/com.ts', '// x = 1\nx = 1\n')
    const res = await multiEditFile([{ path: 'C:/p/com.ts', oldText: 'x = 1', newText: 'y = 2' }])
    // 精确匹配其实命中 2 处（注释里也有）→ 歧义，不是 fuzzy 问题
    expect(res).toContain('匹配到 2 处')
    expect(fs.get('C:/p/com.ts')).toBe('// x = 1\nx = 1\n')
  })

  it('空文件：不崩溃，正确报未找到', async () => {
    fs.set('C:/p/empty.ts', '')
    const res = await multiEditFile([{ path: 'C:/p/empty.ts', oldText: 'anything', newText: 'x' }])
    expect(res).toContain('Error')
    expect(fs.get('C:/p/empty.ts')).toBe('')
  })

  it('NBSP 变体归一化命中', async () => {
    fs.set('C:/p/nbsp.ts', 'const a = 1;\n')
    const res = await multiEditFile([{ path: 'C:/p/nbsp.ts', oldText: 'const\u00a0a\u00a0=\u00a01;', newText: 'const b = 2;' }])
    expect(res).toContain('模糊匹配')
    expect(fs.get('C:/p/nbsp.ts')).toBe('const b = 2;\n')
  })

  it('fuzzy 校验失败路径不写坏文件（同一目标归一化后歧义）', async () => {
    // 两个候选：注释与代码，归一化后都命中 → ambiguous，零写入
    fs.set('C:/p/amb.ts', '// const z = 1\nconst z = 1\n')
    const res = await multiEditFile([{ path: 'C:/p/amb.ts', oldText: 'const z = 1', newText: 'const Z = 1' }])
    expect(res).toContain('匹配到 2 处')
    expect(fs.get('C:/p/amb.ts')).toBe('// const z = 1\nconst z = 1\n')
  })

  it('同文件多编辑：前一个编辑改变内容后，后一个仍正确解析', async () => {
    fs.set('C:/p/seq.ts', 'a = 1\nb = 2\n')
    const res = await multiEditFile([
      { path: 'C:/p/seq.ts', oldText: 'a = 1', newText: 'A = 1' },
      { path: 'C:/p/seq.ts', oldText: 'b = 2', newText: 'B = 2' },
    ])
    expect(res).toContain('2 处')
    expect(fs.get('C:/p/seq.ts')).toBe('A = 1\nB = 2\n')
  })

  it('oldText 跨文件批量：一文件失败则全部零写入', async () => {
    fs.set('C:/p/x.ts', 'x = 1\n')
    fs.set('C:/p/y.ts', 'y = 2\n')
    const res = await multiEditFile([
      { path: 'C:/p/x.ts', oldText: 'x = 1', newText: 'X = 1' },
      { path: 'C:/p/y.ts', oldText: 'zzz', newText: 'Y = 2' },
    ])
    expect(res).toContain('Error')
    expect(fs.get('C:/p/x.ts')).toBe('x = 1\n')
    expect(fs.get('C:/p/y.ts')).toBe('y = 2\n')
  })

  it('编辑后行号漂移：第二次编辑基于内存态而非磁盘态', async () => {
    fs.set('C:/p/drift.ts', 'line0\nTARGET\nline2\n')
    // 第一次编辑把 line1 改成别的，第二次编辑的 oldText 仍能命中 line2
    const res = await multiEditFile([
      { path: 'C:/p/drift.ts', oldText: 'line0', newText: 'zero' },
      { path: 'C:/p/drift.ts', oldText: 'line2', newText: 'two' },
    ])
    expect(res).toContain('2 处')
    expect(fs.get('C:/p/drift.ts')).toBe('zero\nTARGET\ntwo\n')
  })

  it('edit_file 保留 first-occurrence：多处无 context 时替换第一处', async () => {
    fs.set('C:/p/first.ts', 'foo foo bar')
    const res = await editFile('C:/p/first.ts', 'foo', 'baz')
    expect(res).toContain('first occurrence')
    expect(fs.get('C:/p/first.ts')).toBe('baz foo bar')
  })

  it('edit_file 提供 context 时消除歧义到第二处', async () => {
    fs.set('C:/p/ctx.ts', 'foo 1\nfoo 2\n')
    const res = await editFile('C:/p/ctx.ts', 'foo', 'bar', false, '2')
    expect(res).toContain('File edited')
    expect(fs.get('C:/p/ctx.ts')).toBe('foo 1\nbar 2\n')
  })

  it('edit_file context 未命中时报错不写入', async () => {
    fs.set('C:/p/ctxmiss.ts', 'foo 1\nfoo 2\n')
    const res = await editFile('C:/p/ctxmiss.ts', 'foo', 'bar', false, 'NOPE')
    expect(res).toContain('Error')
    expect(res).toContain('context 未紧跟')
    expect(fs.get('C:/p/ctxmiss.ts')).toBe('foo 1\nfoo 2\n')
  })

  it('replaceAll 归一化唯一时仍可应用', async () => {
    fs.set('C:/p/ra.ts', 'const\u00a0x = 1\n')
    const res = await multiEditFile([{ path: 'C:/p/ra.ts', oldText: 'const x', newText: 'const y', replaceAll: true }])
    expect(res).toContain('模糊匹配')
    expect(fs.get('C:/p/ra.ts')).toBe('const y = 1\n')
  })

  it('中文内容：路径与文本均正常', async () => {
    fs.set('C:/项目/中文文件.ts', '你好 = 世界\n')
    const res = await multiEditFile([{ path: 'C:/项目/中文文件.ts', oldText: '你好', newText: '您好' }])
    expect(res).toContain('1 处')
    expect(fs.get('C:/项目/中文文件.ts')).toBe('您好 = 世界\n')
  })

  it('多行 oldText 在文件后半部重复出现 → 歧义拒绝列出所有行', async () => {
    fs.set('C:/p/dup.ts', 'block {\n  x = 1\n}\nother()\nblock {\n  x = 1\n}\n')
    const res = await multiEditFile([{ path: 'C:/p/dup.ts', oldText: 'block {\n  x = 1\n}', newText: 'block {\n  x = 2\n}' }])
    expect(res).toContain('Error')
    expect(res).toContain('匹配到 2 处')
    expect(res).toContain('line 1')
    expect(res).toContain('line 5')
    expect(fs.get('C:/p/dup.ts')).toBe('block {\n  x = 1\n}\nother()\nblock {\n  x = 1\n}\n')
  })
})
