import { useState, useEffect, useRef } from 'react'
import { useConfigStore } from '@/stores/configStore'
import { useEditorStore } from '@/stores/editorStore'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { useShortcutStore, ShortcutPreset } from '@/stores/shortcutStore'
import { ApiConfigGroup } from '@/types'
import { monaco, OURCODE_DARK_THEME, OURCODE_LIGHT_THEME } from '@/editor/monacoSetup'
import { useI18n } from '@/i18n/useI18n'

// System-prompt templates
const SYSTEM_PROMPT_TEMPLATES: Array<{ id: string; label: string; prompt: string }> = [
  { id: 'universal', label: '通用编程助手', prompt: '你是一个专业的编程助手。当前项目使用 {{language}}，项目名称：{{projectName}}。' },
  { id: 'python', label: 'Python 专家', prompt: '你是一位资深 Python 开发者。请遵守 PEP 8 规范，使用类型注解。当前文件：{{currentFile}}' },
  { id: 'reviewer', label: '代码审查员', prompt: '你是一位严格的代码审查员。请从代码质量、潜在 Bug、性能和安全性等方面审查代码。' },
  { id: 'frontend', label: '前端专家', prompt: '你是前端专家，精通 React、TypeScript 和 CSS。框架：{{framework}}。' },
  { id: 'api', label: 'API 设计专家', prompt: '你是 API 设计专家。请帮助设计规范化的 RESTful API，使用正确的命名和 HTTP 方法。' },
  { id: 'doc', label: '文档专家', prompt: '你是技术文档专家。项目：{{projectName}}，语言：{{language}}' },
  { id: 'bugfix', label: 'Bug 修复专家', prompt: '你是调试专家。请分析错误信息，定位根因并提供修复方案。文件：{{currentFile}}' },
  { id: 'sql', label: '数据库专家', prompt: '你是数据库专家。请帮助编写高效的 SQL 查询并优化性能。' },
]

const PROMPT_VARS = ['{{language}}', '{{framework}}', '{{projectName}}', '{{currentFile}}', '{{gitBranch}}', '{{date}}']

// Accent color presets
const THEME_COLOR_PRESETS = ['#2563eb', '#7c5cbf', '#059669', '#e11d48', '#f59e0b', '#0891b2']

const CONFIG_COLORS = [
  '#6C9EFF', '#B77CFF', '#4ADE80', '#FB923C', '#F87171', '#FACC15', '#2DD4BF', '#F472B6',
]

const PROVIDERS = [
  { value: 'openai', label: 'OpenAI', icon: 'O', color: '#10a37f' },
  { value: 'anthropic', label: 'Anthropic', icon: 'A', color: '#d47757' },
  { value: 'gemini', label: 'Gemini', icon: 'G', color: '#4285f4' },
  { value: 'deepseek', label: 'DeepSeek', icon: 'D', color: '#4f46e5' },
  { value: 'groq', label: 'Groq', icon: 'Q', color: '#f97316' },
  { value: 'azure', label: 'Azure', icon: 'Z', color: '#0078d4' },
  { value: 'ollama', label: 'Ollama', icon: 'L', color: '#fbbf24' },
  { value: 'custom', label: '自定义', icon: '⚙', color: '#a1a1aa' },
]

