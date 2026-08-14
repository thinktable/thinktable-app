/**
 * Board camera rotation — CSS rotate on RF nodes/edges plus pointer math so
 * pan stays screen-aligned while two-finger twist / nav scrub orbit the view.
 */

export const BOARD_ROTATION_SNAP_DEG = 5 // Stick to upright when within this many degrees of 0

export const PINCH_ROTATE_ARM_DEG = 42 // Phone pinch wobble is often 15–30° — require a clear twist

export const boardRotationRef = { current: 0 } // Live degrees for non-React callers (drag, marquee, I-bar)

const dragStartPositions = new Map<string, { x: number; y: number; ax?: number; ay?: number }>() // Per-node flow origin at drag start

/** Wrap any angle into (-180, 180] so the slider thumb has one place per heading. */
export function normalizeDeg(deg: number): number {
  let d = deg % 360 // Fold full turns
  if (d > 180) d -= 360 // Prefer the short side past 180
  if (d <= -180) d += 360 // -180 and 180 are the same heading — keep +180 out via <=
  return d
}

/**
 * Pinch stays zoom-only until the fingers clearly twist (Maps-style).
 * Once the gesture is a pinch, it stays zoom-only even if the fingers later twist.
 */
export function pinchTwistRawHeading(
  startRot: number, // Heading at gesture start
  dDeg: number, // Live twist since start (degrees)
  scaleRatio: number, // currentDist / startDist (1 = no pinch)
  state: { rotateArmed: boolean; armOffset: number; zoomLocked?: boolean } // Mutated — persists for the gesture
): number {
  const scaleDelta = Math.abs(scaleRatio - 1) // How hard they’re pinching vs holding distance
  const rotMag = Math.abs(normalizeDeg(dDeg)) // Accidental pinch wobble is often 15–30°
  if (state.zoomLocked) return startRot // This gesture already chose zoom
  if (!state.rotateArmed) {
    if (scaleDelta > 0.08 && rotMag < PINCH_ROTATE_ARM_DEG) {
      state.zoomLocked = true // Pinch started first — don’t rotate later in this gesture
      return startRot
    }
    if (rotMag < PINCH_ROTATE_ARM_DEG || scaleDelta > 0.2) return startRot // Still zoom, or pinch is the motion
    state.rotateArmed = true // Committed twist with little scale change
    state.armOffset = dDeg // First applied step is 0 so the board doesn’t jump
  }
  return startRot + (dDeg - state.armOffset) // Live heading relative to the arm point
}

/**
 * Snap when a two-finger twist *crosses* 0° — not a dead zone around upright.
 * Pinch-zoom uses pinchTwistRawHeading first so tiny wobble never reaches this.
 */
export function twistSnapHeading(
  rawDeg: number,
  prevAppliedDeg: number,
  stuckAtZero: boolean
): { heading: number; stuckAtZero: boolean } {
  const n = normalizeDeg(rawDeg) // Live twist from gesture start
  const prev = normalizeDeg(prevAppliedDeg) // Last heading we actually painted
  if (stuckAtZero) {
    if (Math.abs(n) < BOARD_ROTATION_SNAP_DEG) return { heading: 0, stuckAtZero: true } // Stay magnetized
    return { heading: n, stuckAtZero: false } // Escaped the well
  }
  if (Math.abs(n) < BOARD_ROTATION_SNAP_DEG && Math.abs(prev) >= BOARD_ROTATION_SNAP_DEG) {
    return { heading: 0, stuckAtZero: true } // Crossed into 0 from outside
  }
  return { heading: n, stuckAtZero: false } // No dead zone when leaving upright
}

/** Icon vertical scrub — stick to 0° while the pointer is near upright (same feel as zoom 100%). */
export function snapRotation(deg: number, windowDeg = BOARD_ROTATION_SNAP_DEG): number {
  const n = normalizeDeg(deg)
  return Math.abs(n) < windowDeg ? 0 : n
}

/** Rotate a 2D vector by CSS-positive degrees (clockwise with y-down). */
export function rotateVec(deg: number, x: number, y: number): { x: number; y: number } {
  const r = (deg * Math.PI) / 180 // CSS rotate() uses degrees
  const c = Math.cos(r) // Column 1 of the matrix
  const s = Math.sin(r) // Clockwise in screen space
  return { x: x * c - y * s, y: x * s + y * c } // Same matrix CSS uses on the viewport children
}

/** Pane-local (client minus flow box) → flow, honoring camera rotate. */
export function paneToFlow(
  paneX: number,
  paneY: number,
  vp: { x: number; y: number; zoom: number },
  rotDeg = boardRotationRef.current
): { x: number; y: number } {
  const { x, y } = rotateVec(-rotDeg, paneX - vp.x, paneY - vp.y) // Undo T then R, then divide by zoom
  return { x: x / vp.zoom, y: y / vp.zoom }
}

