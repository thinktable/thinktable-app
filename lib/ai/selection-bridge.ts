// Bridge selected page frames from BoardFlow → AI sidebar without a heavy context rewrite
let selectedFrameIds: string[] = [] // Module-level selection snapshot

/** Called from BoardFlow when RF selection changes (chatPanel message ids). */
export function setAiSelectedFrameIds(ids: string[]): void {
  selectedFrameIds = ids.slice() // Copy so callers can't mutate
}

/** Read by AiComposer when building the Ask request body. */
export function getAiSelectedFrameIds(): string[] {
  return selectedFrameIds.slice() // Defensive copy
}
