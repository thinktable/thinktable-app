'use client'

// Rotate control for Free nav — vertical scrub like zoom %; click opens a border-size-style slider
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { normalizeDeg } from '@/lib/board-rotation'
import { useBoardRotation } from '@/components/board-rotation-context'

// Free-nav glyph from public/rotate-90-ccw.svg — fill follows currentColor like Lucide
function RotateCcwDiamondIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="1 2 21 20" // Cropped Material 24 canvas (same artboard as the public SVG)
      className={className}
      aria-hidden
    >
      {/* Diamond + CCW wrap; evenodd cuts the hollow center */}
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M5.93,7.83 L2.28,11.49 C1.5,12.27 1.5,13.54 2.28,14.32 L5.94,17.98 C6.72,18.76 7.99,18.76 8.77,17.98 L12.43,14.33 C13.21,13.55 13.21,12.28 12.43,11.5 L8.76,7.82 C7.97,7.04 6.71,7.04 5.93,7.83 Z M4.4,12.19 L6.65,9.94 C7.04,9.55 7.67,9.55 8.07,9.94 L10.31,12.18 C10.7,12.57 10.7,13.2 10.31,13.59 L8.06,15.84 C7.67,16.23 7.04,16.23 6.64,15.84 L4.4,13.61 C4.01,13.22 4.01,12.58 4.4,12.19 Z M19.36,6.64 C17.61,4.88 15.3,4 13,4 L13,3.17 C13,2.28 11.92,1.83 11.29,2.46 L9.47,4.29 C9.08,4.68 9.08,5.31 9.47,5.7 L11.3,7.53 C11.92,8.16 13,7.72 13,6.83 L13,6 C15.02,6 17.03,6.86 18.45,8.61 C20.5,11.13 20.5,14.88 18.45,17.4 C17.03,19.14 15.02,20 13,20 C12.22,20 11.45,19.87 10.71,19.61 C10.35,19.49 9.96,19.6 9.69,19.87 C9.19,20.37 9.35,21.26 10.03,21.49 C10.99,21.83 11.99,22 13,22 C15.3,22 17.61,21.12 19.36,19.36 C22.88,15.85 22.88,10.15 19.36,6.64 Z"
      />
    </svg>
  )
}

export function NavRotateControl({ className }: { className?: string }) {
  const { rotation, setRotationAroundViewCenter, resetRotation } = useBoardRotation() // Shared camera heading
  const [menuOpen, setMenuOpen] = useState(false) // Slider popover
  const [isDragging, setIsDragging] = useState(false) // Vertical icon scrub in progress
  const dragRef = useRef<{
    pointerId: number
    startY: number
    startRot: number
    dragging: boolean
  } | null>(null) // Icon pointer-scrub baseline
  const suppressMenuOpenRef = useRef(false) // After a scrub, the leftover click must not open the slider
  const trackRef = useRef<HTMLDivElement>(null) // Slider bar for click-to-place + drag

  const handleIconPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return // Left / primary only
    dragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startRot: rotation,
      dragging: false,
    }
  }

  const handleIconPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const dy = e.clientY - drag.startY
    if (!drag.dragging && Math.abs(dy) < 4) return // Tiny move = click for the slider
    if (!drag.dragging) {
      drag.dragging = true
      setIsDragging(true)
      setMenuOpen(false) // Don’t show the bar while scrubbing the icon
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    setRotationAroundViewCenter(drag.startRot - dy * 0.4, { snap: true }) // Drag up = clockwise; snap at 0°
  }

  const handleIconPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    if (drag.dragging) {
      suppressMenuOpenRef.current = true // Swallow the click that follows pointerup
      setIsDragging(false)
    }
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const degFromClientX = (clientX: number) => {
    const track = trackRef.current
    if (!track) return rotation
    const r = track.getBoundingClientRect()
    const t = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width))) // 0 at left, 1 at right
    return normalizeDeg(t * 360 - 180) // Bar is −180 … +180 with 0 in the middle — no snap
  }

  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault() // Don’t start a text-select on the bar
    e.stopPropagation()
    setRotationAroundViewCenter(degFromClientX(e.clientX)) // Click anywhere — move the dot there
    e.currentTarget.setPointerCapture(e.pointerId) // Keep dragging off the thumb
  }

  const handleTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    setRotationAroundViewCenter(degFromClientX(e.clientX))
  }

  const thumbPct = ((normalizeDeg(rotation) + 180) / 360) * 100 // 0° sits at the bar center

  return (
    <DropdownMenu
      modal={false}
      open={menuOpen}
      onOpenChange={(open) => {
        if (open && suppressMenuOpenRef.current) {
          suppressMenuOpenRef.current = false
          setMenuOpen(false)
          return
        }
        setMenuOpen(open)
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-7 w-7 p-0 shrink-0 rounded-lg text-gray-900 dark:text-gray-100 hover:bg-gray-200/60 dark:hover:bg-gray-700/60 focus-visible:ring-0 focus-visible:ring-offset-0 cursor-ns-resize',
            isDragging && 'bg-gray-200 dark:bg-[#2a2a2a]',
            className
          )}
          onPointerDown={handleIconPointerDown}
          onPointerMove={handleIconPointerMove}
          onPointerUp={handleIconPointerUp}
          onPointerCancel={handleIconPointerUp}
          onClick={(e) => {
            if (suppressMenuOpenRef.current) {
              suppressMenuOpenRef.current = false
              e.preventDefault()
              e.stopPropagation()
            }
          }}
          title="Rotate board — drag up/down to adjust, click for slider"
          aria-label="Rotate board"
        >
          <RotateCcwDiamondIcon className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        side="top"
        className="flex w-56 items-center gap-1.5 p-2"
        onCloseAutoFocus={(e) => e.preventDefault()} // Don’t steal focus back to the icon
      >
        <div
          ref={trackRef}
          className="relative h-6 flex-1 cursor-pointer"
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handleTrackPointerMove}
          onPointerUp={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId)
            }
          }}
          title="Board rotation"
          aria-label="Board rotation"
          role="slider"
          aria-valuemin={-180}
          aria-valuemax={180}
          aria-valuenow={Math.round(normalizeDeg(rotation))}
        >
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gray-200 dark:bg-[#333]" />
          <div
            className="pointer-events-none absolute top-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-gray-400 dark:bg-gray-500"
            style={{ left: '50%' }} // 0° tick (visual only — bar does not snap)
            aria-hidden
          />
          <div
            className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-700 dark:bg-gray-300"
            style={{ left: `${thumbPct}%` }} // Dot follows heading; click on the bar jumps it
            aria-hidden
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-1.5 text-xs font-normal text-gray-700 dark:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-gray-700/60"
          title="Reset rotation"
          aria-label="Reset rotation"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            resetRotation()
          }}
        >
          Reset
        </Button>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
