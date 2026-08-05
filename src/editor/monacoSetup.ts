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

export { monaco }
