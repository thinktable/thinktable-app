/** Accidental jitter on empty-board click still places the I-bar instead of pan/select. */

export const PANE_CLICK_SLOP_PX = 8 // Screen px — RF/d3 treat 1px as a drag and skip onPaneClick
export const PANE_TAP_SLOP_PX = 10 // Touch/pen — match long-press drift so a tap is still a tap

const SKIP_PANE =
  '.react-flow__node, .react-flow__edge, .react-flow__connection, .react-flow__handle, .react-flow__resize-control, [data-minimap-context], [data-minimap-toggle-context], [data-minimap-pill-context]' // Frames / threads / chrome — not empty-board click

type D3Zoom = { clickDistance?: (px: number) => unknown } // RF store zoom behavior (d3-zoom)

type RfZoomStore = {
  getState: () => { d3Zoom?: D3Zoom | null } // ZoomPane writes this after mount
  subscribe: (fn: (state: { d3Zoom?: D3Zoom | null }) => void) => () => void // One-shot until d3Zoom exists
}

/** d3-zoom default clickDistance is 0, so a 1px pan swallows the click that places the I-bar. */
export function applyD3PaneClickSlop(store: RfZoomStore) {
  const apply = () => store.getState().d3Zoom?.clickDistance?.(PANE_CLICK_SLOP_PX) // Allow click after tiny pans
  apply()
  if (store.getState().d3Zoom) return () => undefined // Already mounted
  const unsub = store.subscribe((state) => {
    if (!state.d3Zoom) return
    apply() // ZoomPane just attached
    unsub() // clickDistance is sticky — stop listening
  })
  return unsub
}

/**
 * Swallow pane mousemove until the pointer leaves the slop so RF `selectionOnDrag`
 * never sets `userSelectionActive` — otherwise mouseup skips `onPaneClick`.
 */
export function attachPaneSelectClickSlop(root: HTMLElement) {
  let startX = 0 // Gesture origin
  let startY = 0
  let armed = false // Empty-pane primary press
  let committed = false // Past slop — real marquee, stop swallowing

  const slop2 = PANE_CLICK_SLOP_PX * PANE_CLICK_SLOP_PX // Compare squared distance

  const onDown = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') {
      armed = false // Touch/pen uses phone marquee slop
      return
    }
    if (event.button !== 0) {
      armed = false // Middle/right still pan
      return
    }
    const target = event.target
    if (!(target instanceof Element) || target.closest(SKIP_PANE) || !target.closest('.react-flow__pane')) {
      armed = false // Frame / thread / chrome / off-pane
      return
    }
    startX = event.clientX
    startY = event.clientY
    armed = true
    committed = false
  }

  const onMove = (event: MouseEvent) => {
    if (!armed || committed) return // Not a pending pane click
    const dx = event.clientX - startX
    const dy = event.clientY - startY
    if (dx * dx + dy * dy <= slop2) {
      event.stopPropagation() // RF Pane never sees jitter → stays a click
      return
    }
    committed = true // Real select-drag — let this and later moves through
  }

  const onUp = () => {
    armed = false
    committed = false
  }

  root.addEventListener('pointerdown', onDown, true) // Arm before RF mousedown seeds the rect
  root.addEventListener('mousemove', onMove, true) // Capture: stop before RF Pane / React delegation
  window.addEventListener('mouseup', onUp, true)
  window.addEventListener('pointercancel', onUp, true)
  return () => {
    root.removeEventListener('pointerdown', onDown, true)
    root.removeEventListener('mousemove', onMove, true)
    window.removeEventListener('mouseup', onUp, true)
    window.removeEventListener('pointercancel', onUp, true)
    armed = false
  }
}
