import { describe, it, expect } from 'vitest'
import { getFileViewMode } from '@/editor/fileViews'

describe('getFileViewMode', () => {
  it('returns html for html/htm files', () => {
    expect(getFileViewMode('E:/proj/index.html')).toBe('html')
    expect(getFileViewMode('E:/proj/page.htm')).toBe('html')
    expect(getFileViewMode('/home/user/a.html')).toBe('html')
    expect(getFileViewMode('index.HTML')).toBe('html')
  })

  it('returns markdown for markdown files', () => {
    expect(getFileViewMode('README.md')).toBe('markdown')
    expect(getFileViewMode('/docs/guide.markdown')).toBe('markdown')
    expect(getFileViewMode('docs/notes.MDX')).toBe('markdown')
  })

  it('returns image for image files', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'svg']) {
      expect(getFileViewMode(`E:/img/logo.${ext}`)).toBe('image')
    }
  })

  it('returns code for everything else', () => {
    expect(getFileViewMode('src/app.ts')).toBe('code')
    expect(getFileViewMode('E:/proj/main.py')).toBe('code')
    expect(getFileViewMode('package.json')).toBe('code')
    expect(getFileViewMode('styles.css')).toBe('code')
    expect(getFileViewMode('/untitled/untitled-1.txt')).toBe('code')
    // no extension at all
    expect(getFileViewMode('E:/proj/LICENSE')).toBe('code')
    expect(getFileViewMode('E:/proj/.gitignore')).toBe('code')
  })

  it('treats a trailing-dot filename as code, not image', () => {
    expect(getFileViewMode('E:/proj/weird.')).toBe('code')
  })
})
