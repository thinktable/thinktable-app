// Promote empty `/board` to `/board/{id}` without a Next.js App Router navigation.
// `router.replace` swaps `app/board/page.tsx` for `app/board/[id]/page.tsx` and unmounts
// the in-flight frame + I-bar capture, which blanks the frame and drops rapid typing.

export function replaceBoardUrl(boardId: string) {
  if (typeof window === 'undefined' || !boardId) return // SSR / missing id — no-op
  const next = `/board/${boardId}` // Canonical shareable board path
  if (window.location.pathname === next) return // Already on this board
  // Keep Next.js router state on `/board` so the client tree stays mounted
  window.history.replaceState(window.history.state, '', next)
  // Sidebar, toolbar, and BoardPage listen for this to enable message queries
  window.dispatchEvent(
    new CustomEvent('conversation-created', { detail: { conversationId: boardId } })
  )
}
