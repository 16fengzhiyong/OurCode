import { useState, useEffect, useCallback } from 'react'

/**
 * MCP server configuration editor (Settings → 功能 → MCP 服务器).
 *
 * Reads/writes <projectRoot>/mcp_config.json through the main process
 * (mcp:getConfig / mcp:saveConfig), matching the mcp-manager schema:
 *   { "mcpServers": { name: { command?, args?, env?, serverUrl?, headers?, disabled? } } }
 * Supports the two transports used by the manager: stdio (command+args+env)
 * and HTTP (serverUrl+headers).
 */

interface McpServerDraft {
  name: string
  enabled: boolean
  type: 'stdio' | 'http'
  command: string
  argsText: string
  envText: string
  url: string
  headersText: string
}

function parseArgs(text: string): string[] {
  return text.split(/\s+/).map((s) => s.trim()).filter(Boolean)
}

function parseKeyValue(text: string, sep: '=' | ':'): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf(sep)
    if (idx <= 0) continue
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim()
  }
  return out
}

function toKeyValueLines(obj: Record<string, string> | undefined, sep: '=' | ':'): string {
  return Object.entries(obj || {})
    .map(([k, v]) => `${k}${sep}${v}`)
    .join('\n')
}

const emptyServer = (): McpServerDraft => ({
  name: '',
  enabled: true,
  type: 'stdio',
  command: '',
  argsText: '',
  envText: '',
  url: '',
  headersText: '',
})

