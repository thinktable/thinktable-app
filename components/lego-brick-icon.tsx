'use client'

import { cn } from '@/lib/utils' // Merge caller size classes with dark invert

/** Snap-frames glyph from `public/snap frames icon 3.svg` (isometric stacked bricks). */
export function LegoBrickIcon({ className }: { className?: string }) {
  return (
    <img
      src="/snap%20frames%20icon%203.svg" // Served from public/; spaces encoded like other toolbar SVGs
      alt="" // Decorative — parent button / menu row owns the label
      aria-hidden
      className={cn('object-contain dark:invert', className)} // Invert so black/white faces survive dark chrome
    />
  )
}
