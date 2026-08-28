/**
 * 中央「实时工作台」（V12 审查 #1）：选中角色（左栏任务行/工位点击驱动）的
 * 真实执行记录 —— 对话流 / 工具调用流 / 代码变更 / 终端 四页签。
 *
 * 数据全部来自 chatStore.subagentProgress（父 run_subagent toolCallId 键），
 * 无演示兜底；无选中角色或该角色无记录时显示空态。对话页签承载原右下对话流
 * （OfficeStream）+ 内嵌决策区（InlineDecisionArea）——V12 对话压缩为底部
 * 输入条后，报告/审批的主现场移到这里。
 */
import { useMemo, useState } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { useI18n } from '@/i18n/useI18n'
import { useThrottledValue } from '@/utils/useThrottledValue'
import { MONO, TASK_5STATE } from './officeTheme'
import { roleLabel } from '@/services/office/mapping'
import OfficeStream from './OfficeStream'
import InlineDecisionArea from '../ChatPanel/InlineDecisionArea'
import type { SubAgentProgress } from '@shared/types'

type Tab = 'chat' | 'tools' | 'changes' | 'term'

const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'multi_edit_file', 'create_directory', 'delete_file'])
const CMD_TOOLS = new Set(['run_command'])

function fileOf(args: Record<string, any>): string {
  if (typeof args.path === 'string') return args.path
  if (Array.isArray(args.edits) && args.edits[0]?.path) return args.edits[0].path
  return ''
}

function shortFile(path: string): string {
  return path.split(/[\\/]/).slice(-2).join('/')
}

function truncate(text: string, max: number): string {
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '…' : text
}

