// Board-frame connection-point cues for chat↔board threads.
// Linked sides come from ai_messages.metadata.boardLinks (synced from ChatSidebar
// whenever the active thread’s messages are in memory — including while chat is closed).
// The logo sits beside the blue simulator while connection indicators normally show
// AND the chat↔board thread stroke is not drawn.

import { useEffect, useState } from 'react'
import {
  isChatToBoardLink,
  readChatBoardLinks,
  type ChatTurnSide,
} from '@/lib/ai/chat-board-links'
import type { AiMessage } from '@/lib/ai/types'

/** One published endpoint: board frame message id + which side the thread meets. */
export type ChatFrameLinkCue = {
  frameMessageId: string // messages.id of the board frame
  side: ChatTurnSide // Connection point side on that frame
}

type Listener = () => void // Cue maps changed

const linkSources = new Map<string, ChatFrameLinkCue[]>() // Thread turns → linked endpoints
const visibleSources = new Map<string, ChatFrameLinkCue[]>() // Selected turns → painted thread ends
const listeners = new Set<Listener>()
/** Active ai_threads id for reverse lookup (board cue → chat turn). */
let cueThreadId: string | null = null

/** Merge sources into frameMessageId → unique sides. */
function mergedByFrame(map: Map<string, ChatFrameLinkCue[]>): Map<string, Set<ChatTurnSide>> {
  const out = new Map<string, Set<ChatTurnSide>>()
  for (const cues of map.values()) {
    for (const c of cues) {
      let set = out.get(c.frameMessageId)
      if (!set) {
        set = new Set()
        out.set(c.frameMessageId, set)
      }
      set.add(c.side)
    }
  }
  return out
}

function notify() {
  for (const cb of listeners) cb()
}

function setSource(
  map: Map<string, ChatFrameLinkCue[]>,
  sourceId: string,
  cues: ChatFrameLinkCue[]
) {
  if (cues.length === 0) {
    if (!map.has(sourceId)) return false
    map.delete(sourceId)
    return true
  }
  map.set(sourceId, cues)
  return true
}

/** Publish (or replace) board endpoints for one chat turn; empty clears that turn. */
export function publishChatFrameLinkCues(sourceId: string, cues: ChatFrameLinkCue[]) {
  if (setSource(linkSources, sourceId, cues)) notify()
}

/** Drop one chat turn’s link cues. */
export function clearChatFrameLinkCues(sourceId: string) {
  if (!linkSources.has(sourceId)) return
  linkSources.delete(sourceId)
  notify()
}

/**
 * Rebuild link cues from the active thread’s messages.
 * Keeps board simulators marked while chat UI is closed (desktop unmounts the transcript).
 * Pass `previousSourceIds` from the last sync so deleted / previous-thread turns clear.
 * `threadId` arms reverse lookup (board cue click → select that chat turn).
 */
export function syncChatFrameLinkCuesFromMessages(
  messages: AiMessage[],
  previousSourceIds?: Set<string>,
  threadId?: string | null
): Set<string> {
  if (threadId !== undefined) cueThreadId = threadId || null // Remember owning thread
  const next = new Set<string>()
  let changed = false
  for (const m of messages) {
    const sourceId = `turn-${m.id}` // Same id AiChatTurn uses for thread overlays
    next.add(sourceId)
    const links = readChatBoardLinks(m.metadata).filter(isChatToBoardLink) // Board cues only
    const cues =
      links.length === 0
        ? []
        : links.map((l) => ({
            frameMessageId: l.frameMessageId,
            side: l.frameSide,
          }))
    if (setSource(linkSources, sourceId, cues)) changed = true
  }
  if (previousSourceIds) {
    for (const id of previousSourceIds) {
      if (next.has(id)) continue
      if (setSource(linkSources, id, [])) changed = true // Drop turns no longer in transcript
    }
  }
  if (changed) notify()
  return next
}

