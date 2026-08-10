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

// ── 2026 Glass themes ────────────────────────────────────────────────────────
// Mirrors the Glass 2026 Dark/Light workbench colors so the editor blends into
// the deep-slate / glass shell instead of the default VS Code Dark+ (#1e1e1e).
export const OURCODE_DARK_THEME = 'ourcode-2026-dark'
export const OURCODE_LIGHT_THEME = 'ourcode-2026-light'

const DARK_COLORS: Record<string, string> = {
  'editor.background': '#111319',
  'editor.foreground': '#E1E2EB',
  'editorLineNumber.foreground': '#8C909E',
  'editorLineNumber.activeForeground': '#E1E2EB',
  'editorCursor.foreground': '#E1E2EB',
  'editor.selectionBackground': '#4D94FF80',
  'editor.inactiveSelectionBackground': '#4D94FF60',
  'editor.selectionHighlightBackground': '#4D94FF60',
  'editor.wordHighlightBackground': '#4D94FF50',
  'editor.wordHighlightStrongBackground': '#4D94FF80',
  'editor.findMatchBackground': '#4D94FF90',
  'editor.findMatchHighlightBackground': '#4D94FF80',
  'editor.findRangeHighlightBackground': '#1d2026',
  'editor.lineHighlightBackground': '#1d2026',
  'editorIndentGuide.background': '#4247534D',
  'editorIndentGuide.activeBackground': '#424753',
  'editorWidget.background': '#1d2026',
  'editorWidget.border': '#424753',
  'editorHoverWidget.background': '#1d2026',
  'editorHoverWidget.border': '#424753',
  'editorSuggestWidget.background': '#1d2026',
  'editorSuggestWidget.border': '#424753',
  'editorSuggestWidget.selectedBackground': '#4D94FF26',
  'editorGutter.background': '#111319',
  'editorBracketMatch.background': '#4D94FF55',
  'editorBracketMatch.border': '#424753FF',
  'diffEditor.insertedTextBackground': '#34D39933',
  'diffEditor.removedTextBackground': '#F4877133',
  'scrollbarSlider.background': '#8C909E33',
  'scrollbarSlider.hoverBackground': '#8C909E66',
  'scrollbarSlider.activeBackground': '#8C909E99',
}

const LIGHT_COLORS: Record<string, string> = {
  'editor.background': '#FFFFFF',
  'editor.foreground': '#0F172A',
  'editorLineNumber.foreground': '#94A3B8',
  'editorLineNumber.activeForeground': '#0F172A',
  'editorCursor.foreground': '#0F172A',
  'editor.selectionBackground': '#0058BC2B',
  'editor.lineHighlightBackground': '#F6F7FB99',
  'editorWidget.background': '#FFFFFF',
  'editorWidget.border': '#E2E8F0',
  'editorHoverWidget.background': '#FFFFFF',
  'editorHoverWidget.border': '#E2E8F0',
  'editorSuggestWidget.background': '#FFFFFF',
  'editorSuggestWidget.border': '#E2E8F0',
  'editorSuggestWidget.selectedBackground': '#0058BC1A',
  'editorIndentGuide.background': '#CBD5E14D',
  'editorIndentGuide.activeBackground': '#94A3B8',
  'scrollbarSlider.background': '#94A3B833',
  'scrollbarSlider.hoverBackground': '#94A3B866',
  'scrollbarSlider.activeBackground': '#94A3B899',
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
