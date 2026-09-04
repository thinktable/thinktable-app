// Edge auto-nav while dragging a chat↔board / chat↔chat thread rubber band:
// near chat content top/bottom → scroll the transcript; near board pane edges → pan.
// Never pan the board while the pointer is in the chat sidebar / dock chrome.

import {
  chatChromeRects,
  chatContentWindowRect,
  chatSidebarColumnRect,
} from '@/lib/ai/chat-thread-clip'

/** Same inset as RF `calcAutoPan` (~35px from the window edge). */
export const CHAT_THREAD_EDGE_INSET = 35

/** Same step as RF connect auto-pan (~20px per animation frame). */
export const CHAT_THREAD_EDGE_SPEED = 20

type Pt = { x: number; y: number } // Client / screen point

/** True when (x,y) lies inside rect (optional outward pad). */
function pointInRect(x: number, y: number, r: DOMRect, pad = 0): boolean {
  return ( // Inclusive hit test so edge pixels still count
    x >= r.left - pad &&
    x <= r.right + pad &&
    y >= r.top - pad &&
    y <= r.bottom + pad
  )
}

/**
 * RF `calcAutoPanVelocity` signs for `panBy` / `setViewport`:
 * near min (left/top) → +, near max (right/bottom) → −.
 */
export function edgePanDelta(
  value: number,
  min: number,
  max: number,
  speed = CHAT_THREAD_EDGE_SPEED
): number {
  if (value < min) return speed // Reveal content past the near edge
  if (value > max) return -speed // Reveal content past the far edge
  return 0 // Interior — no pan on this axis
}

/**
 * Transcript scroll: near top → scroll up (−), near bottom → scroll down (+).
 * Opposite of panBy signs because scrollTop grows downward.
 */
export function edgeScrollDelta(
  clientY: number,
  rect: DOMRect,
  inset = CHAT_THREAD_EDGE_INSET,
  speed = CHAT_THREAD_EDGE_SPEED
): number {
  if (clientY < rect.top + inset) return -speed // Pointer at top → reveal earlier turns
  if (clientY > rect.bottom - inset) return speed // Pointer at bottom → reveal later turns
  return 0 // Interior — leave scroll alone
}

/** Board pane used for edge pan (map column / phone canvas under dock). */
function boardPaneRect(): DOMRect | null {
  if (typeof document === 'undefined') return null // SSR
  const root = document.querySelector('[data-board-root]') as HTMLElement | null // BoardFlow root
  const flow = (root?.querySelector('.react-flow') as HTMLElement | null) || root // Prefer RF box
  if (!flow) return null
  const r = flow.getBoundingClientRect()
  return r.width >= 8 && r.height >= 8 ? r : null // Ignore collapsed layout frames
}

/** Live transcript scroller (desktop sidebar or phone content card). */
function transcriptScroller(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector('[data-ai-transcript-scroll]') as HTMLElement | null
}

/**
 * True when the pointer is over chat UI — desktop sidebar column or phone dock cards.
 * Board must not auto-pan here (header / composer share the board’s top/bottom Y).
 */
function pointerOverChatUi(ptr: Pt): boolean {
  const col = chatSidebarColumnRect() // Desktop sibling column (header + transcript + prompt)
  if (col && pointInRect(ptr.x, ptr.y, col)) return true
  return chatChromeRects().some((r) => pointInRect(ptr.x, ptr.y, r)) // Phone dock cards
}

export type ChatThreadEdgeNavOptions = {
  /** Latest pointer in client space (updated by move handlers). */
  getPointer: () => Pt
  /** Apply RF viewport pan in screen px (same units as store `panBy`). */
  panBoard?: (dx: number, dy: number) => void
  /** After a scroll/pan tick (e.g. re-anchor rubber `from` to the turn). */
  onTick?: () => void
}

/**
 * Start a rAF loop that scrolls chat / pans board while the pointer hugs an edge.
 * Returns a cancel function — call on pointerup / pointercancel.
 */
export function startChatThreadEdgeNav(opts: ChatThreadEdgeNavOptions): () => void {
  let raf = 0 // Active animation frame id (0 = stopped)
  let alive = true // Flipped false on cancel so a queued frame no-ops

  const tick = () => {
    if (!alive) return // Cancelled between schedule and run
    const ptr = opts.getPointer() // Fresh client XY for this frame
    let moved = false // True when scroll or pan actually changed something
    const overChat = pointerOverChatUi(ptr) // Sidebar / dock — never board-pan

    // Chat column: top/bottom of content window (header above counts as top) → scroll
    const content = chatContentWindowRect()
    const scroller = transcriptScroller()
    if (content && scroller && overChat) {
      const dy = edgeScrollDelta(ptr.y, content) // Signed scrollTop delta
      if (dy) {
        const prev = scroller.scrollTop // Detect clamp at ends
        scroller.scrollTop = Math.max(0, prev + dy) // Apply; browser clamps to max
        if (scroller.scrollTop !== prev) moved = true // Only tick when scroll moved
      }
    }

    // Board pan only when the pointer is actually over the map pane (not chat Y-aligned)
    const board = !overChat ? boardPaneRect() : null
    if (board && opts.panBoard && pointInRect(ptr.x, ptr.y, board)) {
      const inset = CHAT_THREAD_EDGE_INSET
      const dx = edgePanDelta(ptr.x - board.left, inset, board.width - inset)
      const dy = edgePanDelta(ptr.y - board.top, inset, board.height - inset)
      if (dx || dy) {
        opts.panBoard(dx, dy) // Match RF connect auto-pan direction
        moved = true
      }
    }

    if (moved) opts.onTick?.() // Keep rubber / seam geometry in sync
    raf = requestAnimationFrame(tick) // Keep polling until cancel (pointer may re-enter edge)
  }

  raf = requestAnimationFrame(tick) // Kick off on next frame

  return () => {
    alive = false // Stop further work
    if (raf) cancelAnimationFrame(raf) // Drop the pending frame
    raf = 0
  }
}
