import { useState, useEffect, useCallback } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { useI18n } from '@/i18n/useI18n'
import { listSkills, getWorkspaceRoot, type SkillInfo } from '@/services/skills/skillManager'
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

/**
 * Skill management dialog: local skills (enable/disable/uninstall) + remote
 * registry browser (install/update). Mirrors the PluginMarketplace layout.
 * Installed/enabled skills surface automatically in the agent's skill index,
 * tool list and "/" slash menu.
 */
export default function SkillRegistryModal() {
  const { isSkillRegistryOpen, closeSkillRegistry } = useUIStore()
  const t = useI18n()

  const [root, setRoot] = useState('')
  const [tab, setTab] = useState<'local' | 'registry'>('local')
  const [search, setSearch] = useState('')
  const [localSkills, setLocalSkills] = useState<LocalSkillRow[]>([])
  const [registrySkills, setRegistrySkills] = useState<RegistrySkillInfo[]>([])
  const [registryUrl, setRegistryUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null)

  const reloadLocal = useCallback(async (targetRoot: string) => {
    const all = await listSkills(true, targetRoot, true)
    const config = await readSkillConfig(targetRoot)
    const rows: LocalSkillRow[] = []
    for (const s of all) {
      rows.push({
        ...s,
        enabled: await isSkillEnabled(s.name, targetRoot),
        version: config.skills[s.name]?.version,
      })
    }
    setLocalSkills(rows)
  }, [])

  const reloadRegistry = useCallback(async (targetRoot: string) => {
    const list = await fetchRegistryIndex(undefined, targetRoot)
    const config = await readSkillConfig(targetRoot)
    setRegistrySkills(list)
    setRegistryUrl(config.registryUrl || '')
  }, [])

  useEffect(() => {
    if (!isSkillRegistryOpen) return
    const workspace = getWorkspaceRoot()
    setRoot(workspace)
    if (!workspace) return
    reloadLocal(workspace)
    reloadRegistry(workspace)
  }, [isSkillRegistryOpen, reloadLocal, reloadRegistry])

  if (!isSkillRegistryOpen) return null

  const run = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name)
    setError(null)
    try {
      await fn()
    } catch (e: any) {
      setError(t('skillRegistry.error', { error: e.message || String(e) }))
    } finally {
      setBusy(null)
      if (root) {
        reloadLocal(root)
        reloadRegistry(root)
      }
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
        className="bg-nova-surface border border-nova-border rounded-xl shadow-2xl w-[760px] max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-nova-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#10b981] to-[#059669] flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
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

        {/* Tabs */}
        <div className="flex items-center gap-1 px-6 pt-3 border-b border-nova-border">
          <button
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              tab === 'local'
                ? 'text-nova-accent border-b-2 border-nova-accent bg-nova-accent/5'
                : 'text-nova-text-muted hover:text-nova-text-primary'
            }`}
            onClick={() => setTab('local')}
          >
            {t('skillRegistry.localTab', { count: localSkills.length })}
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              tab === 'registry'
                ? 'text-nova-accent border-b-2 border-nova-accent bg-nova-accent/5'
                : 'text-nova-text-muted hover:text-nova-text-primary'
            }`}
            onClick={() => setTab('registry')}
          >
            {t('skillRegistry.registryTab')}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Search */}
          <div className="mb-4">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nova-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder={t('skillRegistry.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-nova-bg border border-nova-border rounded-lg text-sm text-nova-text-primary placeholder-nova-text-muted focus:outline-none focus:border-nova-accent"
              />
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">{error}</div>
          )}

          {!root ? (
            <div className="text-center py-16 text-nova-text-muted text-sm">{t('skillRegistry.workspaceRequired')}</div>
          ) : tab === 'local' ? (
            filteredLocal.length === 0 ? (
              <div className="text-center py-16 text-nova-text-muted text-sm">
                {search ? t('skillRegistry.noMatch') : t('skillRegistry.noLocalSkills')}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredLocal.map((s) => (
                  <div key={s.name} className="flex items-center gap-3 p-3 bg-nova-card border border-nova-border rounded-xl">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-nova-text-primary font-mono">/{s.name}</span>
                        {s.version && <span className="text-[10px] text-nova-text-muted">v{s.version}</span>}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                          s.enabled
                            ? 'bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]/30'
                            : 'bg-gray-500/15 text-gray-400 border-gray-500/30'
                        }`}>
                          {s.enabled ? t('skillRegistry.installed') : t('plugin.statusDisabled')}
                        </span>
                      </div>
                      <p className="text-xs text-nova-text-muted mt-0.5 truncate">
                        {s.description || s.path} · {s.source}
                      </p>
                    </div>
                    <button
                      onClick={() => run(s.name, () => setSkillEnabled(s.name, !s.enabled, root))}
                      disabled={busy === s.name}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors disabled:opacity-40 ${
                        s.enabled
                          ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/25 hover:bg-yellow-500/25'
                          : 'bg-green-500/15 text-green-400 border border-green-500/25 hover:bg-green-500/25'
                      }`}
                    >
                      {busy === s.name ? t('skillRegistry.busy') : s.enabled ? t('skillRegistry.disable') : t('skillRegistry.enable')}
                    </button>
                    <button
                      onClick={() => setConfirmUninstall(s.name)}
                      disabled={busy === s.name}
                      className="px-2.5 py-1 text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 rounded-md hover:bg-red-500/20 transition-colors disabled:opacity-40"
                    >
                      {t('skillRegistry.uninstall')}
                    </button>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div>
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
                <div className="space-y-2">
                  {filteredRegistry.map((r) => {
                    const status = statusOf(r)
                    return (
                      <div key={r.name} className="flex items-center gap-3 p-3 bg-nova-card border border-nova-border rounded-xl">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-nova-text-primary font-mono">{r.name}</span>
                            {r.version && <span className="text-[10px] text-nova-text-muted">v{r.version}</span>}
                            {r.author && <span className="text-[10px] text-nova-text-muted">by {r.author}</span>}
                            {status !== 'install' && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full border font-medium bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]/30">
                                {status === 'update' ? t('skillRegistry.update') : t('skillRegistry.installed')}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-nova-text-muted mt-0.5 truncate">{r.description}</p>
                        </div>
                        <button
                          onClick={() => run(r.name, () => installSkill(r.name, root, r))}
                          disabled={busy === r.name}
                          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors disabled:opacity-40 ${
                            status === 'installed'
                              ? 'bg-nova-hover text-nova-text-muted border border-nova-border cursor-default'
                              : 'bg-nova-accent text-white hover:opacity-90'
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
      </div>

      {/* Uninstall confirmation */}
      {confirmUninstall && (
        <div role="dialog" aria-modal="true" aria-label={t('skillRegistry.uninstallConfirm', { name: confirmUninstall })} className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60" onClick={() => setConfirmUninstall(null)}>
          <div className="bg-nova-surface border border-nova-border rounded-xl shadow-2xl p-6 w-[400px]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-nova-text-primary mb-2">
              {t('skillRegistry.uninstallConfirm', { name: confirmUninstall })}
            </h3>
            <p className="text-xs text-nova-text-muted mb-6">
              {t('skillRegistry.uninstallDesc', { name: confirmUninstall })}
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
                  const name = confirmUninstall
                  setConfirmUninstall(null)
                  run(name, () => uninstallSkill(name, root))
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
