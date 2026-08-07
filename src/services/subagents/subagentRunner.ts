/**
 * Subagent runner — executes a nested, self-contained agent task on behalf of
 * the main agent (the run_subagent tool, mirroring Windsurf's TaskSubagentTool).
 *
 * The subagent runs autonomously (no approval dialogs — it inherits the parent
 * run's authority), with a bounded iteration budget, and returns a structured
 * summary to the parent. Every AI file mutation is captured as a checkpoint so
 * it stays revertable. Usage is recorded into the dashboard (category
 * 'subagent'). Execution is serial (nested inside the parent's tool call);
 * parallel subagents are future work.
 *
 * The role/limits come from a definition (`.ourcode/agents/<name>.md` with
 * frontmatter, or a built-in archetype). Permission isolation is enforced by
 * SubagentGuard — monotonic decay: the subagent only sees/uses the tools,
 * paths and commands its definition allows.
 */
import { v4 as uuidv4 } from 'uuid'
import { sendLLMRequest } from '@/services/llm/LLMClient'
import { ToolExecutor } from '@/services/tools'
import type { ToolCall } from '@/services/tools/types'
import { captureCheckpoint } from '@/services/checkpointService'
import { buildSkillIndex, listSkills } from '@/services/skills/skillManager'
import { loadAgentDefinition, SubagentGuard } from '@/services/subagents/subagentDefinitions'
import { useChatStore } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'
import { useEditorStore } from '@/stores/editorStore'
import { getFileContent } from '@/editor/modelRegistry'
import type { LLMToolCall, UsageEvent } from '@/types'

const MAX_SUBAGENT_ITERATIONS = 10
const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'delete_file', 'create_directory'])

export interface SubAgentOptions {
  sessionId: string
  projectPath: string
  /** Role name, e.g. 'code-reviewer' / 'researcher' (shown in stats + logs) */
  name: string
  /** The concrete task given to the subagent */
  task: string
  /** Why the main agent spawned it (short, for the summary header) */
  description?: string
}

/** Build the subagent's system prompt: definition role + environment + current file + skills */
async function buildSubSystemPrompt(opts: SubAgentOptions, defSystemPrompt: string): Promise<string> {
  const rootPath = opts.projectPath
  let prompt = defSystemPrompt
  prompt += `\n\n<subagent_environment>
工作区路径: ${rootPath || '(无)'}
平台: ${navigator.platform}
当前日期: ${new Date().toLocaleDateString()}
</subagent_environment>`

  // Current open file (live from the editor model), so the subagent can work
  // on what the user is looking at
  const editorState = useEditorStore.getState()
  const activeFile = editorState.openFiles.find((f) => f.path === editorState.activeFilePath)
  if (activeFile) {
    const liveContent = getFileContent(activeFile.path, activeFile.content)
    const lines = liveContent.split('\n')
    const content = lines.length > 200 ? lines.slice(0, 200).join('\n') + '\n... (truncated)' : liveContent
    prompt += `\n\n<subagent_current_file path="${activeFile.path}">\n${content}\n</subagent_current_file>`
  }

  // Skills are available to subagents too
  prompt += await buildSkillIndex(rootPath)

  prompt += `\n\n<subagent_rules>
- 自主完成任务：使用工具（读取/搜索/编辑文件、执行命令）推进，不要向用户请求确认。
- 不要调用 submit_plan、ask_user_question、manage_todo、run_subagent 等控制类工具。
- 修改文件时用 edit_file 尽量精确，不要破坏无关代码。
- 任务完成后，以简洁的结构化摘要报告：完成了什么、修改了哪些文件、遗留问题。
</subagent_rules>`
  return prompt
}

/**
 * Execute the subagent task and return a human-readable report for the parent.
 */
