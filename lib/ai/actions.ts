// Action types for Edit/Plan — Ask mode writes none; edit-past-chat will undo via inverse
export type AiActionStatus = 'pending' | 'applied' | 'undone' | 'error' // Matches ai_action_log.status

export type AiActionKind = // Known mutation kinds (grow over time)
  | 'create_frame' // Place a frame on the page
  | 'update_frame' // Change frame content/metadata
  | 'delete_frame' // Remove a frame
  | 'create_thread' // Create a panel_edges thread between frames
  | 'noop' // Placeholder / dry-run

export interface AiAction { // Serializable intent stored in ai_action_log
  kind: AiActionKind // What to do
  payload: Record<string, unknown> // Forward args
  inverse: Record<string, unknown> // Undo args
}

/** Apply is a no-op stub — Edit mode applies via edit-session (pending review). */
export async function applyAiAction(_action: AiAction): Promise<{ ok: boolean; error?: string }> {
  return { ok: true } // Call sites that need real apply use edit-session instead
}

/** Inverse apply — used when editing a past chat rewinds page mutations. */
export async function undoAiAction(_action: AiAction): Promise<{ ok: boolean; error?: string }> {
  return { ok: true } // Stub until Edit mode writes real inverses
}
