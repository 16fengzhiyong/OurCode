import { useUIStore } from '@/stores/uiStore'
import { useI18n } from '@/i18n/useI18n'
import type { TranslationKey } from '@/i18n'

export default function ActivityBar() {
  const { activeSidebarTab, setActiveSidebarTab, toggleSidebar, openMarketplace, isSidebarVisible } = useUIStore()
  const t = useI18n()

  const topIcons: Array<{ key: 'files' | 'git' | 'changes' | 'agent' | 'extensions' | 'usage'; titleKey: TranslationKey; icon: JSX.Element }> = [
    {
      key: 'files',
      titleKey: 'activityBar.explorer' as TranslationKey,
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
    {
      key: 'git',
      titleKey: 'activityBar.scm' as TranslationKey,
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="18" cy="6" r="2.5" />
          <circle cx="6" cy="18" r="2.5" />
          <line x1="6" y1="8.5" x2="6" y2="15.5" />
          <path d="M6 12C6 12 12 9 15.5 6" />
          <path d="M6 12C6 12 12 15 15.5 18" />
        </svg>
      ),
    },
    {
      key: 'changes',
      titleKey: 'activityBar.history' as TranslationKey,
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15 15" />
        </svg>
      ),
    },
    {
      key: 'agent',
      titleKey: 'activityBar.agent' as TranslationKey,
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="8" width="16" height="12" rx="2" />
          <path d="M12 8V4" />
          <circle cx="12" cy="3" r="1.2" />
          <path d="M9 13h.01M15 13h.01M9 17h6" />
        </svg>
      ),
    },
    {
      key: 'usage',
      titleKey: 'activityBar.usage' as TranslationKey,
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="20" x2="4" y2="14" />
          <line x1="10" y1="20" x2="10" y2="6" />
          <line x1="16" y1="20" x2="16" y2="11" />
          <line x1="22" y1="20" x2="22" y2="3" />
          <path d="M2 20h22" />
        </svg>
      ),
    },
    {
      key: 'extensions',
      titleKey: 'activityBar.extensions' as TranslationKey,
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="2" width="8" height="8" rx="1.2" />
          <rect x="14" y="2" width="8" height="8" rx="1.2" />
          <rect x="2" y="14" width="8" height="8" rx="1.2" />
          <line x1="17" y1="14" x2="23" y2="14" />
          <line x1="20" y1="11" x2="20" y2="17" />
        </svg>
      ),
    },
  ]

  const bottomIcons: Array<{ key: string; titleKey: TranslationKey; icon: JSX.Element; action: () => void }> = [
    {
      key: 'settings',
      titleKey: 'activityBar.settings' as TranslationKey,
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="2.5" />
          <path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" strokeLinecap="round" />
        </svg>
      ),
      action: () => useUIStore.getState().openSettings(),
    },
    {
      key: 'account',
      titleKey: 'activityBar.account' as TranslationKey,
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="8" r="3.5" />
          <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" strokeLinecap="round" />
        </svg>
      ),
      action: () => {},
    },
  ]

  const handleClick = (key: string) => {
    if (key === 'extensions') {
      openMarketplace()
      return
    }
    // Sidebar panels (file change history / agent tasks / usage): switch tab
    if (key === 'changes' || key === 'agent' || key === 'usage') {
      const ui = useUIStore.getState()
      if (!ui.isSidebarVisible) ui.toggleSidebar()
      ui.setActiveSidebarTab(key as 'changes' | 'agent' | 'usage')
      return
    }
    if (!isSidebarVisible) {
      toggleSidebar()
    }
    setActiveSidebarTab(key as 'files' | 'git')
  }

  return (
    <div
      className="shrink-0 flex flex-col select-none rounded-xl glass-chrome"
      style={{
        width: 44,
        background: 'color-mix(in srgb, var(--card, rgba(255,255,255,0.75)) 55%, transparent)',
      }}
    >
      {/* Top icons */}
      <div className="flex flex-col items-center flex-1 py-1 gap-px">
        {topIcons.map((item) => {
          const isActive = isSidebarVisible && activeSidebarTab === item.key
          return (
            <button
              key={item.key}
              aria-label={t(item.titleKey)} title={t(item.titleKey)}
              onClick={() => handleClick(item.key)}
              className="relative flex items-center justify-center rounded-full transition-all"
              style={{
                width: 38,
                height: 38,
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                background: isActive ? 'var(--bg-selected)' : 'transparent',
                margin: '1px 0',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = 'var(--text-secondary)'
                  e.currentTarget.style.background = 'var(--hover)'
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = 'var(--text-muted)'
                  e.currentTarget.style.background = 'transparent'
                }
              }}
            >
              {/* Active indicator bar */}
              {isActive && (
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 7,
                    bottom: 7,
                    width: 2,
                    background: 'var(--accent)',
                    borderRadius: '0 2px 2px 0',
                  }}
                />
              )}
              {item.icon}
            </button>
          )
        })}
      </div>

      {/* Bottom icons */}
      <div className="flex flex-col items-center pb-1 gap-px">
        {bottomIcons.map((item) => (
          <button
            key={item.key}
            aria-label={t(item.titleKey)} title={t(item.titleKey)}
            onClick={item.action}
            style={{
              width: 38,
              height: 38,
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s, background 0.15s',
              borderRadius: 9999,
              margin: '1px 0',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)'
              e.currentTarget.style.background = 'var(--hover)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-muted)'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {item.icon}
          </button>
        ))}
      </div>
    </div>
  )
}
