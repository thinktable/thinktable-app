import { getSmoothStepPath, Position, useStore } from 'reactflow' // Sharp preview + live zoom
import { getSmoothThreadBezier } from './path/bezier' // Same bowed Smooth path as settled threads
import {
  isSharpThreadAlgorithm,
  threadAlgorithmFromStyle,
  ThreadAlgorithm,
  threadComfortScale,
} from './constants' // Toolbar Smooth / Sharp / Linear + zoom comfort
import { navigationZoom } from '@/lib/board-navigating' // Freeze preview mid-pinch

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
  const zoom = useStore((s) =>
    navigationZoom(Math.round((s.transform[2] || 1) * 8) / 8)
  ) // Freeze mid-pinch
  const strokeWidth = 2 * threadComfortScale(zoom) // Match settled thread comfort (thins on zoom-out)

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
    path = getSmoothThreadBezier({
      sourceX: fromX, // Live drag start (already on the source connection point)
      sourceY: fromY,
      sourcePosition: fromPosition, // Side we left — top↔top while snapping beside a mate
      targetX: toX,
      targetY: toY,
      targetPosition: toPosition, // RF toPosition so a top snap approaches from above
    }).path
  }

  return (
    <g className="react-flow__connectionline">
      <path
        d={path}
        fill="none"
        className="react-flow__connectionline-path"
        stroke="#6b7280"
        strokeWidth={strokeWidth} // Comfort curve — same as EditableThread
      />
    </g>
  )
}
