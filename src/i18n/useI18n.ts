import { useEffect } from 'react'
import { useEditorStore } from '@/stores/editorStore'
import { t, setLocale, type Locale } from './index'

/**
 * React binding for the i18n module. Subscribes to the persisted language
 * preference and applies it to the document, returning the translate fn.
 */
export function useI18n(): (key: string) => string {
  const language = useEditorStore((s) => s.preferences.language)
  useEffect(() => {
    setLocale((language ?? 'zh-CN') as Locale)
  }, [language])
  return t
}
