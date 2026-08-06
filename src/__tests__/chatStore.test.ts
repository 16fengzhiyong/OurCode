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

import { useChatStore, stopGitBranchPolling, trimHistoryForContext } from '@/stores/chatStore'

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
      queuedMessages: [],
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
    const longText = 'x'.repeat(250000) // ≈ 125k tokens (over the 102k gpt-4o budget)
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

describe('chatStore agent run state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useChatStore.setState({
      ...initialState,
      sessions: [],
      activeSessionId: null,
      undoStack: [],
      queuedMessages: [],
      activeRun: null,
      agentTrace: [],
      batchApproved: false,
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

  it('startAgentRun creates a run record, sets activeRun and resets the trace', () => {
    makeSession()
    useChatStore.getState().startAgentRun('s1', '重构 auth 模块', { autoRun: true })
    const st = useChatStore.getState()
    expect(st.activeRun?.sessionId).toBe('s1')
    expect(st.batchApproved).toBe(true)
    const session = st.sessions.find((s) => s.id === 's1')!
    expect(session.agentRuns).toHaveLength(1)
    expect(session.agentRuns![0].task).toBe('重构 auth 模块')
    expect(session.agentRuns![0].status).toBe('running')

    // A new user turn starts a fresh run
    useChatStore.getState().startAgentRun('s1', '新任务')
    const st2 = useChatStore.getState()
    expect(st2.sessions.find((s) => s.id === 's1')!.agentRuns).toHaveLength(2)
    expect(st2.activeRun?.runId).not.toBe(st.activeRun?.runId)
    expect(st2.batchApproved).toBe(false)
  })

  it('startAgentRun with resumeRunId reuses the existing run record', () => {
    makeSession()
    useChatStore.getState().startAgentRun('s1', '任务')
    const runId = useChatStore.getState().activeRun!.runId
    // Plan approval resumes the same run (batch auto-run on)
    useChatStore.getState().startAgentRun('s1', '任务', { resumeRunId: runId, autoRun: true })
    const st = useChatStore.getState()
    expect(st.sessions.find((s) => s.id === 's1')!.agentRuns).toHaveLength(1)
    expect(st.activeRun?.runId).toBe(runId)
    expect(st.batchApproved).toBe(true)
    expect(st.sessions.find((s) => s.id === 's1')!.agentRuns![0].status).toBe('approved_running')
  })

  it('finishAgentRun records counts/status and caps agentRuns at 20', () => {
    makeSession()
    // Fill past the cap
    for (let i = 0; i < 22; i++) {
      useChatStore.getState().startAgentRun('s1', `任务 ${i}`)
    }
    const st = useChatStore.getState()
    expect(st.sessions.find((s) => s.id === 's1')!.agentRuns).toHaveLength(20)
    const runId = st.activeRun!.runId

    useChatStore.getState().setRunStatus(runId, 'approved_running')
    useChatStore.getState().appendTrace({ id: 't1', toolCallId: 'c1', name: 'read_file', kind: 'search', status: 'success', summary: 'auth.ts' })
    useChatStore.getState().appendTrace({ id: 't2', toolCallId: 'c2', name: 'edit_file', kind: 'edit', status: 'success', summary: 'auth.ts' })
    useChatStore.getState().finishAgentRun('s1', runId, 'done')

    // Re-read state — zustand's set() produces a new sessions array
    const st2 = useChatStore.getState()
    const run = st2.sessions.find((s) => s.id === 's1')!.agentRuns!.find((r) => r.id === runId)!
    expect(run.status).toBe('done')
    expect(run.finishedAt).toBeGreaterThan(0)
    expect(run.toolCallCount).toBe(2)
    expect(run.fileChangeCount).toBe(1) // only the edit kind
    expect(st2.batchApproved).toBe(false)
  })

  it('decideBatchApproval clears the dialog and approveBatchRun sets the flag', () => {
    makeSession()
    useChatStore.setState({ batchApproval: { runId: 'r1', tools: [{ id: 'c1', name: 'write_file', arguments: { path: '/tmp/a.ts' } }] } })
    // The loop resolves the dialog, then (for "all") flips the run to batch-approved
    useChatStore.getState().decideBatchApproval('all')
    expect(useChatStore.getState().batchApproval).toBeNull()
    expect(useChatStore.getState().batchApproved).toBe(false)
    useChatStore.getState().approveBatchRun()
    expect(useChatStore.getState().batchApproved).toBe(true)
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

  it('deleteAgentRun removes the record and clears activeRun when active', () => {
    makeSession()
    useChatStore.getState().startAgentRun('s1', '任务')
    const runId = useChatStore.getState().activeRun!.runId
    useChatStore.getState().deleteAgentRun('s1', runId)
    const st = useChatStore.getState()
    expect(st.sessions.find((s) => s.id === 's1')!.agentRuns).toHaveLength(0)
    expect(st.activeRun).toBeNull()
  })
})
