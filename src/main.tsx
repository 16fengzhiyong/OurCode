import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'
import { useEditorStore } from './stores/editorStore'
import { DEFAULT_PREFERENCES } from './types'
import { setLocale, resolveLocale, setSystemLocale, getSystemLocale, type LanguagePreference } from './i18n'

/**
 * Load persisted preferences + system locale BEFORE the first render so the
 * initial language is applied without a flash of the default locale. The
 * splash screen in index.html stays visible while these async calls run.
 */
async function bootstrap(): Promise<void> {
  try {
    const prefs = await window.electronAPI.getPreferences()
    useEditorStore.setState({ preferences: { ...DEFAULT_PREFERENCES, ...prefs } })
  } catch {
    // Keep store defaults if preferences can't be read
  }
  try {
    setSystemLocale(await window.electronAPI.getLocale())
  } catch {
    // Falls back to navigator.language inside the i18n module
  }
  setLocale(resolveLocale(
    useEditorStore.getState().preferences.language as LanguagePreference,
    getSystemLocale(),
  ))

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void bootstrap()
