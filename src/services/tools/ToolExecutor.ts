/**
 * Tool Executor - handles running tools and managing approval flow
 */
import { v4 as uuidv4 } from 'uuid'
import { Tool, ToolCall, ToolResult, ToolDefinition } from './types'
import { createToolRegistry, toToolDefinitions } from './ToolRegistry'
import { toSkillToolDefinitions, loadSkillContent, getWorkspaceRoot } from '@/services/skills/skillManager'
import type { UsageEvent, UsageEventCategory } from '@/types'

/** Execution context for one tool call (falls back to the shared session context) */
export interface ToolExecuteContext {
  sessionId?: string
  projectPath?: string
}

/** File-write tools gated by the read-before-write guard below. */
const READ_GUARD_TOOLS = new Set(['write_file', 'edit_file', 'delete_file'])

/**
 * Native git tools built into the registry. When present they shadow the same
 * tools from the bundled git MCP server (`mcp__git__git_status` etc.) so the
 * model never sees two overlapping sets of git tools.
 */
const NATIVE_GIT_TOOLS = new Set([
  'git_status', 'git_diff', 'git_log', 'git_branch', 'git_add', 'git_commit', 'git_push',
])

/** Normalize a path for read-tracking comparisons — Windows paths differ only
 *  in case and slash direction, and the model may not spell them identically. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase()
}

export class ToolExecutor {
  private tools: Tool[]
  private toolMap: Map<string, Tool>
  /** Dynamic tools from MCP servers (fetched via IPC, merged into definitions) */
  private dynamicTools: ToolDefinition[] = []
  /** Dynamic skill tools (skill__<name>) from the workspace skill manager */
  private skillTools: ToolDefinition[] = []
  /** Session context for usage attribution (set by the agent loop) */
  private sessionContext: { sessionId: string; projectPath: string } | null = null
  /** Files each session has already seen — read_file successes plus files it
   *  just created. Keyed per session so parallel agent loops stay isolated;
   *  subagents get their own executor instance, so they must read before
   *  writing within their own scope. */
  private readFilesBySession = new Map<string, Set<string>>()

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

  /** Drop a deleted session's read-tracking (wired from chatStore.deleteSession) */
  forgetSession(sessionId: string): void {
    this.readFilesBySession.delete(sessionId)
  }

  /** Mark a path as "known" to a session (read_file success, or a file the
   *  model just created via write_file — it authored the content, so it may
   *  edit it afterwards without a separate read). */
  private markRead(sessionId: string | undefined, path: string): void {
    if (!sessionId || !path) return
    let set = this.readFilesBySession.get(sessionId)
    if (!set) {
      set = new Set()
      this.readFilesBySession.set(sessionId, set)
    }
    set.add(normalizePath(path))
  }

  private hasReadFile(sessionId: string | undefined, path: string): boolean {
    if (!sessionId || !path) return false
    return this.readFilesBySession.get(sessionId)?.has(normalizePath(path)) ?? false
  }

  /** True when the path exists on disk. Missing files (or stat errors — never
   *  block a write on a transient failure) are treated as "new file". */
  private async fileExists(path: string): Promise<boolean> {
    try {
      return !!(await window.electronAPI.stat(path))
    } catch {
      return false
    }
  }

  /** Refresh MCP tool definitions from the main process */
  async refreshMcpTools(): Promise<void> {
    try {
      this.dynamicTools = await window.electronAPI.mcpToolDefinitions()
    } catch {
      this.dynamicTools = []
    }
  }

  /** Refresh skill tool definitions from the workspace SkillManager. `projectPath`
   *  scopes them to that project (global skills always included); without it the
   *  browsing root is used as the fallback. */
  async refreshSkillTools(projectPath?: string): Promise<void> {
    try {
      this.skillTools = await toSkillToolDefinitions(false, projectPath)
    } catch {
      this.skillTools = []
    }
  }

  /** Get tool definitions for LLM, optionally filtered by name (plan mode) */
  getToolDefinitions(filter?: (name: string) => boolean): ToolDefinition[] {
    let defs = toToolDefinitions(this.tools)
    if (filter) defs = defs.filter((d) => filter(d.function.name))
    const dynamic = this.dynamicTools.filter((d) => {
      if (filter && !filter(d.function.name)) return false
      // 内置原生 git 工具存在时，隐藏内置 git-server MCP 的同名工具
      // （mcp__git__git_status → 已有 git_status），避免模型同时看到两套。
      const m = /^mcp__git__(.+)$/.exec(d.function.name)
      if (m && NATIVE_GIT_TOOLS.has(m[1])) return false
      return true
    })
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
  private recordUsage(
    category: UsageEventCategory,
    name: string,
    startedAt: number,
    opts: { sub?: string; ok: boolean; error?: string; context?: { sessionId?: string; projectPath?: string } },
  ): void {
    const ctx = opts.context || this.sessionContext || {}
    const event: UsageEvent = {
      id: uuidv4(),
      category,
      name,
      sub: opts.sub,
      sessionId: ctx.sessionId,
      projectPath: ctx.projectPath,
      startedAt,
      durationMs: Date.now() - startedAt,
      ok: opts.ok,
      error: opts.error,
    }
    window.electronAPI.recordUsage([event]).catch(() => { /* stats are best-effort */ })
    window.dispatchEvent(new CustomEvent('ourcode:usage-recorded'))
  }

  /** Execute a tool call. `context` attributes usage to a specific session —
   *  with parallel agent loops the shared setSessionContext slot is racy, so
   *  the agent loop passes the per-call context explicitly. */
  async execute(toolCall: ToolCall, context?: ToolExecuteContext): Promise<ToolResult> {
    const ctx = context || this.sessionContext || {}
    // Skill dynamic tool: skill__<name> — loads the skill's instructions
    if (toolCall.name.startsWith('skill__')) {
      const skillName = toolCall.name.slice('skill__'.length)
      const startedAt = Date.now()
      try {
        // Load from the RUNNING session's project first — with parallel agent
        // loops the workspace follows each conversation, not the folder being
        // browsed in the sidebar file tree.
        const content = await loadSkillContent(skillName, ctx.projectPath || getWorkspaceRoot())
        if (content == null) {
          this.recordUsage('skill', skillName, startedAt, { ok: false, error: '技能不存在', context: ctx })
          return { toolCallId: toolCall.id, name: toolCall.name, result: `Error: 技能 "${skillName}" 不存在`, isError: true }
        }
        this.recordUsage('skill', skillName, startedAt, { ok: true, context: ctx })
        return { toolCallId: toolCall.id, name: toolCall.name, result: content }
      } catch (error: any) {
        this.recordUsage('skill', skillName, startedAt, { ok: false, error: error.message, context: ctx })
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
          this.recordUsage('mcp', `${server}__${toolName}`, startedAt, { sub: server, ok: true, context: ctx })
          return { toolCallId: toolCall.id, name: toolCall.name, result: res.result || '(空结果)' }
        }
        this.recordUsage('mcp', `${server}__${toolName}`, startedAt, { sub: server, ok: false, error: res.error, context: ctx })
        return { toolCallId: toolCall.id, name: toolCall.name, result: `Error: ${res.error}`, isError: true }
      } catch (error: any) {
        this.recordUsage('mcp', `${server}__${toolName}`, startedAt, { sub: server, ok: false, error: error.message, context: ctx })
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

    // Read-before-write guard (ZCode-style): write/edit/delete must not touch
    // a file the session has never read — the model can't know what it's
    // changing. Only existing files are gated (a brand-new file can't be read);
    // paths read via read_file (or created by a successful write) are known.
    // Only enforced when a session context exists — without one there's no
    // read-tracking to consult, so the write proceeds.
    if (READ_GUARD_TOOLS.has(toolCall.name) && ctx.sessionId) {
      const targetPath = String(toolCall.arguments?.path || '')
      if (targetPath && !this.hasReadFile(ctx.sessionId, targetPath) && await this.fileExists(targetPath)) {
        return {
          toolCallId: toolCall.id,
          name: toolCall.name,
          result: `Error: File has not been read yet. Read it first before writing to it.（文件尚未读取，请先调用 read_file 读取后再写入）: ${targetPath}`,
          isError: true,
        }
      }
    }

    try {
      const result = await tool.execute(toolCall.arguments, {
        sessionId: ctx.sessionId,
        projectPath: ctx.projectPath,
      })
      // A successful read makes the path known; a successful write to a NEW
      // file does too (the model just authored it, so it may edit it next).
      if (toolCall.name === 'read_file' || toolCall.name === 'write_file') {
        this.markRead(ctx.sessionId, String(toolCall.arguments?.path || ''))
      }
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
      case 'git_add':
        return `git add ${args.path ? `-- ${args.path}` : '-A (全部变更)'}`
      case 'git_commit':
        return `git commit -m "${(args.message || '').slice(0, 120)}"${args.all ? ' (先 git add -A)' : ''}`
      case 'git_push':
        return `git push ${[args.remote, args.branch].filter(Boolean).join(' ') || '(当前分支到 origin)'}`
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
