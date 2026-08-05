import { useState } from 'react'
import { useConfigStore } from '@/stores/configStore'

const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', defaultUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', name: 'Anthropic', defaultUrl: 'https://api.anthropic.com' },
  { id: 'deepseek', name: 'DeepSeek', defaultUrl: 'https://api.deepseek.com/v1' },
  { id: 'ollama', name: 'Ollama (Local)', defaultUrl: 'http://localhost:11434/v1' },
  { id: 'gemini', name: 'Google Gemini', defaultUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'groq', name: 'Groq', defaultUrl: 'https://api.groq.com/openai/v1' },
  { id: 'custom', name: 'Custom', defaultUrl: '' },
]

interface OnboardingModalProps {
  onComplete: () => void
}

export default function OnboardingModal({ onComplete }: OnboardingModalProps) {
  const { createConfigGroup } = useConfigStore()

  const [step, setStep] = useState(0)
  const [name, setName] = useState('My API')
  const [provider, setProvider] = useState('openai')
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
  const [apiKey, setApiKey] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState('')

  const handleProviderChange = (p: string) => {
    setProvider(p)
    const prov = PROVIDERS.find((pr) => pr.id === p)
    if (prov) setBaseUrl(prov.defaultUrl)
  }

  const handleCreate = async () => {
    if (!apiKey.trim()) {
      setError('API Key is required')
      return
    }
    setIsCreating(true)
    setError('')
    try {
      await createConfigGroup({
        name,
        provider: provider as any,
        baseUrl,
        apiKey: apiKey.trim(),
      })
      onComplete()
    } catch (e: any) {
      setError(e.message || 'Failed to create config group')
    } finally {
      setIsCreating(false)
    }
  }

  const handleSkip = () => {
    onComplete()
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-nova-surface border border-nova-border rounded-2xl shadow-2xl w-[520px] overflow-hidden">
        {/* Header */}
        <div className="px-8 pt-8 pb-4 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <span className="text-2xl font-bold text-white">N</span>
          </div>
          <h1 className="text-xl font-bold text-nova-text-primary mb-1">Welcome to Nova Studio</h1>
          <p className="text-sm text-nova-text-muted">AI-Powered IDE &middot; Let&apos;s get you started</p>
        </div>

        {/* Content */}
        <div className="px-8 pb-6">
          {step === 0 ? (
            /* Welcome step */
            <div className="space-y-4">
              <div className="bg-nova-bg rounded-lg p-4 space-y-3">
                <Feature icon="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" text="Full-featured code editor with Monaco" />
                <Feature icon="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" text="AI chat with multi-provider support" />
                <Feature icon="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" text="Integrated terminal, Git, and file management" />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleSkip}
                  className="flex-1 px-4 py-2.5 text-sm text-nova-text-muted hover:text-nova-text-primary border border-nova-border rounded-lg transition-colors"
                >
                  Skip for now
                </button>
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 px-4 py-2.5 text-sm font-medium bg-nova-accent text-white rounded-lg hover:opacity-90 transition-opacity"
                >
                  Set up API Key
                </button>
              </div>
            </div>
          ) : (
            /* API setup step */
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-nova-text-secondary mb-1.5">Config Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-nova-bg border border-nova-border rounded-lg text-sm text-nova-text-primary focus:outline-none focus:border-nova-accent"
                />
              </div>

              <div>
                <label className="block text-sm text-nova-text-secondary mb-1.5">Provider</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleProviderChange(p.id)}
                      className={`px-2 py-1.5 text-xs rounded-md border transition-colors ${
                        provider === p.id
                          ? 'bg-nova-accent/20 text-nova-accent border-nova-accent/40'
                          : 'bg-nova-bg text-nova-text-muted border-nova-border hover:border-nova-accent/30'
                      }`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm text-nova-text-secondary mb-1.5">API Endpoint</label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="w-full px-3 py-2 bg-nova-bg border border-nova-border rounded-lg text-sm text-nova-text-primary font-mono focus:outline-none focus:border-nova-accent"
                />
              </div>

              <div>
                <label className="block text-sm text-nova-text-secondary mb-1.5">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setError('') }}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 bg-nova-bg border border-nova-border rounded-lg text-sm text-nova-text-primary placeholder-nova-text-muted focus:outline-none focus:border-nova-accent"
                />
                {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
                <p className="text-[10px] text-nova-text-muted mt-1">
                  You can also use environment variables: $OPENAI_API_KEY
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setStep(0)}
                  className="px-4 py-2.5 text-sm text-nova-text-muted hover:text-nova-text-primary border border-nova-border rounded-lg transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleSkip}
                  className="px-4 py-2.5 text-sm text-nova-text-muted hover:text-nova-text-primary transition-colors"
                >
                  Skip
                </button>
                <button
                  onClick={handleCreate}
                  disabled={isCreating}
                  className="flex-1 px-4 py-2.5 text-sm font-medium bg-nova-accent text-white rounded-lg hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  {isCreating ? 'Creating...' : 'Create & Start'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Feature({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-nova-accent/10 flex items-center justify-center shrink-0">
        <svg className="w-4 h-4 text-nova-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={icon} />
        </svg>
      </div>
      <span className="text-sm text-nova-text-secondary">{text}</span>
    </div>
  )
}
