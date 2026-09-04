// Open chat and select a transcript turn (e.g. board chat-link cue click).

import { setChatTurnSelected } from '@/lib/ai/chat-turn-selected'
import { resolveChatTurnForBoardLink } from '@/lib/ai/chat-frame-link-cues'
import type { ChatTurnSide } from '@/lib/ai/chat-board-links'

/** Detail for thinktable-ai-open-chat-turn. */
export type AiOpenChatTurnDetail = {
  threadId: string // ai_threads id that owns the turn
  messageId: string // ai_messages id to select
}

export const AI_OPEN_CHAT_TURN_EVENT = 'thinktable-ai-open-chat-turn'

/** Select the turn and ask ChatSidebar to open + scroll it into view. */
export function requestOpenChatTurn(detail: AiOpenChatTurnDetail) {
  if (typeof window === 'undefined') return // SSR — no UI
  setChatTurnSelected(detail.threadId, detail.messageId) // Module store before mount
  window.dispatchEvent(
    new CustomEvent<AiOpenChatTurnDetail>(AI_OPEN_CHAT_TURN_EVENT, { detail })
  )
}

/**
 * Board chat-link simulator click → open chat with the linked turn selected.
 * Returns false when no cue maps that frame side to a turn.
 */
export function requestOpenChatForBoardLink(
  frameMessageId: string,
  side: ChatTurnSide
): boolean {
  const resolved = resolveChatTurnForBoardLink(frameMessageId, side)
  if (!resolved) return false
  requestOpenChatTurn(resolved)
  return true
}
