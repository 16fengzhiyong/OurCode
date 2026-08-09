import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { SQLiteStore } from '../services/sqlite-store'
import type { UsageEvent } from '../../shared/types'

// better-sqlite3 ships a native binary built for the app's Electron runtime
// (Node ABI 123). Under a plain Node runner (e.g. system Node 24 / ABI 137)
// construction throws — skip the suite there instead of failing CI; it runs
// wherever the ABI matches (Electron dev runtime / matching Node).
let sqliteUsable = true
try {
  new Database(':memory:').close()
} catch {
  sqliteUsable = false
}

describe.skipIf(!sqliteUsable)('SQLiteStore usage statistics', () => {
  let root: string
  let store: SQLiteStore

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'usage-store-test-'))
    store = new SQLiteStore(root)
  })

  afterEach(() => {
    store?.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('records events and aggregates totals / rankings / recent', () => {
    const now = Date.now()
    store.recordUsageEvents([
      { id: '1', category: 'llm', name: 'gpt-4o', sub: 'openai', sessionId: 's1', projectPath: 'C:/p', startedAt: now - 86400000 * 2, durationMs: 100, tokensIn: 100, tokensOut: 200, ok: true },
      { id: '2', category: 'llm', name: 'gpt-4o', sub: 'openai', sessionId: 's1', startedAt: now - 86400000, durationMs: 120, tokensIn: 300, tokensOut: 400, ok: true },
      { id: '3', category: 'llm', name: 'claude-sonnet', sub: 'anthropic', sessionId: 's2', startedAt: now - 3600000, durationMs: 90, tokensIn: 50, tokensOut: 25, ok: true },
      { id: '4', category: 'skill', name: 'design', startedAt: now - 7200000, durationMs: 5, ok: true },
      { id: '5', category: 'skill', name: 'design', startedAt: now - 3600000, durationMs: 6, ok: true },
      { id: '6', category: 'mcp', name: 'server__readFile', sub: 'server', startedAt: now - 1800000, durationMs: 10, ok: false, error: 'boom' },
      { id: '7', category: 'subagent', name: 'reviewer', startedAt: now - 900000, durationMs: 5000, ok: true, payload: { toolCallCount: 3 } },
    ])

    const summary = store.getUsageSummary(7)

    // Totals
    expect(summary.totals.requests).toBe(7)
    expect(summary.totals.tokensIn).toBe(450)
    expect(summary.totals.tokensOut).toBe(625)
    expect(summary.totals.errors).toBe(1)

    // By model ranking (count DESC)
    expect(summary.byModel).toHaveLength(2)
    expect(summary.byModel[0].name).toBe('gpt-4o')
    expect(summary.byModel[0].count).toBe(2)
    expect(summary.byModel[0].tokensIn).toBe(400)
    expect(summary.byModel[1].sub).toBe('anthropic')

    // Feature rankings
    expect(summary.skills).toHaveLength(1)
    expect(summary.skills[0].name).toBe('design')
    expect(summary.skills[0].count).toBe(2)
    expect(summary.skills[0].lastUsed).toBeGreaterThan(0)

    expect(summary.subagents[0].name).toBe('reviewer')
    expect(summary.subagents[0].count).toBe(1)

    expect(summary.mcp[0].name).toBe('server__readFile')
    expect(summary.mcp[0].sub).toBe('server')
    expect(summary.mcp[0].errors).toBe(1)

    // Daily trend has entries for the days that saw activity
    expect(summary.daily.length).toBeGreaterThan(0)
    const totalDailyTokens = summary.daily.reduce((s, d) => s + d.tokensIn + d.tokensOut, 0)
    expect(totalDailyTokens).toBe(1075)

    // Recent feed is newest-first
    expect(summary.recent).toHaveLength(7)
    expect(summary.recent[0].category).toBe('subagent')
    expect(summary.recent[0].ok).toBe(true)
    expect(summary.recent[6].id).toBe('1')
  })

  it('respects the rangeDays cutoff', () => {
    const now = Date.now()
    store.recordUsageEvents([
      { id: 'old', category: 'llm', name: 'gpt-4o', sub: 'openai', startedAt: now - 86400000 * 30, durationMs: 10, tokensIn: 1, tokensOut: 1, ok: true },
      { id: 'new', category: 'llm', name: 'gpt-4o', sub: 'openai', startedAt: now - 3600000, durationMs: 10, tokensIn: 5, tokensOut: 5, ok: true },
    ])
    const week = store.getUsageSummary(7)
    expect(week.totals.requests).toBe(1)
    expect(week.totals.tokensIn).toBe(5)
    const all = store.getUsageSummary(0)
    expect(all.totals.requests).toBe(2)
    const defaults = store.getUsageSummary()
    expect(defaults.totals.requests).toBe(2)
  })

  it('clearUsageEvents empties the table', () => {
    store.recordUsageEvents([
      { id: '1', category: 'skill', name: 'design', startedAt: Date.now(), ok: true } as UsageEvent,
    ])
    store.clearUsageEvents()
    const summary = store.getUsageSummary()
    expect(summary.totals.requests).toBe(0)
    expect(summary.recent).toHaveLength(0)
  })

  it('ignores empty batches and dedupes by id', () => {
    store.recordUsageEvents([])
    const now = Date.now()
    store.recordUsageEvents([
      { id: 'x', category: 'llm', name: 'm', sub: 's', startedAt: now, tokensIn: 1, ok: true },
      { id: 'x', category: 'llm', name: 'm', sub: 's', startedAt: now, tokensIn: 99, ok: true },
    ])
    expect(store.getUsageSummary().totals.requests).toBe(1)
    expect(store.getUsageSummary().totals.tokensIn).toBe(99)
  })
})

describe.skipIf(!sqliteUsable)('SQLiteStore LLM response cache', () => {
  let root: string
  let store: SQLiteStore

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'llm-cache-test-'))
    store = new SQLiteStore(root)
  })

  afterEach(() => {
    store?.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('round-trips an entry and increments hits on read', () => {
    store.putResponseCache('k1', 'openai', 'gpt-4o', '{"chunks":[]}', 10, 3)
    const first = store.getResponseCache('k1')
    expect(first).toEqual({ response: '{"chunks":[]}', tokensIn: 10, tokensOut: 3 })
    // A miss returns null
    expect(store.getResponseCache('missing')).toBeNull()
  })

  it('upserts on the same key (refreshes payload)', () => {
    store.putResponseCache('k1', 'openai', 'gpt-4o', 'old', 1, 1)
    store.putResponseCache('k1', 'openai', 'gpt-4o', 'new', 5, 5)
    expect(store.getResponseCache('k1')?.response).toBe('new')
  })

  it('clearResponseCache empties the table', () => {
    store.putResponseCache('k1', 'openai', 'gpt-4o', 'x', 1, 1)
    store.clearResponseCache()
    expect(store.getResponseCache('k1')).toBeNull()
  })
})
