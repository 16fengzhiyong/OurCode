/**
 * Core application commands. Registered once at startup so the shortcut
 * handler, the command palette and plugins all resolve the same IDs.
 * Import for its side effects (e.g. `import '@/services/commands/coreCommands'`).
 */
import { registerCommand } from './commandRegistry'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'
import { useProblemsStore } from '@/stores/problemsStore'
import { useRecentFilesStore } from '@/stores/recentFilesStore'

/** Trigger a Monaco command on the focused editor. */
function runEditorCommand(command: string): void {
  const editor = (window as unknown as { __monacoEditor?: { trigger: (source: string, cmd: string, payload: unknown) => void } }).__monacoEditor
  editor?.trigger('keyboard', command, null)
}

/** Open a folder and reveal it in the file explorer. */
async function openFolderFlow(): Promise<void> {
  const path = await window.electronAPI.openFolder()
  if (!path) return
  const ui = useUIStore.getState()
  ui.setRootPath(path)
  ui.setActiveSidebarTab('files')
  if (!ui.isSidebarVisible) ui.toggleSidebar()
}

/** Export the active session in the given format. */
function exportActiveSession(format: 'markdown' | 'json'): void {
  const session = useChatStore.getState().getActiveSession()
  if (!session) return
  const data = useChatStore.getState().exportSession(session.id, format)
  const blob = new Blob([data], { type: format === 'markdown' ? 'text/markdown' : 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `对话-${Date.now()}.${format === 'markdown' ? 'md' : 'json'}`
  a.click()
  URL.revokeObjectURL(url)
}

/** Ensure a chat session exists (creating one with the active config group). */
function ensureChatSession(): void {
  const chat = useChatStore.getState()
  if (chat.activeSessionId) return
  const configId = useConfigStore.getState().activeConfigGroupId
  if (configId) chat.createSession(configId)
  else useUIStore.getState().openSettings()
}

export function registerCoreCommands(): void {
  // ── File ──
  registerCommand({
    id: 'newFile', title: '新建文件', category: '文件', shortcut: 'Ctrl+N',
    run: () => useEditorStore.getState().newFile(),
  })
  registerCommand({
    id: 'openFolder', title: '打开文件夹', category: '文件', shortcut: 'Ctrl+O',
    run: () => openFolderFlow(),
  })
  registerCommand({
    id: 'saveFile', title: '保存文件', category: '文件', shortcut: 'Ctrl+S',
    run: () => {
      const { activeFilePath, saveFile } = useEditorStore.getState()
      if (activeFilePath) void saveFile(activeFilePath)
    },
  })
  registerCommand({
    id: 'saveAll', title: '保存所有文件', category: '文件', shortcut: 'Ctrl+Shift+S',
    run: () => void useEditorStore.getState().saveAll(),
  })
  registerCommand({
    id: 'closeTab', title: '关闭当前标签', category: '文件', shortcut: 'Ctrl+W',
    run: () => {
      const { activeFilePath, openFiles, closeFile } = useEditorStore.getState()
      if (!activeFilePath) return
      const file = openFiles.find((f) => f.path === activeFilePath)
      if (file?.isDirty) {
        if (confirm('有未保存的更改，确定关闭？')) closeFile(activeFilePath)
      } else {
        closeFile(activeFilePath)
      }
    },
  })

  // ── Edit (Monaco native) ──
  registerCommand({ id: 'undo', title: '撤销', category: '编辑', shortcut: 'Ctrl+Z', run: () => runEditorCommand('undo') })
  registerCommand({ id: 'redo', title: '重做', category: '编辑', shortcut: 'Ctrl+Shift+Z', run: () => runEditorCommand('redo') })
  registerCommand({ id: 'find', title: '查找', category: '编辑', shortcut: 'Ctrl+F', run: () => runEditorCommand('actions.find') })
  registerCommand({ id: 'replace', title: '替换', category: '编辑', shortcut: 'Ctrl+H', run: () => runEditorCommand('editor.action.startFindReplaceAction') })

  // ── View ──
  registerCommand({ id: 'toggleSidebar', title: '切换侧边栏', category: '视图', shortcut: 'Ctrl+B', run: () => useUIStore.getState().toggleSidebar() })
  registerCommand({ id: 'toggleTerminal', title: '切换终端', category: '视图', shortcut: 'Ctrl+J', run: () => useUIStore.getState().toggleTerminal() })
  registerCommand({ id: 'toggleChat', title: '切换 AI 面板', category: '视图', shortcut: 'Ctrl+L', run: () => useUIStore.getState().toggleChat() })
  registerCommand({ id: 'toggleProblems', title: '切换问题面板', category: '视图', shortcut: 'Ctrl+Shift+M', run: () => useProblemsStore.getState().toggle() })
  registerCommand({ id: 'commandPalette', title: '打开命令面板', category: '视图', shortcut: 'Ctrl+Shift+P', run: () => useUIStore.getState().openCommandPalette() })
  registerCommand({ id: 'quickOpen', title: '快速打开文件', category: '视图', shortcut: 'Ctrl+P', run: () => useUIStore.getState().openQuickOpen() })
  registerCommand({ id: 'recentFiles', title: '最近打开的文件', category: '文件', shortcut: 'Ctrl+R', run: () => useRecentFilesStore.getState().toggle() })
  registerCommand({ id: 'openMarketplace', title: '打开扩展市场', category: '视图', shortcut: 'Ctrl+Shift+X', run: () => useUIStore.getState().openMarketplace() })
  registerCommand({ id: 'openSettings', title: '打开设置', category: '视图', run: () => useUIStore.getState().openSettings() })
  registerCommand({ id: 'newWindow', title: '新窗口', category: '视图', run: () => window.electronAPI.openNewWindow() })
  registerCommand({ id: 'splitPanelHorizontal', title: '左右分屏', category: '视图', shortcut: 'Ctrl+\\', run: () => useEditorStore.getState().splitPanel('horizontal') })
  registerCommand({ id: 'splitPanelVertical', title: '上下分屏', category: '视图', run: () => useEditorStore.getState().splitPanel('vertical') })
  registerCommand({
    id: 'closePanel', title: '关闭当前分屏', category: '视图',
    run: () => {
      const state = useEditorStore.getState()
      if (state.panelOrder.length > 1) state.closePanel(state.activePanelId)
    },
  })
  registerCommand({ id: 'cyclePanelFocus', title: '切换分屏焦点', category: '视图', shortcut: 'Ctrl+Shift+\\', run: () => useEditorStore.getState().cyclePanelFocus() })
  registerCommand({ id: 'zoomIn', title: '放大', category: '视图', shortcut: 'Ctrl+=', run: () => runEditorCommand('editor.action.fontZoomIn') })
  registerCommand({ id: 'zoomOut', title: '缩小', category: '视图', shortcut: 'Ctrl+-', run: () => runEditorCommand('editor.action.fontZoomOut') })

  // ── Chat / AI ──
  registerCommand({
    id: 'newChatSession', title: '新建对话', category: '对话', shortcut: 'Ctrl+Shift+N',
    run: () => {
      const configId = useConfigStore.getState().activeConfigGroupId
      if (configId) useChatStore.getState().createSession(configId)
      else useUIStore.getState().openSettings()
    },
  })
  registerCommand({
    id: 'sendSelectionToAI', title: '发送选中文本给 AI', category: '对话', shortcut: 'Ctrl+Shift+L',
    run: () => {
      const selection = window.getSelection()?.toString()
      if (!selection) return
      ensureChatSession()
      useChatStore.getState().sendMessage(`解释这段代码:\n\n\`\`\`\n${selection}\n\`\`\``)
      if (!useUIStore.getState().isChatVisible) useUIStore.getState().toggleChat()
    },
  })
  registerCommand({
    id: 'clearChat', title: '清空当前对话', category: '对话',
    run: () => {
      const session = useChatStore.getState().getActiveSession()
      if (session) useChatStore.getState().clearMessages(session.id)
    },
  })
  registerCommand({ id: 'exportChatMarkdown', title: '导出对话为 Markdown', category: '对话', run: () => exportActiveSession('markdown') })
  registerCommand({ id: 'exportChatJson', title: '导出对话为 JSON', category: '对话', run: () => exportActiveSession('json') })
}
