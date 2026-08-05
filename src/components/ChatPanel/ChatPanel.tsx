import { useState } from 'react'
import ChatMessages from './ChatMessages'
import ChatInput from './ChatInput'
import HistoryEditor from './HistoryEditor'
import ChatSidebar from './ChatSidebar'
import MemoryModal from './MemoryModal'
import { useChatStore } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'
import { useUIStore } from '@/stores/uiStore'

export default function ChatPanel() {
  const activeSession = useChatStore((s) => s.getActiveSession())
  const createSession = useChatStore((s) => s.createSession)
  const { activeConfigGroupId, configGroups } = useConfigStore()
  const { openSettings } = useUIStore()
  const [showHistory, setShowHistory] = useState(true)
  const [showSessionList, setShowSessionList] = useState(false)
  const [showMemories, setShowMemories] = useState(false)

  const handleNewSession = () => {
    if (activeConfigGroupId) {
      createSession(activeConfigGroupId)
    } else {
      openSettings()
    }
  }

  const currentModel = activeSession?.model || '未选择模型'

  return (
    <div className="h-full flex" style={{ background: '#1a1a2e' }}>
      {/* Session sidebar (collapsible) */}
      {showSessionList && (
        <ChatSidebar onClose={() => setShowSessionList(false)} />
      )}

      {/* Memory manager */}
      {showMemories && <MemoryModal onClose={() => setShowMemories(false)} />}

      <div className="flex-1 flex flex-col min-w-0">
        {/* AI Header */}
        <div className="px-4 py-3 border-b shrink-0" style={{ background: '#16213e', borderColor: '#0f3460' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSessionList(!showSessionList)}
                className="p-1 rounded hover:bg-nova-hover transition-colors text-nova-text-muted hover:text-nova-text-primary"
                title="会话列表"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h7" />
                </svg>
              </button>
              <div
                className="w-7 h-7 rounded-md flex items-center justify-center text-sm shrink-0"
                style={{ background: 'linear-gradient(135deg, #7c5cbf, #007acc)', boxShadow: '0 2px 8px #7c5cbf44' }}
              >
                <span style={{ color: '#fff', fontSize: 14 }}>✦</span>
              </div>
              <div>
                <strong className="text-nova-text-primary text-sm block">星云 AI 助手</strong>
                <span className="text-[10px] text-nova-text-muted">NebulaCode Copilot · 已连接</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowMemories(true)}
                className="p-1.5 rounded text-nova-text-muted hover:text-nova-text-primary transition-colors"
                title="记忆管理"
              >
                <span className="text-sm">🧠</span>
              </button>
              <button
                onClick={handleNewSession}
                className="p-1.5 rounded text-nova-text-muted hover:text-nova-text-primary transition-colors"
                title="新建对话"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
              <button
                onClick={openSettings}
                className="p-1.5 rounded text-nova-text-muted hover:text-nova-text-primary transition-colors"
                title="设置"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                </svg>
              </button>
            </div>
          </div>
          {/* Config row */}
          <div className="flex items-center gap-2 mt-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
            <select
              className="text-[11px] bg-nova-input-bg text-nova-text-primary border border-nova-border rounded px-1.5 py-0.5 outline-none"
              defaultValue={activeConfigGroupId || ''}
            >
              {configGroups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <select
              className="text-[11px] bg-nova-input-bg text-nova-text-primary border border-nova-border rounded px-1.5 py-0.5 outline-none flex-1"
              defaultValue={currentModel}
            >
              <option value={currentModel}>{currentModel}</option>
            </select>
          </div>
        </div>

        {/* Chat Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {activeSession ? (
            <>
              <ChatMessages />
              <ChatInput />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-4">
              <div className="text-center">
                <div
                  className="text-4xl mb-3 font-bold"
                  style={{
                    background: 'linear-gradient(135deg, #533483, #007acc)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  星云 AI 助手
                </div>
                <div className="text-sm text-nova-text-muted mb-2">
                  AI 编程助手
                </div>
                <div className="text-xs text-nova-text-muted mb-6 max-w-xs mx-auto">
                  我可以帮你重构代码、生成单元测试、解释项目、修复 Bug，还可以使用 @ 引用文件作为上下文
                </div>
                <button
                  onClick={handleNewSession}
                  className="px-6 py-2.5 text-white rounded-full text-sm hover:opacity-90 transition-opacity shadow-lg"
                  style={{ background: 'linear-gradient(135deg, #533483, #007acc)' }}
                >
                  开始新对话
                </button>
                {!activeConfigGroupId && (
                  <button
                    onClick={openSettings}
                    className="block mx-auto mt-3 text-xs text-nova-accent hover:underline"
                  >
                    请先配置 API 密钥
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* History Editor */}
        {activeSession && activeSession.messages.length > 0 && (
          <HistoryEditor
            sessionId={activeSession.id}
            isExpanded={showHistory}
            onToggle={() => setShowHistory(!showHistory)}
          />
        )}
      </div>
    </div>
  )
}
