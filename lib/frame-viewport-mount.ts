// Viewport-aware frame content mount — defer heavy TipTap until near (or before) the pane.

import { flowToPane } from '@/lib/board-rotation'
import type { FrameLayoutCache } from '@/components/frame-content-shimmer'

/** Prefetch zone — mount before the frame enters the pane. */
export const FRAME_MOUNT_BUFFER_IN_PX = 520

/** Hysteresis — keep mounted slightly longer so panning does not flicker mount/unmount. */
export const FRAME_MOUNT_BUFFER_OUT_PX = 760

/** Only defer when the board has at least this many frames (small boards mount everything). */
export const FRAME_VIEWPORT_DEFER_MIN = 10

export type FrameMountBounds = { left: number; top: number; right: number; bottom: number }

/** Flow box → axis-aligned bounds in pane-local px (honors camera rotate). */
export function frameMountBoundsInPane(
  pos: { x: number; y: number },
  size: { width: number; height: number },
  vp: { x: number; y: number; zoom: number },
  rotDeg: number
): FrameMountBounds {
  const x1 = pos.x + size.width
  const y1 = pos.y + size.height
  const corners = [
    flowToPane(pos.x, pos.y, vp, rotDeg),
    flowToPane(x1, pos.y, vp, rotDeg),
    flowToPane(pos.x, y1, vp, rotDeg),
    flowToPane(x1, y1, vp, rotDeg),
  ]
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const c of corners) {
    left = Math.min(left, c.x)
    top = Math.min(top, c.y)
    right = Math.max(right, c.x)
    bottom = Math.max(bottom, c.y)
  }
  return { left, top, right, bottom }
}

export function intersectsPaneWithBuffer(
  bounds: FrameMountBounds,
  paneW: number,
  paneH: number,
  buffer: number
): boolean {
  return !(
    bounds.right < -buffer ||
    bounds.left > paneW + buffer ||
    bounds.bottom < -buffer ||
    bounds.top > paneH + buffer
  )
}

function readNodeSize(
  node: {
    width?: number
    height?: number
    style?: { width?: number | string; height?: number | string }
  },
  layout?: FrameLayoutCache[string]
): { width: number; height: number } {
  const rawW = node.width ?? node.style?.width ?? layout?.width ?? 220
  const rawH = node.height ?? node.style?.height ?? layout?.height ?? 72
  const width = typeof rawW === 'number' ? rawW : parseFloat(String(rawW)) || 220
  const height = typeof rawH === 'number' ? rawH : parseFloat(String(rawH)) || 72
  return { width, height }
}

/** Which chatPanel ids should mount TipTap for the current viewport (with hysteresis). */
export function computeNearViewportFrameIds(
  nodes: Array<{
    id: string
    type?: string
    position: { x: number; y: number }
    positionAbsolute?: { x: number; y: number }
    width?: number
    height?: number
    style?: { width?: number | string; height?: number | string }
  }>,
  prevMounted: Set<string>,
  vp: { x: number; y: number; zoom: number },
  paneW: number,
  paneH: number,
  rotDeg: number,
  layout: FrameLayoutCache
): Set<string> {
  const next = new Set<string>()
  if (paneW <= 0 || paneH <= 0) return next
  for (const node of nodes) {
    if (node.type !== 'chatPanel') continue
    const wasMounted = prevMounted.has(node.id)
    const buffer = wasMounted ? FRAME_MOUNT_BUFFER_OUT_PX : FRAME_MOUNT_BUFFER_IN_PX
    const size = readNodeSize(node, layout[node.id])
    const pos = node.positionAbsolute ?? node.position
    const bounds = frameMountBoundsInPane(pos, size, vp, rotDeg)
    if (intersectsPaneWithBuffer(bounds, paneW, paneH, buffer)) {
      next.add(node.id)
    }
  }
  return next
}
