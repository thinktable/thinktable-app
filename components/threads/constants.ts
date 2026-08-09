/** Thread path algorithm — Miro-like smooth curves use BezierCatmullRom. */
export enum ThreadAlgorithm {
  BezierCatmullRom = 'Bezier Catmull-Rom', // Smooth path through control points (default)
  CatmullRom = 'Catmull-Rom', // Pure Catmull-Rom (no end-side bezier bias)
  Linear = 'Linear', // Straight segments through points
}

/** Default stroke for selected / editing threads (Miro blue). */
export const THREAD_SELECTED_COLOR = '#0375ff'

/** Default stroke for idle threads. */
export const THREAD_DEFAULT_COLOR = '#6b7280' // gray-500

/** Algorithm used for new threads. */
export const DEFAULT_THREAD_ALGORITHM: ThreadAlgorithm = ThreadAlgorithm.BezierCatmullRom
