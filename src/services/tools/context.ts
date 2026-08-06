/**
 * Context engine — automatic context retrieval.
 *
 * Given the user's message, retrieves the most relevant files in the workspace
 * (by name match + content keyword search) and appends them as a bounded
 * <retrieved_context> block. Also loads workspace rules / Claude skills
 * (.ourcoderules, .claude/skills, .ourcode/skills) into the system prompt, and
 * honors a .ourcodeignore file (gitignore-style) for tool listings.
 *
 * No embeddings — heuristic keyword/symbol retrieval first (cheap, local),
 * which covers ~80% of the value; a local embedding index can be layered on
 * later without changing the prompt shape.
 */

import { listSkills, buildSkillIndex } from '@/services/skills/skillManager'

const SOURCE_EXTENSIONS = '*.ts,*.tsx,*.js,*.jsx,*.mjs,*.cjs,*.py,*.go,*.rs,*.java,*.kt,*.c,*.cpp,*.h,*.hpp,*.cs,*.rb,*.php,*.swift,*.vue,*.svelte,*.html,*.css,*.scss,*.json,*.yaml,*.yml,*.sql,*.sh,*.md,*.toml,*.ini'

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'please', 'you', 'your',
  'are', 'can', 'will', 'would', 'should', 'could', 'not', 'was', 'were', 'been', 'has',
  'its', 'all', 'any', 'but', 'our', 'they', 'them', 'their', 'there', 'these', 'those',
])

const MAX_CONTEXT_BYTES = 6000
const MAX_CONTEXT_FILES = 8
const MAX_KEYWORDS = 3

const KNOWLEDGE_CACHE = new Map<string, { mtime: number; text: string }>()

// ───────────────────────── Keyword extraction ─────────────────────────

/** Extract search keywords from free text (identifiers, words, CJK bigrams) */
export function extractKeywords(text: string): string[] {
  const tokens = new Set<string>()

  // CamelCase / snake_case identifiers
  const idMatches = text.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || []
  for (const id of idMatches) {
    // Split camelCase into meaningful parts
    if (!STOPWORDS.has(id.toLowerCase())) tokens.add(id.toLowerCase())
    for (const part of id.split(/(?=[A-Z])/)) {
      const p = part.toLowerCase()
      if (part.length >= 3 && !STOPWORDS.has(p)) tokens.add(p)
    }
    for (const part of id.split('_')) {
      const p = part.toLowerCase()
      if (part.length >= 3 && !STOPWORDS.has(p)) tokens.add(p)
    }
  }

  // Plain English words
  const wordMatches = text.match(/[a-zA-Z]{3,}/g) || []
  for (const w of wordMatches) {
    const lower = w.toLowerCase()
    if (STOPWORDS.has(lower)) continue
    tokens.add(lower)
  }

  // CJK bigrams (adjacent character pairs carry most meaning)
  const cjk = text.replace(/[^\u4e00-\u9fff]/g, '')
  for (let i = 0; i < cjk.length - 1; i++) {
    tokens.add(cjk.slice(i, i + 2))
  }

  return Array.from(tokens).slice(0, 20)
}

/** Score a document against keywords: how many distinct keywords appear? */
export function scoreAgainstKeywords(text: string, keywords: string[]): number {
  const lower = text.toLowerCase()
  let score = 0
  for (const kw of keywords) {
    if (lower.includes(kw)) score++
  }
  return score
}

// ───────────────────────── Retrieval ─────────────────────────

/**
 * Retrieve relevant code context for the user's latest message.
 * Returns a bounded block to append to the system prompt, or ''.
 */
export async function retrieveRelevantContext(
  userContent: string,
  contextFiles: string[],
  rootPath: string,
  _activeFilePath?: string,
): Promise<string> {
  if (!rootPath) return ''

  const keywords = extractKeywords(userContent).slice(0, MAX_KEYWORDS)
  if (keywords.length === 0) return ''

  const matches: Array<{ path: string; line?: number; content?: string; score: number }> = []

  // 1) File-name matches (highest signal)
  try {
    const nameHits = await window.electronAPI.searchFiles(rootPath, keywords[0])
    for (const p of nameHits.slice(0, 10)) matches.push({ path: p, score: 10 })
  } catch { /* ignore */ }

  // 2) Content keyword search
  const seen = new Set<string>()
  for (const kw of keywords) {
    try {
      const hits = await window.electronAPI.searchInFiles(rootPath, kw, {
        filePattern: SOURCE_EXTENSIONS,
        caseSensitive: false,
      })
      for (const hit of hits.slice(0, 20)) {
        if (seen.has(hit.filePath)) continue
        seen.add(hit.filePath)
        matches.push({
          path: hit.filePath,
          line: hit.lineNumber,
          content: hit.lineContent,
          score: 5,
        })
      }
    } catch { /* ignore */ }
  }

  // 3) Context files explicitly referenced by the user
  for (const f of contextFiles) {
    matches.push({ path: f, score: 8 })
  }

  if (matches.length === 0) return ''

  // Rank: explicit context files first, then name matches, then content matches
  matches.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    return (a.path.length - b.path.length)
  })

  const lines: string[] = []
  let bytes = 0
  const seenPaths = new Set<string>()

  for (const m of matches) {
    if (lines.length >= MAX_CONTEXT_FILES) break
    if (seenPaths.has(m.path)) continue
    seenPaths.add(m.path)
    const fileName = m.path.split(/[/\\]/).pop() || m.path

    if (m.content != null) {
      const line = `- ${m.path}:${m.line}: ${m.content.slice(0, 160)}`
      bytes += line.length
      if (bytes > MAX_CONTEXT_BYTES) break
      lines.push(line)
    } else {
      const snippet = await readFileSnippet(m.path)
      const line = snippet
        ? `- ${m.path}\n${snippet}`
        : `- ${m.path}`
      bytes += line.length
      if (bytes > MAX_CONTEXT_BYTES) break
      lines.push(line)
    }
  }

  if (lines.length === 0) return ''
  return `\n\n<retrieved_context>\n以下是工作区中与本次请求相关的文件（自动检索）：\n${lines.join('\n')}\n</retrieved_context>`
}

