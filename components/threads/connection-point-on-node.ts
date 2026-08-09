import { Position, type Node, type XYPosition } from 'reactflow' // Node box → mid-side attach point
import { normalizeHandleId } from './handle-ids' // left-indicator → left

/**
 * Mid-side point on a node's frame edge (the connection **point**).
 * Ignores outer indicator Handle positions entirely.
 */
export function connectionPointOnNode(
  node: Node | undefined,
  side: Position | undefined
): XYPosition | null {
  if (!node || !side) return null
  const x = node.positionAbsolute?.x ?? node.position.x
  const y = node.positionAbsolute?.y ?? node.position.y
  const w = node.width ?? 0
  const h = node.height ?? 0
  if (w <= 0 || h <= 0) return null // Not measured yet — caller falls back to RF coords
  switch (side) {
    case Position.Left:
      return { x, y: y + h / 2 }
    case Position.Right:
      return { x: x + w, y: y + h / 2 }
    case Position.Top:
      return { x: x + w / 2, y }
    case Position.Bottom:
      return { x: x + w / 2, y: y + h }
    default:
      return null
  }
}

/** Resolve which side a handle id refers to (`left-indicator` → Left). */
export function sideFromHandleId(
  handleId: string | null | undefined,
  fallback: Position | undefined
): Position | undefined {
  const id = normalizeHandleId(handleId) || handleId
  if (id === 'left') return Position.Left
  if (id === 'right') return Position.Right
  if (id === 'top') return Position.Top
  if (id === 'bottom') return Position.Bottom
  return fallback
}
