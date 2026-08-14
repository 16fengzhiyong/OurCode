/**
 * Tool system types for Agent Loop
 */

/** A tool that the LLM can call */
export interface Tool {
  name: string
  description: string
  parameters: Record<string, any> // JSON Schema format
  execute: (args: Record<string, any>, context?: ToolExecutionContext) => Promise<string>
  requiresApproval?: boolean // Write operations need user confirmation
  /** Wall-clock budget for one call (ms). When set, the executor runs the tool
   *  with a deadline AbortSignal (cooperative abort) plus a hard race fallback,
   *  so a hung tool returns a structured TOOL_TIMEOUT error instead of stalling
   *  the whole agent loop. Tools with their own timeout (run_command, MCP) stay
   *  unset — wrapping them would double-timeout. */
  timeoutMs?: number
}

/** Runtime context passed to tools (used by run_subagent for usage attribution) */
export interface ToolExecutionContext {
  sessionId?: string
  projectPath?: string
  /** The id of the tool call being executed — run_subagent routes its live
   *  progress to the UI keyed by this id (SubAgentProgressBlock). */
  toolCallId?: string
  /** Abort signal of the enclosing agent run — lets the user's Stop button
   *  cancel long-running tools like run_subagent. */
  abortSignal?: AbortSignal
}

/** A tool call from the LLM */
export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, any>
}

/** Result of executing a tool */
export interface ToolResult {
  toolCallId: string
  name: string
  result: string
  isError?: boolean
  /** True when the call was DENIED by the user (approval) rather than failed —
   *  the trace shows 'rejected' instead of 'error'. */
  rejected?: boolean
}

/** Tool definition sent to LLM (OpenAI format) */
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, any>
  }
}

/** Raw tool call from LLM response */
export interface LLMToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string // JSON string
  }
}
