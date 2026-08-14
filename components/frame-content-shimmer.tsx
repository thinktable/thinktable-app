'use client'

// Frame load shells + last-visit layout cache (position/size + whether content had text).

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
}: {
  hasText?: boolean
  barCount?: number
  withGutter?: boolean
  matchFramePad?: boolean
  className?: string
}) {
  if (!hasText) {
    return (
      <div
        className={cn('tt-frame-shimmer', className)}
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