export default function OfficeWorkbench() {
  const t = useI18n()
  const [tab, setTab] = useState<Tab>('chat')
  const selectedRole = useUIStore((s) => s.officeSelectedRole)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  // 进度表逐次推送高频换引用，500ms 节流避免整块工作台每秒重渲多次
  const subagentProgress = useThrottledValue(useChatStore((s) => s.subagentProgress), 500)

  const runs = useMemo(() => {
    if (!selectedRole) return []
    return Object.values(subagentProgress)
      .filter((p) => p.sessionId === activeSessionId && roleLabel(p.task, p.name) === selectedRole)
      .sort((a, b) => b.startedAt - a.startedAt)
  }, [subagentProgress, activeSessionId, selectedRole])

  const latest: SubAgentProgress | undefined = runs[0]

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'chat', label: t('office.wbChat') },
    { id: 'tools', label: t('office.wbTools') },
    { id: 'changes', label: t('office.wbChanges') },
    { id: 'term', label: t('office.wbTerm') },
  ]

  const empty = (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-[260px]" style={{ color: MONO.t3, fontSize: 12, lineHeight: 1.8 }}>
        {selectedRole ? t('office.wbNoRun', { role: selectedRole }) : t('office.wbNoSelect')}
      </div>
    </div>
  )

  const stateMeta = latest ? TASK_5STATE[latest.status === 'done' ? 'done' : latest.status === 'error' || latest.status === 'stopped' ? 'failed' : 'running'] : null

  return (
    <div
      data-testid="office-workbench"
      className="flex flex-col flex-1 min-h-0 rounded-xl border overflow-hidden"
      style={{ background: '#fff', borderColor: 'rgba(15,23,42,0.08)' }}
    >
      {/* 页签条 */}
      <div
        className="shrink-0 flex items-center px-3"
        style={{ height: 38, borderBottom: `1px solid ${MONO.hairline}`, gap: 2 }}
      >
        {tabs.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className="px-2.5 transition-colors"
            style={{
              height: '100%', marginBottom: -1, fontSize: 12.5,
              fontWeight: tab === tb.id ? 600 : 400,
              color: tab === tb.id ? '#0058BC' : MONO.t2,
              borderBottom: `2px solid ${tab === tb.id ? '#0058BC' : 'transparent'}`,
              cursor: 'pointer',
            }}
          >
            {tb.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2.5 shrink-0">
          {selectedRole && latest && stateMeta && (
            <>
              <span className="flex items-center gap-1.5" style={{ fontSize: 12, color: MONO.t2 }}>
                <span className="inline-block rounded-full" style={{ width: 7, height: 7, background: stateMeta.dot }} />
                {selectedRole} · {latest.status === 'running' ? t('office.running') : latest.status === 'done' ? t('office.taskDone') : t('office.taskFailed')}
              </span>
              <span className="text-xs" style={{ fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace", color: MONO.t3 }}>
                {t('office.tokensUsed')} {Math.round(latest.tokenCount / 1000)}k · {latest.toolCallCount} {t('office.toolCalls')}
              </span>
            </>
          )}
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-h-0 overflow-auto">
        {!selectedRole || !latest ? (
          empty
        ) : tab === 'chat' ? (
          <div className="h-full flex flex-col min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto">
              <OfficeStream />
            </div>
            <InlineDecisionArea />
          </div>
        ) : tab === 'tools' ? (
          <div className="p-3">
            {latest.steps.length === 0 ? (
              <div className="text-xs" style={{ color: MONO.t3 }}>{t('office.wbNoSteps')}</div>
            ) : (
              latest.steps.map((s) => (
                <div key={s.id} className="flex items-start gap-2.5 py-1.5" style={{ borderTop: '1px solid rgba(15,23,42,0.06)' }}>
                  <span
                    className="inline-flex items-center justify-center rounded-md flex-none"
                    style={{
                      width: 20, height: 20, fontSize: 11,
                      color: s.status === 'success' ? '#16A34A' : s.status === 'error' ? '#DC2626' : '#0058BC',
                      background: s.status === 'success' ? 'rgba(22,163,74,0.1)' : s.status === 'error' ? 'rgba(220,38,38,0.08)' : 'rgba(0,88,188,0.08)',
                    }}
                  >
                    {s.status === 'success' ? '✓' : s.status === 'error' ? '✕' : '⚙'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs"
                        style={{ fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace", color: MONO.t1 }}
                      >
                        {s.name}
                      </span>
                      <span className="text-xs truncate flex-1" style={{ fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace", color: MONO.t3 }}>
                        {truncate(JSON.stringify(s.arguments), 80)}
                      </span>
                    </div>
                    {s.result && (
                      <div className="text-xs mt-0.5 truncate" style={{ fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace", color: MONO.t2 }}>
                        {truncate(s.result.replace(/\s+/g, ' '), 120)}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : tab === 'changes' ? (
          (() => {
            const changes = latest.steps.filter((s) => WRITE_TOOLS.has(s.name) && fileOf(s.arguments))
            if (changes.length === 0) {
              return <div className="p-3 text-xs" style={{ color: MONO.t3 }}>{t('office.wbNoChanges')}</div>
            }
            return (
              <div className="p-3">
                {changes.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 py-1.5" style={{ borderTop: '1px solid rgba(15,23,42,0.06)' }}>
                    <span style={{ fontSize: 12, color: s.status === 'error' ? '#DC2626' : s.status === 'running' ? '#0058BC' : '#16A34A' }}>
                      {s.status === 'error' ? '✕' : s.status === 'running' ? '…' : '✓'}
                    </span>
                    <span
                      className="flex-1 truncate text-xs"
                      style={{ fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace", color: MONO.t1 }}
                    >
                      {shortFile(fileOf(s.arguments))}
                    </span>
                    <span className="text-xs shrink-0" style={{ color: MONO.t3 }}>
                      {s.name}
                    </span>
                  </div>
                ))}
              </div>
            )
          })()
        ) : (
          (() => {
            const cmds = latest.steps.filter((s) => CMD_TOOLS.has(s.name) && s.arguments.command)
            if (cmds.length === 0) {
              return <div className="p-3 text-xs" style={{ color: MONO.t3 }}>{t('office.wbNoTerm')}</div>
            }
            return (
              <div className="p-3 space-y-2.5">
                {cmds.map((s) => (
                  <div key={s.id} className="rounded-lg overflow-hidden" style={{ background: '#0a0d14' }}>
                    <div className="px-3 py-1.5 text-xs" style={{ fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace", color: '#22c55e' }}>
                      $ {truncate(s.arguments.command, 120)}
                    </div>
                    {s.result && (
                      <div
                        className="px-3 pb-2 text-xs whitespace-pre-wrap break-all"
                        style={{ fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace", color: '#cbd5e1', lineHeight: 1.6 }}
                      >
                        {truncate(s.result, 3000)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          })()
        )}
      </div>
    </div>
  )
}
