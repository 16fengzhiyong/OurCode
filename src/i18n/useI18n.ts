import { useEffect, useMemo } from 'react'
import { useEditorStore } from '@/stores/editorStore'
import { setLocale, resolveLocale, createTranslator, getSystemLocale, type LanguagePreference, type TranslationKey } from './index'

/**
 * React 绑定：订阅持久化的语言偏好，在渲染期间把「跟随系统」解析为具体语言，
 * 返回绑定到该语言的翻译函数 —— 语言切换时组件随 zustand 订阅重渲染，文本即时更新。
 * effect 里同步 setLocale 以更新 document.lang 与模块级 currentLocale。
 */
export function useI18n(): (key: TranslationKey, vars?: Record<string, string | number>) => string {
  const language = useEditorStore((s) => s.preferences.language)
  const locale = resolveLocale((language ?? 'system') as LanguagePreference, getSystemLocale())
  useEffect(() => {
    setLocale(locale)
  }, [locale])
  return useMemo(() => createTranslator(locale), [locale])
}
