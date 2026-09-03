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

type Pt = { x: number; y: number } // Screen / client point

/** Cubic control points for a chat↔board thread (same geometry as the SVG stroke). */
export function chatThreadControls(
  a: Pt,
  b: Pt,
  fromSide: ChatTurnSide,
  toSide: ChatTurnSide
): { c1: Pt; c2: Pt } {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45) // Horizontal pull toward exit/entry
  const dy = Math.max(40, Math.abs(b.y - a.y) * 0.45) // Vertical pull for top/bottom sides
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
  return { c1, c2 }
}

/** Point on a cubic at t ∈ [0,1]. */
function cubicAt(p0: Pt, c1: Pt, c2: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t // Complement for Bernstein basis
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
  }
}

/** Smooth cubic path between two screen points (Miro-ish). */
export function chatThreadPath(
  a: Pt,
  b: Pt,
  fromSide: ChatTurnSide,
  toSide: ChatTurnSide
): string {
  const { c1, c2 } = chatThreadControls(a, b, fromSide, toSide) // Shared with seam crossing
  return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`
}

/**
 * Client-Y where a chat↔board cubic crosses a vertical seam (sidebar left edge).
 * Samples the curve; returns every crossing (usually 0–1).
 */
export function chatThreadSeamCrossYs(
  a: Pt,
  b: Pt,
  fromSide: ChatTurnSide,
  toSide: ChatTurnSide,
  seamX: number
): number[] {
  const { c1, c2 } = chatThreadControls(a, b, fromSide, toSide)
  const ys: number[] = []
  const steps = 48 // Dense enough for a gentle cubic across ~360px
  let prev = cubicAt(a, c1, c2, b, 0)
  for (let i = 1; i <= steps; i++) {
    const p = cubicAt(a, c1, c2, b, i / steps)
    const d0 = prev.x - seamX
    const d1 = p.x - seamX
    // Crossing (or landing on) the vertical seam between samples
    if (d0 === 0) {
      ys.push(prev.y)
    } else if (d0 * d1 < 0) {
      const u = d0 / (d0 - d1) // Linear interpolate within the segment
      ys.push(prev.y + u * (p.y - prev.y))
    } else if (d1 === 0 && i === steps) {
      ys.push(p.y) // Endpoint sits on the seam
    }
    prev = p
  }
  return ys
}
