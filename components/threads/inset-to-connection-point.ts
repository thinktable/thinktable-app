import { Position, type XYPosition } from 'reactflow' // Side → inset direction
import { INDICATOR_OUTSET, isConnectionIndicatorId } from './handle-ids' // Outer-dot geometry

/**
 * If RF still reports an indicator handle position, pull the endpoint inward onto the frame edge
 * so the thread looks attached to the adjust frame (not the outer blue dot).
 */
export function insetToConnectionPoint(
  point: XYPosition,
  position: Position | undefined,
  handleId: string | null | undefined
): XYPosition {
  if (!isConnectionIndicatorId(handleId) || !position) return point // Already on the edge anchor
  const d = INDICATOR_OUTSET
  switch (position) {
    case Position.Left:
      return { x: point.x + d, y: point.y } // Indicator is left of edge → move right onto frame
    case Position.Right:
      return { x: point.x - d, y: point.y }
    case Position.Top:
      return { x: point.x, y: point.y + d }
    case Position.Bottom:
      return { x: point.x, y: point.y - d }
    default:
      return point
  }
}
