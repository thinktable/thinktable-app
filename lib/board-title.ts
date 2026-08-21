// Shared default name for a new Thinktable board (nav +, empty `/board`, untitled fallback).

export const DEFAULT_BOARD_TITLE = 'New board' // Product default — not the app name, not Untitled

/** Saved / displayed board name — blank becomes New board. */
export function boardTitleOrDefault(title?: string | null): string {
  const next = typeof title === 'string' ? title.trim() : '' // Ignore whitespace-only names
  return next || DEFAULT_BOARD_TITLE // Same label as the empty `/board` header
}
