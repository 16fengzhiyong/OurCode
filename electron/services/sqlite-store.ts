import Database from 'better-sqlite3'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { CryptoService } from './crypto'
import { ApiConfigGroup, ChatSession, ChatMessage, ChatBranch, UserPreferences, Memory, Checkpoint, TodoItem, Workflow, AgentRun, UsageEvent, UsageSummary, UsageRankRow } from '../../shared/types'
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
    // Add skip_tls_verify column if missing (per-group intranet cert bypass)
    if (!columns.some((c: any) => c.name === 'skip_tls_verify')) {
      this.db.exec("ALTER TABLE api_config_groups ADD COLUMN skip_tls_verify INTEGER DEFAULT 0")
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
    // Add agent-mode / todo / plan columns to chat_sessions if missing
    if (!sessColumns.some((c: any) => c.name === 'agent_mode')) {
      this.db.exec("ALTER TABLE chat_sessions ADD COLUMN agent_mode TEXT DEFAULT 'chat'")
    }
    if (!sessColumns.some((c: any) => c.name === 'todos')) {
      this.db.exec("ALTER TABLE chat_sessions ADD COLUMN todos TEXT DEFAULT '[]'")
    }
    if (!sessColumns.some((c: any) => c.name === 'plan_content')) {
      this.db.exec("ALTER TABLE chat_sessions ADD COLUMN plan_content TEXT DEFAULT ''")
    }
    if (!sessColumns.some((c: any) => c.name === 'plan_status')) {
      this.db.exec("ALTER TABLE chat_sessions ADD COLUMN plan_status TEXT DEFAULT 'none'")
    }
    // Add agent_runs column to chat_sessions if missing (persisted agent task records)
    if (!sessColumns.some((c: any) => c.name === 'agent_runs')) {
      this.db.exec("ALTER TABLE chat_sessions ADD COLUMN agent_runs TEXT DEFAULT '[]'")
    }
    // Add project_path column to chat_sessions if missing (session ↔ workspace association)
    if (!sessColumns.some((c: any) => c.name === 'project_path')) {
      this.db.exec("ALTER TABLE chat_sessions ADD COLUMN project_path TEXT DEFAULT ''")
    }
    // Add project_path column to memories if missing (project-scoped memories)
    const memColumns = this.db.prepare("PRAGMA table_info(memories)").all() as any[]
    if (!memColumns.some((c: any) => c.name === 'project_path')) {
      this.db.exec("ALTER TABLE memories ADD COLUMN project_path TEXT DEFAULT ''")
    }
    // Add last_accessed_at column to llm_response_cache if missing (LRU eviction)
    const cacheColumns = this.db.prepare("PRAGMA table_info(llm_response_cache)").all() as any[]
    if (!cacheColumns.some((c: any) => c.name === 'last_accessed_at')) {
      this.db.exec("ALTER TABLE llm_response_cache ADD COLUMN last_accessed_at INTEGER DEFAULT 0")
      // Populate existing rows with created_at so they have a usable access time
      this.db.exec("UPDATE llm_response_cache SET last_accessed_at = created_at WHERE last_accessed_at = 0")
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_cache_last_accessed ON llm_response_cache(last_accessed_at)")
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

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        scope TEXT DEFAULT 'global',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        label TEXT DEFAULT '',
        message_id TEXT DEFAULT '',
        files TEXT DEFAULT '[]',
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        prompt TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        name TEXT NOT NULL,
        sub TEXT DEFAULT '',
        session_id TEXT DEFAULT '',
        project_path TEXT DEFAULT '',
        started_at INTEGER NOT NULL,
        finished_at INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        tokens_in INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        ok INTEGER DEFAULT 1,
        error TEXT DEFAULT '',
        payload TEXT DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS llm_response_cache (
        key TEXT PRIMARY KEY,
        provider TEXT DEFAULT '',
        model TEXT DEFAULT '',
        response TEXT NOT NULL,
        tokens_in INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER DEFAULT 0,
        hits INTEGER DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_sessions_config ON chat_sessions(config_group_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_category_time ON usage_events(category, started_at);
      CREATE INDEX IF NOT EXISTS idx_usage_name ON usage_events(name);
      CREATE INDEX IF NOT EXISTS idx_cache_created ON llm_response_cache(created_at);
      CREATE INDEX IF NOT EXISTS idx_cache_last_accessed ON llm_response_cache(last_accessed_at);
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
        skipTlsVerify: !!row.skip_tls_verify,
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
            default_model = ?, provider = ?, custom_headers = ?, color = ?, sort_order = ?,
            skip_tls_verify = ?, updated_at = ?
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
        group.skipTlsVerify ? 1 : 0,
        now,
        id
      )
    } else {
      this.db.prepare(`
        INSERT INTO api_config_groups (id, name, base_url, api_key_encrypted, system_prompt,
          default_model, provider, custom_headers, color, sort_order, skip_tls_verify, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        group.skipTlsVerify ? 1 : 0,
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
        // Legacy 'plan' mode was merged into 'agent' — map old sessions on load
        agentMode: (session.agent_mode === 'plan' ? 'agent' : session.agent_mode || 'chat') as 'chat' | 'agent',
        todos: parseJsonField<TodoItem[]>(session.todos, []),
        planContent: session.plan_content || undefined,
        planStatus: (session.plan_status || 'none') as 'none' | 'pending_approval' | 'approved' | 'canceled',
        projectPath: session.project_path || undefined,
        agentRuns: parseJsonField<AgentRun[]>(session.agent_runs, []).length
          ? parseJsonField<AgentRun[]>(session.agent_runs, [])
          : undefined,
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
            active_branch_id = ?, branches = ?, pinned_at = ?, archived_at = ?,
            agent_mode = ?, todos = ?, plan_content = ?, plan_status = ?, agent_runs = ?, project_path = ?
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
        (session as any).agentMode || 'chat',
        JSON.stringify((session as any).todos || []),
        (session as any).planContent || '',
        (session as any).planStatus || 'none',
        JSON.stringify((session as any).agentRuns || []),
        (session as any).projectPath || '',
        id
      )
    } else {
      this.db.prepare(`
        INSERT INTO chat_sessions (id, title, config_group_id, model, model_params, created_at, updated_at,
          active_branch_id, branches, pinned_at, archived_at, agent_mode, todos, plan_content, plan_status, agent_runs, project_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        (session as any).archivedAt || 0,
        (session as any).agentMode || 'chat',
        JSON.stringify((session as any).todos || []),
        (session as any).planContent || '',
        (session as any).planStatus || 'none',
        JSON.stringify((session as any).agentRuns || []),
        (session as any).projectPath || ''
      )
    }

    // Insert messages — ATOMICALLY: deleting the old rows and inserting the new
    // ones must be one transaction. Previously the DELETE auto-committed on its
    // own and a failure mid-insert (bad renderer data → NOT NULL/constraint
    // violation) rolled back the insert while the messages were already gone —
    // the session's entire history was silently wiped.
    const insertMsg = this.db.prepare(`
      INSERT INTO chat_messages (id, session_id, role, content, sort_order, context_files, token_count, thinking, tool_calls, tool_results, edited_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const replaceMessages = this.db.transaction((messages: ChatMessage[]) => {
      if (existing) this.db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(id)
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

    replaceMessages(session.messages)

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

  // ───────────────────── Memories (persistent user context) ─────────────────────
  getMemories(): Memory[] {
    const rows = this.db.prepare('SELECT * FROM memories ORDER BY updated_at DESC').all() as any[]
    return rows.map((row) => ({
      id: row.id,
      content: this.maybeDecrypt(row.content),
      scope: (row.scope || 'global') as Memory['scope'],
      projectPath: row.project_path || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  addMemory(content: string, scope: Memory['scope'], projectPath?: string): Memory {
    const id = uuidv4()
    const now = Date.now()
    this.db.prepare('INSERT INTO memories (id, content, scope, project_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, this.maybeEncrypt(content), scope || 'global', projectPath || '', now, now)
    return { id, content, scope: scope || 'global', projectPath, createdAt: now, updatedAt: now }
  }

  deleteMemory(id: string): void {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id)
  }

  // ───────────────────── Checkpoints (AI edit snapshots) ─────────────────────
  getCheckpoints(sessionId: string): Checkpoint[] {
    const rows = this.db.prepare(
      'SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at ASC'
    ).all(sessionId) as any[]
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      createdAt: row.created_at,
      label: row.label || '',
      messageId: row.message_id || undefined,
      files: parseJsonField<Checkpoint['files']>(row.files, []),
    }))
  }

  addCheckpoint(checkpoint: Omit<Checkpoint, 'createdAt'> & { createdAt?: number }): Checkpoint {
    const now = checkpoint.createdAt || Date.now()
    this.db.prepare(`
      INSERT INTO checkpoints (id, session_id, created_at, label, message_id, files)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      checkpoint.id,
      checkpoint.sessionId,
      now,
      checkpoint.label || '',
      checkpoint.messageId || '',
      JSON.stringify(checkpoint.files || [])
    )
    return { ...checkpoint, createdAt: now }
  }

  deleteCheckpoints(sessionId: string): void {
    this.db.prepare('DELETE FROM checkpoints WHERE session_id = ?').run(sessionId)
  }

  // ───────────────────── Workflows (reusable prompt templates) ─────────────────────
  getWorkflows(): Workflow[] {
    const rows = this.db.prepare('SELECT * FROM workflows ORDER BY updated_at DESC').all() as any[]
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description || '',
      prompt: this.maybeDecrypt(row.prompt),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  addWorkflow(input: { name: string; description?: string; prompt: string }): Workflow {
    const id = uuidv4()
    const now = Date.now()
    this.db.prepare('INSERT INTO workflows (id, name, description, prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, input.name || '未命名工作流', input.description || '', this.maybeEncrypt(input.prompt), now, now)
    return { id, name: input.name || '未命名工作流', description: input.description || '', prompt: input.prompt, createdAt: now, updatedAt: now }
  }

  deleteWorkflow(id: string): void {
    this.db.prepare('DELETE FROM workflows WHERE id = ?').run(id)
  }

  // ───────────────────── Usage statistics (LLM / skills / subagents / MCP) ─────────────────────
  /** Batch-insert usage events (idempotent per id — INSERT OR REPLACE) */
  recordUsageEvents(events: UsageEvent[]): void {
    if (!events || events.length === 0) return
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO usage_events
        (id, category, name, sub, session_id, project_path, started_at, finished_at,
         duration_ms, tokens_in, tokens_out, ok, error, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertMany = this.db.transaction((rows: UsageEvent[]) => {
      for (const e of rows) {
        insert.run(
          e.id,
          e.category,
          e.name,
          e.sub || '',
          e.sessionId || '',
          e.projectPath || '',
          e.startedAt,
          e.finishedAt || 0,
          e.durationMs || 0,
          e.tokensIn || 0,
          e.tokensOut || 0,
          e.ok === false ? 0 : 1,
          e.error || '',
          JSON.stringify(e.payload || {})
        )
      }
    })
    insertMany(events)
  }

  /** Aggregate one ranking group (byModel / skills / subagents / mcp) */
  private usageRank(category: string, cutoff: number): UsageRankRow[] {
    const sql = `
      SELECT name, sub, COUNT(*) AS count,
             IFNULL(SUM(tokens_in), 0) AS tokensIn,
             IFNULL(SUM(tokens_out), 0) AS tokensOut,
             IFNULL(SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END), 0) AS errors,
             MAX(started_at) AS lastUsed
      FROM usage_events
      WHERE category = ?${cutoff > 0 ? ' AND started_at >= ?' : ''}
      GROUP BY name, sub
      ORDER BY count DESC, lastUsed DESC
    `
    const rows = cutoff > 0
      ? this.db.prepare(sql).all(category, cutoff)
      : this.db.prepare(sql).all(category)
    return (rows as any[]).map((r) => ({
      name: r.name,
      sub: r.sub || '',
      count: r.count,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      errors: r.errors,
      lastUsed: r.lastUsed,
    }))
  }

  /** Dashboard payload for a time range (rangeDays; 0/undefined = all time) */
  getUsageSummary(rangeDays?: number): UsageSummary {
    const cutoff = rangeDays && rangeDays > 0 ? Date.now() - rangeDays * 86400000 : 0
    const where = cutoff > 0 ? 'WHERE started_at >= ?' : ''
    const params = cutoff > 0 ? [cutoff] : []

    const totals = this.db.prepare(`
      SELECT COUNT(*) AS requests,
             IFNULL(SUM(tokens_in), 0) AS tokensIn,
             IFNULL(SUM(tokens_out), 0) AS tokensOut,
             IFNULL(SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END), 0) AS errors
      FROM usage_events ${where}
    `).get(...params) as any

    const daily = this.db.prepare(`
      SELECT date(started_at / 1000, 'unixepoch', 'localtime') AS day,
             IFNULL(SUM(tokens_in), 0) AS tokensIn,
             IFNULL(SUM(tokens_out), 0) AS tokensOut,
             COUNT(*) AS requests
      FROM usage_events ${where}
      GROUP BY day ORDER BY day ASC
    `).all(...params) as any[]

    const recent = this.db.prepare(`
      SELECT id, category, name, sub, session_id, started_at, duration_ms, tokens_in, tokens_out, ok, error
      FROM usage_events ORDER BY started_at DESC LIMIT 50
    `).all() as any[]

    return {
      totals: {
        requests: totals.requests,
        tokensIn: totals.tokensIn,
        tokensOut: totals.tokensOut,
        errors: totals.errors,
      },
      daily: daily.map((d) => ({ day: d.day, tokensIn: d.tokensIn, tokensOut: d.tokensOut, requests: d.requests })),
      byModel: this.usageRank('llm', cutoff),
      skills: this.usageRank('skill', cutoff),
      subagents: this.usageRank('subagent', cutoff),
      mcp: this.usageRank('mcp', cutoff),
      recent: recent.map((r) => ({
        id: r.id,
        category: r.category,
        name: r.name,
        sub: r.sub || '',
        sessionId: r.session_id,
        startedAt: r.started_at,
        durationMs: r.duration_ms,
        tokensIn: r.tokens_in,
        tokensOut: r.tokens_out,
        ok: r.ok !== 0,
        error: r.error || '',
      })),
    }
  }

  clearUsageEvents(): void {
    this.db.exec('DELETE FROM usage_events')
  }

  // ───────────────────── LLM response cache ─────────────────────
  /** Max entries kept in the cache; the least-recently-accessed are evicted on insert beyond this. */
  private static readonly CACHE_MAX_ENTRIES = 5000

  getResponseCache(key: string): { response: string; tokensIn: number; tokensOut: number } | null {
    const row = this.db.prepare(
      'SELECT response, tokens_in, tokens_out FROM llm_response_cache WHERE key = ?'
    ).get(key) as any
    if (!row) return null
    this.db.prepare('UPDATE llm_response_cache SET hits = hits + 1, last_accessed_at = ? WHERE key = ?').run(Date.now(), key)
    return {
      response: row.response,
      tokensIn: row.tokens_in || 0,
      tokensOut: row.tokens_out || 0,
    }
  }

  /** Insert (or refresh) a cache entry; evict the least-recently-accessed when over capacity. */
  putResponseCache(key: string, provider: string, model: string, response: string, tokensIn: number, tokensOut: number): void {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO llm_response_cache (key, provider, model, response, tokens_in, tokens_out, created_at, last_accessed_at, hits)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(key) DO UPDATE SET
        response = excluded.response,
        tokens_in = excluded.tokens_in,
        tokens_out = excluded.tokens_out,
        created_at = excluded.created_at,
        last_accessed_at = excluded.last_accessed_at
    `).run(key, provider, model, response, tokensIn, tokensOut, now, now)

    const count = (this.db.prepare('SELECT COUNT(*) AS c FROM llm_response_cache').get() as any).c as number
    if (count > SQLiteStore.CACHE_MAX_ENTRIES) {
      const excess = count - SQLiteStore.CACHE_MAX_ENTRIES
      this.db.prepare(
        'DELETE FROM llm_response_cache WHERE key IN (SELECT key FROM llm_response_cache ORDER BY last_accessed_at ASC LIMIT ?)'
      ).run(excess)
    }
  }

  clearResponseCache(): void {
    this.db.exec('DELETE FROM llm_response_cache')
  }

  resetAll(): void {
    this.db.exec('DELETE FROM chat_messages')
    this.db.exec('DELETE FROM chat_sessions')
    this.db.exec('DELETE FROM api_config_groups')
    this.db.exec('DELETE FROM user_preferences')
    this.db.exec('DELETE FROM memories')
    this.db.exec('DELETE FROM checkpoints')
    this.db.exec('DELETE FROM workflows')
    this.db.exec('DELETE FROM usage_events')
  }

  private closed = false

  close(): void {
    // Idempotent — close() is called from both window-all-closed and will-quit
    // on some platforms; better-sqlite3 throws on a double close.
    if (this.closed) return
    this.closed = true
    this.db.close()
  }
}
