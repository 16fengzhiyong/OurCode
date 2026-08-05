import { create } from 'zustand'
import { ChatSession, ChatMessage, ChatBranch, ModelParams, LLMToolCall, DEFAULT_MODEL_PARAMS } from '@/types'
import { useConfigStore } from './configStore'
import { useEditorStore } from './editorStore'
import { getFileContent } from '@/editor/modelRegistry'
import { sendLLMRequest } from '@/services/llm/LLMClient'
import { ToolExecutor } from '@/services/tools'
import { ToolCall, ToolResult } from '@/services/tools/types'
import { v4 as uuidv4 } from 'uuid'

// Cached git branch (refreshed via refreshGitBranch)
let _cachedGitBranch = ''
let _gitBranchFetchedAt = 0

export async function refreshGitBranch(): Promise<void> {
  const rootPath = document.getElementById('file-tree-root')?.getAttribute('data-root-path')
  if (!rootPath) return
  try {
    const res = await (window as any).electronAPI?.gitExec(rootPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
    if (res?.success) {
      _cachedGitBranch = res.output.trim()
      _gitBranchFetchedAt = Date.now()
    }
  } catch { /* ignore */ }
}

// Auto-refresh git branch every 30s when module is active
let _gitBranchInterval: ReturnType<typeof setInterval> | null = null
_gitBranchInterval = setInterval(() => { if (Date.now() - _gitBranchFetchedAt > 30000) refreshGitBranch() }, 30000)

/** Stop git branch polling (for cleanup) */
export function stopGitBranchPolling(): void {
  if (_gitBranchInterval) {
    clearInterval(_gitBranchInterval)
    _gitBranchInterval = null
  }
}

/** Build enhanced system prompt with workspace context */
function buildEnhancedSystemPrompt(basePrompt: string): string {
  const rootPath = document.getElementById('file-tree-root')?.getAttribute('data-root-path') || ''
  const editorState = useEditorStore.getState()
  const activeFile = editorState.openFiles.find((f) => f.path === editorState.activeFilePath)

  let enhanced = basePrompt

  // Resolve template variables
  const currentFileName = activeFile?.path.split(/[/\\]/).pop() || ''
  const fileExt = currentFileName.split('.').pop() || ''
  const languageMap: Record<string, string> = {
    js: 'JavaScript', jsx: 'JavaScript (React)', ts: 'TypeScript', tsx: 'TypeScript (React)',
    py: 'Python', rb: 'Ruby', java: 'Java', go: 'Go', rs: 'Rust', c: 'C', cpp: 'C++',
    cs: 'C#', php: 'PHP', swift: 'Swift', kt: 'Kotlin', html: 'HTML', css: 'CSS',
    scss: 'SCSS', json: 'JSON', yaml: 'YAML', md: 'Markdown', sql: 'SQL', sh: 'Shell',
  }
  const language = languageMap[fileExt] || fileExt || '未知'
  const projectName = rootPath.split(/[/\\]/).pop() || '未知项目'
  const frameworkMap: Record<string, string> = { tsx: 'React', jsx: 'React', vue: 'Vue', svelte: 'Svelte' }
  const framework = frameworkMap[fileExt] || '未知框架'

  enhanced = enhanced
    .replace(/\{\{language\}\}/g, language)
    .replace(/\{\{framework\}\}/g, framework)
    .replace(/\{\{projectName\}\}/g, projectName)
    .replace(/\{\{currentFile\}\}/g, currentFileName || '无')
    .replace(/\{\{gitBranch\}\}/g, _cachedGitBranch || '(未检测到Git分支)')
    .replace(/\{\{date\}\}/g, new Date().toLocaleDateString())

  // Append environment context
  enhanced += `\n\n<environment>
工作区路径: ${rootPath}
平台: ${navigator.platform}
当前日期: ${new Date().toLocaleDateString()}
Git 分支: ${_cachedGitBranch || '未知'}
</environment>`

  // Append open files context
  if (editorState.openFiles.length > 0) {
    enhanced += `\n\n<open_files>`
    for (const file of editorState.openFiles) {
      enhanced += `\n- ${file.path}${file.isDirty ? ' (未保存)' : ''}`
    }
    enhanced += `\n</open_files>`
  }

  // Append current file content (live from the editor model, so edits made since
  // the file was opened are included)
  if (activeFile) {
    const liveContent = getFileContent(activeFile.path, activeFile.content)
    const lines = liveContent.split('\n')
    const truncated = lines.length > 200
    const content = truncated ? lines.slice(0, 200).join('\n') + '\n... (truncated)' : liveContent
    enhanced += `\n\n<current_file path="${activeFile.path}">\n${content}\n</current_file>`
  }

  return enhanced
}

// Undo stack for message deletion
interface UndoEntry {
  sessionId: string
  messages: ChatMessage[]
  timestamp: number
}

const UNDO_WINDOW_MS = 5000

/** Re-index sortOrder so messages remain dense (0..n-1) */
function reindexMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m, i) => ({ ...m, sortOrder: i }))
}

