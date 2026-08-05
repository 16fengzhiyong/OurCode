import { useRef, useCallback, useEffect } from 'react'
import * as monaco from 'monaco-editor'
import { sendLLMRequest } from '@/services/llm/LLMClient'
import { useConfigStore } from '@/stores/configStore'
import { useEditorStore } from '@/stores/editorStore'

export function useInlineCompletion(
  editor: monaco.editor.IStandaloneCodeEditor | null
) {
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const isGeneratingRef = useRef(false)
  const currentSuggestionRef = useRef<string>('')
  const decorationRef = useRef<string[]>([])

  const provideCompletion = useCallback(async () => {
    if (!editor || isGeneratingRef.current) return

    const model = editor.getModel()
    const position = editor.getPosition()
    if (!model || !position) return

    const configGroup = useConfigStore.getState().getActiveConfigGroup()
    if (!configGroup) return

    const activeFile = useEditorStore.getState().getActiveFile()
    if (!activeFile) return

    // Get context around cursor
    const fullText = model.getValue()
    const offset = model.getOffsetAt(position)
    const textBeforeCursor = fullText.slice(Math.max(0, offset - 2000), offset)
    const textAfterCursor = fullText.slice(offset, Math.min(fullText.length, offset + 500))

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
  }, [editor])

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

    // Remove widget on next edit
    const disposable = editor.onDidChangeModelContent(() => {
      editor.removeContentWidget(widget)
      decorationRef.current = editor.deltaDecorations(decorationRef.current, [])
      disposable.dispose()
    })

    // Tab to accept
    const tabHandler = editor.addCommand(monaco.KeyCode.Tab, () => {
      editor.executeEdits('inline-completion', [
        { range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column), text: suggestion },
      ])
      editor.removeContentWidget(widget)
      decorationRef.current = editor.deltaDecorations(decorationRef.current, [])
    })

    // Escape to reject
    const escHandler = editor.addCommand(monaco.KeyCode.Escape, () => {
      editor.removeContentWidget(widget)
      decorationRef.current = editor.deltaDecorations(decorationRef.current, [])
    })
  }, [])

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
