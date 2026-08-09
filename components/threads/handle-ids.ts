/** Outer blue-dot handle ids that only start a thread drag (not edge geometry). */
export const INDICATOR_SUFFIX = '-indicator'

/** Distance (px) indicators sit outside the adjust-frame edge. */
export const INDICATOR_OUTSET = 14

/** True when this handle id is a connection indicator (outer dot), not an edge anchor. */
export function isConnectionIndicatorId(handleId: string | null | undefined): boolean {
  return Boolean(handleId && handleId.endsWith(INDICATOR_SUFFIX))
}

/** Map `left-indicator` → `left` so settled threads attach to the frame-edge connection point. */
export function normalizeHandleId(handleId: string | null | undefined): string | null {
  if (!handleId) return null
  return handleId.endsWith(INDICATOR_SUFFIX)
    ? handleId.slice(0, -INDICATOR_SUFFIX.length)
    : handleId
}

/** Build the indicator handle id for a side. */
export function indicatorHandleId(side: 'left' | 'right' | 'top' | 'bottom'): string {
  return `${side}${INDICATOR_SUFFIX}`
}
