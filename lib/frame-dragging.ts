// Frame drag in progress — skip O(n) React work that scales with board size.
// RF still moves the dragged node via CSS transform; we only freeze expensive subscribers.

let dragging = false
let activeCount = 0 // Nested drags (multi-select / phone manual drag)
let settleTimer: ReturnType<typeof setTimeout> | null = null

const DRAG_CLASS = 'tt-frame-dragging'

function flowEl(): HTMLElement | null {
  return document.querySelector('.react-flow') as HTMLElement | null
}

/** True while any frame is mid-drag (until brief settle after release). */
export function isFrameDragging(): boolean {
  return dragging
}

/** Mark frame drag start — skip viewport mount / thread scans until release. */
export function beginFrameDragging(): void {
  if (settleTimer) {
    clearTimeout(settleTimer)
    settleTimer = null
  }
  activeCount += 1
  if (dragging) return
  dragging = true
  flowEl()?.classList.add(DRAG_CLASS)
}

/** Mark frame drag end — release React sync immediately; drop CSS class after brief settle. */
export function endFrameDragging(settleMs = 48): void {
  activeCount = Math.max(0, activeCount - 1)
  if (activeCount > 0) return
  dragging = false
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    settleTimer = null
    flowEl()?.classList.remove(DRAG_CLASS)
  }, settleMs)
}
