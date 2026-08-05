/**
 * Built-in code snippets, registered as Monaco snippet completions so `prefix`
 * + Tab expands to `body` (snippet syntax: $1, $2, ${1:default} placeholders).
 */
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main'

export interface Snippet {
  prefix: string
  body: string
  description: string
}

export const SNIPPETS: Record<string, Snippet[]> = {
  javascript: [
    { prefix: 'clg', description: 'console.log', body: 'console.log($1)$0' },
    { prefix: 'fn', description: 'arrow function', body: 'const ${1:name} = (${2:args}) => {\n  $0\n}' },
    { prefix: 'forof', description: 'for...of loop', body: 'for (const ${1:item} of ${2:items}) {\n  $0\n}' },
    { prefix: 'promise', description: 'new Promise', body: 'new Promise((resolve, reject) => {\n  $0\n})' },
    { prefix: 'asyncfn', description: 'async function', body: 'async function ${1:name}(${2:args}) {\n  $0\n}' },
  ],
  typescript: [
    { prefix: 'interface', description: 'interface declaration', body: 'interface ${1:Name} {\n  ${2:prop}: ${3:type}\n}' },
    { prefix: 'type', description: 'type alias', body: 'type ${1:Name} = ${2:T}' },
    { prefix: 'clg', description: 'console.log', body: 'console.log($1)$0' },
    { prefix: 'genfn', description: 'generic function', body: 'function ${1:name}<T>(${2:arg}: T): T {\n  $0\n}' },
  ],
  python: [
    { prefix: 'def', description: 'function definition', body: 'def ${1:name}(${2:args}):\n    $0' },
    { prefix: 'cls', description: 'class definition', body: 'class ${1:Name}:\n    def __init__(self${2:, args}):\n        $0' },
    { prefix: 'main', description: 'if __name__ guard', body: 'if __name__ == "__main__":\n    $0' },
    { prefix: 'imp', description: 'import', body: 'import ${1:module}' },
  ],
  html: [
    { prefix: 'doc', description: 'HTML5 document', body: '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${1:文档}</title>\n</head>\n<body>\n  $0\n</body>\n</html>' },
    { prefix: 'div', description: 'div', body: '<div class="${1:container}">\n  $0\n</div>' },
    { prefix: 'btn', description: 'button', body: '<button ${1:type="button"}>${2:按钮}</button>' },
  ],
  css: [
    { prefix: 'flex', description: 'flex container', body: 'display: flex;\njustify-content: ${1:center};\nalign-items: ${2:center};' },
    { prefix: 'grid', description: 'grid container', body: 'display: grid;\ngrid-template-columns: repeat(${1:3}, 1fr);\ngap: ${2:1rem};' },
  ],
  sql: [
    { prefix: 'select', description: 'SELECT', body: 'SELECT ${1:*}\nFROM ${2:table}\nWHERE ${3:condition};' },
    { prefix: 'ins', description: 'INSERT', body: 'INSERT INTO ${1:table} (${2:cols})\nVALUES (${3:values});' },
  ],
}

let registered = false

/** Register the snippet completion provider once (module side-effect). */
export function registerSnippets(): void {
  if (registered) return
  registered = true

  monaco.languages.registerCompletionItemProvider('*', {
    provideCompletionItems(model, position) {
      const lang = model.getLanguageId()
      const list = SNIPPETS[lang]
      if (!list || list.length === 0) return { suggestions: [] }

      // Replace the word the user is typing (e.g. "clg")
      const word = model.getWordUntilPosition(position)

      return {
        suggestions: list.map((s) => ({
          label: s.prefix,
          detail: s.description,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: s.body,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: { value: '```\n' + s.body + '\n```' },
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          },
        })),
      }
    },
  })
}
