import { create } from 'zustand'
import { ChatSession, ChatMessage, ChatBranch, ModelParams, LLMToolCall, DEFAULT_MODEL_PARAMS, TodoItem, Checkpoint, UserQuestion, AgentRun, AgentTraceEntry, AgentToolKind, UsageEvent, lookupModelMetadata } from '@/types'
import { TOOL_ALLOWLIST_PREFIX } from '@shared/constants'
import { useConfigStore } from './configStore'
import { useEditorStore } from './editorStore'
import { useMemoryStore } from './memoryStore'
import { useUIStore } from './uiStore'
import { getLastModelForGroup } from './configStore'
import { TARGET_MODE_INSTRUCTION } from './targetModeInstruction'
import { ensureInitialized, readStatus, readStatusText, parseStatus, TargetModeStatus } from '@/services/targetMode/targetModeService'
import { t } from '@/i18n'
import { getFileContent } from '@/editor/modelRegistry'
import { sendLLMRequest, configureLLMCache } from '@/services/llm/LLMClient'
import { parseLLMError } from '@/services/llm/errors'
import { ToolExecutor } from '@/services/tools'
import { ToolCall, ToolResult } from '@/services/tools/types'
import { runWithConcurrency } from '@/services/subagents/parallel'
import {
  extractKeywords,
  scoreAgainstKeywords,
  loadWorkspaceKnowledge,
  retrieveRelevantContext,
  getEditorSelectionContext,
} from '@/services/tools/context'
import { v4 as uuidv4 } from 'uuid'
import { captureCheckpoint as captureCheckpointService } from '@/services/checkpointService'

// Wire the LLM cache toggles to user preferences (lazily evaluated per
// request). Every sendLLMRequest caller — chat, agent loop, arena, subagents,
// inline completion, lifeguard — benefits without each knowing the prefs.
configureLLMCache({
  responseCacheEnabled: () => useEditorStore.getState().preferences.llmResponseCache,
  anthropicPromptCacheEnabled: () => useEditorStore.getState().preferences.anthropicPromptCache,
})

// Cached git branch (refreshed via refreshGitBranch)
let _cachedGitBranch = ''
let _gitBranchFetchedAt = 0

/** localStorage key for the last active chat session (restored on next launch) */
const LAST_SESSION_KEY = 'lastActiveSessionId'

