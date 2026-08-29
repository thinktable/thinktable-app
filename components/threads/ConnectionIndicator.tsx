'use client'

import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { addEdge, useNodeId, useStoreApi, type Connection } from 'reactflow'

type Side = 'left' | 'right' | 'top' | 'bottom'

type ConnectionIndicatorProps = {
  side: Side // Which frame-edge connection point this indicator arms
  style?: CSSProperties // Outset placement from the parent
  className?: string
}

/** Only snap when the free end is this close (screen px) to a connection point — not merely near the frame. */
const SNAP_RADIUS_PX = 28

/** Client XY → pane-local XY (RF `connectionPosition` space). */
function eventPos(
  event: { clientX: number; clientY: number },
  bounds: DOMRect
) {
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
}

type SnapResult = {
  el: HTMLElement | null // DOM handle for highlight (optional)
  conn: Connection
  valid: boolean
  end: { nodeId: string; handleId: string | null; type: 'source' | 'target' }
  snapClient: { x: number; y: number } // Where to park the free end (client px)
}

/**
 * Outer blue connection **indicator** — plain DOM (not an RF Handle).
 * Pointer-down arms RF's connection gesture from the frame-edge connection **point**
 * so `ThreadConnectionLine` renders and settle uses handle id = side.
 */
export function ConnectionIndicator({
  side,
  style,
  className,
}: ConnectionIndicatorProps) {
  const store = useStoreApi()
  const nodeId = useNodeId()

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !nodeId) return // Left button + must be inside an RF node
    // Capture-friendly: stop before panel/`pressing` side-effects and RF node d3-drag
    event.preventDefault() // Don't select/drag the frame; also suppresses mouse* for d3-drag
    event.stopPropagation()

    const {
      domNode,
      onConnectStart,
      connectionMode,
      isValidConnection,
      panBy,
      autoPanOnConnect,
      cancelConnection,
      onConnect: onConnectAction,
      defaultEdgeOptions,
      hasDefaultEdges,
      setEdges,
    } = store.getState()

    const containerBounds = domNode?.getBoundingClientRect()
    if (!containerBounds) return

    const handleId = side // Edge connection point id (left/right/top/bottom)
    const handleType = 'source' as const
    const doc = document
    const pointerId = event.pointerId // Track this pointer only (preventDefault kills mouse*)

    let autoPanId = 0
    let autoPanStarted = false
    let connectionPosition = eventPos(event, containerBounds)
    let isValid = false
    let connection: Connection | null = null
    let prevActive: Element | null = null

    // Arm RF — connection line + tt-thread-connecting read these
    store.setState({
      connectionPosition,
      connectionStatus: null,
      connectionNodeId: nodeId,
      connectionHandleId: handleId,
      connectionHandleType: handleType,
      connectionStartHandle: { nodeId, handleId, type: handleType },
      connectionEndHandle: null,
    })
    // RF types OnConnectStart's event as React MouseEvent/TouchEvent but only forwards it to the
    // consumer, so the native PointerEvent driving this gesture needs a cast through unknown.
    onConnectStart?.(event.nativeEvent as unknown as ReactMouseEvent, { nodeId, handleId, handleType })

    const resetActive = () => {
      prevActive?.classList.remove(
        'valid',
        'connecting',
        'react-flow__handle-valid',
        'react-flow__handle-connecting'
      )
      prevActive = null
    }

    const autoPan = () => {
      if (!autoPanOnConnect) return
      const inset = 35
      const speed = 20
      const x =
        (connectionPosition.x < inset
          ? -1
          : connectionPosition.x > containerBounds.width - inset
            ? 1
            : 0) * speed
      const y =
        (connectionPosition.y < inset
          ? -1
          : connectionPosition.y > containerBounds.height - inset
            ? 1
            : 0) * speed
      if (x || y) panBy({ x, y })
      autoPanId = requestAnimationFrame(autoPan)
    }

    /**
     * Snap only when close to a connection point (handle), not merely near the frame.
     * Indicators still reveal on approach; release without a nearby point cancels.
     */
    const findSnap = (clientX: number, clientY: number): SnapResult | null => {
      const validFn = isValidConnection || (() => true)
      const radiusPx = SNAP_RADIUS_PX

      // Holder object, not a `let`: TS narrows a captured `let` to its initializer and can't see the
      // assignment inside forEach, which typed the element as `never` at the reads below.
      const best: { el: HTMLElement | null } = { el: null }
      let bestDist = Infinity
      let bestIsTarget = false
      doc.querySelectorAll('.react-flow__handle.connectable.connectableend').forEach((node) => {
        const el = node as HTMLElement
        const nId = el.getAttribute('data-nodeid')
        if (!nId || nId === nodeId) return
        const rect = el.getBoundingClientRect()
        const dist = Math.hypot(
          rect.left + rect.width / 2 - clientX,
          rect.top + rect.height / 2 - clientY
        )
        if (dist > radiusPx) return
        const isTarget = el.classList.contains('target')
        // Prefer closer; at equal distance prefer target handles
        if (dist < bestDist - 0.5 || (Math.abs(dist - bestDist) <= 0.5 && isTarget && !bestIsTarget)) {
          best.el = el
          bestDist = dist
          bestIsTarget = isTarget
        }
      })

      const bestEl = best.el
      if (!bestEl) return null

      const targetNodeId = bestEl.getAttribute('data-nodeid')!
      const targetHandleId = bestEl.getAttribute('data-handleid')
      const type = bestEl.classList.contains('target') ? 'target' : 'source'
      if (connectionMode === 'strict' && type !== 'target') return null
      const conn: Connection = {
        source: nodeId,
        sourceHandle: handleId,
        target: targetNodeId,
        targetHandle: targetHandleId,
      }
      if (!validFn(conn)) return null
      const r = bestEl.getBoundingClientRect()
      return {
        el: bestEl,
        conn,
        valid: true,
        end: { nodeId: targetNodeId, handleId: targetHandleId, type },
        snapClient: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      }
    }

    const applySnap = (snap: SnapResult | null, bounds: DOMRect) => {
      isValid = snap?.valid ?? false
      connection = snap?.conn ?? null
      resetActive()
      if (snap?.el && snap.conn.source !== snap.conn.target) {
        prevActive = snap.el
        snap.el.classList.add('connecting', 'react-flow__handle-connecting')
        snap.el.classList.toggle('valid', isValid)
        snap.el.classList.toggle('react-flow__handle-valid', isValid)
      }
      let nextPos = connectionPosition
      if (snap?.valid && snap.snapClient) {
        nextPos = eventPos(
          { clientX: snap.snapClient.x, clientY: snap.snapClient.y },
          bounds
        )
      }
      store.setState({
        connectionPosition: nextPos,
        connectionStatus: snap ? (isValid ? 'valid' : 'invalid') : null,
        connectionEndHandle: snap?.valid ? snap.end : null,
      })
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      const clientX = e.clientX
      const clientY = e.clientY
      const bounds =
        store.getState().domNode?.getBoundingClientRect() ?? containerBounds
      connectionPosition = eventPos({ clientX, clientY }, bounds)

      if (!autoPanStarted) {
        autoPan()
        autoPanStarted = true
      }

      applySnap(findSnap(clientX, clientY), bounds)
    }

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      // Final snap check at release — only connects if still close to a point
      const bounds =
        store.getState().domNode?.getBoundingClientRect() ?? containerBounds
      const snap = findSnap(e.clientX, e.clientY)
      applySnap(snap, bounds)

      if (isValid && connection) {
        const edgeParams = { ...defaultEdgeOptions, ...connection }
        // Controlled edges: only onConnect adds (avoid double-add via hasDefaultEdges)
        if (hasDefaultEdges && !onConnectAction) {
          // RF's store setEdges takes an array (not a setState updater) — passing a function here
          // stored the function itself as the edge list.
          setEdges(addEdge(edgeParams, store.getState().edges))
        }
        onConnectAction?.(edgeParams as Connection)
      }

      store.getState().onConnectEnd?.(e)
      resetActive()
      cancelConnection()
      cancelAnimationFrame(autoPanId)
      doc.removeEventListener('pointermove', onMove)
      doc.removeEventListener('pointerup', onUp)
      doc.removeEventListener('pointercancel', onUp)
    }

    // Use pointer* — preventDefault on pointerdown suppresses mouse compatibility events
    doc.addEventListener('pointermove', onMove)
    doc.addEventListener('pointerup', onUp)
    doc.addEventListener('pointercancel', onUp)
  }

  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={`Start thread from ${side}`}
      data-tt-connection-indicator={side}
      className={
        className ??
        'nodrag nopan absolute z-[30] h-2.5 w-2.5 cursor-crosshair rounded-full border border-white bg-blue-500 shadow-sm hover:bg-blue-600'
      }
      style={style}
      // Capture so we beat the frame panel’s pressing/unmount path and RF node drag
      onPointerDownCapture={onPointerDown}
    />
  )
}