interface ChatState {
  sessions: ChatSession[]
  activeSessionId: string | null
  isLoading: boolean
  streamingContent: string
  streamingThinking: string
  abortController: AbortController | null
  undoStack: UndoEntry[]

  // Tool call state
  pendingApproval: { toolCall: ToolCall; preview: string } | null
  approveToolCall: () => void
  rejectToolCall: () => void

  // Session management
  loadSessions: () => Promise<void>
  createSession: (configGroupId: string) => string
  deleteSession: (sessionId: string) => void
  renameSession: (sessionId: string, title: string) => void
  setActiveSession: (sessionId: string) => void
  getActiveSession: () => ChatSession | undefined

  // Message operations
  addMessage: (sessionId: string, msg: Partial<ChatMessage>) => void
  editMessage: (sessionId: string, msgId: string, content: string) => void
  deleteMessage: (sessionId: string, msgId: string) => void
  deleteMessages: (sessionId: string, msgIds: string[]) => void
  undoDelete: () => void
  reorderMessages: (sessionId: string, fromIndex: number, toIndex: number) => void
  clearMessages: (sessionId: string) => void

  // Core functionality
  sendMessage: (content: string, contextFiles?: string[]) => Promise<void>
  regenerateFromMessage: (sessionId: string, msgId: string) => Promise<void>
  stopGeneration: () => void

  // Branch operations
  createBranchFromMessage: (sessionId: string, messageId: string) => void
  switchBranch: (sessionId: string, branchId: string) => void

  // Pin / Archive
  togglePin: (sessionId: string) => void
  toggleArchive: (sessionId: string) => void

  // Import/Export
  exportSession: (sessionId: string, format: 'markdown' | 'json') => string
  importSession: (data: string) => void

  // Persistence
  saveSession: (sessionId: string) => Promise<void>
  updateSessionModel: (sessionId: string, model: string) => void
  updateSessionParams: (sessionId: string, params: Partial<ModelParams>) => void
  resetStore: () => void
}

// Token estimation
function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[一-鿿]/g) || []).length
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length
  const otherChars = text.length - chineseChars
  return Math.ceil(chineseChars * 2 + englishWords * 1.3 + otherChars * 0.5)
}

/**
 * Convert stored (parsed) tool calls back to the raw LLM wire format.
 * ChatMessage.toolCalls is stored as {id, name, arguments(object)} for the UI,
 * but the LLM adapters (OpenAI/Anthropic) expect {id, type, function:{name, arguments(string)}}.
 * Without this conversion, second-turn history rebuilds crash with "Cannot read properties of undefined".
 */
function toRawToolCalls(toolCalls?: ChatMessage['toolCalls']): LLMToolCall[] | undefined {
  if (!toolCalls || toolCalls.length === 0) return undefined
  return toolCalls.map((tc) => ({
    id: tc.id,
    type: 'function' as const,
    function: {
      name: tc.name,
      arguments: JSON.stringify(tc.arguments ?? {}),
    },
  }))
}

// Singleton tool executor
const toolExecutor = new ToolExecutor()

