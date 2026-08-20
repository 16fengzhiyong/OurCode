import { useMemo, useState } from 'react'
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
 *  落地方案）：默认透明无边框、不抢眼（「回退全部改动」按钮也是中性灰），
 *  鼠标指到整框时才浮现 slate 灰底 + 发丝线边框、按钮才显出红色。头部左侧
 *  标题行可点击展开/收起文件列表，右侧放「回退全部改动」按钮（不出框）；
 *  文件行显示完整路径，行内 hover 浮现单个回退按钮，回退过的文件行保留
 *  （标「已回退」）但按钮消失，全部回退后「回退全部改动」隐藏。
 *
 *  文件列表与「已回退」状态都从 store 派生（checkpoints = 未回退的快照，
 *  revertedFiles = 已回退的文件路径），不放在组件本地 state —— 否则切换会话
 *  重新挂载时本地状态重置，回退过的文件会整框消失（或又显示成「未回退」）。 */
export default function FileChangesSummary({ sessionId, checkpoints }: FileChangesSummaryProps) {
  const t = useI18n()
  const revertCheckpoint = useChatStore((s) => s.revertCheckpoint)
  const revertedFiles = useChatStore((s) => s.revertedFiles)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  // 点「回退全部改动」先弹确认框（列文件 + 回退/保留），确认后才执行。
  const [confirmRevertAll, setConfirmRevertAll] = useState(false)

  // 本会话的检查点（父组件通常已按会话过滤，这里再兜底一次以防串会话）。
  const sessionCheckpoints = useMemo(
    () => checkpoints.filter((c) => c.sessionId === sessionId),
    [checkpoints, sessionId],
  )

  // 仍可回退的文件路径（有未回退检查点即算可回退）。
  const pendingPaths = useMemo(() => {
    const set = new Set<string>()
    for (const cp of sessionCheckpoints) {
      for (const f of cp.files || []) {
        if (f.path) set.add(f.path)
      }
    }
    return set
  }, [sessionCheckpoints])

  // 本会话出现过的全部改动文件（去重）：检查点里的文件在前，已回退的文件补在
  // 后面。回退后该文件从 checkpoints 移入 revertedFiles，因此行不会消失。
  const allPaths = useMemo(() => {
    const seen = new Set<string>()
    const paths: string[] = []
    for (const cp of sessionCheckpoints) {
      for (const f of cp.files || []) {
        if (f.path && !seen.has(f.path)) {
          seen.add(f.path)
          paths.push(f.path)
        }
      }
    }
    for (const p of revertedFiles) {
      if (!seen.has(p)) {
        seen.add(p)
        paths.push(p)
      }
    }
    return paths
  }, [sessionCheckpoints, revertedFiles])

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

  /** 回退单个文件：回退所有包含该文件快照的检查点，返回该文件是否全部回退
   *  成功（任一 checkpoint 失败则该文件保持可回退，可重试）。 */
  const revertFile = async (path: string): Promise<boolean> => {
    // 从 store 读最新检查点（而非渲染闭包里的 memo）：回退一个文件会消耗掉
    // 同时快照了其它文件的检查点，同批后续回退必须看到该检查点已消失，避免
    // 重复回退同一个检查点（第二次会因「检查点不存在」而误判失败）。
    const cps = useChatStore.getState().checkpoints
      .filter((cp) => cp.sessionId === sessionId)
      .filter((cp) => (cp.files || []).some((f) => f.path === path))
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
    const pending = allPaths.filter((p) => pendingPaths.has(p))
    if (busy || pending.length === 0) return
    setBusy(true)
    try {
      let okFiles = 0
      let failedFiles = 0
      for (const p of pending) {
        if (await revertFile(p)) okFiles++
        else failedFiles++
      }
      notify(okFiles, failedFiles)
    } finally {
      setBusy(false)
    }
  }

  /** 回退单个文件：回退所有包含该文件快照的检查点（同一检查点可能还包了
   *  其它文件，语义与消息级「回滚修改」一致——恢复快照时刻的全部内容）。 */
  const handleRevertFile = async (path: string) => {
    if (busy || !pendingPaths.has(path)) return
    setBusy(true)
    try {
      if (await revertFile(path)) {
        notify(1, 0)
      } else {
        notify(0, 1)
      }
    } finally {
      setBusy(false)
    }
  }

  if (allPaths.length === 0) return null

  const pendingCount = allPaths.filter((p) => pendingPaths.has(p)).length

  return (
    // 不抢眼：默认透明无边框（只有标题文字），hover 才浮现卡片底色与发丝线边框。
    <div className="shrink-0 animate-fade-in rounded-xl border border-transparent hover:bg-slate-50/50 dark:hover:bg-white/5 hover:border-slate-200/60 dark:hover:border-white/10 transition-colors overflow-hidden">
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
            {t('chat.filesChangedTitle', { count: allPaths.length })}
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
            // 默认中性灰（不抢眼），hover 才显红 —— 颜色只在鼠标指到时浮现。
            className="inline-flex items-center justify-center gap-1.5 text-slate-500 hover:text-red-600 dark:text-nova-text-muted dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 border border-transparent hover:border-red-200 dark:hover:border-red-500/30 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors shrink-0 disabled:opacity-50"
          >
            {busy ? (
              <span className="w-4 h-4 border-2 border-slate-400/30 border-t-slate-600 dark:border-nova-text-muted/30 dark:border-t-nova-text-muted rounded-full animate-spin inline-block" />
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
          filePaths={allPaths.filter((p) => pendingPaths.has(p))}
          onRevert={() => void handleRevertAll()}
          onKeep={() => setConfirmRevertAll(false)}
          onClose={() => setConfirmRevertAll(false)}
        />
      )}

      {expanded && (
        <>
          {/* 文件列表 —— 完整路径，行 hover 变白、图标转蓝 */}
          <div className="px-4 pb-3 pt-1.5 flex flex-col gap-1.5 border-t border-slate-200/60 dark:border-white/10">
            {allPaths.map((p) => {
              const isReverted = !pendingPaths.has(p)
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
        </>
      )}
    </div>
  )
}
