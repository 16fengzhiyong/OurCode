import { useState, useEffect } from 'react'
import { usePluginStore } from '@/stores/pluginStore'
import { useUIStore } from '@/stores/uiStore'
import { PluginInfo, PluginManifest } from '@/services/plugin/types'

export default function PluginMarketplace() {
  const { isMarketplaceOpen, closeMarketplace } = useUIStore()
  const { plugins, isInstalling, error, loadPlugins, installPlugin, uninstallPlugin, togglePlugin, clearError } = usePluginStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'installed' | 'install'>('installed')
  const [manifestText, setManifestText] = useState('')
  const [codeText, setCodeText] = useState('')
  const [installError, setInstallError] = useState<string | null>(null)
  const [showConfirmUninstall, setShowConfirmUninstall] = useState<string | null>(null)

  useEffect(() => {
    if (isMarketplaceOpen) {
      loadPlugins()
    }
  }, [isMarketplaceOpen, loadPlugins])

  if (!isMarketplaceOpen) return null

  const filteredPlugins = plugins.filter((p) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      p.manifest.name.toLowerCase().includes(q) ||
      p.manifest.description.toLowerCase().includes(q) ||
      p.manifest.author.toLowerCase().includes(q) ||
      p.manifest.id.toLowerCase().includes(q)
    )
  })

  const handleInstallFromFile = async () => {
    setInstallError(null)
    try {
      const manifest: PluginManifest = JSON.parse(manifestText)
      if (!manifest.id || !manifest.name || !manifest.version || !manifest.main) {
        setInstallError('Manifest must include: id, name, version, main')
        return
      }
      if (!codeText.trim()) {
        setInstallError('Plugin code is required')
        return
      }
      await installPlugin(manifest, codeText)
      setManifestText('')
      setCodeText('')
      setActiveTab('installed')
    } catch (e: any) {
      setInstallError(e.message || 'Invalid manifest JSON')
    }
  }

  const handleImportFile = async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        if (data.manifest && data.code) {
          setManifestText(JSON.stringify(data.manifest, null, 2))
          setCodeText(data.code)
        } else if (data.id && data.name) {
          setManifestText(JSON.stringify(data, null, 2))
        } else {
          setInstallError('Unrecognized plugin package format. Expected { manifest, code } or manifest JSON.')
        }
      } catch (e: any) {
        setInstallError(`Failed to read file: ${e.message}`)
      }
    }
    input.click()
  }

  const getStatusBadge = (status: PluginInfo['status']) => {
    const styles: Record<string, string> = {
      active: 'bg-green-500/20 text-green-400 border-green-500/30',
      installed: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      disabled: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
      error: 'bg-red-500/20 text-red-400 border-red-500/30',
    }
    const labels: Record<string, string> = {
      active: '运行中',
      installed: '已安装',
      disabled: '已禁用',
      error: '错误',
    }
    return (
      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${styles[status] || styles.installed}`}>
        {labels[status] || status}
      </span>
    )
  }

  const getPermissionLabel = (perm: string): string => {
    const labels: Record<string, string> = {
      'editor.read': '读取编辑器',
      'editor.write': '写入编辑器',
      'file.read': '读取文件',
      'file.write': '写入文件',
      'ai.chat': 'AI对话',
      'ai.completion': 'AI补全',
      'ui.panel': '注册面板',
      'ui.statusbar': '状态栏',
      'terminal.read': '读取终端',
      'terminal.write': '写入终端',
      'network': '网络请求',
    }
    return labels[perm] || perm
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={closeMarketplace}>
      <div
        className="bg-nova-surface border border-nova-border rounded-xl shadow-2xl w-[900px] max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-nova-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-nova-text-primary">扩展市场</h2>
              <p className="text-xs text-nova-text-muted">管理已安装的扩展或安装新扩展</p>
            </div>
          </div>
          <button
            onClick={closeMarketplace}
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
              activeTab === 'installed'
                ? 'text-nova-accent border-b-2 border-nova-accent bg-nova-accent/5'
                : 'text-nova-text-muted hover:text-nova-text-primary'
            }`}
            onClick={() => setActiveTab('installed')}
          >
            已安装 ({plugins.length})
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === 'install'
                ? 'text-nova-accent border-b-2 border-nova-accent bg-nova-accent/5'
                : 'text-nova-text-muted hover:text-nova-text-primary'
            }`}
            onClick={() => setActiveTab('install')}
          >
            安装扩展
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'installed' ? (
            <div>
              {/* Search */}
              <div className="mb-4">
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nova-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="搜索扩展..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-nova-bg border border-nova-border rounded-lg text-sm text-nova-text-primary placeholder-nova-text-muted focus:outline-none focus:border-nova-accent"
                  />
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center justify-between">
                  <span className="text-sm text-red-400">{error}</span>
                  <button onClick={clearError} className="text-red-400 hover:text-red-300 text-xs">关闭</button>
                </div>
              )}

              {/* Plugin list */}
              {filteredPlugins.length === 0 ? (
                <div className="text-center py-16">
                  <svg className="w-16 h-16 mx-auto text-nova-text-muted/30 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <p className="text-nova-text-muted text-sm">
                    {searchQuery ? '未找到匹配的扩展' : '尚未安装任何扩展'}
                  </p>
                  {!searchQuery && (
                    <button
                      onClick={() => setActiveTab('install')}
                      className="mt-3 text-sm text-nova-accent hover:underline"
                    >
                      安装第一个扩展
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredPlugins.map((plugin) => (
                    <PluginCard
                      key={plugin.manifest.id}
                      plugin={plugin}
                      onToggle={() => togglePlugin(plugin.manifest.id)}
                      onUninstall={() => setShowConfirmUninstall(plugin.manifest.id)}
                      getPermissionLabel={getPermissionLabel}
                      getStatusBadge={getStatusBadge}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Install tab */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-nova-text-secondary">
                  通过粘贴 Manifest JSON 和插件代码来安装扩展，或导入插件包文件。
                </p>
                <button
                  onClick={handleImportFile}
                  className="px-3 py-1.5 text-sm bg-nova-hover border border-nova-border rounded-lg text-nova-text-secondary hover:text-white hover:border-nova-accent/50 transition-colors"
                >
                  导入插件包
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-nova-text-secondary mb-1.5">
                  Manifest JSON
                </label>
                <textarea
                  value={manifestText}
                  onChange={(e) => setManifestText(e.target.value)}
                  placeholder={`{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "A sample plugin",
  "author": "Developer",
  "main": "index.js",
  "permissions": ["editor.read", "ai.chat"]
}`}
                  className="w-full h-40 p-3 bg-nova-bg border border-nova-border rounded-lg text-sm text-nova-text-primary font-mono resize-none placeholder-nova-text-muted focus:outline-none focus:border-nova-accent"
                  spellCheck={false}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-nova-text-secondary mb-1.5">
                  插件代码 (JavaScript)
                </label>
                <textarea
                  value={codeText}
                  onChange={(e) => setCodeText(e.target.value)}
                  placeholder={`// Plugin entry point
