// Board-frame connection-point cues for chat↔board threads.
// Linked sides are known whenever a chat turn with boardLinks is mounted.
// The logo replaces the blue simulator only while connection indicators
// normally show AND the chat↔board thread stroke is not drawn.

import { useEffect, useState } from 'react'
import type { ChatTurnSide } from '@/lib/ai/chat-board-links'

/** One published endpoint: board frame message id + which side the thread meets. */
export type ChatFrameLinkCue = {
  frameMessageId: string // messages.id of the board frame
  side: ChatTurnSide // Connection point side on that frame
}

type Listener = () => void // Cue maps changed

const linkSources = new Map<string, ChatFrameLinkCue[]>() // Mounted turns → linked endpoints
const visibleSources = new Map<string, ChatFrameLinkCue[]>() // Selected turns → painted thread ends
const listeners = new Set<Listener>()

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

/** Drop one chat turn’s link cues (unmount). */
export function clearChatFrameLinkCues(sourceId: string) {
  if (!linkSources.has(sourceId)) return
  linkSources.delete(sourceId)
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
 * Sides that should show the chat logo on a board frame’s connection indicator:
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
