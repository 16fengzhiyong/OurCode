import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

// Monaco's browser modules reference `window` at import time, which the Node
// test env can't provide — replace the singleton with an empty stub. The
// tested actions never touch monaco (that's editor-runtime territory).
// vi.mock is hoisted by vitest, so it runs before the imports below.
vi.mock('@/editor/monacoSetup', () => ({ monaco: {} }))

// The store persists through window.electronAPI in actions; stub it here (the
// localStorage/document globals come from vitest.setup.ts which runs before
// imports). Not touching window at module load, so this placement is safe.
const mockApi = {
  getSessions: vi.fn(async () => []),
  saveSession: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
  checkpointList: vi.fn(async () => []),
  checkpointSave: vi.fn(async () => {}),
  checkpointDelete: vi.fn(async () => {}),
  saveConfigGroup: vi.fn(async () => ({})),
  getConfigGroups: vi.fn(async () => []),
}
vi.stubGlobal('window', { electronAPI: mockApi })

import { useChatStore, stopGitBranchPolling, trimHistoryForContext, compactToolResults, sanitizeToolPairing, generateSessionTitle, generateAiSessionTitle, estimateSessionHistoryTokens, estimateContextTokens, DEFAULT_SESSION_TITLE } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { useEditorStore } from '@/stores/editorStore'
import { createToolRegistry } from '@/services/tools/ToolRegistry'

// Capture the pristine initial state so each test starts clean
const initialState = useChatStore.getState()

function makeSession(id = 's1') {
  useChatStore.getState().createSession('cfg-1')
  // createSession prepends and sets activeSessionId to the generated uuid;
  // rename to the readable id AND keep activeSessionId in sync
  const s = useChatStore.getState().sessions[0]
  useChatStore.setState((st) => ({
    activeSessionId: id,
    sessions: st.sessions.map((x) => (x.id === s.id ? { ...x, id } : x)),
  }))
  return id
}

function addUser(sessionId: string, content: string) {
  useChatStore.getState().addMessage(sessionId, { role: 'user', content })
}

function addAssistant(sessionId: string, content: string) {
  useChatStore.getState().addMessage(sessionId, { role: 'assistant', content })
}

