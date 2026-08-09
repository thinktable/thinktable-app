import { getBezierPath, getSmoothStepPath, Position, useStore } from 'reactflow' // Preview by thread style + live zoom
import {
  isSharpThreadAlgorithm,
  threadAlgorithmFromStyle,
  ThreadAlgorithm,
} from './constants' // Toolbar Smooth / Sharp / Linear

/** Read board thread style preference for the live connection preview. */
function preferredAlgorithm() {
  if (typeof window === 'undefined') return ThreadAlgorithm.BezierCatmullRom
  return threadAlgorithmFromStyle(
    localStorage.getItem('thinktable-horizontal-line-style')
  )
}

/**
 * Connection-line preview while creating or reconnecting a thread.
 * Miro-like: side-aware cubic bezier (or sharp/linear) — no stub waypoints / S-curves.
 * Uses RF `toPosition` so a top snap approaches from above.
 */
export function ThreadConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition = Position.Right,
  toPosition = Position.Left,
}: {
  fromX: number
  fromY: number
  toX: number
  toY: number
  fromPosition?: Position
  toPosition?: Position // Target handle side when snapped
}) {
  const algorithm = preferredAlgorithm()
  const zoom = useStore((s) => s.transform[2] || 1) // Counter-scale preview stroke with board zoom
  const strokeWidth = 2 / Math.max(0.01, zoom) // Same screen thickness as settled threads

  let path: string
  if (isSharpThreadAlgorithm(algorithm)) {
    ;[path] = getSmoothStepPath({
      sourceX: fromX,
      sourceY: fromY,
      sourcePosition: fromPosition,
      targetX: toX,
      targetY: toY,
      targetPosition: toPosition,
      borderRadius: 8,
    })
  } else if (algorithm === ThreadAlgorithm.Linear) {
    path = `M ${fromX} ${fromY} L ${toX} ${toY}`
  } else {
    ;[path] = getBezierPath({
      sourceX: fromX,
      sourceY: fromY,
      sourcePosition: fromPosition,
      targetX: toX,
      targetY: toY,
      targetPosition: toPosition,
    })
  }

  return (
    <g className="react-flow__connectionline">
      <path
        d={path}
        fill="none"
        className="react-flow__connectionline-path"
        stroke="#6b7280"
        strokeWidth={strokeWidth} // Screen-constant (÷zoom)
      />
    </g>
  )
}
