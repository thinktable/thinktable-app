// Chat turn ↔ board frame thread links (stored on ai_messages.metadata)

export type ChatTurnSide = 'left' | 'right' | 'top' | 'bottom'

/** One thread from an AI chat turn to a board frame. */
export type AiChatBoardLink = {
  id: string // Stable link id
  frameMessageId: string // Board messages.id (frame)
  turnSide: ChatTurnSide // Connection point on the chat turn
  frameSide: ChatTurnSide // Connection point on the board frame
}

const META_KEY = 'boardLinks' // ai_messages.metadata.boardLinks

/** Read links from a message metadata bag. */
export function readChatBoardLinks(meta: Record<string, unknown> | null | undefined): AiChatBoardLink[] {
  const raw = meta?.[META_KEY]
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (x): x is AiChatBoardLink =>
      !!x &&
      typeof x === 'object' &&
      typeof (x as AiChatBoardLink).id === 'string' &&
      typeof (x as AiChatBoardLink).frameMessageId === 'string' &&
      typeof (x as AiChatBoardLink).turnSide === 'string' &&
      typeof (x as AiChatBoardLink).frameSide === 'string'
  )
}

/** Merge links into metadata (immutable). */
export function withChatBoardLinks(
  meta: Record<string, unknown> | null | undefined,
  links: AiChatBoardLink[]
): Record<string, unknown> {
  return { ...(meta || {}), [META_KEY]: links }
}

/** Mint a link id. */
export function newChatBoardLinkId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Side mid-point of a DOM rect (client px). */
export function sideAnchor(
  rect: DOMRect,
  side: ChatTurnSide
): { x: number; y: number } {
  if (side === 'left') return { x: rect.left, y: rect.top + rect.height / 2 }
  if (side === 'right') return { x: rect.right, y: rect.top + rect.height / 2 }
  if (side === 'top') return { x: rect.left + rect.width / 2, y: rect.top }
  return { x: rect.left + rect.width / 2, y: rect.bottom }
}

/** Pick the frame side nearest to a client point. */
export function nearestFrameSide(
  rect: DOMRect,
  clientX: number,
  clientY: number
): ChatTurnSide {
  const dist: Record<ChatTurnSide, number> = {
    left: Math.abs(clientX - rect.left),
    right: Math.abs(clientX - rect.right),
    top: Math.abs(clientY - rect.top),
    bottom: Math.abs(clientY - rect.bottom),
  }
  let best: ChatTurnSide = 'left'
  let bestD = Infinity
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    if (dist[side] < bestD) {
      bestD = dist[side]
      best = side
    }
  }
  return best
}

/** Smooth cubic path between two screen points (Miro-ish). */
export function chatThreadPath(
  a: { x: number; y: number },
  b: { x: number; y: number },
  fromSide: ChatTurnSide,
  toSide: ChatTurnSide
): string {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45)
  const dy = Math.max(40, Math.abs(b.y - a.y) * 0.45)
  const c1 =
    fromSide === 'left'
      ? { x: a.x - dx, y: a.y }
      : fromSide === 'right'
        ? { x: a.x + dx, y: a.y }
        : fromSide === 'top'
          ? { x: a.x, y: a.y - dy }
          : { x: a.x, y: a.y + dy }
  const c2 =
    toSide === 'left'
      ? { x: b.x - dx, y: b.y }
      : toSide === 'right'
        ? { x: b.x + dx, y: b.y }
        : toSide === 'top'
          ? { x: b.x, y: b.y - dy }
          : { x: b.x, y: b.y + dy }
  return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`
}
