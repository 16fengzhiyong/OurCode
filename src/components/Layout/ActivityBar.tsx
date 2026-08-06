import { useUIStore } from '@/stores/uiStore'
import { useI18n } from '@/i18n/useI18n'
import type { TranslationKey } from '@/i18n'

export default function ActivityBar() {
  const { activeSidebarTab, setActiveSidebarTab, toggleSidebar, openMarketplace, isSidebarVisible } = useUIStore()
  const t = useI18n()

  const topIcons: Array<{ key: 'files' | 'git' | 'changes' | 'extensions'; titleKey: TranslationKey; icon: JSX.Element }> = [
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
    // File change history: switch to the changes panel in the sidebar
    if (key === 'changes') {
      const ui = useUIStore.getState()
      if (!ui.isSidebarVisible) ui.toggleSidebar()
      ui.setActiveSidebarTab('changes')
      return
    }
    if (!isSidebarVisible) {
      toggleSidebar()
    }
    setActiveSidebarTab(key as 'files' | 'git')
  }

  return (
    <div
      className="shrink-0 flex flex-col select-none"
      style={{
        width: 44,
        background: 'var(--bg-activity)',
        borderRight: '1px solid var(--border)',
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
              className="relative flex items-center justify-center rounded-sm transition-all"
              style={{
                width: 38,
                height: 38,
                color: isActive ? '#EDEDED' : '#71717A',
                background: isActive ? 'rgba(37, 99, 235, 0.12)' : 'transparent',
                margin: '1px 0',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = '#E4E4E7'
                  e.currentTarget.style.background = '#2E2E33'
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = '#71717A'
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
                    top: 6,
                    bottom: 6,
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
              color: '#71717A',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s, background 0.15s',
              borderRadius: 6,
              margin: '1px 0',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#E4E4E7'
              e.currentTarget.style.background = '#2E2E33'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#71717A'
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