describe('chatStore message management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChatStore.setState({
      ...initialState,
      sessions: [],
      activeSessionId: null,
      undoStack: [],
      queuedMessagesBySession: {},
    })
  })

  afterAll(() => {
    stopGitBranchPolling()
  })

  it('addMessage appends with dense sortOrder and token estimate', () => {
    makeSession()
    addUser('s1', 'hello')
    addAssistant('s1', 'hi there')
    const msgs = useChatStore.getState().getActiveSession()!.messages
    expect(msgs).toHaveLength(2)
    expect(msgs.map((m) => m.sortOrder)).toEqual([0, 1])
    expect(msgs[0].role).toBe('user')
    expect(msgs[1].tokenCount).toBeGreaterThan(0)
  })

  it('editMessage updates content, editedAt and persists', () => {
    makeSession()
    addUser('s1', 'old text')
    const msgId = useChatStore.getState().getActiveSession()!.messages[0].id
    useChatStore.getState().editMessage('s1', msgId, 'new text')
    const msg = useChatStore.getState().getActiveSession()!.messages[0]
    expect(msg.content).toBe('new text')
    expect(msg.editedAt).toBeGreaterThan(0)
    expect(mockApi.saveSession).toHaveBeenCalled()
  })

  it('deleteMessage removes one message and keeps sortOrder dense', () => {
    makeSession()
    addUser('s1', 'a')
    addAssistant('s1', 'b')
    addUser('s1', 'c')
    const msgs = useChatStore.getState().getActiveSession()!.messages
    useChatStore.getState().deleteMessage('s1', msgs[1].id)
    const remaining = useChatStore.getState().getActiveSession()!.messages
    expect(remaining.map((m) => m.content)).toEqual(['a', 'c'])
    expect(remaining.map((m) => m.sortOrder)).toEqual([0, 1])
    expect(useChatStore.getState().undoStack).toHaveLength(1)
  })

  it('deleteMessages removes several and reindexes', () => {
    makeSession()
    addUser('s1', 'a')
    addAssistant('s1', 'b')
    addUser('s1', 'c')
    addAssistant('s1', 'd')
    const msgs = useChatStore.getState().getActiveSession()!.messages
    useChatStore.getState().deleteMessages('s1', [msgs[0].id, msgs[2].id])
    const remaining = useChatStore.getState().getActiveSession()!.messages
    expect(remaining.map((m) => m.content)).toEqual(['b', 'd'])
    expect(remaining.map((m) => m.sortOrder)).toEqual([0, 1])
    expect(useChatStore.getState().undoStack[0].messages).toHaveLength(2)
  })

  it('undoDelete restores deleted messages within the window', () => {
    makeSession()
    addUser('s1', 'a')
    addAssistant('s1', 'b')
    const msgs = useChatStore.getState().getActiveSession()!.messages
    useChatStore.getState().deleteMessage('s1', msgs[1].id)
    useChatStore.getState().undoDelete()
    const restored = useChatStore.getState().getActiveSession()!.messages
    expect(restored.map((m) => m.content)).toEqual(['a', 'b'])
    expect(restored.map((m) => m.sortOrder)).toEqual([0, 1])
    expect(useChatStore.getState().undoStack).toHaveLength(0)
  })

  it('undoDelete discards entries older than the 5s window', () => {
    makeSession()
    addUser('s1', 'a')
    addAssistant('s1', 'b')
    const msgs = useChatStore.getState().getActiveSession()!.messages
    useChatStore.getState().deleteMessage('s1', msgs[1].id)
    // Age the entry beyond the undo window
    useChatStore.setState((st) => ({
      undoStack: st.undoStack.map((e) => ({ ...e, timestamp: Date.now() - 6000 })),
    }))
    useChatStore.getState().undoDelete()
    expect(useChatStore.getState().getActiveSession()!.messages).toHaveLength(1)
    expect(useChatStore.getState().undoStack).toHaveLength(0)
  })

  it('reorderMessages moves a message and reindexes', () => {
    makeSession()
    addUser('s1', 'a')
    addAssistant('s1', 'b')
    addUser('s1', 'c')
    useChatStore.getState().reorderMessages('s1', 2, 0)
    const msgs = useChatStore.getState().getActiveSession()!.messages
    expect(msgs.map((m) => m.content)).toEqual(['c', 'a', 'b'])
    expect(msgs.map((m) => m.sortOrder)).toEqual([0, 1, 2])
  })

  it('clearMessages empties the session', () => {
    makeSession()
    addUser('s1', 'a')
    useChatStore.getState().clearMessages('s1')
    expect(useChatStore.getState().getActiveSession()!.messages).toHaveLength(0)
  })

  it('createSession sets it active and persists', () => {
    makeSession()
    const s = useChatStore.getState().getActiveSession()!
    expect(s.configGroupId).toBe('cfg-1')
    expect(s.agentMode).toBe('chat')
    expect(mockApi.saveSession).toHaveBeenCalled()
  })

  it('updateSessionModel with a configGroupId rebinds the session to that group', () => {
    makeSession()
    useChatStore.getState().updateSessionModel('s1', 'LongCat-2.0', 'cfg-longcat')
    const s = useChatStore.getState().getActiveSession()!
    expect(s.model).toBe('LongCat-2.0')
    expect(s.configGroupId).toBe('cfg-longcat')
  })

  it('updateSessionModel without a configGroupId keeps the existing binding', () => {
    makeSession()
    useChatStore.getState().updateSessionModel('s1', 'gpt-4o')
    const s = useChatStore.getState().getActiveSession()!
    expect(s.model).toBe('gpt-4o')
    expect(s.configGroupId).toBe('cfg-1')
  })

  it('updateSessionConfigGroup rebinds without touching the model', () => {
    makeSession()
    useChatStore.getState().updateSessionModel('s1', 'LongCat-2.0')
    useChatStore.getState().updateSessionConfigGroup('s1', 'cfg-longcat')
    const s = useChatStore.getState().getActiveSession()!
    expect(s.model).toBe('LongCat-2.0')
    expect(s.configGroupId).toBe('cfg-longcat')
  })

  it('exportSession markdown renders roles and content', () => {
    makeSession()
    addUser('s1', '你好')
    addAssistant('s1', '世界')
    const md = useChatStore.getState().exportSession('s1', 'markdown')
    expect(md).toContain('你')
    expect(md).toContain('世界')
    expect(md).toContain('用户') // role markers
  })
})

describe('chatStore generateSessionTitle', () => {
  it('uses the first non-empty line of the message', () => {
    expect(generateSessionTitle('\n\n修复登录页的按钮样式\n\n详见如下')).toBe('修复登录页的按钮样式')
  })

  it('strips markdown-ish prefixes', () => {
    expect(generateSessionTitle('# 重构数据库查询')).toBe('重构数据库查询')
    expect(generateSessionTitle('- 添加单元测试')).toBe('添加单元测试')
    expect(generateSessionTitle('> 引用内容')).toBe('引用内容')
  })

  it('caps long titles at 30 chars with an ellipsis', () => {
    const long = '这'.repeat(40)
    expect(generateSessionTitle(long)).toBe('这'.repeat(30) + '…')
  })

  it('generateAiSessionTitle returns "" when no API is configured', async () => {
    // The test env has no config groups → the LLM call is skipped entirely
    const title = await generateAiSessionTitle('修复登录页按钮样式')
    expect(title).toBe('')
  })

  it('returns the raw first line when stripping leaves nothing', () => {
    expect(generateSessionTitle('---')).toBe('---')
  })

  it('new sessions start with the default title', () => {
    expect(DEFAULT_SESSION_TITLE).toBe('新对话')
    makeSession()
    expect(useChatStore.getState().sessions[0].title).toBe(DEFAULT_SESSION_TITLE)
  })
})

