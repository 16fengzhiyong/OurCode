import { useState, useEffect, useRef } from 'react'
import { useConfigStore } from '@/stores/configStore'
import { useEditorStore } from '@/stores/editorStore'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { useShortcutStore, ShortcutPreset } from '@/stores/shortcutStore'
import { ApiConfigGroup } from '@/types'
import { monaco, OURCODE_DARK_THEME, OURCODE_LIGHT_THEME } from '@/editor/monacoSetup'
import { useI18n } from '@/i18n/useI18n'

// System-prompt template ids are stable (used as the select value and to look
// up the prompt); display names come from the i18n dictionary.
const SYSTEM_PROMPT_TEMPLATES: Array<{ id: 'universal' | 'python' | 'reviewer' | 'frontend' | 'api' | 'doc' | 'bugfix' | 'sql'; prompt: string }> = [
  { id: 'universal', prompt: 'You are a professional programming assistant. Current project uses {{language}}, project name: {{projectName}}.' },
  { id: 'python', prompt: 'You are a senior Python developer. Follow PEP 8, use type hints. Current file: {{currentFile}}' },
  { id: 'reviewer', prompt: 'You are a strict code reviewer. Review code for quality, bugs, performance, and security.' },
  { id: 'frontend', prompt: 'You are a frontend expert in React, TypeScript, CSS. Framework: {{framework}}.' },
  { id: 'api', prompt: 'You are an API design expert. Help design RESTful APIs with proper naming and HTTP methods.' },
  { id: 'doc', prompt: 'You are a technical documentation expert. Project: {{projectName}}, Language: {{language}}' },
  { id: 'bugfix', prompt: 'You are a debugging expert. Analyze errors, identify root causes, provide fixes. File: {{currentFile}}' },
  { id: 'sql', prompt: 'You are a database expert. Help write efficient SQL queries and optimize performance.' },
]

