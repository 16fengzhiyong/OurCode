import { useEffect, useState } from 'react'
import MainLayout from './components/Layout/MainLayout'
import ErrorBoundary from './components/Common/ErrorBoundary'
import ToolApprovalDialog from './components/ChatPanel/ToolApprovalDialog'
import OnboardingModal from './components/Onboarding/OnboardingModal'
import { useConfigStore } from './stores/configStore'
import { useChatStore, refreshGitBranch } from './stores/chatStore'
import { useEditorStore } from './stores/editorStore'
import { useUIStore } from './stores/uiStore'
import { useAICommandsStore } from './stores/aiCommandsStore'
import { useShortcutStore } from './stores/shortcutStore'

export default function App() {
  const loadConfigGroups = useConfigStore((s) => s.loadConfigGroups)
  const loadSessions = useChatStore((s) => s.loadSessions)
  const loadPreferences = useEditorStore((s) => s.loadPreferences)
  const { initTheme } = useUIStore()
  const loadCommands = useAICommandsStore((s) => s.loadCommands)

  const [showOnboarding, setShowOnboarding] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const hasCompleted = localStorage.getItem('hasCompletedOnboarding')
    loadConfigGroups().then(async () => {
      loadSessions()
      await loadPreferences()
      // Restore the persisted theme (initTheme used to hardcode 'dark' on startup)
      initTheme(useEditorStore.getState().preferences.theme)
      loadCommands()
      // Load persisted shortcut presets/custom bindings before the first keystroke
      useShortcutStore.getState().loadShortcuts()
      refreshGitBranch()
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
      {ready && showOnboarding && <OnboardingModal onComplete={handleOnboardingComplete} />}
    </ErrorBoundary>
  )
}
