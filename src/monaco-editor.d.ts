/**
 * Ambient typing for Monaco's modular ESM entry points.
 *
 * `monaco-editor/esm/vs/editor/edcore.main` ships without a `.d.ts` next to it.
 * At runtime it exports the same core API as the full entry (`editor.main`),
 * minus the language contributions — so the full package types are a safe
 * superset. Language registration comes from the explicit contribution imports
 * in `src/editor/monacoSetup.ts`.
 */
declare module 'monaco-editor/esm/vs/editor/edcore.main' {
  export * from 'monaco-editor'
}
