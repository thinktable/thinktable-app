'use client'

// Snap preview: dashed stack line between connection simulators while dragging.

import { createPortal } from 'react-dom' // Screen-fixed overlay
import { cn } from '@/lib/utils'
import type { FrameNestStackUi } from '@/components/use-frame-nest-stack-drag'
import { frameScreenChromeScale } from '@/components/threads/constants'
import { stackLineMarksHorizontal, stackLinePreviewStyle } from '@/lib/frame-stack-line'

const LINE = 2 // Stroke thickness (matches settled FrameStackRevealLine)
const COLOR = '#3b82f6'

/** Preview stack line between host outside simulator and dragged inside anchor. */
export function FrameNestStackOverlay({ ui }: { ui: FrameNestStackUi | null }) {
  if (!ui || ui.mode !== 'snap' || typeof document === 'undefined') return null

  const { targetRect, sourceRect, stackSide, zoom } = ui
  const frameUiScale = frameScreenChromeScale(zoom)
  const style = stackLinePreviewStyle(
    targetRect,
    sourceRect,
    stackSide,
    zoom,
    frameUiScale,
    LINE
  )
  const barHorizontal = stackLineMarksHorizontal(stackSide)

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
          backgroundImage: barHorizontal
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
