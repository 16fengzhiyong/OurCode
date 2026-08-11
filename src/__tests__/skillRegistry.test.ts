import { describe, it, expect, vi } from 'vitest'
import {
  readSkillConfig,
  isSkillEnabled,
  setSkillEnabled,
  setRegistryUrl,
  fetchRegistryIndex,
  installSkill,
  importSkill,
  uninstallSkill,
  compareRegistryEntry,
  type RegistrySkillInfo,
} from '@/services/skills/skillRegistry'
import { listSkills } from '@/services/skills/skillManager'

// Each test uses its own workspace root — the modules keep a per-root cache
// keyed by file mtime, and the mock stat() returns a constant mtime, so
// distinct roots prevent cache poisoning across tests.
const ROOTS = ['C:/ws-a', 'C:/ws-b', 'C:/ws-c', 'C:/ws-d', 'C:/ws-e', 'C:/ws-f', 'C:/ws-g', 'C:/ws-h']
let rootIdx = 0
function nextRoot(): string {
  return ROOTS[rootIdx++ % ROOTS.length]
}

function makeMockApi(root: string, overrides: Record<string, string> = {}) {
  const files: Record<string, string> = { ...overrides }
  const writes: Array<{ path: string; content: string }> = []
  const deletions: string[] = []
  const mockApi = {
    listDir: vi.fn(async (dir: string) => {
      if (dir === `${root}/skills`) {
        return [
          { name: 'code-review', isDirectory: true, isHidden: false },
          { name: 'deploy', isDirectory: true, isHidden: false },
        ]
      }
      return []
    }),
    readFile: vi.fn(async (path: string) => ({ content: files[path] || '', encoding: 'utf-8' })),
    writeFile: vi.fn(async (path: string, content: string) => {
      files[path] = content
      writes.push({ path, content })
      return { ok: true }
    }),
    createDir: vi.fn(async () => ({ ok: true })),
    delete: vi.fn(async (path: string) => {
      deletions.push(path)
      return { ok: true }
    }),
    stat: vi.fn(async () => ({ size: 1, isFile: true, isDirectory: false, createdAt: 1, modifiedAt: 1000 })),
    getPath: vi.fn(async () => 'C:/userData'),
    webFetch: vi.fn(async () => ({ ok: false, status: 404, text: '' })),
  }
  return { mockApi, files, writes, deletions }
}

function stub(mockApi: Record<string, any>) {
  vi.stubGlobal('window', { electronAPI: mockApi })
  vi.resetModules()
}

describe('skillRegistry — skills.json config', () => {
  it('defaults to all-enabled and no registry when skills.json is missing', async () => {
    const root = nextRoot()
    const { mockApi } = makeMockApi(root)
    stub(mockApi)
    const config = await readSkillConfig(root)
    expect(config.registryUrl).toBeUndefined()
    expect(config.skills).toEqual({})
    expect(await isSkillEnabled('code-review', root)).toBe(true)
  })

  it('parses registry url and per-skill overrides', async () => {
    const root = nextRoot()
    const { mockApi } = makeMockApi(root, {
      [`${root}/skills.json`]: JSON.stringify({
        registry: { url: 'https://registry.example/index.json' },
        skills: { deploy: { enabled: false }, 'code-review': { version: '1.2.0' } },
      }),
    })
    stub(mockApi)
    const config = await readSkillConfig(root)
    expect(config.registryUrl).toBe('https://registry.example/index.json')
    expect(await isSkillEnabled('deploy', root)).toBe(false)
    expect(await isSkillEnabled('code-review', root)).toBe(true)
  })

  it('setSkillEnabled persists and invalidates the config cache', async () => {
    const root = nextRoot()
    const { mockApi, writes } = makeMockApi(root)
    stub(mockApi)
    expect(await setSkillEnabled('deploy', false, root)).toBe(true)
    expect(writes.some((w) => w.path === `${root}/skills.json`)).toBe(true)
    expect(await isSkillEnabled('deploy', root)).toBe(false)
  })

  it('setRegistryUrl persists the URL and keeps existing skill config', async () => {
    const root = nextRoot()
    const { mockApi, files } = makeMockApi(root, {
      [`${root}/skills.json`]: JSON.stringify({ skills: { deploy: { enabled: false } } }),
    })
    stub(mockApi)
    expect(await setRegistryUrl(root, 'https://registry.example/index.json')).toBe(true)
    const cfg = JSON.parse(files[`${root}/skills.json`] || '{}')
    expect(cfg.registry.url).toBe('https://registry.example/index.json')
    expect(cfg.skills.deploy.enabled).toBe(false) // untouched
    expect((await readSkillConfig(root)).registryUrl).toBe('https://registry.example/index.json')
  })

  it('setRegistryUrl with an empty string clears the URL', async () => {
    const root = nextRoot()
    const { mockApi, files } = makeMockApi(root, {
      [`${root}/skills.json`]: JSON.stringify({ registry: { url: 'https://registry.example/index.json' } }),
    })
    stub(mockApi)
    expect(await setRegistryUrl(root, '')).toBe(true)
    expect(JSON.parse(files[`${root}/skills.json`] || '{}').registry).toBeUndefined()
    expect((await readSkillConfig(root)).registryUrl).toBeUndefined()
  })
})

