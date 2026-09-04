// Frame select vs text edit: Delete removes the frame until the user places a caret.

let textEditFrameId: string | null = null // Host RF node id while TipTap owns Backspace/Delete

/** Mark that this frame has an intentional caret (second click / typing handoff). */
export function setFrameTextEditActive(frameId: string | null): void {
  textEditFrameId = frameId // Remember which frame is in text-edit mode
}

/** True when Delete/Backspace should edit TipTap text instead of removing the frame. */
export function isFrameTextEditActive(frameId?: string | null): boolean {
  if (!textEditFrameId) return false // No caret placed — frame Delete wins
  if (frameId) return textEditFrameId === frameId // Match this host only
  return true // Any frame is text-editing
}

/** Clear on frame select / deselect so first-select Delete removes the frame. */
export function clearFrameTextEditActive(): void {
  textEditFrameId = null // Back to select-before-caret
}