describe('chatStore trimHistoryForContext', () => {
  it('keeps everything when within the model budget', () => {
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'hello' },
      { role: 'assistant' as const, content: 'hi' },
    ]
    const result = trimHistoryForContext(messages, 'gpt-4o')
    expect(result).toHaveLength(3)
    expect(result.some((m) => m.content.includes('上下文管理'))).toBe(false)
  })

  it('drops the oldest messages over budget and inserts a notice', () => {
    const longText = 'x'.repeat(380000) // ≈ 114k tokens (over the 102k gpt-4o budget)
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: longText },
      { role: 'assistant' as const, content: 'a' },
      { role: 'user' as const, content: 'current question' },
    ]
    const result = trimHistoryForContext(messages, 'gpt-4o') // 128k budget, 80% → 102k
    expect(result.some((m) => m.content === longText)).toBe(false)
    expect(result.some((m) => m.content.includes('上下文管理'))).toBe(true)
    expect(result[result.length - 1].content).toBe('current question')
  })

  it('never drops the system message or the newest message', () => {
    const big = 'y'.repeat(200000)
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: big },
      { role: 'user' as const, content: big },
    ]
    const result = trimHistoryForContext(messages, 'gpt-4o')
    expect(result[0].role).toBe('system')
    expect(result[result.length - 1].content).toBe(big)
  })

  it('uses a large default budget when the model is unknown', () => {
    const small = 'z'.repeat(10000) // ~5k tokens — far under any default
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: small },
    ]
    expect(trimHistoryForContext(messages, 'unknown-model-xyz')).toHaveLength(2)
  })
})

describe('chatStore compactToolResults', () => {
  const bigTool = (id: string) => ({ role: 'tool' as const, content: 'x'.repeat(9000), toolCallId: id })

  it('keeps the most recent tool results untouched and compresses older long ones', () => {
    // 8 tool results (> MAX_UNCOMPACTED_TOOL_RESULTS = 5) with long content
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'question' },
      ...Array.from({ length: 8 }, (_, i) => bigTool(`t${i}`)),
    ]
    const result = compactToolResults(messages)
    // 消息数与 role/toolCallId 全部保留（tool 配对完整性）
    expect(result).toHaveLength(10)
    result.forEach((m, i) => {
      if (i >= 2) expect(m.role).toBe('tool')
      if (i >= 2 && m.role === 'tool') expect(m.toolCallId).toBe(`t${i - 2}`)
    })
    // 最早的 3 条被压缩，最新的 5 条保留原文
    expect(result[2].content).toContain('已压缩')
    expect(result[3].content).toContain('已压缩')
    expect(result[4].content).toContain('已压缩')
    expect(result[5].content).toBe('x'.repeat(9000))
    expect(result[result.length - 1].content).toBe('x'.repeat(9000))
  })

  it('does not compress short tool results or recent ones', () => {
    const messages = [
      { role: 'tool' as const, content: 'short', toolCallId: 'a' },
      { role: 'tool' as const, content: 'x'.repeat(5000), toolCallId: 'b' }, // long but within the newest 5
    ]
    const result = compactToolResults(messages)
    expect(result[0].content).toBe('short')
    expect(result[1].content).toBe('x'.repeat(5000))
  })

  it('preserves non-tool messages as-is', () => {
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'hello' },
    ]
    expect(compactToolResults(messages)).toEqual(messages)
  })
})

describe('chatStore estimateSessionHistoryTokens', () => {
  it('compacts old oversized tool results the same way the live request does', () => {
    // 20 huge tool results — the 5 newest stay verbatim (≈30k tokens each),
    // the 15 oldest collapse to a short note (~40 tokens) like compactToolResults.
    const tools = Array.from({ length: 20 }, (_, i) => ({
      role: 'tool' as const,
      content: 'x'.repeat(100000),
      toolCallId: `t${i}`,
    }))
    const messages = [
      { role: 'user' as const, content: '帮我看看' },
      { role: 'assistant' as const, content: '好的' },
      ...tools,
    ]
    const total = estimateSessionHistoryTokens(messages)
    expect(total).toBeGreaterThan(5 * 30000) // newest 5 counted verbatim
    expect(total).toBeLessThan(6 * 30000) // oldest 15 compacted, not full
  })

  it('calibrated estimate is far below the old double-counted one', () => {
    const mixed = '帮我看看为什么构建失败 fix the build error now please'
    const messages = [{ role: 'user' as const, content: mixed }]
    const total = estimateSessionHistoryTokens(messages)
    // Old formula ≈ 18×2 + 6×1.3 + ~17×0.5 ≈ 53; new ≈ 18×1.2 + 23×0.3 ≈ 28
    expect(total).toBeLessThan(35)
  })
})