/**
 * Board frame + side → linked chat turn (last matching turn in the synced thread).
 * Used when clicking a chat-connected simulated connection point.
 */
export function resolveChatTurnForBoardLink(
  frameMessageId: string,
  side: ChatTurnSide
): { threadId: string; messageId: string } | null {
  if (!cueThreadId || !frameMessageId) return null
  let messageId: string | null = null
  for (const [sourceId, cues] of linkSources) {
    if (!cues.some((c) => c.frameMessageId === frameMessageId && c.side === side)) {
      continue
    }
    if (!sourceId.startsWith('turn-')) continue
    messageId = sourceId.slice('turn-'.length) // Prefer later transcript turns
  }
  if (!messageId) return null
  return { threadId: cueThreadId, messageId }
}

/** Drop every published link-cue source (leave board). */
export function clearAllChatFrameLinkCues() {
  cueThreadId = null // Drop reverse-lookup thread
  if (linkSources.size === 0 && visibleSources.size === 0) return
  linkSources.clear()
  visibleSources.clear()
  notify()
}

/**
 * Publish endpoints whose chat↔board thread stroke is currently drawn.
 * Logo hides on these sides while the stroke is visible.
 */
export function publishChatFrameThreadVisible(sourceId: string, cues: ChatFrameLinkCue[]) {
  if (setSource(visibleSources, sourceId, cues)) notify()
}

/** Drop visible-thread marks for one chat turn (deselect / unmount). */
export function clearChatFrameThreadVisible(sourceId: string) {
  if (!visibleSources.has(sourceId)) return
  visibleSources.delete(sourceId)
  notify()
}

/** Subscribe to cue-map changes. Fires immediately. */
export function subscribeChatFrameLinkCues(cb: Listener): () => void {
  listeners.add(cb)
  cb()
  return () => {
    listeners.delete(cb)
  }
}

/**
 * Sides that should show the chat-connected cue on a board frame’s connection indicator:
 * linked to chat, but the thread stroke is not currently showing.
 */
export function chatFrameLinkLogoSides(frameMessageId: string | null | undefined): Set<ChatTurnSide> {
  if (!frameMessageId) return new Set()
  const linked = mergedByFrame(linkSources).get(frameMessageId)
  if (!linked || linked.size === 0) return new Set()
  const visible = mergedByFrame(visibleSources).get(frameMessageId) ?? new Set()
  const out = new Set<ChatTurnSide>()
  for (const side of linked) {
    if (!visible.has(side)) out.add(side) // Hide logo while thread path is painted
  }
  return out
}

/** Sides whose chat↔board thread stroke is currently drawn (suppress indicator chrome). */
export function chatFrameThreadVisibleSides(
  frameMessageId: string | null | undefined
): Set<ChatTurnSide> {
  if (!frameMessageId) return new Set()
  return mergedByFrame(visibleSources).get(frameMessageId) ?? new Set()
}

/** React: logo sides + thread-visible sides for a board frame. */
export function useChatFrameLinkLogoSides(
  frameMessageId: string | null | undefined
): { logoSides: Set<ChatTurnSide>; threadVisibleSides: Set<ChatTurnSide> } {
  const [state, setState] = useState(() => ({
    logoSides: chatFrameLinkLogoSides(frameMessageId),
    threadVisibleSides: chatFrameThreadVisibleSides(frameMessageId),
  }))
  useEffect(() => {
    return subscribeChatFrameLinkCues(() => {
      setState({
        logoSides: chatFrameLinkLogoSides(frameMessageId),
        threadVisibleSides: chatFrameThreadVisibleSides(frameMessageId),
      })
    })
  }, [frameMessageId])
  return state
}

/** @deprecated Prefer useChatFrameLinkLogoSides().logoSides */
export function useChatFrameLinkSides(frameMessageId: string | null | undefined): Set<ChatTurnSide> {
  return useChatFrameLinkLogoSides(frameMessageId).logoSides
}
