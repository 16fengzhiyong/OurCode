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
  // Agent mode (Windsurf-style): 'chat' answers freely, 'plan' produces a plan first
  agentMode?: 'chat' | 'plan'
  // Agent-managed todo list shown in the chat panel
  todos?: TodoItem[]
  // Plan awaiting approval (set by submit_plan)
  planContent?: string
  planStatus?: 'none' | 'pending_approval' | 'approved'
}

// Agent todo list item (managed via the manage_todo tool)
export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  order: number
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
  language: 'zh-CN' | 'en-US'
  encryptChatData: boolean
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
