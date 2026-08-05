import Database from 'better-sqlite3'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { CryptoService } from './crypto'
import { ApiConfigGroup, ChatSession, ChatMessage, ChatBranch, UserPreferences } from '../../shared/types'
import { DEFAULT_PREFERENCES } from '../../shared/constants'

/** Parse a JSON column safely ('' / null / invalid → fallback) */
function parseJsonField<T>(value: string | null | undefined, fallback: T): T {
  if (value === undefined || value === null || value === '') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export class SQLiteStore {
  private db: Database.Database
  private crypto: CryptoService
  private encryptChat: boolean = false

  constructor(userDataPath: string) {
    const dbDir = join(userDataPath, 'data')
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }

    const dbPath = join(dbDir, 'ourcode.db')
    this.db = new Database(dbPath)
    this.crypto = new CryptoService()

    this.initTables()
    this.migrateTables()
    this.loadEncryptFlag()
  }

  private loadEncryptFlag(): void {
    const row = this.db.prepare("SELECT value FROM user_preferences WHERE key = 'encryptChatData'").get() as any
    if (row) {
      try {
        this.encryptChat = JSON.parse(row.value) === true
      } catch { this.encryptChat = false }
    }
  }

  setEncryptChat(value: boolean): void {
    this.encryptChat = value
  }

  getCrypto(): CryptoService {
    return this.crypto
  }

  private migrateTables(): void {
    // Add color column if missing
    const columns = this.db.prepare("PRAGMA table_info(api_config_groups)").all() as any[]
    const hasColor = columns.some((c: any) => c.name === 'color')
    if (!hasColor) {
      this.db.exec("ALTER TABLE api_config_groups ADD COLUMN color TEXT DEFAULT ''")
    }
    // Add sort_order column if missing (for drag-reorder persistence)
    if (!columns.some((c: any) => c.name === 'sort_order')) {
      this.db.exec("ALTER TABLE api_config_groups ADD COLUMN sort_order INTEGER DEFAULT 0")
    }
    // Add edited_at column to chat_messages if missing
    const msgColumns = this.db.prepare("PRAGMA table_info(chat_messages)").all() as any[]
    const hasEditedAt = msgColumns.some((c: any) => c.name === 'edited_at')
    if (!hasEditedAt) {
      this.db.exec("ALTER TABLE chat_messages ADD COLUMN edited_at INTEGER DEFAULT 0")
    }
    // Add branch_id column to chat_messages if missing
    const hasBranchId = msgColumns.some((c: any) => c.name === 'branch_id')
    if (!hasBranchId) {
      this.db.exec("ALTER TABLE chat_messages ADD COLUMN branch_id TEXT DEFAULT ''")
    }
    // Add tool_calls / tool_results columns to chat_messages if missing
    if (!msgColumns.some((c: any) => c.name === 'tool_calls')) {
      this.db.exec("ALTER TABLE chat_messages ADD COLUMN tool_calls TEXT DEFAULT '[]'")
    }
    if (!msgColumns.some((c: any) => c.name === 'tool_results')) {
      this.db.exec("ALTER TABLE chat_messages ADD COLUMN tool_results TEXT DEFAULT '[]'")
    }
    // Add branch/pin/archive columns to chat_sessions if missing
    const sessColumns = this.db.prepare("PRAGMA table_info(chat_sessions)").all() as any[]
    if (!sessColumns.some((c: any) => c.name === 'active_branch_id')) {
      this.db.exec("ALTER TABLE chat_sessions ADD COLUMN active_branch_id TEXT DEFAULT ''")
    }
    if (!sessColumns.some((c: any) => c.name === 'branches')) {
      this.db.exec("ALTER TABLE chat_sessions ADD COLUMN branches TEXT DEFAULT '[]'")
    }
    if (!sessColumns.some((c: any) => c.name === 'pinned_at')) {
      this.db.exec("ALTER TABLE chat_sessions ADD COLUMN pinned_at INTEGER DEFAULT 0")
    }
    if (!sessColumns.some((c: any) => c.name === 'archived_at')) {
      this.db.exec("ALTER TABLE chat_sessions ADD COLUMN archived_at INTEGER DEFAULT 0")
    }
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_config_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key_encrypted BLOB NOT NULL,
        system_prompt TEXT DEFAULT '',
        default_model TEXT DEFAULT '',
        provider TEXT DEFAULT 'openai',
        custom_headers TEXT DEFAULT '{}',
        color TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '新对话',
        config_group_id TEXT NOT NULL,
        model TEXT DEFAULT '',
        model_params TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (config_group_id) REFERENCES api_config_groups(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        context_files TEXT DEFAULT '[]',
        token_count INTEGER DEFAULT 0,
        thinking TEXT DEFAULT '',
        tool_calls TEXT DEFAULT '[]',
        tool_results TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS user_preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_sessions_config ON chat_sessions(config_group_id);
    `)
  }

  // Config Groups
  getConfigGroups(): ApiConfigGroup[] {
    const rows = this.db.prepare('SELECT * FROM api_config_groups ORDER BY sort_order ASC, created_at DESC').all() as any[]

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      apiKey: this.crypto.decrypt(row.api_key_encrypted),
      systemPrompt: row.system_prompt,
      defaultModel: row.default_model,
      provider: row.provider,
      customHeaders: JSON.parse(row.custom_headers || '{}'),
      color: row.color || undefined,
      sortOrder: row.sort_order || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  saveConfigGroup(group: Omit<ApiConfigGroup, 'createdAt' | 'updatedAt'> & { id?: string }): ApiConfigGroup {
    const id = group.id || uuidv4()
    const now = Date.now()
    const encryptedKey = this.crypto.encrypt(group.apiKey)

    const existing = this.db.prepare('SELECT id FROM api_config_groups WHERE id = ?').get(id)

    if (existing) {
      this.db.prepare(`
        UPDATE api_config_groups
        SET name = ?, base_url = ?, api_key_encrypted = ?, system_prompt = ?,
            default_model = ?, provider = ?, custom_headers = ?, color = ?, sort_order = ?, updated_at = ?
        WHERE id = ?
      `).run(
        group.name,
        group.baseUrl,
        encryptedKey,
        group.systemPrompt,
        group.defaultModel,
        group.provider,
        JSON.stringify(group.customHeaders || {}),
        group.color || '',
        group.sortOrder || 0,
        now,
        id
      )
    } else {
      this.db.prepare(`
        INSERT INTO api_config_groups (id, name, base_url, api_key_encrypted, system_prompt,
          default_model, provider, custom_headers, color, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        group.name,
        group.baseUrl,
        encryptedKey,
        group.systemPrompt,
        group.defaultModel,
        group.provider,
        JSON.stringify(group.customHeaders || {}),
        group.color || '',
        group.sortOrder || 0,
        now,
        now
      )
    }

    return {
      ...group,
      id,
      createdAt: existing ? (this.db.prepare('SELECT created_at FROM api_config_groups WHERE id = ?').get(id) as any).created_at : now,
      updatedAt: now,
    }
  }

  deleteConfigGroup(id: string): void {
    this.db.prepare('DELETE FROM api_config_groups WHERE id = ?').run(id)
  }

  // Chat Sessions
  getSessions(): ChatSession[] {
    const sessions = this.db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC').all() as any[]

    return sessions.map(session => {
      const messages = this.db.prepare(
        'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY sort_order ASC'
      ).all(session.id) as any[]

      // Parse branches JSON, decrypting message content in each branch
      let branches: ChatBranch[] = []
      try {
        const rawBranches = JSON.parse(session.branches || '[]')
        branches = rawBranches.map((b: any) => ({
          id: b.id,
          name: b.name,
          forkedFromMessageId: b.forkedFromMessageId || '',
          createdAt: b.createdAt,
          messages: (b.messages || []).map((msg: any) => ({
            id: msg.id,
            role: msg.role,
            content: this.maybeDecrypt(msg.content),
            sortOrder: msg.sortOrder,
            contextFiles: msg.contextFiles || [],
            tokenCount: msg.tokenCount || 0,
            thinking: msg.thinking ? this.maybeDecrypt(msg.thinking) : undefined,
            editedAt: msg.editedAt || undefined,
            toolCalls: msg.toolCalls?.length ? msg.toolCalls : undefined,
            toolResults: msg.toolResults?.length ? msg.toolResults : undefined,
            toolCallId: msg.toolCallId || undefined,
            createdAt: msg.createdAt,
          })),
        }))
      } catch { branches = [] }

      return {
        id: session.id,
        title: session.title,
        configGroupId: session.config_group_id,
        model: session.model,
        modelParams: JSON.parse(session.model_params || '{}'),
        messages: messages.map(msg => {
          const toolResults = parseJsonField<ChatMessage['toolResults']>(msg.tool_results, undefined)
          return {
            id: msg.id,
            role: msg.role,
            content: this.maybeDecrypt(msg.content),
            sortOrder: msg.sort_order,
            contextFiles: parseJsonField<string[]>(msg.context_files, []),
            tokenCount: msg.token_count,
            thinking: msg.thinking ? this.maybeDecrypt(msg.thinking) : undefined,
            editedAt: msg.edited_at || undefined,
            toolCalls: parseJsonField<ChatMessage['toolCalls']>(msg.tool_calls, undefined)?.length
              ? parseJsonField<ChatMessage['toolCalls']>(msg.tool_calls, undefined)
              : undefined,
            toolResults: toolResults?.length ? toolResults : undefined,
            toolCallId: msg.tool_call_id || (toolResults?.[0]?.toolCallId) || undefined,
            createdAt: msg.created_at,
          }
        }),
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        activeBranchId: session.active_branch_id || undefined,
        branches: branches.length > 0 ? branches : undefined,
        pinnedAt: session.pinned_at || undefined,
        archivedAt: session.archived_at || undefined,
      }
    })
  }

  saveSession(session: Omit<ChatSession, 'createdAt' | 'updatedAt'> & { id?: string }): ChatSession {
    const id = session.id || uuidv4()
    const now = Date.now()

    const existing = this.db.prepare('SELECT id FROM chat_sessions WHERE id = ?').get(id)

    if (existing) {
      this.db.prepare(`
        UPDATE chat_sessions
        SET title = ?, config_group_id = ?, model = ?, model_params = ?, updated_at = ?,
            active_branch_id = ?, branches = ?, pinned_at = ?, archived_at = ?
        WHERE id = ?
      `).run(
        session.title,
        session.configGroupId,
        session.model,
        JSON.stringify(session.modelParams),
        now,
        (session as any).activeBranchId || '',
        JSON.stringify((session as any).branches || []),
        (session as any).pinnedAt || 0,
        (session as any).archivedAt || 0,
        id
      )

      // Delete old messages and insert new ones
      this.db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(id)
    } else {
      this.db.prepare(`
        INSERT INTO chat_sessions (id, title, config_group_id, model, model_params, created_at, updated_at,
          active_branch_id, branches, pinned_at, archived_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        session.title,
        session.configGroupId,
        session.model,
        JSON.stringify(session.modelParams),
        now,
        now,
        (session as any).activeBranchId || '',
        JSON.stringify((session as any).branches || []),
        (session as any).pinnedAt || 0,
        (session as any).archivedAt || 0
      )
    }

    // Insert messages
    const insertMsg = this.db.prepare(`
      INSERT INTO chat_messages (id, session_id, role, content, sort_order, context_files, token_count, thinking, tool_calls, tool_results, edited_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertMany = this.db.transaction((messages: ChatMessage[]) => {
      for (const msg of messages) {
        insertMsg.run(
          msg.id,
          id,
          msg.role,
          this.maybeEncrypt(msg.content),
          msg.sortOrder,
          JSON.stringify(msg.contextFiles),
          msg.tokenCount,
          msg.thinking ? this.maybeEncrypt(msg.thinking) : '',
          JSON.stringify(msg.toolCalls || []),
          JSON.stringify(msg.toolResults || []),
          msg.editedAt || 0,
          msg.createdAt
        )
      }
    })

    insertMany(session.messages)

    return {
      ...session,
      id,
      createdAt: existing ? (this.db.prepare('SELECT created_at FROM chat_sessions WHERE id = ?').get(id) as any).created_at : now,
      updatedAt: now,
    }
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id)
  }

  // User Preferences
  getPreferences(): UserPreferences {
    const rows = this.db.prepare('SELECT * FROM user_preferences').all() as any[]
    const prefs: any = { ...DEFAULT_PREFERENCES }

    for (const row of rows) {
      try {
        prefs[row.key] = JSON.parse(row.value)
      } catch {
        prefs[row.key] = row.value
      }
    }

    return prefs as UserPreferences
  }

  savePreferences(prefs: Partial<UserPreferences>): void {
    const upsert = this.db.prepare(`
      INSERT OR REPLACE INTO user_preferences (key, value) VALUES (?, ?)
    `)

    const saveMany = this.db.transaction((entries: [string, any][]) => {
      for (const [key, value] of entries) {
        upsert.run(key, JSON.stringify(value))
      }
    })

    saveMany(Object.entries(prefs))
  }

  // Encrypt/Decrypt helpers for chat content
  private maybeEncrypt(text: string): string {
    if (!this.encryptChat || !this.crypto.hasChatKey()) return text
    return this.crypto.encryptChat(text).toString('base64')
  }

  private maybeDecrypt(text: string): string {
    if (!this.encryptChat || !this.crypto.hasChatKey()) return text
    try {
      const buf = Buffer.from(text, 'base64')
      // Only attempt decrypt if buffer is large enough for IV+TAG+data
      if (buf.length > 32) return this.crypto.decryptChat(buf)
    } catch {
      // Not encrypted (plaintext from before encryption was enabled)
    }
    return text
  }

  resetAll(): void {
    this.db.exec('DELETE FROM chat_messages')
    this.db.exec('DELETE FROM chat_sessions')
    this.db.exec('DELETE FROM api_config_groups')
    this.db.exec('DELETE FROM user_preferences')
  }

  close(): void {
    this.db.close()
  }
}