export async function refreshGitBranch(): Promise<void> {
  const rootPath = getWorkspaceRoot()
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

function getWorkspaceRoot(): string {
  return document.getElementById('file-tree-root')?.getAttribute('data-root-path') || ''
}

/** Build enhanced system prompt with workspace context */
function buildEnhancedSystemPrompt(basePrompt: string): string {
  const rootPath = getWorkspaceRoot()
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

  return enhanced
}

/** Per-turn environment block (dynamic: date + git branch) — kept OUT of the
 *  stable system prompt so the prompt prefix stays byte-identical across turns
 *  and provider prefix caches keep hitting. */
function buildEnvironmentBlock(): string {
  const rootPath = getWorkspaceRoot()
  return `\n\n<environment>
工作区路径: ${rootPath}
平台: ${navigator.platform}
当前日期: ${new Date().toLocaleDateString()}
Git 分支: ${_cachedGitBranch || '未知'}
</environment>`
}

/** Per-turn open-files list (dynamic editor state). */
function buildOpenFilesBlock(): string {
  const editorState = useEditorStore.getState()
  if (editorState.openFiles.length === 0) return ''
  let block = `\n\n<open_files>`
  for (const file of editorState.openFiles) {
    block += `\n- ${file.path}${file.isDirty ? ' (未保存)' : ''}`
  }
  return block + `\n</open_files>`
}

/** Per-turn current file content, live from the editor model. */
function buildCurrentFileBlock(): string {
  const editorState = useEditorStore.getState()
  const activeFile = editorState.openFiles.find((f) => f.path === editorState.activeFilePath)
  if (!activeFile) return ''
  const liveContent = getFileContent(activeFile.path, activeFile.content)
  const lines = liveContent.split('\n')
  const truncated = lines.length > 200
  const content = truncated ? lines.slice(0, 200).join('\n') + '\n... (truncated)' : liveContent
  return `\n\n<current_file path="${activeFile.path}">\n${content}\n</current_file>`
}

/** Inject matching persistent memories into the system prompt */
async function buildMemoriesBlock(userContent: string): Promise<string> {
  const memories = useMemoryStore.getState().memories
  if (!memories.length) return ''
  const keywords = extractKeywords(userContent)
  const activeFile = useEditorStore.getState().openFiles.find((f) => f.path === useEditorStore.getState().activeFilePath)
  if (activeFile) {
    const name = activeFile.path.split(/[/\\]/).pop() || ''
    if (name) keywords.push(name.toLowerCase())
  }
  const scored = memories
    .map((m) => ({ m, s: scoreAgainstKeywords(m.content, keywords) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
  if (scored.length === 0) return ''
  return `\n\n<user_memories>\n关于用户的长期记忆（请在实际编码时遵循）：\n${scored.map((x) => `- ${x.m.content}`).join('\n')}\n</user_memories>`
}

/**
 * Assemble the system prompt as two parts for cache friendliness:
 *  - `stable`: base + template vars + workspace knowledge — byte-identical
 *    across turns, so provider prefix caches (OpenAI / DeepSeek / Anthropic)
 *    keep hitting on the shared conversation prefix.
 *  - `dynamic`: per-turn context (env / open files / current file / editor
 *    selection / memories / retrieved files) — merged into the request's final
 *    user message so it never invalidates the stable prefix.
 */
async function buildSystemPrompt(
  basePrompt: string,
  userContent: string,
  contextFiles: string[],
): Promise<{ stable: string; dynamic: string }> {
  let stable = buildEnhancedSystemPrompt(basePrompt)

  // Workspace rules + skills (.ourcoderules, .claude/skills, .ourcode/skills)
  // mtime-cached, so in practice stable per workspace.
  stable += await loadWorkspaceKnowledge(getWorkspaceRoot())

  // ── Per-turn dynamic context (moved out of the system prompt) ──
  let dynamic = ''
  dynamic += buildEnvironmentBlock()
  dynamic += buildOpenFilesBlock()
  dynamic += buildCurrentFileBlock()
  // Current editor selection (Vibe-and-Replace style selected-text context)
  dynamic += getEditorSelectionContext()
  // Persistent memories (keyword-matched)
  dynamic += await buildMemoriesBlock(userContent)
  // Auto-retrieved relevant files
  const activeFile = useEditorStore.getState().openFiles.find((f) => f.path === useEditorStore.getState().activeFilePath)
  dynamic += await retrieveRelevantContext(userContent, contextFiles, getWorkspaceRoot(), activeFile?.path)

  return { stable, dynamic }
}

// Plan-mode prompt: explore + produce a plan, no mutations
const PLAN_MODE_INSTRUCTION = `

你当前处于「计划模式」。在做出任何修改之前，你必须先制定并提交一份清晰的实施计划。
规则：
- 你可以使用只读工具（读取文件、列出目录、搜索文件、搜索内容、Web 搜索、读取 URL）来调研代码库。
- 不要调用任何会修改文件、删除文件、创建目录或执行命令的工具。
- 调研完成后，调用 submit_plan 提交你的分步实施计划。
- 如果信息不足或任务有歧义，可以调用 ask_user_question 向用户提问。
- 也可以调用 manage_todo 维护任务列表。`

const PLAN_APPROVED_PREFIX = `用户已批准以下计划，现在开始执行。请严格按计划逐步完成，并在执行过程中用 manage_todo 维护任务列表。计划内容：\n`

// Agent-mode prompt: plan for non-trivial tasks, execute directly for trivial ones.
const AGENT_MODE_INSTRUCTION = `

你当前处于「Agent 模式」。你可以自主完成复杂的编码任务。
规则：
- 对于较复杂的任务（涉及多个文件修改、需要运行命令、结构性改动），先调研代码库，然后用 submit_plan 提交一份分步实施计划；计划被批准后严格按计划执行。
- 对于简单、小范围的任务（如回答代码问题、单文件小改动），可以直接执行，无需提交计划。
- 全程用 manage_todo 维护任务列表，让用户看到进度。
- 如果信息不足或任务有歧义，可以调用 ask_user_question 向用户提问。
- 修改文件时用 edit_file 尽量精确，不要破坏无关代码。`

/** Map a tool name to its trace category (used for icon rendering) */
function getToolKind(name: string): AgentToolKind {
  if (['read_file', 'list_directory', 'get_directory_tree', 'search_files', 'search_in_files'].includes(name)) return 'search'
  if (['web_search', 'read_url'].includes(name)) return 'fetch'
  if (['write_file', 'edit_file', 'create_directory', 'delete_file'].includes(name)) return 'edit'
  if (name === 'run_command') return 'execute'
  if (name === 'submit_plan') return 'switch_mode'
  if (name === 'ask_user_question') return 'ask'
  return 'other'
}

/** Short human-readable summary of a tool call for the trace list */
function summarizeToolCall(tc: ToolCall): string {
  const a = tc.arguments || {}
  if (['read_file', 'write_file', 'delete_file', 'list_directory', 'get_directory_tree', 'create_directory', 'edit_file'].includes(tc.name)) {
    return String(a.path || a.filePath || a.directory || '')
  }
  if (tc.name === 'run_command') return String(a.command || a.cmd || '')
  if (['search_files', 'web_search'].includes(tc.name)) return String(a.query || '')
  if (tc.name === 'search_in_files') return String(a.pattern || a.query || '')
  if (tc.name === 'read_url') return String(a.url || '')
  if (tc.name === 'manage_todo') return String(a.action || a.content || '')
  if (tc.name === 'submit_plan') return String(a.title || '')
  if (tc.name === 'ask_user_question') return String(a.question || '')
  if (tc.name === 'send_message') return String(a.targetSessionId || a.targetTitle || '')
  if (tc.name === 'list_agents') return String(a.search || '')
  return tc.name
}

// Tools allowed in plan mode (read-only + agent-control)
const PLAN_TOOLS = new Set([
  'read_file', 'list_directory', 'get_directory_tree', 'search_files', 'search_in_files',
  'web_search', 'read_url', 'manage_todo', 'submit_plan', 'ask_user_question', 'list_agents',
])

// Write tools get a checkpoint snapshot before they run
const CHECKPOINT_TOOLS = new Set(['write_file', 'edit_file', 'delete_file', 'create_directory'])

const MAX_AGENT_ITERATIONS = 20

// Max concurrent run_subagent executions within one tool-call batch
const MAX_PARALLEL_SUBAGENTS = 3

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
  /** Which session is currently generating (agent loop active). Used by the
   *  sidebar for status icons and by ChatMessages to prevent cross-session
   *  streaming when the user switches sessions mid-generation. */
  runningSessionId: string | null
  isLoading: boolean
  streamingContent: string
  streamingThinking: string
  abortController: AbortController | null
  undoStack: UndoEntry[]

  // Tool call state
  pendingApproval: { toolCall: ToolCall; preview: string } | null
  approveToolCall: () => void
  rejectToolCall: () => void

  // Ask-user-question state
  pendingQuestion: UserQuestion | null
  answerQuestion: (answer: string) => void

  // ── Agent run (transient) state ──────────────────────────────────────
  /** The currently active (or most recent) agent run across sessions */
  activeRun: { runId: string; sessionId: string } | null
  /** Live tool-execution trace of the active run */
  agentTrace: AgentTraceEntry[]
  /** True when the current run's remaining tool calls are pre-approved (batch) */
  batchApproved: boolean
  /** Per-project "always allow this tool" allowlist (projectPath → tool names) */
  toolAllowlist: Record<string, string[]>
  /** Pending batch-approval dialog (agent mode: first round with write tools) */
  batchApproval: { runId: string; tools: ToolCall[] } | null

  // Agent run actions
  startAgentRun: (sessionId: string, task: string, opts?: { resumeRunId?: string }) => void
  setRunStatus: (runId: string, status: AgentRun['status'], patch?: Partial<AgentRun>) => void
  appendTrace: (entry: AgentTraceEntry) => void
  setTraceStatus: (toolCallId: string, status: AgentTraceEntry['status']) => void
  finishAgentRun: (sessionId: string, runId: string, status: AgentRun['status'], extra?: { error?: string }) => void
  approveBatchRun: () => void
  decideBatchApproval: (decision: 'confirm' | 'all' | 'reject') => void
  allowToolPermanently: (toolName: string) => void
  loadToolAllowlist: (projectPath: string) => void
  clearToolAllowlist: (projectPath: string) => void
  deleteAgentRun: (sessionId: string, runId: string) => void

  // Queued messages (type while the agent is working)
  queuedMessages: string[]
  queueMessage: (content: string) => void
  clearQueue: () => void

  // Inbound cross-session messages (send_message tool) awaiting the target
  // session's agent loop; drained in runAgentLoop's finally.
  inboundQueue: Array<{ targetSessionId: string; senderTitle: string; content: string; hold: boolean }>
  /** Deliver a cross-session message into another session's history. hold=true
   *  appends without auto-processing; otherwise the target's agent loop is
   *  triggered when idle (messages arriving mid-run are queued). Returns a
   *  human-readable delivery status for the send_message tool. */
  receiveInboundMessage: (senderTitle: string, targetSessionId: string, message: string, hold?: boolean) => string

  // Checkpoints (AI edit snapshots) for the active session
  checkpoints: Checkpoint[]
  loadCheckpoints: (sessionId: string) => Promise<void>
  revertCheckpoint: (checkpointId: string) => Promise<void>

  // Session management
  loadSessions: () => Promise<void>
  createSession: (configGroupId: string) => string
  deleteSession: (sessionId: string) => void
  renameSession: (sessionId: string, title: string) => void
  setActiveSession: (sessionId: string) => void
  getActiveSession: () => ChatSession | undefined

  // Agent mode (chat / agent) + plan approval
  setAgentMode: (sessionId: string, mode: 'chat' | 'agent') => void
  setProjectEditMode: (sessionId: string, mode: 'confirm_before_change' | 'auto_edit' | 'plan' | 'full_access') => void
  // Target mode: the agent keeps working autonomously (auto-approve tool calls,
  // auto-continue after rounds are exhausted) until the user stops it.
  setTargetMode: (sessionId: string, enabled: boolean) => void
  /** Current parsed target-mode status (.ourcode/targemode/implementationStatus.md) */
  targetModeStatus: TargetModeStatus | null
  refreshTargetModeStatus: () => Promise<void>
  approvePlan: (sessionId: string) => Promise<void>
  dismissPlan: (sessionId: string) => void
  setTodos: (sessionId: string, todos: TodoItem[]) => void
  continueGeneration: () => Promise<void>

  // Message operations
  addMessage: (sessionId: string, msg: Partial<ChatMessage>) => void
  appendToolResult: (sessionId: string, assistantMsgId: string, result: ToolResult) => void
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
  updateSessionModel: (sessionId: string, model: string, configGroupId?: string) => void
  updateSessionConfigGroup: (sessionId: string, configGroupId: string) => void
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

type RequestMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: LLMToolCall[]
  toolCallId?: string
}

/**
 * Context-window management: if the full history's token estimate exceeds the
 * model's budget (80% of its context window — headroom for the reply), drop the
 * oldest messages while always keeping the system prompt and the newest message
 * (the current user turn). A truncation notice is inserted so the model knows
 * earlier context was cut. Exported for unit tests.
 */
export function trimHistoryForContext(messages: RequestMessage[], modelId: string): RequestMessage[] {
  const contextWindow = lookupModelMetadata(modelId)?.contextWindow || 128000
  const budget = Math.floor(contextWindow * 0.8)
  const total = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  if (total <= budget) return messages

  const trimmed = [...messages]
  let removed = 0
  // Never drop the system message (index 0) or the newest message (current turn)
  while (
    trimmed.length > 2
    && trimmed.reduce((sum, m) => sum + estimateTokens(m.content), 0) > budget
  ) {
    trimmed.splice(1, 1)
    removed++
  }
  if (removed > 0) {
    trimmed.splice(1, 0, {
      role: 'system',
      content: `[上下文管理] 为适配模型上下文窗口，较早的 ${removed} 条消息已省略。如需更早的上下文请明确说明。`,
    })
  }
  return trimmed
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

/** Format a stored plan back into readable text for the approved-plan prompt */
function formatPlanText(planContent: string): string {
  try {
    const plan = JSON.parse(planContent)
    const steps = Array.isArray(plan.steps) ? plan.steps : []
    const lines = steps.map((s: any, i: number) => `${i + 1}. ${s.summary || ''}${s.detail ? ` — ${s.detail}` : ''}`)
    return `${plan.title || '执行计划'}\n${lines.join('\n')}`
  } catch {
    return planContent
  }
}

// Singleton tool executor
const toolExecutor = new ToolExecutor()

// Pending approval resolve
let _approvalResolve: ((approved: boolean) => void) | null = null
// Pending batch-approval resolve (agent mode)
let _batchResolve: ((decision: 'confirm' | 'all' | 'reject') => void) | null = null
// Pending ask-user-question resolve
let _questionResolve: ((answer: string) => void) | null = null

// Inbound-delivery guard: reference count of agent-loop chains (re)launched
// per session by receiveInboundMessage / the finally-drain. Each launch
// increments before running, each settled chain decrements. Using a count
// (not a boolean Set) closes the handoff race where a drained loop settles
// (count-- ) while the next loop it just launched is still mid-startup
// (runningSessionId not yet set) — a boolean would briefly report "idle" and
// let a third loop start concurrently.
const _inboundLaunches = new Map<string, number>()

function markInboundLaunch(sessionId: string): void {
  _inboundLaunches.set(sessionId, (_inboundLaunches.get(sessionId) || 0) + 1)
}

function markInboundSettled(sessionId: string): void {
  const next = (_inboundLaunches.get(sessionId) || 1) - 1
  if (next <= 0) _inboundLaunches.delete(sessionId)
  else _inboundLaunches.set(sessionId, next)
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  runningSessionId: null,
  isLoading: false,
  streamingContent: '',
  streamingThinking: '',
  abortController: null,
  undoStack: [],
  pendingApproval: null,
  pendingQuestion: null,
  queuedMessages: [],
  inboundQueue: [],
  checkpoints: [],
  activeRun: null,
  agentTrace: [],
  batchApproved: false,
  toolAllowlist: {},
  batchApproval: null,
  targetModeStatus: null,

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

  answerQuestion: (answer) => {
    if (_questionResolve) {
      _questionResolve(answer)
      _questionResolve = null
    }
    set({ pendingQuestion: null })
  },

  // ───────────── Agent run (transient) state ─────────────

  startAgentRun: (sessionId, task, opts) => {
    const now = Date.now()
    let runId = opts?.resumeRunId
    set((s) => ({
      sessions: s.sessions.map((sess) => {
        if (sess.id !== sessionId) return sess
        const existing = sess.agentRuns || []
        // Resume an existing run (plan approval / continue): keep its record
        if (runId && existing.find((r) => r.id === runId)) {
          return {
            ...sess,
            agentRuns: existing.map((r) =>
              r.id === runId ? { ...r, status: 'running' } : r
            ),
            updatedAt: now,
          }
        }
        const run: AgentRun = {
          id: uuidv4(),
          task,
          status: 'running',
          startedAt: now,
          toolCallCount: 0,
          fileChangeCount: 0,
          stepCount: 0,
        }
        runId = run.id
        return { ...sess, agentRuns: [run, ...existing].slice(0, 20), updatedAt: now }
      }),
    }))
    if (runId) {
      set({ activeRun: { runId, sessionId }, agentTrace: [], batchApproved: false })
    }
  },

  setRunStatus: (runId, status, patch) => {
    const active = get().activeRun
    if (!active || active.runId !== runId) return
    const { sessionId } = active
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId && sess.agentRuns
          ? {
              ...sess,
              agentRuns: sess.agentRuns.map((r) => (r.id === runId ? { ...r, ...patch, status } : r)),
              updatedAt: Date.now(),
            }
          : sess
      ),
    }))
  },

  appendTrace: (entry) => {
    set((s) => ({ agentTrace: [...s.agentTrace, entry].slice(-200) }))
  },

  setTraceStatus: (toolCallId, status) => {
    set((s) => ({
      agentTrace: s.agentTrace.map((t) => (t.toolCallId === toolCallId ? { ...t, status } : t)),
    }))
  },

  finishAgentRun: (sessionId, runId, status, extra) => {
    const trace = get().agentTrace
    const session = get().sessions.find((s) => s.id === sessionId)
    const stepCount = session?.todos?.length || 0
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId && sess.agentRuns
          ? {
              ...sess,
              agentRuns: sess.agentRuns.map((r) =>
                r.id === runId
                  ? {
                      ...r,
                      status,
                      finishedAt: Date.now(),
                      toolCallCount: trace.length,
                      fileChangeCount: trace.filter((t) => t.kind === 'edit').length,
                      stepCount,
                      lastError: extra?.error || r.lastError,
                    }
                  : r
              ),
              updatedAt: Date.now(),
            }
          : sess
      ),
    }))
    set({ batchApproved: false })
    get().saveSession(sessionId)
  },

  approveBatchRun: () => set({ batchApproved: true, batchApproval: null }),

  decideBatchApproval: (decision) => {
    if (_batchResolve) {
      _batchResolve(decision)
      _batchResolve = null
    }
    set({ batchApproval: null })
  },

  allowToolPermanently: (toolName) => {
    const active = get().activeRun
    const session = active
      ? get().sessions.find((s) => s.id === active.sessionId)
      : get().sessions.find((s) => s.id === get().activeSessionId)
    const rootPath = session?.projectPath || getWorkspaceRoot()
    if (!rootPath) return
    const key = TOOL_ALLOWLIST_PREFIX + rootPath
    let list: string[] = []
    try { list = JSON.parse(localStorage.getItem(key) || '[]') } catch { /* ignore */ }
    const next = Array.from(new Set([...list, toolName]))
    localStorage.setItem(key, JSON.stringify(next))
    set((s) => ({ toolAllowlist: { ...s.toolAllowlist, [rootPath]: next } }))
  },

  loadToolAllowlist: (projectPath) => {
    if (!projectPath) return
    try {
      const arr = JSON.parse(localStorage.getItem(TOOL_ALLOWLIST_PREFIX + projectPath) || '[]')
      set((s) => ({
        toolAllowlist: { ...s.toolAllowlist, [projectPath]: Array.isArray(arr) ? arr : [] },
      }))
    } catch { /* ignore */ }
  },

  clearToolAllowlist: (projectPath) => {
    localStorage.removeItem(TOOL_ALLOWLIST_PREFIX + projectPath)
    set((s) => {
      const next = { ...s.toolAllowlist }
      delete next[projectPath]
      return { toolAllowlist: next }
    })
  },

  deleteAgentRun: (sessionId, runId) => {
    set((s) => {
      const clearActive = s.activeRun?.runId === runId
      return {
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId && sess.agentRuns
            ? { ...sess, agentRuns: sess.agentRuns.filter((r) => r.id !== runId), updatedAt: Date.now() }
            : sess
        ),
        activeRun: clearActive ? null : s.activeRun,
        agentTrace: clearActive ? [] : s.agentTrace,
      }
    })
    get().saveSession(sessionId)
  },

  queueMessage: (content) => {
    const trimmed = content.trim()
    if (!trimmed) return
    set((s) => ({ queuedMessages: [...s.queuedMessages, trimmed] }))
  },

  clearQueue: () => set({ queuedMessages: [] }),

  receiveInboundMessage: (senderTitle, targetSessionId, message, hold = false) => {
    const chatStore = useChatStore.getState()
    const target = chatStore.sessions.find((s) => s.id === targetSessionId)
    if (!target) return '目标会话不存在。'
    const content = `[来自会话「${senderTitle}」的会话间消息]\n\n${message}`
    const busy = chatStore.runningSessionId === targetSessionId || (_inboundLaunches.get(targetSessionId) || 0) > 0
    if (busy) {
      set((s) => ({
        inboundQueue: [...s.inboundQueue, { targetSessionId, senderTitle, content, hold }],
      }))
      return hold
        ? '目标会话忙，消息已排队（hold 模式不自动处理）。'
        : '目标会话正在生成，消息已排队，结束后自动处理。'
    }
    chatStore.addMessage(targetSessionId, { role: 'user', content })
    void chatStore.saveSession(targetSessionId)
    if (hold) {
      return '已投递到目标会话历史（hold 模式，未触发处理）。'
    }
    markInboundLaunch(targetSessionId)
    void runAgentLoop(targetSessionId).finally(() => { markInboundSettled(targetSessionId) })
    return '已投递并触发目标会话处理。'
  },

  loadCheckpoints: async (sessionId) => {
    try {
      const checkpoints = await window.electronAPI.checkpointList(sessionId)
      set({ checkpoints })
    } catch {
      set({ checkpoints: [] })
    }
  },

  revertCheckpoint: async (checkpointId) => {
    const res = await window.electronAPI.checkpointRevert(checkpointId)
    if (res?.ok) {
      set((s) => ({ checkpoints: s.checkpoints.filter((c) => c.id !== checkpointId) }))
    }
  },

  loadSessions: async () => {
    try {
      const sessions = await window.electronAPI.getSessions()
      set({ sessions })
      // Restore the last active session across restarts (only on the first load)
      if (sessions.length > 0 && !get().activeSessionId) {
        const lastId = localStorage.getItem(LAST_SESSION_KEY)
        const restored = sessions.find((s) => s.id === lastId)
        set({ activeSessionId: restored ? restored.id : sessions[0].id })
      }
    } catch (error) {
      console.error('加载会话失败:', error)
    }
  },

  createSession: (configGroupId) => {
    const id = uuidv4()
    const rootPath = document.getElementById('file-tree-root')?.getAttribute('data-root-path') || useUIStore.getState().rootPath || ''
    const session: ChatSession = {
      id,
      title: '新对话',
      configGroupId,
      // Seed with the model the user last picked for this config group, so the
      // choice (e.g. Longcat) carries over to new chats instead of resetting.
      model: getLastModelForGroup(configGroupId),
      modelParams: DEFAULT_MODEL_PARAMS,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      // Inside a project the new chat defaults to agent mode (project-aware);
      // outside any project it stays plain chat.
      agentMode: rootPath ? 'agent' : 'chat',
      todos: [],
      planStatus: 'none',
      projectPath: rootPath || undefined,
    }

    set((s) => ({
      sessions: [session, ...s.sessions],
      activeSessionId: id,
    }))
    localStorage.setItem(LAST_SESSION_KEY, id)

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
        checkpoints: s.activeSessionId === sessionId ? [] : s.checkpoints,
      }
    })
    window.electronAPI.deleteSession(sessionId)
    window.electronAPI.checkpointDelete(sessionId)
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
    // Sync the provider group so the model selector reflects this session's
    // actual provider (each session remembers its own configGroupId).
    const session = get().sessions.find((s) => s.id === sessionId)
    if (session?.configGroupId) {
      useConfigStore.getState().setActiveConfigGroup(session.configGroupId)
    }
    // Selecting a conversation also switches the current project to the one
    // the conversation belongs to (sessions captured their project at creation).
    if (session?.projectPath && session.projectPath !== useUIStore.getState().rootPath) {
      useUIStore.getState().enterProject(session.projectPath)
    }
    localStorage.setItem(LAST_SESSION_KEY, sessionId)
    set({ activeSessionId: sessionId })
    get().loadCheckpoints(sessionId)
  },

  getActiveSession: () => {
    const { sessions, activeSessionId } = get()
    return sessions.find((s) => s.id === activeSessionId)
  },

  // ───────────── Agent mode / plan / todo ─────────────

  setAgentMode: (sessionId, mode) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, agentMode: mode, updatedAt: Date.now() } : sess
      ),
    }))
    get().saveSession(sessionId)
  },

  setProjectEditMode: (sessionId, mode) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, projectEditMode: mode, updatedAt: Date.now() } : sess
      ),
    }))
    get().saveSession(sessionId)
  },

  setTargetMode: (sessionId, enabled) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    if (!session) return

    if (enabled) {
      // A session always belongs to one project: sessions created outside a
      // project get bound to the currently opened one when target mode starts.
      const myProject = session.projectPath || getWorkspaceRoot()
      // One target-mode run per project: block when another session of the
      // same project already has it enabled. The run ends when it's turned off.
      const sameProjectRun = get().sessions.some(
        (s) => s.id !== sessionId && s.targetMode === true && s.projectPath && s.projectPath === myProject,
      )
      if (sameProjectRun) {
        useUIStore.getState().showNotification(t('chat.targetModeExclusive'), 'warning')
        return
      }
      if (!session.projectPath && myProject) {
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, projectPath: myProject } : x)),
        }))
      }
      // 'auto_edit' / 'plan' are superseded by target mode's own workflow — the
      // mode bar only exposes manual-confirm and full-access while it is on.
      if (session.projectEditMode === 'auto_edit' || session.projectEditMode === 'plan') {
        get().setProjectEditMode(sessionId, 'confirm_before_change')
      }
    }

    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, targetMode: enabled, updatedAt: Date.now() } : sess
      ),
    }))
    get().saveSession(sessionId)
    if (enabled) {
      // Experimental warning — the agent runs autonomously and burns tokens.
      useUIStore.getState().showNotification(t('chat.targetModeFirstHint'), 'info')
      // Bootstrap the skeleton in the session's own project (idempotent) —
      // never the globally opened folder.
      const root = session.projectPath || getWorkspaceRoot()
      if (root) {
        ensureInitialized(root).then(() => get().refreshTargetModeStatus())
      }
    } else {
      set({ targetModeStatus: null })
    }
  },

  refreshTargetModeStatus: async () => {
    const session = get().sessions.find((s) => s.id === get().activeSessionId)
    if (!session?.targetMode) {
      set({ targetModeStatus: null })
      return
    }
    // Always operate on the session's own project — never the globally opened
    // folder, so sessions of different projects can't mix state.
    set({ targetModeStatus: await readStatus(session.projectPath || getWorkspaceRoot()) })
  },

  approvePlan: async (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    if (!session || !session.planContent || session.planStatus !== 'pending_approval') return

    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, planStatus: 'approved', updatedAt: Date.now() } : sess
      ),
    }))
    get().saveSession(sessionId)

    const planText = formatPlanText(session.planContent)
    const isAgent = session.agentMode === 'agent'
    const activeRun = get().activeRun
    await runAgentLoop(sessionId, {
      // Agent-mode sessions keep executing in agent mode; the read-only
      // planning phase is lifted via planApproved. Tool approval follows the
      // project edit mode (confirm / auto_edit / full_access) + target mode.
      agentModeOverride: isAgent ? 'agent' : 'chat',
      extraSystemText: PLAN_APPROVED_PREFIX + planText,
      resumeRunId: activeRun?.sessionId === sessionId ? activeRun.runId : undefined,
      planApproved: isAgent,
    })
  },

  dismissPlan: (sessionId) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId
          ? { ...sess, planStatus: 'none', planContent: undefined, updatedAt: Date.now() }
          : sess
      ),
    }))
    get().saveSession(sessionId)
  },

  setTodos: (sessionId, todos) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, todos, updatedAt: Date.now() } : sess
      ),
    }))
    get().saveSession(sessionId)
  },

  continueGeneration: async () => {
    const { activeSessionId, isLoading, activeRun } = get()
    if (!activeSessionId || isLoading) return
    const resumeRunId = activeRun?.sessionId === activeSessionId ? activeRun.runId : undefined
    await runAgentLoop(activeSessionId, { resumeRunId })
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

  /** Append a tool result to the preceding assistant message (inline display). */
  appendToolResult: (sessionId, assistantMsgId, result) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId
          ? {
              ...sess,
              messages: sess.messages.map((msg) =>
                msg.id === assistantMsgId
                  ? {
                      ...msg,
                      toolResults: [...(msg.toolResults || []), result],
                    }
                  : msg
              ),
              updatedAt: Date.now(),
            }
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
    const { activeSessionId } = get()
    if (!activeSessionId) return

    // Add user message
    get().addMessage(activeSessionId, {
      role: 'user',
      content,
      contextFiles,
    })

    // Auto-title on first message
    const session = get().sessions.find((s) => s.id === activeSessionId)
    if (session && session.messages.length === 1) {
      const title = content.slice(0, 50) + (content.length > 50 ? '...' : '')
      get().renameSession(activeSessionId, title)
    }

    await runAgentLoop(activeSessionId)
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
    // If the agent is blocked on an ask_user_question, aborting would leave the
    // loop hanging forever — resolve the question so the loop can unwind.
    if (_questionResolve) {
      _questionResolve('（生成已停止，用户取消了提问）')
      _questionResolve = null
    }
    // Same for a pending batch-approval dialog — reject the batch so the loop unwinds.
    if (_batchResolve) {
      _batchResolve('reject')
      _batchResolve = null
    }
    set({ pendingQuestion: null, batchApproval: null })
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
        agentMode: 'chat',
        todos: [],
        planStatus: 'none',
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

  updateSessionModel: (sessionId, model, configGroupId) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId
          ? { ...sess, model, ...(configGroupId !== undefined ? { configGroupId } : {}) }
          : sess
      ),
    }))
    get().saveSession(sessionId)
  },

  // Rebinding is what keeps the session's API key/base URL in sync with the
  // provider shown in the UI. Without it a session can end up using a model
  // picked from another config group while still authenticating with the old
  // group's key — which surfaces as a confusing 401 "invalid API key".
  updateSessionConfigGroup: (sessionId, configGroupId) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, configGroupId, updatedAt: Date.now() } : sess
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
    localStorage.removeItem(LAST_SESSION_KEY)
    set({
      sessions: [],
      activeSessionId: null,
      isLoading: false,
      streamingContent: '',
      pendingApproval: null,
      pendingQuestion: null,
      queuedMessages: [],
      inboundQueue: [],
      checkpoints: [],
      undoStack: [],
      activeRun: null,
      agentTrace: [],
      batchApproved: false,
      toolAllowlist: {},
      batchApproval: null,
    })
  },
}))

