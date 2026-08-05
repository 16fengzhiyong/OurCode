/**
 * Tool Executor - handles running tools and managing approval flow
 */
import { Tool, ToolCall, ToolResult } from './types'
import { createToolRegistry, toToolDefinitions } from './ToolRegistry'
import { ToolDefinition } from './types'

export class ToolExecutor {
  private tools: Tool[]
  private toolMap: Map<string, Tool>

  constructor() {
    this.tools = createToolRegistry()
    this.toolMap = new Map(this.tools.map((t) => [t.name, t]))
  }

  /** Get all tools */
  getTools(): Tool[] {
    return this.tools
  }

  /** Get tool definitions for LLM */
  getToolDefinitions(): ToolDefinition[] {
    return toToolDefinitions(this.tools)
  }

  /** Check if a tool requires user approval */
  requiresApproval(toolName: string): boolean {
    const tool = this.toolMap.get(toolName)
    return tool?.requiresApproval ?? false
  }

  /** Execute a tool call */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const tool = this.toolMap.get(toolCall.name)
    if (!tool) {
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        result: `Error: Unknown tool "${toolCall.name}"`,
        isError: true,
      }
    }

    try {
      const result = await tool.execute(toolCall.arguments)
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        result,
      }
    } catch (error: any) {
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        result: `Error executing ${toolCall.name}: ${error.message}`,
        isError: true,
      }
    }
  }

  /** Get a preview of what a tool call will do (for approval dialog) */
  getPreview(toolCall: ToolCall): string {
    const args = toolCall.arguments
    switch (toolCall.name) {
      case 'write_file':
        return `Write to: ${args.path}\nContent length: ${(args.content || '').length} chars`
      case 'edit_file':
        return `Edit: ${args.path}\nReplace: "${(args.oldText || '').slice(0, 100)}${(args.oldText || '').length > 100 ? '...' : ''}"\nWith: "${(args.newText || '').slice(0, 100)}${(args.newText || '').length > 100 ? '...' : ''}"`
      case 'create_directory':
        return `Create directory: ${args.path}`
      case 'delete_file':
        return `Delete: ${args.path}`
      case 'run_command':
        return `Run: ${args.command}\nIn: ${args.cwd || '(project root)'}`
      default:
        return `${toolCall.name}: ${JSON.stringify(args, null, 2)}`
    }
  }
}
