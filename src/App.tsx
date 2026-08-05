import { useEffect, useState } from 'react'
import MainLayout from './components/Layout/MainLayout'
import ErrorBoundary from './components/Common/ErrorBoundary'
import ToolApprovalDialog from './components/ChatPanel/ToolApprovalDialog'
import QuestionDialog from './components/ChatPanel/QuestionDialog'
import OnboardingModal from './components/Onboarding/OnboardingModal'
import RestoreBackupsModal from './components/Editor/RestoreBackupsModal'
import type { BackupEntry } from '@shared/types'
import { useConfigStore } from './stores/configStore'
import { useChatStore, refreshGitBranch } from './stores/chatStore'
import { useEditorStore } from './stores/editorStore'
import { useUIStore } from './stores/uiStore'
import { useMemoryStore } from './stores/memoryStore'
import { useWorkflowStore } from './stores/workflowStore'
import { useAICommandsStore } from './stores/aiCommandsStore'
import { useShortcutStore } from './stores/shortcutStore'
import { ensureProblemsSubscription, useProblemsStore } from './stores/problemsStore'
import { ensureLspDiagnosticsSubscription } from './services/lsp/lspClient'
import { ensureDebugEventSubscription } from './stores/debugStore'
import { registerCoreCommands } from './services/commands/coreCommands'
import { setLocale, resolveLocale, getSystemLocale, type LanguagePreference } from './i18n'

export default function App() {
  const loadConfigGroups = useConfigStore((s) => s.loadConfigGroups)
  const loadSessions = useChatStore((s) => s.loadSessions)
  const loadPreferences = useEditorStore((s) => s.loadPreferences)
  const { initTheme } = useUIStore()
  const loadCommands = useAICommandsStore((s) => s.loadCommands)
  const loadMemories = useMemoryStore((s) => s.loadMemories)
  const loadWorkflows = useWorkflowStore((s) => s.loadWorkflows)

  const [showOnboarding, setShowOnboarding] = useState(false)
  const [ready, setReady] = useState(false)
  const [pendingBackups, setPendingBackups] = useState<BackupEntry[]>([])

  // Re-resolve the UI language (and re-register command titles/categories, which
  // are captured as resolved strings) whenever the preference changes.
  const language = useEditorStore((s) => s.preferences.language)
  useEffect(() => {
    setLocale(resolveLocale((language ?? 'system') as LanguagePreference, getSystemLocale()))
    registerCoreCommands()
    loadCommands()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only refresh on language change
  }, [language])

  useEffect(() => {
    const hasCompleted = localStorage.getItem('hasCompletedOnboarding')
    // Register the shared command surface (shortcuts / palette / plugins)
    registerCoreCommands()
    loadConfigGroups().then(async () => {
      loadSessions()
      await loadPreferences()
      // Apply the persisted UI language to the document ('system' resolves to
      // the OS locale captured at bootstrap)
      setLocale(resolveLocale(
        (useEditorStore.getState().preferences.language ?? 'system') as LanguagePreference,
        getSystemLocale(),
      ))
      // Restore the persisted theme (initTheme used to hardcode 'dark' on startup)
      initTheme(useEditorStore.getState().preferences.theme)
      loadCommands()
      // Load persistent user memories (injected into the agent prompt)
      loadMemories()
      // Load reusable workflow templates
      loadWorkflows()
      // Load persisted shortcut presets/custom bindings before the first keystroke
      useShortcutStore.getState().loadShortcuts()
      refreshGitBranch()
      // Hot-exit backups from a previous session (crash / force-quit recovery)
      try {
        const backups = await window.electronAPI.listBackups()
        if (backups.length > 0) setPendingBackups(backups)
      } catch { /* ignore */ }
      // Live diagnostics: follow Monaco's marker stream into the Problems panel
      ensureProblemsSubscription()
      useProblemsStore.getState().refresh()
      // LSP diagnostics → markers (opt-in language servers)
      ensureLspDiagnosticsSubscription()
      // Debug Adapter Protocol events (single session)
      ensureDebugEventSubscription()
      setReady(true)
      if (!hasCompleted) {
        setShowOnboarding(true)
      }
    })

    // Fade out splash screen
    const splash = document.getElementById('splash-screen')
    if (splash) {
      splash.classList.add('fade-out')
      setTimeout(() => splash.remove(), 500)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only init; store actions are stable references
  }, [])

  const handleOnboardingComplete = () => {
    localStorage.setItem('hasCompletedOnboarding', 'true')
    setShowOnboarding(false)
  }

  return (
    <ErrorBoundary>
      <MainLayout />
      <ToolApprovalDialog />
      <QuestionDialog />
      {ready && showOnboarding && <OnboardingModal onComplete={handleOnboardingComplete} />}
      {ready && pendingBackups.length > 0 && (
        <RestoreBackupsModal backups={pendingBackups} onClose={() => setPendingBackups([])} />
      )}
    </ErrorBoundary>
  )
}
