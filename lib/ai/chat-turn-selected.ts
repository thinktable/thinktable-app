// Selected AI transcript turn(s) — survives phone dock ↔ desktop sidebar remounts.
// Multi-select matches board frames: Shift / Cmd / Ctrl click adds; plain click exclusives.

import { useSyncExternalStore } from 'react'

type ChatTurnSelection = {
  threadId: string // Active ai_threads id
  messageIds: string[] // Selected ai_messages ids (order = selection order)
  anchorId: string // Last clicked — scroll target + primary chrome
}

let selection: ChatTurnSelection | null = null // Module store (not React tree)
const listeners = new Set<() => void>() // External-store subscribers

function notify(): void {
  listeners.forEach((l) => l()) // Wake useSyncExternalStore
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Current selection, or null when nothing is selected. */
export function getChatTurnSelected(): ChatTurnSelection | null {
  return selection
}

/**
 * Replace selection with a single turn (or clear with null messageId).
 * Used by board chat-link cues / open-chat-turn.
 */
export function setChatTurnSelected(
  threadId: string | null | undefined,
  messageId: string | null | undefined
): void {
  const next =
    threadId && messageId
      ? { threadId, messageIds: [messageId], anchorId: messageId }
      : null
  const same =
    (selection === null && next === null) ||
    (selection !== null &&
      next !== null &&
      selection.threadId === next.threadId &&
      selection.anchorId === next.anchorId &&
      sameIds(selection.messageIds, next.messageIds))
  if (same) return // No-op — avoid notify churn
  selection = next
  notify()
}

/**
 * Select a turn — plain click exclusives; additive (Shift/Cmd/Ctrl) keeps others.
 * Matches board-flow onNodeClick multi-select.
 */
export function selectChatTurn(
  threadId: string | null | undefined,
  messageId: string | null | undefined,
  opts?: { additive?: boolean }
): void {
  if (!threadId || !messageId) {
    setChatTurnSelected(null, null)
    return
  }
  const additive = !!opts?.additive
  if (!additive || !selection || selection.threadId !== threadId) {
    setChatTurnSelected(threadId, messageId) // Exclusive (or first pick)
    return
  }
  // Additive: ensure clicked id is selected; keep existing picks; bump anchor
  const ids = selection.messageIds.includes(messageId)
    ? selection.messageIds
    : [...selection.messageIds, messageId]
  const next: ChatTurnSelection = {
    threadId,
    messageIds: ids,
    anchorId: messageId,
  }
  if (
    selection.anchorId === next.anchorId &&
    sameIds(selection.messageIds, next.messageIds)
  ) {
    return
  }
  selection = next
  notify()
}

/** Drop selection when leaving a thread or starting New chat. */
export function clearChatTurnSelected(threadId?: string | null): void {
  if (!selection) return
  if (threadId && selection.threadId !== threadId) return // Other thread's pick
  selection = null
  notify()
}

/** Drop stale ids after truncate / regenerate; clear entirely if none remain. */
export function pruneChatTurnSelected(
  threadId: string | null | undefined,
  validIds: Set<string>
): void {
  if (!selection || !threadId || selection.threadId !== threadId) return
  const kept = selection.messageIds.filter((id) => validIds.has(id))
  if (kept.length === 0) {
    selection = null
    notify()
    return
  }
  if (sameIds(kept, selection.messageIds) && validIds.has(selection.anchorId)) return
  const anchorId = validIds.has(selection.anchorId)
    ? selection.anchorId
    : kept[kept.length - 1]!
  selection = { threadId, messageIds: kept, anchorId }
  notify()
}

export function subscribeChatTurnSelected(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** React hook — selected message ids for this thread (empty if other thread / none). */
export function useChatTurnSelectedIds(
  threadId: string | null | undefined
): string[] {
  return useSyncExternalStore(
    subscribeChatTurnSelected,
    () =>
      selection && threadId && selection.threadId === threadId
        ? selection.messageIds
        : EMPTY_IDS,
    () => EMPTY_IDS // SSR — nothing selected
  )
}

/** React hook — last-clicked / scroll-target id for this thread. */
export function useChatTurnSelectedAnchor(
  threadId: string | null | undefined
): string | null {
  return useSyncExternalStore(
    subscribeChatTurnSelected,
    () =>
      selection && threadId && selection.threadId === threadId
        ? selection.anchorId
        : null,
    () => null
  )
}

/** @deprecated Prefer useChatTurnSelectedIds — returns anchor for one-id callers. */
export function useChatTurnSelected(
  threadId: string | null | undefined
): string | null {
  return useChatTurnSelectedAnchor(threadId)
}

const EMPTY_IDS: string[] = [] // Stable empty for useSyncExternalStore equality
