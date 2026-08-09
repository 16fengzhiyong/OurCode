import { useState } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useI18n } from '@/i18n/useI18n'
import type { ToolCall } from '@/services/tools/types'

/**
 * Batch-approval dialog (agent mode): shown once per tool round instead of
 * interrupting on every write tool. Options mirror Windsurf/Cursor's approval
 * model — confirm one by one, approve the whole run, or reject everything.
 * A per-tool "always allow" checkbox persists the tool to the project allowlist.
 */
export default function BatchApprovalDialog() {
  const { batchApproval, decideBatchApproval, allowToolPermanently } = useChatStore()
  // Parallel conversations: the dialog only renders for the active session —
  // switching to the owning session reveals it again.
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const [alwaysAllow, setAlwaysAllow] = useState<Set<string>>(new Set())
  const t = useI18n()

  if (!batchApproval || batchApproval.sessionId !== activeSessionId) return null
  const { tools } = batchApproval

  const toggleAlwaysAllow = (tc: ToolCall) => {
    setAlwaysAllow((prev) => {
      const next = new Set(prev)
      if (next.has(tc.name)) next.delete(tc.name)
      else next.add(tc.name)
      return next
    })
  }

  // Persist checked tools, then resolve the pending batch decision
  const persistAllowlist = () => {
    alwaysAllow.forEach((name) => allowToolPermanently(name))
    setAlwaysAllow(new Set())
  }

  const approveAll = () => {
    persistAllowlist()
    decideBatchApproval('all')
  }
  const confirmOneByOne = () => {
    persistAllowlist()
    decideBatchApproval('confirm')
  }
  const rejectAll = () => {
    setAlwaysAllow(new Set())
    decideBatchApproval('reject')
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('agent.batchTitle')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div className="bg-nova-surface border border-nova-border rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-nova-border bg-nova-bg/50">
          <span className="text-lg">🤖</span>
          <h3 className="text-nova-text-primary font-medium">{t('agent.batchTitle')}</h3>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          <p className="text-xs text-nova-text-muted">{t('agent.batchDesc')}</p>
          <div className="text-xs text-nova-text-muted">
            {t('agent.batchToolCount', { count: tools.length })}
          </div>
          <div className="space-y-1 max-h-52 overflow-y-auto">
            {tools.map((tc) => (
              <div
                key={tc.id}
                className="flex items-center gap-2 bg-nova-bg/50 rounded-lg px-3 py-2 border border-nova-border"
              >
                <span className="font-mono text-nova-accent text-xs shrink-0">{tc.name}</span>
                <span className="text-nova-text-secondary text-xs truncate min-w-0">
                  {JSON.stringify(tc.arguments || {})}
                </span>
                <label className="ml-auto flex items-center gap-1 text-[10px] text-nova-text-muted cursor-pointer select-none shrink-0">
                  <input
                    type="checkbox"
                    checked={alwaysAllow.has(tc.name)}
                    onChange={() => toggleAlwaysAllow(tc)}
                    className="accent-nova-accent w-3 h-3"
                  />
                  {t('agent.alwaysAllowTool')}
                </label>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-nova-border bg-nova-bg/30">
          <button
            onClick={rejectAll}
            className="px-4 py-1.5 text-sm text-nova-text-secondary hover:text-nova-text-primary border border-nova-border rounded-lg hover:bg-nova-hover transition-colors"
          >
            {t('agent.batchRejectAll')}
          </button>
          <button
            onClick={confirmOneByOne}
            className="px-4 py-1.5 text-sm text-nova-text-secondary hover:text-nova-text-primary border border-nova-border rounded-lg hover:bg-nova-hover transition-colors"
          >
            {t('agent.batchConfirm')}
          </button>
          <button
            onClick={approveAll}
            className="px-4 py-1.5 text-sm text-white bg-nova-accent hover:bg-nova-accent/80 rounded-lg transition-colors"
          >
            {t('agent.batchApproveAll')}
          </button>
        </div>
      </div>
    </div>
  )
}
