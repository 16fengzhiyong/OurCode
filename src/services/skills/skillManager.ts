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
import { useUIStore } from '@/stores/uiStore'

export interface SkillInfo {
  name: string
  description: string
  /** Global skills (follow the IDE) vs project skills (scoped to a project). */
  source: 'global' | 'project'
  /** Owning project root — set for project skills, undefined for global. */
  projectPath?: string
  path: string
  /** Full raw file content (frontmatter + body) */
  content: string
  mtime: number
}

const SKILL_DIRS = ['.claude/skills', '.ourcode/skills', 'skills']

/** Renderer-side workspace root (the file tree's data attribute, falling back
 *  to the selected project — the tree only mounts in tree view). Note: callers
 *  working inside a session should prefer the session's own project path (the
 *  current project follows the active conversation, not the browsed folder). */
export function getWorkspaceRoot(): string {
  return document.getElementById('file-tree-root')?.getAttribute('data-root-path') || useUIStore.getState().rootPath || ''
}

function joinPath(dir: string, name: string): string {
  return dir.replace(/[\\/]$/, '') + '/' + name
}

/** Global skills/config root = <userData> (skills live in <userData>/skills,
 *  their skills.json config in <userData>/skills.json). '' when unavailable. */
export async function getGlobalRoot(): Promise<string> {
  try {
    return (await window.electronAPI?.getPath?.('userData')) || ''
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

// ───────────────────────── discovery ─────────────────────────

/** A directory to scan for skills, plus its source + enable/disable config root. */
interface SkillDir {
  dir: string
  source: 'global' | 'project'
  /** Root whose skills.json governs this skill's enabled flag (global → <userData>). */
  configRoot: string
  /** Owning project root (project skills only). */
  projectPath?: string
}

/** Workspace skill dirs under a project root (each maps to source 'project'). */
function projectSkillDirs(root: string): SkillDir[] {
  return SKILL_DIRS.map((d) => ({
    dir: joinPath(root, d),
    source: 'project' as const,
    configRoot: root,
    projectPath: root,
  }))
}

interface SkillCache {
  key: string
  mtime: number
  /** Fingerprint of the candidate file set — deleting a skill must invalidate
   *  the cache even when its (now-removed) mtime would lower `newest`. */
  fileKey: string
  skills: SkillInfo[]
}

let _cache: SkillCache | null = null

/**
 * Parse + enable-filter skills from the scanned dirs. `includeDisabled` skips
 * the skills.json enabled filter (registry/panel UI needs disabled skills
 * visible so toggles stay reachable).
 */
async function parseDirs(dirs: SkillDir[], includeDisabled: boolean): Promise<SkillInfo[]> {
  const candidates: Array<{ sd: SkillDir; dir: string; path: string }> = []
  for (const sd of dirs) {
    const entries = await listDirSafe(sd.dir)
    for (const e of entries) {
      if (!e.isDirectory) continue
      const sub = joinPath(sd.dir, e.name)
      candidates.push({ sd, dir: sub, path: joinPath(sub, 'SKILL.md') })
      candidates.push({ sd, dir: sub, path: joinPath(sub, 'skill.md') })
    }
  }

  // One non-empty content per skill directory (SKILL.md wins over skill.md)
  const byDir = new Map<string, { sd: SkillDir; content: string }>()
  for (const c of candidates) {
    if (byDir.has(c.dir)) continue
    const content = await readFileSafe(c.path)
    if (content) byDir.set(c.dir, { sd: c.sd, content })
  }

  const skills: SkillInfo[] = []
  for (const [dir, { sd, content }] of byDir) {
    const fallbackName = dir.split(/[/\\]/).pop() || 'skill'
    const parsed = parseSkillFrontmatter(content, fallbackName)
    // Respect skills.json enable/disable overrides (default: enabled) — global
    // skills consult <userData>/skills.json, project skills their project's.
    if (!includeDisabled && !(await isSkillEnabled(parsed.name, sd.configRoot))) continue
    skills.push({
      name: parsed.name,
      description: parsed.description,
      source: sd.source,
      projectPath: sd.projectPath,
      path: dir,
      content,
      mtime: 0, // caller fills from the newest candidate mtime
    })
  }
  return skills
}

/**
 * Deduplicate by name. Two sources may declare the same frontmatter name, which
 * would produce duplicate skill__<name> tool definitions (some providers
 * reject). `projectOverGlobal` drops a global skill shadowed by a project skill
 * of the same name (agent context — project wins); otherwise every
 * source+project combination is kept (management UI shows both, labeled).
 */
function dedupSkills(skills: SkillInfo[], projectOverGlobal: boolean): SkillInfo[] {
  skills.sort((a, b) => a.name.localeCompare(b.name))
  const seen = new Map<string, SkillInfo>()
  for (const s of skills) {
    const key = projectOverGlobal ? s.name : `${s.source}:${s.projectPath || ''}:${s.name}`
    const prev = seen.get(key)
    if (!prev) {
      seen.set(key, s)
      continue
    }
    if (projectOverGlobal && prev.source === 'global' && s.source === 'project') seen.set(key, s)
  }
  return [...seen.values()]
}

/**
 * Scan `dirs` honoring the module-level cache (keyed by cacheKey + newest file
 * mtime + candidate set + every config root's skills.json mtime, so toggles
 * invalidate too). Attaches the newest candidate mtime to each skill for the
 * knowledge cache.
 */
async function cachedDiscover(
  cacheKey: string,
  dirs: SkillDir[],
  includeDisabled: boolean,
  force: boolean,
  projectOverGlobal: boolean,
): Promise<SkillInfo[]> {
  const candidates: Array<{ sd: SkillDir; dir: string; path: string }> = []
  for (const sd of dirs) {
    const entries = await listDirSafe(sd.dir)
    for (const e of entries) {
      if (!e.isDirectory) continue
      const sub = joinPath(sd.dir, e.name)
      candidates.push({ sd, dir: sub, path: joinPath(sub, 'SKILL.md') })
      candidates.push({ sd, dir: sub, path: joinPath(sub, 'skill.md') })
    }
  }

  let newest = 0
  for (const c of candidates) {
    const s = await statSafe(c.path)
    if (s && s.modifiedAt > newest) newest = s.modifiedAt
  }
  // skills.json enable/disable toggles must invalidate the cache too — stat
  // every config root involved (global + each project), deduplicated.
  let configMtime = 0
  for (const root of new Set(dirs.map((d) => d.configRoot))) {
    const s = await statSafe(joinPath(root, 'skills.json'))
    if (s && s.modifiedAt > configMtime) configMtime = s.modifiedAt
  }
  const cacheMtime = Math.max(newest, configMtime)
  // Order matters for the fingerprint — sort so an identical set always hashes
  // the same regardless of directory enumeration order.
  const fileKey = candidates.map((c) => c.path).sort().join('\n')
  if (!force && _cache && _cache.key === cacheKey && _cache.mtime >= cacheMtime && _cache.fileKey === fileKey) {
    return _cache.skills
  }

  const skills = await parseDirs(dirs, includeDisabled)
  for (const s of skills) s.mtime = newest
  const result = dedupSkills(skills, projectOverGlobal)
  _cache = { key: cacheKey, mtime: cacheMtime, fileKey, skills: result }
  return result
}

/**
 * Discover + parse skills (cached by newest mtime + candidate set) for a single
 * workspace: global skills (follow the IDE) + that project's own skills. This
 * is the agent-facing view — project skills shadow same-named global skills so
 * the tool list / skill index never carries duplicate names.
 */
export async function listSkills(force = false, rootOverride?: string, includeDisabled = false): Promise<SkillInfo[]> {
  const root = rootOverride ?? getWorkspaceRoot()
  // A session's projectPath can point at a folder that isn't the currently
  // opened project (background/restored sessions) — its skill dirs would then
  // be rejected by the main-process allowlist on every fs:listDir/fs:stat and
  // log errors. Authorize it up front like listAllSkills does (a no-op when
  // already registered).
  if (root) {
    try { await window.electronAPI?.authorize?.(root) } catch { /* keep scanning global only */ }
  }
  const globalRoot = await getGlobalRoot()
  const global = globalRoot ? joinPath(globalRoot, 'skills') : ''
  const dirs: SkillDir[] = []
  if (global) dirs.push({ dir: global, source: 'global', configRoot: globalRoot })
  // Before a workspace is opened (root ''), scanning the fake `/.claude/skills`
  // style paths would hit the main-process path allowlist and log errors.
  if (root) dirs.push(...projectSkillDirs(root))
  return cachedDiscover(`root:${root}:${includeDisabled}`, dirs, includeDisabled, force, true)
}

/**
 * All skills for the management UI: global skills + project skills of every
 * recent project (authorized for the fs bridge). Unlike listSkills, a global
 * and a project skill with the same name both show — each labeled by source.
 */
export async function listAllSkills(force = false, includeDisabled = true): Promise<SkillInfo[]> {
  const roots = [...new Set((useUIStore.getState().recentProjects || []).filter(Boolean))]
  // The allowlist is empty at startup — authorize each project so fs:listDir
  // on its skill dirs isn't rejected (authorize is a no-op when already known).
  for (const r of roots) {
    try { await window.electronAPI?.authorize?.(r) } catch { /* keep scanning the rest */ }
  }
  const globalRoot = await getGlobalRoot()
  const global = globalRoot ? joinPath(globalRoot, 'skills') : ''
  const dirs: SkillDir[] = []
  if (global) dirs.push({ dir: global, source: 'global', configRoot: globalRoot })
  for (const r of roots) dirs.push(...projectSkillDirs(r))
  const rootsKey = roots.sort().join('|')
  return cachedDiscover(`all:${rootsKey}:${includeDisabled}`, dirs, includeDisabled, force, false)
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
