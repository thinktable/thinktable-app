'use client'

// Guide line + shaded band while the Draw bar's insert-space tool drags open a gap.
// Drawn in flow units inside a camera-matched wrapper, so zoom / board rotate need no per-item math.

import type { InsertSpaceUi } from './use-insert-space-drag' // Frozen camera + live gap

const SPAN = 200000 // Flow px: the guide reads as an infinite board-wide rule

export function InsertSpaceOverlay({ ui }: { ui: InsertSpaceUi | null }) {
  if (!ui) return null // Tool armed but not dragging
  const { axis, at, delta, vp, rot } = ui
  const vertical = axis === 'vertical'
  const hair = 1 / vp.zoom // 1 screen px once the wrapper scales by zoom
  const band = Math.abs(delta) // Size of the gap being opened / closed
  const bandStart = Math.min(at, at + delta) // Negative drag shades back toward the guide
  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-[4]" // Above board content, below top bar / nav chrome
      style={{
        transform: `translate(${vp.x}px, ${vp.y}px) rotate(${rot}deg) scale(${vp.zoom})`,
        transformOrigin: '0 0', // Same camera matrix RF applies to the viewport
      }}
    >
      {band > 0 && (
        <div
          className="absolute bg-blue-500/10" // Shaded gap being inserted (or reclaimed)
          style={
            vertical
              ? { left: -SPAN / 2, width: SPAN, top: bandStart, height: band }
              : { top: -SPAN / 2, height: SPAN, left: bandStart, width: band }
          }
        />
      )}
      <div
        className="absolute bg-blue-500" // The guide: content on this side stays put
        style={
          vertical
            ? { left: -SPAN / 2, width: SPAN, top: at, height: hair }
            : { top: -SPAN / 2, height: SPAN, left: at, width: hair }
        }
      />
      <div
        className="absolute bg-blue-500/80" // Leading edge follows the pointer
        style={
          vertical
            ? { left: -SPAN / 2, width: SPAN, top: at + delta, height: hair }
            : { top: -SPAN / 2, height: SPAN, left: at + delta, width: hair }
        }
      />
    </div>
  )
}
