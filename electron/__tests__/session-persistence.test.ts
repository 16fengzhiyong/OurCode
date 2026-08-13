import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { SQLiteStore } from '../services/sqlite-store'
import type { ChatSession } from '../../shared/types'

// better-sqlite3 ships a native binary built for the app's Electron runtime
// (Node ABI 123). Under a plain Node runner (e.g. system Node 24 / ABI 137)
// construction throws — skip the suite there instead of failing CI.
let sqliteUsable = true
try {
  new Database(':memory:').close()
} catch {
  sqliteUsable = false
}

describe.skipIf(!sqliteUsable)('SQLiteStore session persistence', () => {
  let root: string
  let store: SQLiteStore

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'session-persistence-test-'))
    store = new SQLiteStore(root)
  })

  afterEach(() => {
    store?.close()
    rmSync(root, { recursive: true, force: true })
  })

  function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
    const base: ChatSession = {
      id: 'sess-1',
      title: '新对话',
      configGroupId: 'group-1',
      model: '',
      modelParams: {},
      messages: [],
      createdAt: 1000,
      updatedAt: 1000,
    }
    return { ...base, ...overrides }
  }

  it('persists projectEditMode (完全访问) and lastUserMessageAt across save/load', () => {
    const session = makeSession({
      projectEditMode: 'full_access',
      lastUserMessageAt: 5_000,
    })
    store.saveSession(session)

    const [loaded] = store.getSessions()
    expect(loaded.projectEditMode).toBe('full_access')
    expect(loaded.lastUserMessageAt).toBe(5_000)
  })

  it('round-trips every project edit mode value', () => {
    for (const mode of ['confirm_before_change', 'auto_edit', 'plan', 'full_access'] as const) {
      store.saveSession(makeSession({ id: `sess-${mode}`, projectEditMode: mode }))
      const loaded = store.getSessions().find((s) => s.id === `sess-${mode}`)
      expect(loaded?.projectEditMode).toBe(mode)
    }
  })

  it('updates the persisted columns on re-save (UPDATE path)', () => {
    const session = makeSession({ projectEditMode: 'confirm_before_change', lastUserMessageAt: 1_000 })
    store.saveSession(session)
    // Second save — must hit the UPDATE branch, not INSERT.
    store.saveSession({ ...session, projectEditMode: 'full_access', lastUserMessageAt: 9_000 })

    const [loaded] = store.getSessions()
    expect(loaded.projectEditMode).toBe('full_access')
    expect(loaded.lastUserMessageAt).toBe(9_000)
  })

  it('falls back to the default mode when the renderer omits it, and keeps the sort anchor unset', () => {
    const session = makeSession()
    delete (session as any).projectEditMode
    delete (session as any).lastUserMessageAt
    store.saveSession(session)

    const [loaded] = store.getSessions()
    // The DB default (confirm_before_change) doubles as the UI fallback; the
    // sort anchor stays unset so the renderer derives it from messages.
    expect(loaded.projectEditMode).toBe('confirm_before_change')
    expect(loaded.lastUserMessageAt).toBeUndefined()
  })

  it('migrates old-schema databases by adding the two new columns', () => {
    // Build a DB with the OLD chat_sessions schema (no new columns), insert a
    // row, then open it with SQLiteStore — migrateTables must add the columns
    // without throwing and existing rows get the defaults.
    const dbDir = join(root, 'data')
    const dbPath = join(dbDir, 'ourcode.db')
    const old = new Database(dbPath)
    old.exec(`
      CREATE TABLE chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '新对话',
        config_group_id TEXT NOT NULL,
        model TEXT DEFAULT '',
        model_params TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO chat_sessions (id, title, config_group_id, model, model_params, created_at, updated_at)
      VALUES ('old-1', '旧会话', 'group-1', '', '{}', 100, 100);
    `)
    old.close()

    const migrated = new SQLiteStore(root)
    const cols = new Database(dbPath).prepare('PRAGMA table_info(chat_sessions)').all() as any[]
    new Database(dbPath).close()

    expect(cols.some((c: any) => c.name === 'project_edit_mode')).toBe(true)
    expect(cols.some((c: any) => c.name === 'last_user_message_at')).toBe(true)

    const [loaded] = migrated.getSessions()
    expect(loaded.id).toBe('old-1')
    // Old rows get the migration default (valid value — the UI default), and
    // the sort anchor is 0 → unset so the renderer derives it from messages.
    expect(loaded.projectEditMode).toBe('confirm_before_change')
    expect(loaded.lastUserMessageAt).toBeUndefined()
    migrated.close()
  })
})
