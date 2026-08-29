// Board pan/pinch in progress. Freeze React zoom selectors so chrome/threads don’t
// re-render every tick — the RF viewport CSS transform still tracks fingers live.
// Notion DB tables swap to a same-size static preview (not CSS hide — that popped on phone).

let navigating = false
let frozenZoom: number | null = null // Stable zoom for useStore selectors during the gesture
let settleTimer: ReturnType<typeof setTimeout> | null = null
let watchdogTimer: ReturnType<typeof setTimeout> | null = null // Gesture that never called end
const listeners = new Set<() => void>() // DB live / other subscribers

const NAV_CLASS = 'tt-board-navigating'
const NAV_WATCHDOG_MS = 1200 // Re-armed per move tick; only fires when a gesture dies silently

function flowEl(): HTMLElement | null {
  return document.querySelector('.react-flow') as HTMLElement | null
}

function notifyNavigating(): void {
  listeners.forEach((l) => l())
}

/** True while two-finger pan/zoom (or briefly after) is active. */
export function isBoardNavigating(): boolean {
  return navigating
}

/** Subscribe to navigating flag changes (for focus-gated DB tables). */
export function subscribeBoardNavigating(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * While navigating, return the zoom frozen at gesture start so React `useStore`
 * selectors stay stable. Viewport transform still updates every move.
 */
export function navigationZoom(liveZoom: number): number {
  if (navigating && frozenZoom != null) return frozenZoom
  return liveZoom
}

/** Release the freeze now (shared by settle + watchdog). */
function clearNavigating(): void {
  if (!navigating) return
  navigating = false
  frozenZoom = null
  flowEl()?.classList.remove(NAV_CLASS)
  notifyNavigating()
}

/** Mark gesture start — freeze zoom selectors; RF setViewport keeps tracking. */
export function beginBoardNavigating(zoom?: number): void {
  if (settleTimer) {
    clearTimeout(settleTimer)
    settleTimer = null
  }
  // Re-arm every tick. A gesture ending without `endBoardNavigating` (pointercancel, unmount
  // mid-pinch, RF skipping onMoveEnd) used to wedge this true forever — hug then skips, so DB
  // frames never shrink back on deselect.
  if (watchdogTimer) clearTimeout(watchdogTimer)
  watchdogTimer = setTimeout(() => {
    watchdogTimer = null
    clearNavigating()
  }, NAV_WATCHDOG_MS)
  if (navigating) return
  navigating = true
  const z = zoom ?? 1
  frozenZoom = Math.round(z * 8) / 8
  // pointer-events only — never visibility/content-visibility (those defer paint → jumpy zoom)
  flowEl()?.classList.add(NAV_CLASS)
  notifyNavigating()
}

/** Mark gesture end — release frozen zoom after a short settle. */
export function endBoardNavigating(settleMs = 80): void {
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    settleTimer = null
    if (watchdogTimer) {
      clearTimeout(watchdogTimer)
      watchdogTimer = null
    }
    clearNavigating()
  }, settleMs)
}
