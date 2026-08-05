/**
 * Chat slash commands (Copilot-style): typing "/" in the chat input shows a
 * menu of prompt templates; selecting one fills the input with a prompt that
 * embeds the current editor selection / file context.
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
export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase()
  if (!q) return SLASH_COMMANDS
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(q) || c.description.includes(q))
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
