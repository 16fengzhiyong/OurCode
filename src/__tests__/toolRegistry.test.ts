import { describe, it, expect } from 'vitest'
import { createToolRegistry, toToolDefinitions } from '../services/tools/ToolRegistry'
import { ToolExecutor } from '../services/tools/ToolExecutor'

describe('ToolRegistry', () => {
  it('should create a non-empty tool list', () => {
    const tools = createToolRegistry()
    expect(tools.length).toBeGreaterThan(0)
  })

  it('should have unique tool names', () => {
    const tools = createToolRegistry()
    const names = tools.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('should have all required fields on each tool', () => {
    const tools = createToolRegistry()
    for (const tool of tools) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(tool.parameters).toBeTruthy()
      expect(tool.parameters.type).toBe('object')
      expect(tool.parameters.properties).toBeTruthy()
      expect(tool.parameters.required).toBeInstanceOf(Array)
      expect(typeof tool.execute).toBe('function')
    }
  })

  it('should mark write tools as requiring approval', () => {
    const tools = createToolRegistry()
    const writeTools = ['write_file', 'edit_file', 'create_directory', 'delete_file', 'run_command']
    const readTools = ['read_file', 'list_directory', 'get_directory_tree', 'search_files', 'search_in_files']

    for (const name of writeTools) {
      const tool = tools.find((t) => t.name === name)
      expect(tool).toBeTruthy()
      expect(tool!.requiresApproval).toBe(true)
    }

    for (const name of readTools) {
      const tool = tools.find((t) => t.name === name)
      expect(tool).toBeTruthy()
      expect(tool!.requiresApproval).toBeFalsy()
    }
  })

  it('should convert to OpenAI tool definitions format', () => {
    const tools = createToolRegistry()
    const defs = toToolDefinitions(tools)

    expect(defs.length).toBe(tools.length)

    for (const def of defs) {
      expect(def.type).toBe('function')
      expect(def.function.name).toBeTruthy()
      expect(def.function.description).toBeTruthy()
      expect(def.function.parameters).toBeTruthy()
    }
  })
})

describe('ToolExecutor', () => {
  it('should return all tools', () => {
    const executor = new ToolExecutor()
    const tools = executor.getTools()
    expect(tools.length).toBeGreaterThan(0)
  })

  it('should return tool definitions', () => {
    const executor = new ToolExecutor()
    const defs = executor.getToolDefinitions()
    expect(defs.length).toBe(executor.getTools().length)
  })

  it('should correctly identify tools requiring approval', () => {
    const executor = new ToolExecutor()

    expect(executor.requiresApproval('write_file')).toBe(true)
    expect(executor.requiresApproval('edit_file')).toBe(true)
    expect(executor.requiresApproval('delete_file')).toBe(true)
    expect(executor.requiresApproval('run_command')).toBe(true)
    expect(executor.requiresApproval('read_file')).toBe(false)
    expect(executor.requiresApproval('list_directory')).toBe(false)
    expect(executor.requiresApproval('unknown_tool')).toBe(false)
  })

  it('should return error for unknown tool', async () => {
    const executor = new ToolExecutor()
    const result = await executor.execute({
      id: 'call-1',
      name: 'nonexistent_tool',
      arguments: {},
    })

    expect(result.isError).toBe(true)
    expect(result.result).toContain('Unknown tool')
  })

  it('should generate preview for write_file', () => {
    const executor = new ToolExecutor()
    const preview = executor.getPreview({
      id: 'call-1',
      name: 'write_file',
      arguments: { path: '/test/file.txt', content: 'Hello World' },
    })

    expect(preview).toContain('/test/file.txt')
    expect(preview).toContain('11 chars')
  })

  it('should generate preview for run_command', () => {
    const executor = new ToolExecutor()
    const preview = executor.getPreview({
      id: 'call-1',
      name: 'run_command',
      arguments: { command: 'npm test', cwd: '/project' },
    })

    expect(preview).toContain('npm test')
    expect(preview).toContain('/project')
  })

  it('should generate generic preview for unknown tool', () => {
    const executor = new ToolExecutor()
    const preview = executor.getPreview({
      id: 'call-1',
      name: 'custom_tool',
      arguments: { foo: 'bar' },
    })

    expect(preview).toContain('custom_tool')
  })
})