describe('chatStore estimateContextTokens', () => {
  it('baselines on real API usage and estimates only messages added since', () => {
    const base = [
      { role: 'user' as const, content: '你好' },
      { role: 'assistant' as const, content: '好的' },
    ]
    const session = {
      lastContextTokens: 150000, // billing-accurate usage from last API response
      lastContextMessageCount: base.length,
      messages: [
        ...base,
        { role: 'user' as const, content: '继续' },
        { role: 'assistant' as const, content: '完成' },
      ],
    }
    const total = estimateContextTokens(session)
    // 150000 baseline + only the 2 new messages estimated (a few tokens)
    expect(total).toBeGreaterThan(150000)
    expect(total).toBeLessThan(150000 + 50)
  })

  it('falls back to pure estimation when no real baseline was recorded', () => {
    const session = {
      messages: [{ role: 'user' as const, content: '你好世界' }],
    }
    expect(estimateContextTokens(session)).toBe(estimateSessionHistoryTokens(session.messages))
  })
})

describe('chatStore sanitizeToolPairing', () => {
  const asst = (content: string, callIds: string[] = []) => ({
    role: 'assistant' as const,
    content,
    toolCalls: callIds.length > 0
      ? callIds.map((id) => ({ id, type: 'function' as const, function: { name: 'f', arguments: '{}' } }))
      : undefined,
  })
  const tool = (id: string) => ({ role: 'tool' as const, content: `result of ${id}`, toolCallId: id })

  it('keeps a complete tool round-trip intact', () => {
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'q' },
      asst('', ['c1']),
      tool('c1'),
      asst('answer'),
      { role: 'user' as const, content: 'follow-up' },
    ]
    expect(sanitizeToolPairing(messages)).toEqual(messages)
  })

  it('keeps multiple tool responses for one round in order', () => {
    const messages = [
      { role: 'user' as const, content: 'q' },
      asst('', ['c1', 'c2']),
      tool('c1'),
      tool('c2'),
      asst('answer'),
    ]
    expect(sanitizeToolPairing(messages)).toEqual(messages)
  })

  it('strips toolCalls from an assistant message whose responses are missing', () => {
    const messages = [
      { role: 'user' as const, content: 'q' },
      asst('', ['c1']),
      asst('answer'),
    ]
    const result = sanitizeToolPairing(messages)
    expect(result).toHaveLength(3)
    expect(result[1].role).toBe('assistant')
    expect(result[1].toolCalls).toBeUndefined()
  })

  it('strips a partial round (some ids unanswered) and drops its stray responses', () => {
    const messages = [
      { role: 'user' as const, content: 'q' },
      asst('', ['c1', 'c2']),
      tool('c1'), // c2 never answered
      { role: 'user' as const, content: 'next' },
    ]
    const result = sanitizeToolPairing(messages)
    expect(result.filter((m) => m.role === 'tool')).toHaveLength(0)
    const asstMsg = result.find((m) => m.content === '')
    expect(asstMsg?.toolCalls).toBeUndefined()
  })

  it('drops orphaned tool messages that answer no tool_calls', () => {
    const messages = [
      { role: 'user' as const, content: 'q' },
      tool('c9'),
      { role: 'user' as const, content: 'next' },
    ]
    const result = sanitizeToolPairing(messages)
    expect(result).toEqual([
      { role: 'user', content: 'q' },
      { role: 'user', content: 'next' },
    ])
  })

  it('strips an unanswered round that ends the history', () => {
    const messages = [
      { role: 'user' as const, content: 'q' },
      asst('', ['c1']),
    ]
    const result = sanitizeToolPairing(messages)
    expect(result[1].toolCalls).toBeUndefined()
  })
})

