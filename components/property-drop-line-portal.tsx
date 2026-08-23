'use client'

// Blue dashed insert line while dragging property icons (matches block-handle drop line).

import { createPortal } from 'react-dom'
import type { PropertyDropLine } from '@/lib/tiptap/property-block-drag'

export function PropertyDropLinePortal({ line }: { line: PropertyDropLine | null }) {
  if (!line || typeof document === 'undefined') return null
  return createPortal(
    <div
      data-tt-property-drop-line
      className="pointer-events-none fixed z-[125]"
      style={{
        top: line.top - 1, // Center the 2px marker on the insert edge
        left: line.left,
        width: Math.max(48, line.width), // Always wide enough to see
        height: 2,
        backgroundImage: 'repeating-linear-gradient(90deg, #3b82f6 0 6px, transparent 6px 10px)',
      }}
    />,
    document.body
  )
}
