'use client'

// Frame load shells + last-visit layout cache (position/size + whether content had text).

import type { CSSProperties } from 'react' // Optional inline size for empty in-flow shells
import { cn } from '@/lib/utils'

export const BOARD_LOAD_FADE_MS = 300 // Keep in sync with `.tt-board-load-fade-*` in globals.css
export const FRAME_SHIMMER_ID_PREFIX = 'tt-shimmer:' // Distinct from chatPanel ids so shells can overlap real frames

/** RF node id for a layout-cached load shell (must not collide with the real frame id). */
export function frameShimmerNodeId(frameId: string) {
  return `${FRAME_SHIMMER_ID_PREFIX}${frameId}` // Prefix so setNodes can keep both during the crossfade
}

/** True when HTML has visible typed text (not empty / spaces-only / tag-only). */
export function frameHasVisibleText(html: string | undefined | null): boolean {
  if (!html) return false
  const plain = html
    .replace(/<[^>]*>/g, ' ') // Drop tags (boardLink title lives in attrs — counts as non-text shell)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > 0
}

/** How many text-line shimmer bars to paint from stored TipTap HTML. */
export function shimmerBarCountFromHtml(html: string | undefined | null): number {
  if (!frameHasVisibleText(html)) return 0 // Empty → caller uses solid frame shell
  const matches = html!.match(/<(p|h[1-6]|li|blockquote|pre|div\b)/gi)
  return Math.min(Math.max(matches?.length ?? 2, 1), 6)
}

/**
 * Empty / spaces-only → solid frame silhouette.
 * Has visible text → text-line stubs (optional gutter like TipTap blocks).
 */
