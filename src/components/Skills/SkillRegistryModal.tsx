import { useState, useEffect, useCallback, useRef } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { useI18n } from '@/i18n/useI18n'
import { listAllSkills, getGlobalRoot, getWorkspaceRoot, type SkillInfo } from '@/services/skills/skillManager'
import {
  isSkillEnabled,
  setSkillEnabled,
  readSkillConfig,
  fetchRegistryIndex,
  installSkill,
  uninstallSkill,
  compareRegistryEntry,
  type RegistrySkillInfo,
} from '@/services/skills/skillRegistry'

interface LocalSkillRow extends SkillInfo {
  enabled: boolean
  version?: string
}

/** Config root whose skills.json governs a skill's enabled flag. */
async function configRootFor(s: SkillInfo): Promise<string> {
  return s.source === 'global' ? await getGlobalRoot() : s.projectPath || ''
}

/**
 * Skill management dialog: local skills (enable/disable/uninstall) + remote
 * registry browser (install/update). Mirrors the PluginMarketplace layout,
 * restyled after the "插件市场与技能管理设计稿" — pill tabs, round search,
 * status dot + mono "/name" rows with iOS-style toggles, footer hint bar.
 * Installed/enabled skills surface automatically in the agent's skill index,
 * tool list and "/" slash menu.
 */
