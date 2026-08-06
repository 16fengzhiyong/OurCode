/**
 * Skill registry — remote skill discovery + `skills.json` configuration.
 *
 * `skills.json` (workspace root) is the standardized registry config:
 *
 * ```json
 * {
 *   "registry": { "url": "https://example.com/registry/index.json" },
 *   "skills": { "deploy": { "enabled": false, "version": "1.2.0" } }
 * }
 * ```
 *
 * - `registry.url`  — remote index endpoint (fetched via the webFetch IPC).
 * - `skills.<name>` — per-skill overrides: `enabled` toggles a skill in/out of
 *   the agent's index + tool list; `version` records the installed version.
 *
 * Registry index format (accepted as a bare array or `{ skills: [...] }`):
 *
 * ```json
 * [{ "name": "code-review", "description": "...", "version": "1.0.0",
 *    "contentUrl": "https://…/code-review/SKILL.md" }]
 * ```
 *
 * Install = fetch SKILL.md → write to `<root>/skills/<name>/SKILL.md` — from
 * there the existing SkillManager discovery picks it up (cache refresh is the
 * caller's job, to avoid a circular import).
 */

export interface SkillConfigEntry {
  enabled?: boolean
  version?: string
}

export interface SkillConfig {
  registryUrl?: string
  skills: Record<string, SkillConfigEntry>
}

export interface RegistrySkillInfo {
  name: string
  description?: string
  version?: string
  author?: string
  contentUrl?: string
}

/** Write-tools used by install/uninstall */
async function writeFileSafe(path: string, content: string): Promise<boolean> {
  try {
    await window.electronAPI.writeFile(path, content, 'utf-8')
    return true
  } catch {
    return false
  }
}

async function createDirSafe(path: string): Promise<void> {
  try { await window.electronAPI.createDir(path) } catch { /* already exists */ }
}

async function deleteSafe(path: string): Promise<boolean> {
  try {
    await window.electronAPI.delete(path)
    return true
  } catch {
    return false
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

async function statSafe(path: string): Promise<{ modifiedAt: number } | null> {
  try {
    return await window.electronAPI.stat(path)
  } catch {
    return null
  }
}

// ───────────────────────── skills.json config ─────────────────────────

interface ConfigCache {
  root: string
  mtime: number
  config: SkillConfig
}

let _configCache: ConfigCache | null = null

/** Load + cache <root>/skills.json (mtime-invalidated). Missing → defaults. */
export async function readSkillConfig(root: string): Promise<SkillConfig> {
  const path = `${root.replace(/[\\/]$/, '')}/skills.json`
  const stat = await statSafe(path)
  const mtime = stat?.modifiedAt || 0
  if (_configCache && _configCache.root === root && _configCache.mtime >= mtime) {
    return _configCache.config
  }

  const content = await readFileSafe(path)
  let config: SkillConfig = { skills: {} }
  if (content) {
    try {
      const parsed = JSON.parse(content)
      config = {
        registryUrl: typeof parsed?.registry?.url === 'string' ? parsed.registry.url : undefined,
        skills: (parsed?.skills && typeof parsed.skills === 'object') ? parsed.skills : {},
      }
    } catch { /* malformed skills.json → defaults */ }
  }
  _configCache = { root, mtime, config }
  return config
}

/** Whether a skill is enabled (defaults to true when not configured). */
export async function isSkillEnabled(name: string, root: string): Promise<boolean> {
  const config = await readSkillConfig(root)
  return config.skills[name]?.enabled !== false
}

/** Persist the enabled flag (creating skills.json when absent). */
export async function setSkillEnabled(name: string, enabled: boolean, root: string): Promise<boolean> {
  const config = await readSkillConfig(root)
  const entry = config.skills[name] || {}
  config.skills[name] = { ...entry, enabled }
  _configCache = null // force re-read on next call
  return writeFileSafe(`${root.replace(/[\\/]$/, '')}/skills.json`, JSON.stringify(config, null, 2) + '\n')
}

// ───────────────────────── registry operations ─────────────────────────

function parseIndex(text: string): RegistrySkillInfo[] {
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    return []
  }
  const list = Array.isArray(json) ? json : json?.skills
  if (!Array.isArray(list)) return []
  return list
    .filter((s: any) => s && typeof s.name === 'string' && s.name)
    .map((s: any) => ({
      name: s.name,
      description: typeof s.description === 'string' ? s.description : '',
      version: typeof s.version === 'string' ? s.version : undefined,
      author: typeof s.author === 'string' ? s.author : undefined,
      contentUrl: typeof s.contentUrl === 'string' ? s.contentUrl : undefined,
    }))
}

/** Fetch the registry index (explicit URL wins over skills.json config). */
export async function fetchRegistryIndex(url?: string, root?: string): Promise<RegistrySkillInfo[]> {
  let target = url
  if (!target && root) {
    const config = await readSkillConfig(root)
    target = config.registryUrl
  }
  if (!target) return []
  try {
    const res = await window.electronAPI.webFetch(target, { timeoutMs: 15000, maxBytes: 2 * 1024 * 1024 })
    if (!res.ok) return []
    return parseIndex(res.text || '')
  } catch {
    return []
  }
}

/** Resolve the SKILL.md content for a registry entry. */
async function fetchSkillContent(entry: RegistrySkillInfo, registryUrl?: string): Promise<string | null> {
  const url = entry.contentUrl || (registryUrl ? new URL(`${entry.name}/SKILL.md`, registryUrl).href : '')
  if (!url) return null
  try {
    const res = await window.electronAPI.webFetch(url, { timeoutMs: 15000, maxBytes: 2 * 1024 * 1024 })
    if (!res.ok) return null
    return res.text || null
  } catch {
    return null
  }
}

/**
 * Install (or update) a skill into `<root>/skills/<name>/SKILL.md`.
 * Returns the installed version on success, null on failure.
 */
export async function installSkill(name: string, root: string, entry?: RegistrySkillInfo): Promise<string | null> {
  let target = entry
  if (!target) {
    const found = await fetchRegistryIndex(undefined, root)
    target = found.find((s) => s.name === name)
  }
  if (!target) return null

  const config = await readSkillConfig(root)
  const content = await fetchSkillContent(target, config.registryUrl)
  if (!content) return null

  const dir = `${root.replace(/[\\/]$/, '')}/skills/${name}`
  await createDirSafe(dir)
  const ok = await writeFileSafe(`${dir}/SKILL.md`, content)
  if (!ok) return null

  // Record the installed version in skills.json
  const entryCfg = config.skills[name] || {}
  config.skills[name] = { ...entryCfg, enabled: entryCfg.enabled !== false, version: target.version }
  _configCache = null
  await writeFileSafe(`${root.replace(/[\\/]$/, '')}/skills.json`, JSON.stringify(config, null, 2) + '\n')
  return target.version || '0.0.0'
}

/** Remove a skill directory from the workspace. */
export async function uninstallSkill(name: string, root: string): Promise<boolean> {
  const config = await readSkillConfig(root)
  delete config.skills[name]
  _configCache = null
  await writeFileSafe(`${root.replace(/[\\/]$/, '')}/skills.json`, JSON.stringify(config, null, 2) + '\n')
  return deleteSafe(`${root.replace(/[\\/]$/, '')}/skills/${name}`)
}

/** Compare local installed versions against a registry index. */
export function compareRegistryEntry(
  local: { name: string; version?: string } | undefined,
  remote: RegistrySkillInfo,
): 'install' | 'update' | 'installed' {
  if (!local) return 'install'
  if (!local.version || !remote.version) return 'installed'
  return local.version === remote.version ? 'installed' : 'update'
}
