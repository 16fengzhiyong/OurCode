/**
 * Central Monaco setup.
 *
 * The bare `import * as monaco from 'monaco-editor'` entry (editor.main)
 * statically pulls every basic-language tokenizer AND the css/html/json/
 * typescript language services into the renderer's main chunk (~9 MB), and it
 * configures no workers - so in packaged builds the language services fall
 * back to running on the UI thread (degraded or broken IntelliSense).
 *
 * Instead we build the editor from parts:
 *  - edcore.main - the editor core, no languages
 *  - the single basic-languages/monaco.contribution - lightweight Monarch
 *    tokenizers for ~45 languages (all entries in shared/constants.ts)
 *  - the four language service contributions (css/html/json/typescript)
 *  - explicit worker wiring (?worker produces separate chunks) so the
 *    services run off the UI thread even from file:// in production.
 */
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main'
import 'monaco-editor/esm/vs/basic-languages/monaco.contribution'
import 'monaco-editor/esm/vs/language/css/monaco.contribution'
import 'monaco-editor/esm/vs/language/html/monaco.contribution'
import 'monaco-editor/esm/vs/language/json/monaco.contribution'
// The TypeScript service is by far the heaviest contribution (~4 MB), so it is
// NOT statically imported here — ensureLanguageService() pulls it in lazily
// the first time a .ts/.js model is opened, keeping the startup chunk smaller.
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { registerSnippets } from './snippets'

registerSnippets()

if (typeof self !== 'undefined') {
  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      switch (label) {
        case 'json':
          return new jsonWorker()
        case 'css':
        case 'scss':
        case 'less':
          return new cssWorker()
        case 'html':
        case 'handlebars':
        case 'razor':
          return new htmlWorker()
        case 'typescript':
        case 'javascript':
          return new tsWorker()
        default:
          return new editorWorker()
      }
    },
  }
}

// ── Lazy language services ──────────────────────────────────────────────────
// Language contributions must be registered BEFORE a model with that language
// is created, otherwise Monaco falls back to plaintext. Call this before
// createModel / setModelLanguage for languages that are not statically loaded.
const lazyServiceLoads = new Map<string, Promise<void>>()

export async function ensureLanguageService(languageId: string): Promise<void> {
  const key = lazyServiceFor(languageId)
  if (!key) return
  let load = lazyServiceLoads.get(key)
  if (!load) {
    // Static specifier so Vite can emit a real chunk reference — a template
    // literal here is left unresolved and fails at runtime ("Failed to resolve
    // module specifier"). Add a branch per lazily-loaded language.
    load = (key === 'typescript'
      ? import('monaco-editor/esm/vs/language/typescript/monaco.contribution')
      : Promise.resolve()).then(() => undefined)
    lazyServiceLoads.set(key, load)
  }
  return load
}

function lazyServiceFor(languageId: string): 'typescript' | null {
  if (languageId === 'typescript' || languageId === 'javascript') return 'typescript'
  return null
}

// ── 2026 themes ─────────────────────────────────────────────────────────────
// Mirrors the 2026 Dark/Light workbench colors so the editor blends into the
// zinc + blue shell instead of the default VS Code Dark+ (#1e1e1e).
export const OURCODE_DARK_THEME = 'ourcode-2026-dark'
export const OURCODE_LIGHT_THEME = 'ourcode-2026-light'

const DARK_COLORS: Record<string, string> = {
  'editor.background': '#18181b',
  'editor.foreground': '#D4D4D8',
  'editorLineNumber.foreground': '#71717A',
  'editorLineNumber.activeForeground': '#D4D4D8',
  'editorCursor.foreground': '#D4D4D8',
  'editor.selectionBackground': '#3B82F680',
  'editor.inactiveSelectionBackground': '#3B82F660',
  'editor.selectionHighlightBackground': '#3B82F660',
  'editor.wordHighlightBackground': '#3B82F650',
  'editor.wordHighlightStrongBackground': '#3B82F680',
  'editor.findMatchBackground': '#3B82F690',
  'editor.findMatchHighlightBackground': '#3B82F680',
  'editor.findRangeHighlightBackground': '#27272a',
  'editor.lineHighlightBackground': '#27272a',
  'editorIndentGuide.background': '#8384854D',
  'editorIndentGuide.activeBackground': '#838485',
  'editorWidget.background': '#27272a',
  'editorWidget.border': '#3f3f46',
  'editorHoverWidget.background': '#27272a',
  'editorHoverWidget.border': '#3f3f46',
  'editorSuggestWidget.background': '#27272a',
  'editorSuggestWidget.border': '#3f3f46',
  'editorSuggestWidget.selectedBackground': '#3B82F626',
  'editorGutter.background': '#18181b',
  'editorBracketMatch.background': '#3B82F655',
  'editorBracketMatch.border': '#3F3F46FF',
  'diffEditor.insertedTextBackground': '#72C89233',
  'diffEditor.removedTextBackground': '#F2877233',
  'scrollbarSlider.background': '#83848533',
  'scrollbarSlider.hoverBackground': '#83848566',
  'scrollbarSlider.activeBackground': '#83848599',
}