/** Read the first ~40 lines of a file as a snippet */
async function readFileSnippet(path: string): Promise<string> {
  try {
    const { content } = await window.electronAPI.readFile(path)
    const lines = content.split('\n').slice(0, 40)
    return lines.map((l, i) => `  ${i + 1}: ${l}`).join('\n').slice(0, 1200)
  } catch {
    return ''
  }
}

// ───────────────────────── Workspace rules + skills ─────────────────────────

/**
 * Load workspace knowledge: .ourcoderules / rules.json + Claude-style skills
 * (from .claude/skills and .ourcode/skills directories). Rules files are
 * injected in full; skills are injected as a compact index only — the model
 * loads a skill's full instructions on demand via the skill__<name> tool.
 * Cached by mtime.
 */
export async function loadWorkspaceKnowledge(rootPath: string): Promise<string> {
  if (!rootPath) return ''
  const key = rootPath
  try {
    const { stat } = window.electronAPI
    let newest = 0
    const rulesFiles = ['.ourcoderules', 'rules.json', 'RULES.md']
    for (const f of rulesFiles) {
      try {
        const s = await stat(joinPath(rootPath, f))
        if (s.modifiedAt > newest) newest = s.modifiedAt
      } catch { /* missing */ }
    }
    // Skill mtimes come from the shared SkillManager cache (used by the
    // skill__<name> tools too, so the prompt index stays in sync).
    const skills = await listSkills(false, rootPath)
    for (const s of skills) {
      if (s.mtime > newest) newest = s.mtime
    }
    const cached = KNOWLEDGE_CACHE.get(key)
    if (cached && cached.mtime >= newest) return cached.text

    const parts: string[] = []
    for (const f of rulesFiles) {
      const text = await tryReadFile(joinPath(rootPath, f))
      if (text) parts.push(text.trim())
    }
    const skillIndex = await buildSkillIndex(rootPath)
    if (skillIndex) parts.push(skillIndex)
    const text = parts.length ? `\n\n<workspace_knowledge>\n${parts.join('\n\n')}\n</workspace_knowledge>` : ''
    KNOWLEDGE_CACHE.set(key, { mtime: newest, text })
    return text
  } catch {
    return ''
  }
}

async function tryReadFile(path: string): Promise<string> {
  try {
    const { content } = await window.electronAPI.readFile(path)
    return content
  } catch {
    return ''
  }
}

function joinPath(dir: string, name: string): string {
  return dir.replace(/[\\/]$/, '') + '/' + name
}

// ───────────────────────── .ourcodeignore ─────────────────────────

let ignoreCache = { root: '', mtime: 0, patterns: [] as string[] }

/** Reload .ourcodeignore (gitignore-style) from the workspace root */
export async function loadIgnorePatterns(rootPath: string): Promise<void> {
  if (!rootPath || rootPath === ignoreCache.root) return
  try {
    const { stat } = window.electronAPI
    const ignorePath = joinPath(rootPath, '.ourcodeignore')
    const s = await stat(ignorePath)
    if (s.modifiedAt === ignoreCache.mtime && ignoreCache.root === rootPath) return
    const { content } = await window.electronAPI.readFile(ignorePath)
    ignoreCache = {
      root: rootPath,
      mtime: s.modifiedAt,
      patterns: content.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')),
    }
  } catch {
    ignoreCache = { root: rootPath, mtime: 0, patterns: [] }
  }
}

/** Check whether a path should be ignored per .ourcodeignore (simple glob-ish) */
export function isIgnoredPath(path: string): boolean {
  const { patterns } = ignoreCache
  if (patterns.length === 0) return false
  const normalized = path.replace(/\\/g, '/')
  const baseName = normalized.split('/').pop() || ''
  for (const p of patterns) {
    const pattern = p.endsWith('/') ? p.slice(0, -1) : p
    if (baseName === pattern) return true
    if (normalized.includes(`/${pattern}/`)) return true
    if (normalized === pattern) return true
    if (pattern.includes('*')) {
      const re = new RegExp('^' + pattern.split('*').map(escapeRe).join('.*') + '$')
      if (re.test(normalized) || re.test(baseName)) return true
    }
  }
  return false
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ───────────────────────── Editor selection context ─────────────────────────

/** Read the current selection from the live Monaco editor (if any) */
export function getEditorSelectionContext(): string {
  try {
    const editor = (window as any).__monacoEditor as any
    if (!editor || !editor.getSelection || !editor.getModel) return ''
    const selection = editor.getSelection()
    const model = editor.getModel()
    if (!selection || selection.isEmpty() || !model) return ''
    const filePath = model.uri?.path || ''
    const text = model.getValueInRange(selection)
    if (!text) return ''
    return `\n\n<editor_selection path="${filePath}" lineStart="${selection.startLineNumber}" lineEnd="${selection.endLineNumber}">\n${text.slice(0, 4000)}\n</editor_selection>`
  } catch {
    return ''
  }
}