// ─────────────────────────── Agent loop ───────────────────────────

/** Build a 'llm' usage event for the usage dashboard (tokens from real usage) */
function makeLlmUsageEvent(opts: {
  sessionId: string
  projectPath: string
  model: string
  provider: string
  startedAt: number
  durationMs?: number
  tokensIn?: number
  tokensOut?: number
  ok?: boolean
  error?: string
  /** Client-side cache hit — tokensIn/Out are 0; the saved amounts go in payload. */
  cacheHit?: { savedTokensIn: number; savedTokensOut: number } | null
}): UsageEvent {
  const payload = opts.cacheHit
    ? { cacheHit: true, savedTokensIn: opts.cacheHit.savedTokensIn, savedTokensOut: opts.cacheHit.savedTokensOut }
    : undefined
  return {
    id: uuidv4(),
    category: 'llm',
    name: opts.model,
    sub: opts.provider,
    sessionId: opts.sessionId,
    projectPath: opts.projectPath,
    startedAt: opts.startedAt,
    durationMs: opts.durationMs || 0,
    tokensIn: opts.tokensIn || 0,
    tokensOut: opts.tokensOut || 0,
    ok: opts.ok ?? true,
    error: opts.error,
    payload,
  }
}

/** Flush recorded usage events to the main process + notify the dashboard */
function flushUsageEvents(events: UsageEvent[]): void {
  if (!events || events.length === 0) return
  window.electronAPI.recordUsage(events).catch(() => { /* stats are best-effort */ })
  window.dispatchEvent(new CustomEvent('ourcode:usage-recorded'))
}

