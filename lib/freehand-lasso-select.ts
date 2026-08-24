/**
 * Draw-bar Lasso — freehand selection. RF only ships a rectangle marquee, so the drag is owned
 * here: the pointer trail is the outline and it is treated as **already closed** (last point →
 * first point is an implicit straight line), so the user never has to return to the start.
 */

import type { Edge, EdgeChange, Node, NodeChange, ReactFlowState } from 'reactflow'
import { getConnectedEdges } from 'reactflow' // Same thread select as the RF marquee
import { boardRotationRef, rotateVec } from '@/lib/board-rotation' // Lasso is pane-space; frames may be twisted
import { armMarqueeFrameSelect } from '@/lib/frame-drag-transient' // Frame select:true is dropped unless a marquee armed it
import { PANE_CLICK_SLOP_PX, PANE_TAP_SLOP_PX } from '@/lib/pane-click-slop' // Jitter still places the I-bar

const SKIP_SEL =
  '.react-flow__node, .react-flow__edge, .react-flow__connection, .react-flow__handle, .react-flow__resize-control, [data-minimap-context], [data-minimap-toggle-context], [data-minimap-pill-context]' // Frames / threads / chrome — not an empty-board lasso

const MIN_STEP_PX = 4 // Drop sub-step jitter so the polygon stays cheap to hit-test
const OUTLINE = 'rgba(0, 89, 220, 0.8)' // Matches RF's default selection border
const FILL = 'rgba(0, 89, 220, 0.08)' // Matches RF's default selection fill

type Pt = { x: number; y: number } // Pane-pixel point (same space as RF's UserSelection)
type Box = { minX: number; minY: number; maxX: number; maxY: number } // Pane-space frame AABB

type RfStoreApi = {
  getState: () => ReactFlowState // Live nodes / edges / viewport
  setState: (partial: Partial<ReactFlowState>) => void // Only `nodesSelectionActive` here — the trail is our own SVG
}

/** Pane-space bounds of a frame, with the camera heading folded in. */
function paneBox(node: Node, transform: readonly [number, number, number]): Box | null {
  const [tx, ty, zoom] = transform // Viewport translate + scale
  const w = node.width ?? 0
  const h = node.height ?? 0
  if (!w || !h) return null // Not measured yet — cannot hit-test
  const fx = node.positionAbsolute?.x ?? node.position.x // Flow-space left
  const fy = node.positionAbsolute?.y ?? node.position.y // Flow-space top
  const rot = boardRotationRef.current // Camera heading
  if (Math.abs(rot) < 0.01) {
    const x = fx * zoom + tx
    const y = fy * zoom + ty
    return { minX: x, minY: y, maxX: x + w * zoom, maxY: y + h * zoom }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [cx, cy] of [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ]) {
    const p = rotateVec(rot, (fx + cx) * zoom, (fy + cy) * zoom) // Camera R then T
    const px = tx + p.x
    const py = ty + p.y
    if (px < minX) minX = px
    if (py < minY) minY = py
    if (px > maxX) maxX = px
    if (py > maxY) maxY = py
  }
  return { minX, minY, maxX, maxY }
}

/** Even-odd ray cast against the closed trail. */
function pointInLasso(pts: Pt[], x: number, y: number) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Do segments a→b and c→d cross? (Orientation test — collinear touches count as a miss.) */
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt) {
  const cross = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const d1 = cross(a, b, c)
  const d2 = cross(a, b, d)
  const d3 = cross(c, d, a)
  const d4 = cross(c, d, b)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/**
 * Partial overlap counts as a hit (same as the RF marquee): a frame is caught when it holds part
 * of the trail, sits inside it, or an outline segment crosses it.
 */
function lassoHitsBox(pts: Pt[], box: Box) {
  for (const p of pts) {
    if (p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY) return true // Trail runs through the frame
  }
  if (pointInLasso(pts, box.minX, box.minY)) return true // Frame corner inside the loop → frame enclosed
  const corners: Pt[] = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ]
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    for (let c = 0; c < 4; c++) {
      if (segmentsCross(pts[j], pts[i], corners[c], corners[(c + 1) % 4])) return true // Outline (incl. the closing line) cuts an edge
    }
  }
  return false
}

/** Only emit select changes that actually flip a flag. */
function selectChanges<T extends { id: string; selected?: boolean }>(items: T[], selectedIds: Set<string>) {
  const changes: NodeChange[] = []
  for (const item of items) {
    const next = selectedIds.has(item.id)
    if (!!item.selected !== next) changes.push({ id: item.id, type: 'select', selected: next })
  }
  return changes
}

