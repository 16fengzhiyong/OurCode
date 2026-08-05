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
