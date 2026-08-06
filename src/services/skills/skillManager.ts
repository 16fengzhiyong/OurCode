/**
 * Skill Manager — discovers Claude-Code-style skills (SKILL.md files) from the
 * workspace (.claude/skills, .ourcode/skills, skills) and the global user-data
 * directory, parses their frontmatter, and exposes them as dynamic tools
 * (skill__<name>) so the agent can load a skill's instructions on demand.
 *
 * This matches mainstream AI tools (ZCode / Claude Code / Windsurf): the system
 * prompt only injects a compact index of available skills; invoking
 * skill__<name> returns the full SKILL.md content, which the model then follows.
 * Each invocation is recorded into the usage dashboard (category 'skill').
 */
import type { ToolDefinition } from '@/services/tools/types'
import { isSkillEnabled } from '@/services/skills/skillRegistry'

export interface SkillInfo {
  name: string
  description: string
  source: 'workspace' | 'global'
  path: string
  /** Full raw file content (frontmatter + body) */
  content: string
  mtime: number
}

const SKILL_DIRS = ['.claude/skills', '.ourcode/skills', 'skills']

/** Renderer-side workspace root (the file tree's data attribute) */
export function getWorkspaceRoot(): string {
  return document.getElementById('file-tree-root')?.getAttribute('data-root-path') || ''
}

function joinPath(dir: string, name: string): string {
  return dir.replace(/[\\/]$/, '') + '/' + name
}

/** Global skills dir (<userData>/skills) — '' when unavailable (e.g. tests) */
async function getGlobalSkillsDir(): Promise<string> {
  try {
    const userData = await window.electronAPI?.getPath?.('userData')
    return userData ? joinPath(userData, 'skills') : ''
  } catch {
    return ''
  }
}

async function listDirSafe(dir: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
  try {
    const entries = await window.electronAPI.listDir(dir)
    return (entries || []).map((e) => ({ name: e.name, isDirectory: !!e.isDirectory }))
  } catch {
    return []
  }
}

async function statSafe(path: string): Promise<{ modifiedAt: number } | null> {
  try {
    return await window.electronAPI.stat(path)
  } catch {
    return null
  }
}

async function readFileSafe(path: string): Promise<string> {
  try {
    const { content } = await window.electronAPI.readFile(path)
    return content || ''
  } catch {
    return ''
  }
}

/**
 * Parse a skill's frontmatter (name / description) with graceful fallbacks:
 * the directory name becomes the skill name, and the first non-empty line of
 * the body becomes the description when frontmatter is absent.
 */
export function parseSkillFrontmatter(content: string, fallbackName: string): { name: string; description: string; body: string } {
  let name = fallbackName
  let description = ''
  let body = content
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content)
  if (m) {
    body = content.slice(m[0].length)
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line.trim())
      if (!kv) continue
      const key = kv[1].toLowerCase()
      const value = kv[2].trim().replace(/^["']|["']$/g, '')
      if (key === 'name' && value) name = value
      if (key === 'description' && value) description = value
    }
  }
  if (!description) {
    const first = body.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'))
    description = (first || fallbackName).slice(0, 100)
  }
  return { name, description, body }
}

interface SkillCache {
  root: string
  mtime: number
  skills: SkillInfo[]
}

let _cache: SkillCache | null = null

