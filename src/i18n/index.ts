/**
 * 轻量 i18n 核心：词典 + 插值 + 语言解析。
 *
 * - 词典以 zh-CN 为键源，en-US 被类型约束为完整翻译（缺 key 编译报错）。
 * - `t(key, vars)` 支持 `{name}` 插值，如 t('statusBar.spaces', { count: 2 })。
 * - 语言偏好支持 `'system'`：启动时按系统 locale（zh-* → 中文，其余 → 英文）解析，
 *   手动设置为 zh-CN / en-US 后以其为准。
 */
import { zhCN } from './zh-CN'
import { enUS } from './en-US'

export type Locale = 'zh-CN' | 'en-US'
/** 语言偏好：跟随系统 / 中文 / 英文 */
export type LanguagePreference = 'system' | Locale
export type TranslationKey = keyof typeof zhCN

const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

/** 当前生效的界面语言（已解析，非 'system'）。 */
let currentLocale: Locale = 'zh-CN'

/** 系统语言缓存（bootstrap 时从主进程获取，navigator.language 兜底）。 */
let systemLocale: string = typeof navigator !== 'undefined' ? navigator.language : 'en-US'

export function setSystemLocale(locale: string | undefined): void {
  if (locale) systemLocale = locale
}

export function getSystemLocale(): string {
  return systemLocale
}

/** 把系统 locale 映射到本项目支持的两种语言之一。 */
export function localeFromSystem(system: string): Locale {
  return system.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

/** 根据语言偏好 + 系统语言，解析出实际界面语言。 */
export function resolveLocale(pref: LanguagePreference | undefined, system: string): Locale {
  if (pref === 'zh-CN' || pref === 'en-US') return pref
  return localeFromSystem(system)
}

export function setLocale(locale: Locale): void {
  currentLocale = locale
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = locale === 'zh-CN' ? 'zh-CN' : 'en'
  }
}

export function getLocale(): Locale {
  return currentLocale
}

const INTERPOLATION_RE = /\{([a-zA-Z0-9_]+)\}/g

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(INTERPOLATION_RE, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  )
}

function translate(locale: Locale, key: TranslationKey, vars?: Record<string, string | number>): string {
  const dict = dictionaries[locale]
  const raw = dict[key] ?? enUS[key] ?? zhCN[key] ?? key
  return interpolate(raw, vars)
}

/** 翻译一个 key，支持 `{name}` 插值；兜底顺序：当前语言 → en-US → zh-CN → key。 */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  return translate(currentLocale, key, vars)
}

/** 返回绑定到指定 locale 的翻译函数（用于在渲染期间按当前语言解析，保证切换即时生效）。 */
export function createTranslator(locale: Locale): (key: TranslationKey, vars?: Record<string, string | number>) => string {
  return (key, vars) => translate(locale, key, vars)
}
