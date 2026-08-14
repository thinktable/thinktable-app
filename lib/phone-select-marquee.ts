/** Phone select-tool marquee — RF Pane only listens to mouse, so touch never draws a box. */

import type { Edge, Node, NodeChange, EdgeChange } from 'reactflow' // RF store item types for select changes
import { getConnectedEdges } from 'reactflow' // Same edge-select as RF Pane while the rect grows
import { boardRotationRef, rotateVec } from '@/lib/board-rotation' // Marquee vs rotated frame AABB
import { PANE_TAP_SLOP_PX } from '@/lib/pane-click-slop' // Finger jitter still counts as a tap (I-bar)

const SKIP_SEL =
  '.react-flow__node, .react-flow__edge, .react-flow__connection, .react-flow__handle, [data-minimap-context], [data-minimap-toggle-context], [data-minimap-pill-context]' // Frames / threads / chrome — not empty-board marquee

type PaneRect = { x: number; y: number; width: number; height: number; startX: number; startY: number } // Pane-pixel selection box (same space as RF UserSelection)

type RfStore = {
  getState: () => {
    elementsSelectable: boolean // RF flag — skip if the board is not selectable
    nodeInternals: Map<string, Node> // Live node map with measured width/height
    edges: Edge[] // For selecting threads attached to hit frames
    transform: [number, number, number] // Viewport x, y, zoom
    onNodesChange?: (changes: NodeChange[]) => void // Apply select changes through the board handler
    onEdgesChange?: (changes: EdgeChange[]) => void // Keep thread highlight in sync
    getNodes: () => Node[] // Current nodes for diffing selected flags
    resetSelectedElements: () => void // Clear prior selection when a new rect starts
    domNode: HTMLElement | null // Flow root for pane bounds
  }
  setState: (partial: {
    userSelectionActive?: boolean // True once the finger has moved past tap slop (draws the blue box)
    userSelectionRect?: PaneRect | null // Box in pane pixels
    nodesSelectionActive?: boolean // RF keeps this after a non-empty marquee
  }) => void
}

function panePoint(event: PointerEvent, bounds: DOMRect) {
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top } // Convert screen → pane-local
}

function hitsPaneRect(node: Node, rect: PaneRect, transform: [number, number, number]) {
  const [tx, ty, zoom] = transform // Viewport translate + scale
  const fx = node.positionAbsolute?.x ?? node.position.x // Flow-space left
  const fy = node.positionAbsolute?.y ?? node.position.y // Flow-space top
  const nw = (node.width ?? 0) * zoom // Unrotated pane-space width
  const nh = (node.height ?? 0) * zoom // Unrotated pane-space height
  const rot = boardRotationRef.current // Camera heading
  if (Math.abs(rot) < 0.01) {
    const nx = fx * zoom + tx // Pane-space left
    const ny = fy * zoom + ty // Pane-space top
    return nx < rect.x + rect.width && nx + nw > rect.x && ny < rect.y + rect.height && ny + nh > rect.y // Partial hit — fat-finger friendly
  }
  const corners = [
    [0, 0],
    [node.width ?? 0, 0],
    [node.width ?? 0, node.height ?? 0],
    [0, node.height ?? 0],
  ] // Flow-space corners of the frame box
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [cx, cy] of corners) {
    const { x, y } = rotateVec(rot, (fx + cx) * zoom, (fy + cy) * zoom) // Camera R then T
    const px = tx + x
    const py = ty + y
    if (px < minX) minX = px
    if (py < minY) minY = py
    if (px > maxX) maxX = px
    if (py > maxY) maxY = py
  }
  return minX < rect.x + rect.width && maxX > rect.x && minY < rect.y + rect.height && maxY > rect.y // AABB vs screen marquee
}

function selectChanges<T extends { id: string; selected?: boolean }>(items: T[], selectedIds: string[]) {
  const want = new Set(selectedIds) // O(1) lookup while walking current items
  const changes: { id: string; type: 'select'; selected: boolean }[] = [] // Only emit diffs
  for (const item of items) {
    const next = want.has(item.id) // Should this item be selected?
    if (!!item.selected !== next) changes.push({ id: item.id, type: 'select', selected: next }) // Skip unchanged
  }
  return changes
}

