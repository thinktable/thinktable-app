'use client'

import { cn } from '@/lib/utils' // Merge caller size classes

/** Tidy up — 2×2 grid of hollow rounded squares (matches top-bar reference). */
export function TidyUpIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" // Lucide canvas so h-4 matches other toolbar glyphs
      fill="none" // Hollow squares — stroke only
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(className)}
      aria-hidden="true" // Parent button / menu row owns the label
    >
      <rect x="3" y="3" width="7" height="7" rx="1.75" /> {/* Top-left */}
      <rect x="14" y="3" width="7" height="7" rx="1.75" /> {/* Top-right */}
      <rect x="3" y="14" width="7" height="7" rx="1.75" /> {/* Bottom-left */}
      <rect x="14" y="14" width="7" height="7" rx="1.75" /> {/* Bottom-right */}
    </svg>
  )
}
