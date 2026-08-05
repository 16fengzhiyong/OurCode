import { describe, it, expect } from 'vitest'
import { resolveLocale, localeFromSystem, t, setLocale, setSystemLocale, createTranslator, getLocale } from '@/i18n'

describe('i18n locale resolution', () => {
  it('maps zh system locales to zh-CN', () => {
    expect(localeFromSystem('zh-CN')).toBe('zh-CN')
    expect(localeFromSystem('zh')).toBe('zh-CN')
    expect(localeFromSystem('zh-TW')).toBe('zh-CN')
  })

  it('maps non-Chinese system locales to en-US', () => {
    expect(localeFromSystem('en-US')).toBe('en-US')
    expect(localeFromSystem('ja-JP')).toBe('en-US')
    expect(localeFromSystem('')).toBe('en-US')
  })

  it('resolves an explicit preference regardless of system locale', () => {
    expect(resolveLocale('en-US', 'zh-CN')).toBe('en-US')
    expect(resolveLocale('zh-CN', 'en-US')).toBe('zh-CN')
  })

  it('resolves system preference via the system locale', () => {
    expect(resolveLocale('system', 'zh-CN')).toBe('zh-CN')
    expect(resolveLocale('system', 'en-US')).toBe('en-US')
    expect(resolveLocale(undefined, 'zh-CN')).toBe('zh-CN')
  })
})

describe('i18n translation', () => {
  it('translates a known key in the active locale', () => {
    setLocale('zh-CN')
    expect(t('common.save')).toBe('保存')
    setLocale('en-US')
    expect(t('common.save')).toBe('Save')
  })

  it('interpolates {name} variables', () => {
    setLocale('zh-CN')
    expect(t('statusBar.spaces', { count: 4 })).toBe('4 空格')
    setLocale('en-US')
    expect(t('statusBar.spaces', { count: 2 })).toBe('2 spaces')
  })

  it('falls back to en-US then zh-CN for unknown keys', () => {
    // A key that exists in both dictionaries translates normally in each
    setLocale('en-US')
    expect(t('menu.file')).toBe('File')
    setLocale('zh-CN')
    expect(t('menu.file')).toBe('文件')
  })

  it('createTranslator binds to a fixed locale', () => {
    const zh = createTranslator('zh-CN')
    const en = createTranslator('en-US')
    setLocale('zh-CN')
    expect(zh('menu.help')).toBe('帮助')
    expect(en('menu.help')).toBe('Help')
  })

  it('setSystemLocale stores the system locale used for resolution', () => {
    setSystemLocale('zh-CN')
    expect(resolveLocale('system', getLocale() === 'zh-CN' ? 'zh-CN' : 'en-US')).toBe('zh-CN')
    // resolveLocale against the cached system locale
    expect(resolveLocale('system', 'zh-CN')).toBe('zh-CN')
    expect(resolveLocale('system', 'en-US')).toBe('en-US')
  })
})