export default function SettingsModal() {
  const {
    configGroups, activeConfigGroupId, models,
    loadConfigGroups, createConfigGroup, updateConfigGroup,
    deleteConfigGroup, setActiveConfigGroup, fetchModels, testConnection,
    savePromptVersion, getPromptHistory, restorePromptVersion,
  } = useConfigStore()

  const { preferences, savePreferences } = useEditorStore()
  const { isSettingsOpen, closeSettings, setTheme, setThemeColor } = useUIStore()
  const themeColor = useUIStore((s) => s.themeColor)
  const shortcutStore = useShortcutStore()
  const t = useI18n()

  const [activeTab, setActiveTab] = useState<'api' | 'appearance' | 'editor' | 'shortcuts'>('api')
  const [editingGroup, setEditingGroup] = useState<Partial<ApiConfigGroup> | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({})
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({})
  const [showPromptHistory, setShowPromptHistory] = useState(false)
  const [lspServersText, setLspServersText] = useState(
    Object.entries(preferences.lspServers ?? {})
      .map(([lang, cmd]) => `${lang}: ${cmd}`)
      .join('\n'),
  )
  const promptEditorRef = useRef<HTMLDivElement>(null)
  const promptEditorInstance = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Initialize Monaco editor for system prompt
  useEffect(() => {
    if (!promptEditorRef.current || !editingGroup) return
    if (promptEditorInstance.current) promptEditorInstance.current.dispose()

    const editor = monaco.editor.create(promptEditorRef.current, {
      value: editingGroup.systemPrompt || '',
      language: 'markdown',
      theme: document.documentElement.classList.contains('dark') ? OURCODE_DARK_THEME : OURCODE_LIGHT_THEME,
      minimap: { enabled: false },
      lineNumbers: 'off',
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      folding: false,
      glyphMargin: false,
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 0,
      overviewRulerBorder: false,
      overviewRulerLanes: 0,
      renderLineHighlight: 'none',
      scrollbar: { vertical: 'auto', horizontal: 'hidden' },
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      padding: { top: 8, bottom: 8 },
      automaticLayout: true,
    })

    editor.onDidChangeModelContent(() => {
      setEditingGroup((prev) => prev ? { ...prev, systemPrompt: editor.getValue() } : prev)
    })

    promptEditorInstance.current = editor
    return () => { editor.dispose(); promptEditorInstance.current = null }
  }, [editingGroup?.id, isCreating])

  // Sync external prompt changes into Monaco
  useEffect(() => {
    const editor = promptEditorInstance.current
    const prompt = editingGroup?.systemPrompt
    if (!editor || prompt === undefined) return
    if (editor.getValue() !== prompt) editor.setValue(prompt || '')
  }, [editingGroup?.systemPrompt])

  useEffect(() => {
    if (isSettingsOpen) {
      loadConfigGroups()
      useShortcutStore.getState().loadShortcuts()
      dialogRef.current?.focus()
    }
  }, [isSettingsOpen, loadConfigGroups])

  if (!isSettingsOpen) return null

  const handleCreateGroup = () => {
    setIsCreating(true)
    setEditingGroup({
      name: '新配置',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      systemPrompt: '',
      defaultModel: '',
      provider: 'openai',
      customHeaders: {},
      color: '#6C9EFF',
    })
  }

  const handleSaveGroup = async () => {
    if (!editingGroup) return
    const nameExists = configGroups.some((g) => g.name === editingGroup.name && g.id !== editingGroup.id)
    if (nameExists) { alert('配置名称已存在'); return }
    if (editingGroup.systemPrompt && editingGroup.id) savePromptVersion(editingGroup.id, editingGroup.systemPrompt)
    if (isCreating) { await createConfigGroup(editingGroup) }
    else if (editingGroup.id) { await updateConfigGroup(editingGroup.id, editingGroup) }
    setEditingGroup(null)
    setIsCreating(false)
  }

  const handleTestConnection = async (groupId: string) => {
    const result = await testConnection(groupId)
    setTestResults((prev) => ({ ...prev, [groupId]: result }))
    if (result.success) fetchModels(groupId)
  }

  const handleDeleteGroup = async (id: string) => {
    if (confirm('确定要删除此配置吗？')) await deleteConfigGroup(id)
  }

  const insertVariable = (variable: string) => {
    const editor = promptEditorInstance.current
    if (!editor) return
    const selection = editor.getSelection()
    if (selection) {
      editor.executeEdits('', [{ range: selection, text: ' ' + variable + ' ' }])
      editor.focus()
    }
  }

  const promptLen = editingGroup?.systemPrompt?.length || 0
  const promptTokens = Math.ceil(promptLen / 4)

  // ───────────── RENDER ─────────────
  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="glass-panel rounded-xl shadow-2xl w-[960px] max-w-[95vw] max-h-[88vh] flex flex-col overflow-hidden" style={{ animation: 'fadeIn 0.2s ease-out' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-7 py-5 border-b border-nova-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'rgba(37,99,235,0.15)', color: 'var(--accent)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-nova-text-primary" style={{ letterSpacing: '-0.3px' }}>设置</h2>
          </div>
          <button onClick={closeSettings} className="w-8 h-8 flex items-center justify-center rounded-md text-nova-text-muted hover:text-nova-text-primary hover:bg-nova-hover transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-7 py-1.5 border-b border-nova-border shrink-0" style={{ background: 'var(--bg)' }}>
          {([
            { key: 'api' as const, label: 'API 配置', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg> },
            { key: 'appearance' as const, label: '外观偏好', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg> },
            { key: 'editor' as const, label: '编辑器', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg> },
            { key: 'shortcuts' as const, label: '快捷键', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M8 12h.001M6 16h.001M10 16h.001M14 16h.001" /></svg> },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              className={`flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-md transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'text-nova-accent bg-nova-accent/10'
                  : 'text-nova-text-muted hover:text-nova-text-secondary hover:bg-nova-hover'
              }`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-7 py-6 flex flex-col gap-6">
          {/* ═══════ API 配置 ═══════ */}
          {activeTab === 'api' && (
            <div className="flex flex-col gap-5">
              {editingGroup ? (
                /* ── Edit/Create config ── */
                <div className="flex flex-col gap-5">
                  <div className="flex flex-col gap-3">
                    <h3 className="flex items-center gap-2 text-[13px] font-semibold text-nova-text-primary uppercase tracking-wider">
                      <span style={{ width: 3, height: 14, background: 'var(--accent)', borderRadius: 2 }} />
                      {isCreating ? '新建配置' : '编辑配置'}
                    </h3>
                  </div>

                  {/* Provider selector - grid */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-nova-text-secondary">选择提供商</label>
                    <div className="grid grid-cols-4 gap-2">
                      {PROVIDERS.map((p) => (
                        <button
                          key={p.value}
                          className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all ${
                            editingGroup.provider === p.value
                              ? 'border-nova-accent bg-nova-accent/10 shadow-[0_0_0_1px_var(--accent)]'
                              : 'border-nova-border bg-nova-card hover:border-nova-border-strong'
                          }`}
                          onClick={() => setEditingGroup({ ...editingGroup, provider: p.value as any })}
                        >
                          <div className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold" style={{ background: `${p.color}20`, color: p.color }}>
                            {p.icon}
                          </div>
                          <span className="text-[11px] font-medium text-nova-text-primary">{p.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Basic fields */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-nova-text-secondary">配置名称 <span className="text-red-400">*</span></label>
                      <input type="text" value={editingGroup.name || ''} onChange={(e) => setEditingGroup({ ...editingGroup, name: e.target.value })}
                        className="px-3 py-2 bg-nova-input-bg border border-nova-border rounded-md text-sm text-nova-text-primary outline-none focus:border-nova-accent/50 transition-colors" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-nova-text-secondary">默认模型</label>
                      <input type="text" value={editingGroup.defaultModel || ''} onChange={(e) => setEditingGroup({ ...editingGroup, defaultModel: e.target.value })}
                        className="px-3 py-2 bg-nova-input-bg border border-nova-border rounded-md text-sm text-nova-text-primary outline-none focus:border-nova-accent/50 transition-colors" />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-nova-text-secondary">API 基础 URL <span className="text-red-400">*</span></label>
                    <input type="text" value={editingGroup.baseUrl || ''} onChange={(e) => setEditingGroup({ ...editingGroup, baseUrl: e.target.value })}
                      className="px-3 py-2 bg-nova-input-bg border border-nova-border rounded-md text-sm text-nova-text-primary outline-none focus:border-nova-accent/50 transition-colors font-mono" />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-nova-text-secondary">API 密钥 <span className="text-red-400">*</span></label>
                    <div className="flex gap-1.5">
                      <input type="password" value={editingGroup.apiKey || ''} onChange={(e) => setEditingGroup({ ...editingGroup, apiKey: e.target.value })}
                        className="flex-1 px-3 py-2 bg-nova-input-bg border border-nova-border rounded-md text-sm text-nova-text-primary outline-none focus:border-nova-accent/50 transition-colors font-mono" />
                      <button className="px-3 py-2 text-xs bg-nova-hover text-nova-text-secondary rounded-md hover:text-nova-text-primary transition-colors shrink-0">👁 显示</button>
                    </div>
                    <span className="text-[10px] text-nova-text-muted">支持环境变量：<code className="px-1 py-0.5 bg-nova-hover rounded text-[10px]">$OPENAI_API_KEY</code></span>
                  </div>

                  {/* Color label */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-nova-text-secondary">标识颜色</label>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {CONFIG_COLORS.map((c) => (
                        <button key={c} onClick={() => setEditingGroup({ ...editingGroup, color: c })}
                          className={`w-6 h-6 rounded-full border-2 transition-all hover:scale-110 ${editingGroup.color === c ? 'border-white shadow-[0_0_0_2px_var(--accent)]' : 'border-transparent'}`}
                          style={{ background: c }} />
                      ))}
                    </div>
                  </div>

                  {/* System prompt */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-nova-text-secondary">系统提示词</label>
                      <div className="flex items-center gap-1.5">
                        <select
                          className="px-2 py-1 bg-nova-input-bg border border-nova-border rounded text-[11px] text-nova-text-muted outline-none"
                          onChange={(e) => {
                            const tpl = SYSTEM_PROMPT_TEMPLATES.find((x) => x.id === e.target.value)
                            if (tpl) setEditingGroup({ ...editingGroup, systemPrompt: tpl.prompt })
                            e.target.value = ''
                          }}
                          defaultValue=""
                        >
                          <option value="" disabled>📋 插入模板...</option>
                          {SYSTEM_PROMPT_TEMPLATES.map((tpl) => (
                            <option key={tpl.id} value={tpl.id}>{tpl.label}</option>
                          ))}
                        </select>
                        <button onClick={() => setEditingGroup({ ...editingGroup, systemPrompt: '' })}
                          className="px-2 py-1 text-[10px] rounded bg-nova-hover text-nova-text-muted hover:text-red-400 transition-colors">
                          🔄 重置
                        </button>
                        <button onClick={() => {
                          const blob = new Blob([editingGroup.systemPrompt || ''], { type: 'text/plain' })
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a'); a.href = url; a.download = 'system-prompt.txt'; a.click()
                          URL.revokeObjectURL(url)
                        }} className="px-2 py-1 text-[10px] rounded bg-nova-hover text-nova-text-muted transition-colors">📤 导出</button>
                        <button onClick={() => {
                          const input = document.createElement('input'); input.type = 'file'; input.accept = '.txt,.md'
                          input.onchange = async (e) => {
                            const file = (e.target as HTMLInputElement).files?.[0]
                            if (file) { const text = await file.text(); setEditingGroup({ ...editingGroup, systemPrompt: text }) }
                          }
                          input.click()
                        }} className="px-2 py-1 text-[10px] rounded bg-nova-hover text-nova-text-muted transition-colors">📥 导入</button>
                        {editingGroup.id && (
                          <button onClick={() => setShowPromptHistory(!showPromptHistory)}
                            className="px-2 py-1 text-[10px] rounded bg-nova-hover text-nova-text-muted transition-colors">
                            📜 历史 ({getPromptHistory(editingGroup.id).length})
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Monaco editor */}
                    <div className="border border-nova-border rounded-lg overflow-hidden bg-nova-input-bg">
                      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-nova-border bg-nova-card">
                        <span className="text-[10px] text-nova-text-muted">Markdown</span>
                        <span className={`text-[10px] ${promptLen > 4000 ? 'text-yellow-400' : 'text-nova-text-muted'}`}>
                          {promptLen} 字符 · ~{promptTokens} tokens
                        </span>
                      </div>
                      <div ref={promptEditorRef} style={{ height: 130 }} />
                    </div>

                    {/* Variable chips */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {PROMPT_VARS.map((v) => (
                        <button
                          key={v}
                          onClick={() => insertVariable(v)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-full bg-nova-hover text-nova-text-secondary hover:text-nova-accent hover:bg-nova-accent/10 border border-transparent hover:border-nova-accent/30 transition-all cursor-pointer"
                        >
                          {v}
                        </button>
                      ))}
                      <span className="text-[10px] text-nova-text-muted ml-auto">点击变量插入到提示词中</span>
                    </div>

                    {/* Prompt history */}
                    {showPromptHistory && editingGroup.id && (
                      <div className="p-2 bg-nova-surface rounded-lg border border-nova-border max-h-[120px] overflow-y-auto">
                        {getPromptHistory(editingGroup.id).length === 0 ? (
                          <div className="text-[10px] text-nova-text-muted py-2 text-center">暂无历史版本</div>
                        ) : (
                          getPromptHistory(editingGroup.id).map((v, i) => (
                            <div key={v.timestamp}
                              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-nova-hover cursor-pointer"
                              onClick={() => { restorePromptVersion(editingGroup.id!, i); setEditingGroup({ ...editingGroup, systemPrompt: v.content }) }}>
                              <span className="text-[10px] text-nova-text-muted shrink-0">{new Date(v.timestamp).toLocaleDateString()}</span>
                              <span className="text-[10px] text-nova-text-secondary truncate flex-1">{v.content.slice(0, 60)}...</span>
                              <span className="text-[10px] text-nova-accent">恢复</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* Custom headers */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-nova-text-secondary">自定义请求头</label>
                    <textarea
                      value={JSON.stringify(editingGroup.customHeaders || {}, null, 2)}
                      onChange={(e) => { try { setEditingGroup({ ...editingGroup, customHeaders: JSON.parse(e.target.value) }) } catch { /* ignore */ } }}
                      className="px-3 py-2 bg-nova-input-bg border border-nova-border rounded-md text-xs text-nova-text-primary outline-none focus:border-nova-accent/50 resize-none font-mono"
                      rows={2}
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end gap-2 pt-2 border-t border-nova-border">
                    <button onClick={() => { setEditingGroup(null); setIsCreating(false) }}
                      className="px-4 py-2 text-sm bg-nova-hover text-nova-text-secondary rounded-lg hover:text-nova-text-primary transition-colors">取消</button>
                    <button onClick={() => { handleTestConnection(activeConfigGroupId || ''); }}
                      className="px-4 py-2 text-sm bg-nova-hover text-nova-text-secondary rounded-lg hover:text-nova-text-primary transition-colors">🧪 测试连接</button>
                    <button onClick={handleSaveGroup}
                      className="px-4 py-2 text-sm bg-nova-accent text-white rounded-lg hover:opacity-90 transition-opacity">💾 保存配置</button>
                  </div>
                </div>
              ) : (
                /* ── Config list (cards) ── */
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-nova-text-primary uppercase tracking-wider">
                        <span style={{ width: 3, height: 14, background: 'var(--accent)', borderRadius: 2 }} />
                        API 配置组
                      </h3>
                      <p className="text-xs text-nova-text-muted mt-1.5">管理你的 LLM 提供商连接，支持多个配置组随时切换</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={async () => {
                        const { importConfigGroups } = useConfigStore.getState()
                        const input = document.createElement('input'); input.type = 'file'; input.accept = '.json'
                        input.onchange = async (e) => {
                          const file = (e.target as HTMLInputElement).files?.[0]
                          if (!file) return
                          const text = await file.text()
                          const password = prompt('输入导入密码（无密码请留空）')
                          await importConfigGroups(text, password || undefined)
                          loadConfigGroups()
                        }
                        input.click()
                      }} className="px-3 py-1.5 text-xs bg-nova-hover text-nova-text-secondary rounded-lg hover:text-nova-text-primary transition-colors flex items-center gap-1">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        导入
                      </button>
                      <button onClick={async () => {
                        const { exportConfigGroups } = useConfigStore.getState()
                        const password = prompt('设置导出密码（无密码请留空）')
                        const data = await exportConfigGroups(password || undefined)
                        const blob = new Blob([data], { type: 'application/json' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a'); a.href = url; a.download = `ourcode-configs-${Date.now()}.json`; a.click()
                        URL.revokeObjectURL(url)
                      }} className="px-3 py-1.5 text-xs bg-nova-hover text-nova-text-secondary rounded-lg hover:text-nova-text-primary transition-colors flex items-center gap-1">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        导出
                      </button>
                      <button onClick={handleCreateGroup}
                        className="px-3 py-1.5 text-xs bg-nova-accent text-white rounded-lg hover:opacity-90 transition-opacity flex items-center gap-1">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        新建配置
                      </button>
                    </div>
                  </div>

                  {configGroups.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-12 text-center">
                      <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'rgba(37,99,235,0.12)', color: 'var(--accent)' }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                      </div>
                      <div className="text-sm font-semibold">还没有 API 配置</div>
                      <div className="text-xs text-nova-text-muted max-w-[300px]">添加一个 LLM 提供商配置，开始使用 AI 功能。支持 OpenAI、Anthropic、DeepSeek 等主流平台。</div>
                      <button onClick={handleCreateGroup} className="px-4 py-2 text-sm bg-nova-accent text-white rounded-lg hover:opacity-90 transition-opacity">新建配置</button>
                    </div>
                  ) : (
                    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}>
                      {configGroups.map((group) => {
                        const isActive = group.id === activeConfigGroupId
                        const testResult = testResults[group.id]
                        const modelCount = models.length || 0
                        return (
                          <div
                            key={group.id}
                            className={`relative p-4 rounded-xl border transition-all cursor-pointer overflow-hidden ${
                              isActive
                                ? 'border-nova-accent shadow-[0_0_0_1px_var(--accent),0_0_20px_rgba(37,99,235,0.12)]'
                                : 'border-nova-border bg-nova-card hover:border-nova-border-strong hover:shadow-md'
                            }`}
                            onClick={() => { setEditingGroup(group); setIsCreating(false) }}
                          >
                            {isActive && (
                              <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: 'linear-gradient(90deg, var(--accent), #8b5cf6)' }} />
                            )}
                            <div className="flex items-center gap-2.5 mb-2.5">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: group.color || '#6C9EFF' }} />
                              <span className="text-sm font-semibold text-nova-text-primary">{group.name}</span>
                              {isActive && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-nova-accent/15 text-nova-accent">使用中</span>
                              )}
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-nova-hover text-nova-text-muted">{group.provider}</span>
                              {group.apiKey.startsWith('$') && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">免费</span>
                              )}
                            </div>
                            <div className="text-[11px] text-nova-text-muted font-mono truncate mb-1.5">{group.baseUrl}</div>
                            <div className="text-[11px] text-nova-text-secondary font-mono">
                              {showApiKey[group.id]
                                ? group.apiKey
                                : group.apiKey && group.apiKey.length > 8
                                  ? `${group.apiKey.slice(0, 4)}...${group.apiKey.slice(-4)}`
                                  : group.apiKey || '无需密钥'}
                            </div>
                            <div className="flex items-center gap-1.5 mt-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-400" style={{ boxShadow: '0 0 6px rgba(34,197,94,0.5)' }} />
                              <span className="text-[11px] text-green-400">连接正常</span>
                              <span className="text-[10px] text-nova-text-muted ml-auto">{modelCount} 个模型</span>
                            </div>
                            {testResult && (
                              <div className={`text-[11px] mt-1 ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
                                {testResult.success ? '✓' : '✗'} {testResult.message}
                              </div>
                            )}
                            <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-nova-border" onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => setActiveConfigGroup(group.id)}
                                className="px-2.5 py-1 text-[10px] rounded-md bg-nova-hover text-nova-text-secondary hover:text-nova-text-primary transition-colors">设为活跃</button>
                              <button onClick={() => { setEditingGroup(group); setIsCreating(false) }}
                                className="px-2.5 py-1 text-[10px] rounded-md bg-nova-hover text-nova-text-secondary hover:text-nova-text-primary transition-colors">编辑</button>
                              <button onClick={() => handleTestConnection(group.id)}
                                className="px-2.5 py-1 text-[10px] rounded-md bg-nova-hover text-nova-text-secondary hover:text-nova-text-primary transition-colors">测试连接</button>
                              <button onClick={() => handleDeleteGroup(group.id)}
                                className="px-2.5 py-1 text-[10px] rounded-md bg-transparent text-nova-text-muted hover:text-red-400 transition-colors ml-auto">删除</button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ═══════ 外观偏好 ═══════ */}
          {activeTab === 'appearance' && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-3">
                <h3 className="flex items-center gap-2 text-[13px] font-semibold text-nova-text-primary uppercase tracking-wider">
                  <span style={{ width: 3, height: 14, background: 'var(--accent)', borderRadius: 2 }} />
                  主题
                </h3>

                {/* Setting rows */}
                <SettingRow label="界面主题" desc="选择深色、浅色或跟随系统" right={
                  <select value={preferences.theme} onChange={(e) => { const th = e.target.value as any; savePreferences({ theme: th }); setTheme(th) }}
                    className="px-3 py-1.5 bg-nova-input-bg border border-nova-border rounded-md text-sm text-nova-text-primary outline-none w-[160px]">
                    <option value="dark">🌙 深色模式</option>
                    <option value="light">☀️ 浅色模式</option>
                    <option value="system">💻 跟随系统</option>
                  </select>
                } />

                <SettingRow label="强调色" desc="修改界面主要强调色" right={
                  <div className="flex items-center gap-1.5">
                    {THEME_COLOR_PRESETS.map((c) => (
                      <button key={c} onClick={() => setThemeColor(c)}
                        className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${themeColor.toLowerCase() === c ? 'border-white shadow-[0_0_0_2px_var(--accent)]' : 'border-transparent'}`}
                        style={{ background: c }} />
                    ))}
                    <input type="color" value={themeColor} onChange={(e) => setThemeColor(e.target.value)}
                      className="w-6 h-6 rounded-full cursor-pointer border-2 border-nova-border p-0 bg-transparent" />
                  </div>
                } />

                <SettingRow label="界面语言" desc="选择界面显示语言" right={
                  <select value={preferences.language} onChange={(e) => savePreferences({ language: e.target.value as any })}
                    className="px-3 py-1.5 bg-nova-input-bg border border-nova-border rounded-md text-sm text-nova-text-primary outline-none w-[160px]">
                    <option value="zh-CN">🇨🇳 简体中文</option>
                    <option value="en-US">🇺🇸 English</option>
                    <option value="system">💻 跟随系统</option>
                  </select>
                } />
              </div>

              <div className="flex flex-col gap-3">
                <h3 className="flex items-center gap-2 text-[13px] font-semibold text-nova-text-primary uppercase tracking-wider">
                  <span style={{ width: 3, height: 14, background: 'var(--accent)', borderRadius: 2 }} />
                  字体
                </h3>

                <SettingRow label="编辑器字号" desc="调整代码编辑器的字体大小" right={
                  <div className="flex items-center gap-2">
                    <input type="range" min={10} max={24} value={preferences.fontSize} onChange={(e) => savePreferences({ fontSize: Number(e.target.value) })}
                      className="w-[120px] accent-nova-accent" />
                    <span className="text-[11px] text-nova-text-muted w-8 text-right">{preferences.fontSize}px</span>
                  </div>
                } />

                <SettingRow label="制表符大小" desc="Tab 键对应的空格数" right={
                  <select value={preferences.tabSize} onChange={(e) => savePreferences({ tabSize: Number(e.target.value) })}
                    className="px-3 py-1.5 bg-nova-input-bg border border-nova-border rounded-md text-sm text-nova-text-primary outline-none w-[120px]">
                    <option value={2}>2 空格</option>
                    <option value={4}>4 空格</option>
                    <option value={8}>8 空格</option>
                  </select>
                } />
              </div>
            </div>
          )}

          {/* ═══════ 编辑器 ═══════ */}
          {activeTab === 'editor' && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-3">
                <h3 className="flex items-center gap-2 text-[13px] font-semibold text-nova-text-primary uppercase tracking-wider">
                  <span style={{ width: 3, height: 14, background: 'var(--accent)', borderRadius: 2 }} />
                  编辑器行为
                </h3>

                <SettingRow label="显示缩略图" desc="在编辑器右侧显示代码缩略导航图" right={
                  <ToggleButton on={preferences.showMinimap} onClick={() => savePreferences({ showMinimap: !preferences.showMinimap })} />
                } />
                <SettingRow label="自动保存" desc="切换文件时自动保存修改" right={
                  <ToggleButton on={preferences.autoSave} onClick={() => savePreferences({ autoSave: !preferences.autoSave })} />
                } />
                <SettingRow label="自动保存" desc="切换文件时自动保存修改" right={
                  <ToggleButton on={preferences.autoSave} onClick={() => savePreferences({ autoSave: !preferences.autoSave })} />
                } />
              </div>

              <div className="flex flex-col gap-3">
                <h3 className="flex items-center gap-2 text-[13px] font-semibold text-nova-text-primary uppercase tracking-wider">
                  <span style={{ width: 3, height: 14, background: 'var(--accent)', borderRadius: 2 }} />
                  文件浏览器
                </h3>

                <SettingRow label="显示隐藏文件" desc="在文件树中显示 . 开头的隐藏文件和文件夹" right={
                  <ToggleButton on={preferences.showHiddenFiles} onClick={() => savePreferences({ showHiddenFiles: !preferences.showHiddenFiles })} />
                } />
              </div>

              <div className="flex flex-col gap-3">
                <h3 className="flex items-center gap-2 text-[13px] font-semibold text-nova-text-primary uppercase tracking-wider">
                  <span style={{ width: 3, height: 14, background: 'var(--accent)', borderRadius: 2 }} />
                  LSP 服务器
                </h3>
                <p className="text-xs text-nova-text-muted">为不同语言配置语言服务器命令，格式：语言ID: 启动命令</p>
                <textarea
                  value={lspServersText}
                  onChange={(e) => setLspServersText(e.target.value)}
                  onBlur={() => {
                    const map: Record<string, string> = {}
                    for (const line of lspServersText.split('\n')) {
                      const idx = line.indexOf(':')
                      if (idx > 0 && line.slice(idx + 1).trim()) map[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
                    }
                    savePreferences({ lspServers: map })
                  }}
                  placeholder="python: pylsp&#10;go: gopls -mode stdio&#10;rust: rust-analyzer"
                  className="w-full h-20 p-3 bg-nova-input-bg border border-nova-border rounded-lg text-xs text-nova-text-primary font-mono resize-none outline-none focus:border-nova-accent/50"
                  spellCheck={false}
                />
              </div>

              {/* Danger zone */}
              <div className="border rounded-xl p-5" style={{ borderColor: 'rgba(244,135,113,0.3)', background: 'rgba(244,135,113,0.04)' }}>
                <h3 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider" style={{ color: 'var(--red)' }}>
                  <span style={{ width: 3, height: 14, background: 'var(--red)', borderRadius: 2 }} />
                  危险操作
                </h3>
                <p className="text-xs text-nova-text-muted mt-1.5 mb-3">重置所有设置、配置和聊天记录。此操作不可撤销。</p>
                <button
                  onClick={() => {
                    if (confirm('确定要重置所有设置吗？此操作不可撤销！')) {
                      if (confirm('再次确认：所有数据将被清空，包括 API 配置、聊天记录和偏好设置。')) {
                        window.electronAPI.resetAll().then(() => {
                          useConfigStore.getState().resetStore()
                          useChatStore.getState().resetStore()
                          localStorage.clear()
                          window.location.reload()
                        })
                      }
                    }
                  }}
                  className="px-4 py-2 text-sm font-medium bg-red-500/15 text-red-400 border border-red-500/25 rounded-lg hover:bg-red-500/25 transition-colors inline-flex items-center gap-1.5"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                  重置所有设置
                </button>
              </div>
            </div>
          )}

          {/* ═══════ 快捷键 ═══════ */}
          {activeTab === 'shortcuts' && (
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-[13px] font-semibold text-nova-text-primary uppercase tracking-wider">
                  <span style={{ width: 3, height: 14, background: 'var(--accent)', borderRadius: 2 }} />
                  键盘快捷方式
                </h3>
                <div className="flex items-center gap-2">
                  <select value={shortcutStore.preset} onChange={(e) => shortcutStore.setPreset(e.target.value as ShortcutPreset)}
                    className="px-3 py-1.5 bg-nova-input-bg border border-nova-border rounded-md text-xs text-nova-text-primary outline-none">
                    <option value="vscode">VS Code 预设</option>
                    <option value="jetbrains">JetBrains 预设</option>
                    <option value="custom">自定义</option>
                  </select>
                  {shortcutStore.preset === 'custom' && (
                    <button onClick={() => shortcutStore.resetToPreset('vscode')}
                      className="px-2 py-1 text-[10px] bg-nova-hover text-nova-text-muted rounded">重置</button>
                  )}
                </div>
              </div>

              {(['file', 'edit', 'view', 'chat', 'ai'] as const).map((category) => {
                const items = shortcutStore.shortcuts.filter((s) => s.category === category)
                if (items.length === 0) return null
                const labels: Record<string, string> = { file: '文件操作', edit: '编辑', view: '视图', chat: 'AI 助手', ai: 'AI 内联' }
                return (
                  <div key={category} className="flex flex-col gap-0.5">
                    <div className="text-[10px] font-semibold text-nova-text-muted uppercase tracking-wider px-3 py-1.5">{labels[category]}</div>
                    {items.map((s) => (
                      <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-nova-hover transition-colors">
                        <span className="text-xs text-nova-text-secondary">{s.description}</span>
                        <kbd
                          className={`px-2 py-0.5 bg-nova-input-bg border border-nova-border rounded text-[10px] font-mono ${shortcutStore.preset === 'custom' ? 'text-nova-accent cursor-pointer' : 'text-nova-text-muted'}`}
                          onClick={() => { if (shortcutStore.preset !== 'custom') return; const k = prompt('输入新快捷键', s.keys); if (k?.trim()) shortcutStore.updateShortcut(s.id, k.trim()) }}
                        >
                          {s.keys}
                        </kbd>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ───────────── Small reusable components ─────────────

function SettingRow({ label, desc, right }: { label: string; desc: string; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-nova-card border border-nova-border rounded-lg gap-4 hover:border-nova-border-strong transition-colors">
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[13px] font-medium text-nova-text-primary">{label}</span>
        <span className="text-[11px] text-nova-text-muted">{desc}</span>
      </div>
      <div className="flex items-center gap-2.5 shrink-0">
        {right}
      </div>
    </div>
  )
}

function ToggleButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-10 h-[22px] rounded-full transition-colors relative shrink-0 border-none cursor-pointer"
      style={{ background: on ? 'var(--accent)' : 'var(--border)' }}
    >
      <div
        className="w-[18px] h-[18px] rounded-full bg-white absolute top-[1px] transition-all"
        style={{ left: on ? '20px' : '1px' }}
      />
    </button>
  )
}
