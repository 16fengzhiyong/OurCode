/**
 * Tool helper functions - actual implementations called by tools
 * These use window.electronAPI to communicate with the main process
 */
import { loadIgnorePatterns, isIgnoredPath } from './context'

const EXCLUDED_DIRS = ['node_modules', '.git', 'dist', 'build', 'out', '.next', '__pycache__', 'vendor', '.vscode', '.idea']

/** Load .ourcodeignore patterns once per workspace root */
async function ensureIgnoreLoaded(): Promise<void> {
  const rootPath = document.getElementById('file-tree-root')?.getAttribute('data-root-path') || ''
  if (rootPath) {
    try { await loadIgnorePatterns(rootPath) } catch { /* ignore */ }
  }
}

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
  await ensureIgnoreLoaded()
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
    if (isIgnoredPath(entry.path)) continue
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
  await ensureIgnoreLoaded()
  const lines: string[] = []
  await walkTree(rootPath, '', 0, maxDepth, lines)
  return lines.join('\n')
}

async function walkTree(dirPath: string, prefix: string, depth: number, maxDepth: number, lines: string[]): Promise<void> {
  if (depth >= maxDepth) return
  const entries: any[] = await window.electronAPI.listDir(dirPath)
  if (!entries) return

  const filtered = entries.filter((e) => !EXCLUDED_DIRS.includes(e.name) && !isIgnoredPath(e.path))
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
  await ensureIgnoreLoaded()
  const results: string[] = await window.electronAPI.searchFiles(rootPath, pattern)
  if (!results || results.length === 0) return 'No files found'
  return results.filter((p) => !isIgnoredPath(p)).slice(0, 50).join('\n')
}

/** Search text content in files */
export async function searchInFiles(rootPath: string, query: string, filePattern?: string): Promise<string> {
  await ensureIgnoreLoaded()
  const options: any = { caseSensitive: false }
  if (filePattern) options.filePattern = filePattern
  const results: any[] = await window.electronAPI.searchInFiles(rootPath, query, options)
  if (!results || results.length === 0) return 'No matches found'
  return results.filter((r) => !isIgnoredPath(r.filePath)).slice(0, 50).map((r: any) => `${r.filePath}:${r.lineNumber}: ${r.lineContent}`).join('\n')
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

/** Web search via DuckDuckGo HTML (no API key required) */
export async function webSearch(query: string): Promise<string> {
  const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query)
  const res = await window.electronAPI.webFetch(url, { timeoutMs: 20000 })
  if (!res.ok || !res.text) {
    return `Web search failed: ${res.error || `HTTP ${res.status}`}`
  }
  const blocks = res.text.split(/<div[^>]*class="[^"]*result[^"]*"/i)
  const results: string[] = []
  for (const block of blocks.slice(1, 9)) {
    const hrefMatch = /href="([^"]+)"/.exec(block)
    const titleMatch = /class="result__a"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
    const snippetMatch = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
    const href = hrefMatch ? stripHtml(decodeEntities(hrefMatch[1])) : ''
    const title = titleMatch ? stripHtml(titleMatch[1]) : ''
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : ''
    if (title) {
      results.push(`- ${title}${href ? `\n  URL: ${href}` : ''}${snippet ? `\n  ${snippet}` : ''}`)
    }
  }
  return results.length > 0
    ? `Web search results for "${query}":\n${results.join('\n')}`
    : `No results found for "${query}"`
}

/** Fetch a URL and return its readable text content */
export async function readUrl(url: string): Promise<string> {
  const res = await window.electronAPI.webFetch(url, { timeoutMs: 20000, maxBytes: 2 * 1024 * 1024 })
  if (!res.ok || !res.text) {
    return `Failed to fetch ${url}: ${res.error || `HTTP ${res.status}`}`
  }
  const text = stripHtml(res.text)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return `Content of ${url}:\n\n${text.slice(0, 8000)}`
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
