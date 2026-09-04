'use client'

// Transcript of AI turns — each turn is a frame-like box (select → blue adjust + threads)

import { useCallback, useEffect, useMemo } from 'react'
import type { AiMessage, AiChatBlockDragItem } from '@/lib/ai/types'
import { markdownToTipTapHtml } from '@/lib/ai/markdown-to-tiptap'
import type { AiChatBoardLink } from '@/lib/ai/chat-board-links'
import { isChatToChatLink, readChatBoardLinks } from '@/lib/ai/chat-board-links'
import {
  clearChatTurnSelected,
  pruneChatTurnSelected,
  selectChatTurn,
  useChatTurnSelectedIds,
} from '@/lib/ai/chat-turn-selected'
import { AiChatTurn } from '@/components/ai/ai-chat-turn'

interface AiTranscriptProps {
  messages: AiMessage[] // Turns
  threadId?: string | null // Active thread — keys module selection across remounts
  streamingId?: string | null // Assistant id currently streaming
  conversationId?: string // Board id for ⋮⋮ → frame drops
  onEditUserMessage: (messageId: string, content: string) => Promise<void> // Resend prompt / edit-and-regen
  onRegenerateResponse?: (assistantMessageId: string) => Promise<void> // Re-run from preceding prompt
  onMessagePatch?: (messageId: string, message: AiMessage) => void // Optimistic local merge after soft-save
}

export function AiTranscript({
  messages,
  threadId,
  streamingId,
  conversationId,
  onEditUserMessage,
  onRegenerateResponse,
  onMessagePatch,
}: AiTranscriptProps) {
  // Module store — phone dock ↔ desktop column remounts keep the same picks
  const selectedIds = useChatTurnSelectedIds(threadId)
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  // Inbound chat↔chat links keyed by target turn (sources store the link)
  const inboundByTarget = useMemo(() => {
    const map = new Map<string, Array<{ sourceId: string; link: AiChatBoardLink }>>()
    for (const m of messages) {
      for (const link of readChatBoardLinks(m.metadata)) {
        if (!isChatToChatLink(link) || !link.targetTurnId) continue
        const list = map.get(link.targetTurnId) || []
        list.push({ sourceId: m.id, link })
        map.set(link.targetTurnId, list)
      }
    }
    return map
  }, [messages])

  // Which turns show the linked brand grip (outbound or inbound)
  const linkedTurnIds = useMemo(() => {
    const ids = new Set<string>()
    for (const m of messages) {
      const links = readChatBoardLinks(m.metadata)
      if (links.length === 0) continue
      ids.add(m.id)
      for (const l of links) {
        if (l.targetTurnId) ids.add(l.targetTurnId)
      }
    }
    return ids
  }, [messages])

  // Stale picks (truncate / other chat) → prune so chrome does not orphan
  useEffect(() => {
    if (selectedIds.length === 0) return
    const valid = new Set(messages.map((m) => m.id))
    if (selectedIds.every((id) => valid.has(id))) return
    pruneChatTurnSelected(threadId, valid)
  }, [messages, selectedIds, threadId])

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
    (id: string, opts?: { additive?: boolean }) => {
      if (!threadId) return // No thread yet — ignore
      selectChatTurn(threadId, id, opts)
    },
    [threadId]
  )

  /**
   * Multi-drag: when the grabbed turn is part of a multi-selection, pack every
   * selected turn in transcript order (primary uses live editor html/plain).
   */
  const buildDragItems = useCallback(
    (primary: AiChatBlockDragItem): AiChatBlockDragItem[] => {
      if (selectedIds.length <= 1 || !selectedSet.has(primary.messageId)) {
        return [primary]
      }
      return messages
        .filter((m) => selectedSet.has(m.id))
        .map((m) => {
          if (m.id === primary.messageId) return primary // Prefer live TipTap from grabbed turn
          const stored =
            typeof m.metadata?.html === 'string' ? (m.metadata.html as string) : ''
          return {
            messageId: m.id,
            plain: m.content || '',
            html: stored.trim() ? stored : markdownToTipTapHtml(m.content || ''),
            role: m.role,
          }
        })
    },
    [messages, selectedIds.length, selectedSet]
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
    <div className="flex flex-col gap-3 w-full">
      {messages.map((m) => (
        <AiChatTurn
          key={m.id}
          message={m}
          selected={selectedSet.has(m.id)}
          selectedCount={selectedIds.length}
          selectedIds={selectedIds}
          streaming={m.id === streamingId || m.status === 'streaming'}
          chatBusy={!!streamingId}
          conversationId={conversationId}
          hasThreadLinks={linkedTurnIds.has(m.id)}
          inboundChatLinks={inboundByTarget.get(m.id) || EMPTY_INBOUND}
          onSelect={onSelect}
          buildDragItems={buildDragItems}
          onSoftSave={softSave}
          onLinksChange={onLinksChange}
          onResendPrompt={(id, content) => {
            void onEditUserMessage(id, content)
          }}
          onRegenerateResponse={(id) => {
            void onRegenerateResponse?.(id)
          }}
        />
      ))}
    </div>
  )
}

const EMPTY_INBOUND: Array<{ sourceId: string; link: AiChatBoardLink }> = []
