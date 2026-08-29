// Infinite board camera limits + soft content AABB.
// Pan is already unbounded (RF default translateExtent = ±Infinity). These helpers only grow
// zoom min/max and a soft world rect used by fitView / minimap framing — never clamp pan.

export type BoardZoomRange = { minZoom: number; maxZoom: number }

export type SoftBoardBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Default zoom floor/ceiling: 5%–200%. */
export const BOARD_ZOOM_DEFAULT: BoardZoomRange = { minZoom: 0.05, maxZoom: 2 }

/** Absolute clamps — same as default; content-based expand cannot exceed this band. */
export const BOARD_ZOOM_HARD: BoardZoomRange = { minZoom: 0.05, maxZoom: 2 }

/** Clamp a zoom value to the board band (5%–200% by default). */
export function clampBoardZoom(
  zoom: number,
  hard: BoardZoomRange = BOARD_ZOOM_HARD
): number {
  return Math.min(hard.maxZoom, Math.max(hard.minZoom, zoom))
}

/** Extra pad (flow px) when content approaches the soft world edge. */
export const BOARD_BOUNDS_PAD_FLOW = 800

/** Grow the soft world when a frame sits within this many flow px of an edge. */
export const BOARD_BOUNDS_NEAR_EDGE_FLOW = 400

const ZOOM_EXPAND_EPS = 0.001 // Treat being this close to a zoom limit as “at the limit”

/** Seed soft bounds around the origin so an empty board still has a sensible fit region. */
export function emptySoftBounds(seed = 2000): SoftBoardBounds {
  return { minX: -seed, minY: -seed, maxX: seed, maxY: seed }
}

/** Union a frame (or any AABB) into soft bounds, expanding when it sits near an edge. */
export function expandSoftBounds(
  bounds: SoftBoardBounds,
  box: { x: number; y: number; width: number; height: number },
  pad = BOARD_BOUNDS_PAD_FLOW,
  near = BOARD_BOUNDS_NEAR_EDGE_FLOW
): SoftBoardBounds {
  const left = box.x
  const top = box.y
  const right = box.x + Math.max(1, box.width)
  const bottom = box.y + Math.max(1, box.height)
  let { minX, minY, maxX, maxY } = bounds
  if (left - near < minX) minX = left - pad
  if (top - near < minY) minY = top - pad
  if (right + near > maxX) maxX = right + pad
  if (bottom + near > maxY) maxY = bottom + pad
  // Always include the box itself even when far from edges (first content)
  minX = Math.min(minX, left - pad * 0.25)
  minY = Math.min(minY, top - pad * 0.25)
  maxX = Math.max(maxX, right + pad * 0.25)
  maxY = Math.max(maxY, bottom + pad * 0.25)
  return { minX, minY, maxX, maxY }
}

/** Rebuild soft bounds from every live node (startup / large imports). */
export function softBoundsFromNodes(
  nodes: Array<{
    position: { x: number; y: number }
    width?: number | null // RF types these as nullable; the typeof checks below handle null
    height?: number | null
    style?: { width?: number | string; height?: number | string }
    type?: string
  }>
): SoftBoardBounds {
  let next = emptySoftBounds()
  let any = false
  for (const n of nodes) {
    if (n.type === 'frameShimmer' || n.type === 'placeholder') continue
    const w =
      typeof n.width === 'number'
        ? n.width
        : typeof n.style?.width === 'number'
          ? n.style.width
          : parseFloat(String(n.style?.width ?? '')) || 220
    const h =
      typeof n.height === 'number'
        ? n.height
        : typeof n.style?.height === 'number'
          ? n.style.height
          : parseFloat(String(n.style?.height ?? '')) || 72
    next = expandSoftBounds(next, { x: n.position.x, y: n.position.y, width: w, height: h })
    any = true
  }
  return any ? next : emptySoftBounds()
}

/**
 * Grow zoom min/max so the user can keep zooming out/in after placing or resizing content.
 * - At (or past) the current floor while zooming out → lower minZoom
 * - At (or past) the current ceiling while zooming in → raise maxZoom
 * - Huge frames relative to the pane → lower min so fitView can frame them
 */
export function expandZoomRange(
  current: BoardZoomRange,
  opts: {
    liveZoom?: number
    paneW?: number
    paneH?: number
    contentW?: number
    contentH?: number
  } = {}
): BoardZoomRange {
  let minZoom = current.minZoom
  let maxZoom = current.maxZoom
  const { liveZoom, paneW, paneH, contentW, contentH } = opts

  if (liveZoom != null) {
    if (liveZoom <= minZoom + ZOOM_EXPAND_EPS) {
      minZoom = Math.max(BOARD_ZOOM_HARD.minZoom, minZoom * 0.7)
    }
    if (liveZoom >= maxZoom - ZOOM_EXPAND_EPS) {
      maxZoom = Math.min(BOARD_ZOOM_HARD.maxZoom, maxZoom * 1.35)
    }
  }

  if (
    paneW &&
    paneH &&
    contentW &&
    contentH &&
    paneW > 0 &&
    paneH > 0 &&
    contentW > 0 &&
    contentH > 0
  ) {
    // Zoom needed to fit this one item with ~20% padding
    const fit = Math.min((paneW * 0.8) / contentW, (paneH * 0.8) / contentH)
    if (fit < minZoom) minZoom = Math.max(BOARD_ZOOM_HARD.minZoom, fit * 0.85)
    // Tiny item → allow zooming in further so it can fill the pane
    const fill = Math.max(paneW / Math.max(contentW, 1), paneH / Math.max(contentH, 1))
    if (fill > maxZoom) maxZoom = Math.min(BOARD_ZOOM_HARD.maxZoom, Math.max(fill * 0.5, maxZoom))
  }

  if (minZoom > maxZoom) {
    const mid = (minZoom + maxZoom) / 2
    minZoom = Math.min(minZoom, mid)
    maxZoom = Math.max(maxZoom, mid)
  }
  return { minZoom, maxZoom }
}

/** Same range? Avoid needless ReactFlow prop churn. */
export function zoomRangesEqual(a: BoardZoomRange, b: BoardZoomRange): boolean {
  return Math.abs(a.minZoom - b.minZoom) < 1e-6 && Math.abs(a.maxZoom - b.maxZoom) < 1e-6
}

export function softBoundsEqual(a: SoftBoardBounds, b: SoftBoardBounds): boolean {
  return a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY
}