export function FrameContentShimmer({
  hasText = false,
  barCount = 2,
  withGutter = false,
  matchFramePad = false, // RF shell: inset like contentFit so bars sit on the real text
  className,
  style,
}: {
  hasText?: boolean
  barCount?: number
  withGutter?: boolean
  matchFramePad?: boolean
  className?: string
  style?: CSSProperties // Optional hug size for in-flow empty shells (overrides width/height 100%)
}) {
  if (!hasText) {
    return (
      <div
        className={cn('tt-frame-shimmer', className)}
        style={style} // Explicit size wins over CSS width/height 100% for new empty frames
        aria-busy="true"
        aria-label="Loading frame"
        role="presentation"
      />
    )
  }

  const n = Math.min(Math.max(barCount, 1), 6)
  return (
    <div
      className={cn(
        'relative w-full h-full',
        withGutter && 'pl-6', // Same ⋮⋮ gutter as TipTap blocks
        matchFramePad && 'tt-frame-shimmer-frame-pad', // RF node is the frame box — pad to the text
        className
      )}
      aria-busy="true"
      aria-label="Loading frame"
    >
      <div className="tt-frame-shimmer-lines" role="presentation">
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="tt-frame-shimmer-line">
            <div className="tt-frame-shimmer-line-bar" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Per-frame layout remembered so cold loads can shimmer at the real spots. */
export type FrameLayoutEntry = {
  x: number
  y: number
  width?: number
  height?: number
  hasText?: boolean // Text lines vs solid frame shell on next cold load
  barCount?: number
}

export type FrameLayoutCache = Record<string, FrameLayoutEntry>

const layoutKey = (conversationId: string) =>
  `thinktable-canvas-positions-${conversationId}` // Same key as before; values may include size / text flags

/** Read last-visit frame positions (and optional size / text flags). */
export function readFrameLayoutCache(conversationId: string): FrameLayoutCache {
  if (typeof window === 'undefined' || !conversationId) return {}
  try {
    const raw = localStorage.getItem(layoutKey(conversationId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: FrameLayoutCache = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue
      const v = value as Record<string, unknown>
      const x = typeof v.x === 'number' ? v.x : null
      const y = typeof v.y === 'number' ? v.y : null
      if (x == null || y == null) continue
      out[id] = {
        x,
        y,
        width: typeof v.width === 'number' ? v.width : undefined,
        height: typeof v.height === 'number' ? v.height : undefined,
        hasText: typeof v.hasText === 'boolean' ? v.hasText : undefined,
        barCount: typeof v.barCount === 'number' ? v.barCount : undefined,
      }
    }
    return out
  } catch {
    return {}
  }
}

/** Persist frame positions + sizes for the next cold load shimmer. */
export function writeFrameLayoutCache(conversationId: string, layout: FrameLayoutCache) {
  if (typeof window === 'undefined' || !conversationId) return
  try {
    localStorage.setItem(layoutKey(conversationId), JSON.stringify(layout))
  } catch {
    // Quota / private mode — skip; next load just won’t have shimmer shells
  }
}

/** Merge one frame’s position (keep prior size / text flags when omitted). */
export function patchFrameLayoutEntry(
  conversationId: string,
  id: string,
  patch: FrameLayoutEntry
) {
  const layout = readFrameLayoutCache(conversationId)
  const prev = layout[id]
  layout[id] = {
    ...prev,
    ...patch,
    width: patch.width ?? prev?.width,
    height: patch.height ?? prev?.height,
    hasText: patch.hasText ?? prev?.hasText,
    barCount: patch.barCount ?? prev?.barCount,
  }
  writeFrameLayoutCache(conversationId, layout)
}

/** Outer RF/panel box used while TipTap is deferred (layout cache → metadata → HTML guess). */
export type DeferredFrameBox = {
  width: number
  height: number
  hasText: boolean
  barCount: number
  kind: 'database' | 'rowCard' | 'boardLink' | 'text' | 'empty'
}

const DEFER_LINE_H = 14 * 1.75 // Match `.prose` line box used by shimmer stubs
const DEFER_PAD_Y = 8 // contentFit T+B (4+4)
const DEFER_PAD_X = 12 // contentFit L+R (6+6)
const DEFER_EMPTY_W = 52 // ⋮⋮ + ~3ch floor
const DEFER_EMPTY_H = 32
const DEFER_BOARD_LINK_W = 98 // icon + open pill (unselected — no ⋮⋮ gutter in outer box)
const DEFER_DB_W = 420
const DEFER_DB_H = 280
const DEFER_ROW_CARD_W = 340
const DEFER_ROW_CARD_H = 200

function deferredContentKind(html: string | undefined | null): DeferredFrameBox['kind'] {
  const h = html || ''
  if (/data-type=["']databaseBlock["']/i.test(h)) return 'database'
  if (/data-type=["']propertyBlock["']/i.test(h)) return 'rowCard'
  if (/data-type=["']boardLink["']/i.test(h)) return 'boardLink'
  if (frameHasVisibleText(h)) return 'text'
  return 'empty'
}

function estimateDeferredBoxFromHtml(html: string | undefined | null): DeferredFrameBox {
  const kind = deferredContentKind(html)
  const hasText = kind === 'text' || kind === 'rowCard'
  const barCount = hasText ? shimmerBarCountFromHtml(html) : 0
  if (kind === 'database') {
    return { width: DEFER_DB_W, height: DEFER_DB_H, hasText: false, barCount: 0, kind }
  }
  if (kind === 'rowCard') {
    const props = (html || '').match(/data-type=["']propertyBlock["']/gi)?.length ?? 2
    return {
      width: DEFER_ROW_CARD_W,
      height: Math.max(DEFER_ROW_CARD_H, DEFER_PAD_Y + props * 28 + 40),
      hasText: true,
      barCount: Math.min(Math.max(props, 2), 6),
      kind,
    }
  }
  if (kind === 'boardLink') {
    return { width: DEFER_BOARD_LINK_W, height: DEFER_EMPTY_H, hasText: false, barCount: 0, kind }
  }
  if (kind === 'text') {
    const lines = Math.max(barCount, 1)
    return {
      width: 280,
      height: Math.max(DEFER_EMPTY_H, DEFER_PAD_Y + lines * DEFER_LINE_H),
      hasText: true,
      barCount: lines,
      kind,
    }
  }
  return {
    width: DEFER_EMPTY_W,
    height: DEFER_EMPTY_H,
    hasText: false,
    barCount: 0,
    kind: 'empty',
  }
}

/** Resolve a stable outer box for a deferred frame (cache wins, then saved resize, then HTML). */
export function resolveDeferredFrameBox(
  frameId: string,
  conversationId: string | undefined,
  html: string | undefined | null,
  metadata?: Record<string, unknown> | null
): DeferredFrameBox {
  const cached = conversationId ? readFrameLayoutCache(conversationId)[frameId] : undefined
  if (cached?.width && cached?.height && cached.width > 0 && cached.height > 0) {
    return {
      width: cached.width,
      height: cached.height,
      hasText: cached.hasText ?? frameHasVisibleText(html),
      barCount: cached.barCount ?? shimmerBarCountFromHtml(html),
      kind: deferredContentKind(html),
    }
  }
  const dims = metadata?.resizeDimensions as { width?: number; height?: number } | undefined
  if (dims?.width && dims?.height && dims.width > 0 && dims.height > 0) {
    const est = estimateDeferredBoxFromHtml(html)
    return {
      width: dims.width,
      height: dims.height,
      hasText: est.hasText,
      barCount: est.barCount,
      kind: est.kind,
    }
  }
  return estimateDeferredBoxFromHtml(html)
}
