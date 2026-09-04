'use client'

// Transcript of AI turns — each turn is a frame-like box (select → blue adjust + threads)

import { useCallback, useEffect } from 'react'
import type { AiMessage } from '@/lib/ai/types'
import type { AiChatBoardLink } from '@/lib/ai/chat-board-links'
import {
  clearChatTurnSelected,
  setChatTurnSelected,
  useChatTurnSelected,
} from '@/lib/ai/chat-turn-selected'
import { AiChatTurn } from '@/components/ai/ai-chat-turn'

interface AiTranscriptProps {
  messages: AiMessage[] // Turns
  threadId?: string | null // Active thread — keys module selection across remounts
  streamingId?: string | null // Assistant id currently streaming
  conversationId?: string // Board id for ⋮⋮ → frame drops
  onEditUserMessage: (messageId: string, content: string) => Promise<void> // Legacy regenerate path (unused by TipTap soft-save)
  onMessagePatch?: (messageId: string, message: AiMessage) => void // Optimistic local merge after soft-save
}

export function AiTranscript({
  messages,
  threadId,
  streamingId,
  conversationId,
  onMessagePatch,
}: AiTranscriptProps) {
  // Module store — phone dock ↔ desktop column remounts keep the same pick
  const selectedId = useChatTurnSelected(threadId)

  // Stale pick (truncated / other chat) → clear so chrome does not orphan
  useEffect(() => {
    if (!selectedId) return
    if (messages.some((m) => m.id === selectedId)) return
    clearChatTurnSelected(threadId)
  }, [messages, selectedId, threadId])

  // Click outside any turn → deselect (board chat-link cues select a turn themselves)
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const t = event.target as HTMLElement
      if (t.closest('[data-ai-turn]')) return
      if (t.closest('.block-actions-menu')) return
      if (t.closest('[data-tt-chat-link-cue]')) return // Cue opens/selects — don't clear first
      clearChatTurnSelected(threadId)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [threadId])

  const onSelect = useCallback(
    (id: string) => {
      if (!threadId) return // No thread yet — ignore
      setChatTurnSelected(threadId, id)
    },
    [threadId]
  )

  const softSave = useCallback(
    async (
      messageId: string,
      patch: { content: string; html: string; metadata?: Record<string, unknown> }
    ) => {
      const res = await fetch(`/api/ai/messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...patch, soft: true }),
      })
      if (!res.ok) {
        console.error('Soft-save failed', await res.text())
        return
      }
      const data = await res.json()
      if (data.message && onMessagePatch) onMessagePatch(messageId, data.message as AiMessage)
    },
    [onMessagePatch]
  )

  const onLinksChange = useCallback(
    (messageId: string, links: AiChatBoardLink[]) => {
      const m = messages.find((x) => x.id === messageId)
      if (!m || !onMessagePatch) return
      onMessagePatch(messageId, {
        ...m,
        metadata: { ...(m.metadata || {}), boardLinks: links },
      })
    },
    [messages, onMessagePatch]
  )

  if (messages.length === 0) return null

  return (
    <div className="flex flex-col gap-3 w-full max-w-[320px] mx-auto">
      {messages.map((m) => (
        <AiChatTurn
          key={m.id}
          message={m}
          selected={selectedId === m.id}
          streaming={m.id === streamingId || m.status === 'streaming'}
          conversationId={conversationId}
          onSelect={onSelect}
          onSoftSave={softSave}
          onLinksChange={onLinksChange}
        />
      ))}
    </div>
  )
}