/** Flow → pane-local, honoring camera rotate (I-bar, overlays). */
export function flowToPane(
  flowX: number,
  flowY: number,
  vp: { x: number; y: number; zoom: number },
  rotDeg = boardRotationRef.current
): { x: number; y: number } {
  const { x, y } = rotateVec(rotDeg, flowX * vp.zoom, flowY * vp.zoom) // Scale then R then T
  return { x: vp.x + x, y: vp.y + y }
}

/**
 * Keep the flow point under a pane pixel fixed while zoom and/or rotation change.
 * Same trick as wheel-zoom-around-cursor, with R in the camera matrix.
 */
export function viewportKeepingPanePoint(
  paneX: number,
  paneY: number,
  vp: { x: number; y: number; zoom: number },
  oldRot: number,
  nextRot: number,
  nextZoom: number
): { x: number; y: number; zoom: number } {
  const f = paneToFlow(paneX, paneY, vp, oldRot) // World point currently under the pivot
  const { x, y } = rotateVec(nextRot, f.x * nextZoom, f.y * nextZoom) // Where that point wants to land
  return { x: paneX - x, y: paneY - y, zoom: nextZoom } // New T so it stays under the pivot
}

/** Rewrite RF drag position changes so the frame follows the finger after camera rotate. */
export function applyBoardRotationToPositionChanges<T extends { type?: string; id?: string; position?: { x: number; y: number }; positionAbsolute?: { x: number; y: number }; dragging?: boolean }>(
  changes: T[],
  nodes: Array<{ id: string; position: { x: number; y: number }; positionAbsolute?: { x: number; y: number } }>
): T[] {
  const rot = boardRotationRef.current // Camera heading at this tick
  if (Math.abs(rot) < 0.01) {
    dragStartPositions.clear() // Next drag is unrotated — drop stale origins
    return changes
  }
  return changes.map((change) => {
    if (change.type !== 'position' || !change.position || !change.id) return change // Not a move
    const node = nodes.find((n) => n.id === change.id) // Pre-change node (RF hasn’t applied yet)
    if (!node) return change
    let start = dragStartPositions.get(change.id) // Origin frozen at pointer-down
    if (!start) {
      start = {
        x: node.position.x, // Flow pos before this gesture
        y: node.position.y,
        ax: node.positionAbsolute?.x,
        ay: node.positionAbsolute?.y,
      }
      dragStartPositions.set(change.id, start)
    }
    if (change.dragging === false) dragStartPositions.delete(change.id) // Gesture over — next drag is fresh
    const dx = change.position.x - start.x // RF applied screenDelta / zoom along unrotated axes
    const dy = change.position.y - start.y
    const { x: rx, y: ry } = rotateVec(-rot, dx, dy) // Convert that screen delta into flow axes
    const next: T = {
      ...change,
      position: { x: start.x + rx, y: start.y + ry }, // Finger-following flow position
    }
    if (change.positionAbsolute && start.ax != null && start.ay != null) {
      next.positionAbsolute = { x: start.ax + rx, y: start.ay + ry } // Same delta in abs space
    }
    return next
  })
}

type ScreenToFlow = (position: { x: number; y: number }) => { x: number; y: number } // RF instance method shape

/** Wrap RF screen↔flow once so drops, I-bar, threads, and drawings see the rotated camera. */
export function patchReactFlowRotation(instance: {
  screenToFlowPosition: ScreenToFlow
  flowToScreenPosition: ScreenToFlow
  getViewport: () => { x: number; y: number; zoom: number }
}): void {
  const patched = instance as typeof instance & { __ttRotPatched?: boolean } // Idempotent flag
  if (patched.__ttRotPatched) return // Don’t wrap twice on Strict Mode remounts of the helper object
  patched.__ttRotPatched = true
  const origScreen = instance.screenToFlowPosition.bind(instance) // Unrotated fallback
  const origFlow = instance.flowToScreenPosition.bind(instance)
  instance.screenToFlowPosition = (position) => {
    const rot = boardRotationRef.current
    if (Math.abs(rot) < 0.01) return origScreen(position) // Cheap path when upright
    const flowEl = document.querySelector('.react-flow') as HTMLElement | null // Same box RF uses (domNode)
    if (!flowEl) return origScreen(position)
    const rect = flowEl.getBoundingClientRect() // Pane origin in client pixels
    const vp = instance.getViewport()
    return paneToFlow(position.x - rect.left, position.y - rect.top, vp, rot)
  }
  instance.flowToScreenPosition = (position) => {
    const rot = boardRotationRef.current
    if (Math.abs(rot) < 0.01) return origFlow(position)
    const flowEl = document.querySelector('.react-flow') as HTMLElement | null
    if (!flowEl) return origFlow(position)
    const rect = flowEl.getBoundingClientRect()
    const vp = instance.getViewport()
    const pane = flowToPane(position.x, position.y, vp, rot)
    return { x: pane.x + rect.left, y: pane.y + rect.top } // Back to client coords
  }
}
