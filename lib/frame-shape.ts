// Frame-as-shape helpers — a frame can wear a silhouette (circle, diamond, …)
// without becoming a separate RF `shape` node. Pages still own deep hierarchy;
// shape is on-page composition. See CONTEXT.md + DEFINITIONS.md.

import { ShapeComponents, type ShapeType } from '@/components/shapes/types' // Shared silhouette registry

/** All silhouettes a frame (or nested frame) may wear. */
export type FrameShapeType = ShapeType

/** Menu / search: “no silhouette” — current transparent text frame. */
export const FRAME_SHAPE_NONE = 'none' as const

/** Shape picker value: none or a registered silhouette. */
export type FrameShapeChoice = typeof FRAME_SHAPE_NONE | FrameShapeType

/** Ordered list for the frame-menu shape grid (matches Draw toolbar shapes). */
export const FRAME_SHAPE_TYPES: FrameShapeType[] = Object.keys(
  ShapeComponents
) as FrameShapeType[]

/** Human label for a shape choice (menu titles / a11y). */
export function frameShapeLabel(choice: FrameShapeChoice): string {
  if (choice === FRAME_SHAPE_NONE) return 'Default' // No SVG silhouette
  return choice.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) // Title-case kebab ids
}

/** True when `value` is a registered silhouette id. */
export function isFrameShapeType(value: unknown): value is FrameShapeType {
  return typeof value === 'string' && value in ShapeComponents // Registry membership
}

/** Parse metadata / attrs into a silhouette, or null when unset / default. */
export function parseFrameShape(value: unknown): FrameShapeType | null {
  if (value == null || value === '' || value === FRAME_SHAPE_NONE) return null // Default frame
  return isFrameShapeType(value) ? value : null // Ignore unknown legacy strings
}

/** Default box when applying a silhouette so the outline is readable. */
export const FRAME_SHAPE_DEFAULT_SIZE = { width: 180, height: 140 } as const

/** Minimum box while a silhouette is active (still free-resizeable). */
export const FRAME_SHAPE_MIN_SIZE = { width: 72, height: 56 } as const

/** Axis-aligned box of a w×h rectangle rotated by `deg` (around center). */
export function rotatedRectAabbSize(
  w: number,
  h: number,
  deg: number
): { width: number; height: number } {
  const rad = (deg * Math.PI) / 180
  const c = Math.abs(Math.cos(rad))
  const s = Math.abs(Math.sin(rad))
  return { width: w * c + h * s, height: w * s + h * c }
}

