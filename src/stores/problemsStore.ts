import { create } from 'zustand'
import { monaco } from '@/editor/monacoSetup'
import { useEditorStore } from '@/stores/editorStore'

export type ProblemSeverity = 'error' | 'warning' | 'info' | 'hint'

export interface Problem {
  filePath: string
  fileName: string
  line: number
  column: number
  endLine: number
  endColumn: number
  message: string
  severity: ProblemSeverity
  source?: string
}

interface ProblemsState {
  problems: Problem[]
  isOpen: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
  refresh: () => void
  openProblem: (problem: Problem) => Promise<void>
}

const SEVERITY_RANK: Record<ProblemSeverity, number> = { error: 0, warning: 1, info: 2, hint: 3 }

function markerToProblem(
  marker: monaco.editor.IMarker,
  filePath: string,
  fileName: string,
): Problem {
  const severityMap: Record<number, ProblemSeverity> = {
    [monaco.MarkerSeverity.Error]: 'error',
    [monaco.MarkerSeverity.Warning]: 'warning',
    [monaco.MarkerSeverity.Info]: 'info',
    [monaco.MarkerSeverity.Hint]: 'hint',
  }
  return {
    filePath,
    fileName,
    line: marker.startLineNumber,
    column: marker.startColumn,
    endLine: marker.endLineNumber,
    endColumn: marker.endColumn,
    message: marker.message,
    severity: severityMap[marker.severity] ?? 'info',
    source: marker.source,
  }
}

/** Reveal a position in the editor once its model matches the target file. */
async function revealInEditor(filePath: string, line: number, column: number): Promise<void> {
  const targetUri = monaco.Uri.parse(`file:///${filePath}`).toString()
  for (let i = 0; i < 30; i++) {
    const editor = (window as unknown as { __monacoEditor?: monaco.editor.IStandaloneCodeEditor }).__monacoEditor
    if (editor) {
      const model = editor.getModel()
      if (model?.uri.toString() === targetUri) {
        editor.setPosition({ lineNumber: line, column })
        editor.revealLineInCenter(line)
        editor.focus()
        return
      }
    }
    await new Promise((r) => setTimeout(r, 100))
  }
}

export const useProblemsStore = create<ProblemsState>((set) => ({
  problems: [],
  isOpen: false,

  setOpen: (open) => set({ isOpen: open }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),

  /** Re-read Monaco markers for every open model into the panel's list. */
  refresh: () => {
    const openFiles = useEditorStore.getState().openFiles
    // Map each open file to its model URI string for exact matching (Windows
    // paths with backslashes normalize differently through Uri.parse)
    const uriToFile = new Map<string, string>()
    for (const f of openFiles) {
      uriToFile.set(monaco.Uri.parse(`file:///${f.path}`).toString(), f.path)
    }

    const problems: Problem[] = []
    for (const marker of monaco.editor.getModelMarkers({})) {
      const filePath = marker.resource ? uriToFile.get(marker.resource.toString()) : undefined
      if (!filePath) continue
      problems.push(markerToProblem(marker, filePath, filePath.split(/[/\\]/).pop() || filePath))
    }
    problems.sort((a, b) => {
      if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath)
      if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) {
        return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
      }
      return a.line - b.line
    })
    set({ problems })
  },

  openProblem: async (problem) => {
    await useEditorStore.getState().openFile(problem.filePath)
    await revealInEditor(problem.filePath, problem.line, problem.column)
  },
}))

/** Subscribe to Monaco's marker stream once (module side-effect). */
let markersSubscribed = false
export function ensureProblemsSubscription(): void {
  if (markersSubscribed) return
  markersSubscribed = true
  monaco.editor.onDidChangeMarkers(() => useProblemsStore.getState().refresh())
}
