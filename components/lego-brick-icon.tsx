'use client'

import { cn } from '@/lib/utils' // Merge caller size classes with dark invert

/** Lock-frames glyph from `public/group frames icon 1.svg` (solid frames + padlock; reads at h-4). */
export function LegoBrickIcon({ className }: { className?: string }) {
  return (
    <img
      src="/group%20frames%20icon%201.svg" // icon 2’s outline art smudges to a blob at 16px toolbar size
      alt="" // Decorative — parent button / menu row owns the label
      aria-hidden
      className={cn('object-contain dark:invert', className)} // Invert so black/white faces survive dark chrome
    />
  )
}