// Accent color presets for the Appearance section (the picker writes the
// --accent / --primary-color CSS variables used by the whole UI)
const THEME_COLOR_PRESETS = ['#2563eb', '#3b82f6', '#007acc', '#7c5cbf', '#e11d48', '#059669']

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

  const [activeTab, setActiveTab] = useState<'api' | 'preferences' | 'shortcuts'>('api')
  const [editingGroup, setEditingGroup] = useState<Partial<ApiConfigGroup> | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({})
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({})
  const [showPromptPreview, setShowPromptPreview] = useState(false)
  const [showPromptHistory, setShowPromptHistory] = useState(false)
  const [dragGroupIndex, setDragGroupIndex] = useState<number | null>(null)
  const [dropGroupIndex, setDropGroupIndex] = useState<number | null>(null)
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

    // Dispose previous instance
    if (promptEditorInstance.current) {
      promptEditorInstance.current.dispose()
    }

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

    return () => {
      editor.dispose()
      promptEditorInstance.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recreate only on group switch; syncing the prompt text is handled by the effect below
  }, [editingGroup?.id, isCreating])

  // Sync external systemPrompt changes (template insert / reset / import / history
  // restore) into the Monaco editor — the init effect only re-runs on group switch.
  useEffect(() => {
    const editor = promptEditorInstance.current
    const prompt = editingGroup?.systemPrompt
    if (!editor || prompt === undefined) return
    if (editor.getValue() !== prompt) {
      editor.setValue(prompt || '')
    }
  }, [editingGroup?.systemPrompt])

  useEffect(() => {
    if (isSettingsOpen) {
      loadConfigGroups()
      useShortcutStore.getState().loadShortcuts()
      // Move focus into the dialog so keyboard users land in it (focus trap
      // basics; Esc closes via the global handler)
      dialogRef.current?.focus()
    }
  }, [isSettingsOpen, loadConfigGroups])

  if (!isSettingsOpen) return null

  const handleCreateGroup = () => {
    setIsCreating(true)
    setEditingGroup({ name: t('settings.configGroup.newDefaultName'), baseUrl: 'https://api.openai.com/v1', apiKey: '', systemPrompt: '', defaultModel: '', provider: 'openai', customHeaders: {} })
  }

  const handleSaveGroup = async () => {
    if (!editingGroup) return
    // Duplicate name check
    const nameExists = configGroups.some((g) =>
      g.name === editingGroup.name && g.id !== editingGroup.id
    )
    if (nameExists) {
      alert(t('settings.configGroup.duplicateName'))
      return
    }
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
    if (confirm(t('settings.configGroups.deleteConfirm'))) await deleteConfigGroup(id)
  }

  const providers = [
    { value: 'openai', label: 'OpenAI' },
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'gemini', label: 'Google Gemini' },
    { value: 'deepseek', label: 'DeepSeek' },
    { value: 'groq', label: 'Groq' },
    { value: 'azure', label: 'Azure OpenAI' },
    { value: 'ollama', label: 'Ollama (Local)' },
    { value: 'custom', label: 'Custom (OpenAI Compatible)' },
  ]

  const configColors = [
    { value: '#6C9EFF', label: 'Blue' },
    { value: '#B77CFF', label: 'Purple' },
    { value: '#4ADE80', label: 'Green' },
    { value: '#FB923C', label: 'Orange' },
    { value: '#F87171', label: 'Red' },
    { value: '#FACC15', label: 'Yellow' },
    { value: '#2DD4BF', label: 'Teal' },
    { value: '#F472B6', label: 'Pink' },
  ]

  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t('settings.dialog')} className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="glass-panel rounded-xl shadow-2xl w-[900px] max-h-[85vh] flex flex-col animate-fade-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-nova-border">
          <h2 className="text-lg font-semibold text-nova-text-primary">{t('settings.title')}</h2>
          <button onClick={closeSettings} className="p-1 text-nova-text-muted hover:text-nova-text-primary rounded transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex border-b border-nova-border px-6">
          {([{ key: 'api', label: t('settings.tab.api') }, { key: 'preferences', label: t('settings.tab.preferences') }, { key: 'shortcuts', label: t('settings.tab.shortcuts') }] as const).map((tab) => (
            <button key={tab.key} className={`px-4 py-3 text-sm transition-colors border-b-2 ${activeTab === tab.key ? 'text-nova-accent border-nova-accent' : 'text-nova-text-secondary border-transparent hover:text-nova-text-primary'}`} onClick={() => setActiveTab(tab.key as any)}>{tab.label}</button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'api' && (
            <div className="space-y-4">
              {editingGroup ? (
                <div className="space-y-4 p-4 bg-nova-bg rounded-lg border border-nova-border">
                  <h3 className="text-sm font-medium text-nova-text-primary">{isCreating ? t('settings.configGroup.new') : t('settings.configGroup.edit')}</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-nova-text-secondary mb-1">{t('settings.configGroup.name')}</label>
                      <input type="text" value={editingGroup.name || ''} onChange={(e) => setEditingGroup({ ...editingGroup, name: e.target.value })} className="w-full px-3 py-2 bg-nova-input-bg border border-nova-border rounded-lg text-sm text-nova-text-primary outline-none focus:border-nova-accent/50" />
                    </div>
                    <div>
                      <label className="block text-xs text-nova-text-secondary mb-1">{t('settings.configGroup.provider')}</label>
                      <select value={editingGroup.provider || 'openai'} onChange={(e) => setEditingGroup({ ...editingGroup, provider: e.target.value as any })} className="w-full px-3 py-2 bg-nova-input-bg border border-nova-border rounded-lg text-sm text-nova-text-primary outline-none focus:border-nova-accent/50">
                        {providers.map((p) => (<option key={p.value} value={p.value}>{p.label}</option>))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-nova-text-secondary mb-1">{t('settings.configGroup.baseUrl')}</label>
                    <input type="text" value={editingGroup.baseUrl || ''} onChange={(e) => setEditingGroup({ ...editingGroup, baseUrl: e.target.value })} className="w-full px-3 py-2 bg-nova-input-bg border border-nova-border rounded-lg text-sm text-nova-text-primary outline-none focus:border-nova-accent/50 font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs text-nova-text-secondary mb-1">{t('settings.configGroup.apiKey')}</label>
                    <input type="password" value={editingGroup.apiKey || ''} onChange={(e) => setEditingGroup({ ...editingGroup, apiKey: e.target.value })} className="w-full px-3 py-2 bg-nova-input-bg border border-nova-border rounded-lg text-sm text-nova-text-primary outline-none focus:border-nova-accent/50 font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs text-nova-text-secondary mb-1">{t('settings.configGroup.defaultModel')}</label>
                    <input type="text" value={editingGroup.defaultModel || ''} onChange={(e) => setEditingGroup({ ...editingGroup, defaultModel: e.target.value })} className="w-full px-3 py-2 bg-nova-input-bg border border-nova-border rounded-lg text-sm text-nova-text-primary outline-none focus:border-nova-accent/50" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-nova-text-secondary">{t('settings.configGroup.systemPrompt')}</label>
                      <select className="px-2 py-0.5 bg-nova-input-bg border border-nova-border rounded text-[10px] text-nova-text-muted outline-none" onChange={(e) => { const tpl = SYSTEM_PROMPT_TEMPLATES.find((x) => x.id === e.target.value); if (tpl) setEditingGroup({ ...editingGroup, systemPrompt: tpl.prompt }); e.target.value = '' }} defaultValue="">
                        <option value="" disabled>{t('settings.configGroup.insertTemplate')}</option>
                        {SYSTEM_PROMPT_TEMPLATES.map((tpl) => (<option key={tpl.id} value={tpl.id}>{t(`settings.template.${tpl.id}`)}</option>))}
                      </select>
                    </div>
                    <div ref={promptEditorRef} className="w-full border border-nova-border rounded-lg overflow-hidden" style={{ height: 140 }} />
                    <div className="flex items-center justify-between mt-1">
                      <div className="text-[10px] text-nova-text-muted flex items-center gap-2">
                        <span>{t('settings.configGroup.vars')} <code className="px-1 py-0.5 bg-nova-hover rounded">{'{{language}}'}</code> <code className="px-1 py-0.5 bg-nova-hover rounded">{'{{framework}}'}</code> <code className="px-1 py-0.5 bg-nova-hover rounded">{'{{projectName}}'}</code> <code className="px-1 py-0.5 bg-nova-hover rounded">{'{{currentFile}}'}</code> <code className="px-1 py-0.5 bg-nova-hover rounded">{'{{gitBranch}}'}</code> <code className="px-1 py-0.5 bg-nova-hover rounded">{'{{date}}'}</code></span>
                        <span className="text-nova-text-muted/60">|</span>
                        <span className={(editingGroup.systemPrompt?.length || 0) > 4000 ? 'text-yellow-400' : ''}>{t('settings.configGroup.charCount', { count: editingGroup.systemPrompt?.length || 0, tokens: Math.ceil((editingGroup.systemPrompt?.length || 0) / 4) })}</span>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => setEditingGroup({ ...editingGroup, systemPrompt: '' })} className="px-2 py-0.5 text-[10px] rounded bg-nova-hover text-nova-text-muted hover:text-red-400" title={t('settings.configGroup.resetTitle')}>{t('settings.configGroup.reset')}</button>
                        <button onClick={() => {
                          const blob = new Blob([editingGroup.systemPrompt || ''], { type: 'text/plain' })
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = `prompt-${editingGroup.name || 'system'}.txt`
                          a.click()
                          URL.revokeObjectURL(url)
                        }} className="px-2 py-0.5 text-[10px] rounded bg-nova-hover text-nova-text-muted" title={t('settings.configGroup.exportTitle')}>{t('settings.configGroup.export')}</button>
                        <button onClick={() => {
                          const input = document.createElement('input')
                          input.type = 'file'
                          input.accept = '.txt,.md'
                          input.onchange = async (e) => {
                            const file = (e.target as HTMLInputElement).files?.[0]
                            if (!file) return
                            const text = await file.text()
                            setEditingGroup({ ...editingGroup, systemPrompt: text })
                          }
                          input.click()
                        }} className="px-2 py-0.5 text-[10px] rounded bg-nova-hover text-nova-text-muted" title={t('settings.configGroup.importTitle')}>{t('settings.configGroup.import')}</button>
                        <button onClick={() => setShowPromptPreview(!showPromptPreview)} className={`px-2 py-0.5 text-[10px] rounded ${showPromptPreview ? 'bg-nova-accent/20 text-nova-accent' : 'bg-nova-hover text-nova-text-muted'}`}>{t('settings.configGroup.preview')}</button>
                        {editingGroup.id && <button onClick={() => setShowPromptHistory(!showPromptHistory)} className="px-2 py-0.5 text-[10px] rounded bg-nova-hover text-nova-text-muted">{t('settings.configGroup.history', { count: getPromptHistory(editingGroup.id).length })}</button>}
                      </div>
                    </div>
                    {showPromptPreview && editingGroup.systemPrompt && (
                      <div className="mt-2 p-3 bg-nova-surface rounded-lg border border-nova-border text-xs text-nova-text-secondary whitespace-pre-wrap">
                        {editingGroup.systemPrompt
                          .replace(/\{\{language\}\}/g, '<TypeScript>')
                          .replace(/\{\{framework\}\}/g, '<React>')
                          .replace(/\{\{projectName\}\}/g, '<MyProject>')
                          .replace(/\{\{currentFile\}\}/g, '<App.tsx>')
                          .replace(/\{\{gitBranch\}\}/g, '<main>')
                          .replace(/\{\{date\}\}/g, `<${new Date().toLocaleDateString()}>`)
                          .split(/(<[^>]+>)/g)
                          .map((part, i) => part.startsWith('<') && part.endsWith('>')
                            ? <span key={i} className="text-nova-accent bg-nova-accent/10 px-0.5 rounded">{part}</span>
                            : <span key={i}>{part}</span>
                          )}
                      </div>
                    )}
                    {showPromptHistory && editingGroup.id && (
                      <div className="mt-2 p-2 bg-nova-surface rounded-lg border border-nova-border max-h-[150px] overflow-y-auto">
                        {getPromptHistory(editingGroup.id).length === 0 ? <div className="text-[10px] text-nova-text-muted py-2 text-center">{t('settings.configGroup.noHistory')}</div> : getPromptHistory(editingGroup.id).map((v, i) => (
                          <div key={v.timestamp} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-nova-hover cursor-pointer" onClick={() => { restorePromptVersion(editingGroup.id!, i); setEditingGroup({ ...editingGroup, systemPrompt: v.content }) }}>
                            <span className="text-[10px] text-nova-text-muted shrink-0">{new Date(v.timestamp).toLocaleDateString()}</span>
                            <span className="text-[10px] text-nova-text-secondary truncate flex-1">{v.content.slice(0, 60)}...</span>
                            <span className="text-[10px] text-nova-accent">{t('settings.configGroup.restore')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs text-nova-text-secondary mb-1">{t('settings.configGroup.colorLabel')}</label>
                    <div className="flex items-center gap-2 flex-wrap">
                      {configColors.map((c) => (<button key={c.value} onClick={() => setEditingGroup({ ...editingGroup, color: c.value })} className={`w-6 h-6 rounded-full border-2 transition-all ${editingGroup.color === c.value ? 'border-white scale-110' : 'border-transparent hover:border-nova-border'}`} style={{ backgroundColor: c.value }} />))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-nova-text-secondary mb-1">{t('settings.configGroup.customHeaders')}</label>
                    <textarea value={JSON.stringify(editingGroup.customHeaders || {}, null, 2)} onChange={(e) => { try { setEditingGroup({ ...editingGroup, customHeaders: JSON.parse(e.target.value) }) } catch { /* invalid JSON */ } }} className="w-full px-3 py-2 bg-nova-input-bg border border-nova-border rounded-lg text-xs text-nova-text-primary outline-none focus:border-nova-accent/50 resize-none font-mono" rows={2} />
                  </div>
                  <div className="text-[10px] text-nova-text-muted">{t('settings.configGroup.envVars')} <code className="px-1 py-0.5 bg-nova-hover rounded">$ENV_VAR_NAME</code></div>
                  <div className="flex justify-end gap-3">
                    <button onClick={() => { setEditingGroup(null); setIsCreating(false) }} className="px-4 py-2 text-sm bg-nova-hover rounded-lg text-nova-text-secondary hover:text-nova-text-primary transition-colors">{t('common.cancel')}</button>
                    <button onClick={handleSaveGroup} className="px-4 py-2 text-sm bg-nova-accent rounded-lg text-white hover:opacity-90 transition-opacity">{t('common.save')}</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-nova-text-primary">{t('settings.configGroups.title')}</h3>
                    <div className="flex items-center gap-2">
                      <button onClick={async () => {
                        const input = document.createElement('input')
                        input.type = 'file'
                        input.accept = '.json'
                        input.onchange = async (e) => {
                          const file = (e.target as HTMLInputElement).files?.[0]
                          if (!file) return
                          const text = await file.text()
                          // Prompt for decryption password
                          const password = prompt(t('settings.configGroups.importPasswordPrompt'))
                          const { importConfigGroups } = useConfigStore.getState()
                          await importConfigGroups(text, password || undefined)
                          loadConfigGroups()
                        }
                        input.click()
                      }} className="px-3 py-1.5 text-xs bg-nova-hover rounded-lg text-nova-text-secondary hover:text-nova-text-primary transition-colors">{t('settings.configGroups.importTitle')}</button>
                      <button onClick={async () => {
                        const password = prompt(t('settings.configGroups.exportPasswordPrompt'))
                        const { exportConfigGroups } = useConfigStore.getState()
                        const data = await exportConfigGroups(password || undefined)
                        const blob = new Blob([data], { type: 'application/json' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `ourcode-configs-${Date.now()}.json`
                        a.click()
                        URL.revokeObjectURL(url)
                      }} className="px-3 py-1.5 text-xs bg-nova-hover rounded-lg text-nova-text-secondary hover:text-nova-text-primary transition-colors">{t('settings.configGroups.exportTitle')}</button>
                      <button onClick={handleCreateGroup} className="px-3 py-1.5 text-xs bg-nova-accent rounded-lg text-white hover:opacity-90 transition-opacity">{t('settings.configGroups.new')}</button>
                    </div>
                  </div>
                  {configGroups.length === 0 ? <div className="p-8 text-center text-nova-text-muted text-sm">{t('settings.configGroups.empty')}</div> : (
                    <div className="space-y-2">
                      {configGroups.map((group, index) => {
                        const isActive = group.id === activeConfigGroupId
                        return (
                          <div
                            key={group.id}
                            className={`p-4 rounded-lg border ${isActive ? 'border-nova-accent/50 bg-nova-accent/5' : 'border-nova-border bg-nova-bg'} ${dropGroupIndex === index ? 'ring-2 ring-nova-accent/60' : ''}`}
                            draggable
                            onDragStart={() => setDragGroupIndex(index)}
                            onDragOver={(e) => { e.preventDefault(); setDropGroupIndex(index) }}
                            onDragLeave={() => setDropGroupIndex(null)}
                            onDrop={() => {
                              if (dragGroupIndex !== null && dragGroupIndex !== index) {
                                useConfigStore.getState().reorderConfigGroups(dragGroupIndex, index)
                              }
                              setDragGroupIndex(null)
                              setDropGroupIndex(null)
                            }}
                            onDragEnd={() => { setDragGroupIndex(null); setDropGroupIndex(null) }}
                          >
                            <div className="flex items-start justify-between">
                              {/* Drag handle */}
                              <div className="flex items-center pr-2 pt-1 cursor-grab text-nova-text-muted hover:text-nova-text-secondary" title={t('settings.configGroups.dragHint')}>
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                                  <circle cx="5" cy="3" r="1.5"/><circle cx="11" cy="3" r="1.5"/>
                                  <circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/>
                                  <circle cx="5" cy="13" r="1.5"/><circle cx="11" cy="13" r="1.5"/>
                                </svg>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  {group.color && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: group.color }}></span>}
                                  <span className="text-sm font-medium text-nova-text-primary">{group.name}</span>
                                  <span className="text-[10px] px-1.5 py-0.5 bg-nova-hover rounded text-nova-text-muted">{group.provider}</span>
                                  {isActive && <span className="text-[10px] px-1.5 py-0.5 bg-nova-accent/20 rounded text-nova-accent">{t('settings.configGroups.active')}</span>}
                                </div>
                                <div className="text-xs text-nova-text-muted mt-1 font-mono truncate">{group.baseUrl}</div>
                                <div className="text-xs text-nova-text-muted mt-0.5 flex items-center gap-1">
                                  <span>{t('settings.configGroups.key')} {showApiKey[group.id]
                                    ? group.apiKey
                                    : group.apiKey && group.apiKey.startsWith('$')
                                      ? group.apiKey
                                      : group.apiKey && group.apiKey.length > 8
                                        ? `${group.apiKey.slice(0, 4)}...${group.apiKey.slice(-4)}`
                                        : '********'}</span>
                                  <button onClick={() => setShowApiKey((p) => ({ ...p, [group.id]: !p[group.id] }))} className="text-nova-text-muted hover:text-nova-text-primary">{showApiKey[group.id] ? '🙈' : '👁'}</button>
                                </div>
                                {testResults[group.id] && <div className={`text-xs mt-1 ${testResults[group.id].success ? 'text-green-400' : 'text-red-400'}`}>{testResults[group.id].success ? '✓' : '✗'} {testResults[group.id].message}</div>}
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0 ml-3">
                                <button onClick={() => setActiveConfigGroup(group.id)} className={`px-2.5 py-1 text-xs rounded-md ${isActive ? 'bg-nova-accent/20 text-nova-accent' : 'bg-nova-hover text-nova-text-secondary hover:text-nova-text-primary'}`}>{t('settings.configGroups.use')}</button>
                                <button onClick={() => handleTestConnection(group.id)} className="px-2.5 py-1 text-xs bg-nova-hover rounded-md text-nova-text-secondary hover:text-nova-text-primary">{t('settings.configGroups.test')}</button>
                                <button onClick={() => { setEditingGroup(group); setIsCreating(false) }} className="px-2.5 py-1 text-xs bg-nova-hover rounded-md text-nova-text-secondary hover:text-nova-text-primary">{t('settings.configGroups.edit')}</button>
                                <button onClick={() => handleDeleteGroup(group.id)} className="px-2.5 py-1 text-xs bg-nova-hover rounded-md text-red-400 hover:text-red-300">{t('common.delete')}</button>
                              </div>
                            </div>
                            {isActive && models.length > 0 && (
                              <div className="mt-3 pt-3 border-t border-nova-border">
                                <div className="text-xs text-nova-text-muted mb-1.5">{t('settings.configGroups.models', { count: models.length })}</div>
                                <div className="flex flex-wrap gap-1 max-h-[60px] overflow-y-auto">
                                  {models.slice(0, 20).map((m) => (<span key={m.id} className="text-[10px] px-1.5 py-0.5 bg-nova-hover rounded text-nova-text-secondary">{m.id}{m.isFree && <span className="text-green-400 ml-0.5">{t('settings.configGroups.free')}</span>}</span>))}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'preferences' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-medium text-nova-text-primary mb-3">{t('settings.preferences.appearance')}</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-nova-text-secondary">{t('settings.preferences.theme')}</label>
                    <select value={preferences.theme} onChange={(e) => { const th = e.target.value as 'light' | 'dark' | 'system'; savePreferences({ theme: th }); setTheme(th) }} className="px-3 py-1.5 bg-nova-input-bg border border-nova-border rounded-lg text-sm text-nova-text-primary outline-none">
                      <option value="dark">{t('settings.preferences.themeDark')}</option>
                      <option value="light">{t('settings.preferences.themeLight')}</option>
                      <option value="system">{t('settings.preferences.themeSystem')}</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-nova-text-secondary">{t('settings.preferences.language')}</label>
                    <select
                      value={preferences.language}
                      onChange={(e) => savePreferences({ language: e.target.value as 'zh-CN' | 'en-US' | 'system' })}
                      className="px-3 py-1.5 bg-nova-input-bg border border-nova-border rounded-lg text-sm text-nova-text-primary outline-none"
                    >
                      <option value="system">{t('settings.preferences.languageSystem')}</option>
                      <option value="zh-CN">{t('settings.preferences.languageZh')}</option>
                      <option value="en-US">{t('settings.preferences.languageEn')}</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-nova-text-secondary">{t('settings.preferences.accentColor')}</label>
                    <div className="flex items-center gap-1.5">
                      {THEME_COLOR_PRESETS.map((c) => (
                        <button
                          key={c}
                          onClick={() => setThemeColor(c)}
                          className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${themeColor.toLowerCase() === c ? 'border-white' : 'border-transparent'}`}
                          style={{ background: c }}
                          title={c}
                        />
                      ))}
                      <input
                        type="color"
                        value={themeColor}
                        onChange={(e) => setThemeColor(e.target.value)}
                        className="w-6 h-6 rounded cursor-pointer border-none bg-transparent p-0"
                        title={t('settings.preferences.customColor')}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-nova-text-secondary">{t('settings.preferences.fontSize')}</label>
                    <div className="flex items-center gap-2">
                      <input type="range" min={10} max={24} value={preferences.fontSize} onChange={(e) => savePreferences({ fontSize: Number(e.target.value) })} className="w-32" />
                      <span className="text-xs text-nova-text-muted w-8 text-right">{preferences.fontSize}px</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-nova-text-secondary">{t('settings.preferences.tabSize')}</label>
                    <select value={preferences.tabSize} onChange={(e) => savePreferences({ tabSize: Number(e.target.value) })} className="px-3 py-1.5 bg-nova-input-bg border border-nova-border rounded-lg text-sm text-nova-text-primary outline-none">
                      <option value={2}>{t('settings.preferences.spaces', { count: 2 })}</option>
                      <option value={4}>{t('settings.preferences.spaces', { count: 4 })}</option>
                      <option value={8}>{t('settings.preferences.spaces', { count: 8 })}</option>
                    </select>
                  </div>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-nova-text-primary mb-3">{t('settings.preferences.editor')}</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-nova-text-secondary">{t('settings.preferences.minimap')}</label>
                    <button onClick={() => savePreferences({ showMinimap: !preferences.showMinimap })} className={`w-10 h-5 rounded-full transition-colors ${preferences.showMinimap ? 'bg-nova-accent' : 'bg-nova-border'}`}><div className={`w-4 h-4 rounded-full bg-white transition-transform ${preferences.showMinimap ? 'translate-x-5' : 'translate-x-0.5'}`} /></button>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-nova-text-secondary">{t('settings.preferences.autoSave')}</label>
                    <button onClick={() => savePreferences({ autoSave: !preferences.autoSave })} className={`w-10 h-5 rounded-full transition-colors ${preferences.autoSave ? 'bg-nova-accent' : 'bg-nova-border'}`}><div className={`w-4 h-4 rounded-full bg-white transition-transform ${preferences.autoSave ? 'translate-x-5' : 'translate-x-0.5'}`} /></button>
                  </div>
                  <div>
                    <label className="text-sm text-nova-text-secondary block mb-1.5">{t('settings.preferences.lspServers')}</label>
                    <textarea
                      value={lspServersText}
                      onChange={(e) => setLspServersText(e.target.value)}
                      onBlur={() => {
                        const map: Record<string, string> = {}
                        for (const line of lspServersText.split('\n')) {
                          const idx = line.indexOf(':')
                          if (idx > 0 && line.slice(idx + 1).trim()) {
                            map[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
                          }
                        }
                        savePreferences({ lspServers: map })
                      }}
                      placeholder={'python: pylsp\ngo: gopls -mode stdio\nrust: rust-analyzer'}
                      spellCheck={false}
                      className="w-full h-20 p-2 bg-nova-bg border border-nova-border rounded-lg text-xs text-nova-text-primary font-mono resize-none placeholder-nova-text-muted focus:outline-none focus:border-nova-accent/50"
                    />
                    <p className="text-[10px] text-nova-text-muted mt-1">{t('settings.preferences.lspHint')}</p>
                  </div>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-nova-text-primary mb-3">{t('settings.preferences.fileExplorer')}</h3>
                <div className="flex items-center justify-between">
                  <label className="text-sm text-nova-text-secondary">{t('settings.preferences.showHiddenFiles')}</label>
                  <button onClick={() => savePreferences({ showHiddenFiles: !preferences.showHiddenFiles })} className={`w-10 h-5 rounded-full transition-colors ${preferences.showHiddenFiles ? 'bg-nova-accent' : 'bg-nova-border'}`}><div className={`w-4 h-4 rounded-full bg-white transition-transform ${preferences.showHiddenFiles ? 'translate-x-5' : 'translate-x-0.5'}`} /></button>
                </div>
              </div>

              {/* Reset */}
              <div className="border-t border-nova-border pt-4 mt-4">
                <h3 className="text-sm font-medium text-red-400 mb-2">{t('settings.preferences.dangerZone')}</h3>
                <p className="text-xs text-nova-text-muted mb-3">
                  {t('settings.preferences.dangerZoneDesc')}
                </p>
                <button
                  onClick={() => {
                    if (confirm(t('settings.preferences.resetConfirm'))) {
                      if (confirm(t('settings.preferences.resetFinalConfirm'))) {
                        window.electronAPI.resetAll().then(() => {
                          useConfigStore.getState().resetStore()
                          useChatStore.getState().resetStore()
                          localStorage.clear()
                          window.location.reload()
                        })
                      }
                    }
                  }}
                  className="px-4 py-2 text-sm font-medium bg-red-600/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-600/30 transition-colors"
                >
                  {t('settings.preferences.resetAll')}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'shortcuts' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-nova-text-primary">{t('settings.shortcuts.title')}</h3>
                <div className="flex items-center gap-2">
                  <select value={shortcutStore.preset} onChange={(e) => shortcutStore.setPreset(e.target.value as ShortcutPreset)} className="px-3 py-1.5 bg-nova-input-bg border border-nova-border rounded-lg text-xs text-nova-text-primary outline-none">
                    <option value="vscode">{t('settings.shortcuts.presetVscode')}</option>
                    <option value="jetbrains">{t('settings.shortcuts.presetJetbrains')}</option>
                    <option value="custom">{t('settings.shortcuts.presetCustom')}</option>
                  </select>
                  {shortcutStore.preset === 'custom' && <button onClick={() => shortcutStore.resetToPreset('vscode')} className="px-2 py-1 text-[10px] bg-nova-hover text-nova-text-muted rounded">{t('settings.shortcuts.reset')}</button>}
                </div>
              </div>
              {(['file', 'edit', 'view', 'chat', 'ai'] as const).map((category) => {
                const items = shortcutStore.shortcuts.filter((s) => s.category === category)
                if (items.length === 0) return null
                const labels: Record<string, string> = {
                  file: t('settings.shortcuts.catFile'),
                  edit: t('settings.shortcuts.catEdit'),
                  view: t('settings.shortcuts.catView'),
                  chat: t('settings.shortcuts.catChat'),
                  ai: t('settings.shortcuts.catAi'),
                }
                return (
                  <div key={category}>
                    <h4 className="text-xs font-semibold text-nova-text-muted uppercase mb-1.5">{labels[category]}</h4>
                    <div className="space-y-0.5">
                      {items.map((s) => (
                        <div key={s.id} className="flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-nova-hover">
                          <span className="text-xs text-nova-text-secondary">{s.description}</span>
                          <kbd className={`px-2 py-0.5 bg-nova-bg border border-nova-border rounded text-[10px] font-mono ${shortcutStore.preset === 'custom' ? 'text-nova-accent cursor-pointer' : 'text-nova-text-muted'}`} onClick={() => { if (shortcutStore.preset !== 'custom') return; const k = prompt(t('settings.shortcuts.newShortcut'), s.keys); if (k?.trim()) shortcutStore.updateShortcut(s.id, k.trim()) }}>{s.keys}</kbd>
                        </div>
                      ))}
                    </div>
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
