import { useEffect, useMemo, useRef, useState } from 'react'
import type { Checkpoint } from '@/types'
import { useChatStore } from '@/stores/chatStore'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useI18n } from '@/i18n/useI18n'
import RevertAllConfirmDialog from './RevertAllConfirmDialog'

interface FileChangesSummaryProps {
  sessionId: string
  /** Checkpoints belonging to the active session (AI write-tool snapshots). */
  checkpoints: Checkpoint[]
}

/** 会话结束后的「文件改动」汇总框 —— 中性灰 · 极简纯净版（Stitch 设计稿 V2
 *  落地方案）：slate 灰底 + 发丝线边框 + 圆角卡。头部左侧标题行可点击展开/
 *  收起文件列表，右侧放「回退全部改动」按钮（不出框）；文件行显示完整路径，
 *  行内 hover 浮现单个回退按钮，回退过的文件按钮消失（标「已回退」），全部
 *  回退后「回退全部改动」隐藏。改动数据来自 checkpoints（写文件前的快照）。
 *
 *  父组件以 key={sessionId} 渲染本组件——切换会话即重新挂载，本地状态
 *  （已回退标记 / 累计文件列表）随之重置，无需内部监听会话 id。 */
export default function FileChangesSummary({ sessionId, checkpoints }: FileChangesSummaryProps) {
  const t = useI18n()
  const revertCheckpoint = useChatStore((s) => s.revertCheckpoint)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  // 点「回退全部改动」先弹确认框（列文件 + 回退/保留），确认后才执行。
  const [confirmRevertAll, setConfirmRevertAll] = useState(false)
  // 已回退的文件路径集合 —— 回退后行保留（标记已回退）但不显示回退按钮。
  const [reverted, setReverted] = useState<Set<string>>(new Set())
  // 本会话出现过的全部改动文件（去重，按首次出现顺序）。用状态累计而非每次
  // 从 checkpoints 重算：回退成功后 checkpoint 会从 store 移除，若依赖实时
  // checkpoints 推导列表，已回退的行会整行消失（与「保留行、只藏按钮」冲突）。
  const [seenPaths, setSeenPaths] = useState<string[]>(() => {
    const seen = new Set<string>()
    const paths: string[] = []
    for (const cp of checkpoints) {
      if (cp.sessionId !== sessionId) continue
      for (const f of cp.files || []) {
        if (f.path && !seen.has(f.path)) {
          seen.add(f.path)
          paths.push(f.path)
        }
      }
    }
    return paths
  })

  const sessionCheckpoints = useMemo(
    () => checkpoints.filter((c) => c.sessionId === sessionId),
    [checkpoints, sessionId],
  )

  // 继续对话产生的新改动：新增文件补进列表；被再次改动的文件（出现新的
  // checkpoint）从「已回退」标记中移除，重新可回退。
  const prevCpIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const currentIds = new Set(sessionCheckpoints.map((c) => c.id))
    const newCps = sessionCheckpoints.filter((c) => !prevCpIdsRef.current.has(c.id))
    prevCpIdsRef.current = currentIds
    if (newCps.length === 0) return
    const newPaths = Array.from(new Set(
      newCps.flatMap((c) => (c.files || []).map((f) => f.path).filter(Boolean)),
    ))
    if (newPaths.length === 0) return
    setSeenPaths((prev) => Array.from(new Set([...prev, ...newPaths])))
    setReverted((prev) => {
      const next = new Set(prev)
      for (const p of newPaths) next.delete(p)
      return next
    })
  }, [sessionCheckpoints])

  const openFile = (p: string) => useEditorStore.getState().openFile(p)

  const notify = (ok: number, failed: number) => {
    if (failed > 0) {
      useUIStore.getState().showNotification(t('chat.filesChangedRevertFailed', { count: failed }), 'error')
    } else if (ok > 0) {
      useUIStore.getState().showNotification(t('chat.filesChangedReverted', { count: ok }), 'success')
    } else {
      useUIStore.getState().showNotification(t('chat.filesChangedEmpty'), 'info')
    }
  }

  const markReverted = (paths: string[]) => {
    setReverted((prev) => {
      const next = new Set(prev)
      for (const p of paths) next.add(p)
      return next
    })
  }

  /** 回退单个文件：回退所有包含该文件快照的检查点，返回该文件是否全部回退
   *  成功（任一 checkpoint 失败则该文件保持可回退，可重试）。 */
  const revertFile = async (path: string): Promise<boolean> => {
    const cps = sessionCheckpoints.filter((cp) => (cp.files || []).some((f) => f.path === path))
    if (cps.length === 0) return true
    let ok = 0
    for (const cp of cps) {
      const res = await revertCheckpoint(cp.id)
      if (res?.ok) ok++
    }
    return ok === cps.length
  }

  /** 确认弹窗里选「回退」后真正执行全部回退。 */
  const handleRevertAll = async () => {
    setConfirmRevertAll(false)
    const pending = seenPaths.filter((p) => !reverted.has(p))
    if (busy || pending.length === 0) return
    setBusy(true)
    try {
      let okFiles = 0
      let failedFiles = 0
      const revertedPaths: string[] = []
      for (const p of pending) {
        if (await revertFile(p)) {
          okFiles++
          revertedPaths.push(p)
        } else {
          failedFiles++
        }
      }
      if (revertedPaths.length > 0) markReverted(revertedPaths)
      notify(okFiles, failedFiles)
    } finally {
      setBusy(false)
    }
  }

  /** 回退单个文件：回退所有包含该文件快照的检查点（同一检查点可能还包了
   *  其它文件，语义与消息级「回滚修改」一致——恢复快照时刻的全部内容）。 */
  const handleRevertFile = async (path: string) => {
    if (busy || reverted.has(path)) return
    setBusy(true)
    try {
      if (await revertFile(path)) {
        markReverted([path])
        notify(1, 0)
      } else {
        notify(0, 1)
      }
    } finally {
      setBusy(false)
    }
  }

  if (seenPaths.length === 0) return null

  const pendingCount = seenPaths.filter((p) => !reverted.has(p)).length

  return (
    <div className="shrink-0 animate-fade-in bg-slate-50/50 dark:bg-white/5 rounded-xl border border-slate-200/60 dark:border-white/10 overflow-hidden">
      {/* 头部：左侧点击展开/收起，右侧「回退全部改动」（不出框） */}
      <div className="px-4 py-3 flex items-center gap-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className={`flex items-center gap-2 min-w-0 flex-1 cursor-pointer transition-colors rounded ${
            expanded ? '' : 'hover:bg-slate-100/50 dark:hover:bg-white/5'
          }`}
        >
          <span className="material-symbols-outlined text-[15px] leading-none text-slate-500 dark:text-nova-text-muted shrink-0" aria-hidden>description</span>
          <span className="text-sm font-medium text-slate-800 dark:text-nova-text-primary truncate">
            {t('chat.filesChangedTitle', { count: seenPaths.length })}
          </span>
          <span
            className={`material-symbols-outlined text-[18px] leading-none text-slate-400 dark:text-nova-text-muted shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            aria-hidden
          >
            expand_more
          </span>
        </button>
        {pendingCount > 0 && (
          <button
            onClick={() => setConfirmRevertAll(true)}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 bg-red-50 hover:bg-red-100 dark:bg-red-500/10 dark:hover:bg-red-500/20 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors shrink-0 disabled:opacity-50"
          >
            {busy ? (
              <span className="w-4 h-4 border-2 border-red-500/30 border-t-red-600 rounded-full animate-spin inline-block" />
            ) : (
              <span className="material-symbols-outlined text-[15px] leading-none" aria-hidden>undo</span>
            )}
            {t('chat.filesChangedRevertAll')}
          </button>
        )}
      </div>

      {/* 回退全部 —— 确认弹窗（列文件 + 回退/保留） */}
      {confirmRevertAll && (
        <RevertAllConfirmDialog
          filePaths={seenPaths.filter((p) => !reverted.has(p))}
          onRevert={() => void handleRevertAll()}
          onKeep={() => setConfirmRevertAll(false)}
          onClose={() => setConfirmRevertAll(false)}
        />
      )}

      {expanded && (
        <>
          {/* 文件列表 —— 完整路径，行 hover 变白、图标转蓝 */}
          <div className="px-4 pb-3 pt-1.5 flex flex-col gap-1.5 border-t border-slate-200/60 dark:border-white/10">
            {seenPaths.map((p) => {
              const isReverted = reverted.has(p)
              return (
                <div
                  key={p}
                  className={`group flex items-center justify-between gap-2 py-1 pl-6 pr-1 rounded transition-colors ${
                    isReverted
                      ? 'text-slate-400 dark:text-nova-text-muted'
                      : 'text-slate-600 dark:text-nova-text-secondary hover:bg-white dark:hover:bg-white/5 cursor-pointer'
                  }`}
                  onClick={isReverted ? undefined : () => openFile(p)}
                  title={p}
                >
                  <span className="flex items-center gap-2 min-w-0 flex-1">
                    <span
                      className={`material-symbols-outlined text-[15px] leading-none shrink-0 transition-colors ${
                        isReverted
                          ? 'text-slate-300 dark:text-nova-text-muted/50'
                          : 'text-slate-400 dark:text-nova-text-muted group-hover:text-blue-500'
                      }`}
                      aria-hidden
                    >
                      description
                    </span>
                    <span className="font-mono text-[13px] truncate">{p}</span>
                  </span>
                  {isReverted ? (
                    <span className="shrink-0 flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                      <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden>check</span>
                      {t('chat.filesChangedRevertedTag')}
                    </span>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRevertFile(p)
                      }}
                      disabled={busy}
                      title={t('chat.filesChangedRevertFile')}
                      className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all disabled:opacity-40"
                    >
                      <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden>undo</span>
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          {/* 底部说明 */}
          <div className="bg-white/50 dark:bg-white/5 border-t border-slate-200/60 dark:border-white/10 px-4 py-3">
            <span className="text-[11px] text-slate-400 dark:text-nova-text-muted">{t('chat.filesChangedFooterHint')}</span>
          </div>
        </>
      )}
    </div>
  )
}
