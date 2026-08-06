/**
 * Renderer-side LSP client. Language servers are opt-in per language via the
 * `lspServers` preference ("python: pylsp", one per line). When a file opens
 * with a configured language, the main process spawns the server and streams
 * publishDiagnostics back here, where they become Monaco markers — flowing into
 * the Problems panel and status bar counts for free.
 */
import { monaco } from '@/editor/monacoSetup'
import { useEditorStore } from '@/stores/editorStore'
import { fileUri } from '@/editor/modelRegistry'

// Files above this size are skipped (getValue() copies the whole buffer)
const LSP_MAX_BYTES = 5 * 1024 * 1024
const DID_CHANGE_DEBOUNCE_MS = 800

interface AttachedServer {
  uri: string
  version: number
  timer: ReturnType<typeof setTimeout> | null
  disposable: monaco.IDisposable | null
}

const attached = new Map<string, AttachedServer>()

function serverCommandFor(languageId: string): { command: string; args: string[] } | null {
  const raw = (useEditorStore.getState().preferences as { lspServers?: Record<string, string> }).lspServers?.[languageId]
  if (!raw) return null
  const parts = raw.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  return { command: parts[0], args: parts.slice(1) }
}

function uriFor(filePath: string): string {
  return fileUri(filePath).toString()
}

/** Start a language server for an open model (call when the model is created). */
export function attachLsp(filePath: string, languageId: string, model: monaco.editor.ITextModel): void {
  const server = serverCommandFor(languageId)
  if (!server) return
  if (model.getValueLength() > LSP_MAX_BYTES) return

  const uri = uriFor(filePath)
  const existing = attached.get(filePath)
  if (existing) {
    // Re-attach to the same server
    existing.disposable?.dispose()
    existing.version = model.getVersionId()
    existing.disposable = model.onDidChangeContent(() => scheduleDidChange(filePath, model))
    return
  }

  const workspaceRoot = document.getElementById('file-tree-root')?.getAttribute('data-root-path') || ''
  void window.electronAPI
    .lspStart(uri, server.command, server.args, workspaceRoot, languageId, model.getValue())
    .then((res: { ok: boolean }) => {
      if (!res.ok) return
      const entry: AttachedServer = {
        uri,
        version: model.getVersionId(),
        timer: null,
        disposable: model.onDidChangeContent(() => scheduleDidChange(filePath, model)),
      }
      attached.set(filePath, entry)
    })
    .catch(() => { /* server unavailable — feature is opt-in */ })
}

/** Tear down the language server for a closed file. */
export function detachLsp(filePath: string): void {
  const entry = attached.get(filePath)
  if (!entry) return
  attached.delete(filePath)
  entry.disposable?.dispose()
  if (entry.timer) clearTimeout(entry.timer)
  void window.electronAPI.lspStop(entry.uri).catch(() => {})
}

function scheduleDidChange(filePath: string, model: monaco.editor.ITextModel): void {
  const entry = attached.get(filePath)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    entry.timer = null
    entry.version = model.getVersionId()
    void window.electronAPI.lspDidChange(entry.uri, entry.version, model.getValue()).catch(() => {})
  }, DID_CHANGE_DEBOUNCE_MS)
}

const LSP_SEVERITY_TO_MARKER: Record<number, monaco.MarkerSeverity> = {
  1: monaco.MarkerSeverity.Error,
  2: monaco.MarkerSeverity.Warning,
  3: monaco.MarkerSeverity.Info,
  4: monaco.MarkerSeverity.Hint,
}

/** Map a publishDiagnostics payload to Monaco markers on the target model. */
export function applyLspDiagnostics(payload: { uri: string; diagnostics: Array<Record<string, unknown>> }): void {
  const model = monaco.editor.getModel(monaco.Uri.parse(payload.uri))
  if (!model) return

  const markers = payload.diagnostics.map((d: any) => ({
    message: String(d.message ?? ''),
    severity: LSP_SEVERITY_TO_MARKER[d.severity] ?? monaco.MarkerSeverity.Error,
    startLineNumber: (d.range?.start?.line ?? 0) + 1,
    startColumn: (d.range?.start?.character ?? 0) + 1,
    endLineNumber: (d.range?.end?.line ?? 0) + 1,
    endColumn: (d.range?.end?.character ?? 0) + 1,
    source: d.source ? `lsp:${d.source}` : 'lsp',
  }))

  monaco.editor.setModelMarkers(model, 'lsp', markers)
}

/** Subscribe to the main-process diagnostics stream once (module side-effect). */
let subscribed = false
export function ensureLspDiagnosticsSubscription(): void {
  if (subscribed) return
  subscribed = true
  window.electronAPI.onLspDiagnostics((payload) => applyLspDiagnostics(payload))
}