export function attachPhoneSelectMarquee(root: HTMLElement, store: RfStore) {
  let pointerId: number | null = null // The finger that owns this gesture
  let bounds: DOMRect | null = null // Pane bounds at pointerdown
  let prevNodeCount = 0 // Skip redundant onNodesChange while the rect grows
  let prevEdgeCount = 0 // Same for threads

  const reset = () => {
    store.setState({ userSelectionActive: false, userSelectionRect: null }) // Drop the blue box
    pointerId = null // Gesture over
    bounds = null // Next down remeasures
    prevNodeCount = 0 // Fresh counts next time
    prevEdgeCount = 0
  }

  const onDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') return // Desktop / trackpad keep RF's mouse Pane handlers
    if (event.button !== 0 && event.button !== -1) return // Primary finger only
    const target = event.target
    if (!(target instanceof Element)) return // Non-element (text) — ignore
    if (target.closest(SKIP_SEL)) return // Frame / thread / nav — let RF drag or chrome handle it
    if (!target.closest('.react-flow__pane')) return // Outside the board pane
    const state = store.getState()
    if (!state.elementsSelectable) return // View-only / drawing shouldn't marquee
    const flow = state.domNode
    if (!flow) return // Store not ready
    bounds = flow.getBoundingClientRect() // Pane origin for the whole gesture
    const { x, y } = panePoint(event, bounds) // Finger in pane pixels
    pointerId = event.pointerId // Capture this finger
    prevNodeCount = 0
    prevEdgeCount = 0
    state.resetSelectedElements() // New rect replaces the old selection
    store.setState({
      userSelectionRect: { width: 0, height: 0, startX: x, startY: y, x, y }, // Seed; active after first move
    })
    try {
      ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId) // Keep move/up if the finger leaves the pane
    } catch {
      // setPointerCapture can throw if the pointer already went up
    }
  }

  const onMove = (event: PointerEvent) => {
    if (pointerId == null || event.pointerId !== pointerId || !bounds) return // Not our gesture
    const state = store.getState()
    const start = state.userSelectionRect // Seeded on down
    if (!start) return
    const pos = panePoint(event, bounds) // Live finger
    const dx = pos.x - start.startX // Pane-space drift from down
    const dy = pos.y - start.startY
    if (!state.userSelectionActive && dx * dx + dy * dy <= PANE_TAP_SLOP_PX * PANE_TAP_SLOP_PX) return // Still a tap — keep onPaneClick
    const next: PaneRect = {
      startX: start.startX,
      startY: start.startY,
      x: Math.min(pos.x, start.startX), // Normalize so x/y is top-left
      y: Math.min(pos.y, start.startY),
      width: Math.abs(pos.x - start.startX),
      height: Math.abs(pos.y - start.startY),
    }
    store.setState({ userSelectionActive: true, nodesSelectionActive: false, userSelectionRect: next }) // Show the box
    const nodes = Array.from(state.nodeInternals.values()) // Measured nodes
    const hit = nodes.filter((n) => hitsPaneRect(n, next, state.transform)) // Partial overlap
    const nodeIds = hit.map((n) => n.id)
    const edgeIds = getConnectedEdges(hit, state.edges).map((e) => e.id) // Threads between hit frames
    if (nodeIds.length !== prevNodeCount) {
      prevNodeCount = nodeIds.length
      const changes = selectChanges(state.getNodes(), nodeIds)
      if (changes.length) state.onNodesChange?.(changes)
    }
    if (edgeIds.length !== prevEdgeCount) {
      prevEdgeCount = edgeIds.length
      const changes = selectChanges(state.edges, edgeIds)
      if (changes.length) state.onEdgesChange?.(changes as EdgeChange[])
    }
  }

  const onUp = (event: PointerEvent) => {
    if (pointerId == null || event.pointerId !== pointerId) return // Foreign pointer
    const hadBox = store.getState().userSelectionActive // Moved vs tap
    store.setState({ nodesSelectionActive: prevNodeCount > 0 }) // Keep RF selection chrome if anything was hit
    reset() // Always clear the live rect (tap → onPaneClick still fires)
    if (hadBox) event.preventDefault() // Don't also synthesize a click after a real marquee
  }

  const onCancel = (event: PointerEvent) => {
    if (pointerId == null || event.pointerId !== pointerId) return
    reset() // Interrupted (scroll, overlay) — drop the box
  }

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length < 2) return // One finger keeps marquee
    reset() // Pinch / two-finger pan — don't draw a select box
  }

  root.addEventListener('pointerdown', onDown) // Bubble: nodes already skipped via SKIP_SEL
  root.addEventListener('pointermove', onMove)
  root.addEventListener('pointerup', onUp)
  root.addEventListener('pointercancel', onCancel)
  root.addEventListener('touchstart', onTouchStart, { capture: true, passive: true }) // 2nd finger lands before pointerdown on iOS
  return () => {
    reset()
    root.removeEventListener('pointerdown', onDown)
    root.removeEventListener('pointermove', onMove)
    root.removeEventListener('pointerup', onUp)
    root.removeEventListener('pointercancel', onCancel)
    root.removeEventListener('touchstart', onTouchStart, { capture: true })
  }
}
