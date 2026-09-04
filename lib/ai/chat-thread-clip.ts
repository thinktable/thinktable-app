// Clip chat↔board threads at the chat content window. Grey simulated connection
// points sit on the left/right side only — never top/bottom, never the prompt.
// When the board end is under or past chat chrome (sidebar to the right, phone
// dock below), the stroke ends at that side stub and paint stays off the chrome.

import { type ChatTurnSide, chatThreadPath } from '@/lib/ai/chat-board-links'

type Pt = { x: number; y: number } // Client / screen point

type EdgeHit = { point: Pt; side: 'left' | 'right' } // Side-only stub

/** One truncated stroke + optional edge stub. */
export type ChatThreadClipResult = {
  path: string // Cubic `d` (may end at stub instead of the real endpoint)
  stub: { x: number; y: number; side: ChatTurnSide } | null // Grey simulator on content side
  reachesBoard: boolean // False when clipped before the board frame
  reachesChat: boolean // False when clipped before the chat turn
  boardCovered: boolean // Board end under/past chat — paint outside chrome + side stub
}

/** Pad so a point sitting on a scrollport edge still counts as visible. */
const VISIBLE_PAD = 4

/** Outset so the grey stub sits just outside the chrome edge (map side). */
const STUB_OUTSET = 7

/** Chat content (transcript) window only — never the prompt / mid chrome. */
export function chatContentWindowRect(): DOMRect | null {
  if (typeof document === 'undefined') return null
  const el = document.querySelector('[data-chat-content-window]') as HTMLElement | null
  if (el) {
    const r = el.getBoundingClientRect()
    if (r.width >= 8 && r.height >= 8) return r
  }
  const scroll = document.querySelector('[data-ai-transcript-scroll]') as HTMLElement | null
  const card = scroll?.closest('[data-chat-content-window]') || scroll?.parentElement
  if (card instanceof HTMLElement) {
    const r = card.getBoundingClientRect()
    if (r.width >= 8 && r.height >= 8) return r
  }
  return null
}

/** Opaque chat chrome for occlusion tests (content + prompt cards / sidebar). */
export function chatChromeRects(): DOMRect[] {
  if (typeof document === 'undefined') return []
  const dock = document.querySelector('[data-chat-map-dock]') as HTMLElement | null
  if (dock) {
    const out: DOMRect[] = []
    const content = chatContentWindowRect()
    if (content) out.push(content)
    const stack = dock.firstElementChild
    if (stack) {
      for (const child of Array.from(stack.children)) {
        if (!(child instanceof HTMLElement)) continue
        if (child.getAttribute('aria-hidden') === 'true') continue
        if (child.hasAttribute('data-chat-content-window')) continue
        const r = child.getBoundingClientRect()
        if (r.width < 8 || r.height < 8) continue
        out.push(r)
      }
    }
    return out
  }
  const sidebar = document.querySelector(
    '[data-chat-sidebar]:not([data-chat-map-dock])'
  ) as HTMLElement | null
  if (!sidebar) return []
  const r = sidebar.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? [r] : []
}

/** Desktop chat sidebar column (not the phone map dock). */
export function chatSidebarColumnRect(): DOMRect | null {
  const el = chatSidebarColumnEl()
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? r : null
}

/** Desktop chat sidebar element (host for under-chrome thread SVG). */
export function chatSidebarColumnEl(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector(
    '[data-chat-sidebar]:not([data-chat-map-dock])'
  ) as HTMLElement | null
}

/** Phone map-dock bounds (transcript + chrome + prompt stack). */
export function chatMapDockRect(): DOMRect | null {
  if (typeof document === 'undefined') return null
  const el = document.querySelector('[data-chat-map-dock]') as HTMLElement | null
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? r : null
}

/** Visible transcript scrollport — chat turns outside this are “scrolled away”. */
export function transcriptVisibleRect(): DOMRect | null {
  if (typeof document === 'undefined') return null
  const el = document.querySelector('[data-ai-transcript-scroll]') as HTMLElement | null
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? r : null
}

function pointInRect(p: Pt, r: DOMRect, pad = 0): boolean {
  return (
    p.x >= r.left - pad &&
    p.x <= r.right + pad &&
    p.y >= r.top - pad &&
    p.y <= r.bottom + pad
  )
}

function pointInRects(p: Pt, rects: DOMRect[], pad = 0): boolean {
  for (const r of rects) {
    if (pointInRect(p, r, pad)) return true
  }
  return false
}

/**
 * Clip window for scrolled-away turns: always the chat *content* window
 * (transcript card / sidebar column) — never the prompt input.
 */
function scrollOutClipWindow(transcript: DOMRect | null): DOMRect | null {
  const content = chatContentWindowRect()
  if (!content) return transcript
  const yBase = transcript ?? content
  return {
    left: content.left,
    right: content.right,
    top: yBase.top,
    bottom: yBase.bottom,
    width: content.width,
    height: yBase.height,
    x: content.left,
    y: yBase.top,
  } as DOMRect
}

/**
 * Board-facing vertical side — left/right only (never top/bottom).
 * Desktop sidebar: always the map-facing left seam (nothing useful sits past the
 * column’s right edge). Phone dock: pick L/R from the board’s x vs the card mid.
 */
function boardFacingSide(
  board: Pt,
  win: DOMRect
): { side: 'left' | 'right'; x: number } {
  if (chatSidebarColumnRect()) return { side: 'left', x: win.left }
  if (board.x < win.left - VISIBLE_PAD) return { side: 'left', x: win.left }
  if (board.x > win.right + VISIBLE_PAD) return { side: 'right', x: win.right }
  const mid = (win.left + win.right) / 2
  return board.x <= mid
    ? { side: 'left', x: win.left }
    : { side: 'right', x: win.right }
}

