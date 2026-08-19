import { Position, getBezierPath, type XYPosition } from 'reactflow'; // RF sides + opposite-side fallback bezier + points

// This is directly lifted from the library - it is used to calculate
// the control points for the bezier curve, which can be converted to
// catmull-rom control points and used to create an editable bezier curve

function calculateControlOffset(distance: number, curvature: number): number {
  if (distance >= 0) {
    return 0.5 * distance;
  }

  return curvature * 25 * Math.sqrt(-distance);
}

export function getControlWithCurvature(
  pos: Position,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  c: number
): [number, number] {
  switch (pos) {
    case Position.Left:
      return [x1 - calculateControlOffset(x1 - x2, c), y1];
    case Position.Right:
      return [x1 + calculateControlOffset(x2 - x1, c), y1];
    case Position.Top:
      return [x1, y1 - calculateControlOffset(y1 - y2, c)];
    case Position.Bottom:
      return [x1, y1 + calculateControlOffset(y2 - y1, c)];
  }
}

/** Min visual arch (flow px) so snapped same-side threads never read as a hairline. */
const SAME_SIDE_BOW_MIN = 44;
/** Arch as a fraction of endpoint span (top-to-top snapped frames ~span of the pair). */
const SAME_SIDE_BOW_FACTOR = 0.5;
/** Cap so long same-side threads stay a bow, not a loop. */
const SAME_SIDE_BOW_MAX = 88;
/** Pull each control point this fraction toward the other end so the arch is round, not a box. */
const SAME_SIDE_ALONG = 0.25;
/** Cubic t=0.5 sits at 3/4 of the control offset — scale CPs so the visible peak equals `visual`. */
const SAME_SIDE_CP_SCALE = 4 / 3;

/** Point on a cubic bezier at parameter `t`. */
function cubicAt(
  p0: XYPosition, // Start (source connection point)
  c1: XYPosition, // First control point (leaves along the source side)
  c2: XYPosition, // Second control point (arrives along the target side)
  p3: XYPosition, // End (target connection point)
  t: number // 0..1 along the curve
): XYPosition {
  const u = 1 - t; // Complement so we can write the standard Bernstein basis
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
  };
}

/** Args for the unbent Smooth thread path (settled edge or live connection preview). */
export type SmoothThreadBezierArgs = {
  sourceX: number // Source connection-point X in flow space
  sourceY: number // Source connection-point Y in flow space
  sourcePosition: Position // Side the thread leaves (Top = arch up)
  targetX: number // Target connection-point X in flow space
  targetY: number // Target connection-point Y in flow space
  targetPosition: Position // Side the thread arrives
};

/** Cubic path + midpoint knob for an unbent Smooth thread. */
export type SmoothThreadBezier = {
  path: string // SVG `d` for BaseEdge / connection line
  mid: XYPosition // t=0.5 on the cubic — hollow knob sits on the stroke
};

/**
 * Unbent Smooth path.
 * Same-side (typical when frames are edge-snapped and both attach on top/bottom)
 * bows outward — RF `getBezierPath` collapses to a flat line when Y (or X) matches.
 * Opposite / mixed sides keep RF bezier (already a decent S-free curve).
 */
export function getSmoothThreadBezier(args: SmoothThreadBezierArgs): SmoothThreadBezier {
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition } = args; // Unpack flow endpoints + sides
  // Snapped pairs almost always share a side (top↔top over the stack line).
  if (sourcePosition === targetPosition) {
    const dx = targetX - sourceX; // Span along X (top/bottom same-side)
    const dy = targetY - sourceY; // Span along Y (left/right same-side)
    const span = Math.hypot(dx, dy); // Endpoint distance drives how tall the arch is
    const visual = Math.min(SAME_SIDE_BOW_MAX, Math.max(SAME_SIDE_BOW_MIN, span * SAME_SIDE_BOW_FACTOR)); // Visible peak in flow px
    const bow = visual * SAME_SIDE_CP_SCALE; // Control offset so t=0.5 actually reaches `visual`
    let c1x = sourceX; // First CP X — mutated per side
    let c1y = sourceY; // First CP Y
    let c2x = targetX; // Second CP X
    let c2y = targetY; // Second CP Y
    switch (sourcePosition) {
      case Position.Top: // Arch above both frames (snapped left/right pair)
        c1x = sourceX + dx * SAME_SIDE_ALONG; // Ease toward the target so the bow is round
        c1y = sourceY - bow; // Outward = up
        c2x = targetX - dx * SAME_SIDE_ALONG;
        c2y = targetY - bow;
        break;
      case Position.Bottom: // Arch below both frames
        c1x = sourceX + dx * SAME_SIDE_ALONG;
        c1y = sourceY + bow; // Outward = down
        c2x = targetX - dx * SAME_SIDE_ALONG;
        c2y = targetY + bow;
        break;
      case Position.Left: // Arch left of a vertically snapped pair
        c1x = sourceX - bow; // Outward = left
        c1y = sourceY + dy * SAME_SIDE_ALONG;
        c2x = targetX - bow;
        c2y = targetY - dy * SAME_SIDE_ALONG;
        break;
      case Position.Right: // Arch right of a vertically snapped pair
        c1x = sourceX + bow; // Outward = right
        c1y = sourceY + dy * SAME_SIDE_ALONG;
        c2x = targetX + bow;
        c2y = targetY - dy * SAME_SIDE_ALONG;
        break;
    }
    const p0 = { x: sourceX, y: sourceY }; // Cubic start
    const c1 = { x: c1x, y: c1y }; // Leave along the shared side
    const c2 = { x: c2x, y: c2y }; // Arrive along the shared side
    const p3 = { x: targetX, y: targetY }; // Cubic end
    return {
      path: `M${sourceX},${sourceY} C${c1x},${c1y} ${c2x},${c2y} ${targetX},${targetY}`, // Same compact form as RF getBezierPath
      mid: cubicAt(p0, c1, c2, p3, 0.5), // Hollow knob on the arch peak
    };
  }
  // Opposite or mixed sides: RF side-aware bezier (curvature only matters on back-facing spans).
  const [path, labelX, labelY] = getBezierPath({
    sourceX, // RF names match our args
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return { path, mid: { x: labelX, y: labelY } }; // RF label point is the visual midpoint
}
