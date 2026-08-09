import { getBezierPath, getSmoothStepPath, Position } from 'reactflow' // Preview by thread style
import {
  isSharpThreadAlgorithm,
  threadAlgorithmFromStyle,
  ThreadAlgorithm,
} from './constants' // Toolbar Smooth / Sharp / Linear

const opposite: Record<Position, Position> = {
  [Position.Left]: Position.Right,
  [Position.Right]: Position.Left,
  [Position.Top]: Position.Bottom,
  [Position.Bottom]: Position.Top,
}

/** Read board thread style preference for the live connection preview. */
function preferredAlgorithm() {
  if (typeof window === 'undefined') return ThreadAlgorithm.BezierCatmullRom
  return threadAlgorithmFromStyle(
    localStorage.getItem('thinktable-horizontal-line-style')
  )
}

/**
 * Connection-line preview while creating or reconnecting a thread.
 * Smooth = bezier · Sharp = ridged 90° · Linear = straight.
 */
export function ThreadConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition = Position.Right,
}: {
  fromX: number
  fromY: number
  toX: number
  toY: number
  fromPosition?: Position
}) {
  const algorithm = preferredAlgorithm()
  const toPosition = opposite[fromPosition] ?? Position.Left

  let path: string
  if (isSharpThreadAlgorithm(algorithm)) {
    ;[path] = getSmoothStepPath({
      sourceX: fromX,
      sourceY: fromY,
      sourcePosition: fromPosition,
      targetX: toX,
      targetY: toY,
      targetPosition: toPosition,
      borderRadius: 8, // Match settled Sharp threads (rounded elbows)
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
        strokeWidth={2}
      />
    </g>
  )
}