describe('chatStore agent run state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useChatStore.setState({
      ...initialState,
      sessions: [],
      activeSessionId: null,
      undoStack: [],
      queuedMessagesBySession: {},
      activeRuns: {},
      agentTraces: {},
      batchApprovedBySession: {},
      toolAllowlist: {},
      batchApproval: null,
    })
  })

  it('setAgentMode persists the agent mode on the session', () => {
    makeSession()
    useChatStore.getState().setAgentMode('s1', 'agent')
    expect(useChatStore.getState().sessions[0].agentMode).toBe('agent')
    expect(useChatStore.getState().sessions[0].projectEditMode).toBeUndefined()
  })

  it('setTargetMode persists the target mode on the session', () => {
    makeSession()
    useChatStore.getState().setTargetMode('s1', true)
    expect(useChatStore.getState().sessions[0].targetMode).toBe(true)
    useChatStore.getState().setTargetMode('s1', false)
    expect(useChatStore.getState().sessions[0].targetMode).toBe(false)
  })

  it('createSession defaults to agent mode inside a project, chat outside', () => {
    // Inside a project (open folder) → agent mode, bound to that project
    useUIStore.getState().enterProject('/proj-a')
    useChatStore.getState().createSession('cfg-1')
    const inProject = useChatStore.getState().sessions[0]
    expect(inProject.agentMode).toBe('agent')
    expect(inProject.projectPath).toBe('/proj-a')
    // Target mode is never defaulted on
    expect(inProject.targetMode).toBeUndefined()

    // The current project follows the ACTIVE SESSION: a new conversation with
    // no explicit project inherits the active session's bound project, even
    // after the browsed folder is closed.
    useUIStore.getState().setRootPath(null)
    useChatStore.getState().createSession('cfg-1')
    const followsSession = useChatStore.getState().sessions[0]
    expect(followsSession.projectPath).toBe('/proj-a')
    expect(followsSession.agentMode).toBe('agent')

    // No session-bound project AND no open folder → plain chat, unbound
    useChatStore.setState({ sessions: [], activeSessionId: null })
    useChatStore.getState().createSession('cfg-1')
    const outside = useChatStore.getState().sessions[0]
    expect(outside.agentMode).toBe('chat')
    expect(outside.projectPath).toBeUndefined()
  })

  it('blocks enabling target mode while another session of the same project runs it', () => {
    makeSession('s1')
    useChatStore.setState((st) => ({ sessions: st.sessions.map((s) => ({ ...s, projectPath: '/proj' })) }))
    useChatStore.getState().setTargetMode('s1', true)
    expect(useChatStore.getState().sessions.find((s) => s.id === 's1')!.targetMode).toBe(true)

    // Second session, same project — must be refused
    makeSession('s2')
    useChatStore.setState((st) => ({ sessions: st.sessions.map((s) => (s.id === 's2' ? { ...s, projectPath: '/proj' } : s)) }))
    useChatStore.getState().setTargetMode('s2', true)
    expect(useChatStore.getState().sessions.find((s) => s.id === 's2')!.targetMode).toBeUndefined()

    // A different project is fine
    useChatStore.setState((st) => ({ sessions: st.sessions.map((s) => (s.id === 's2' ? { ...s, projectPath: '/other' } : s)) }))
    useChatStore.getState().setTargetMode('s2', true)
    expect(useChatStore.getState().sessions.find((s) => s.id === 's2')!.targetMode).toBe(true)
  })

  it('switches auto_edit/plan to manual confirm when target mode is enabled', () => {
    makeSession()
    useChatStore.getState().setProjectEditMode('s1', 'auto_edit')
    useChatStore.getState().setTargetMode('s1', true)
    expect(useChatStore.getState().sessions[0].targetMode).toBe(true)
    expect(useChatStore.getState().sessions[0].projectEditMode).toBe('confirm_before_change')
  })

  it('startAgentRun creates a run record, sets activeRuns and resets the trace', () => {
    makeSession()
    useChatStore.getState().startAgentRun('s1', '重构 auth 模块')
    const st = useChatStore.getState()
    expect(st.activeRuns['s1']?.sessionId).toBe('s1')
    expect(st.batchApprovedBySession['s1']).toBe(false)
    const session = st.sessions.find((s) => s.id === 's1')!
    expect(session.agentRuns).toHaveLength(1)
    expect(session.agentRuns![0].task).toBe('重构 auth 模块')
    expect(session.agentRuns![0].status).toBe('running')

    // A new user turn starts a fresh run
    useChatStore.getState().startAgentRun('s1', '新任务')
    const st2 = useChatStore.getState()
    expect(st2.sessions.find((s) => s.id === 's1')!.agentRuns).toHaveLength(2)
    expect(st2.activeRuns['s1']?.runId).not.toBe(st.activeRuns['s1']?.runId)
    expect(st2.batchApprovedBySession['s1']).toBe(false)
  })

  it('startAgentRun with resumeRunId reuses the existing run record', () => {
    makeSession()
    useChatStore.getState().startAgentRun('s1', '任务')
    const runId = useChatStore.getState().activeRuns['s1']!.runId
    // Plan approval resumes the same run
    useChatStore.getState().startAgentRun('s1', '任务', { resumeRunId: runId })
    const st = useChatStore.getState()
    expect(st.sessions.find((s) => s.id === 's1')!.agentRuns).toHaveLength(1)
    expect(st.activeRuns['s1']?.runId).toBe(runId)
    expect(st.batchApprovedBySession['s1']).toBe(false)
    expect(st.sessions.find((s) => s.id === 's1')!.agentRuns![0].status).toBe('running')
  })

  it('finishAgentRun records counts/status and caps agentRuns at 20', () => {
    makeSession()
    // Fill past the cap
    for (let i = 0; i < 22; i++) {
      useChatStore.getState().startAgentRun('s1', `任务 ${i}`)
    }
    const st = useChatStore.getState()
    expect(st.sessions.find((s) => s.id === 's1')!.agentRuns).toHaveLength(20)
    const runId = st.activeRuns['s1']!.runId

    useChatStore.getState().setRunStatus(runId, 'approved_running')
    useChatStore.getState().appendTrace('s1', { id: 't1', toolCallId: 'c1', name: 'read_file', kind: 'search', status: 'success', summary: 'auth.ts' })
    useChatStore.getState().appendTrace('s1', { id: 't2', toolCallId: 'c2', name: 'edit_file', kind: 'edit', status: 'success', summary: 'auth.ts' })
    useChatStore.getState().finishAgentRun('s1', runId, 'done')

    // Re-read state — zustand's set() produces a new sessions array
    const st2 = useChatStore.getState()
    const run = st2.sessions.find((s) => s.id === 's1')!.agentRuns!.find((r) => r.id === runId)!
    expect(run.status).toBe('done')
    expect(run.finishedAt).toBeGreaterThan(0)
    expect(run.toolCallCount).toBe(2)
    expect(run.fileChangeCount).toBe(1) // only the edit kind
    expect(st2.batchApprovedBySession['s1']).toBe(false)
  })

  it('finishAgentRun persists the run token totals', () => {
    makeSession()
    useChatStore.getState().startAgentRun('s1', '任务')
    const runId = useChatStore.getState().activeRuns['s1']!.runId

    useChatStore.getState().finishAgentRun('s1', runId, 'done', {
      tokensIn: 1200,
      tokensOut: 340,
      requestCount: 7,
      cacheHits: 3,
      cacheTokensSaved: 12400,
    })

    const run = useChatStore.getState().sessions.find((s) => s.id === 's1')!.agentRuns!.find((r) => r.id === runId)!
    expect(run.status).toBe('done')
    expect(run.tokensIn).toBe(1200)
    expect(run.tokensOut).toBe(340)
    // New usage-detail fields (token badge popover data)
    expect(run.requestCount).toBe(7)
    expect(run.cacheHits).toBe(3)
    expect(run.cacheTokensSaved).toBe(12400)
  })

  it('decideBatchApproval clears the dialog and approveBatchRun sets the flag', () => {
    makeSession()
    useChatStore.setState({ batchApproval: { sessionId: 's1', runId: 'r1', tools: [{ id: 'c1', name: 'write_file', arguments: { path: '/tmp/a.ts' } }] } })
    // The loop resolves the dialog, then (for "all") flips the run to batch-approved
    useChatStore.getState().decideBatchApproval('all')
    expect(useChatStore.getState().batchApproval).toBeNull()
    // No run started → no per-session batch flag exists yet
    expect(useChatStore.getState().batchApprovedBySession['s1']).toBeUndefined()
    useChatStore.getState().approveBatchRun('s1')
    expect(useChatStore.getState().batchApprovedBySession['s1']).toBe(true)
  })

  it('allowToolPermanently persists to localStorage and clearToolAllowlist removes it', () => {
    // vitest.setup stubs localStorage as a no-op; swap in an in-memory map so
    // the persistence contract is actually exercised.
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, v) },
      removeItem: (k: string) => { mem.delete(k) },
      clear: () => mem.clear(),
      key: () => null,
      length: 0,
    })

    makeSession()
    // Give the session a project path so the allowlist has a scope
    useChatStore.setState((st) => ({
      sessions: st.sessions.map((s) => (s.id === 's1' ? { ...s, projectPath: 'C:/proj' } : s)),
    }))
    useChatStore.getState().allowToolPermanently('run_command')
    expect(useChatStore.getState().toolAllowlist['C:/proj']).toEqual(['run_command'])
    expect(JSON.parse(mem.get('ourcode-tool-allowlist:C:/proj') || '[]')).toEqual(['run_command'])
    useChatStore.getState().clearToolAllowlist('C:/proj')
    expect(useChatStore.getState().toolAllowlist['C:/proj']).toBeUndefined()
    expect(mem.get('ourcode-tool-allowlist:C:/proj')).toBeUndefined()
  })

  it('deleteAgentRun removes the record and clears activeRuns when active', () => {
    makeSession()
    useChatStore.getState().startAgentRun('s1', '任务')
    const runId = useChatStore.getState().activeRuns['s1']!.runId
    useChatStore.getState().deleteAgentRun('s1', runId)
    const st = useChatStore.getState()
    expect(st.sessions.find((s) => s.id === 's1')!.agentRuns).toHaveLength(0)
    expect(st.activeRuns['s1']).toBeUndefined()
  })

  it('supports parallel running sessions — stopGeneration only aborts its own controller', () => {
    makeSession('s1')
    makeSession('s2')
    const ac1 = new AbortController()
    const ac2 = new AbortController()
    useChatStore.setState({
      runningSessionIds: ['s1', 's2'],
      abortControllers: { s1: ac1, s2: ac2 },
    })
    const spy1 = vi.spyOn(ac1, 'abort')
    const spy2 = vi.spyOn(ac2, 'abort')
    useChatStore.getState().stopGeneration('s1')
    expect(spy1).toHaveBeenCalledTimes(1)
    expect(spy2).not.toHaveBeenCalled()
    expect(useChatStore.getState().abortControllers['s1']).toBeUndefined()
    expect(useChatStore.getState().abortControllers['s2']).toBe(ac2)
  })

  it('queueMessage is scoped per session and clearQueue only clears its own', () => {
    useChatStore.getState().queueMessage('s1', '第一条')
    useChatStore.getState().queueMessage('s1', '第二条')
    useChatStore.getState().queueMessage('s2', '另一条')
    const q = useChatStore.getState().queuedMessagesBySession
    expect(q['s1']).toEqual(['第一条', '第二条'])
    expect(q['s2']).toEqual(['另一条'])
    useChatStore.getState().clearQueue('s1')
    expect(useChatStore.getState().queuedMessagesBySession['s1']).toBeUndefined()
    expect(useChatStore.getState().queuedMessagesBySession['s2']).toEqual(['另一条'])
  })

  it('removeQueuedMessage deletes only the given index and keeps order', () => {
    useChatStore.getState().queueMessage('s1', 'A')
    useChatStore.getState().queueMessage('s1', 'B')
    useChatStore.getState().queueMessage('s1', 'C')
    useChatStore.getState().removeQueuedMessage('s1', 1)
    expect(useChatStore.getState().queuedMessagesBySession['s1']).toEqual(['A', 'C'])
    // Invalid index / unknown session are no-ops
    useChatStore.getState().removeQueuedMessage('s1', 5)
    useChatStore.getState().removeQueuedMessage('s1', -1)
    useChatStore.getState().removeQueuedMessage('s2', 0)
    expect(useChatStore.getState().queuedMessagesBySession['s1']).toEqual(['A', 'C'])
  })

  it('sendQueuedNow stops the run and promotes the picked message to the front', () => {
    const ac = new AbortController()
    useChatStore.setState({ runningSessionIds: ['s1'], abortControllers: { s1: ac } })
    useChatStore.getState().queueMessage('s1', 'A')
    useChatStore.getState().queueMessage('s1', 'B')
    useChatStore.getState().queueMessage('s1', 'C')
    const abortSpy = vi.spyOn(ac, 'abort')
    useChatStore.getState().sendQueuedNow('s1', 2)
    // The picked message is now first (drained next by the aborted run's finally)
    expect(useChatStore.getState().queuedMessagesBySession['s1']).toEqual(['C', 'A', 'B'])
    // stopGeneration aborted the controller and dropped it from the map
    expect(abortSpy).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().abortControllers['s1']).toBeUndefined()
  })

  it('sendQueuedNow with an invalid index is a no-op', () => {
    const ac = new AbortController()
    useChatStore.setState({ runningSessionIds: ['s1'], abortControllers: { s1: ac } })
    useChatStore.getState().queueMessage('s1', 'A')
    const abortSpy = vi.spyOn(ac, 'abort')
    useChatStore.getState().sendQueuedNow('s1', 3)
    useChatStore.getState().sendQueuedNow('s1', -1)
    expect(useChatStore.getState().queuedMessagesBySession['s1']).toEqual(['A'])
    expect(abortSpy).not.toHaveBeenCalled()
  })

  it('createSession binds to an explicitly passed projectPath', () => {
    useChatStore.getState().createSession('cfg-1', '/explicit/proj')
    const s = useChatStore.getState().sessions[0]
    expect(s.projectPath).toBe('/explicit/proj')
    expect(s.agentMode).toBe('agent')
  })
})