export default function SkillRegistryModal() {
  const { isSkillRegistryOpen, closeSkillRegistry } = useUIStore()
  const t = useI18n()

  // The local tab lists ALL skills (global + every recent project's). The
  // registry tab installs into a chosen target: 全局 (follows the IDE) or the
  // current project (active session's bound project, browsed folder fallback).
  const [installTarget, setInstallTarget] = useState<'global' | 'project'>('global')
  const [projectRoot, setProjectRoot] = useState('')
  const [tab, setTab] = useState<'local' | 'registry'>('local')
  const [search, setSearch] = useState('')
  const [localSkills, setLocalSkills] = useState<LocalSkillRow[]>([])
  const [registrySkills, setRegistrySkills] = useState<RegistrySkillInfo[]>([])
  const [registryUrl, setRegistryUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmUninstall, setConfirmUninstall] = useState<LocalSkillRow | null>(null)
  // Synchronous in-flight guard: `busy` state updates are async, so rapid
  // double-clicks on the same toggle/button would run the action twice before
  // the state lands (toggle flips twice = no-op). A ref keeps the check
  // race-free (see run).
  const busyRef = useRef<string | null>(null)

  const reloadLocal = useCallback(async () => {
    const all = await listAllSkills(true)
    const rows: LocalSkillRow[] = []
    for (const s of all) {
      const configRoot = await configRootFor(s)
      const config = await readSkillConfig(configRoot)
      rows.push({
        ...s,
        enabled: await isSkillEnabled(s.name, configRoot),
        version: config.skills[s.name]?.version,
      })
    }
    setLocalSkills(rows)
  }, [])

  const reloadRegistry = useCallback(async (root: string) => {
    if (!root) {
      setRegistrySkills([])
      setRegistryUrl('')
      return
    }
    const list = await fetchRegistryIndex(undefined, root)
    const config = await readSkillConfig(root)
    setRegistrySkills(list)
    setRegistryUrl(config.registryUrl || '')
  }, [])

  useEffect(() => {
    if (!isSkillRegistryOpen) return
    // The current project = the active session's bound project (browsed folder
    // as fallback) — the "install to project" target.
    const workspace = useChatStore.getState().getActiveSession()?.projectPath || getWorkspaceRoot() || ''
    setProjectRoot(workspace)
    // Skills follow the IDE by default — install target starts at 全局; the
    // user can switch to 当前项目 in the registry tab.
    setInstallTarget('global')
    reloadLocal()
    void getGlobalRoot().then((globalRoot) => reloadRegistry(globalRoot))
  }, [isSkillRegistryOpen, reloadLocal, reloadRegistry])

  if (!isSkillRegistryOpen) return null

  /** Root the registry installs into for the current target. */
  const targetRoot = async (): Promise<string> =>
    installTarget === 'global' ? await getGlobalRoot() : projectRoot

  const switchTarget = async (target: 'global' | 'project') => {
    setInstallTarget(target)
    await reloadRegistry(target === 'global' ? await getGlobalRoot() : projectRoot)
  }

  const run = async (name: string, fn: () => Promise<unknown>) => {
    if (busyRef.current) return
    busyRef.current = name
    setBusy(name)
    setError(null)
    try {
      await fn()
    } catch (e: any) {
      setError(t('skillRegistry.error', { error: e.message || String(e) }))
    } finally {
      busyRef.current = null
      setBusy(null)
      reloadLocal()
      reloadRegistry(await targetRoot())
    }
  }

  const localByName = new Map(localSkills.map((s) => [s.name, s]))

  const filteredLocal = localSkills.filter((s) => {
    if (!search) return true
    const q = search.toLowerCase()
    return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
  })

  const filteredRegistry = registrySkills.filter((s) => {
    if (!search) return true
    const q = search.toLowerCase()
    return s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q)
  })

  const statusOf = (remote: RegistrySkillInfo) =>
    compareRegistryEntry(localByName.get(remote.name), remote)

  return (
    <div role="dialog" aria-modal="true" aria-label={t('skillRegistry.dialog')} className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={closeSkillRegistry}>
      <div
        className="glass-modal rounded-2xl w-[760px] max-h-[80vh] flex flex-col overflow-hidden" style={{ boxShadow: 'var(--shadow-xl)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-nova-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#10b981] to-[#059669] flex items-center justify-center">
              <svg viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor" className="text-white" xmlns="http://www.w3.org/2000/svg">
                <path d="M823.296 64.96l135.744 135.744-769.28 769.28-135.808-135.68L823.296 64.96z m0 108.544L162.432 834.24l27.2 27.136L850.432 200.704l-27.2-27.2zM803.2 512a15.68 15.68 0 0 1 15.232 14.336 146.88 146.88 0 0 0 127.68 133.12 15.68 15.68 0 0 1-0.64 31.232 146.752 146.752 0 0 0-133.12 127.744 15.68 15.68 0 0 1-31.104-0.64 146.816 146.816 0 0 0-127.488-133.184 15.68 15.68 0 0 1 0.64-31.232 146.752 146.752 0 0 0 132.992-127.744 15.68 15.68 0 0 1 12.032-13.248l3.84-0.384z m-576-448a15.68 15.68 0 0 1 15.232 14.336 146.88 146.88 0 0 0 127.68 133.12 15.68 15.68 0 0 1-0.64 31.232 146.752 146.752 0 0 0-133.12 127.744 15.68 15.68 0 0 1-31.104-0.64 146.816 146.816 0 0 0-127.488-133.184 15.68 15.68 0 0 1 0.64-31.232 146.752 146.752 0 0 0 132.992-127.744 15.68 15.68 0 0 1 12.032-13.248L227.328 64z m282.624 0a10.24 10.24 0 0 1 10.496 8.832c3.328 23.36 22.4 41.216 45.952 42.944a10.24 10.24 0 0 1 0.64 20.48 50.112 50.112 0 0 0-42.944 45.888 10.24 10.24 0 0 1-20.48 0.64 50.112 50.112 0 0 0-45.888-42.944 10.24 10.24 0 0 1-0.64-20.416 50.112 50.112 0 0 0 42.944-45.952 10.24 10.24 0 0 1 6.912-8.96L509.888 64z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-nova-text-primary">{t('skillRegistry.title')}</h2>
              <p className="text-xs text-nova-text-muted">{t('skillRegistry.subtitle')}</p>
            </div>
          </div>
          <button
            onClick={closeSkillRegistry}
            className="p-2 text-nova-text-muted hover:text-white hover:bg-nova-hover rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeWidth={2} d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>

        {/* Toolbar: pill tabs + search (设计稿: rounded-full pills & glass input) */}
        <div className="px-6 pt-3 pb-4 flex flex-col gap-3 border-b border-nova-border">
          <div className="flex gap-2">
            <button
              className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all ${
                tab === 'local'
                  ? 'text-[var(--accent)] bg-white border border-[var(--accent)]/20 shadow-sm'
                  : 'text-nova-text-muted hover:bg-nova-hover'
              }`}
              onClick={() => setTab('local')}
            >
              {t('skillRegistry.localTab', { count: localSkills.length })}
            </button>
            <button
              className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all ${
                tab === 'registry'
                  ? 'text-[var(--accent)] bg-white border border-[var(--accent)]/20 shadow-sm'
                  : 'text-nova-text-muted hover:bg-nova-hover'
              }`}
              onClick={() => setTab('registry')}
            >
              {t('skillRegistry.registryTab')}
            </button>
          </div>
          <div className="relative w-full">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nova-text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder={t('skillRegistry.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-nova-bg border border-nova-border rounded-full text-sm text-nova-text-primary placeholder-nova-text-muted focus:outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_1.5px_rgba(0,88,188,0.3)] transition-all"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">{error}</div>
          )}

          {tab === 'local' ? (
            filteredLocal.length === 0 ? (
              <div className="text-center py-16 text-nova-text-muted text-sm">
                {search ? t('skillRegistry.noMatch') : t('skillRegistry.noLocalSkills')}
              </div>
            ) : (
              <div className="space-y-1">
                {filteredLocal.map((s) => (
                  <div
                    key={`${s.source}:${s.projectPath || 'global'}:${s.name}`}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-white/50 dark:hover:bg-white/5 transition-colors group"
                  >
                    {/* Status dot */}
                    <span className={`w-2 h-2 rounded-full shrink-0 ${s.enabled ? 'bg-[#22c55e]' : 'bg-slate-400'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span
                          className="font-mono text-[13px] font-bold truncate"
                          style={{ color: s.enabled ? 'var(--accent)' : 'var(--text-secondary)' }}
                        >
                          /{s.name}
                        </span>
                        {s.version && <span className="font-mono text-[11px] text-nova-text-muted shrink-0">v{s.version}</span>}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium shrink-0 ${
                          s.enabled
                            ? 'bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]/30'
                            : 'bg-gray-500/15 text-gray-400 border-gray-500/30'
                        }`}>
                          {s.enabled ? t('skillRegistry.installed') : t('plugin.statusDisabled')}
                        </span>
                        <span
                          className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-nova-hover text-nova-text-muted"
                          title={s.source === 'global' ? undefined : s.projectPath}
                        >
                          {s.source === 'global' ? t('skillRegistry.globalTag') : s.projectPath?.split(/[/\\]/).pop() || t('skillRegistry.projectTag')}
                        </span>
                      </div>
                      <p className="text-xs text-nova-text-muted mt-0.5 truncate">
                        {s.description || s.path}
                      </p>
                    </div>
                    {/* Toggle switch (设计稿) */}
                    <button
                      onClick={() => run(s.name, async () => {
                        const configRoot = await configRootFor(s)
                        if (!configRoot) throw new Error('无法确定该技能的配置位置')
                        await setSkillEnabled(s.name, !s.enabled, configRoot)
                      })}
                      disabled={busy === s.name}
                      aria-label={`${s.enabled ? t('skillRegistry.disable') : t('skillRegistry.enable')} ${s.name}`}
                      className={`relative shrink-0 w-10 h-6 rounded-full transition-colors disabled:opacity-40 ${
                        s.enabled ? 'bg-[#22c55e]' : 'bg-slate-300 dark:bg-slate-600'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                          s.enabled ? 'left-[18px]' : 'left-0.5'
                        }`}
                      />
                    </button>
                    {/* Uninstall (icon button, appears on hover to keep the row compact) */}
                    <button
                      onClick={() => setConfirmUninstall(s)}
                      disabled={busy === s.name}
                      title={t('skillRegistry.uninstall')}
                      className="shrink-0 p-1.5 text-nova-text-muted opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all disabled:opacity-0"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div>
              {/* Install target: 全局 (follows the IDE) vs 当前项目 */}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs text-nova-text-muted shrink-0">{t('skillRegistry.installTarget')}</span>
                <div className="flex rounded-full border border-nova-border overflow-hidden text-xs">
                  <button
                    onClick={() => switchTarget('global')}
                    className={`px-3 py-1 transition-colors ${
                      installTarget === 'global' ? 'bg-[var(--accent)] text-white' : 'text-nova-text-muted hover:bg-nova-hover'
                    }`}
                  >
                    {t('skillRegistry.installGlobal')}
                  </button>
                  <button
                    onClick={() => switchTarget('project')}
                    disabled={!projectRoot}
                    title={projectRoot ? undefined : t('skillRegistry.installProjectDisabled')}
                    className={`px-3 py-1 transition-colors disabled:opacity-40 ${
                      installTarget === 'project' ? 'bg-[var(--accent)] text-white' : 'text-nova-text-muted hover:bg-nova-hover'
                    }`}
                  >
                    {t('skillRegistry.installProject')}
                  </button>
                </div>
                {installTarget === 'project' && projectRoot && (
                  <span className="text-[11px] text-nova-text-muted truncate min-w-0" title={projectRoot}>
                    {projectRoot.split(/[/\\]/).pop()}
                  </span>
                )}
              </div>
              <p className="text-xs text-nova-text-muted mb-3">
                {registryUrl
                  ? t('skillRegistry.installFromRegistry')
                  : t('skillRegistry.noRegistryConfigured')}
              </p>
              {registrySkills.length === 0 ? (
                <div className="text-center py-16 text-nova-text-muted text-sm">
                  {search ? t('skillRegistry.noMatch') : t('skillRegistry.noRegistrySkills')}
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredRegistry.map((r) => {
                    const status = statusOf(r)
                    return (
                      <div key={r.name} className="flex items-center gap-3 p-3 rounded-lg hover:bg-white/50 dark:hover:bg-white/5 transition-colors">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${
                          status === 'install' ? 'bg-slate-400' : 'bg-[#22c55e]'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-[13px] font-bold truncate" style={{ color: 'var(--accent)' }}>{r.name}</span>
                            {r.version && <span className="font-mono text-[11px] text-nova-text-muted shrink-0">v{r.version}</span>}
                            {r.author && <span className="text-[11px] text-nova-text-muted shrink-0">by {r.author}</span>}
                            {status !== 'install' && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full border font-medium bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]/30 shrink-0">
                                {status === 'update' ? t('skillRegistry.update') : t('skillRegistry.installed')}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-nova-text-muted mt-0.5 truncate">{r.description}</p>
                        </div>
                        <button
                          onClick={() => run(r.name, async () => {
                            const root = await targetRoot()
                            if (!root) throw new Error('未选择安装目标')
                            await installSkill(r.name, root, r)
                          })}
                          disabled={busy === r.name}
                          className={`shrink-0 px-3 py-1.5 text-xs font-bold rounded-full transition-all disabled:opacity-40 ${
                            status === 'installed'
                              ? 'bg-nova-hover text-nova-text-muted border border-nova-border cursor-default'
                              : 'bg-[var(--accent)] text-white hover:opacity-90'
                          }`}
                        >
                          {busy === r.name
                            ? t('skillRegistry.busy')
                            : status === 'installed'
                              ? t('skillRegistry.installed')
                              : status === 'update'
                                ? t('skillRegistry.update')
                                : t('skillRegistry.install')}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer hint (设计稿) */}
        <div className="px-6 py-3 border-t border-nova-border bg-nova-bg/40">
          <p className="text-xs text-nova-text-muted flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v-3M4 7v3M4 13a4 4 0 000 6M4 7a4 4 0 000 6M20 16v-3M20 7v3M20 13a4 4 0 000 6M20 7a4 4 0 000 6" />
            </svg>
            {t('skillRegistry.installFromRegistry')}
          </p>
        </div>
      </div>

      {/* Uninstall confirmation */}
      {confirmUninstall && (
        <div role="dialog" aria-modal="true" aria-label={t('skillRegistry.uninstallConfirm', { name: confirmUninstall.name })} className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60" onClick={() => setConfirmUninstall(null)}>
          <div className="glass-modal rounded-2xl p-6 w-[400px]" style={{ boxShadow: 'var(--shadow-xl)' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-nova-text-primary mb-2">
              {t('skillRegistry.uninstallConfirm', { name: confirmUninstall.name })}
            </h3>
            <p className="text-xs text-nova-text-muted mb-6">
              {t('skillRegistry.uninstallDesc', { name: confirmUninstall.name })}
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirmUninstall(null)}
                className="px-4 py-2 text-sm text-nova-text-muted hover:text-nova-text-primary transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  const row = confirmUninstall
                  setConfirmUninstall(null)
                  run(row.name, async () => {
                    const configRoot = await configRootFor(row)
                    if (!configRoot) throw new Error('无法确定该技能的配置位置')
                    await uninstallSkill(row.name, configRoot)
                  })
                }}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                {t('skillRegistry.uninstall')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
