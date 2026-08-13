/**
 * Tool helper functions - actual implementations called by tools
 * These use window.electronAPI to communicate with the main process
 */
import { loadIgnorePatterns, isIgnoredPath } from './context'
import { useUIStore } from '@/stores/uiStore'

const EXCLUDED_DIRS = ['node_modules', '.git', 'dist', 'build', 'out', '.next', '__pycache__', 'vendor', '.vscode', '.idea']

/** Current workspace root — the file tree's data attribute when mounted,
 *  falling back to the selected project (the tree only mounts in tree view). */
function workspaceRoot(): string {
  return document.getElementById('file-tree-root')?.getAttribute('data-root-path') || useUIStore.getState().rootPath || ''
}

/** Load .ourcodeignore patterns once per workspace root */
async function ensureIgnoreLoaded(): Promise<void> {
  const rootPath = workspaceRoot()
  if (rootPath) {
    try { await loadIgnorePatterns(rootPath) } catch { /* ignore */ }
  }
}

// The read_file tool advertises "Max 2000 lines, 50KB" — enforce both so a
// huge file can't flood the model's context window with the full content.
const READ_FILE_MAX_LINES = 2000
const READ_FILE_MAX_BYTES = 50 * 1024

/** Read a file with line numbers */
export async function readFile(path: string, startLine?: number, endLine?: number): Promise<string> {
  const { content } = await window.electronAPI.readFile(path)
  const lines = content.split('\n')
  // Apply the tool's advertised cap when the caller didn't pick an explicit
  // window: start at 1, cap the end at 2000 lines and ~50KB of text.
  const start = Math.max(1, startLine || 1) - 1
  const effectiveEnd = endLine ?? Math.min(lines.length, start + READ_FILE_MAX_LINES)
  const end = Math.min(lines.length, effectiveEnd)
  const selected = lines.slice(start, end)
  let out = selected.map((line, i) => `${start + i + 1}: ${line}`).join('\n')
  if (out.length > READ_FILE_MAX_BYTES) {
    out = out.slice(0, READ_FILE_MAX_BYTES) + '\n...(truncated)'
  }
  return out
}

/** Combined cap for read_multiple_files — wide batches must not flood the
 *  model's context window even though each file is already capped at 50KB. */
const READ_MULTI_MAX_TOTAL_BYTES = 200 * 1024

/** Read several files at once. Each file is capped independently at the same
 *  2000 lines / 50KB as read_file; the combined output is capped too, and the
 *  remaining files are named when the cap is hit so the model can decide. A
 *  failing file is reported inline without interrupting the others. */
