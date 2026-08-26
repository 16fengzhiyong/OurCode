import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { SQLiteStore } from '../services/sqlite-store'
import type { ChatSession } from '../../shared/types'

// better-sqlite3 ships a native binary built for the app's Electron runtime.
// Skip when the host Node ABI cannot load it (e.g. system Node under a
// generic shell that isn't the project's bundled Electron).
let sqliteUsable = true
try {
  new Database(':memory:').close()
} catch {
  sqliteUsable = false
}

describe.skipIf(!sqliteUsable)('SQLiteStore.getSessions — one-company history fallback', () => {
  let root: string
  let store: SQLiteStore

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'get-sessions-mode-test-'))
    store = new SQLiteStore(root)
    // FK target required by saveSession.
    store.saveConfigGroup({
      id: 'group-1',
      name: 'test-group',
      baseUrl: '',
      apiKey: 'test-key',
      systemPrompt: '',
      defaultModel: '',
      provider: 'openai',
      customHeaders: {},
      createdAt: 0,
      updatedAt: 0,
    })
  })

  afterEach(() => {
    store?.close()
    rmSync(root, { recursive: true, force: true })
  })

  function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
    return {
      id: 'sess-1',
      title: '新对话',
      configGroupId: 'group-1',
      model: '',
      modelParams: {},
      messages: [],
      createdAt: 1000,
      updatedAt: 1000,
      ...overrides,
    }
  }

  it('returns empty when the database has no sessions at all', () => {
    expect(store.getSessions('main')).toHaveLength(0)
    expect(store.getSessions('office')).toHaveLength(0)
    expect(store.getSessions()).toHaveLength(0)
  })

  it('legacy main sessions surface in BOTH windows until the user creates an office session', () => {
    // Simulate a user who has used the app for a while in the main window
    // (every legacy session got mode='main' stamped by the column-add migration).
    store.saveSession(makeSession({ id: 'legacy-1', title: '昨天的对话', mode: 'main' }))
    store.saveSession(makeSession({ id: 'legacy-2', title: '上周的对话', mode: 'main' }))

    // Main window sees its own history.
    const mainIds = store.getSessions('main').map((s) => s.id)
    expect(mainIds).toEqual(expect.arrayContaining(['legacy-1', 'legacy-2']))

    // Office window ALSO sees them — the user's history must not vanish.
    const officeIds = store.getSessions('office').map((s) => s.id)
    expect(officeIds).toEqual(expect.arrayContaining(['legacy-1', 'legacy-2']))
  })

  it('once an office session exists, strict isolation kicks in: main does not see office and vice-versa', () => {
    store.saveSession(makeSession({ id: 'legacy-1', title: '历史', mode: 'main' }))
    store.saveSession(makeSession({ id: 'office-new', title: '新公司任务', mode: 'office' }))

    const mainIds = store.getSessions('main').map((s) => s.id)
    const officeIds = store.getSessions('office').map((s) => s.id)

    // Strict isolation now — legacy 'main' rows no longer leak into office,
    // and the brand-new 'office' row only shows up in its own window.
    expect(mainIds).toEqual(['legacy-1'])
    expect(officeIds).toEqual(['office-new'])
  })

  it('office window never shows a session whose mode is some unknown third value', () => {
    // The CHECK-style filter must not let stray rows leak through.
    store.saveSession(makeSession({ id: 'garbage', title: '?', mode: 'weird' as any }))
    expect(store.getSessions('office')).toHaveLength(0)
  })

  it('passing no mode returns everything (legacy callers and tests)', () => {
    store.saveSession(makeSession({ id: 'a', mode: 'main' }))
    store.saveSession(makeSession({ id: 'b', mode: 'office' }))
    const all = store.getSessions().map((s) => s.id)
    expect(all).toEqual(expect.arrayContaining(['a', 'b']))
  })
})