/** Tight AABB of an ellipse filling w×h, rotated by `deg`. */
function rotatedEllipseAabbSize(
  w: number,
  h: number,
  deg: number
): { width: number; height: number } {
  const rad = (deg * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const a = Math.max(1, w) / 2
  const b = Math.max(1, h) / 2
  // Extents of rotated ellipse: 2√(a²cos²θ + b²sin²θ), 2√(a²sin²θ + b²cos²θ)
  return {
    width: 2 * Math.sqrt(a * a * c * c + b * b * s * s),
    height: 2 * Math.sqrt(a * a * s * s + b * b * c * c),
  }
}

/** AABB of polygon vertices (centered at origin) after rotation. */
function aabbOfRotatedPoints(
  points: Array<{ x: number; y: number }>,
  deg: number
): { width: number; height: number } {
  const rad = (deg * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of points) {
    const x = p.x * c - p.y * s
    const y = p.x * s + p.y * c
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
}

/** Unit-box polygon for a silhouette (0..1), converted to centered px via w/h. */
function shapeUnitPoints(type: FrameShapeType): Array<{ x: number; y: number }> | null {
  // Coordinates in 0..1 box (top-left origin), matching frameShapeClipCss polygons
  switch (type) {
    case 'diamond':
      return [
        { x: 0.5, y: 0 },
        { x: 1, y: 0.5 },
        { x: 0.5, y: 1 },
        { x: 0, y: 0.5 },
      ]
    case 'triangle':
      return [
        { x: 0.5, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ]
    case 'hexagon':
      return [
        { x: 0.1, y: 0 },
        { x: 0.9, y: 0 },
        { x: 1, y: 0.5 },
        { x: 0.9, y: 1 },
        { x: 0.1, y: 1 },
        { x: 0, y: 0.5 },
      ]
    case 'parallelogram':
      return [
        { x: 0.25, y: 0 },
        { x: 1, y: 0 },
        { x: 0.75, y: 1 },
        { x: 0, y: 1 },
      ]
    case 'arrow-rectangle':
      return [
        { x: 0, y: 0 },
        { x: 0.9, y: 0 },
        { x: 1, y: 0.5 },
        { x: 0.9, y: 1 },
        { x: 0, y: 1 },
      ]
    case 'plus':
      return [
        { x: 0.33, y: 0 },
        { x: 0.67, y: 0 },
        { x: 0.67, y: 0.33 },
        { x: 1, y: 0.33 },
        { x: 1, y: 0.67 },
        { x: 0.67, y: 0.67 },
        { x: 0.67, y: 1 },
        { x: 0.33, y: 1 },
        { x: 0.33, y: 0.67 },
        { x: 0, y: 0.67 },
        { x: 0, y: 0.33 },
        { x: 0.33, y: 0.33 },
      ]
    default:
      return null
  }
}

/**
 * Upright AABB that tightly fits the visible silhouette after rotation.
 * Ellipse / circle / polygon shapes are tighter than the content rectangle;
 * default / round-rect fall back to the rectangle AABB.
 */
export function rotatedFrameAabbSize(
  w: number,
  h: number,
  deg: number,
  shape?: FrameShapeType | null
): { width: number; height: number } {
  if (!shape || Math.abs(deg) < 0.5) {
    return rotatedRectAabbSize(w, h, deg)
  }
  if (shape === 'circle') {
    return rotatedEllipseAabbSize(w, h, deg)
  }
  if (shape === 'cylinder') {
    // Soft stadium-like clip — ellipse is a close upright bound
    return rotatedEllipseAabbSize(w, h, deg)
  }
  const unit = shapeUnitPoints(shape)
  if (unit) {
    const pts = unit.map((p) => ({
      x: (p.x - 0.5) * w,
      y: (p.y - 0.5) * h,
    }))
    return aabbOfRotatedPoints(pts, deg)
  }
  // rectangle / round-rectangle / unknown — content box corners
  return rotatedRectAabbSize(w, h, deg)
}

/**
 * CSS `clip-path` so TipTap content stays inside the silhouette.
 * Returns undefined when clipping isn’t needed (default / hard-to-express shapes).
 */
export function frameShapeClipCss(type: FrameShapeType): string | undefined {
  switch (type) {
    case 'rectangle':
      return undefined // AABB already matches
    case 'round-rectangle':
      return 'inset(0 round 12px)' // Matches Shape round-rect radius floor
    case 'circle':
      return 'ellipse(50% 50% at 50% 50%)' // Stretch ellipse to the frame box
    case 'diamond':
      return 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)'
    case 'triangle':
      return 'polygon(50% 0%, 100% 100%, 0% 100%)'
    case 'hexagon':
      return 'polygon(10% 0%, 90% 0%, 100% 50%, 90% 100%, 10% 100%, 0% 50%)'
    case 'parallelogram':
      return 'polygon(25% 0%, 100% 0%, 75% 100%, 0% 100%)'
    case 'arrow-rectangle':
      return 'polygon(0% 0%, 90% 0%, 100% 50%, 90% 100%, 0% 100%)'
    case 'plus':
      return 'polygon(33% 0%, 67% 0%, 67% 33%, 100% 33%, 100% 67%, 67% 67%, 67% 100%, 33% 100%, 33% 67%, 0% 67%, 0% 33%, 33% 33%)'
    case 'cylinder':
      // Cylinder arcs don’t map cleanly to CSS polygon — soft clip via rounded inset
      return 'inset(8% 0 round 40%)'
    default:
      return undefined
  }
}
