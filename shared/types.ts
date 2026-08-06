// Shared types between main and renderer processes

// API Configuration Group
export interface ApiConfigGroup {
  id: string
  name: string
  baseUrl: string
  apiKey: string // Decrypted at runtime in renderer
  systemPrompt: string
  defaultModel: string
  provider: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'deepseek' | 'groq' | 'azure' | 'custom'
  /** Override the API format regardless of provider. 'auto' uses the provider's native format. */
  apiFormat?: 'auto' | 'openai' | 'anthropic' | 'gemini'
  customHeaders: Record<string, string>
  color?: string // Color label for the config group
  sortOrder?: number // smaller = higher priority
  createdAt: number
  updatedAt: number
}

// Model Parameters
export interface ModelParams {
  temperature: number
  maxTokens: number
  topP: number
  frequencyPenalty: number
  presencePenalty: number
}

// Chat Branch
export interface ChatBranch {
  id: string
  name: string
  forkedFromMessageId: string // message id where this branch forks from
  messages: ChatMessage[]
  createdAt: number
}

// Chat Session
export interface ChatSession {
  id: string
  title: string
  configGroupId: string
  model: string
  modelParams: ModelParams
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  activeBranchId?: string // active branch id, undefined/null = main branch
  branches?: ChatBranch[] // all branches except the main one
  pinnedAt?: number
  archivedAt?: number
  // Agent mode: 'chat' answers freely (with tool calls), 'agent' is the merged
  // planning + execution mode — the planning phase is read-only (enforced via
  // PLAN_TOOLS when projectEditMode='plan'), then executes after plan approval
  // or directly for trivial tasks under other edit modes.
  agentMode?: 'chat' | 'agent'
  // Lightweight records of past agent runs (shown in the Agent tasks panel)
  agentRuns?: AgentRun[]
  // Project edit mode: controls tool-approval behavior in agent mode
  // 'confirm_before_change' — ask before every file-modifying tool
  // 'auto_edit' — auto-approve file edits (write/edit files)
  // 'plan' — read-only → submit plan → approve → execute
  // 'full_access' — auto-approve all tool calls
  projectEditMode?: 'confirm_before_change' | 'auto_edit' | 'plan' | 'full_access'
  // Agent-managed todo list shown in the chat panel
  todos?: TodoItem[]
  // Plan awaiting approval (set by submit_plan)
  planContent?: string
  planStatus?: 'none' | 'pending_approval' | 'approved'
  // Project workspace path this session belongs to (captured at creation time)
  projectPath?: string
}

// Agent todo list item (managed via the manage_todo tool)
export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  order: number
}

// Tool-call category used for rendering the agent's execution trace
// (think/search/edit/execute/... get distinct icons, Windsurf-style)
export type AgentToolKind = 'think' | 'search' | 'edit' | 'execute' | 'fetch' | 'switch_mode' | 'ask' | 'other'

// One executed tool call inside an agent run (transient, shown in AgentRunPanel)
export interface AgentTraceEntry {
  id: string
  toolCallId: string
  name: string
  kind: AgentToolKind
  status: 'running' | 'success' | 'error' | 'rejected'
  summary: string
}

// Lightweight persisted record of an agent run (shown in the Agent tasks panel)
export interface AgentRun {
  id: string
  task: string
  status: 'running' | 'creating_plan' | 'waiting_plan' | 'approved_running' | 'done' | 'stopped' | 'error' | 'rejected'
  plan?: string // JSON plan (same shape as session.planContent) when submitted
  startedAt: number
  finishedAt?: number
  toolCallCount: number
  fileChangeCount: number
  stepCount: number
  lastError?: string
}

// One file's content snapshot inside a checkpoint
export interface CheckpointFile {
  path: string
  content: string
  existed: boolean
}

// Checkpoint: file snapshots taken right before a write tool ran, so the user
// can revert the AI's edits (Windsurf-style checkpoints)
export interface Checkpoint {
  id: string
  sessionId: string
  createdAt: number
  label: string // e.g. "edit_file → src/foo.ts"
  messageId?: string // assistant message that triggered the tool call
  files: CheckpointFile[]
}

// Persistent user memory (injected into the system prompt)
export interface Memory {
  id: string
  content: string
  scope: 'global' | 'project'
  projectPath?: string // the project path this memory belongs to (only for scope='project')
  createdAt: number
  updatedAt: number
}

// Reusable workflow (Windsurf-style): a named prompt template that can be
// re-run against the current workspace/selection
export interface Workflow {
  id: string
  name: string
  description: string
  prompt: string
  createdAt: number
  updatedAt: number
}

// Ask-user-question interaction (asked by the agent during the loop)
export interface UserQuestion {
  id: string
  question: string
  options?: string[]
}

// Structured LLM error (rendered as a friendly error card instead of raw text)
export interface ChatError {
  /** HTTP status code when the upstream service returned one */
  code?: number
  type: 'auth' | 'timeout' | 'network' | 'rate_limit' | 'server' | 'unknown'
  /** Localized, user-friendly message shown in the error card */
  message: string
  /** Raw upstream detail (e.g. the JSON error body) — shown in a collapsible area */
  detail?: string
}

// Chat Message
export interface ChatMessage {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  sortOrder: number
  contextFiles: string[]
  tokenCount: number
  thinking?: string
  editedAt?: number
  createdAt: number
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, any> }>
  toolResults?: Array<{ toolCallId: string; name: string; result: string; isError?: boolean }>
  toolCallId?: string
  error?: ChatError
}

