/**
 * Tool Executor - handles running tools and managing approval flow
 */
import { v4 as uuidv4 } from 'uuid'
import { Tool, ToolCall, ToolResult, ToolDefinition } from './types'
import { createToolRegistry, toToolDefinitions } from './ToolRegistry'
import { toSkillToolDefinitions, loadSkillContent, getWorkspaceRoot } from '@/services/skills/skillManager'
import type { UsageEvent, UsageEventCategory } from '@/types'

export class ToolExecutor {
  private tools: Tool[]
  private toolMap: Map<string, Tool>
  /** Dynamic tools from MCP servers (fetched via IPC, merged into definitions) */
  private dynamicTools: ToolDefinition[] = []
  /** Dynamic skill tools (skill__<name>) from the workspace skill manager */
  private skillTools: ToolDefinition[] = []
  /** Session context for usage attribution (set by the agent loop) */
  private sessionContext: { sessionId: string; projectPath: string } | null = null

  constructor() {
    this.tools = createToolRegistry()
    this.toolMap = new Map(this.tools.map((t) => [t.name, t]))
  }

  /** Get all static tools */
  getTools(): Tool[] {
    return this.tools
  }

  /** Attribute usage events to the running session */
  setSessionContext(sessionId: string, projectPath: string): void {
    this.sessionContext = { sessionId, projectPath }
  }

  /** Refresh MCP tool definitions from the main process */
  async refreshMcpTools(): Promise<void> {
    try {
      this.dynamicTools = await window.electronAPI.mcpToolDefinitions()
    } catch {
      this.dynamicTools = []
    }
  }

  /** Refresh skill tool definitions from the workspace SkillManager */
  async refreshSkillTools(): Promise<void> {
    try {
      this.skillTools = await toSkillToolDefinitions()
    } catch {
      this.skillTools = []
    }
  }

  /** Get tool definitions for LLM, optionally filtered by name (plan mode) */
  getToolDefinitions(filter?: (name: string) => boolean): ToolDefinition[] {
    let defs = toToolDefinitions(this.tools)
    if (filter) defs = defs.filter((d) => filter(d.function.name))
    const dynamic = this.dynamicTools.filter((d) => !filter || filter(d.function.name))
    const skills = this.skillTools.filter((d) => !filter || filter(d.function.name))
    // Deterministic order (by tool name) — the exact array is part of the
    // request sent every turn, and provider prefix caches (OpenAI / DeepSeek /
    // Anthropic) only hit when it stays byte-identical. Order carries no
    // meaning for the model, so sorting keeps it stable even when MCP/skill
    // tool lists reload in a different sequence.
    return [...defs, ...dynamic, ...skills].sort((a, b) =>
      a.function.name < b.function.name ? -1 : a.function.name > b.function.name ? 1 : 0
    )
  }

  /** Check if a tool requires user approval */
  requiresApproval(toolName: string): boolean {
    // MCP tools are user-configured servers — their calls run without extra approval
    if (toolName.startsWith('mcp__')) return false
    // Skill tools are read-only (they only load instructions)
    if (toolName.startsWith('skill__')) return false
    const tool = this.toolMap.get(toolName)
    return tool?.requiresApproval ?? false
  }

  /** Persist one usage event (skills / subagents / MCP) into the dashboard */
  private recordUsage(category: UsageEventCategory, name: string, startedAt: number, opts: { sub?: string; ok: boolean; error?: string }): void {
    const event: UsageEvent = {
      id: uuidv4(),
      category,
      name,
      sub: opts.sub,
      sessionId: this.sessionContext?.sessionId,
      projectPath: this.sessionContext?.projectPath,
      startedAt,
      durationMs: Date.now() - startedAt,
      ok: opts.ok,
      error: opts.error,
    }
    window.electronAPI.recordUsage([event]).catch(() => { /* stats are best-effort */ })
    window.dispatchEvent(new CustomEvent('ourcode:usage-recorded'))
  }

  /** Execute a tool call */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    // Skill dynamic tool: skill__<name> — loads the skill's instructions
    if (toolCall.name.startsWith('skill__')) {
      const skillName = toolCall.name.slice('skill__'.length)
      const startedAt = Date.now()
      try {
        const content = await loadSkillContent(skillName, getWorkspaceRoot())
        if (content == null) {
          this.recordUsage('skill', skillName, startedAt, { ok: false, error: '技能不存在' })
          return { toolCallId: toolCall.id, name: toolCall.name, result: `Error: 技能 "${skillName}" 不存在`, isError: true }
        }
        this.recordUsage('skill', skillName, startedAt, { ok: true })
        return { toolCallId: toolCall.id, name: toolCall.name, result: content }
      } catch (error: any) {
        this.recordUsage('skill', skillName, startedAt, { ok: false, error: error.message })
        return { toolCallId: toolCall.id, name: toolCall.name, result: `Error: ${error.message}`, isError: true }
      }
    }

    // MCP dynamic tool: mcp__<server>__<toolName>
    if (toolCall.name.startsWith('mcp__')) {
      const rest = toolCall.name.slice('mcp__'.length)
      const sep = rest.indexOf('__')
      if (sep === -1) {
        return { toolCallId: toolCall.id, name: toolCall.name, result: 'Error: malformed MCP tool name', isError: true }
      }
      const server = rest.slice(0, sep)
      const toolName = rest.slice(sep + 2)
      const startedAt = Date.now()
      try {
        const res = await window.electronAPI.mcpCallTool(server, toolName, toolCall.arguments || {})
        if (res.ok) {
          this.recordUsage('mcp', `${server}__${toolName}`, startedAt, { sub: server, ok: true })
          return { toolCallId: toolCall.id, name: toolCall.name, result: res.result || '(空结果)' }
        }
        this.recordUsage('mcp', `${server}__${toolName}`, startedAt, { sub: server, ok: false, error: res.error })
        return { toolCallId: toolCall.id, name: toolCall.name, result: `Error: ${res.error}`, isError: true }
      } catch (error: any) {
        this.recordUsage('mcp', `${server}__${toolName}`, startedAt, { sub: server, ok: false, error: error.message })
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
      const result = await tool.execute(toolCall.arguments, {
        sessionId: this.sessionContext?.sessionId,
        projectPath: this.sessionContext?.projectPath,
      })
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
      case 'run_subagent':
        return `子智能体 "${args.name || ''}": ${args.prompt || ''}`
      default:
        if (toolCall.name.startsWith('skill__')) {
          return `加载技能: ${toolCall.name.slice('skill__'.length)}`
        }
        if (toolCall.name.startsWith('mcp__')) {
          return `MCP 工具: ${toolCall.name}\n${JSON.stringify(args, null, 2).slice(0, 500)}`
        }
        return `${toolCall.name}: ${JSON.stringify(args, null, 2)}`
    }
  }
}
