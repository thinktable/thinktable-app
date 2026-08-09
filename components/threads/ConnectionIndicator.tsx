'use client'

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { addEdge, useNodeId, useStoreApi, type Connection } from 'reactflow'

type Side = 'left' | 'right' | 'top' | 'bottom'

type ConnectionIndicatorProps = {
  side: Side // Which frame-edge connection point this indicator arms
  style?: CSSProperties // Outset placement from the parent
  className?: string
}

/** Client XY → pane-local XY (RF `connectionPosition` space). */
function eventPos(
  event: { clientX: number; clientY: number },
  bounds: DOMRect
) {
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
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
    event.preventDefault() // Don't select/drag the frame
    event.stopPropagation()

    const {
      domNode,
      onConnectStart,
      connectionRadius,
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
    onConnectStart?.(event.nativeEvent, { nodeId, handleId, handleType })

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

    /** Snap to a connectable-end Handle near the pointer (DOM + radius). */
    const findSnap = (clientX: number, clientY: number) => {
      const under = doc.elementsFromPoint(clientX, clientY)
      const hit = under.find(
        (el) =>
          el.classList.contains('react-flow__handle') &&
          el.classList.contains('connectableend')
      ) as HTMLElement | undefined

      const { transform } = store.getState()
      const scale = transform[2] || 1
      const radiusPx = Math.max(connectionRadius * scale, 24)

      let best: HTMLElement | null = hit ?? null
      let bestDist = hit ? 0 : Infinity

      if (!best) {
        const handles = doc.querySelectorAll(
          '.react-flow__handle.connectable.connectableend'
        )
        handles.forEach((node) => {
          const el = node as HTMLElement
          const nId = el.getAttribute('data-nodeid')
          if (!nId || nId === nodeId) return
          const rect = el.getBoundingClientRect()
          const dist = Math.hypot(
            rect.left + rect.width / 2 - clientX,
            rect.top + rect.height / 2 - clientY
          )
          if (dist <= radiusPx && dist < bestDist) {
            best = el
            bestDist = dist
          }
        })
      }

      if (!best) return null

      const targetNodeId = best.getAttribute('data-nodeid')
      if (!targetNodeId || targetNodeId === nodeId) return null

      const targetHandleId = best.getAttribute('data-handleid')
      const type = best.classList.contains('target') ? 'target' : 'source'
      const conn: Connection = {
        source: nodeId,
        sourceHandle: handleId,
        target: targetNodeId,
        targetHandle: targetHandleId,
      }
      const connectable =
        best.classList.contains('connectable') &&
        best.classList.contains('connectableend')
      const typeOk =
        connectionMode === 'strict' ? type === 'target' : true
      const validFn = isValidConnection || (() => true)
      const valid = Boolean(connectable && typeOk && validFn(conn))

      return {
        el: best,
        conn,
        valid,
        end: {
          nodeId: targetNodeId,
          handleId: targetHandleId,
          type: type as 'source' | 'target',
        },
      }
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      const clientX = e.clientX
      const clientY = e.clientY
      // Re-read pane bounds in case the viewport moved while dragging
      const bounds =
        store.getState().domNode?.getBoundingClientRect() ?? containerBounds
      connectionPosition = eventPos({ clientX, clientY }, bounds)

      if (!autoPanStarted) {
        autoPan()
        autoPanStarted = true
      }

      const snap = findSnap(clientX, clientY)
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
      if (snap?.valid && snap.el) {
        const r = snap.el.getBoundingClientRect()
        nextPos = eventPos(
          { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 },
          bounds
        )
      }

      store.setState({
        connectionPosition: nextPos,
        connectionStatus: snap ? (isValid ? 'valid' : 'invalid') : null,
        connectionEndHandle: snap?.valid ? snap.end : null,
      })
    }

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      if (isValid && connection) {
        const edgeParams = { ...defaultEdgeOptions, ...connection }
        if (hasDefaultEdges) {
          setEdges((eds) => addEdge(edgeParams, eds))
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
      onPointerDown={onPointerDown}
    />
  )
}
