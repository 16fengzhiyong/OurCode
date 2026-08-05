import { useUIStore } from '@/stores/uiStore'

export default function ActivityBar() {
  const { activeSidebarTab, setActiveSidebarTab, toggleSidebar, openMarketplace, isSidebarVisible } = useUIStore()

  const topIcons = [
    {
      key: 'files' as const,
      title: '资源管理器 (Ctrl+Shift+E)',
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22">
          <rect x="2" y="2" width="20" height="20" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <line x1="2" y1="8" x2="22" y2="8" stroke="currentColor" strokeWidth="1.5" />
          <line x1="8" y1="2" x2="8" y2="8" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ),
    },
    {
      key: 'search' as const,
      title: '搜索 (Ctrl+Shift+F)',
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22">
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      key: 'git' as const,
      title: '源代码管理 (Ctrl+Shift+G)',
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22">
          <circle cx="6" cy="6" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="18" cy="6" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="6" cy="18" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <line x1="6" y1="9" x2="6" y2="15" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 12 C6 12, 12 9, 15 6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 12 C6 12, 12 15, 15 18" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ),
    },
    {
      key: 'extensions' as const,
      title: '扩展 (Ctrl+Shift+X)',
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22">
          <rect x="2" y="2" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="13" y="2" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="2" y="13" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <line x1="16" y1="13" x2="22" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="19" y1="10" x2="19" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ),
    },
  ]

  const bottomIcons = [
    {
      key: 'settings',
      title: '设置 (Ctrl+,)',
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22">
          <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ),
      action: () => useUIStore.getState().openSettings(),
    },
    {
      key: 'account',
      title: '账户',
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22">
          <circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
    if (!isSidebarVisible) {
      toggleSidebar()
    }
    setActiveSidebarTab(key as 'files' | 'search' | 'git')
  }

  return (
    <div
      className="shrink-0 flex flex-col select-none"
      style={{
        width: 48,
        background: '#333333',
        borderRight: '1px solid #252525',
      }}
    >
      {/* Top icons */}
      <div className="flex flex-col items-center flex-1">
        {topIcons.map((item) => {
          const isActive = isSidebarVisible && activeSidebarTab === item.key
          return (
            <button
              key={item.key}
              aria-label={item.title} title={item.title}
              onClick={() => handleClick(item.key)}
              className="relative flex items-center justify-center"
              style={{
                width: 48,
                height: 48,
                color: isActive ? '#d4d4d4' : '#858585',
                borderLeft: isActive ? '2px solid #007acc' : '2px solid transparent',
                background: isActive ? 'rgba(255,255,255,0.05)' : 'transparent',
                transition: 'color 0.15s, border-color 0.15s, background 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.color = '#d4d4d4'
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.color = '#858585'
              }}
            >
              {item.icon}
            </button>
          )
        })}
      </div>

      {/* Bottom icons */}
      <div className="flex flex-col items-center">
        {bottomIcons.map((item) => (
          <button
            key={item.key}
            aria-label={item.title} title={item.title}
            onClick={item.action}
            style={{
              width: 48,
              height: 48,
              color: '#858585',
              borderLeft: '2px solid transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#d4d4d4' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#858585' }}
          >
            {item.icon}
          </button>
        ))}
      </div>
    </div>
  )
}
