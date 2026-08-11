import { describe, it, expect } from 'vitest'
import {
  makeFileLink,
  isPathInside,
  splitFileLinks,
  resolveLinkTarget,
  extractPathsFromUriList,
} from '@/utils/fileRefs'

const WIN_ROOT = 'C:\\proj'

describe('makeFileLink', () => {
  it('in-workspace file → [name](./relative/path)', () => {
    expect(makeFileLink('C:\\proj\\src\\a.ts', WIN_ROOT, false)).toBe('[a.ts](./src/a.ts)')
    expect(makeFileLink('C:\\proj\\hello.md', WIN_ROOT, false)).toBe('[hello.md](./hello.md)')
  })

  it('in-workspace folder → trailing slash', () => {
    expect(makeFileLink('C:\\proj\\src', WIN_ROOT, true)).toBe('[src](./src/)')
  })

  it('out-of-workspace → [name](absolute forward-slash path)', () => {
    expect(makeFileLink('C:\\Users\\me\\Downloads\\x.txt', WIN_ROOT, false)).toBe('[x.txt](C:/Users/me/Downloads/x.txt)')
  })

  it('no root → treated as outside', () => {
    expect(makeFileLink('C:\\proj\\a.ts', '', false)).toBe('[a.ts](C:/proj/a.ts)')
  })

  it('case-insensitive Windows drive letters', () => {
    expect(isPathInside('c:\\PROJ\\a.ts', 'C:\\proj')).toBe(true)
  })

  it('encodes spaces/parens in the link target but round-trips on resolve', () => {
    const link = makeFileLink('C:\\proj\\report (final).docx', WIN_ROOT, false)
    expect(link).toBe('[report (final).docx](./report%20%28final%29.docx)')
    // label keeps the real name; target decodes back to the real path
    expect(resolveLinkTarget('./report%20%28final%29.docx', WIN_ROOT)).toBe('C:\\proj\\report (final).docx')
    // and the full cycle matches a contextFile with spaces/parens
    const segs = splitFileLinks(link, ['C:\\proj\\report (final).docx'], WIN_ROOT)
    expect(segs[0]).toEqual({ kind: 'file', text: link, path: 'C:\\proj\\report (final).docx' })
  })
})

describe('resolveLinkTarget', () => {
  it('resolves ./rel against root', () => {
    expect(resolveLinkTarget('./src/a.ts', WIN_ROOT)).toBe('C:\\proj\\src\\a.ts')
  })
  it('resolves ../rel against root parent', () => {
    expect(resolveLinkTarget('../other/x.ts', WIN_ROOT)).toBe('C:\\other\\x.ts')
  })
  it('keeps absolute paths', () => {
    expect(resolveLinkTarget('C:/Users/me/a.ts', 'C:\\proj')).toBe('C:\\Users\\me\\a.ts')
  })
  it('null without a root for relative targets', () => {
    expect(resolveLinkTarget('./a.ts', '')).toBeNull()
  })
})

describe('extractPathsFromUriList', () => {
  it('parses file:///C:/ drive paths (no leading backslash)', () => {
    expect(extractPathsFromUriList('file:///E:/ls/ideUtil/LICENSE')).toEqual(['E:\\ls\\ideUtil\\LICENSE'])
  })

  it('parses multiple lines and strips Windows-style line endings', () => {
    const text = 'file:///C:/a.txt\r\nfile:///C:/b folder/b.txt\r\n'
    expect(extractPathsFromUriList(text)).toEqual(['C:\\a.txt', 'C:\\b folder\\b.txt'])
  })

  it('decodes percent-encoded characters', () => {
    expect(extractPathsFromUriList('file:///C:/my%20file%28x%29.txt')).toEqual(['C:\\my file(x).txt'])
  })

  it('handles UNC (file://server/share)', () => {
    expect(extractPathsFromUriList('file://nas/share/doc.txt')).toEqual(['\\\\nas\\share\\doc.txt'])
  })

  it('ignores non-file URIs and empty lines', () => {
    expect(extractPathsFromUriList('https://example.com/a\n\n# comment\nfile:///D:/ok.txt')).toEqual(['D:\\ok.txt'])
  })
})

describe('splitFileLinks', () => {
  const content = '看看 [a.ts](./src/a.ts) 和 [fake](./fake.md)'
  const root = WIN_ROOT

  it('turns only context-file links into chips; pasted links stay text', () => {
    const segs = splitFileLinks(content, ['C:\\proj\\src\\a.ts'], root)
    expect(segs).toEqual([
      { kind: 'text', text: '看看 ' },
      { kind: 'file', text: '[a.ts](./src/a.ts)', path: 'C:\\proj\\src\\a.ts' },
      { kind: 'text', text: ' 和 [fake](./fake.md)' },
    ])
  })

  it('no context files → all text (pasted markdown never becomes a chip)', () => {
    expect(splitFileLinks('[a.ts](./src/a.ts)', [], root)).toEqual([
      { kind: 'text', text: '[a.ts](./src/a.ts)' },
    ])
  })

  it('case-insensitive context match on Windows', () => {
    const segs = splitFileLinks('[a.ts](./src/a.ts)', ['c:\\PROJ\\src\\a.ts'], root)
    expect(segs[0]).toEqual({ kind: 'file', text: '[a.ts](./src/a.ts)', path: 'C:\\proj\\src\\a.ts' })
  })
})