export async function runSubAgent(opts: SubAgentOptions): Promise<string> {
  const startedAt = Date.now()
  const session = useChatStore.getState().sessions.find((s) => s.id === opts.sessionId)
  const configGroup = useConfigStore.getState().configGroups.find((g) => g.id === session?.configGroupId)
  const model = session?.model || configGroup?.defaultModel || ''

  const executor = new ToolExecutor()
  await executor.refreshMcpTools()
  await executor.refreshSkillTools()
  executor.setSessionContext(opts.sessionId, opts.projectPath)

  const recordEvent = (event: Partial<UsageEvent>) => {
    const full: UsageEvent = {
      id: uuidv4(),
      category: 'subagent',
      name: opts.name,
      sub: opts.description || '',
      sessionId: opts.sessionId,
      projectPath: opts.projectPath,
      startedAt,
      durationMs: Date.now() - startedAt,
      ok: true,
      ...event,
    }
    window.electronAPI.recordUsage([full]).catch(() => { /* stats are best-effort */ })
    window.dispatchEvent(new CustomEvent('ourcode:usage-recorded'))
  }

  // No config group / model → cannot run
  if (!configGroup || !model) {
    recordEvent({ ok: false, error: '未配置模型，无法运行子智能体', durationMs: Date.now() - startedAt })
    return `Error: 无法运行子智能体「${opts.name}」— 会话未绑定有效的 API 配置或模型。`
  }

  // Resolve the agent definition (workspace .md → global → builtin) and its
  // permission guard. The definition drives role, tool allowlist, path scope,
  // iteration budget and token budget.
  const def = await loadAgentDefinition(opts.name, opts.projectPath)
  const guard = new SubagentGuard(def, opts.projectPath)

  const systemPrompt = await buildSubSystemPrompt(opts, def.systemPrompt)
  const messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; toolCalls?: LLMToolCall[]; toolCallId?: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: opts.task },
  ]

  let iterationsLeft = def.maxIterations ?? MAX_SUBAGENT_ITERATIONS
  let finalText = ''
  let toolCallCount = 0
  let tokensUsed = 0
  const changedPaths = new Set<string>()
  let lastError = ''
  let hitTokenBudget = false

  // Only the subagent's allowlisted tools reach its LLM (monotonic decay)
  const toolDefinitions = executor.getToolDefinitions((name) => guard.toolAllowed(name))

  try {
    while (iterationsLeft-- > 0) {
      const req = {
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls,
          toolCallId: m.toolCallId,
        })),
        stream: true,
        temperature: def.temperature ?? session?.modelParams.temperature ?? 0.2,
        maxTokens: session?.modelParams.maxTokens ?? 0,
        topP: session?.modelParams.topP ?? 1.0,
        frequencyPenalty: session?.modelParams.frequencyPenalty ?? 0,
        presencePenalty: session?.modelParams.presencePenalty ?? 0,
        thinking: session?.modelParams.thinking ?? false,
        reasoningEffort: session?.modelParams.reasoningEffort ?? 'high',
        tools: toolDefinitions,
      }

      let fullContent = ''
      let toolCalls: LLMToolCall[] = []

      try {
        for await (const chunk of sendLLMRequest(req, configGroup)) {
          if (chunk.content) fullContent += chunk.content
          if (chunk.toolCalls) toolCalls = chunk.toolCalls
          if (chunk.usage) tokensUsed += (chunk.usage.promptTokens || 0) + (chunk.usage.completionTokens || 0)
          if (chunk.done) break
        }
      } catch (error: any) {
        lastError = error.message
        break
      }

      // Token budget exceeded — stop and report what was completed
      if (def.maxTokensBudget && tokensUsed >= def.maxTokensBudget) {
        hitTokenBudget = true
        if (!fullContent && toolCalls.length === 0) break
      }

      // No tool calls — the subagent is done
      if (toolCalls.length === 0) {
        finalText = fullContent
        break
      }

      messages.push({ role: 'assistant', content: fullContent, toolCalls })

      for (const raw of toolCalls) {
        const tc: ToolCall = {
          id: raw.id,
          name: raw.function.name,
          arguments: (() => {
            try { return JSON.parse(raw.function.arguments || '{}') } catch { return {} }
          })(),
        }

        // Permission gate (defense in depth — beyond tool visibility filtering):
        // block control tools, off-allowlist tools and out-of-scope paths.
        const blocked = guard.checkCall(tc.name, tc.arguments)
        if (blocked) {
          messages.push({ role: 'tool', content: `Error: ${blocked}`, toolCallId: tc.id })
          continue
        }

        // Snapshot files before write tools so the subagent's edits stay revertable
        if (WRITE_TOOLS.has(tc.name)) {
          await captureCheckpoint(opts.sessionId, tc).catch(() => {})
        }

        const result = await executor.execute(tc)
        toolCallCount++
        if (result.isError) lastError = result.result
        if (tc.arguments?.path) changedPaths.add(tc.arguments.path)

        // Write tools changed files on disk — notify open editors to reload
        if (WRITE_TOOLS.has(tc.name) && tc.arguments?.path) {
          window.dispatchEvent(new CustomEvent('ourcode:file-changed', { detail: tc.arguments.path }))
        }

        messages.push({ role: 'tool', content: result.result, toolCallId: tc.id })
      }

      // Budget hit — process the batch, then stop instead of requesting more
      if (hitTokenBudget) break
    }

    if (!finalText) {
      finalText = hitTokenBudget
        ? `[子智能体达到 token 预算上限 (${tokensUsed} tokens)，任务可能未完全完成]`
        : iterationsLeft <= 0 && !lastError
          ? '[子智能体达到最大工具调用轮数，任务可能未完全完成]'
          : lastError
    }

    recordEvent({
      ok: !lastError || !!finalText,
      error: lastError || undefined,
      durationMs: Date.now() - startedAt,
      payload: { toolCallCount, fileChangeCount: changedPaths.size, tokensUsed, summary: finalText.slice(0, 500) },
    })

    return [
      `## 子智能体「${opts.name}」执行报告`,
      opts.description ? `**任务背景**: ${opts.description}` : '',
      `**工具调用**: ${toolCallCount} 次 · **修改文件**: ${changedPaths.size} 个${tokensUsed ? ` · **消耗 token**: ${tokensUsed}` : ''}`,
      changedPaths.size > 0 ? `**涉及文件**:\n${Array.from(changedPaths).map((p) => `- ${p}`).join('\n')}` : '',
      '',
      `**结果**:`,
      finalText,
    ].filter((l) => l !== '').join('\n')
  } catch (error: any) {
    recordEvent({ ok: false, error: error.message, durationMs: Date.now() - startedAt })
    return `Error: 子智能体「${opts.name}」执行失败: ${error.message}`
  }
}

/** Available skill names (for the subagent role prompt / debugging) */
export async function listSkillNames(): Promise<string[]> {
  return (await listSkills()).map((s) => s.name)
}