export function attachFreehandLassoSelect(root: HTMLElement, store: RfStoreApi) {
  let pointerId: number | null = null // The pointer that owns this gesture
  let bounds: DOMRect | null = null // Pane bounds at pointerdown
  let points: Pt[] = [] // Pane-space trail
  let active = false // Past slop — a real lasso, not a pane click
  let svg: SVGSVGElement | null = null // Live outline (imperative: pointer-rate updates)
  let path: SVGPathElement | null = null
  let frame = 0 // rAF handle — hit-test at most once per paint
  let hitCount = 0 // Frames caught by the last hit-test

  const ensureOverlay = () => {
    if (svg) return
    const host = store.getState().domNode
    if (!host) return
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative' // RF's CSS leaves the root static — pin our trail to the pane box
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:6') // z-index 6 = RF's own selection layer
    path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('fill', FILL)
    path.setAttribute('stroke', OUTLINE)
    path.setAttribute('stroke-width', '1')
    path.setAttribute('stroke-dasharray', '4 3') // Dotted, like the RF marquee border
    path.setAttribute('fill-rule', 'evenodd') // Self-crossing trails shade like the hit-test reads them
    svg.appendChild(path)
    host.appendChild(svg)
  }

  const drawOutline = () => {
    if (!path || points.length < 2) return
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')
    path.setAttribute('d', `${d} Z`) // Z is the implicit straight line back to the start
  }

  const applySelection = () => {
    if (!active || points.length < 3) return
    const state = store.getState()
    const nodes = Array.from(state.nodeInternals.values())
    const hit = nodes.filter((node) => {
      const box = paneBox(node, state.transform)
      return box ? lassoHitsBox(points, box) : false
    })
    hitCount = hit.length
    const nodeIds = new Set(hit.map((n) => n.id))
    const nodeChanges = selectChanges(state.getNodes(), nodeIds)
    if (nodeChanges.length) {
      armMarqueeFrameSelect() // Frames only accept select:true from a marquee batch
      state.onNodesChange?.(nodeChanges)
    }
    const edgeIds = new Set(getConnectedEdges(hit, state.edges).map((e) => e.id)) // Threads between caught frames
    const edgeChanges = selectChanges(state.edges, edgeIds)
    if (edgeChanges.length) state.onEdgesChange?.(edgeChanges as EdgeChange[])
  }

  const scheduleSelection = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      applySelection()
    })
  }

  const teardownGesture = () => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    svg?.remove()
    svg = null
    path = null
    points = []
    active = false
    pointerId = null
    bounds = null
  }

  /** RF's Pane click resets the selection (and places the I-bar) — swallow the one this drag ends with. */
  const swallowNextClick = () => {
    const onClick = (event: MouseEvent) => {
      event.stopPropagation()
      event.preventDefault()
    }
    window.addEventListener('click', onClick, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', onClick, { capture: true }), 400) // No click came (touch) — drop the trap
  }

  const onDown = (event: PointerEvent) => {
    if (pointerId != null) return // Already lassoing
    if (event.button !== 0 && event.button !== -1) return // Primary only; middle/right still pan
    if (event.shiftKey) return // Shift flips to pan for one gesture
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest(SKIP_SEL)) return // Frame / thread / chrome
    if (!target.closest('.react-flow__pane')) return // Outside the board pane
    const state = store.getState()
    if (!state.elementsSelectable) return // View-only board
    const host = state.domNode
    if (!host) return
    bounds = host.getBoundingClientRect() // Pane origin for the whole gesture
    pointerId = event.pointerId
    active = false
    hitCount = 0
    points = [{ x: event.clientX - bounds.left, y: event.clientY - bounds.top }]
    try {
      root.setPointerCapture?.(event.pointerId) // Keep move/up if the pointer leaves the pane
    } catch {
      // Pointer already released
    }
  }

  const onMove = (event: PointerEvent) => {
    if (pointerId == null || event.pointerId !== pointerId || !bounds) return
    const pt = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    if (!active) {
      const start = points[0]
      const dx = pt.x - start.x
      const dy = pt.y - start.y
      const slop = event.pointerType === 'mouse' ? PANE_CLICK_SLOP_PX : PANE_TAP_SLOP_PX
      if (dx * dx + dy * dy <= slop * slop) return // Still a click — leave onPaneClick (I-bar) alone
      active = true
      store.getState().resetSelectedElements() // A new lasso replaces the old selection
      ensureOverlay()
    }
    const last = points[points.length - 1]
    const step = (pt.x - last.x) ** 2 + (pt.y - last.y) ** 2
    if (step < MIN_STEP_PX * MIN_STEP_PX) return // Too close to matter
    points.push(pt)
    drawOutline()
    scheduleSelection()
  }

  const onUp = (event: PointerEvent) => {
    if (pointerId == null || event.pointerId !== pointerId) return
    const wasActive = active
    if (frame) {
      cancelAnimationFrame(frame)
      frame = 0
    }
    applySelection() // Final trail — the release point closes back to the start
    store.setState({ nodesSelectionActive: hitCount > 0 }) // Keep RF's multi-select chrome if anything was caught
    const caught = hitCount
    teardownGesture()
    if (!wasActive) return // Plain click — let the I-bar happen
    event.preventDefault()
    if (caught > 0) swallowNextClick() // Don't let the pane click wipe what we just selected
  }

  const onCancel = (event: PointerEvent) => {
    if (pointerId == null || event.pointerId !== pointerId) return
    teardownGesture() // Interrupted (pinch, overlay) — drop the trail, keep whatever was selected
  }

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length < 2) return // One finger keeps lassoing
    teardownGesture() // Pinch / two-finger pan wins
  }

  root.addEventListener('pointerdown', onDown) // Bubble: SKIP_SEL already excludes frames
  root.addEventListener('pointermove', onMove)
  root.addEventListener('pointerup', onUp)
  root.addEventListener('pointercancel', onCancel)
  root.addEventListener('touchstart', onTouchStart, { capture: true, passive: true }) // 2nd finger lands before pointerdown on iOS
  return () => {
    teardownGesture()
    root.removeEventListener('pointerdown', onDown)
    root.removeEventListener('pointermove', onMove)
    root.removeEventListener('pointerup', onUp)
    root.removeEventListener('pointercancel', onCancel)
    root.removeEventListener('touchstart', onTouchStart, { capture: true })
  }
}
