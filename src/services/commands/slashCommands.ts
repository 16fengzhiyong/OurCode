/**
 * Chat slash commands (Copilot-style): typing "/" in the chat input shows a
 * menu of prompt templates; selecting one fills the input with a prompt that
 * embeds the current editor selection / file context.
 *
 * The menu is a hybrid of:
 *  - static prompt templates (SLASH_COMMANDS below), and
 *  - skill-derived commands: every discovered SKILL.md becomes a `/name`
 *    command whose template tells the agent to load skill__<name> first
 *    (progressive loading — the full instructions stay out of the prompt
 *    until the model actually invokes the skill tool).
 */

export interface SlashCommand {
  id: string
  name: string
  description: string
  template: string
}

export interface SlashContext {
  selection: string
  file: string
  language: string
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'explain', name: 'explain', description: '解释代码',
    template: '请解释以下代码的含义和功能：\n\n```{{language}}\n{{selection}}\n```',
  },
  {
    id: 'refactor', name: 'refactor', description: '重构建议',
    template: '请对以下代码提供重构建议，优化可读性和性能：\n\n```{{language}}\n{{selection}}\n```',
  },
  {
    id: 'test', name: 'test', description: '生成单元测试',
    template: '请为以下代码生成单元测试：\n\n```{{language}}\n{{selection}}\n```',
  },
  {
    id: 'review', name: 'review', description: '代码审查',
    template: '请审查以下代码：质量、Bug、性能、安全问题：\n\n```{{language}}\n{{selection}}\n```',
  },
  {
    id: 'fix', name: 'fix', description: '修复问题',
    template: '请检查以下代码中的问题并给出修复方案：\n\n```{{language}}\n{{selection}}\n```',
  },
  {
    id: 'docs', name: 'docs', description: '生成文档注释',
    template: '请为以下代码生成详细的文档注释（JSDoc/Docstring）：\n\n```{{language}}\n{{selection}}\n```',
  },
  {
    id: 'perf', name: 'perf', description: '性能优化',
    template: '请分析以下代码的性能瓶颈并给出优化方案：\n\n```{{language}}\n{{selection}}\n```',
  },
  {
    id: 'security', name: 'security', description: '安全检查',
    template: '请审查以下代码的安全问题（注入、XSS、权限等）：\n\n```{{language}}\n{{selection}}\n```',
  },
]

/** Filter commands by the typed query (e.g. "/tes" → test). */
export function filterSlashCommands(query: string, source: SlashCommand[] = SLASH_COMMANDS): SlashCommand[] {
  const q = query.toLowerCase()
  if (!q) return source
  return source.filter((c) => c.name.startsWith(q) || c.description.includes(q))
}

/** Template for a skill-backed slash command (placeholders handled by buildSlashPrompt). */
function skillCommandTemplate(skillName: string, description: string): string {
  const intro = description ? `（技能简介：${description}）` : ''
  return (
    `请加载并使用技能「${skillName}」完成以下任务${intro}。\n` +
    `请先调用 skill__${skillName} 工具获取该技能的完整说明，再严格遵循其中的步骤执行，最后汇总结果。\n\n` +
    '```{{language}}\n{{selection}}\n```\n\n当前文件: {{file}}'
  )
}

/**
 * Skill-derived slash commands: one `/name` command per discovered SKILL.md
 * (workspace + global). Keeps the skill index compact — the command only
 * carries the one-line description; the body loads on demand via skill__<name>.
 */
export async function getSkillSlashCommands(rootOverride?: string): Promise<SlashCommand[]> {
  const { listSkills } = await import('@/services/skills/skillManager')
  const skills = await listSkills(false, rootOverride)
  return skills.map((s) => ({
    id: `skill-${s.name}`,
    name: s.name,
    description: `[技能] ${s.description || s.name}`,
    template: skillCommandTemplate(s.name, s.description),
  }))
}

/** Full slash-command list: static templates + discovered skills. */
export async function getAllSlashCommands(rootOverride?: string): Promise<SlashCommand[]> {
  const skills = await getSkillSlashCommands(rootOverride).catch(() => [])
  return [...SLASH_COMMANDS, ...skills]
}

/** Fill a command's template with the current editor context. */
export function buildSlashPrompt(command: SlashCommand, ctx: SlashContext): string {
  const selection = ctx.selection?.trim() || '（未选中代码，请补充描述要处理的代码）'
  return command.template
    .replace(/\{\{selection\}\}/g, selection)
    .replace(/\{\{language\}\}/g, ctx.language || '')
    .replace(/\{\{file\}\}/g, ctx.file || '')
}

/** Read the current editor selection/file context from the active Monaco editor. */
export function getEditorSlashContext(): SlashContext {
  const editor = (window as unknown as { __monacoEditor?: { getSelection: () => { isEmpty: () => boolean }; getModel: () => { getValueInRange: (r: unknown) => string; uri: { path: string } } } }).__monacoEditor
  let selection = ''
  let file = ''
  let language = ''
  if (editor) {
    const sel = editor.getSelection()
    const model = editor.getModel()
    if (model) {
      if (sel && !sel.isEmpty()) selection = model.getValueInRange(sel)
      file = model.uri.path
      language = model.uri.path.split('.').pop() || ''
    }
  }
  return { selection, file, language }
}