/**
 * Core agent loop: streams the LLM response, executes tool calls with approval,
 * handles plan-mode / todos / questions / checkpoints, and saves the session.
 *
 * `opts.agentModeOverride` lets a plan approval resume the same run in the
 * execution phase of agent mode (read-only planning → approved execution).
 */
async function runAgentLoop(
  sessionId: string,
  opts?: { agentModeOverride?: 'chat' | 'agent'; extraSystemText?: string; resumeRunId?: string; planApproved?: boolean },
): Promise<void> {
  const chatStore = useChatStore.getState()
  const session = chatStore.sessions.find((s) => s.id === sessionId)
  if (!session) return

  const configGroup = useConfigStore.getState().configGroups.find((g) => g.id === session.configGroupId)
  if (!configGroup) return

  const agentMode = opts?.agentModeOverride || (session.agentMode === 'agent' ? 'agent' : 'chat')
  // Target mode: the agent runs the autonomous .ourcode/targemode/ workflow
  const targetMode = session.targetMode === true

  // Agent mode operates on the workspace, so a *currently selected* project
  // must be open. A session's historical projectPath does NOT count — without a
  // project selected the session must stay plain chat (never run tool calls
  // against a stale workspace path).
  if (agentMode === 'agent') {
    const hasProject = Boolean(
      document.getElementById('file-tree-root')?.getAttribute('data-root-path')
      || useUIStore.getState().rootPath
    )
    if (!hasProject) {
      chatStore.setAgentMode(sessionId, 'chat')
      useUIStore.getState().showNotification('Agent 模式需要先打开一个项目文件夹', 'warning')
      return
    }
  }

  // Refresh dynamic tools (MCP servers + workspace skills) before building the tool list
  await toolExecutor.refreshMcpTools()
  await toolExecutor.refreshSkillTools()

  // Build the system prompt with memories / rules / skills / retrieved context
  const lastUserMessage = [...session.messages].reverse().find((m) => m.role === 'user')
  const userContent = lastUserMessage?.content || ''
  const baseSystemPrompt = configGroup.systemPrompt || 'You are a helpful AI coding assistant.'
  // Split the prompt into a byte-stable prefix + per-turn dynamic context so
  // provider prefix caches (OpenAI / DeepSeek / Anthropic) keep hitting across
  // turns instead of re-billing the whole history every time.
  const { stable, dynamic } = await buildSystemPrompt(
    baseSystemPrompt, userContent, lastUserMessage?.contextFiles || [],
  )
  let stableSystemPrompt = stable
  let dynamicContext = dynamic
  // Mode instructions are static text → stable prefix. Target-mode workflow
  // status is per-run state → dynamic context (appended to the final user turn).
  if (agentMode === 'agent') {
    if (targetMode) {
      stableSystemPrompt += TARGET_MODE_INSTRUCTION
      // Bootstrap the state skeleton (idempotent) and inject the current
      // status so the agent resumes from the files instead of its memory.
      // Always the session's own project — not the globally opened folder.
      const root = session.projectPath || getWorkspaceRoot()
      if (root) {
        await ensureInitialized(root)
        const statusMd = await readStatusText(root)
        useChatStore.setState({ targetModeStatus: statusMd ? parseStatus(statusMd) : null })
        if (statusMd) {
          dynamicContext += `\n\n<target_mode_status>\n${statusMd}\n</target_mode_status>`
        }
      }
    } else {
      const planningPhase = (session.projectEditMode || 'plan') === 'plan' && !opts?.planApproved
      stableSystemPrompt += planningPhase ? PLAN_MODE_INSTRUCTION : AGENT_MODE_INSTRUCTION
    }
  }
  if (opts?.extraSystemText) {
    stableSystemPrompt += '\n\n' + opts.extraSystemText
  }

  // Build messages from full history (system + all session messages)
  let messages: RequestMessage[] = [
    { role: 'system', content: stableSystemPrompt },
    ...session.messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant' | 'tool',
      content: m.content,
      toolCalls: toRawToolCalls(m.toolCalls),
      toolCallId: m.toolCallId,
    })),
  ]

  // Merge the per-turn dynamic context (memories / retrieved files / editor
  // state) into the request's final user message — NOT persisted to history —
  // so the stable system prompt + history prefix stays byte-identical across
  // turns. The model still sees it as the most recent context.
  if (dynamicContext.trim()) {
    const lastIdx = messages.length - 1
    if (lastIdx >= 0 && messages[lastIdx].role === 'user') {
      messages[lastIdx] = {
        ...messages[lastIdx],
        content: dynamicContext + '\n\n' + messages[lastIdx].content,
      }
    } else {
      messages.push({ role: 'user', content: dynamicContext })
    }
  }

  // Context-window management: trim the oldest history when the estimate
  // exceeds the model's budget (keeps the current user turn + a notice).
  messages = trimHistoryForContext(messages, session.model || configGroup.defaultModel)

  // Agent mode with the default 'plan' edit mode exposes only read-only +
  // agent-control tools until a plan is approved (the planning phase is
  // read-only by design). Other edit modes expose all tools but vary approval.
  // Target mode always needs the full tool set (it writes its own workflow docs).
  const projectEditMode = session.projectEditMode || 'plan'
  const usePlanTools = agentMode === 'agent' && projectEditMode === 'plan' && !opts?.planApproved && !targetMode
  let toolDefinitions = usePlanTools
    ? toolExecutor.getToolDefinitions((name) => PLAN_TOOLS.has(name))
    : toolExecutor.getToolDefinitions()
  // The auto-memory tool is opt-in — hide it when the user disabled it in Settings
  if (!useEditorStore.getState().preferences.aiAutoMemory) {
    toolDefinitions = toolDefinitions.filter((d) => d.function.name !== 'remember')
  }

  // Agent mode: start (or resume) the run record + live trace. Also load the
  // persisted per-project "always allow" list for the approval checks below.
  const projectPath = session.projectPath || getWorkspaceRoot()
  // Attribute tool usage (MCP / skills / subagents) to this session
  toolExecutor.setSessionContext(sessionId, projectPath)
  let runId: string | undefined
  if (agentMode === 'agent') {
    const st = useChatStore.getState()
    st.loadToolAllowlist(projectPath)
    st.startAgentRun(sessionId, lastUserMessage?.content || 'Agent 任务', {
      resumeRunId: opts?.resumeRunId,
    })
    // Target mode: the agent runs autonomously — all tool calls for this run
    // are auto-approved (supersedes the removed per-run "auto-run" toggle).
    if (targetMode) useChatStore.setState({ batchApproved: true })
    runId = useChatStore.getState().activeRun?.runId
  }

  // Whether a tool needs manual approval in this run. Order of exemptions:
  // project edit mode → per-run batch approval → persisted allowlist.
  const FILE_EDIT_TOOLS = new Set(['write_file', 'edit_file'])
  const needsApproval = (name: string): boolean => {
    let needs = toolExecutor.requiresApproval(name)
    if (agentMode === 'agent') {
      if (projectEditMode === 'full_access') needs = false
      else if (projectEditMode === 'auto_edit' && FILE_EDIT_TOOLS.has(name)) needs = false
    }
    if (needs && useChatStore.getState().batchApproved) needs = false
    if (needs && (useChatStore.getState().toolAllowlist[projectPath] || []).includes(name)) needs = false
    return needs
  }

  const set = useChatStore.setState.bind(useChatStore)
  set({ isLoading: true, streamingContent: '', streamingThinking: '', runningSessionId: sessionId })

  const abortController = new AbortController()
  set({ abortController })

  const usageEvents: UsageEvent[] = []

  try {
    const model = session.model || configGroup.defaultModel
    let iterationsLeft = MAX_AGENT_ITERATIONS

    while (iterationsLeft-- > 0) {
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
        thinking: session.modelParams.thinking,
        reasoningEffort: session.modelParams.reasoningEffort,
        tools: toolDefinitions,
      }

      let fullContent = ''
      let fullThinking = ''
      let toolCalls: any[] = []
      const reqStartedAt = Date.now()
      let reqTokensIn = 0
      let reqTokensOut = 0
      let cacheHit: { savedTokensIn: number; savedTokensOut: number } | null = null

      try {
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

          // Real token usage reported by the provider (parsed by the adapters) —
          // persisted into the usage dashboard instead of being dropped.
          if (chunk.usage) {
            reqTokensIn = chunk.usage.promptTokens
            reqTokensOut = chunk.usage.completionTokens
          }

          // Client-side cache hit: the response was replayed locally, no API
          // call was made — report the saved tokens so the dashboard shows it.
          if (chunk.cacheHit) {
            cacheHit = chunk.cacheHit
          }

          if (chunk.done) break
        }
      } catch (requestError: any) {
        usageEvents.push(makeLlmUsageEvent({
          sessionId, projectPath, model, provider: configGroup.provider,
          startedAt: reqStartedAt, ok: false, error: requestError.message,
        }))
        throw requestError
      }

      usageEvents.push(makeLlmUsageEvent({
        sessionId, projectPath, model, provider: configGroup.provider,
        startedAt: reqStartedAt,
        durationMs: Date.now() - reqStartedAt,
        tokensIn: cacheHit ? 0 : reqTokensIn,
        tokensOut: cacheHit ? 0 : reqTokensOut,
        cacheHit,
      }))

      // No tool calls - we're done
      if (toolCalls.length === 0) {
        chatStore.addMessage(sessionId, {
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
      chatStore.addMessage(sessionId, {
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

      // The message id of the just-added assistant message (used for checkpoints)
      const assistantMsgId = chatStore.getActiveSession()?.messages.slice(-1)[0]?.id || ''

      let planSubmitted = false

      // Agent mode: offer one batch-approval dialog per round (Windsurf/Cursor
      // style) instead of interrupting on every write tool. Choosing "全部批准"
      // sets batchApproved for the rest of this run; "全部拒绝" marks this
      // round's tools as rejected; "逐个确认" falls through to per-tool dialogs.
      let batchRejectedIds = new Set<string>()
      if (agentMode === 'agent' && !useChatStore.getState().batchApproved) {
        const batchTools = parsedToolCalls.filter((tc) => needsApproval(tc.name))
        if (batchTools.length > 0) {
          const decision = await new Promise<'confirm' | 'all' | 'reject'>((resolve) => {
            if (_batchResolve) { _batchResolve('reject'); _batchResolve = null }
            _batchResolve = resolve
            useChatStore.setState({ batchApproval: { runId: runId || '', tools: batchTools } })
            // Auto-reject if the user never responds (60s), so the agent loop
            // doesn't hang forever on a dangling batch dialog
            setTimeout(() => {
              if (_batchResolve === resolve) {
                _batchResolve = null
                resolve('reject')
              }
            }, 60000)
          })
          useChatStore.setState({ batchApproval: null })
          if (decision === 'all') {
            useChatStore.getState().approveBatchRun()
          } else if (decision === 'reject') {
            batchRejectedIds = new Set(batchTools.map((t) => t.id))
          }
        }
      }

      // Execute each tool call. run_subagent calls within the same batch are
      // launched concurrently — each subagent is fully isolated (own executor,
      // permission guard, iteration/token budgets, usage recording), so only
      // execution is parallelized; approvals/checkpoints stay sequential above.
      // Deferred results are awaited together and finalized in original order
      // (all providers match tool results by tool_call_id, so order of the
      // tool messages across the batch is irrelevant).
      const deferredSubagents: Array<{ tc: ToolCall; promise: Promise<ToolResult> }> = []

      const finalizeToolResult = (tc: ToolCall, result: ToolResult): void => {
        useChatStore.getState().setTraceStatus(tc.id, result.isError ? 'error' : 'success')
        // Append result inline to the assistant message (no separate tool message)
        chatStore.appendToolResult(sessionId, assistantMsgId, result)
        messages.push({
          role: 'tool',
          content: result.result,
          toolCallId: tc.id,
          toolCalls: undefined,
        })
        // Write tools changed files on disk — notify open editors to reload
        if (CHECKPOINT_TOOLS.has(tc.name) && tc.arguments?.path) {
          notifyFileChanged(tc.arguments.path)
        }
      }

      for (const tc of parsedToolCalls) {
        if (abortController.signal.aborted) break

        // Live execution trace entry (AgentRunPanel)
        useChatStore.getState().appendTrace({
          id: uuidv4(),
          toolCallId: tc.id,
          name: tc.name,
          kind: getToolKind(tc.name),
          status: 'running',
          summary: summarizeToolCall(tc),
        })

        // ── manage_todo: update the visible todo list ──
        if (tc.name === 'manage_todo') {
          const todos: TodoItem[] = (Array.isArray(tc.arguments.todos) ? tc.arguments.todos : [])
            .map((t: any, i: number) => ({
              id: t?.id || uuidv4(),
              content: String(t?.content || ''),
              status: (['pending', 'in_progress', 'completed', 'failed'].includes(t?.status) ? t?.status : 'pending') as TodoItem['status'],
              order: i,
            }))
          chatStore.setTodos(sessionId, todos)
          const result = `任务列表已更新 (${todos.length} 项)`
          chatStore.appendToolResult(sessionId, assistantMsgId, { toolCallId: tc.id, name: tc.name, result })
          messages.push({ role: 'tool', content: result, toolCallId: tc.id })
          useChatStore.getState().setTraceStatus(tc.id, 'success')
          continue
        }

        // ── submit_plan: save the plan and pause for approval ──
        if (tc.name === 'submit_plan') {
          const plan = {
            title: String(tc.arguments.title || '执行计划'),
            steps: Array.isArray(tc.arguments.steps) ? tc.arguments.steps : [],
          }
          useChatStore.setState((s) => ({
            sessions: s.sessions.map((sess) =>
              sess.id === sessionId
                ? { ...sess, planContent: JSON.stringify(plan), planStatus: 'pending_approval' as const, updatedAt: Date.now() }
                : sess
            ),
          }))
          if (runId) {
            useChatStore.getState().setRunStatus(runId, 'waiting_plan', { plan: JSON.stringify(plan) })
            useChatStore.getState().setTraceStatus(tc.id, 'success')
          }
          const result = '计划已提交，等待用户批准。'
          chatStore.appendToolResult(sessionId, assistantMsgId, { toolCallId: tc.id, name: tc.name, result })
          messages.push({ role: 'tool', content: result, toolCallId: tc.id })
          planSubmitted = true
          break
        }

        // ── ask_user_question: prompt the user, feed the answer back ──
        if (tc.name === 'ask_user_question') {
          const answer = await new Promise<string>((resolve) => {
            if (_questionResolve) { _questionResolve('（用户取消了上一次提问）'); _questionResolve = null }
            _questionResolve = resolve
            useChatStore.setState({
              pendingQuestion: {
                id: tc.id,
                question: String(tc.arguments.question || '请确认'),
                options: Array.isArray(tc.arguments.options) ? tc.arguments.options.map(String) : undefined,
              },
            })
          })
          const result = `用户回答: ${answer}`
          chatStore.appendToolResult(sessionId, assistantMsgId, { toolCallId: tc.id, name: tc.name, result })
          messages.push({ role: 'tool', content: result, toolCallId: tc.id })
          useChatStore.getState().setTraceStatus(tc.id, 'success')
          continue
        }

        // ── Batch-rejected tools (user declined the whole round) ──
        if (batchRejectedIds.has(tc.id)) {
          const result: ToolResult = {
            toolCallId: tc.id,
            name: tc.name,
            result: '用户拒绝了此操作',
            isError: true,
          }
          chatStore.appendToolResult(sessionId, assistantMsgId, result)
          messages.push({ role: 'tool', content: result.result, toolCallId: tc.id })
          useChatStore.getState().setTraceStatus(tc.id, 'rejected')
          continue
        }

        // ── Checkpoint write tools before execution (revertable edits) ──
        if (CHECKPOINT_TOOLS.has(tc.name)) {
          await captureCheckpoint(sessionId, tc, assistantMsgId)
        }

        // Approval (per-tool) — project edit mode / batch / allowlist exemptions
        // are all folded into the needsApproval() helper defined above.
        if (needsApproval(tc.name)) {
          const preview = toolExecutor.getPreview(tc)
          useChatStore.setState({ pendingApproval: { toolCall: tc, preview } })

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
            useChatStore.getState().setTraceStatus(tc.id, 'rejected')
            const result: ToolResult = {
              toolCallId: tc.id,
              name: tc.name,
              result: '用户拒绝了此操作',
              isError: true,
            }
            chatStore.appendToolResult(sessionId, assistantMsgId, result)
            messages.push({
              role: 'tool',
              content: result.result,
              toolCallId: tc.id,
              toolCalls: undefined,
            })
            continue
          }
        }

        // Execute the tool — run_subagent calls are deferred for parallel execution
        if (tc.name === 'run_subagent') {
          deferredSubagents.push({
            tc,
            promise: toolExecutor.execute(tc).catch((error: any) => ({
              toolCallId: tc.id,
              name: tc.name,
              result: `Error: ${error?.message || String(error)}`,
              isError: true,
            })),
          })
          continue
        }

        const result = await toolExecutor.execute(tc)
        finalizeToolResult(tc, result)
      }

      // Await the deferred subagents concurrently (capped), finalize in order
      if (deferredSubagents.length > 0) {
        const settled = await runWithConcurrency(
          deferredSubagents.map((d) => () => d.promise),
          MAX_PARALLEL_SUBAGENTS,
        )
        for (let i = 0; i < deferredSubagents.length; i++) {
          const { tc } = deferredSubagents[i]
          const s = settled[i]
          finalizeToolResult(
            tc,
            s.ok && s.value
              ? s.value
              : {
                  toolCallId: tc.id,
                  name: tc.name,
                  result: `Error: ${String(s.reason ?? '子智能体执行失败')}`,
                  isError: true,
                },
          )
        }
      }

      // Plan submitted — pause the loop until the user approves
      if (planSubmitted) break

      // Reset streaming state for next iteration
      set({ streamingContent: '', streamingThinking: '' })
    }

    // Agent loop exhausted without finishing (last iteration still had tool calls).
    // Notify instead of silently stopping — the UI shows a Continue button.
    if (iterationsLeft <= 0 && !abortController.signal.aborted && !planWasSubmitted(sessionId)) {
      chatStore.addMessage(sessionId, {
        role: 'assistant',
        content: '[已达到最大工具调用轮数 (20)。点击下方"继续"按钮可继续执行。]',
      })
      // Target mode keeps the agent going after rounds are exhausted — it only
      // stops when the user judges the goal done (or queues their own message,
      // whose intent wins over resuming the old trajectory).
      const queuedPending = useChatStore.getState().queuedMessages.length > 0
      if (targetMode && !queuedPending) {
        setTimeout(() => { useChatStore.getState().continueGeneration() }, 150)
      }
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      if (useChatStore.getState().streamingContent) {
        chatStore.addMessage(sessionId, {
          role: 'assistant',
          content: useChatStore.getState().streamingContent + '\n\n[生成已停止]',
          thinking: useChatStore.getState().streamingThinking || undefined,
        })
      }
    } else {
      // Structured, user-friendly error card instead of dumping the raw
      // upstream error (which may be a JSON body) into the chat as text.
      const chatError = parseLLMError(error)
      console.error('发送消息失败:', error instanceof Error ? error.message : 'Unknown error')
      chatStore.addMessage(sessionId, {
        role: 'assistant',
        content: chatError.message,
        error: chatError,
      })
      if (runId) {
        useChatStore.getState().setRunStatus(runId, 'error', { lastError: chatError.message })
      }
    }
  } finally {
    // Finalize the agent run record (status / counts) for the tasks panel
    if (runId) {
      const finalStatus: AgentRun['status'] = abortController.signal.aborted
        ? 'stopped'
        : planWasSubmitted(sessionId)
          ? 'waiting_plan'
          : 'done'
      useChatStore.getState().finishAgentRun(sessionId, runId, finalStatus)
    }
    set({ isLoading: false, streamingContent: '', streamingThinking: '', abortController: null, pendingApproval: null, batchApproved: false, batchApproval: null })
    // Only clear runningSessionId if we're still the active runner —
    // another session may have started generating before this finally ran.
    if (useChatStore.getState().runningSessionId === sessionId) {
      set({ runningSessionId: null })
    }
    _approvalResolve = null
    _batchResolve = null
    _questionResolve = null
    chatStore.saveSession(sessionId)

    // Persist this run's token/timing events into the usage dashboard
    flushUsageEvents(usageEvents)

    // Process queued messages (type-ahead while the agent was working)
    const queued = useChatStore.getState().queuedMessages
    if (queued.length > 0) {
      const next = queued[0]
      useChatStore.setState({ queuedMessages: queued.slice(1) })
      setTimeout(() => { useChatStore.getState().sendMessage(next) }, 50)
    }

    // Deliver inbound cross-session messages (send_message from other sessions)
    // that were queued while this session was generating. One per loop end —
    // the relaunched loop's own finally drains the next, so messages for the
    // same session are processed strictly one at a time.
    const inbound = useChatStore.getState().inboundQueue
    const inboundIdx = inbound.findIndex((m) => m.targetSessionId === sessionId)
    if (inboundIdx !== -1) {
      const item = inbound[inboundIdx]
      useChatStore.setState({ inboundQueue: inbound.filter((_, i) => i !== inboundIdx) })
      chatStore.addMessage(sessionId, { role: 'user', content: item.content })
      if (item.hold) {
        void chatStore.saveSession(sessionId)
      } else {
        markInboundLaunch(sessionId)
        void runAgentLoop(sessionId).finally(() => { markInboundSettled(sessionId) })
      }
    }
  }
}

/** Check whether the current session just submitted a plan (avoid double exhausted-message) */
function planWasSubmitted(sessionId: string): boolean {
  const session = useChatStore.getState().sessions.find((s) => s.id === sessionId)
  return session?.planStatus === 'pending_approval'
}

/**
 * Snapshot the file(s) a write tool is about to touch so the user can revert.
 * Stored in SQLite via IPC (shared checkpoint service, also used by subagents);
 * mirrored into the renderer's checkpoint list.
 */
async function captureCheckpoint(sessionId: string, tc: ToolCall, messageId: string): Promise<void> {
  try {
    const checkpoint = await captureCheckpointService(sessionId, tc, messageId)
    if (checkpoint) {
      useChatStore.setState((s) => ({ checkpoints: [checkpoint, ...s.checkpoints] }))
    }
  } catch (error) {
    console.error('创建检查点失败:', error)
  }
}

/** Notify open editors that a file changed on disk (via tool execution) */
function notifyFileChanged(path: string): void {
  window.dispatchEvent(new CustomEvent('ourcode:file-changed', { detail: path }))
}
