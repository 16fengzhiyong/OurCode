/**
 * Lightweight "current symbol" detection for the breadcrumb bar. Monaco 0.50's
 * standalone build does not expose getDocumentSymbols, so we find the enclosing
 * declarations by scanning lines upward from the cursor, accepting only
 * declarations at strictly shallower indentation (outer → inner chain).
 * A heuristic: covers the common TS/JS/Python shapes and degrades to [] when
 * nothing matches.
 */

export interface EnclosingSymbol {
  name: string
  kind: 'class' | 'function' | 'method' | 'interface' | 'const' | 'def' | 'other'
}

const DECLARATION_RE = [
  /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, // class X
  /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, // interface X
  /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, // function x
  /^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(?/, // const x = (…) =>
  /^\s*(?:public|private|protected|static|readonly|async|get|set)?\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[{:]/, // method() { / arrow at block start
  /^\s*def\s+([A-Za-z_][\w]*)\s*\(/, // python def
  /^\s*class\s+([A-Za-z_][\w]*)\s*[:(]/, // python class
]

const KIND_FOR = (i: number): EnclosingSymbol['kind'] =>
  i === 0 ? 'class' : i === 1 ? 'interface' : i === 5 || i === 6 ? 'def' : i === 3 ? 'const' : i === 4 ? 'method' : 'function'

function indentOf(line: string): number {
  const m = line.match(/^\s*/)
  return m ? m[0].length : 0
}

/**
 * Find the enclosing symbol chain (outermost → innermost) at `lineNumber`
 * (1-based). Returns [] when nothing matches.
 */
export function findEnclosingSymbols(lines: string[], lineNumber: number): EnclosingSymbol[] {
  if (lineNumber < 1 || lineNumber > lines.length) return []
  const chain: EnclosingSymbol[] = []
  // Start above the cursor: a declaration on the cursor's own line is the symbol
  // being edited, not an enclosing one (e.g. `const doubled = …` at the cursor).
  const cursorIndent = indentOf(lines[lineNumber - 1])
  let minIndent = cursorIndent + 1

  for (let i = lineNumber - 2; i >= 0; i--) {
    const line = lines[i]
    const indent = indentOf(line)
    for (let r = 0; r < DECLARATION_RE.length; r++) {
      const m = line.match(DECLARATION_RE[r])
      if (m && m[1] && indent < minIndent) {
        chain.unshift({ name: m[1], kind: KIND_FOR(r) })
        minIndent = indent
        break
      }
    }
  }
  return chain
}
