/** Phone: unselected frames drag only after a hold (quick touch+move pans / selects, not frame drag). */

import { LONG_PRESS_MS, LONG_PRESS_MOVE_PX } from '@/lib/long-press'

export const PHONE_UNSELECTED_FRAME_DRAG_HOLD_MS = LONG_PRESS_MS // Match boards-nav reorder + frame menu
export const PHONE_UNSELECTED_FRAME_DRAG_MOVE_PX = LONG_PRESS_MOVE_PX

export type PhoneUnselectedFrameDragCallbacks = {
  isMobileMode: () => boolean
  getNode: (id: string) =>
    | { id: string; type?: string; selected?: boolean; position: { x: number; y: number } }
    | undefined
  screenToFlow: (clientX: number, clientY: number) => { x: number; y: number }
  onDragStart: (nodeId: string, event: PointerEvent) => void
  onDrag: (nodeId: string, position: { x: number; y: number }, event: PointerEvent) => void
  onDragStop: (nodeId: string, event: PointerEvent) => void
  /** Resolve unselected chatPanel / blockGroup under the pointer (null if chrome owns the gesture). */
  resolveFrameNodeId: (event: PointerEvent) => string | null
}

/**
 * Hold-to-drag for unselected frames on phone. RF `nodrag` blocks immediate d3-drag; this controller
 * moves the frame after the hold timer when the finger then moves.
 */
export function createPhoneUnselectedFrameDragController(
  options: PhoneUnselectedFrameDragCallbacks
) {
  let holdTimer: ReturnType<typeof setTimeout> | null = null
  let pointerId: number | null = null
  let nodeId: string | null = null
  let startClientX = 0
  let startClientY = 0
  let flowStartX = 0
  let flowStartY = 0
  let nodeStartX = 0
  let nodeStartY = 0
  let holdArmed = false // Hold completed — next move starts drag
  let dragging = false
  const activePointers = new Set<number>()

  const clearHoldTimer = () => {
    if (holdTimer != null) {
      clearTimeout(holdTimer)
      holdTimer = null
    }
  }

  const resetGesture = () => {
    clearHoldTimer()
    pointerId = null
    nodeId = null
    holdArmed = false
    dragging = false
  }

  const cancel = () => {
    resetGesture()
    activePointers.clear()
  }

  const pointerDown = (event: PointerEvent) => {
    if (!options.isMobileMode()) return
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
    if (event.button !== 0 && event.button !== -1) return

    activePointers.add(event.pointerId)
    if (activePointers.size > 1) {
      cancel()
      return
    }

    const id = options.resolveFrameNodeId(event)
    if (!id) return
    const node = options.getNode(id)
    if (!node || node.selected) return
    if (node.type !== 'chatPanel' && node.type !== 'blockGroup') return

    resetGesture()
    pointerId = event.pointerId
    nodeId = id
    startClientX = event.clientX
    startClientY = event.clientY
    const flow = options.screenToFlow(startClientX, startClientY)
    flowStartX = flow.x
    flowStartY = flow.y
    nodeStartX = node.position.x
    nodeStartY = node.position.y

    holdTimer = setTimeout(() => {
      holdTimer = null
      holdArmed = true
    }, PHONE_UNSELECTED_FRAME_DRAG_HOLD_MS)
  }

  const pointerMove = (event: PointerEvent) => {
    if (pointerId == null || event.pointerId !== pointerId || !nodeId) return

    const dx = event.clientX - startClientX
    const dy = event.clientY - startClientY
    const dist2 = dx * dx + dy * dy

    if (!holdArmed && !dragging) {
      if (dist2 > PHONE_UNSELECTED_FRAME_DRAG_MOVE_PX * PHONE_UNSELECTED_FRAME_DRAG_MOVE_PX) {
        resetGesture()
      }
      return
    }

    if (holdArmed && !dragging) {
      dragging = true
      options.onDragStart(nodeId, event)
    }

    if (!dragging) return

    const flow = options.screenToFlow(event.clientX, event.clientY)
    options.onDrag(nodeId, {
      x: nodeStartX + flow.x - flowStartX,
      y: nodeStartY + flow.y - flowStartY,
    }, event)
  }

  const pointerUp = (event: PointerEvent) => {
    activePointers.delete(event.pointerId)
    if (pointerId == null || event.pointerId !== pointerId) return
    if (dragging && nodeId) {
      options.onDragStop(nodeId, event)
    }
    resetGesture()
  }

  const pointerCancel = (event: PointerEvent) => {
    activePointers.delete(event.pointerId)
    if (pointerId == null || event.pointerId !== pointerId) return
    if (dragging && nodeId) {
      options.onDragStop(nodeId, event)
    }
    resetGesture()
  }

  const touchStart = (event: TouchEvent) => {
    if (event.touches.length > 1) cancel()
  }

  const touchEnd = (event: TouchEvent) => {
    if (event.touches.length > 1) return
    if (event.touches.length === 0) activePointers.clear()
    if (!dragging) resetGesture()
  }

  const isDragging = () => dragging

  return {
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    touchStart,
    touchEnd,
    cancel,
    isDragging,
  }
}
