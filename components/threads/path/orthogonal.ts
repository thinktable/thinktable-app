import { getSmoothStepPath, Position, type XYPosition } from 'reactflow' // 90° ridged segments

import { getLinearControlPoints } from './linear' // Midpoint knobs between waypoints

const opposite: Record<Position, Position> = {
  [Position.Left]: Position.Right,
  [Position.Right]: Position.Left,
  [Position.Top]: Position.Bottom,
  [Position.Bottom]: Position.Top,
}

/** Guess exit side from a→b so chained elbows stay orthogonal. */
function sideToward(from: XYPosition, to: XYPosition): Position {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? Position.Right : Position.Left
  }
  return dy >= 0 ? Position.Bottom : Position.Top
}

/**
 * Ridged 90° path (SmoothStep with borderRadius 0) through waypoints.
 * First/last segments honor frame connection-point sides.
 */
export function getOrthogonalPath(
  points: XYPosition[],
  sides = { fromSide: Position.Right, toSide: Position.Left }
): string {
  if (points.length < 2) return ''

  let path = ''
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const sourcePosition =
      i === 0 ? sides.fromSide : sideToward(a, b)
    const targetPosition =
      i === points.length - 2
        ? sides.toSide
        : opposite[sideToward(a, b)] ?? Position.Left

    const [seg] = getSmoothStepPath({
      sourceX: a.x,
      sourceY: a.y,
      sourcePosition,
      targetX: b.x,
      targetY: b.y,
      targetPosition,
      borderRadius: 8, // Rounded elbows on ridged Sharp threads
    })

    if (i === 0) {
      path = seg
    } else {
      // Append without a second M — keep one continuous stroke
      path += seg.replace(/^M\s+[-\d.eE]+[\s,]+[-\d.eE]+/, '')
    }
  }

  return path
}

/** Mid-segment knobs (same as linear) so Sharp threads stay editable. */
export function getOrthogonalControlPoints(
  points: Parameters<typeof getLinearControlPoints>[0]
) {
  return getLinearControlPoints(points)
}
