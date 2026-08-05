import { describe, it, expect } from 'vitest'
import { createToolRegistry, toToolDefinitions } from '../services/tools/ToolRegistry'
import { ToolExecutor } from '../services/tools/ToolExecutor'
import { extractKeywords, scoreAgainstKeywords, isIgnoredPath } from '../services/tools/context'

describe('contextEngine - keyword extraction', () => {
  it('extracts camelCase and snake_case identifiers', () => {
    const keywords = extractKeywords('请修复 getUserById 中的 bug')
    expect(keywords).toContain('getuserbyid')
    // camelCase parts become searchable tokens
    expect(keywords).toContain('user')
    expect(keywords).toContain('bug')
  })

  it('extracts CJK bigrams for Chinese text', () => {
    const keywords = extractKeywords('重构登录模块')
    // 2-char CJK bigrams present
    expect(keywords.some((k) => /^[\u4e00-\u9fff]{2}$/.test(k))).toBe(true)
  })

  it('extracts plain English words and skips stopwords', () => {
    const keywords = extractKeywords('please fix the timer for the search feature')
    expect(keywords).toContain('fix')
    expect(keywords).toContain('search')
    expect(keywords).not.toContain('the')
    expect(keywords).not.toContain('please')
  })
})

describe('contextEngine - keyword scoring', () => {
  it('scores documents by keyword overlap', () => {
    const keywords = ['auth', 'login', 'token']
    expect(scoreAgainstKeywords('handle auth login with token', keywords)).toBe(3)
    expect(scoreAgainstKeywords('unrelated file', keywords)).toBe(0)
  })
})

describe('contextEngine - .ourcodeignore', () => {
  it('default state ignores nothing', () => {
    // isIgnoredPath works on the empty default (nothing ignored)
    expect(isIgnoredPath('/project/src/app.ts')).toBe(false)
    expect(isIgnoredPath('any/path/at/all')).toBe(false)
  })
})

describe('agent-control tools', () => {
  it('registers plan/todo/question/web tools without approval', () => {
    const tools = createToolRegistry()
    const names = new Set(tools.map((t) => t.name))
    expect(names.has('manage_todo')).toBe(true)
    expect(names.has('submit_plan')).toBe(true)
    expect(names.has('ask_user_question')).toBe(true)
    expect(names.has('web_search')).toBe(true)
    expect(names.has('read_url')).toBe(true)

    for (const name of ['manage_todo', 'submit_plan', 'ask_user_question', 'web_search', 'read_url']) {
      const tool = tools.find((t) => t.name === name)
      expect(tool!.requiresApproval).toBeFalsy()
    }
  })

  it('exposes definitions for the new tools with correct schema', () => {
    const defs = toToolDefinitions(createToolRegistry())
    const plan = defs.find((d) => d.function.name === 'submit_plan')
    expect(plan).toBeTruthy()
    const props = plan!.function.parameters.properties
    expect(props.title).toBeTruthy()
    expect(props.steps).toBeTruthy()
  })

  it('filters tool definitions by name (plan mode)', () => {
    const executor = new ToolExecutor()
    const planDefs = executor.getToolDefinitions((name) => name !== 'write_file')
    expect(planDefs.some((d) => d.function.name === 'write_file')).toBe(false)
    expect(planDefs.some((d) => d.function.name === 'read_file')).toBe(true)
  })

  it('previews the new tools', () => {
    const executor = new ToolExecutor()
    expect(executor.getPreview({ id: '1', name: 'web_search', arguments: { query: 'electron docs' } })).toContain('electron docs')
    expect(executor.getPreview({ id: '1', name: 'submit_plan', arguments: { title: '重构' } })).toContain('重构')
    expect(executor.getPreview({ id: '1', name: 'read_url', arguments: { url: 'https://example.com' } })).toContain('example.com')
    // MCP tools preview
    expect(executor.getPreview({ id: '1', name: 'mcp__github__createIssue', arguments: { title: 'x' } })).toContain('MCP 工具')
  })
})