const LIGHT_COLORS: Record<string, string> = {
  'editor.background': '#FFFFFF',
  'editor.foreground': '#202020',
  'editorLineNumber.foreground': '#858889',
  'editorLineNumber.activeForeground': '#202020',
  'editorCursor.foreground': '#202020',
  'editor.selectionBackground': '#2563EB2B',
  'editor.lineHighlightBackground': '#F4F4F54f',
  'editorWidget.background': '#FFFFFF',
  'editorWidget.border': '#E4E4E7',
  'editorHoverWidget.background': '#FFFFFF',
  'editorHoverWidget.border': '#E4E4E7',
  'editorSuggestWidget.background': '#FFFFFF',
  'editorSuggestWidget.border': '#E4E4E7',
  'editorSuggestWidget.selectedBackground': '#2563EB1A',
  'scrollbarSlider.background': '#9A9EA233',
  'scrollbarSlider.hoverBackground': '#9A9EA266',
  'scrollbarSlider.activeBackground': '#9A9EA299',
}

// 2026 token palette (from theme-2026 tokenColors)
const DARK_TOKEN_RULES: monaco.editor.ITokenThemeRule[] = [
  { token: 'comment', foreground: '6F9B60' },
  { token: 'keyword', foreground: 'C184C6' },
  { token: 'keyword.operator', foreground: 'C5CCD6' },
  { token: 'keyword.control', foreground: 'C184C6' },
  { token: 'string', foreground: 'C48081' },
  { token: 'number', foreground: 'A8CAAD' },
  { token: 'constant', foreground: '4F8FDD' },
  { token: 'constant.language', foreground: '4F8FDD' },
  { token: 'type', foreground: '48C9C4' },
  { token: 'type.identifier', foreground: '48C9C4' },
  { token: 'identifier', foreground: 'BBBEBF' },
  { token: 'variable', foreground: '90D5FF' },
  { token: 'variable.predefined', foreground: '4CBDFF' },
  { token: 'function', foreground: 'D1D6AE' },
  { token: 'tag', foreground: '4F9BDD' },
  { token: 'attribute.name', foreground: '90D5FF' },
  { token: 'attribute.value', foreground: 'C48081' },
  { token: 'delimiter', foreground: 'BBBEBF' },
  { token: 'metatag', foreground: '4F9BDD' },
]

const LIGHT_TOKEN_RULES: monaco.editor.ITokenThemeRule[] = [
  { token: 'comment', foreground: '6E9B60' },
  { token: 'keyword', foreground: 'A04DA4' },
  { token: 'string', foreground: 'B45A56' },
  { token: 'number', foreground: '4A8A5C' },
  { token: 'type', foreground: '2A8F8A' },
  { token: 'function', foreground: '8A8A3A' },
  { token: 'variable', foreground: '3A8AC0' },
]

export function defineOurCodeThemes(): void {
  monaco.editor.defineTheme(OURCODE_DARK_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: DARK_TOKEN_RULES,
    colors: DARK_COLORS,
  })
  monaco.editor.defineTheme(OURCODE_LIGHT_THEME, {
    base: 'vs',
    inherit: true,
    rules: LIGHT_TOKEN_RULES,
    colors: LIGHT_COLORS,
  })
}

// Register themes once at module load so any consumer (editor, diff, quick diff)
// can reference them by name immediately.
defineOurCodeThemes()

export { monaco }
