import { useRef, useCallback, useEffect } from 'react'
import { monaco } from '@/editor/monacoSetup'
import { sendLLMRequest } from '@/services/llm/LLMClient'
import { useConfigStore } from '@/stores/configStore'
import { useEditorStore } from '@/stores/editorStore'

// Files above this size skip inline completion entirely. `model.getValue()`
// copies the entire buffer into a JS string (which is then JSON-serialized
// across IPC to the LLM), so even a single keystroke on a huge file would
// freeze the UI for seconds. The completion UX is sacrificed here in favor
// of a usable editor — the user can still type, save, search, and chat.
const INLINE_COMPLETION_MAX_BYTES = 200 * 1024 // 200 KB

export function useInlineCompletion(
  editor: monaco.editor.IStandaloneCodeEditor | null
) {
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const isGeneratingRef = useRef(false)
  const currentSuggestionRef = useRef<string>('')
  const decorationRef = useRef<string[]>([])

  const showInlineSuggestion = useCallback((editor: monaco.editor.IStandaloneCodeEditor, suggestion: string) => {
    const position = editor.getPosition()
    if (!position) return

    // Use Monaco's inline decoration to show ghost text
    const model = editor.getModel()
    if (!model) return

    // Clear previous decorations
    decorationRef.current = editor.deltaDecorations(decorationRef.current, [
      {
        range: new monaco.Range(
          position.lineNumber,
          position.column,
          position.lineNumber,
          position.column + suggestion.length
        ),
        options: {
          afterContentClassName: 'inline-suggestion',
          hoverMessage: { value: '按 **Tab** 接受补全\n按 **Esc** 拒绝补全' },
        },
      },
    ])

    // Show the suggestion as inline text via content widget
    const widgetId = 'inline-completion-widget'
    const widget: monaco.editor.IContentWidget = {
      getId: () => widgetId,
      getDomNode: () => {
        const node = document.createElement('div')
        node.textContent = suggestion
        node.style.cssText = `
          color: #666;
          font-family: inherit;
          font-size: inherit;
          pointer-events: none;
          white-space: pre;
          opacity: 0.5;
        `
        return node
      },
      getPosition: () => ({
        position: { lineNumber: position.lineNumber, column: position.column },
        preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
      }),
    }

    editor.addContentWidget(widget)

    // Tab to accept / Escape to reject — via a temporary keydown listener on the
    // editor DOM node. Monaco's addCommand has no public removal API (the binding
    // would linger for the editor's lifetime and re-insert stale text on later
    // Tab presses), so the listener is attached only while the widget is showing.
    const domNode = editor.getDomNode()
    const removeWidget = () => {
      domNode?.removeEventListener('keydown', keyHandler)
      editor.removeContentWidget(widget)
      decorationRef.current = editor.deltaDecorations(decorationRef.current, [])
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        editor.executeEdits('inline-completion', [
          { range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column), text: suggestion },
        ])
        removeWidget()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        removeWidget()
      }
    }
    domNode?.addEventListener('keydown', keyHandler)

    // Remove widget on next edit
    const disposable = editor.onDidChangeModelContent(() => {
      disposable.dispose()
      removeWidget()
    })
  }, [])

  const provideCompletion = useCallback(async () => {
    if (!editor || isGeneratingRef.current) return

    const model = editor.getModel()
    const position = editor.getPosition()
    if (!model || !position) return

    // Large-file gate: getValue() copies the whole buffer. Bail before that
    // copy so typing on a big file stays snappy.
    if (model.getValueLength() > INLINE_COMPLETION_MAX_BYTES) return

    const configGroup = useConfigStore.getState().getActiveConfigGroup()
    if (!configGroup) return

    const activeFile = useEditorStore.getState().getActiveFile()
    if (!activeFile) return

    // Get context before cursor (getValueInRange avoids a full-buffer copy)
    const startLine = Math.max(1, position.lineNumber - 80)
    const textBeforeCursor = model.getValueInRange(
      new monaco.Range(startLine, 1, position.lineNumber, position.column)
    )

    isGeneratingRef.current = true

    try {
      const language = activeFile.language
      const filePath = activeFile.path

      const prompt = `You are a code completion assistant. Complete the code at the cursor position.
Only output the completion text, no explanations.

File: ${filePath}
Language: ${language}

Code before cursor:
\`\`\`${language}
${textBeforeCursor}
\`\`\`

Complete the code at the cursor position. Only output the completion, starting from where the code left off.`

      const req = {
        model: configGroup.defaultModel || 'gpt-4o-mini',
        messages: [
          { role: 'system' as const, content: 'You are a code completion assistant. Only output the code completion, no explanations or markdown.' },
          { role: 'user' as const, content: prompt },
        ],
        stream: false,
        temperature: 0.2,
        maxTokens: 200,
        topP: 1,
        frequencyPenalty: 0,
        presencePenalty: 0,
      }

      let completion = ''
      for await (const chunk of sendLLMRequest(req, configGroup)) {
        if (chunk.content) completion += chunk.content
        if (chunk.done) break
      }

      // Clean up the completion
      completion = completion.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()

      if (completion && editor.getPosition()) {
        currentSuggestionRef.current = completion
        showInlineSuggestion(editor, completion)
      }
    } catch (error) {
      // Silently fail - inline completion is optional
      console.debug('内联补全失败:', error)
    } finally {
      isGeneratingRef.current = false
    }
  }, [editor, showInlineSuggestion])

  // Debounced completion trigger
  const triggerCompletion = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(() => {
      provideCompletion()
    }, 1500) // 1.5 second debounce
  }, [provideCompletion])

  // Listen for content changes
  useEffect(() => {
    if (!editor) return

    const disposable = editor.onDidChangeModelContent(() => {
      // Clear existing suggestions
      decorationRef.current = editor.deltaDecorations(decorationRef.current, [])
      triggerCompletion()
    })

    return () => {
      disposable.dispose()
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [editor, triggerCompletion])

  return {
    triggerCompletion,
    clearSuggestion: () => {
      if (editor) {
        decorationRef.current = editor.deltaDecorations(decorationRef.current, [])
      }
    },
  }
}
