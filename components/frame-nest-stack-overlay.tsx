'use client'

// Snap preview: dashed stack line on the host edge while a dragged frame is magnetized.
// Replaces the old Layers edge-band stack drop buttons.

import { createPortal } from 'react-dom' // Screen-fixed overlay
import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import type { FrameNestStackUi } from '@/components/use-frame-nest-stack-drag'
import { STACK_LINE_GAP } from '@/components/use-frame-nest-stack-drag'

const LINE = 2 // Stroke thickness (matches settled FrameStackRevealLine)
const COLOR = '#3b82f6'
const OUTSET = Math.max(4, STACK_LINE_GAP / 2) // Mid-gap preview, same as settled line

/** Preview the stack reveal line on the snap edge (portal to document.body). */
export function FrameNestStackOverlay({ ui }: { ui: FrameNestStackUi | null }) {
  if (!ui || ui.mode !== 'snap' || typeof document === 'undefined') return null

  const { targetRect, stackSide } = ui
  const isH = stackSide === 'top' || stackSide === 'bottom'
  const inset = 0.08 // 8% inset like settled line
  const style: CSSProperties = isH
    ? {
        left: targetRect.left + targetRect.width * inset,
        width: targetRect.width * (1 - inset * 2),
        height: LINE,
        top:
          stackSide === 'top'
            ? targetRect.top - OUTSET - LINE / 2
            : targetRect.top + targetRect.height + OUTSET - LINE / 2,
      }
    : {
        top: targetRect.top + targetRect.height * inset,
        height: targetRect.height * (1 - inset * 2),
        width: LINE,
        left:
          stackSide === 'left'
            ? targetRect.left - OUTSET - LINE / 2
            : targetRect.left + targetRect.width + OUTSET - LINE / 2,
      }

  return createPortal(
    <div
      data-tt-frame-drop-overlay
      className="pointer-events-none fixed inset-0 z-[9998]"
      aria-hidden
    >
      <div
        className={cn('absolute rounded-full')}
        style={{
          ...style,
          backgroundImage: isH
            ? `repeating-linear-gradient(90deg, ${COLOR} 0 6px, transparent 6px 10px)`
            : `repeating-linear-gradient(180deg, ${COLOR} 0 6px, transparent 6px 10px)`,
          backgroundColor: 'transparent',
          boxShadow: `0 0 0 1px ${COLOR}22`,
        }}
        title="Snap to stack"
      />
    </div>,
    document.body
  )
}