// Access the API via the global 'api' object
// e.g., api.editor.getActiveFile()

api.ui.registerPanel('my-panel', 'My Plugin', () => {
  const div = document.createElement('div');
  div.textContent = 'Hello from my plugin!';
  return div;
});`}
                  className="w-full h-48 p-3 bg-nova-bg border border-nova-border rounded-lg text-sm text-nova-text-primary font-mono resize-none placeholder-nova-text-muted focus:outline-none focus:border-nova-accent"
                  spellCheck={false}
                />
              </div>

              {(installError || error) && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <span className="text-sm text-red-400">{installError || error}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => { setManifestText(''); setCodeText(''); setInstallError(null) }}
                  className="px-4 py-2 text-sm text-nova-text-muted hover:text-nova-text-primary transition-colors"
                >
                  清空
                </button>
                <button
                  onClick={handleInstallFromFile}
                  disabled={isInstalling || !manifestText.trim() || !codeText.trim()}
                  className="px-5 py-2 text-sm font-medium bg-nova-accent text-white rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                >
                  {isInstalling ? '安装中...' : '安装扩展'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Uninstall confirmation */}
        {showConfirmUninstall && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60" onClick={() => setShowConfirmUninstall(null)}>
            <div className="bg-nova-surface border border-nova-border rounded-xl shadow-2xl p-6 w-[400px]" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-nova-text-primary mb-2">卸载扩展</h3>
              <p className="text-sm text-nova-text-secondary mb-1">
                确定要卸载此扩展吗？
              </p>
              <p className="text-xs text-nova-text-muted mb-6">
                扩展 <code className="bg-nova-bg px-1 py-0.5 rounded">{showConfirmUninstall}</code> 将被停用并移除。
              </p>
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => setShowConfirmUninstall(null)}
                  className="px-4 py-2 text-sm text-nova-text-muted hover:text-nova-text-primary transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={async () => {
                    await uninstallPlugin(showConfirmUninstall)
                    setShowConfirmUninstall(null)
                  }}
                  className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  卸载
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function PluginCard({
  plugin,
  onToggle,
  onUninstall,
  getPermissionLabel,
  getStatusBadge,
}: {
  plugin: PluginInfo
  onToggle: () => void
  onUninstall: () => void
  getPermissionLabel: (p: string) => string
  getStatusBadge: (s: PluginInfo['status']) => JSX.Element
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-nova-bg border border-nova-border rounded-lg overflow-hidden hover:border-nova-accent/30 transition-colors">
      <div className="flex items-center gap-4 p-4">
        {/* Icon */}
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-nova-border flex items-center justify-center shrink-0">
          <span className="text-lg font-bold text-purple-400">
            {plugin.manifest.name.charAt(0).toUpperCase()}
          </span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-nova-text-primary truncate">
              {plugin.manifest.name}
            </h3>
            <span className="text-[10px] text-nova-text-muted">v{plugin.manifest.version}</span>
            {getStatusBadge(plugin.status)}
          </div>
          <p className="text-xs text-nova-text-muted mt-0.5 truncate">
            {plugin.manifest.description || '无描述'}
          </p>
          <p className="text-[10px] text-nova-text-muted mt-1">
            {plugin.manifest.author} &middot; {plugin.manifest.permissions.length} 项权限
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 text-nova-text-muted hover:text-nova-text-primary rounded transition-colors"
            title="详情"
          >
            <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button
            onClick={onToggle}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              plugin.status === 'active'
                ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/30'
                : 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30'
            }`}
          >
            {plugin.status === 'active' ? '停用' : '启用'}
          </button>
          <button
            onClick={onUninstall}
            className="px-3 py-1 text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 rounded-md hover:bg-red-500/20 transition-colors"
          >
            卸载
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-nova-border pt-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="text-xs font-medium text-nova-text-muted mb-1.5">基本信息</h4>
              <dl className="text-xs space-y-1">
                <div className="flex gap-2">
                  <dt className="text-nova-text-muted w-16">ID</dt>
                  <dd className="text-nova-text-secondary font-mono">{plugin.manifest.id}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-nova-text-muted w-16">入口</dt>
                  <dd className="text-nova-text-secondary font-mono">{plugin.manifest.main}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-nova-text-muted w-16">路径</dt>
                  <dd className="text-nova-text-secondary font-mono truncate">{plugin.installPath}</dd>
                </div>
              </dl>
            </div>
            <div>
              <h4 className="text-xs font-medium text-nova-text-muted mb-1.5">权限</h4>
              <div className="flex flex-wrap gap-1">
                {plugin.manifest.permissions.map((perm) => (
                  <span
                    key={perm}
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      plugin.enabledPermissions.includes(perm as any)
                        ? 'bg-green-500/10 text-green-400 border-green-500/20'
                        : 'bg-gray-500/10 text-gray-400 border-gray-500/20 line-through'
                    }`}
                  >
                    {getPermissionLabel(perm)}
                  </span>
                ))}
              </div>
            </div>
          </div>
          {plugin.error && (
            <div className="mt-3 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
              {plugin.error}
            </div>
          )}
          {plugin.manifest.contributes && (
            <div className="mt-3">
              <h4 className="text-xs font-medium text-nova-text-muted mb-1.5">功能贡献</h4>
              <div className="flex flex-wrap gap-2 text-[10px] text-nova-text-muted">
                {plugin.manifest.contributes.commands && (
                  <span className="px-1.5 py-0.5 bg-nova-hover rounded">{plugin.manifest.contributes.commands.length} 个命令</span>
                )}
                {plugin.manifest.contributes.keybindings && (
                  <span className="px-1.5 py-0.5 bg-nova-hover rounded">{plugin.manifest.contributes.keybindings.length} 个快捷键</span>
                )}
                {plugin.manifest.contributes.themes && (
                  <span className="px-1.5 py-0.5 bg-nova-hover rounded">{plugin.manifest.contributes.themes.length} 个主题</span>
                )}
                {plugin.manifest.contributes.languages && (
                  <span className="px-1.5 py-0.5 bg-nova-hover rounded">{plugin.manifest.contributes.languages.length} 个语言</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
