import { monaco } from '@/editor/monacoSetup'

/**
 * Registry of the live Monaco models for open files.
 *
 * The Monaco model is the source of truth for a file's text once it is open.
 * Everything that needs the *current* content — saving, the AI prompt builder,
 * plugins — reads through here instead of a per-keystroke copy in the store.
 * The store keeps only the initial content (used to create the model) plus
 * metadata, so typing on a large file never materializes the whole document.
 *
 * Large files are streamed into the model in chunks: `registerLoader` pairs a
 * path with an async loader that the editor runs once it has created the model,
 * and `appendText` appends decoded chunks without touching the undo stack
 * (programmatic `applyEdits` is not undoable — verified empirically).
 */
const models = new Map<string, monaco.editor.ITextModel>()

export function registerModel(path: string, model: monaco.editor.ITextModel): void {
  models.set(path, model)
}

export function unregisterModel(path: string): void {
  models.delete(path)
}

export function getModel(path: string): monaco.editor.ITextModel | undefined {
  return models.get(path)
}

/**
 * Build a `file://` URI for an absolute path. The naive `file:///${path}` form
 * breaks for paths that already start with a slash — `/untitled/…` buffers and
 * POSIX paths like `/home/user/a.ts` become `file:////…`, which Monaco's Uri
 * rejects ("path cannot begin with two slash characters"), so the editor model
 * is never created and the file can't be opened or edited. Stripping the
 * leading slashes keeps Windows paths (`E:\proj\src\a.ts`) byte-identical
 * while fixing the slash-prefixed forms.
 */
export function fileUri(path: string): monaco.Uri {
  return monaco.Uri.parse(`file:///${path.replace(/^\/+/, '')}`)
}

/** All registered paths (used to dispose models of closed files). */
export function getRegisteredPaths(): string[] {
  return Array.from(models.keys())
}

/**
 * The live text of a file: the model's content when the file is open, otherwise
 * the store's copy (`fallback`). Callers must pass their stored content so a
 * file without an open editor still returns something.
 */
export function getFileContent(path: string, fallback?: string): string {
  return models.get(path)?.getValue() ?? fallback ?? ''
}

// --- Streaming loaders -------------------------------------------------------

type StreamLoader = (model: monaco.editor.ITextModel) => Promise<void>

const loaders = new Map<string, StreamLoader>()
const loading = new Map<string, Promise<void>>()

/** Register an async loader for a path that is about to be opened. */
export function registerLoader(path: string, loader: StreamLoader): void {
  loaders.set(path, loader)
}

/** Consume (and remove) the pending loader for a path, if any. */
export function takeLoader(path: string): StreamLoader | undefined {
  const loader = loaders.get(path)
  loaders.delete(path)
  return loader
}

/** Track an in-flight load so save/revert can wait for it to finish. */
export function trackLoad(path: string, promise: Promise<void>): void {
  loading.set(path, promise)
  promise.then(
    () => loading.delete(path),
    () => loading.delete(path),
  )
}

/** Resolve when the file at `path` has finished loading (undefined if not loading). */
export function waitForLoad(path: string): Promise<void> | undefined {
  return loading.get(path)
}

/** Append decoded text at the end of a model (streaming load; not undoable). */
export function appendText(model: monaco.editor.ITextModel, text: string): void {
  if (!text) return
  const lastLine = model.getLineCount()
  const lastColumn = model.getLineMaxColumn(lastLine)
  model.applyEdits([
    { range: new monaco.Range(lastLine, lastColumn, lastLine, lastColumn), text },
  ])
}

/** Match the model's EOL to the file's so streaming appends round-trip exactly. */
export function setModelEol(model: monaco.editor.ITextModel, lineEnding: 'lf' | 'crlf'): void {
  model.setEOL(lineEnding === 'crlf' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF)
}

/**
 * Switch a model's language. Used when a large file turns out to need plain-text
 * mode: the model is created before the file size is known, so the loader
 * downgrades the language once it is.
 */
export function setModelLanguage(model: monaco.editor.ITextModel, languageId: string): void {
  monaco.editor.setModelLanguage(model, languageId)
}

/** Yield to the event loop so the UI can paint between streamed chunks. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
