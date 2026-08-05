/**
 * Tool Executor - handles running tools and managing approval flow
 */
import { Tool, ToolCall, ToolResult, ToolDefinition } from './types'
import { createToolRegistry, toToolDefinitions } from './ToolRegistry'

export class ToolExecutor {
  private tools: Tool[]
  private toolMap: Map<string, Tool>
  /** Dynamic tools from MCP servers (fetched via IPC, merged into definitions) */
  private dynamicTools: ToolDefinition[] = []

  constructor() {
    this.tools = createToolRegistry()
    this.toolMap = new Map(this.tools.map((t) => [t.name, t]))
  }

  /** Get all static tools */
  getTools(): Tool[] {
    return this.tools
  }

  /** Refresh MCP tool definitions from the main process */
  async refreshMcpTools(): Promise<void> {
    try {
      this.dynamicTools = await window.electronAPI.mcpToolDefinitions()
    } catch {
      this.dynamicTools = []
    }
  }

  /** Get tool definitions for LLM, optionally filtered by name (plan mode) */
  getToolDefinitions(filter?: (name: string) => boolean): ToolDefinition[] {
    let defs = toToolDefinitions(this.tools)
    if (filter) defs = defs.filter((d) => filter(d.function.name))
    const dynamic = this.dynamicTools.filter((d) => !filter || filter(d.function.name))
    return [...defs, ...dynamic]
  }

  /** Check if a tool requires user approval */
  requiresApproval(toolName: string): boolean {
    // MCP tools are user-configured servers — their calls run without extra approval
    if (toolName.startsWith('mcp__')) return false
    const tool = this.toolMap.get(toolName)
    return tool?.requiresApproval ?? false
  }

  /** Execute a tool call */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    // MCP dynamic tool: mcp__<server>__<toolName>
    if (toolCall.name.startsWith('mcp__')) {
      const rest = toolCall.name.slice('mcp__'.length)
      const sep = rest.indexOf('__')
      if (sep === -1) {
        return { toolCallId: toolCall.id, name: toolCall.name, result: 'Error: malformed MCP tool name', isError: true }
      }
      const server = rest.slice(0, sep)
      const toolName = rest.slice(sep + 2)
      try {
        const res = await window.electronAPI.mcpCallTool(server, toolName, toolCall.arguments || {})
        if (res.ok) {
          return { toolCallId: toolCall.id, name: toolCall.name, result: res.result || '(空结果)' }
        }
        return { toolCallId: toolCall.id, name: toolCall.name, result: `Error: ${res.error}`, isError: true }
      } catch (error: any) {
        return { toolCallId: toolCall.id, name: toolCall.name, result: `Error: ${error.message}`, isError: true }
      }
    }

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
      case 'web_search':
        return `Web search: ${args.query}`
      case 'read_url':
        return `Read URL: ${args.url}`
      case 'manage_todo':
        return `Update todo list (${Array.isArray(args.todos) ? args.todos.length : 0} items)`
      case 'submit_plan':
        return `提交计划: ${args.title || '(未命名)'}`
      case 'ask_user_question':
        return `提问: ${args.question}`
      default:
        if (toolCall.name.startsWith('mcp__')) {
          return `MCP 工具: ${toolCall.name}\n${JSON.stringify(args, null, 2).slice(0, 500)}`
        }
        return `${toolCall.name}: ${JSON.stringify(args, null, 2)}`
    }
  }
}
