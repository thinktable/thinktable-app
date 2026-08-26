// Uniform-grid spatial index over board frames — viewport queries for TipTap mount
// and (later) RF node windowing. Rebuild on settle, not every pointer tick.

export type SpatialEntry = {
  id: string
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type SpatialIndex = {
  cellSize: number
  cells: Map<string, string[]> // "cx,cy" → ids overlapping that cell
  byId: Map<string, SpatialEntry>
}

const DEFAULT_CELL = 512 // Flow px — ~2–3 medium frames per cell

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`
}

function cellsForBox(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  cellSize: number
): Array<[number, number]> {
  const x0 = Math.floor(minX / cellSize)
  const y0 = Math.floor(minY / cellSize)
  const x1 = Math.floor(maxX / cellSize)
  const y1 = Math.floor(maxY / cellSize)
  const out: Array<[number, number]> = []
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) out.push([cx, cy])
  }
  return out
}

/** Build a fresh index from frame AABBs (absolute flow coords). */
export function buildSpatialIndex(
  entries: SpatialEntry[],
  cellSize = DEFAULT_CELL
): SpatialIndex {
  const cells = new Map<string, string[]>()
  const byId = new Map<string, SpatialEntry>()
  for (const e of entries) {
    byId.set(e.id, e)
    for (const [cx, cy] of cellsForBox(e.minX, e.minY, e.maxX, e.maxY, cellSize)) {
      const k = cellKey(cx, cy)
      const list = cells.get(k)
      if (list) list.push(e.id)
      else cells.set(k, [e.id])
    }
  }
  return { cellSize, cells, byId }
}

/** Ids whose AABB intersects the query rect (with optional pad). */
export function querySpatialIndex(
  index: SpatialIndex,
  rect: { minX: number; minY: number; maxX: number; maxY: number },
  pad = 0
): Set<string> {
  const minX = rect.minX - pad
  const minY = rect.minY - pad
  const maxX = rect.maxX + pad
  const maxY = rect.maxY + pad
  const hit = new Set<string>()
  for (const [cx, cy] of cellsForBox(minX, minY, maxX, maxY, index.cellSize)) {
    const list = index.cells.get(cellKey(cx, cy))
    if (!list) continue
    for (const id of list) {
      if (hit.has(id)) continue
      const e = index.byId.get(id)
      if (!e) continue
      if (e.maxX < minX || e.minX > maxX || e.maxY < minY || e.minY > maxY) continue
      hit.add(id)
    }
  }
  return hit
}

/**
 * Flow-space viewport rect from RF transform + pane size.
 * Visible flow AABB: x in [-tx/z, (w-tx)/z], y in [-ty/z, (h-ty)/z]
 */
export function flowViewportRect(
  vp: { x: number; y: number; zoom: number },
  paneW: number,
  paneH: number
): { minX: number; minY: number; maxX: number; maxY: number } {
  const z = Math.max(0.0001, vp.zoom)
  return {
    minX: -vp.x / z,
    minY: -vp.y / z,
    maxX: (paneW - vp.x) / z,
    maxY: (paneH - vp.y) / z,
  }
}

/**
 * Prefetch pad in flow px so TipTap mounts before a frame enters the pane.
 * Grows as zoom drops (more world visible per screen px).
 */
export function mountPadFlowPx(zoom: number): number {
  const z = Math.max(0.05, zoom)
  // ~520 screen-px at z=1; scales so low zoom prefetches more world
  return 520 / z
}

/** Node count above which RF should window by viewport (keep selected/connected). */
export const BOARD_VIEWPORT_WINDOW_MIN = 48
