import { getSmoothStepPath } from 'reactflow' // Preview path while dragging a thread

/**
 * Connection-line preview while creating or reconnecting a thread.
 * Free end tracks the pointer (toX/toY); stroke matches idle thread gray.
 */
export function ThreadConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
}: {
  fromX: number
  fromY: number
  toX: number
  toY: number
}) {
  const [path] = getSmoothStepPath({
    sourceX: fromX,
    sourceY: fromY,
    targetX: toX,
    targetY: toY,
  })

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