describe('chatStore cross-session messaging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useChatStore.setState({
      ...initialState,
      sessions: [],
      activeSessionId: null,
      runningSessionIds: [],
      undoStack: [],
      queuedMessagesBySession: {},
      inboundQueue: [],
      activeRuns: {},
      agentTraces: {},
      batchApprovedBySession: {},
      toolAllowlist: {},
      batchApproval: null,
    })
    // Sandbox the inbound policy so tests are independent of user preferences
    useEditorStore.setState((st) => ({ preferences: { ...st.preferences, crossSessionInbound: 'accept' } }))
  })

  it('receiveInboundMessage delivers a marked user message and persists', () => {
    makeSession('s1')
    makeSession('s2')
    const status = useChatStore.getState().receiveInboundMessage('会话一', 's2', '帮我看看 auth 模块')
    expect(status).toContain('已投递并触发')
    const target = useChatStore.getState().sessions.find((s) => s.id === 's2')!
    expect(target.messages).toHaveLength(1)
    expect(target.messages[0].role).toBe('user')
    expect(target.messages[0].content).toContain('[来自会话「会话一」的会话间消息]')
    expect(target.messages[0].content).toContain('帮我看看 auth 模块')
    expect(mockApi.saveSession).toHaveBeenCalled()
  })

  it('receiveInboundMessage queues the message while the target is generating', () => {
    makeSession('s1')
    makeSession('s2')
    // Simulate the target's agent loop being active
    useChatStore.setState({ runningSessionIds: ['s2'] })
    const status = useChatStore.getState().receiveInboundMessage('会话一', 's2', '忙完后告诉我')
    expect(status).toContain('已排队')
    const target = useChatStore.getState().sessions.find((s) => s.id === 's2')!
    expect(target.messages).toHaveLength(0) // not delivered yet
    expect(useChatStore.getState().inboundQueue).toHaveLength(1)
    expect(useChatStore.getState().inboundQueue[0].targetSessionId).toBe('s2')
  })

  it('receiveInboundMessage with hold=true appends without auto-processing', () => {
    makeSession('s1')
    makeSession('s2')
    const status = useChatStore.getState().receiveInboundMessage('会话一', 's2', '先放着', true)
    expect(status).toContain('hold')
    const target = useChatStore.getState().sessions.find((s) => s.id === 's2')!
    expect(target.messages).toHaveLength(1)
    expect(useChatStore.getState().inboundQueue).toHaveLength(0)
    expect(mockApi.saveSession).toHaveBeenCalled()
  })

  it('send_message tool rejects self-messaging and unknown targets', async () => {
    makeSession('s1')
    makeSession('s2')
    const tools = createToolRegistry()
    const sendMessage = tools.find((t) => t.name === 'send_message')!

    const self = await sendMessage.execute({ targetSessionId: 's1', message: 'hi' }, { sessionId: 's1' })
    expect(self).toContain('不能给自己发消息')

    const missing = await sendMessage.execute({ targetSessionId: 'ghost', message: 'hi' }, { sessionId: 's1' })
    expect(missing).toContain('不存在')

    // Nothing was delivered to s2 by the failed calls
    expect(useChatStore.getState().sessions.find((s) => s.id === 's2')!.messages).toHaveLength(0)
  })

  it('send_message tool honors the refuse policy', async () => {
    makeSession('s1')
    makeSession('s2')
    useEditorStore.setState((st) => ({ preferences: { ...st.preferences, crossSessionInbound: 'refuse' } }))
    const tools = createToolRegistry()
    const sendMessage = tools.find((t) => t.name === 'send_message')!
    const res = await sendMessage.execute({ targetSessionId: 's2', message: 'hi' }, { sessionId: 's1' })
    expect(res).toContain('拒绝')
    expect(useChatStore.getState().sessions.find((s) => s.id === 's2')!.messages).toHaveLength(0)
  })

  it('send_message tool resolves the target by title and reports delivery', async () => {
    makeSession('s1')
    makeSession('s2')
    useChatStore.getState().renameSession('s2', '收件人')
    const target = useChatStore.getState().sessions.find((s) => s.id === 's2')!
    const tools = createToolRegistry()
    const sendMessage = tools.find((t) => t.name === 'send_message')!
    const res = await sendMessage.execute({ targetTitle: '收件人', message: '请回复' }, { sessionId: 's1' })
    expect(res).toContain(target.title)
    expect(res).toContain('已发送')
    const targetMsgs = useChatStore.getState().sessions.find((s) => s.id === 's2')!.messages
    expect(targetMsgs).toHaveLength(1)
    expect(targetMsgs[0].content).toContain('请回复')
  })

  it('list_agents tool lists peer sessions and hides the caller', async () => {
    makeSession('s1')
    makeSession('s2')
    useChatStore.getState().renameSession('s2', '第二个会话')
    const tools = createToolRegistry()
    const listAgents = tools.find((t) => t.name === 'list_agents')!
    const res = await listAgents.execute({}, { sessionId: 's1' })
    expect(res).toContain('第二个会话')
    expect(res).toContain('s2')
    // The caller itself must not appear as a peer row
    expect(res).not.toContain('| s1 |')
  })
})