/**
 * Outset a side stub onto the map side of chrome so it isn’t covered by the
 * sidebar/dock fill.
 */
function outsetSideStub(hit: EdgeHit): { x: number; y: number; side: ChatTurnSide } {
  const sidebar = chatSidebarColumnRect()
  if (sidebar && hit.side === 'left') {
    return { x: sidebar.left - STUB_OUTSET, y: hit.point.y, side: 'left' }
  }
  if (sidebar && hit.side === 'right') {
    return { x: sidebar.right + STUB_OUTSET, y: hit.point.y, side: 'right' }
  }
  const x = hit.side === 'left' ? hit.point.x - STUB_OUTSET : hit.point.x + STUB_OUTSET
  return { x, y: hit.point.y, side: hit.side }
}

/**
 * Stub on the content window’s side when the turn is scrolled above/below.
 * Above → top of that side; below → bottom of that side.
 */
function sideStubForScrolledTurn(board: Pt, chat: Pt, win: DOMRect): EdgeHit {
  const { side, x: sideX } = boardFacingSide(board, win)
  const y =
    chat.y < win.top - VISIBLE_PAD
      ? win.top
      : chat.y > win.bottom + VISIBLE_PAD
        ? win.bottom
        : Math.min(win.bottom, Math.max(win.top, chat.y))
  return { point: { x: sideX, y }, side }
}

/** Side stub on the content window for a board point under/past chat (L/R only). */
function stubOnContentWindowSide(board: Pt, chat: Pt): EdgeHit | null {
  const win = chatContentWindowRect()
  if (!win) return null
  const { side, x: sideX } = boardFacingSide(board, win)
  // Prefer board Y so the stub sits where the thread exits toward the frame
  const anchorY = Number.isFinite(board.y) ? board.y : chat.y
  const rawY =
    anchorY < win.top - VISIBLE_PAD
      ? win.top
      : anchorY > win.bottom + VISIBLE_PAD
        ? win.bottom
        : anchorY
  const y = Math.min(win.bottom, Math.max(win.top, rawY))
  return { point: { x: sideX, y }, side }
}

/** True when a client point is painted over by chat chrome (dock card / sidebar). */
export function pointCoveredByChatChrome(p: Pt): boolean {
  if (typeof document === 'undefined') return false
  const el = document.elementFromPoint(p.x, p.y) as HTMLElement | null
  if (!el) return false
  return !!(el.closest('[data-chat-map-dock]') || el.closest('[data-chat-sidebar]'))
}

/**
 * Board connection is under chat chrome, or past it (desktop: at/right of the
 * sidebar seam; phone: below the content/dock window) — stroke must not overlap.
 */
export function boardConnectionBehindChat(boardPt: Pt): boolean {
  const chrome = chatChromeRects()
  if (pointCoveredByChatChrome(boardPt) || pointInRects(boardPt, chrome, 0)) return true

  const dock = chatMapDockRect()
  if (dock) {
    const win = chatContentWindowRect() ?? dock
    // Past below the chat content / dock (map still visible under/around cards)
    if (boardPt.y > win.bottom + VISIBLE_PAD) return true
    // Also treat “under the dock band” as behind even if between card gaps
    if (pointInRect(boardPt, dock, 0)) return true
    return false
  }

  const sidebar = chatSidebarColumnRect()
  if (sidebar) {
    // Under the column OR past it to the right — thread would cross the sidebar
    if (boardPt.x >= sidebar.left - VISIBLE_PAD) return true
  }
  return false
}

/** Client → under-layer SVG host local (board-root under phone dock). */
export function clientToThreadSvgSpace(p: Pt, host: HTMLElement | null): Pt {
  if (!host) return p
  const r = host.getBoundingClientRect()
  return { x: p.x - r.left, y: p.y - r.top }
}

/**
 * Clip a chat↔board cubic when the chat turn is scrolled out of the transcript,
 * or mark board-under/past-chat (stub + paint layer keeps stroke off chrome).
 */
export function clipChatThread(
  chatPt: Pt,
  boardPt: Pt,
  turnSide: ChatTurnSide,
  frameSide: ChatTurnSide
): ChatThreadClipResult {
  const full = chatThreadPath(chatPt, boardPt, turnSide, frameSide)
  const transcript = transcriptVisibleRect()
  const chatVisible =
    !!transcript && pointInRect(chatPt, transcript, VISIBLE_PAD)
  const boardCovered = boardConnectionBehindChat(boardPt)

  // Board under/past chat — stroke meets the side stub (not the turn)
  if (boardCovered) {
    const edge = stubOnContentWindowSide(boardPt, chatPt)
    if (!edge) {
      return {
        path: full,
        stub: null,
        reachesBoard: true,
        reachesChat: true,
        boardCovered: true,
      }
    }
    const stub = outsetSideStub(edge)
    return {
      path: chatThreadPath(boardPt, stub, frameSide, stub.side),
      stub,
      reachesBoard: true,
      reachesChat: false,
      boardCovered: true,
    }
  }

  if (chatVisible) {
    return {
      path: full,
      stub: null,
      reachesBoard: true,
      reachesChat: true,
      boardCovered: false,
    }
  }

  // Turn scrolled above/below — stub on content window L/R
  const win = scrollOutClipWindow(transcript)
  if (!win) {
    return {
      path: full,
      stub: null,
      reachesBoard: true,
      reachesChat: true,
      boardCovered: false,
    }
  }
  const hit = sideStubForScrolledTurn(boardPt, chatPt, win)
  const stub = outsetSideStub(hit)
  return {
    path: chatThreadPath(boardPt, stub, frameSide, hit.side),
    stub,
    reachesBoard: true,
    reachesChat: false,
    boardCovered: false,
  }
}