// Open File
export interface OpenFile {
  path: string
  content: string
  language: string
  encoding: string
  lineEnding: 'lf' | 'crlf'
  isDirty: boolean
  cursorPosition?: { line: number; column: number }
  hasBom?: boolean // original file started with a byte-order mark; preserved on save
  isLoading?: boolean // true while the file is being streamed into the editor
  loadProgress?: number // 0-100, shown while isLoading (large files)
  size?: number // file size in bytes (from stat/stream)
  plainText?: boolean // large file: loaded as plain text (no syntax highlighting)
  readOnly?: boolean // very large file: shown as a read-only preview (head only), no edits
}

// Chunked file stream (main process -> renderer, pull-based)
export interface FileStreamStart {
  id: number
  encoding: string
  hasBom: boolean
  totalBytes: number
  chunk: string // first chunk, already decoded
}

export interface FileStreamChunk {
  chunk: string // decoded text; on done it carries the decoder flush
  done: boolean
}

// File Entry
export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  isHidden: boolean
  size?: number
  modifiedAt?: number
  gitStatus?: 'modified' | 'added' | 'deleted' | 'renamed' | null
  children?: FileEntry[]
}

// File Stat
export interface FileStat {
  size: number
  isFile: boolean
  isDirectory: boolean
  createdAt: number
  modifiedAt: number
}

// Hot-exit backup entry (an unsaved dirty buffer mirrored by the main process)
export interface BackupEntry {
  filePath: string
  encoding: string
  hasBom: boolean
  size: number
  mtime: number
}

// User Preferences
export interface UserPreferences {
  theme: 'light' | 'dark' | 'system'
  fontSize: number
  fontFamily: string
  tabSize: number
  autoSave: boolean
  autoSaveInterval: number
  showMinimap: boolean
  showHiddenFiles: boolean
  chatPosition: 'right' | 'bottom'
  /** 'system' follows the OS locale (zh-* → zh-CN, otherwise en-US) */
  language: 'zh-CN' | 'en-US' | 'system'
  encryptChatData: boolean
  /** LSP servers by Monaco language id, e.g. { python: "pylsp", go: "gopls -mode stdio" } */
  lspServers?: Record<string, string>
}

// Model Info
export interface ModelInfo {
  id: string
  name: string
  isFree: boolean
  isFavorite: boolean
  alias?: string
  contextWindow?: number // context window size in tokens
  vision?: boolean
  functionCall?: boolean
}

// LLM Message
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  thinking?: string
  toolCalls?: LLMToolCall[]
  toolCallId?: string
}

// Tool definition for LLM function calling
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, any>
  }
}

// Raw tool call from LLM response
export interface LLMToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

// LLM Request
export interface LLMRequest {
  model: string
  messages: LLMMessage[]
  temperature: number
  maxTokens: number
  topP: number
  frequencyPenalty: number
  presencePenalty: number
  stream: boolean
  tools?: ToolDefinition[]
}

// LLM Stream Chunk
export interface LLMStreamChunk {
  content: string
  thinking?: string
  done: boolean
  toolCalls?: LLMToolCall[]
  usage?: {
    promptTokens: number
    completionTokens: number
  }
}

// Custom Model (user-added)
export interface CustomModel {
  id: string
  name: string
  provider: ApiConfigGroup['provider']
  contextWindow?: number
  vision?: boolean
  functionCall?: boolean
  createdAt: number
}

// Custom AI Command
export interface CustomAICommand {
  id: string
  name: string
  prompt: string
  icon?: string
  shortcut?: string
}

// Terminal
export interface TerminalInfo {
  id: string
  name: string
}

// Search options
export interface SearchOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
  filePattern?: string // e.g. "*.ts,*.tsx"
  excludeFolders?: string // e.g. "node_modules,.git,dist"
}

// Search result
export interface SearchResult {
  filePath: string
  fileName: string
  lineNumber: number
  lineContent: string
  matchStart: number
  matchEnd: number
}

// ───────────────────── Usage statistics ─────────────────────

/** Feature category of a recorded usage event (persisted in usage_events) */
export type UsageEventCategory = 'llm' | 'skill' | 'subagent' | 'mcp'

/**
 * One recorded usage event. Collection points:
 * - 'llm'       name = model id, sub = provider (chatStore / arena)
 * - 'skill'     name = skill name (SkillManager / skill__ tool)
 * - 'subagent'  name = subagent role name (subagentRunner)
 * - 'mcp'       name = `${server}__${tool}` (or `server__<lifecycle>`), sub = server (ToolExecutor / MCPManager)
 */
export interface UsageEvent {
  id: string
  category: UsageEventCategory
  name: string
  sub?: string
  sessionId?: string
  projectPath?: string
  startedAt: number
  finishedAt?: number
  durationMs?: number
  tokensIn?: number
  tokensOut?: number
  ok?: boolean
  error?: string
  payload?: Record<string, any>
}

/** One row of an aggregated ranking (byModel / skills / subagents / mcp) */
export interface UsageRankRow {
  name: string
  sub: string
  count: number
  tokensIn: number
  tokensOut: number
  errors: number
  lastUsed: number
}

/** One day of the token-usage trend (key: 'YYYY-MM-DD' local time) */
export interface UsageDailyRow {
  day: string
  tokensIn: number
  tokensOut: number
  requests: number
}

/** A recent usage event, as returned by the summary query (denormalized) */
export interface UsageRecentRow {
  id: string
  category: UsageEventCategory
  name: string
  sub: string
  sessionId: string
  startedAt: number
  durationMs: number
  tokensIn: number
  tokensOut: number
  ok: boolean
  error: string
}

/** Dashboard payload returned by usage:summary for a given time range */
export interface UsageSummary {
  totals: { requests: number; tokensIn: number; tokensOut: number; errors: number }
  daily: UsageDailyRow[]
  byModel: UsageRankRow[]
  skills: UsageRankRow[]
  subagents: UsageRankRow[]
  mcp: UsageRankRow[]
  recent: UsageRecentRow[]
}
