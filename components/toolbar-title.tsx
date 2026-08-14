'use client'

import { type ReactNode } from 'react' // Title text
import { cn } from '@/lib/utils' // Merge show vs compact classes

/** Icon-adjacent toolbar title; width + opacity animate when the bar condenses. */
export function ToolbarTitle({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <span
      aria-hidden={!show} // Hidden from AT while collapsed; the button keeps aria-label
      className={cn(
        'tt-toolbar-title grid min-w-0', // Hook for first-paint: parent disables transition until layout is settled
        'transition-[grid-template-columns,opacity] duration-200 ease-out', // 0fr↔1fr interpolates the unknown text width
        show ? 'grid-cols-[1fr] opacity-100' : 'grid-cols-[0fr] opacity-0 pointer-events-none' // Collapse to zero columns and fade out
      )}
    >
      <span className="min-w-0 overflow-hidden text-sm whitespace-nowrap">{children}</span>
    </span>
  )
}
