// Board pan/pinch in progress. Freeze React zoom selectors so chrome/threads don’t
// re-render every tick — the RF viewport CSS transform still tracks fingers live.
// Do NOT hide DB tables with CSS during the gesture (that made zoom feel like
// “pinch, then pop” on phone Safari).

let navigating = false
let frozenZoom: number | null = null // Stable zoom for useStore selectors during the gesture
let settleTimer: ReturnType<typeof setTimeout> | null = null

const NAV_CLASS = 'tt-board-navigating'

function flowEl(): HTMLElement | null {
  return document.querySelector('.react-flow') as HTMLElement | null
}

/** True while two-finger pan/zoom (or briefly after) is active. */
export function isBoardNavigating(): boolean {
  return navigating
}

/**
 * While navigating, return the zoom frozen at gesture start so React `useStore`
 * selectors stay stable. Viewport transform still updates every move.
 */
export function navigationZoom(liveZoom: number): number {
  if (navigating && frozenZoom != null) return frozenZoom
  return liveZoom
}

/** Mark gesture start — freeze zoom selectors; RF setViewport keeps tracking. */
export function beginBoardNavigating(zoom?: number): void {
  if (settleTimer) {
    clearTimeout(settleTimer)
    settleTimer = null
  }
  if (navigating) return
  navigating = true
  const z = zoom ?? 1
  frozenZoom = Math.round(z * 8) / 8
  // pointer-events only — never visibility/content-visibility (those defer paint → jumpy zoom)
  flowEl()?.classList.add(NAV_CLASS)
}

/** Mark gesture end — release frozen zoom after a short settle. */
export function endBoardNavigating(settleMs = 80): void {
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    settleTimer = null
    if (!navigating) return
    navigating = false
    frozenZoom = null
    flowEl()?.classList.remove(NAV_CLASS)
  }, settleMs)
}
