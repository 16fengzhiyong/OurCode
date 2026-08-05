import { useRef, useEffect, useCallback, useState } from 'react'
import * as monaco from 'monaco-editor'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'
import { useInlineCompletion } from '@/hooks/useInlineCompletion'

// Shared model cache across all editor instances
const sharedModels = new Map<string, monaco.editor.ITextModel>()

// Track all editor instances for theme updates
const editorInstances = new Set<monaco.editor.IStandaloneCodeEditor>()

// Expose primary editor on window for keyboard shortcuts
const updateWindowEditor = () => {
  const editors = Array.from(editorInstances)
  ;(window as any).__monacoEditor = editors[0] || null
}

interface EditorContainerProps {
  panelId: string
}

export default function EditorContainer({ panelId }: EditorContainerProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const monacoRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  // Held in state (not just a ref) so useInlineCompletion's effects re-run once the editor exists
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null)

  const panels = useEditorStore((s) => s.panels)
  const openFiles = useEditorStore((s) => s.openFiles)
  const preferences = useEditorStore((s) => s.preferences)
  const updateFileContent = useEditorStore((s) => s.updateFileContent)
  const markDirty = useEditorStore((s) => s.markDirty)
  const setActivePanel = useEditorStore((s) => s.setActivePanel)
  const setCursorPosition = useEditorStore((s) => s.setCursorPosition)

  const panel = panels[panelId]
  const activeFilePath = panel?.activeFilePath ?? null

  const { openCommandPalette, showContextMenu, theme: uiTheme } = useUIStore()

  // AI inline completion (ghost text, Tab to accept / Esc to reject)
  const { triggerCompletion } = useInlineCompletion(editor)

  // Initialize Monaco
  useEffect(() => {
    if (!editorRef.current) return

    const currentTheme = useUIStore.getState().theme
    const isDark = currentTheme === 'dark' || (currentTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

    const editor = monaco.editor.create(editorRef.current, {
      automaticLayout: true,
      fontSize: preferences.fontSize,
      fontFamily: preferences.fontFamily,
      tabSize: preferences.tabSize,
      minimap: { enabled: preferences.showMinimap },
      lineNumbers: 'on',
      roundedSelection: true,
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      theme: isDark ? 'vs-dark' : 'vs',
      padding: { top: 8 },
      suggest: {
        showMethods: true,
        showFunctions: true,
        showConstructors: true,
        showFields: true,
        showVariables: true,
        showClasses: true,
        showStructs: true,
        showInterfaces: true,
        showModules: true,
        showProperties: true,
        showEvents: true,
        showOperators: true,
        showUnits: true,
        showValues: true,
        showConstants: true,
        showEnums: true,
        showEnumMembers: true,
        showKeywords: true,
        showWords: true,
        showColors: true,
        showFiles: true,
        showReferences: true,
        showFolders: true,
        showTypeParameters: true,
        showSnippets: true,
      },
    })

    monacoRef.current = editor
    setEditor(editor)
    editorInstances.add(editor)
    updateWindowEditor()

    // Mark this panel active on focus
    editor.onDidFocusEditorWidget(() => {
      useEditorStore.getState().setActivePanel(panelId)
    })

    // Add command palette shortcut
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP, () => {
      openCommandPalette()
    })

    // Track cursor position changes
    editor.onDidChangeCursorPosition((e) => {
      const state = useEditorStore.getState()
      const panel = state.panels[panelId]
      if (panel?.activeFilePath) {
        setCursorPosition({
          line: e.position.lineNumber,
          column: e.position.column,
        })
        // Save per-file cursor
        useEditorStore.setState((s) => ({
          openFiles: s.openFiles.map((f) =>
            f.path === panel.activeFilePath
              ? { ...f, cursorPosition: { line: e.position.lineNumber, column: e.position.column } }
              : f
          ),
        }))
      }
    })

    // Right-click context menu with AI operations
    editor.onContextMenu((e) => {
      const selection = editor.getSelection()
      const selectedText = selection && !selection.isEmpty()
        ? editor.getModel()?.getValueInRange(selection) || ''
        : ''

      const filePath = useEditorStore.getState().panels[panelId]?.activeFilePath || ''
      const fileName = filePath.split(/[/\\]/).pop() || ''
      const ext = fileName.split('.').pop() || ''

      const items = [
        { label: '剪切', shortcut: 'Ctrl+X', action: () => editor.trigger('keyboard', 'editor.action.clipboardCutAction', null) },
        { label: '复制', shortcut: 'Ctrl+C', action: () => editor.trigger('keyboard', 'editor.action.clipboardCopyAction', null) },
        { label: '粘贴', shortcut: 'Ctrl+V', action: () => editor.trigger('keyboard', 'editor.action.clipboardPasteAction', null) },
        { separator: true, label: '' },
        { label: '折叠', shortcut: 'Ctrl+Shift+[', action: () => editor.trigger('keyboard', 'editor.fold', null) },
        { label: '展开', shortcut: 'Ctrl+Shift+]', action: () => editor.trigger('keyboard', 'editor.unfold', null) },
        { separator: true, label: '' },
        ...(selectedText ? [
          { label: '--- AI 操作 ---', disabled: true },
          { label: 'AI: 解释这段代码', icon: '🤖', action: () => sendToAI('请解释以下代码的含义和功能：\n\n```' + ext + '\n' + selectedText + '\n```') },
          { label: 'AI: 重构建议', icon: '🔧', action: () => sendToAI('请对以下代码提供重构建议，优化其可读性和性能：\n\n```' + ext + '\n' + selectedText + '\n```') },
          { label: 'AI: 生成单元测试', icon: '🧪', action: () => sendToAI('请为以下代码生成单元测试：\n\n```' + ext + '\n' + selectedText + '\n```') },
          { label: 'AI: 生成文档注释', icon: '📝', action: () => sendToAI('请为以下代码生成详细的文档注释（JSDoc/Docstring）：\n\n```' + ext + '\n' + selectedText + '\n```') },
          { label: 'AI: 修复问题', icon: '🩹', action: () => sendToAI('请检查以下代码中的问题并提供修复方案：\n\n```' + ext + '\n' + selectedText + '\n```') },
          { label: 'AI: 优化性能', icon: '⚡', action: () => sendToAI('请分析以下代码的性能瓶颈并提供优化方案：\n\n```' + ext + '\n' + selectedText + '\n```') },
          { label: 'AI: 翻译为英文', icon: '🌐', action: () => sendToAI('请将以下代码中的中文注释和字符串翻译为英文：\n\n```' + ext + '\n' + selectedText + '\n```') },
        ] : []),
        { label: 'AI: 内联补全', icon: '✨', action: () => triggerCompletion() },
        { separator: true, label: '' },
        { label: '命令面板', shortcut: 'Ctrl+Shift+P', action: () => openCommandPalette() },
      ]

      showContextMenu(e.event.posx, e.event.posy, items)
    })

    return () => {
      editorInstances.delete(editor)
      updateWindowEditor()
      editor.dispose()
    }
  }, [])

  const sendToAI = useCallback((prompt: string) => {
    const chatStore = useChatStore.getState()
    if (!chatStore.activeSessionId) {
      const configStore = useConfigStore.getState()
      if (configStore.activeConfigGroupId) {
        chatStore.createSession(configStore.activeConfigGroupId)
      }
    }
    chatStore.sendMessage(prompt)
    useUIStore.getState().toggleChat()
  }, [])

  // Update editor options when preferences change
  useEffect(() => {
    monacoRef.current?.updateOptions({
      fontSize: preferences.fontSize,
      fontFamily: preferences.fontFamily,
      tabSize: preferences.tabSize,
      minimap: { enabled: preferences.showMinimap },
    })
  }, [preferences])

  // Update Monaco theme when UI theme changes
  useEffect(() => {
    const isDark = uiTheme === 'dark' || (uiTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    monaco.editor.setTheme(isDark ? 'vs-dark' : 'vs')
  }, [uiTheme])

  // Create/switch models when active file changes
  useEffect(() => {
    const editor = monacoRef.current
    if (!editor || !activeFilePath) {
      if (monacoRef.current) {
        monacoRef.current.setModel(null)
      }
      return
    }

    const file = openFiles.find((f) => f.path === activeFilePath)
    if (!file) return

    let model = sharedModels.get(activeFilePath)

    if (!model) {
      const uri = monaco.Uri.parse(`file:///${activeFilePath}`)
      model = monaco.editor.createModel(file.content, file.language, uri)
      sharedModels.set(activeFilePath, model)

      model.onDidChangeContent(() => {
        const content = model!.getValue()
        updateFileContent(activeFilePath, content)
        markDirty(activeFilePath, true)
      })
    } else {
      if (model.getValue() !== file.content) {
        model.setValue(file.content)
      }
    }

    editor.setModel(model)

    if (file.cursorPosition) {
      editor.setPosition({
        lineNumber: file.cursorPosition.line,
        column: file.cursorPosition.column,
      })
      editor.revealLineInCenter(file.cursorPosition.line)
    }
  }, [activeFilePath, openFiles])

  // Cleanup models for closed files
  useEffect(() => {
    const openPaths = new Set(openFiles.map((f) => f.path))

    for (const [path, model] of sharedModels) {
      if (!openPaths.has(path)) {
        model.dispose()
        sharedModels.delete(path)
      }
    }
  }, [openFiles])

  // Empty state
  if (!activeFilePath) {
    return (
      <div className="flex-1 h-full flex items-center justify-center text-nova-text-muted">
        <div className="text-center">
          <div className="text-6xl mb-4 opacity-30">📝</div>
          <div className="text-lg text-nova-text-secondary">打开文件开始编辑</div>
          <div className="text-sm mt-2">
            使用 <kbd className="px-2 py-1 bg-nova-hover rounded text-xs">Ctrl+P</kbd> 快速打开文件
          </div>
          <div className="text-sm mt-1">
            或使用 <kbd className="px-2 py-1 bg-nova-hover rounded text-xs">Ctrl+O</kbd> 打开文件夹
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={editorRef} className="flex-1" />
  )
}