/** Discover + parse all skills (cached by newest mtime across all skill files) */
export async function listSkills(force = false, rootOverride?: string, includeDisabled = false): Promise<SkillInfo[]> {
  const root = rootOverride ?? getWorkspaceRoot()
  const global = await getGlobalSkillsDir()
  const workspaceDirs = SKILL_DIRS.map((d) => joinPath(root, d))
  const dirs = global ? [...workspaceDirs, global] : workspaceDirs

  // Enumerate every SKILL.md / skill.md candidate under each dir
  const candidates: Array<{ dir: string; path: string; source: 'workspace' | 'global' }> = []
  for (const dir of dirs) {
    const source: 'workspace' | 'global' = global && dir === global ? 'global' : 'workspace'
    const entries = await listDirSafe(dir)
    for (const e of entries) {
      if (!e.isDirectory) continue
      candidates.push({ dir: joinPath(dir, e.name), path: joinPath(joinPath(dir, e.name), 'SKILL.md'), source })
      candidates.push({ dir: joinPath(dir, e.name), path: joinPath(joinPath(dir, e.name), 'skill.md'), source })
    }
  }

  // Cache invalidation: newest file mtime across all candidates, plus the
  // skills.json config mtime (a disabled/enabled toggle must invalidate too)
  let newest = 0
  for (const c of candidates) {
    const s = await statSafe(c.path)
    if (s && s.modifiedAt > newest) newest = s.modifiedAt
  }
  const configMtime = (await statSafe(joinPath(root, 'skills.json')))?.modifiedAt || 0
  const cacheMtime = Math.max(newest, configMtime)
  if (!force && _cache && _cache.root === root && _cache.mtime >= cacheMtime) return _cache.skills

  // One non-empty content per skill directory (SKILL.md wins over skill.md)
  const byDir = new Map<string, { content: string; source: 'workspace' | 'global'; dir: string }>()
  for (const c of candidates) {
    if (byDir.has(c.dir)) continue
    const content = await readFileSafe(c.path)
    if (content) byDir.set(c.dir, { content, source: c.source, dir: c.dir })
  }

  const skills: SkillInfo[] = []
  for (const [dir, info] of byDir) {
    const fallbackName = dir.split(/[/\\]/).pop() || 'skill'
    const parsed = parseSkillFrontmatter(info.content, fallbackName)
    skills.push({
      name: parsed.name,
      description: parsed.description,
      source: info.source,
      path: dir,
      content: info.content,
      mtime: newest,
    })
  }
  // Respect skills.json enable/disable overrides (default: enabled). The
  // registry UI passes includeDisabled=true so toggles stay visible.
  const visible: SkillInfo[] = []
  for (const skill of skills) {
    if (includeDisabled || (await isSkillEnabled(skill.name, root))) visible.push(skill)
  }
  visible.sort((a, b) => a.name.localeCompare(b.name))

  _cache = { root, mtime: cacheMtime, skills: visible }
  return visible
}

/** Compact index block injected into the system prompt (content stays on demand) */
export async function buildSkillIndex(rootOverride?: string): Promise<string> {
  const skills = await listSkills(false, rootOverride)
  if (skills.length === 0) return ''
  const lines = skills.map((s) => `- ${s.name}: ${s.description || '(无描述)'}`)
  return `\n\n<available_skills>\n以下技能可用。当任务涉及某项技能时，调用对应的 skill__<name> 工具加载其完整说明，并严格遵循其中的步骤。\n${lines.join('\n')}\n</available_skills>`
}

/** Full skill content (frontmatter stripped) for the skill__<name> tool result */
export async function loadSkillContent(name: string, rootOverride?: string): Promise<string | null> {
  const skills = await listSkills(false, rootOverride)
  const skill = skills.find((s) => s.name === name)
  if (!skill) return null
  const parsed = parseSkillFrontmatter(skill.content, skill.name)
  return `# 技能: ${skill.name}\n\n${parsed.description ? `> ${parsed.description}\n\n` : ''}${parsed.body.trim()}`
}

/** Dynamic tool definitions: one skill__<name> tool per discovered skill */
export async function toSkillToolDefinitions(force = false, rootOverride?: string): Promise<ToolDefinition[]> {
  const skills = await listSkills(force, rootOverride)
  return skills.map((s) => ({
    type: 'function' as const,
    function: {
      name: `skill__${s.name}`,
      description: `[技能] ${s.description || s.name}。调用后返回该技能的完整说明，请严格遵循其中步骤完成任务。`,
      parameters: { type: 'object', properties: {} },
    },
  }))
}