describe('chatStore questionGate (off-session ask confirm)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChatStore.setState({
      ...initialState,
      sessions: [],
      activeSessionId: null,
      undoStack: [],
      queuedMessagesBySession: {},
      pendingQuestion: null,
      questionGate: {},
    })
  })

  it('setQuestionGate stores the per-session gate', () => {
    useChatStore.getState().setQuestionGate('s1', 'confirm')
    expect(useChatStore.getState().questionGate.s1).toBe('confirm')
  })

  it('answerQuestion clears the gate alongside the pending question', () => {
    useChatStore.getState().setQuestionGate('s1', 'confirm')
    useChatStore.setState({ pendingQuestion: { sessionId: 's1', id: 'q1', question: 'test?' } })
    useChatStore.getState().answerQuestion('yes')
    expect(useChatStore.getState().pendingQuestion).toBeNull()
    expect(useChatStore.getState().questionGate.s1).toBeUndefined()
  })

  it('setActiveSession re-arms a dismissed gate for a session with a pending question', () => {
    makeSession('s1')
    makeSession('s2')
    useChatStore.getState().setQuestionGate('s2', 'dismissed')
    useChatStore.setState({ pendingQuestion: { sessionId: 's2', id: 'q1', question: 'test?' } })
    useChatStore.getState().setActiveSession('s2')
    expect(useChatStore.getState().questionGate.s2).toBe('confirm')
  })

  it('setActiveSession leaves an auto gate untouched', () => {
    makeSession('s1')
    makeSession('s2')
    useChatStore.getState().setQuestionGate('s2', 'auto')
    useChatStore.setState({ pendingQuestion: { sessionId: 's2', id: 'q1', question: 'test?' } })
    useChatStore.getState().setActiveSession('s2')
    expect(useChatStore.getState().questionGate.s2).toBe('auto')
  })

  it('stopGeneration clears the gate for the session', () => {
    useChatStore.getState().setQuestionGate('s1', 'confirm')
    useChatStore.getState().stopGeneration('s1')
    expect(useChatStore.getState().questionGate.s1).toBeUndefined()
  })
})
