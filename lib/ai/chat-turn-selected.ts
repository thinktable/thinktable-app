// Selected AI transcript turn — survives phone dock ↔ desktop sidebar remounts.

import { useSyncExternalStore } from 'react'

type ChatTurnSelection = {
  threadId: string // Active ai_threads id
  messageId: string // Selected ai_messages id
}

let selection: ChatTurnSelection | null = null // Module store (not React tree)
const listeners = new Set<() => void>() // External-store subscribers

function notify(): void {
  listeners.forEach((l) => l()) // Wake useSyncExternalStore
}

/** Current selection, or null when nothing is selected. */
export function getChatTurnSelected(): ChatTurnSelection | null {
  return selection
}

/** Select a turn in a thread (or clear with null messageId). */
export function setChatTurnSelected(
  threadId: string | null | undefined,
  messageId: string | null | undefined
): void {
  const next =
    threadId && messageId ? { threadId, messageId } : null // Both required to arm
  const same =
    (selection === null && next === null) ||
    (selection !== null &&
      next !== null &&
      selection.threadId === next.threadId &&
      selection.messageId === next.messageId)
  if (same) return // No-op — avoid notify churn
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

export function subscribeChatTurnSelected(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** React hook — selected message id for this thread (null if other thread / none). */
export function useChatTurnSelected(threadId: string | null | undefined): string | null {
  return useSyncExternalStore(
    subscribeChatTurnSelected,
    () =>
      selection && threadId && selection.threadId === threadId
        ? selection.messageId
        : null,
    () => null // SSR — nothing selected
  )
}
