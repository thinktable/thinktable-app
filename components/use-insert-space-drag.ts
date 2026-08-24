'use client'

// Draw bar **insert space** (FigJam-style): with `insert-v` / `insert-h` armed, drag on the
// board to open (or close) a gap. Everything past the press point along that axis shifts by
// the drag delta; the guide + band preview lives in `insert-space-overlay.tsx`.
// See DEFINITIONS.md + CONTEXT.md.

import { useEffect, useRef, useState } from 'react' // Pointer gesture + preview state
import { useStoreApi } from 'reactflow' // Pane element + live viewport without re-rendering the board
import { createClient } from '@/lib/supabase/client' // Persist shifted positions
import { persistBlockPlacement } from '@/lib/blocks' // Frames store position on the message
import { boardRotationRef, paneToFlow } from '@/lib/board-rotation' // Camera-aware pane ↔ flow
import type { Node } from 'reactflow' // RF node shape

/** Which way the armed tool opens space. */
export type InsertSpaceAxis = 'vertical' | 'horizontal'

/** Live preview for the guide line + inserted band (flow units; camera frozen for the gesture). */
export type InsertSpaceUi = {
  axis: InsertSpaceAxis // Vertical tool pushes down, horizontal pushes right
  at: number // Guide position in flow coords (y for vertical, x for horizontal)
  delta: number // Signed gap in flow px (negative = removing space)
  vp: { x: number; y: number; zoom: number } // Viewport at pointerdown — cannot change mid-gesture
  rot: number // Camera heading so the band lies along board axes
}

// Board chrome that keeps its own presses even while a Draw tool is armed
const SKIP_SEL =
  '[data-minimap-context], [data-minimap-toggle-context], [data-minimap-pill-context], [data-nav-zoom-context], [data-chat-sidebar], [data-edit-top-bar]'

// Frames own their position on the message; drawings live in `canvas_nodes`
const FRAME_TYPES = new Set(['chatPanel', 'blockGroup']) // Persist via messages.metadata.position
const CANVAS_TYPES = new Set(['freehand', 'shape']) // Persist via canvas_nodes.position_x/y
const SKIP_TYPES = new Set(['placeholder', 'frameShimmer']) // Transient chrome — never moved or saved

const MIN_GAP_PX = 1 // Below this the gesture was a click, not an insert

/** Origin of one node at pointerdown so every move re-derives from a clean base. */
type Origin = { id: string; x: number; y: number; type?: string; messageId?: string }