export default function McpConfigSection({ rootPath }: { rootPath: string | null }) {
  const [servers, setServers] = useState<McpServerDraft[]>([])
  const [status, setStatus] = useState<{ type: 'ok' | 'error' | 'info'; text: string } | null>(null)
  const [configFile, setConfigFile] = useState<string | null>(null)

  const loadConfig = useCallback(async () => {
    setStatus(null)
    if (!rootPath) {
      setServers([])
      setStatus({ type: 'info', text: '未打开项目 — 请先打开一个项目文件夹' })
      return
    }
    const res = await window.electronAPI.mcpGetConfig(rootPath)
    if (!res.ok) {
      setStatus({ type: 'error', text: res.error || '读取配置失败' })
      return
    }
    setConfigFile(res.file)
    setServers(
      Object.entries(res.config.mcpServers || {}).map(([name, s]) => ({
        name,
        enabled: s.disabled !== true,
        type: s.serverUrl || s.url ? 'http' : 'stdio',
        command: s.command || '',
        argsText: (s.args || []).join(' '),
        envText: toKeyValueLines(s.env, '='),
        url: s.serverUrl || s.url || '',
        headersText: toKeyValueLines(s.headers, ':'),
      })),
    )
  }, [rootPath])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const updateServer = (index: number, patch: Partial<McpServerDraft>) => {
    setServers((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  const saveConfig = async () => {
    if (!rootPath) return
    const mcpServers: Record<string, any> = {}
    const seen = new Set<string>()
    for (const s of servers) {
      const name = s.name.trim()
      if (!name) continue
      if (seen.has(name)) {
        setStatus({ type: 'error', text: `服务器名称 "${name}" 重复，请先修改再保存` })
        return
      }
      seen.add(name)
      const entry: any = { disabled: !s.enabled }
      if (s.type === 'http') {
        const url = s.url.trim()
        if (!url) {
          setStatus({ type: 'error', text: `服务器 "${name}" 缺少 URL` })
          return
        }
        entry.serverUrl = url
        const headers = parseKeyValue(s.headersText, ':')
        if (Object.keys(headers).length > 0) entry.headers = headers
      } else {
        const command = s.command.trim()
        if (!command) {
          setStatus({ type: 'error', text: `服务器 "${name}" 缺少 command` })
          return
        }
        entry.command = command
        const args = parseArgs(s.argsText)
        if (args.length > 0) entry.args = args
        const env = parseKeyValue(s.envText, '=')
        if (Object.keys(env).length > 0) entry.env = env
      }
      mcpServers[name] = entry
    }
    const res = await window.electronAPI.mcpSaveConfig(rootPath, { mcpServers }, configFile)
    if (res.ok) {
      // Reload first — loadConfig() clears the status, so re-apply the
      // success message afterwards (otherwise it would never be visible).
      await loadConfig()
      setStatus({ type: 'ok', text: '已保存并重新加载 MCP 服务器' })
    } else {
      setStatus({ type: 'error', text: res.error || '保存失败' })
    }
  }

  const inputCls =
    'w-full px-2.5 py-1.5 text-xs bg-nova-input-bg border border-nova-border rounded-md text-nova-text-primary placeholder-nova-text-muted focus:border-nova-accent/50 focus:outline-none transition-colors'
  const labelCls = 'text-[10px] text-nova-text-muted mb-1 block'

  return (
    <div className="flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-nova-text-muted truncate">
          {configFile ? (
            <span className="font-mono">{configFile}</span>
          ) : (
            <span>配置保存在项目根目录的 mcp_config.json</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {status && (
            <span
              className={`text-[10px] px-2 py-1 rounded ${
                status.type === 'ok'
                  ? 'text-green-500 bg-green-500/10'
                  : status.type === 'error'
                    ? 'text-red-400 bg-red-500/10'
                    : 'text-nova-text-muted bg-nova-hover'
              }`}
            >
              {status.text}
            </span>
          )}
          <button
            onClick={loadConfig}
            className="px-2.5 py-1 text-[11px] text-nova-text-secondary hover:text-nova-text-primary hover:bg-nova-hover rounded-md transition-colors"
          >
            重新加载
          </button>
          <button
            onClick={saveConfig}
            className="px-3 py-1 text-[11px] font-medium text-white bg-[#2563eb] hover:opacity-90 rounded-md transition-opacity"
          >
            保存配置
          </button>
        </div>
      </div>

      {/* Server cards */}
      <div className="flex flex-col gap-3">
        {servers.length === 0 && (
          <div className="text-[11px] text-nova-text-muted px-1 py-2">
            还没有 MCP 服务器，点击下方「添加服务器」开始
          </div>
        )}
        {servers.map((s, i) => (
          <div key={i} className="rounded-lg border border-nova-border bg-nova-hover/40 p-3 flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <input
                value={s.name}
                onChange={(e) => updateServer(i, { name: e.target.value })}
                placeholder="服务器名称"
                className={`${inputCls} flex-1 font-mono`}
              />
              <select
                value={s.type}
                onChange={(e) => updateServer(i, { type: e.target.value as 'stdio' | 'http' })}
                className="px-2 py-1.5 text-[11px] bg-nova-input-bg border border-nova-border rounded-md text-nova-text-primary outline-none cursor-pointer hover:border-nova-accent"
              >
                <option value="stdio">本地命令</option>
                <option value="http">HTTP / SSE</option>
              </select>
              <label className="flex items-center gap-1.5 text-[11px] text-nova-text-secondary cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => updateServer(i, { enabled: e.target.checked })}
                  className="accent-nova-accent"
                />
                启用
              </label>
              <button
                onClick={() => setServers((prev) => prev.filter((_, idx) => idx !== i))}
                className="p-1.5 text-nova-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                title="删除服务器"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                </svg>
              </button>
            </div>

            {s.type === 'stdio' ? (
              <>
                <div>
                  <span className={labelCls}>启动命令 command</span>
                  <input
                    value={s.command}
                    onChange={(e) => updateServer(i, { command: e.target.value })}
                    placeholder="例如：node、npx"
                    className={`${inputCls} font-mono`}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <span className={labelCls}>参数 args（空格分隔）</span>
                    <input
                      value={s.argsText}
                      onChange={(e) => updateServer(i, { argsText: e.target.value })}
                      placeholder="例如：server.js --port 3000"
                      className={`${inputCls} font-mono`}
                    />
                  </div>
                  <div>
                    <span className={labelCls}>环境变量 env（每行 KEY=VALUE）</span>
                    <textarea
                      value={s.envText}
                      onChange={(e) => updateServer(i, { envText: e.target.value })}
                      placeholder="GIT_PAGER=cat"
                      rows={2}
                      className={`${inputCls} font-mono resize-y`}
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span className={labelCls}>服务器地址 URL（HTTP / SSE）</span>
                  <input
                    value={s.url}
                    onChange={(e) => updateServer(i, { url: e.target.value })}
                    placeholder="例如：http://localhost:3001/mcp"
                    className={`${inputCls} font-mono`}
                  />
                </div>
                <div>
                  <span className={labelCls}>请求头 headers（每行 KEY: VALUE）</span>
                  <textarea
                    value={s.headersText}
                    onChange={(e) => updateServer(i, { headersText: e.target.value })}
                    placeholder="Authorization: Bearer xxx"
                    rows={2}
                    className={`${inputCls} font-mono resize-y`}
                  />
                </div>
              </>
            )}
          </div>
        ))}

        <button
          onClick={() => setServers((prev) => [...prev, emptyServer()])}
          className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-nova-accent bg-nova-accent/10 hover:bg-nova-accent/20 rounded-md transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          添加服务器
        </button>
      </div>
    </div>
  )
}
