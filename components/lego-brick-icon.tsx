'use client'

import { cn } from '@/lib/utils' // Merge caller size classes with dark invert

/** Snap-frames glyph from `public/group frames icon 2.svg` (isometric stacked frames). */
export function LegoBrickIcon({ className }: { className?: string }) {
  return (
    <img
      src="/group%20frames%20icon%202.svg" // Served from public/; spaces encoded like other toolbar SVGs
      alt="" // Decorative — parent button / menu row owns the label
      aria-hidden
      className={cn('object-contain dark:invert', className)} // Invert so black/white faces survive dark chrome
    />
  )
}
