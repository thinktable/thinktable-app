/** Thread path algorithm — Miro-like smooth curves use BezierCatmullRom. */
export enum ThreadAlgorithm {
  BezierCatmullRom = 'Bezier Catmull-Rom', // Smooth path through control points (default)
  CatmullRom = 'Catmull-Rom', // Pure Catmull-Rom (no end-side bezier bias)
  Orthogonal = 'Orthogonal', // Sharp: ridged path with rounded 90° elbows
  Linear = 'Linear', // Straight segments through points
}

/** Default stroke for selected / editing threads (Miro blue). */
export const THREAD_SELECTED_COLOR = '#0375ff'

/** Default stroke for idle threads. */
export const THREAD_DEFAULT_COLOR = '#6b7280' // gray-500

/** localStorage key for the Style-bar Thread color board default. */
export const THREAD_STROKE_COLOR_KEY = 'thinktable-thread-stroke-color'

/** Notion-style stroke swatches for the Thread style color picker (empty = default gray). */
export const THREAD_COLOR_SWATCHES = [
  { id: 'default', name: 'Default', value: '' },
  { id: 'gray', name: 'Gray', value: '#787774' },
  { id: 'brown', name: 'Brown', value: '#9F6B53' },
  { id: 'orange', name: 'Orange', value: '#D9730D' },
  { id: 'yellow', name: 'Yellow', value: '#CB912F' },
  { id: 'green', name: 'Green', value: '#448361' },
  { id: 'blue', name: 'Blue', value: '#337EA9' },
  { id: 'purple', name: 'Purple', value: '#9065B0' },
  { id: 'pink', name: 'Pink', value: '#C14C8A' },
  { id: 'red', name: 'Red', value: '#E03E3E' },
] as const

/** Normalize a stored / picker stroke to a paint hex (empty → default gray). */
export function resolveThreadStrokeColor(color?: string | null): string {
  const t = (color || '').trim()
  return t || THREAD_DEFAULT_COLOR
}

/** Default thread thickness in flow px (menu 1–4px options). */
export const THREAD_DEFAULT_STROKE_WIDTH = 2

/** Algorithm used for new threads. */
export const DEFAULT_THREAD_ALGORITHM: ThreadAlgorithm = ThreadAlgorithm.BezierCatmullRom

/** Toolbar thread style prefs (localStorage `thinktable-horizontal-line-style`). */
export type ThreadStylePref = 'curved' | 'boxed' | 'linear'

/** Map toolbar Smooth / Sharp / Linear → path algorithm. */
export function threadAlgorithmFromStyle(
  style: ThreadStylePref | string | null | undefined
): ThreadAlgorithm {
  if (style === 'boxed') return ThreadAlgorithm.Orthogonal // Sharp = 90° ridged
  if (style === 'linear') return ThreadAlgorithm.Linear // Straight
  return ThreadAlgorithm.BezierCatmullRom // Smooth (default / curved)
}

/** Map path algorithm → toolbar radio value. */
export function threadStyleFromAlgorithm(
  algorithm: ThreadAlgorithm | undefined
): 'smooth' | 'sharp' | 'linear' {
  if (algorithm === ThreadAlgorithm.Orthogonal) return 'sharp'
  if (algorithm === ThreadAlgorithm.Linear) return 'linear'
  return 'smooth'
}

/** True when the thread uses ridged 90° (Sharp) routing. */
export function isSharpThreadAlgorithm(
  algorithm: ThreadAlgorithm | undefined
): boolean {
  return algorithm === ThreadAlgorithm.Orthogonal
}

/**
 * Flow-space multiplier for stroke / knobs (same comfort as ⋮⋮ grips).
 * Zoomed out → 1 (rides with content, thins on screen). Zoomed in → 1/√zoom
 * (screen size grows only ∝ √zoom). Avoids fat threads when the page is zoomed out.
 */
export function threadComfortScale(zoom: number): number {
  const z = Math.max(0.01, zoom) // Guard against 0 / negative store values
  return 1 / Math.max(1, Math.sqrt(z)) // max(1,√z) → no counter-scale below 100%
}

/** Base boost so frame chrome (handles / ⋮⋮ gutter / rotate) reads at a usable screen size. */
export const FRAME_SCREEN_CHROME_BOOST = 1.4

/**
 * Screen-relative scale for frame selection chrome (resize dots, indicators, gutters,
 * property/conn bands, rotate/free/wrap, ⋮⋮). Softer than thread √ comfort + boost —
 * pure 1× thread comfort felt too small on the board.
 */
export function frameScreenChromeScale(zoom: number): number {
  const z = Math.max(0.01, zoom) // Guard against 0 / negative store values
  const comfort = 1 / Math.max(1, Math.pow(z, 0.35)) // Milder than √ so zoom-in does not crush chrome
  return comfort * FRAME_SCREEN_CHROME_BOOST
}
