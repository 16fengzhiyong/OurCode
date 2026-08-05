import { useState } from 'react'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useChatStore } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'

/**
 * Workflows — reusable prompt templates (Windsurf-style). Create once, run
 * against the current workspace anytime. The prompt is sent to the active chat
 * session like a normal message.
 */
export default function WorkflowModal({ onClose }: { onClose: () => void }) {
  const { workflows, addWorkflow, deleteWorkflow } = useWorkflowStore()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    if (!prompt.trim()) return
    await addWorkflow({
      name: name.trim() || '未命名工作流',
      description: description.trim(),
      prompt: prompt.trim(),
    })
    setName('')
    setDescription('')
    setPrompt('')
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleRun = async (p: string) => {
    const chatStore = useChatStore.getState()
    if (!chatStore.activeSessionId) {
      const configStore = useConfigStore.getState()
      if (configStore.activeConfigGroupId) {
        chatStore.createSession(configStore.activeConfigGroupId)
      } else {
        alert('请先配置 API 密钥')
        return
      }
    }
    await chatStore.sendMessage(p)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="w-[640px] max-w-[92vw] max-h-[82vh] flex flex-col rounded-2xl bg-nova-surface border border-nova-border shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-nova-border">
          <div className="flex items-center gap-2">
            <span className="text-lg">🔁</span>
            <strong className="text-sm text-nova-text-primary">工作流管理</strong>
            <span className="text-[10px] text-nova-text-muted">可复用的 prompt 模板</span>
          </div>
          <button onClick={onClose} className="text-nova-text-muted hover:text-nova-text-primary transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {workflows.length === 0 ? (
            <div className="text-center text-nova-text-muted text-sm py-8">
              还没有工作流。把常用的多步任务 prompt 保存成模板，随时一键运行。
            </div>
          ) : (
            workflows.map((w) => (
              <div
                key={w.id}
                className="flex items-start gap-2 rounded-lg border border-nova-border bg-nova-hover/40 px-3 py-2 group"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-nova-text-primary">{w.name}</div>
                  {w.description && <div className="text-[11px] text-nova-text-muted truncate">{w.description}</div>}
                  <pre className="text-[11px] text-nova-text-secondary whitespace-pre-wrap break-all max-h-16 overflow-hidden mt-1 opacity-80">{w.prompt}</pre>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleRun(w.prompt)}
                    className="px-3 py-1 text-xs text-white rounded hover:opacity-90 transition-opacity"
                    style={{ background: 'linear-gradient(135deg, #533483, #007acc)' }}
                  >
                    ▶ 运行
                  </button>
                  <button
                    onClick={() => deleteWorkflow(w.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-nova-text-muted hover:text-red-400 transition-all"
                    title="删除工作流"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="px-5 py-4 border-t border-nova-border space-y-2">
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="工作流名称（可选）"
              className="flex-1 px-3 py-1.5 text-xs bg-nova-bg border border-nova-border rounded-lg outline-none focus:border-nova-accent/60 text-nova-text-primary placeholder:text-nova-text-muted"
            />
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="描述（可选）"
              className="flex-1 px-3 py-1.5 text-xs bg-nova-bg border border-nova-border rounded-lg outline-none focus:border-nova-accent/60 text-nova-text-primary placeholder:text-nova-text-muted"
            />
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="prompt 模板，例如：请为当前项目编写 README.md，包含功能清单、架构说明和快速开始…"
            rows={2}
            className="w-full px-3 py-2 text-sm bg-nova-bg border border-nova-border rounded-lg outline-none focus:border-nova-accent/60 text-nova-text-primary placeholder:text-nova-text-muted resize-none"
          />
          <div className="flex items-center justify-end gap-2">
            {saved && <span className="text-xs text-green-400">已保存</span>}
            <button
              onClick={handleSave}
              disabled={!prompt.trim()}
              className="px-4 py-1.5 text-xs text-white rounded-lg disabled:opacity-30 hover:opacity-90 transition-opacity"
              style={{ background: 'linear-gradient(135deg, #533483, #007acc)' }}
            >
              保存工作流
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