describe('skillRegistry — remote registry', () => {
  const index: RegistrySkillInfo[] = [
    { name: 'code-review', description: '审查', version: '1.0.0', contentUrl: 'https://registry.example/code-review/SKILL.md' },
    { name: 'deploy', description: '部署', version: '2.0.0', contentUrl: 'https://registry.example/deploy/SKILL.md' },
  ]

  it('fetches and parses the registry index (object form)', async () => {
    const root = nextRoot()
    const { mockApi } = makeMockApi(root)
    mockApi.webFetch = vi.fn(async () => ({ ok: true, status: 200, text: JSON.stringify({ skills: index }) }))
    stub(mockApi)
    const list = await fetchRegistryIndex('https://registry.example/index.json')
    expect(list).toHaveLength(2)
    expect(list[0].name).toBe('code-review')
  })

  it('returns an empty list on network failure', async () => {
    const root = nextRoot()
    const { mockApi } = makeMockApi(root)
    mockApi.webFetch = vi.fn(async () => ({ ok: false, status: 500, text: '' }))
    stub(mockApi)
    expect(await fetchRegistryIndex('https://registry.example/index.json')).toEqual([])
  })

  it('uses skills.json registry url when no explicit url is given', async () => {
    const root = nextRoot()
    const { mockApi } = makeMockApi(root, {
      [`${root}/skills.json`]: JSON.stringify({ registry: { url: 'https://registry.example/index.json' } }),
    })
    mockApi.webFetch = vi.fn(async () => ({ ok: true, status: 200, text: JSON.stringify(index) }))
    stub(mockApi)
    const list = await fetchRegistryIndex(undefined, root)
    expect(list).toHaveLength(2)
  })

  it('installs a skill by writing SKILL.md and recording the version', async () => {
    const root = nextRoot()
    const { mockApi, files, writes } = makeMockApi(root, {
      [`${root}/skills.json`]: JSON.stringify({ registry: { url: 'https://registry.example/index.json' } }),
    })
    mockApi.webFetch = vi.fn(async (url: string) => {
      if (url.includes('index.json')) return { ok: true, status: 200, text: JSON.stringify(index) }
      return { ok: true, status: 200, text: '# code-review skill\n步骤\n' }
    })
    stub(mockApi)

    const version = await installSkill('code-review', root)
    expect(version).toBe('1.0.0')
    expect(files[`${root}/skills/code-review/SKILL.md`]).toContain('步骤')
    const cfg = JSON.parse(files[`${root}/skills.json`] || '{}')
    expect(cfg.skills['code-review'].version).toBe('1.0.0')
    expect(writes.some((w) => w.path === `${root}/skills/code-review/SKILL.md`)).toBe(true)
  })

  it('installSkill returns null when the registry has no such skill', async () => {
    const root = nextRoot()
    const { mockApi } = makeMockApi(root)
    mockApi.webFetch = vi.fn(async () => ({ ok: true, status: 200, text: JSON.stringify(index) }))
    stub(mockApi)
    expect(await installSkill('ghost', root)).toBeNull()
  })

  it('uninstalls a skill and cleans its config entry', async () => {
    const root = nextRoot()
    const { mockApi, deletions, files } = makeMockApi(root, {
      [`${root}/skills.json`]: JSON.stringify({ skills: { deploy: { enabled: false } } }),
    })
    stub(mockApi)
    expect(await uninstallSkill('deploy', root)).toBe(true)
    expect(deletions).toContain(`${root}/skills/deploy`)
    expect(JSON.parse(files[`${root}/skills.json`] || '{}').skills.deploy).toBeUndefined()
  })

  it('compares local vs registry versions', () => {
    const local = { name: 'x', version: '1.0.0' }
    expect(compareRegistryEntry(undefined, { name: 'x' })).toBe('install')
    expect(compareRegistryEntry(local, { name: 'x', version: '1.0.0' })).toBe('installed')
    expect(compareRegistryEntry(local, { name: 'x', version: '1.1.0' })).toBe('update')
  })
})

