/**
 * Tool helper functions - actual implementations called by tools
 * These use window.electronAPI to communicate with the main process
 */

const EXCLUDED_DIRS = ['node_modules', '.git', 'dist', 'build', 'out', '.next', '__pycache__', 'vendor', '.vscode', '.idea']

/** Read a file with line numbers */
export async function readFile(path: string, startLine?: number, endLine?: number): Promise<string> {
  const { content } = await window.electronAPI.readFile(path)
  const lines = content.split('\n')
  const start = Math.max(1, startLine || 1) - 1
  const end = Math.min(lines.length, endLine || lines.length)
  const selected = lines.slice(start, end)
  return selected.map((line, i) => `${start + i + 1}: ${line}`).join('\n')
}

/** List directory contents (recursive up to maxDepth) */
export async function listDirectory(path: string, maxDepth: number = 1): Promise<string> {
  const lines: string[] = []
  await walkListing(path, '', 0, Math.min(maxDepth, 5), lines)
  return lines.join('\n')
}

async function walkListing(dirPath: string, prefix: string, depth: number, maxDepth: number, lines: string[]): Promise<void> {
  if (depth > maxDepth) return
  const entries: any[] = await window.electronAPI.listDir(dirPath)
  if (!entries || entries.length === 0) {
    if (depth === 0) lines.push('(empty directory)')
    return
  }

  for (const entry of entries) {
    if (EXCLUDED_DIRS.includes(entry.name)) continue
    const icon = entry.isDirectory ? '[DIR]' : '[FILE]'
    const size = entry.size != null ? ` (${formatSize(entry.size)})` : ''
    lines.push(`${prefix}${icon} ${entry.name}${size}`)
    if (entry.isDirectory && depth < maxDepth) {
      await walkListing(entry.path, prefix + '  ', depth + 1, maxDepth, lines)
    }
  }
}

/** Get directory tree structure */
export async function getDirectoryTree(rootPath: string, maxDepth: number = 3): Promise<string> {
  const lines: string[] = []
  await walkTree(rootPath, '', 0, maxDepth, lines)
  return lines.join('\n')
}

async function walkTree(dirPath: string, prefix: string, depth: number, maxDepth: number, lines: string[]): Promise<void> {
  if (depth >= maxDepth) return
  const entries: any[] = await window.electronAPI.listDir(dirPath)
  if (!entries) return

  const filtered = entries.filter((e) => !EXCLUDED_DIRS.includes(e.name))
  for (let i = 0; i < filtered.length; i++) {
    const entry = filtered[i]
    const isLast = i === filtered.length - 1
    const connector = isLast ? '└── ' : '├── '
    const childPrefix = isLast ? '    ' : '│   '
    lines.push(`${prefix}${connector}${entry.name}`)
    if (entry.isDirectory) {
      await walkTree(entry.path, prefix + childPrefix, depth + 1, maxDepth, lines)
    }
  }
}

/** Search files by name pattern */
export async function searchFiles(rootPath: string, pattern: string): Promise<string> {
  const globPattern = pattern.includes('*') ? pattern : `*${pattern}*`
  const results: any[] = await window.electronAPI.searchInFiles(rootPath, globPattern, { caseSensitive: false })
  if (!results || results.length === 0) return 'No files found'
  const uniquePaths = [...new Set(results.map((r: any) => r.filePath))]
  return uniquePaths.slice(0, 50).join('\n')
}

/** Search text content in files */
export async function searchInFiles(rootPath: string, query: string, filePattern?: string): Promise<string> {
  const options: any = { caseSensitive: false }
  if (filePattern) options.filePattern = filePattern
  const results: any[] = await window.electronAPI.searchInFiles(rootPath, query, options)
  if (!results || results.length === 0) return 'No matches found'
  return results.slice(0, 50).map((r: any) => `${r.filePath}:${r.lineNumber}: ${r.lineContent}`).join('\n')
}

/** Write content to a file */
export async function writeFile(path: string, content: string): Promise<string> {
  await window.electronAPI.writeFile(path, content, 'utf-8')
  return `File written: ${path}`
}

/** Edit a file by replacing exact text */
export async function editFile(path: string, oldText: string, newText: string): Promise<string> {
  const { content } = await window.electronAPI.readFile(path)
  if (!content.includes(oldText)) {
    return `Error: Could not find the specified text in ${path}. The text may have changed or the match is not exact.`
  }
  const newContent = content.replace(oldText, newText)
  await window.electronAPI.writeFile(path, newContent, 'utf-8')
  return `File edited: ${path}`
}

/** Create a directory */
export async function createDirectory(path: string): Promise<string> {
  await window.electronAPI.createDir(path)
  return `Directory created: ${path}`
}

/** Delete a file or directory */
export async function deleteFileOrDir(path: string): Promise<string> {
  await window.electronAPI.delete(path)
  return `Deleted: ${path}`
}

/** Run a shell command */
export async function runCommand(command: string, cwd?: string): Promise<string> {
  const rootPath = document.getElementById('file-tree-root')?.getAttribute('data-root-path') || ''
  const workDir = cwd || rootPath
  const result = await window.electronAPI.shellExec(command, workDir)
  if (result.success) {
    return result.output
  }
  return `Error: ${result.error}${result.output ? '\n' + result.output : ''}`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