// Pending approval resolve
let _approvalResolve: ((approved: boolean) => void) | null = null

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isLoading: false,
  streamingContent: '',
  streamingThinking: '',
  abortController: null,
  undoStack: [],
  pendingApproval: null,

  approveToolCall: () => {
    const { pendingApproval } = get()
    if (pendingApproval && _approvalResolve) {
      _approvalResolve(true)
      _approvalResolve = null
      set({ pendingApproval: null })
    }
  },

  rejectToolCall: () => {
    const { pendingApproval } = get()
    if (pendingApproval && _approvalResolve) {
      _approvalResolve(false)
      _approvalResolve = null
      set({ pendingApproval: null })
    }
  },

  loadSessions: async () => {
    try {
      const sessions = await window.electronAPI.getSessions()
      set({ sessions })
      if (sessions.length > 0 && !get().activeSessionId) {
        set({ activeSessionId: sessions[0].id })
      }
    } catch (error) {
      console.error('加载会话失败:', error)
    }
  },

  createSession: (configGroupId) => {
    const id = uuidv4()
    const session: ChatSession = {
      id,
      title: '新对话',
      configGroupId,
      model: '',
      modelParams: DEFAULT_MODEL_PARAMS,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    set((s) => ({
      sessions: [session, ...s.sessions],
      activeSessionId: id,
    }))

    window.electronAPI.saveSession(session)

    return id
  },

  deleteSession: (sessionId) => {
    set((s) => {
      const newSessions = s.sessions.filter((sess) => sess.id !== sessionId)
      return {
        sessions: newSessions,
        activeSessionId: s.activeSessionId === sessionId
          ? newSessions[0]?.id || null
          : s.activeSessionId,
      }
    })
    window.electronAPI.deleteSession(sessionId)
  },

  renameSession: (sessionId, title) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, title } : sess
      ),
    }))
    get().saveSession(sessionId)
  },

  setActiveSession: (sessionId) => {
    set({ activeSessionId: sessionId })
  },

  getActiveSession: () => {
    const { sessions, activeSessionId } = get()
    return sessions.find((s) => s.id === activeSessionId)
  },

  addMessage: (sessionId, msg) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    if (!session) return

    const newMessage: ChatMessage = {
      id: msg.id || uuidv4(),
      role: msg.role || 'user',
      content: msg.content || '',
      sortOrder: msg.sortOrder ?? session.messages.length,
      contextFiles: msg.contextFiles || [],
      tokenCount: estimateTokens(msg.content || ''),
      thinking: msg.thinking,
      toolCalls: msg.toolCalls,
      toolResults: msg.toolResults,
      createdAt: Date.now(),
    }

    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId
          ? { ...sess, messages: [...sess.messages, newMessage], updatedAt: Date.now() }
          : sess
      ),
    }))
  },

  editMessage: (sessionId, msgId, content) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId
          ? {
              ...sess,
              messages: sess.messages.map((msg) =>
                msg.id === msgId
                  ? { ...msg, content, tokenCount: estimateTokens(content), editedAt: Date.now() }
                  : msg
              ),
              updatedAt: Date.now(),
            }
          : sess
      ),
    }))
    get().saveSession(sessionId)
  },

  deleteMessage: (sessionId, msgId) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    if (!session) return
    const msg = session.messages.find((m) => m.id === msgId)
    if (!msg) return

    const now = Date.now()
    // Prune expired undo entries (only keep deletes from the last 5s)
    const freshUndo = get().undoStack.filter((e) => now - e.timestamp < UNDO_WINDOW_MS)

    set((s) => ({
      undoStack: [...freshUndo.slice(-9), { sessionId, messages: [msg], timestamp: now }],
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId
          ? { ...sess, messages: reindexMessages(sess.messages.filter((m) => m.id !== msgId)), updatedAt: now }
          : sess
      ),
    }))
    get().saveSession(sessionId)
  },

  deleteMessages: (sessionId, msgIds) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    if (!session || msgIds.length === 0) return
    const idSet = new Set(msgIds)
    const deleted = session.messages.filter((m) => idSet.has(m.id))
    if (deleted.length === 0) return

    const now = Date.now()
    // Prune expired undo entries (only keep deletes from the last 5s)
    const freshUndo = get().undoStack.filter((e) => now - e.timestamp < UNDO_WINDOW_MS)

    set((s) => ({
      undoStack: [...freshUndo.slice(-9), { sessionId, messages: deleted, timestamp: now }],
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId
          ? { ...sess, messages: reindexMessages(sess.messages.filter((m) => !idSet.has(m.id))), updatedAt: now }
          : sess
      ),
    }))
    get().saveSession(sessionId)
  },

  undoDelete: () => {
    const { undoStack } = get()
    if (undoStack.length === 0) return

    const entry = undoStack[undoStack.length - 1]
    // Only allow undo within the 5s window (the toast is purely visual otherwise)
    if (Date.now() - entry.timestamp > UNDO_WINDOW_MS) {
      set({ undoStack: undoStack.slice(0, -1) })
      return
    }

    set((s) => ({
      undoStack: s.undoStack.slice(0, -1),
      sessions: s.sessions.map((sess) => {
        if (sess.id !== entry.sessionId) return sess
        // Merge restored messages back in their original order and re-index
        const restoredIds = new Set(entry.messages.map((m) => m.id))
        const existing = sess.messages.filter((m) => !restoredIds.has(m.id))
        const merged = [...existing, ...entry.messages].sort((a, b) => a.sortOrder - b.sortOrder)
        return {
          ...sess,
          messages: reindexMessages(merged),
          updatedAt: Date.now(),
        }
      }),
    }))
    get().saveSession(entry.sessionId)
  },

  reorderMessages: (sessionId, fromIndex, toIndex) => {
    set((s) => ({
      sessions: s.sessions.map((sess) => {
        if (sess.id !== sessionId) return sess
        const messages = [...sess.messages]
        const [moved] = messages.splice(fromIndex, 1)
        messages.splice(toIndex, 0, moved)
        return {
          ...sess,
          messages: messages.map((m, i) => ({ ...m, sortOrder: i })),
          updatedAt: Date.now(),
        }
      }),
    }))
    get().saveSession(sessionId)
  },

  clearMessages: (sessionId) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId
          ? { ...sess, messages: [], updatedAt: Date.now() }
          : sess
      ),
    }))
    get().saveSession(sessionId)
  },

  sendMessage: async (content, contextFiles = []) => {
    const { activeSessionId, sessions } = get()
    const session = sessions.find((s) => s.id === activeSessionId)
    if (!session) return

    const configGroup = useConfigStore.getState().configGroups.find((g) => g.id === session.configGroupId)
    if (!configGroup) return

    // Add user message
    get().addMessage(activeSessionId!, {
      role: 'user',
      content,
      contextFiles,
    })

    // Prepare messages for API
    const currentSession = get().sessions.find((s) => s.id === activeSessionId)
    if (!currentSession) return

    // Build messages array with system prompt
    const baseSystemPrompt = configGroup.systemPrompt || 'You are a helpful AI coding assistant.'
    const systemPrompt = buildEnhancedSystemPrompt(baseSystemPrompt)

    // Add context files to the last user message content
    let userContent = content
    if (contextFiles.length > 0) {
      const contextContent = contextFiles.map((f) => `@file: ${f}`).join('\n')
      userContent = `${contextContent}\n\n${content}`
    }

    const messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; toolCalls?: LLMToolCall[]; toolCallId?: string }> = [
      { role: 'system', content: systemPrompt },
      ...currentSession.messages.slice(0, -1).map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant' | 'tool',
        content: m.content,
        toolCalls: toRawToolCalls(m.toolCalls),
        toolCallId: m.toolCallId,
      })),
      { role: 'user', content: userContent },
    ]

    set({ isLoading: true, streamingContent: '', streamingThinking: '' })

    const abortController = new AbortController()
    set({ abortController })

    try {
      const model = session.model || configGroup.defaultModel
      const toolDefinitions = toolExecutor.getToolDefinitions()

      // Agent Loop
      let maxIterations = 20
      while (maxIterations-- > 0) {
        if (abortController.signal.aborted) break
        const req = {
          model,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
            toolCalls: m.toolCalls,
            toolCallId: m.toolCallId,
          })),
          stream: true,
          temperature: session.modelParams.temperature,
          maxTokens: session.modelParams.maxTokens,
          topP: session.modelParams.topP,
          frequencyPenalty: session.modelParams.frequencyPenalty,
          presencePenalty: session.modelParams.presencePenalty,
          tools: toolDefinitions,
        }

        let fullContent = ''
        let fullThinking = ''
        let toolCalls: any[] = []

        for await (const chunk of sendLLMRequest(req, configGroup)) {
          if (abortController.signal.aborted) break

          if (chunk.thinking) {
            fullThinking += chunk.thinking
            set({ streamingThinking: fullThinking })
          }

          if (chunk.content) {
            fullContent += chunk.content
            set({ streamingContent: fullContent })
          }

          if (chunk.toolCalls) {
            toolCalls = chunk.toolCalls
          }

          if (chunk.done) break
        }

        // No tool calls - we're done
        if (toolCalls.length === 0) {
          get().addMessage(activeSessionId!, {
            role: 'assistant',
            content: fullContent,
            thinking: fullThinking || undefined,
          })
          break
        }

        // Has tool calls - show them and execute
        const parsedToolCalls: ToolCall[] = toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments || '{}'),
        }))

        // Add assistant message with tool calls
        get().addMessage(activeSessionId!, {
          role: 'assistant',
          content: fullContent,
          thinking: fullThinking || undefined,
          toolCalls: parsedToolCalls,
        })

        // Add assistant message to messages array for next iteration
        messages.push({
          role: 'assistant',
          content: fullContent,
          toolCalls: toolCalls,
          toolCallId: undefined,
        })

        // Execute each tool call
        for (const tc of parsedToolCalls) {
          if (abortController.signal.aborted) break

          // Check if tool requires approval
          if (toolExecutor.requiresApproval(tc.name)) {
            const preview = toolExecutor.getPreview(tc)
            set({ pendingApproval: { toolCall: tc, preview } })

            // Reject any previous pending approval to prevent dangling promises
            if (_approvalResolve) {
              _approvalResolve(false)
              _approvalResolve = null
            }

            const approved = await new Promise<boolean>((resolve) => {
              _approvalResolve = resolve
              // Auto-reject if the user never responds (60s), so the agent loop
              // doesn't hang forever on a dangling approval dialog
              setTimeout(() => {
                if (_approvalResolve === resolve) {
                  _approvalResolve = null
                  resolve(false)
                }
              }, 60000)
            })

            if (!approved) {
              const result: ToolResult = {
                toolCallId: tc.id,
                name: tc.name,
                result: '用户拒绝了此操作',
                isError: true,
              }
              get().addMessage(activeSessionId!, {
                role: 'tool',
                content: result.result,
                toolResults: [result],
                toolCallId: tc.id,
              })
              messages.push({
                role: 'tool',
                content: result.result,
                toolCallId: tc.id,
                toolCalls: undefined,
              })
              continue
            }
          }

          // Execute the tool
          const result = await toolExecutor.execute(tc)

          get().addMessage(activeSessionId!, {
            role: 'tool',
            content: result.result,
            toolResults: [result],
            toolCallId: tc.id,
          })

          messages.push({
            role: 'tool',
            content: result.result,
            toolCallId: tc.id,
            toolCalls: undefined,
          })
        }

        // Reset streaming state for next iteration
        set({ streamingContent: '', streamingThinking: '' })
      }

      // Agent loop exhausted without finishing (last iteration still had tool calls).
      // Notify instead of silently stopping.
      if (maxIterations <= 0 && !abortController.signal.aborted) {
        get().addMessage(activeSessionId!, {
          role: 'assistant',
          content: '[已达到最大工具调用轮数 (20)，已停止。如需继续请再次发送消息。]',
        })
      }

      // Auto-generate title if first message
      if (session.messages.length === 0) {
        const title = content.slice(0, 50) + (content.length > 50 ? '...' : '')
        get().renameSession(activeSessionId!, title)
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        if (get().streamingContent) {
          get().addMessage(activeSessionId!, {
            role: 'assistant',
            content: get().streamingContent + '\n\n[生成已停止]',
            thinking: get().streamingThinking || undefined,
          })
        }
      } else {
        console.error('发送消息失败:', error instanceof Error ? error.message : 'Unknown error')
        get().addMessage(activeSessionId!, {
          role: 'assistant',
          content: `错误: ${error.message}`,
        })
      }
    } finally {
      set({ isLoading: false, streamingContent: '', streamingThinking: '', abortController: null, pendingApproval: null })
      _approvalResolve = null
      get().saveSession(activeSessionId!)
    }
  },

  regenerateFromMessage: async (sessionId, msgId) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    if (!session) return

    const msgIndex = session.messages.findIndex((m) => m.id === msgId)
    if (msgIndex === -1) return

    const target = session.messages[msgIndex]

    // Determine which user message to re-run and where to cut the history:
    // - Clicked a user message (HistoryEditor rerun) → re-run that message itself.
    // - Clicked an assistant message ("重新生成") → re-run the last user message before it.
    let userMsg: ChatMessage | undefined = target
    let cutIndex = msgIndex
    if (target.role !== 'user') {
      let found = -1
      for (let i = msgIndex - 1; i >= 0; i--) {
        if (session.messages[i].role === 'user') { found = i; break }
      }
      if (found === -1) return
      userMsg = session.messages[found]
      cutIndex = found
    }

    // Truncate the session to just before the user message.
    // sendMessage() re-adds the user message itself, so nothing is duplicated.
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId
          ? { ...sess, messages: sess.messages.slice(0, cutIndex) }
          : sess
      ),
    }))

    if (userMsg) {
      await get().sendMessage(userMsg.content, userMsg.contextFiles)
    }
  },

  stopGeneration: () => {
    get().abortController?.abort()
  },

  // Branch: create a new branch from a specific message
  createBranchFromMessage: (sessionId, messageId) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    if (!session) return

    const msgIndex = session.messages.findIndex((m) => m.id === messageId)
    if (msgIndex === -1) return

    const forkMessages = session.messages.slice(0, msgIndex + 1).map((m, i) => ({ ...m, sortOrder: i }))

    const existingBranches = session.branches || []
    const mainBranchId = 'main'
    let branches: ChatBranch[]

    if (!session.activeBranchId && existingBranches.length === 0) {
      const mainBranch: ChatBranch = {
        id: mainBranchId,
        name: '主分支',
        forkedFromMessageId: '',
        messages: session.messages.map((m) => ({ ...m })),
        createdAt: Date.now(),
      }
      branches = [mainBranch]
    } else {
      branches = existingBranches.map((b) =>
        b.id === (session.activeBranchId || mainBranchId)
          ? { ...b, messages: session.messages.map((m) => ({ ...m })) }
          : b
      )
    }

    const newBranchId = uuidv4()
    const branchNumber = branches.length
    const newBranch: ChatBranch = {
      id: newBranchId,
      name: `分支 ${branchNumber}`,
      forkedFromMessageId: messageId,
      messages: forkMessages,
      createdAt: Date.now(),
    }
    branches.push(newBranch)

    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId
          ? {
              ...sess,
              messages: forkMessages,
              activeBranchId: newBranchId,
              branches,
              updatedAt: Date.now(),
            }
          : sess
      ),
    }))
    get().saveSession(sessionId)
  },

  // Branch: switch to a different branch
  switchBranch: (sessionId, branchId) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    if (!session) return

    const mainBranchId = 'main'
    const branches = session.branches || []

    const currentActiveId = session.activeBranchId || mainBranchId
    const updatedBranches = branches.map((b) =>
      b.id === currentActiveId
        ? { ...b, messages: session.messages.map((m) => ({ ...m })) }
        : b
    )

    let targetMessages: ChatMessage[]
    if (branchId === mainBranchId) {
      const mainBranch = updatedBranches.find((b) => b.id === mainBranchId)
      targetMessages = mainBranch ? mainBranch.messages.map((m) => ({ ...m })) : session.messages
    } else {
      const targetBranch = updatedBranches.find((b) => b.id === branchId)
      targetMessages = targetBranch ? targetBranch.messages.map((m) => ({ ...m })) : session.messages
    }

    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId
          ? {
              ...sess,
              messages: targetMessages,
              activeBranchId: branchId === mainBranchId ? undefined : branchId,
              branches: updatedBranches,
              updatedAt: Date.now(),
            }
          : sess
      ),
    }))
    get().saveSession(sessionId)
  },

  // Pin: toggle pin state
  togglePin: (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    if (!session) return
    const pinnedAt = session.pinnedAt ? undefined : Date.now()
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, pinnedAt, updatedAt: Date.now() } : sess
      ),
    }))
    get().saveSession(sessionId)
  },

  // Archive: toggle archive state
  toggleArchive: (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    if (!session) return
    const archivedAt = session.archivedAt ? undefined : Date.now()
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, archivedAt, updatedAt: Date.now() } : sess
      ),
    }))
    get().saveSession(sessionId)
  },

  exportSession: (sessionId, format) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    if (!session) return ''

    if (format === 'json') {
      return JSON.stringify(session, null, 2)
    }

    let md = `# ${session.title}\n\n`
    md += `创建时间: ${new Date(session.createdAt).toLocaleString()}\n\n---\n\n`

    for (const msg of session.messages) {
      md += `### ${msg.role === 'user' ? '用户' : msg.role === 'tool' ? '工具' : 'AI 助手'}\n\n`
      md += `${msg.content}\n\n`
      if (msg.thinking) {
        md += `<details><summary>思考过程</summary>\n\n${msg.thinking}\n\n</details>\n\n`
      }
      md += `---\n\n`
    }

    return md
  },

  importSession: (data) => {
    try {
      const imported = JSON.parse(data) as ChatSession

      // Assign new IDs to avoid conflicts
      const sessionId = uuidv4()

      // Restore branches if present, assigning new IDs
      const branchIdMap: Record<string, string> = {}
      let branches: ChatBranch[] = []
      let activeBranchId: string | undefined

      if (imported.branches && imported.branches.length > 0) {
        branches = imported.branches.map((b) => {
          const newBranchId = b.id === 'main' ? 'main' : uuidv4()
          branchIdMap[b.id] = newBranchId
          return {
            ...b,
            id: newBranchId,
            messages: b.messages.map((m) => ({ ...m, id: uuidv4() })),
          }
        })

        // Map activeBranchId
        if (imported.activeBranchId) {
          activeBranchId = branchIdMap[imported.activeBranchId] || imported.activeBranchId
        }
      }

      const session: ChatSession = {
        ...imported,
        id: sessionId,
        messages: imported.messages.map((m) => ({ ...m, id: uuidv4() })),
        branches,
        activeBranchId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      set((s) => ({
        sessions: [session, ...s.sessions],
        activeSessionId: session.id,
      }))

      window.electronAPI.saveSession(session)
    } catch (error) {
      console.error('导入会话失败:', error)
    }
  },

  saveSession: async (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    if (session) {
      await window.electronAPI.saveSession(session)
    }
  },

  updateSessionModel: (sessionId, model) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, model } : sess
      ),
    }))
    get().saveSession(sessionId)
  },

  updateSessionParams: (sessionId, params) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId
          ? { ...sess, modelParams: { ...sess.modelParams, ...params } }
          : sess
      ),
    }))
    get().saveSession(sessionId)
  },

  resetStore: () => {
    if (_gitBranchInterval) {
      clearInterval(_gitBranchInterval)
      _gitBranchInterval = null
    }
    set({
      sessions: [],
      activeSessionId: null,
      isLoading: false,
      streamingContent: '',
      pendingApproval: null,
      undoStack: [],
    })
  },
}))
