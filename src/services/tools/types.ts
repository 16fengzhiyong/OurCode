/**
 * Tool system types for Agent Loop
 */

/** A tool that the LLM can call */
export interface Tool {
  name: string
  description: string
  parameters: Record<string, any> // JSON Schema format
  execute: (args: Record<string, any>) => Promise<string>
  requiresApproval?: boolean // Write operations need user confirmation
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
