// Bridge selected page frames + viewport from BoardFlow → AI sidebar without a heavy context rewrite
let selectedFrameIds: string[] = [] // Module-level selection snapshot
let viewportCenter = { x: 0, y: 0 } // Flow-space center of the visible page

/** Called from BoardFlow when RF selection changes (chatPanel message ids). */
export function setAiSelectedFrameIds(ids: string[]): void {
  selectedFrameIds = ids.slice() // Copy so callers can't mutate
}

/** Read by AiComposer when building the Ask/Edit request body. */
export function getAiSelectedFrameIds(): string[] {
  return selectedFrameIds.slice() // Defensive copy
}

/** Called from BoardFlow on pan/zoom so Edit can place new frames in view. */
export function setAiViewportCenter(center: { x: number; y: number }): void {
  viewportCenter = { x: center.x, y: center.y }
}

/** Read by AiComposer when sending Edit creates. */
export function getAiViewportCenter(): { x: number; y: number } {
  return { x: viewportCenter.x, y: viewportCenter.y }
}
