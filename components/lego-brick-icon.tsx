'use client'

/** Two 2-stud bricks stacked; top sits one stud back (stair). Matches Lucide stroke. */
export function LegoBrickIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" // Same canvas as Anchor / other toolbar glyphs
      fill="none" // Outline only so currentColor tints like Lucide
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {/* Stair body: lower brick left, upper brick shifted right by one stud */}
      <path d="M3 20h11v-5h7V8H9v7H3z" />
      {/* Exposed front stud on the lower brick (the uncovered “dot”) */}
      <path d="M5 15v-2.5h3.5V15" />
      {/* Rear stud of the upper brick */}
      <path d="M11 8V5.5h3.5V8" />
      {/* Front-right stud of the upper brick */}
      <path d="M16 8V5.5h3.5V8" />
      {/* Seam so the stack reads as two pieces, not one block */}
      <path d="M9 15h5" />
    </svg>
  )
}
