// Whether any frame on a board has pending Notion → Thinktable updates.

import type { QueryClient } from '@tanstack/react-query'

type MessageLike = {
  id?: string
  metadata?: Record<string, unknown> | null
}

/** True when any message metadata has notionUpdatesPending. */
export function boardHasPendingConnectionUpdates(messages: MessageLike[] | undefined | null): boolean {
  if (!messages?.length) return false
  return messages.some((m) => {
    const meta = (m.metadata as Record<string, unknown> | null) || {}
    return meta.notionUpdatesPending === true
  })
}

/** Optimistic metadata patch so the top-bar sync icon updates without refetch. */
export function patchBoardMessageMetadata(
  queryClient: QueryClient,
  conversationId: string,
  messageId: string,
  patch: Record<string, unknown>
): void {
  const upd = (list: unknown) => {
    if (!Array.isArray(list)) return list
    return list.map((m) => {
      const row = m as MessageLike
      if (row?.id !== messageId) return m
      return { ...row, metadata: { ...(row.metadata || {}), ...patch } }
    })
  }
  queryClient.setQueriesData({ queryKey: ['messages-for-panels', conversationId] }, upd)
  queryClient.setQueriesData({ queryKey: ['messages-for-panels', conversationId, 'full'] }, upd)
  queryClient.setQueriesData({ queryKey: ['messages-for-panels', conversationId, 'embed'] }, upd)
}
