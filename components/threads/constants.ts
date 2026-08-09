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
