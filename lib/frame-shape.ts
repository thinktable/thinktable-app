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
