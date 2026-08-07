/**
 * Tool Registry - defines all tools available to the LLM
 */
import { Tool, ToolDefinition } from './types'

export function createToolRegistry(): Tool[] {
  return [
    // ──────────────── Read-only tools ────────────────
    {
      name: 'read_file',
      description: 'Read the contents of a file. Returns the file content with line numbers. Max 2000 lines, 50KB.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the file' },
          startLine: { type: 'number', description: 'Start line number (1-based, optional)' },
          endLine: { type: 'number', description: 'End line number (1-based, optional)' },
        },
        required: ['path'],
      },
      execute: async (args) => {
        const { readFile } = await import('@/services/tools/helpers')
        return readFile(args.path, args.startLine, args.endLine)
      },
    },
    {
      name: 'list_directory',
      description: 'List files and directories in a given path. Shows file sizes and types.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the directory' },
          maxDepth: { type: 'number', description: 'Max recursion depth (default 1, max 5)' },
        },
        required: ['path'],
      },
      execute: async (args) => {
        const { listDirectory } = await import('@/services/tools/helpers')
        return listDirectory(args.path, args.maxDepth ?? 1)
      },
    },
    {
      name: 'get_directory_tree',
      description: 'Get a tree view of the project directory structure. Useful for understanding project layout.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the root directory' },
          maxDepth: { type: 'number', description: 'Max depth (default 3)' },
        },
        required: ['path'],
      },
      execute: async (args) => {
        const { getDirectoryTree } = await import('@/services/tools/helpers')
        return getDirectoryTree(args.path, args.maxDepth ?? 3)
      },
    },
    {
      name: 'search_files',
      description: 'Search for files by name pattern. Returns matching file paths.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory to search in' },
          pattern: { type: 'string', description: 'File name pattern (supports wildcards, e.g. "*.ts")' },
        },
        required: ['path', 'pattern'],
      },
      execute: async (args) => {
        const { searchFiles } = await import('@/services/tools/helpers')
        return searchFiles(args.path, args.pattern)
      },
    },
    {
      name: 'search_in_files',
      description: 'Search for text content within files. Returns matching lines with file paths and line numbers.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory to search in' },
          query: { type: 'string', description: 'Text or regex to search for' },
          filePattern: { type: 'string', description: 'Optional file pattern filter (e.g. "*.ts,*.tsx")' },
        },
        required: ['path', 'query'],
      },
      execute: async (args) => {
        const { searchInFiles } = await import('@/services/tools/helpers')
        return searchInFiles(args.path, args.query, args.filePattern)
      },
    },

    // ──────────────── Write tools (require approval) ────────────────
    {
      name: 'write_file',
      description: 'Write content to a file. Creates the file if it doesn\'t exist, overwrites if it does.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the file' },
          content: { type: 'string', description: 'Content to write' },
        },
        required: ['path', 'content'],
      },
      execute: async (args) => {
        const { writeFile } = await import('@/services/tools/helpers')
        return writeFile(args.path, args.content)
      },
      requiresApproval: true,
    },
    {
      name: 'edit_file',
      description: 'Edit a file by replacing a specific string with new content. The oldText must match exactly.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the file' },
          oldText: { type: 'string', description: 'Exact text to find and replace' },
          newText: { type: 'string', description: 'Replacement text' },
        },
        required: ['path', 'oldText', 'newText'],
      },
      execute: async (args) => {
        const { editFile } = await import('@/services/tools/helpers')
        return editFile(args.path, args.oldText, args.newText)
      },
      requiresApproval: true,
    },
    {
      name: 'create_directory',
      description: 'Create a new directory (and any necessary parent directories).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path of the directory to create' },
        },
        required: ['path'],
      },
      execute: async (args) => {
        const { createDirectory } = await import('@/services/tools/helpers')
        return createDirectory(args.path)
      },
      requiresApproval: true,
    },
    {
      name: 'delete_file',
      description: 'Delete a file or directory. Use with caution!',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to delete' },
        },
        required: ['path'],
      },
      execute: async (args) => {
        const { deleteFileOrDir } = await import('@/services/tools/helpers')
        return deleteFileOrDir(args.path)
      },
      requiresApproval: true,
    },
    {
      name: 'run_command',
      description: 'Execute a shell command in the given directory. Returns stdout/stderr.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute' },
          cwd: { type: 'string', description: 'Working directory (optional, defaults to project root)' },
        },
        required: ['command'],
      },
      execute: async (args) => {
        const { runCommand } = await import('@/services/tools/helpers')
        return runCommand(args.command, args.cwd)
      },
      requiresApproval: true,
    },

    // ──────────────── Agent-control tools (handled by the chat store) ────────────────
    {
      name: 'manage_todo',
      description:
        'Maintain the session task list shown to the user. Call with the full updated list of todos. ' +
        'Each todo: { id (optional), content, status: "pending" | "in_progress" | "completed" | "failed" }. ' +
        'Use this at the start of a multi-step task and update it as steps progress.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'The complete updated todo list',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Existing todo id (omit for new items)' },
                content: { type: 'string', description: 'Task description' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed'] },
              },
              required: ['content', 'status'],
            },
          },
        },
        required: ['todos'],
      },
      execute: async (args) => `Todo list updated (${Array.isArray(args.todos) ? args.todos.length : 0} items)`,
    },
    {
      name: 'submit_plan',
      description:
        'In plan mode: submit a step-by-step plan for the user to approve before any file changes are made. ' +
        'The plan should break the task into ordered, concrete steps. Do not use this tool in execute mode.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short plan title' },
          steps: {
            type: 'array',
            description: 'Ordered implementation steps',
            items: {
              type: 'object',
              properties: {
                summary: { type: 'string', description: 'One-line step summary' },
                detail: { type: 'string', description: 'Optional longer explanation' },
              },
              required: ['summary'],
            },
          },
        },
        required: ['title', 'steps'],
      },
      execute: async () => 'Plan submitted (awaiting user approval)',
    },
    {
      name: 'ask_user_question',
      description:
        'Ask the user a clarifying question with optional predefined choices. ' +
        'Use this when the task is ambiguous and you need user input to proceed. The user\'s answer is returned.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question to ask' },
          options: { type: 'array', items: { type: 'string' }, description: 'Optional predefined answer choices' },
        },
        required: ['question'],
      },
      execute: async () => 'Awaiting user answer',
    },
    {
      name: 'remember',
      description:
        'Save an important piece of information to long-term memory. Use it when the user states a ' +
        'preference, makes a decision, or shares something worth remembering for future conversations. ' +
        'Content should be concise and self-contained. Enabled via Settings → 允许 AI 自动记忆.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The concise information to remember (1-2 sentences)' },
          scope: {
            type: 'string',
            enum: ['global', 'project'],
            description: 'Memory scope: "project" (only this workspace) or "global" (all workspaces). Defaults to project when a workspace is open.',
          },
        },
        required: ['content'],
      },
      execute: async (args, context) => {
        const { useMemoryStore } = await import('@/stores/memoryStore')
        const scope = args.scope === 'global' ? 'global' : 'project'
        const projectPath = context?.projectPath || undefined
        const content = String(args.content || '').trim()
        if (!content) return 'Error: 记忆内容不能为空'
        if (scope === 'project' && !projectPath) {
          return '无法保存项目记忆：当前没有打开项目。请改用全局记忆（scope: "global"）。'
        }
        await useMemoryStore.getState().addMemory(content, scope, scope === 'project' ? projectPath : undefined)
        return `已保存到${scope === 'global' ? '全局' : '项目'}长期记忆。`
      },
    },
    {
      name: 'run_subagent',
      description:
        'Spawn a nested sub-agent to complete a bounded, self-contained sub-task (e.g. code review, ' +
        'research, refactor of an isolated module). The sub-agent runs autonomously with the full tool ' +
        'set, records its own usage, and returns a structured report. Use it to parallelize work by ' +
        'delegating independent sub-tasks, then integrate the results yourself.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '子智能体角色名，如 code-reviewer / researcher / refactorer' },
          description: { type: 'string', description: '为什么需要这个子智能体（简短背景）' },
          prompt: { type: 'string', description: '交给子智能体的具体、自包含的任务描述' },
        },
        required: ['name', 'prompt'],
      },
      execute: async (args, context) => {
        const { runSubAgent } = await import('@/services/subagents/subagentRunner')
        return runSubAgent({
          sessionId: context?.sessionId || '',
          projectPath: context?.projectPath || '',
          name: String(args.name || 'subagent'),
          task: String(args.prompt || ''),
          description: args.description ? String(args.description) : undefined,
        })
      },
      requiresApproval: true,
    },

    // ──────────────── Web tools (read-only network access) ────────────────
    {
      name: 'web_search',
      description:
        'Search the web for up-to-date information (docs, error messages, APIs, news). ' +
        'Returns a list of result titles, URLs and snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
        },
        required: ['query'],
      },
      execute: async (args) => {
        const { webSearch } = await import('@/services/tools/helpers')
        return webSearch(args.query)
      },
    },
    {
      name: 'read_url',
      description:
        'Fetch and read the text content of a URL (http/https). ' +
        'Useful for reading documentation pages, API references or the web-search result pages.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch' },
        },
        required: ['url'],
      },
      execute: async (args) => {
        const { readUrl } = await import('@/services/tools/helpers')
        return readUrl(args.url)
      },
    },
  ]
}

/** Convert tools to OpenAI function calling format */
export function toToolDefinitions(tools: Tool[]): ToolDefinition[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
}