export async function readMultipleFiles(paths: string[]): Promise<string> {
  const clean = Array.from(new Set((Array.isArray(paths) ? paths : []).map((p) => String(p || '').trim()).filter(Boolean)))
  if (clean.length === 0) return 'Error: paths 不能为空'

  const sections: string[] = []
  let totalBytes = 0
  let shown = 0
  for (const p of clean) {
    const header = `===== ${p} =====`
    let body = ''
    try {
      const { content } = await window.electronAPI.readFile(p)
      const lines = content.split('\n')
      const end = Math.min(lines.length, READ_FILE_MAX_LINES)
      body = lines.slice(0, end).map((line, i) => `${i + 1}: ${line}`).join('\n')
      if (body.length > READ_FILE_MAX_BYTES) {
        body = body.slice(0, READ_FILE_MAX_BYTES) + '\n...(truncated)'
      }
    } catch (error: any) {
      body = `(读取失败: ${error?.message || String(error)})`
    }
    if (totalBytes + header.length + body.length > READ_MULTI_MAX_TOTAL_BYTES && sections.length > 0) {
      sections.push(`...(总输出已达上限，剩余 ${clean.length - shown} 个文件未展示：${clean.slice(shown).join(', ')})`)
      break
    }
    sections.push(`${header}\n${body}`)
    totalBytes += header.length + body.length
    shown++
  }
  return sections.join('\n\n')
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

/** Search text content in files (literal substring by default; regex when useRegex) */
export async function searchInFiles(rootPath: string, query: string, filePattern?: string, useRegex = false): Promise<string> {
  await ensureIgnoreLoaded()
  const options: any = { caseSensitive: false }
  if (useRegex) options.regex = true
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

/** Edit a file by replacing exact text — first occurrence by default, all
 *  occurrences when replaceAll is true (split/join, never a regex, so the
 *  replacement text can't be misinterpreted as a pattern). */
export async function editFile(path: string, oldText: string, newText: string, replaceAll = false): Promise<string> {
  const { content } = await window.electronAPI.readFile(path)
  if (!content.includes(oldText)) {
    return `Error: Could not find the specified text in ${path}. The text may have changed or the match is not exact.`
  }
  const newContent = replaceAll ? content.split(oldText).join(newText) : content.replace(oldText, newText)
  await window.electronAPI.writeFile(path, newContent, 'utf-8')
  return `File edited: ${path}${replaceAll ? ' (all occurrences)' : ''}`
}

interface EditSpec {
  path?: string
  oldText?: string
  newText?: string
  replaceAll?: boolean
}

/** Apply exact-text edits across multiple files in one call. Two-phase:
 *  1) read every target, then validate + apply each edit against in-memory
 *     buffers — edits to the same file validate against the result of the
 *     previous edits (sequential), edits to different files stay independent;
 *  2) only if ALL edits validate, persist every buffer to disk.
 *  A failing edit therefore writes nothing — no half-applied refactor. A write
 *  error reports exactly how many files landed. */
export async function multiEditFile(edits: EditSpec[]): Promise<string> {
  const specs = (Array.isArray(edits) ? edits : [])
    .map((e) => ({
      path: String(e?.path || '').trim(),
      oldText: String(e?.oldText ?? ''),
      newText: String(e?.newText ?? ''),
      replaceAll: !!e?.replaceAll,
    }))
    .filter((e) => e.path && e.oldText)
  if (specs.length === 0) return 'Error: multi_edit_file 需要非空的 edits 数组'

  // Phase 1 — read + validate + buffer-apply everything before touching disk
  const contents = new Map<string, string>()
  const failures: string[] = []
  for (const e of specs) {
    if (!contents.has(e.path)) {
      try {
        const { content } = await window.electronAPI.readFile(e.path)
        contents.set(e.path, content)
      } catch (error: any) {
        failures.push(`- ${e.path}: 无法读取文件 (${error?.message || String(error)})`)
        continue
      }
    }
    const content = contents.get(e.path)!
    if (!content.includes(e.oldText)) {
      const snippet = e.oldText.length > 80 ? e.oldText.slice(0, 80) + '…' : e.oldText
      failures.push(`- ${e.path}: 未找到要替换的文本 "${snippet}"`)
      continue
    }
    contents.set(e.path, e.replaceAll ? content.split(e.oldText).join(e.newText) : content.replace(e.oldText, e.newText))
  }
  if (failures.length > 0) {
    return `Error: multi_edit_file 校验失败，未写入任何文件（${failures.length} 处不匹配）：\n${failures.join('\n')}`
  }

  // Phase 2 — persist the validated buffers
  const written: string[] = []
  for (const [path, content] of contents) {
    try {
      await window.electronAPI.writeFile(path, content, 'utf-8')
      written.push(path)
    } catch (error: any) {
      return `Error: multi_edit_file 写入 ${path} 失败 (${error?.message || String(error)})；已完成 ${written.length}/${contents.size} 个文件，其余未写入。`
    }
  }
  return `已批量编辑 ${specs.length} 处（${contents.size} 个文件）。`
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
/** Run a shell command. timeoutMs 可选（默认主进程 30s）——构建/测试等长命令
 *  传更大值（如 120000），避免被默认超时中断后误判成命令失败。 */
export async function runCommand(command: string, cwd?: string, timeoutMs?: number): Promise<string> {
  const rootPath = workspaceRoot()
  const workDir = cwd || rootPath
  const result = await window.electronAPI.shellExec(command, workDir, { timeoutMs })
  if (result.success) {
    return result.output
  }
  return `Error: ${result.error}${result.output ? '\n' + result.output : ''}`
}

/**
 * Run a git command in the given repo root (defaults to the workspace root).
 * 走主进程 git:exec：已带路径白名单校验 + 15s 超时 + 5MB 上限。cwd 优先用
 * agent 会话的项目根（context.projectPath），与 agent 视角一致——浏览侧
 * workspaceRoot() 只是兜底。
 */
export async function runGit(args: string[], cwd?: string): Promise<string> {
  const workDir = cwd || workspaceRoot()
  if (!workDir) return 'Error: 未打开项目，无法执行 git 命令'
  const result = await window.electronAPI.gitExec(workDir, args)
  if (result.success) {
    return result.output || '(无输出)'
  }
  return `Error: ${result.error || 'git 命令失败'}`
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

/** Fetch a URL and return its readable text content. With an optional `prompt`
 *  the page is answered by an LLM instead (bounded input/output); on any
 *  failure — no API config, no default model, empty or errored answer — it
 *  degrades to the raw text, so read_url never breaks on a missing key. */
export async function readUrl(url: string, prompt?: string): Promise<string> {
  const res = await window.electronAPI.webFetch(url, { timeoutMs: 20000, maxBytes: 2 * 1024 * 1024 })
  if (!res.ok || !res.text) {
    return `Failed to fetch ${url}: ${res.error || `HTTP ${res.status}`}`
  }
  const text = stripHtml(res.text)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!prompt) {
    return `Content of ${url}:\n\n${text.slice(0, 8000)}`
  }
  return extractWithLLM(url, prompt, text)
}

/** LLM extraction for read_url with a prompt — same non-streaming pattern as
 *  memory condensation (active config group's default model). Pure client-side
 *  call: it cannot re-enter the agent loop, so there is no recursion risk. */
async function extractWithLLM(url: string, prompt: string, pageText: string): Promise<string> {
  // No page text — nothing to extract from; skip the LLM call entirely rather
  // than risk a hallucinated answer from an empty source.
  if (!pageText.trim()) {
    return `Content of ${url}:\n\n${pageText}`
  }
  const { sendLLMRequest } = await import('@/services/llm/LLMClient')
  const { useConfigStore } = await import('@/stores/configStore')
  const group = useConfigStore.getState().getActiveConfigGroup()
  const model = (group?.defaultModel || '').trim()
  if (!group || !model) {
    return `Content of ${url}:\n\n${pageText.slice(0, 8000)}`
  }

  const INPUT_MAX = 15 * 1024
  const system =
    '你是网页内容提取助手。只根据提供的网页原文回答用户的具体问题，不要编造原文中没有的信息；' +
    '原文中找不到答案时如实说明。用中文回答，保持简洁。'
  let extracted = ''
  try {
    for await (const chunk of sendLLMRequest(
      {
        model,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: `网页 URL: ${url}\n问题: ${prompt}\n\n网页原文（前 ${INPUT_MAX} 字符）:\n${pageText.slice(0, INPUT_MAX)}`,
          },
        ],
        stream: false,
        temperature: 0,
        maxTokens: 600,
        topP: 1,
        frequencyPenalty: 0,
        presencePenalty: 0,
      },
      group,
      60_000,
    )) {
      if (chunk.content) extracted += chunk.content
      if (chunk.done) break
    }
  } catch {
    // fall through to the raw-text fallback below
  }
  const answer = extracted.trim()
  if (!answer) {
    return `Content of ${url}:\n\n${pageText.slice(0, 8000)}`
  }
  return `回答（由 AI 从 ${url} 提取）:\n\n${answer}`
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
