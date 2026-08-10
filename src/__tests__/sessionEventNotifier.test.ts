import { describe, it, expect, vi } from 'vitest'

// The component module pulls in the zustand stores, which reference `window`
// at import time — stub it the same way chatStore.test.ts does.
vi.mock('@/editor/monacoSetup', () => ({ monaco: {} }))
vi.stubGlobal('window', { electronAPI: {} })

import { completionToastType } from '@/components/Common/SessionEventNotifier'

describe('completionToastType', () => {
  it('returns success for a plain chat reply (no run record, no error card)', () => {
    expect(completionToastType({ messages: [{ role: 'assistant', content: 'done' }] })).toBe('success')
  })

  it('returns error when the last assistant message carries an error card (chat mode)', () => {
    expect(completionToastType({
      messages: [{ role: 'assistant', content: '', error: { type: 'network', message: 'boom' } }],
    })).toBe('error')
  })

  it('returns error when the agent run ended with an error', () => {
    expect(completionToastType({
      agentRuns: [{ status: 'error' }],
      messages: [{ role: 'assistant', content: 'x' }],
    })).toBe('error')
  })

  it('returns info when the run was stopped', () => {
    expect(completionToastType({
      agentRuns: [{ status: 'stopped' }],
      messages: [{ role: 'assistant', content: 'x' }],
    })).toBe('info')
  })

  it('returns success for a done agent run', () => {
    expect(completionToastType({
      agentRuns: [{ status: 'done' }],
      messages: [{ role: 'assistant', content: 'x' }],
    })).toBe('success')
  })
})
