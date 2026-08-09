import { useCallback, useEffect, useRef, useState } from 'react' // Drag + keyboard edit for a control point
import { useReactFlow, useStore, type XYPosition } from 'reactflow' // Screen→flow coords + pane DOM

/** One editable point on a thread path (active = shapes the curve). */
export type ControlPointData = XYPosition & {
  id: string // Stable id for React keys + persistence
  active?: boolean // True once the user has placed/dragged this point
  prev?: string // Prior point id (optional chain hint from freeform draw)
}

export type ControlPointProps = {
  id: string
  index: number // Index in the mixed active/inactive list from getControlPoints
  x: number
  y: number
  color: string // Stroke/fill for the knob
  active?: boolean
  setControlPoints: (update: (points: ControlPointData[]) => ControlPointData[]) => void // Mutate edge.data.points
  onPointsCommitted?: () => void // Persist after drag ends
}

/** Hollow (inactive) or solid (active) knob on a selected thread — Miro-style path adjust. */
export function ControlPoint({
  id,
  index,
  x,
  y,
  color,
  active,
  setControlPoints,
  onPointsCommitted,
}: ControlPointProps) {
  const container = useStore((store) => store.domNode) // Pane element for pointer listeners
  const zoom = useStore((s) => s.transform[2] || 1) // Counter-scale knobs with board zoom
  const invZoom = 1 / Math.max(0.01, zoom)
  const { screenToFlowPosition } = useReactFlow() // Convert pointer to flow coords
  const [dragging, setDragging] = useState(false) // True while pointer is down on this knob
  const ref = useRef<SVGCircleElement>(null) // Focus target after delete

  // Move this point (or activate an inactive mid-point by inserting it into the active list)
  const updatePosition = useCallback(
    (pos: XYPosition) => {
      setControlPoints((points) => {
        const shouldActivate = !active // First drag on a hollow mid-point inserts it
        if (shouldActivate) {
          if (index !== 0) {
            // Inactive points sit between actives: index maps to insert after index*0.5-1
            return points.flatMap((p, i) =>
              i === index * 0.5 - 1 ? [p, { ...pos, id, active: true }] : p
            )
          }
          return [{ ...pos, id, active: true }, ...points] // Insert at start of active list
        }
        return points.map((p) => (p.id === id ? { ...p, ...pos } : p)) // Move existing active point
      })
    },
    [id, active, index, setControlPoints]
  )

  // Remove this active control point from the path
  const deletePoint = useCallback(() => {
    setControlPoints((points) => points.filter((p) => p.id !== id))
    onPointsCommitted?.() // Persist deletion
    const previousControlPoint = ref.current?.previousElementSibling?.previousElementSibling
    if (
      previousControlPoint?.tagName === 'circle' &&
      previousControlPoint.classList.contains('active')
    ) {
      window.requestAnimationFrame(() => {
        ;(previousControlPoint as SVGCircleElement).focus()
      })
    }
  }, [id, setControlPoints, onPointsCommitted])

  // Keyboard: activate, nudge, or delete
  const handleKeyPress = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'Enter':
        case ' ':
          if (!active) e.preventDefault()
          updatePosition({ x, y })
          break
        case 'Backspace':
        case 'Delete':
          e.stopPropagation()
          deletePoint()
          break
        case 'ArrowLeft':
          updatePosition({ x: x - 5, y })
          break
        case 'ArrowRight':
          updatePosition({ x: x + 5, y })
          break
        case 'ArrowUp':
          updatePosition({ x, y: y - 5 })
          break
        case 'ArrowDown':
          updatePosition({ x, y: y + 5 })
          break
        default:
          break
      }
    },
    [active, updatePosition, x, y, deletePoint]
  )

  // While dragging, follow the pointer in flow space
  useEffect(() => {
    if (!container || !active || !dragging) return

    const onPointerMove = (e: PointerEvent) => {
      updatePosition(screenToFlowPosition({ x: e.clientX, y: e.clientY }))
    }

    const onPointerUp = () => {
      container.removeEventListener('pointermove', onPointerMove)
      setDragging(false)
      onPointsCommitted?.() // Persist after release
    }

    container.addEventListener('pointermove', onPointerMove)
    container.addEventListener('pointerup', onPointerUp, { once: true })
    container.addEventListener('pointerleave', onPointerUp, { once: true })

    return () => {
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerup', onPointerUp)
      container.removeEventListener('pointerleave', onPointerUp)
      setDragging(false)
    }
  }, [container, dragging, active, screenToFlowPosition, updatePosition, onPointsCommitted])

  return (
    <circle
      ref={ref}
      tabIndex={0}
      id={id}
      className={'nopan nodrag' + (active ? ' active' : '')} // Don't pan/drag the map while editing
      cx={x}
      cy={y}
      r={(active ? 5 : 4) * invZoom} // Screen-constant knob size (÷zoom)
      strokeWidth={1.5 * invZoom} // Ring thickness stays constant on screen
      strokeOpacity={active ? 1 : 0.85}
      stroke={color}
      fill={active ? color : '#ffffff'} // Miro: solid = active, hollow = addable
      style={{ pointerEvents: 'all', cursor: 'grab' }}
      onContextMenu={(e) => {
        e.preventDefault()
        if (active) deletePoint() // Right-click removes an active point
      }}
      onPointerDown={(e) => {
        if (e.button === 2) return // Ignore right-click here (context menu handles delete)
        e.stopPropagation() // Don't start map pan or edge reconnect
        updatePosition({ x, y }) // Activate hollow point on first press
        setDragging(true)
      }}
      onKeyDown={handleKeyPress}
      onPointerUp={() => setDragging(false)}
    />
  )
}
