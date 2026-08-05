import { useEffect, useRef } from 'react'
import { useUIStore, ContextMenuItem } from '@/stores/uiStore'

export default function ContextMenu() {
  const { contextMenu, hideContextMenu } = useUIStore()
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    if (!contextMenu) return

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        hideContextMenu()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hideContextMenu()
    }

    // Delay to avoid immediate close from the same right-click
    setTimeout(() => {
      document.addEventListener('click', handleClick)
      document.addEventListener('keydown', handleEscape)
    }, 0)

    return () => {
      document.removeEventListener('click', handleClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [contextMenu, hideContextMenu])

  // Adjust position to stay within viewport
  useEffect(() => {
    if (!contextMenu || !menuRef.current) return
    const menu = menuRef.current
    const rect = menu.getBoundingClientRect()
    const padding = 8

    let x = contextMenu.x
    let y = contextMenu.y

    if (x + rect.width > window.innerWidth - padding) {
      x = window.innerWidth - rect.width - padding
    }
    if (y + rect.height > window.innerHeight - padding) {
      y = window.innerHeight - rect.height - padding
    }

    menu.style.left = `${Math.max(padding, x)}px`
    menu.style.top = `${Math.max(padding, y)}px`
  }, [contextMenu])

  if (!contextMenu) return null

  return (
    <div
      ref={menuRef}
      className="context-menu fixed z-[100]"
      style={{ left: contextMenu.x, top: contextMenu.y }}
    >
      {contextMenu.items.map((item, index) => {
        if (item.separator) {
          return <div key={index} className="h-px bg-[#454545] my-1" />
        }

        return (
          <div
            key={index}
            className={`context-menu-item ${item.disabled ? 'opacity-40 pointer-events-none' : ''}`}
            onClick={() => {
              if (!item.disabled && item.action) {
                item.action()
              }
              hideContextMenu()
            }}
          >
            {item.icon && <span className="text-sm w-4 text-center">{item.icon}</span>}
            <span className="flex-1 text-sm">{item.label}</span>
            {item.shortcut && (
              <span className="text-xs text-gray-500 ml-4">{item.shortcut}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