export function useInsertSpaceDrag(opts: {
  axis: InsertSpaceAxis | null // Armed tool (null = tool not selected)
  conversationId?: string // Board that owns the frames / drawings
  canEdit: boolean // View-only boards never move content
  setNodes: (updater: (nds: Node[]) => Node[]) => void // Apply the live shift
  onBeforeShift?: () => void // takeSnapshot — one undo step per gesture
}): { ui: InsertSpaceUi | null } {
  const { axis, conversationId, canEdit, setNodes, onBeforeShift } = opts
  const store = useStoreApi() // RF internals: pane element + transform
  const [ui, setUi] = useState<InsertSpaceUi | null>(null) // Guide/band preview while dragging
  const [paneTick, setPaneTick] = useState(0) // Retry binding when RF's DOM lands after this effect
  // Callbacks change identity every render; refs keep the listeners alive across a re-render mid-drag
  const setNodesRef = useRef(setNodes)
  setNodesRef.current = setNodes
  const onBeforeShiftRef = useRef(onBeforeShift)
  onBeforeShiftRef.current = onBeforeShift

  useEffect(() => {
    if (!axis || !canEdit || !conversationId) return // Tool disarmed / read-only: board behaves normally
    const root = store.getState().domNode // `.react-flow` box — same space as paneToFlow
    if (!root) {
      // Reload can restore an armed tool before RF mounts its DOM — look again next frame
      const raf = requestAnimationFrame(() => setPaneTick((t) => t + 1))
      return () => cancelAnimationFrame(raf)
    }

    let pointerId: number | null = null // The pointer that owns this gesture
    let bounds: DOMRect | null = null // Pane box at pointerdown
    let vp = { x: 0, y: 0, zoom: 1 } // Frozen camera (we hold the pointer, so it cannot pan)
    let rot = 0 // Frozen camera heading
    let at = 0 // Guide in flow coords
    let origins: Origin[] = [] // Nodes past the guide, with their pre-drag position
    let minPast = 0 // Nearest affected edge — how much space can be removed
    let delta = 0 // Current signed gap
    let snapshotTaken = false // One undo entry per gesture, taken on the first real move

    const reset = () => {
      pointerId = null
      bounds = null
      origins = []
      delta = 0
      snapshotTaken = false
      setUi(null) // Drop guide + band
    }

    /** Put every shifted node back on its pre-drag spot (cancel / interrupted gesture). */
    const revert = (back: Origin[]) => {
      if (back.length === 0) return
      const byId = new Map(back.map((o) => [o.id, o]))
      setNodesRef.current((nds) =>
        nds.map((n) => {
          const o = byId.get(n.id)
          return o ? { ...n, position: { x: o.x, y: o.y } } : n
        })
      )
    }

    /** Pointer → flow coords through the frozen camera. */
    const flowPoint = (event: PointerEvent, b: DOMRect) =>
      paneToFlow(event.clientX - b.left, event.clientY - b.top, vp, rot)

    /** Chrome that must keep working while the tool is armed. */
    const skips = (event: Event) => {
      const target = event.target
      return !(target instanceof Element) || !!target.closest(SKIP_SEL)
    }

    const onDown = (event: PointerEvent) => {
      if (pointerId != null) return // Already dragging
      if (event.button !== 0 && event.button !== -1) return // Primary press only (right-click keeps menus)
      if (skips(event)) return // Minimap / nav / chat / toolbar own their presses
      const state = store.getState()
      const b = root.getBoundingClientRect()
      const [tx, ty, zoom] = state.transform
      bounds = b
      vp = { x: tx, y: ty, zoom }
      rot = boardRotationRef.current
      const start = flowPoint(event, b)
      at = axis === 'vertical' ? start.y : start.x // Guide sits where the press landed
      // Fix the affected set now so nodes don't join / leave the shift mid-drag
      origins = state
        .getNodes()
        .filter((n) => !n.parentNode && !SKIP_TYPES.has(n.type ?? '')) // Children ride with their parent
        .filter((n) => (axis === 'vertical' ? n.position.y : n.position.x) >= at) // Only content past the guide
        .map((n) => ({
          id: n.id,
          x: n.position.x,
          y: n.position.y,
          type: n.type,
          messageId: (n.data as { promptMessage?: { id?: string } } | undefined)?.promptMessage?.id,
        }))
      // Removing space can pull content back to the guide, never across it
      minPast = origins.reduce(
        (min, o) => Math.min(min, (axis === 'vertical' ? o.y : o.x) - at),
        Number.POSITIVE_INFINITY
      )
      if (!isFinite(minPast)) minPast = 0 // Nothing past the guide — push only
      pointerId = event.pointerId
      delta = 0
      snapshotTaken = false
      setUi({ axis, at, delta: 0, vp, rot }) // Guide appears on press, band grows on move
      try {
        root.setPointerCapture?.(event.pointerId) // Keep move/up if the pointer leaves the pane
      } catch {
        // Pointer already released — nothing to capture
      }
      event.preventDefault() // No caret / text selection / native drag while opening space
      event.stopPropagation()
    }

    const onMove = (event: PointerEvent) => {
      if (pointerId == null || event.pointerId !== pointerId || !bounds) return // Foreign pointer
      const now = flowPoint(event, bounds)
      const raw = axis === 'vertical' ? now.y - at : now.x - at // Drag distance along the tool's axis
      delta = Math.max(raw, -minPast) // Clamp so a pull-back stops at the guide
      if (Math.abs(delta) >= MIN_GAP_PX && !snapshotTaken) {
        snapshotTaken = true
        onBeforeShiftRef.current?.() // Undo step covers the whole gesture (nodes still at origin here)
      }
      const dx = axis === 'horizontal' ? delta : 0
      const dy = axis === 'vertical' ? delta : 0
      const byId = new Map(origins.map((o) => [o.id, o]))
      setNodesRef.current((nds) =>
        nds.map((n) => {
          const o = byId.get(n.id)
          if (!o) return n // Before the guide (or a child) — stays put
          return { ...n, position: { x: o.x + dx, y: o.y + dy } } // Always derive from the pre-drag origin
        })
      )
      setUi({ axis, at, delta, vp, rot })
    }

    const onUp = (event: PointerEvent) => {
      if (pointerId == null || event.pointerId !== pointerId) return
      const moved = Math.abs(delta) >= MIN_GAP_PX ? origins : [] // A tap changes nothing
      const dx = axis === 'horizontal' ? delta : 0
      const dy = axis === 'vertical' ? delta : 0
      reset()
      if (moved.length > 0) void persistShift(moved, dx, dy, conversationId)
    }

    const onCancel = (event: PointerEvent) => {
      if (pointerId == null || event.pointerId !== pointerId) return
      const back = origins // Interrupted (system gesture, overlay) — put content back
      reset()
      revert(back)
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length >= 2) {
        const back = origins // Pinch / two-finger pan wins — undo the partial gap
        reset()
        revert(back)
        return
      }
      if (skips(event)) return
      event.stopPropagation() // One finger: frames must not claim the touch for a caret (no preventDefault — keeps our pointer events)
    }

    // While armed the board is a gap-drag surface: swallow the presses that would select a
    // frame, place the I-bar, or open a menu (RF select runs on mousedown/click, not pointerdown)
    const swallow = (event: Event) => {
      if (skips(event)) return
      event.preventDefault()
      event.stopPropagation()
    }

    root.addEventListener('pointerdown', onDown, true) // Capture: claim the press before pane / node handlers
    root.addEventListener('pointermove', onMove)
    root.addEventListener('pointerup', onUp)
    root.addEventListener('pointercancel', onCancel)
    root.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
    root.addEventListener('mousedown', swallow, true)
    root.addEventListener('click', swallow, true)
    return () => {
      reset()
      root.removeEventListener('pointerdown', onDown, true)
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerup', onUp)
      root.removeEventListener('pointercancel', onCancel)
      root.removeEventListener('touchstart', onTouchStart, { capture: true })
      root.removeEventListener('mousedown', swallow, true)
      root.removeEventListener('click', swallow, true)
    }
  }, [axis, canEdit, conversationId, store, paneTick])

  return { ui }
}

/** Save the shifted positions: frames on their message, drawings on `canvas_nodes`. */
async function persistShift(moved: Origin[], dx: number, dy: number, conversationId: string) {
  try {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return // Anonymous homepage board — local shift only
    for (const o of moved) {
      const position = { x: o.x + dx, y: o.y + dy } // Top-level nodes: node.position is already absolute
      if (FRAME_TYPES.has(o.type ?? '')) {
        if (o.messageId) await persistBlockPlacement(supabase, { messageId: o.messageId, position })
        continue
      }
      if (!CANVAS_TYPES.has(o.type ?? '')) continue // Unknown node kind — leave the DB alone
      const { error } = await supabase
        .from('canvas_nodes')
        .update({ position_x: position.x, position_y: position.y })
        .eq('id', o.id)
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id)
      if (error) console.error('Insert space: failed to save drawing position:', error, { nodeId: o.id })
    }
  } catch (error) {
    console.error('Insert space: failed to persist shifted positions:', error)
  }
}
