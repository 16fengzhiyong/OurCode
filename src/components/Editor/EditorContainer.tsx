import { useRef, useEffect, useCallback, useState } from 'react'
import { monaco } from '@/editor/monacoSetup'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { useConfigStore } from '@/stores/configStore'
import { useInlineCompletion } from '@/hooks/useInlineCompletion'
import { registerModel, unregisterModel, getModel, getRegisteredPaths, takeLoader, trackLoad } from '@/editor/modelRegistry'
import type { UserPreferences } from '@/types'

// Files above this size get large-file editor settings (no word wrap / minimap)
const LARGE_FILE_OPTIMIZE_BYTES = 10 * 1024 * 1024

// Per-file cursor positions live outside the store so cursor movement never
// rebuilds the `openFiles` array (which would re-render every subscriber — the
// tab bar, status bar and the options effect — on every arrow key of a big
// file). Restored when the file becomes active again.
const fileCursors = new Map<string, { line: number; column: number }>()

/**
 * Editor options for a file. Large files get a reduced-feature preset (like VS
 * Code's large-file mode) so scrolling and rendering stay at 60 fps; the
 * heavy interactive features (minimap, folding, hover, suggestions, bracket
 * colorization, semantic highlighting, smooth scrolling) are kept off.
 */
function buildMonacoOptions(
  preferences: UserPreferences,
  large: boolean,
  isDark: boolean,
): monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    automaticLayout: true,
    fontSize: preferences.fontSize,
    fontFamily: preferences.fontFamily,
    tabSize: preferences.tabSize,
    theme: isDark ? 'vs-dark' : 'vs',
    padding: { top: 8 },
    largeFileOptimizations: true,
    minimap: { enabled: large ? false : preferences.showMinimap },
    wordWrap: large ? 'off' : 'on',
    folding: !large,
    links: !large,
    colorDecorators: !large,
    renderLineHighlight: large ? 'none' : 'all',
    cursorBlinking: large ? 'solid' : 'blink',
    smoothScrolling: !large,
    scrollBeyondLastLine: false,
    bracketPairColorization: { enabled: !large },
    'semanticHighlighting.enabled': large ? false : 'configuredByTheme',
    guides: { indentation: !large },
    quickSuggestions: large
      ? { other: false, comments: false, strings: false }
      : { other: true, comments: false, strings: false },
    hover: { enabled: !large },
    suggestOnTriggerCharacters: !large,
    wordBasedSuggestions: large ? 'off' : 'currentDocument',
    parameterHints: { enabled: !large },
    stopRenderingLineAfter: 10000,
    matchBrackets: large ? 'never' : 'always',
    occurrencesHighlight: large ? 'off' : 'multiFile',
    selectionHighlight: !large,
    lineDecorationsWidth: large ? 0 : 10,
    unicodeHighlight: {
      ambiguousCharacters: !large,
      invisibleCharacters: !large,
    },
  }
}

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
  const setCursorPosition = useEditorStore((s) => s.setCursorPosition)

  const panel = panels[panelId]
  const activeFilePath = panel?.activeFilePath ?? null
  const activeFile = useEditorStore((s) => s.openFiles.find((f) => f.path === activeFilePath))
  // The file size as a primitive — a selector returning it only re-renders when
  // the size actually changes, never on cursor-move store churn.
  const activeFileSize = useEditorStore((s) => s.openFiles.find((f) => f.path === activeFilePath)?.size)

  const { openCommandPalette, showContextMenu, theme: uiTheme } = useUIStore()

  // AI inline completion (ghost text, Tab to accept / Esc to reject)
  const { triggerCompletion } = useInlineCompletion(editor)

  // Reload open models when a file changes on disk (tool edits / checkpoint reverts)
  useEffect(() => {
    const reloadModel = (path: string) => {
      const model = getModel(path)
      if (!model || model.isDisposed()) return
      window.electronAPI.readFile(path).then(({ content }) => {
        if (!model.isDisposed() && model.getValue() !== content) {
          model.setValue(content)
        }
      }).catch(() => { /* file may have been deleted */ })
    }
    const unsubFs = window.electronAPI.onFileChanged((path) => reloadModel(path))
    const onLocal = (e: Event) => reloadModel((e as CustomEvent).detail)
    window.addEventListener('ourcode:file-changed', onLocal)
    return () => {
      unsubFs()
      window.removeEventListener('ourcode:file-changed', onLocal)
    }
  }, [])

  // Initialize Monaco
  useEffect(() => {
    if (!editorRef.current) return

    const currentTheme = useUIStore.getState().theme
    const isDark = currentTheme === 'dark' || (currentTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

    // Preset the large-file options up front when the first file is already
    // large, so Monaco doesn't build expensive state before the per-file effect
    // below gets a chance to downgrade the features.
    const state = useEditorStore.getState()
    const currentFile = state.openFiles.find((f) => f.path === state.activeFilePath)
    const largeAtCreate = (currentFile?.size ?? 0) > LARGE_FILE_OPTIMIZE_BYTES

    const editor = monaco.editor.create(
      editorRef.current,
      buildMonacoOptions(preferences, largeAtCreate, isDark),
    )

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
        // Per-file cursor lives in a module map (not the store) so arrow-key
        // navigation on a big file doesn't rebuild `openFiles` on every move.
        fileCursors.set(panel.activeFilePath, { line: e.position.lineNumber, column: e.position.column })
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
          { label: '✨ Vibe 替换: 重写所选内容', icon: '✨', action: () => vibeReplace(selectedText, ext) },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: the editor is created once; option changes go through updateOptions below
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

  // Vibe and Replace (Windsurf-style): rewrite the current selection from a
  // natural-language description. The prompt includes the selected text; the
  // assistant's reply carries the new code, which can be applied back via the
  // "应用到编辑器" button on the message.
  const vibeReplace = useCallback((selectedText: string, ext: string) => {
    const filePath = useEditorStore.getState().panels[panelId]?.activeFilePath || ''
    sendToAI(
      `（Vibe 替换）我将告诉你如何改写下面选中代码，请直接输出替换后的完整新代码（单个代码块，不要解释）：\n\n` +
      `请描述你希望的改法：\n\n` +
      `--- 当前选中代码 (${filePath}) ---\n` +
      `\`\`\`${ext}\n${selectedText}\n\`\`\``
    )
    // Ask for the rewrite goal after opening the chat
    setTimeout(() => {
      const input = document.querySelector('textarea[placeholder*="输入消息"]') as HTMLTextAreaElement | null
      input?.focus()
    }, 300)
  }, [panelId, sendToAI])

  // Keep editor options in sync with preferences and the active file's size
  // (large files get a reduced-feature preset). Depends on the file size as a
  // primitive, not the whole `openFiles` array, so this doesn't re-run on every
  // cursor move while navigating a big file.
  useEffect(() => {
    const large = (activeFileSize ?? 0) > LARGE_FILE_OPTIMIZE_BYTES
    const isDark = uiTheme === 'dark' || (uiTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    monacoRef.current?.updateOptions(buildMonacoOptions(preferences, large, isDark))
  }, [preferences, activeFileSize, uiTheme])

  // Update Monaco theme when UI theme changes
  useEffect(() => {
    const isDark = uiTheme === 'dark' || (uiTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    monaco.editor.setTheme(isDark ? 'vs-dark' : 'vs')
  }, [uiTheme])

  // Create/switch models when the active file changes. The Monaco model is the
  // source of truth for the text; editing only marks the file dirty (no full
  // document copy into the store per keystroke), and save/revert/AI context read
  // the live content through the model registry. Deps are just the active path so
  // this never re-runs on keystrokes — even for multi-megabyte files.
  useEffect(() => {
    const editor = monacoRef.current
    if (!editor || !activeFilePath) {
      if (monacoRef.current) {
        monacoRef.current.setModel(null)
      }
      return
    }

    const state = useEditorStore.getState()
    const file = state.openFiles.find((f) => f.path === activeFilePath)
    if (!file) return

    let model = getModel(activeFilePath)

    if (!model) {
      const uri = monaco.Uri.parse(`file:///${activeFilePath}`)
      // Start empty; a registered stream loader fills it chunk by chunk so large
      // files load without freezing the UI. Large files are plain text (no
      // syntax highlighting) — see PLAINTEXT_THRESHOLD_BYTES.
      model = monaco.editor.createModel('', file.plainText ? 'plaintext' : file.language, uri)
      registerModel(activeFilePath, model)

      model.onDidChangeContent(() => {
        // Edits applied while the file streams in are programmatic, not user
        // edits — only mark dirty once the load finished
        const current = useEditorStore.getState().openFiles.find((f) => f.path === activeFilePath)
        if (current && !current.isLoading) {
          useEditorStore.getState().markDirty(activeFilePath, true)
        }
      })

      const loader = takeLoader(activeFilePath)
      if (loader) {
        trackLoad(activeFilePath, loader(model))
      }
    }

    editor.setModel(model)

    const cursor = fileCursors.get(activeFilePath) ?? file.cursorPosition
    if (cursor) {
      editor.setPosition({
        lineNumber: cursor.line,
        column: cursor.column,
      })
      editor.revealLineInCenter(cursor.line)
    }
  }, [activeFilePath])

  // Cleanup models for closed files
  useEffect(() => {
    const openPaths = new Set(useEditorStore.getState().openFiles.map((f) => f.path))

    for (const path of getRegisteredPaths()) {
      if (!openPaths.has(path)) {
        getModel(path)?.dispose()
        unregisterModel(path)
      }
    }
  }, [openFiles])

  // The editor div is always mounted so the Monaco editor initializes once, even
  // when no file is open yet (previously the empty state replaced the div, the
  // one-time init effect saw `editorRef.current === null`, and the editor was
  // never created — every file then opened into a blank pane). The welcome text
  // is an overlay on top of the empty editor instead.
  return (
    <div className="flex-1 h-full min-h-0 flex flex-col">
      {activeFile?.plainText && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 text-xs bg-sky-500/15 text-sky-300 border-b border-sky-500/20">
          <span>📄</span>
          <span>
            大文本模式：文件较大（{formatMB(activeFile.size)} MB），以纯文本显示（无语法高亮），可正常编辑。
          </span>
        </div>
      )}
      <div className="relative flex-1 min-h-0">
        <div ref={editorRef} className="absolute inset-0" />
        {activeFile?.isLoading && (activeFile.size ?? 0) > 1024 * 1024 && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-nova-bg/70 pointer-events-none">
            <div className="w-8 h-8 rounded-full border-2 border-nova-accent border-t-transparent animate-spin" />
            <div className="text-sm text-nova-text-secondary">
              正在加载文件… {activeFile.loadProgress ?? 0}%
            </div>
            <div className="w-48 h-1 bg-nova-hover rounded-full overflow-hidden">
              <div
                className="h-full bg-nova-accent rounded-full transition-all duration-150"
                style={{ width: `${activeFile.loadProgress ?? 0}%` }}
              />
            </div>
          </div>
        )}
        {!activeFilePath && (
          <div className="absolute inset-0 flex items-center justify-center text-nova-text-muted pointer-events-none">
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
        )}
      </div>
    </div>
  )
}

/** Format a byte count as an MB integer for the preview banner. */
function formatMB(bytes: number | undefined): number {
  return Math.round((bytes ?? 0) / (1024 * 1024))
}
