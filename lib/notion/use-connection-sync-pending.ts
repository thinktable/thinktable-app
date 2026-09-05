'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { boardHasPendingConnectionUpdates } from './connection-sync-pending'

type PanelMessage = {
  id: string
  metadata?: Record<string, unknown> | null
}

/** Live pending-sync flag for the current board (messages-for-panels cache). */
export function useConnectionSyncPending(conversationId: string | undefined): boolean {
  const { data: messages } = useQuery<PanelMessage[]>({
    queryKey: ['messages-for-panels', conversationId],
    enabled: !!conversationId,
  })

  return useMemo(() => boardHasPendingConnectionUpdates(messages), [messages])
}