describe('skillManager × skillRegistry integration', () => {
  it('listSkills excludes skills disabled via skills.json', async () => {
    const root = nextRoot()
    const { mockApi, files } = makeMockApi(root)
    files[`${root}/skills/code-review/SKILL.md`] = '---\nname: code-review\ndescription: 审查\n---\n正文\n'
    files[`${root}/skills/deploy/SKILL.md`] = '---\nname: deploy\ndescription: 部署\n---\n正文\n'
    files[`${root}/skills.json`] = JSON.stringify({ skills: { deploy: { enabled: false } } })
    stub(mockApi)

    const skills = await listSkills(true, root)
    const names = skills.map((s) => s.name)
    expect(names).toContain('code-review')
    expect(names).not.toContain('deploy')
  })

  it('re-enabling a skill brings it back after a force refresh', async () => {
    const root = nextRoot()
    const { mockApi, files } = makeMockApi(root)
    files[`${root}/skills/deploy/SKILL.md`] = '---\nname: deploy\ndescription: 部署\n---\n正文\n'
    files[`${root}/skills.json`] = JSON.stringify({ skills: { deploy: { enabled: false } } })
    stub(mockApi)

    expect((await listSkills(true, root)).map((s) => s.name)).not.toContain('deploy')
    await setSkillEnabled('deploy', true, root)
    expect((await listSkills(true, root)).map((s) => s.name)).toContain('deploy')
  })
})

