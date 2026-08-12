import { createPortal } from 'react-dom'

/**
 * Renders children into document.body via a portal.
 *
 * Fullscreen fixed modals must NOT stay inside a backdrop-filter / transform
 * ancestor: `glass-chrome` (chat panel etc.) has backdrop-filter, which both
 * creates a stacking context AND re-anchors `position: fixed` descendants to
 * that panel (its containing block), and the panel is overflow-hidden — so a
 * `fixed inset-0 z-[100]` modal ends up confined to / clipped by the chat panel
 * instead of covering the whole window (the "记住" preview popup was trapped
 * like this). Portaling to <body> escapes both the containing block and the
 * stacking context, so the overlay covers the real viewport and paints above
 * every panel.
 */
export default function ModalPortal({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body)
}