describe('skillRegistry — import from other platforms', () => {
  it('copies a skill into <root>/skills/<name>/ and records provenance', async () => {
    const root = nextRoot()
    const { mockApi, files } = makeMockApi(root)
    files['C:/ws-x/.claude/skills/review/SKILL.md'] = '---\nname: review\ndescription: 审查\n---\n正文\n'
    stub(mockApi)

    expect(await importSkill('review', root, 'C:/ws-x/.claude/skills/review', 'claude')).toBe(true)
    expect(files[`${root}/skills/review/SKILL.md`]).toContain('正文')
    const cfg = JSON.parse(files[`${root}/skills.json`] || '{}')
    expect(cfg.skills.review.importedFrom).toBe('claude')
    expect(cfg.skills.review.enabled).toBe(true)
  })

  it('keeps existing enabled/version state when overwriting an installed skill', async () => {
    const root = nextRoot()
    const { mockApi, files } = makeMockApi(root, {
      [`${root}/skills.json`]: JSON.stringify({ skills: { review: { enabled: false, version: '1.0.0' } } }),
    })
    files['C:/ws-x/.claude/skills/review/SKILL.md'] = '# Review\n正文\n'
    stub(mockApi)

    expect(await importSkill('review', root, 'C:/ws-x/.claude/skills/review', 'claude')).toBe(true)
    const cfg = JSON.parse(files[`${root}/skills.json`] || '{}')
    expect(cfg.skills.review.enabled).toBe(false)
    expect(cfg.skills.review.version).toBe('1.0.0')
    expect(cfg.skills.review.importedFrom).toBe('claude')
  })

  it('falls back to skill.md and rejects unsafe names', async () => {
    const root = nextRoot()
    const { mockApi, files } = makeMockApi(root)
    files['C:/ws-x/.agents/skills/lint/skill.md'] = '# Lint\n正文\n'
    stub(mockApi)

    expect(await importSkill('lint', root, 'C:/ws-x/.agents/skills/lint', 'agents')).toBe(true)
    expect(files[`${root}/skills/lint/SKILL.md`]).toContain('正文')
    expect(await importSkill('../evil', root, 'C:/ws-x/.agents/skills/evil', 'agents')).toBe(false)
  })

  it('returns false when the source dir has no SKILL.md/skill.md', async () => {
    const root = nextRoot()
    const { mockApi } = makeMockApi(root)
    stub(mockApi)
    expect(await importSkill('ghost', root, 'C:/ws-x/.claude/skills/ghost', 'claude')).toBe(false)
  })
})

describe('skillRegistry — global skills (root = <userData>)', () => {
  // Global skills reuse the SAME API with the userData path as root: config
  // lands in <userData>/skills.json and installs in <userData>/skills/<name>/.
  // Each test uses a distinct userData path — the per-root config cache is
  // keyed by mtime, and the mock stat() returns a constant mtime.

  it('setSkillEnabled persists to <userData>/skills.json and isSkillEnabled reads it', async () => {
    const root = nextRoot()
    const globalRoot = 'C:/userData'
    const { mockApi, writes } = makeMockApi(root)
    stub(mockApi)
    expect(await setSkillEnabled('deploy', false, globalRoot)).toBe(true)
    expect(writes.some((w) => w.path === `${globalRoot}/skills.json`)).toBe(true)
    expect(await isSkillEnabled('deploy', globalRoot)).toBe(false)
  })

  it('installSkill writes a global skill into <userData>/skills/<name>/SKILL.md', async () => {
    const root = nextRoot()
    const globalRoot = 'C:/userData-b'
    const index: RegistrySkillInfo[] = [
      { name: 'code-review', description: '审查', version: '1.0.0', contentUrl: 'https://registry.example/code-review/SKILL.md' },
    ]
    const { mockApi, files } = makeMockApi(root, {
      [`${globalRoot}/skills.json`]: JSON.stringify({ registry: { url: 'https://registry.example/index.json' } }),
    })
    mockApi.webFetch = vi.fn(async (url: string) => {
      if (url.includes('index.json')) return { ok: true, status: 200, text: JSON.stringify(index) }
      return { ok: true, status: 200, text: '# global skill\n全局步骤\n' }
    })
    stub(mockApi)

    const version = await installSkill('code-review', globalRoot)
    expect(version).toBe('1.0.0')
    expect(files[`${globalRoot}/skills/code-review/SKILL.md`]).toContain('全局步骤')
    const cfg = JSON.parse(files[`${globalRoot}/skills.json`] || '{}')
    expect(cfg.skills['code-review'].version).toBe('1.0.0')
  })

  it('uninstallSkill removes a global skill and its config entry', async () => {
    const root = nextRoot()
    const globalRoot = 'C:/userData-c'
    const { mockApi, deletions, files } = makeMockApi(root, {
      [`${globalRoot}/skills.json`]: JSON.stringify({ skills: { deploy: { enabled: false } } }),
    })
    stub(mockApi)
    expect(await uninstallSkill('deploy', globalRoot)).toBe(true)
    expect(deletions).toContain(`${globalRoot}/skills/deploy`)
    expect(JSON.parse(files[`${globalRoot}/skills.json`] || '{}').skills.deploy).toBeUndefined()
  })
})
