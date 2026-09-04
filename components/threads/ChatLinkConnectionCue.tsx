// Chat-linked connection cue: keep the normal blue simulator on the connection
// point, and place the brand “line” (T stroke from `connection logo 1.svg`)
// to the left of the dot, top-aligned — same layout on every side.

import type { CSSProperties } from 'react'
import { ConnectionIndicator } from '@/components/threads/ConnectionIndicator'
import { cn } from '@/lib/utils'

type Side = 'left' | 'right' | 'top' | 'bottom'

type ChatLinkConnectionCueProps = {
  side: Side
  indicatorStyle: CSSProperties // Same outset placement as a normal blue simulator
  indicatorSize: number // Dot diameter (flow px)
  isThreadConnecting: boolean // While connecting, indicators are paint-only
}

/** Path-only viewBox cropped around the T stroke in `connection logo 1.svg`. */
const LINE_VIEWBOX = '0 0 306 453'
/** T / table-leg stroke from the connection logo (no disc — the simulator is the dot). */
const LINE_PATH =
  'M305.69,370.69v81.89c-23.91.07-47.52,1.1-70.92-4.46-53.59-12.87-89.49-54.84-93.95-109.89l.07-261.31H0V0h220.8v325.21c0,17.47,18.28,45.48,37.43,45.48h47.45Z'

/** Read outset distance from the shared indicator placement style. */
function outsetFromIndicatorStyle(style: CSSProperties, side: Side): number {
  if (side === 'left' && typeof style.left === 'number') return -style.left
  if (side === 'right' && typeof style.right === 'number') return -style.right
  if (side === 'top' && typeof style.top === 'number') return -style.top
  if (side === 'bottom' && typeof style.bottom === 'number') return -style.bottom
  return 14
}

/**
 * Anchor the row so the *dot center* sits on the connection point
 * (same place as a normal simulator). The line sits left of the dot.
 */
function stackAnchorStyle(
  side: Side,
  out: number,
  size: number,
  lineW: number,
  gap: number
): CSSProperties {
  // Row is [line][gap][dot]. Shift so the dot center lands on the connection point.
  const xLeft = `-${lineW + gap + size / 2}px` // left / top / bottom (left-anchored or mid)
  const xRight = `${size / 2}px` // right-anchored: row’s right edge is the dot’s right edge
  const y = `-${size / 2}px` // Top of the size×size dot cell → center on the point
  if (side === 'left') {
    return { left: -out, top: '50%', transform: `translate(${xLeft}, ${y})` }
  }
  if (side === 'right') {
    return { right: -out, top: '50%', transform: `translate(${xRight}, ${y})` }
  }
  if (side === 'top') {
    return { top: -out, left: '50%', transform: `translate(${xLeft}, ${y})` }
  }
  // Bottom: measure from the frame bottom edge + outset (same mid as a normal indicator)
  return {
    top: `calc(100% + ${out}px)`,
    left: '50%',
    transform: `translate(${xLeft}, ${y})`,
  }
}

/**
 * Blue simulator at the normal connection-point spot + brand line to its left,
 * top-aligned (same relative place on left / right / top / bottom).
 */
export function ChatLinkConnectionCue({
  side,
  indicatorStyle,
  indicatorSize,
  isThreadConnecting,
}: ChatLinkConnectionCueProps) {
  const out = outsetFromIndicatorStyle(indicatorStyle, side)
  const lineH = indicatorSize * 1.35 // Stay under the dot so the cue reads as a mark, not a hook
  const lineW = lineH * (306 / 453) * 0.88 // Slightly thinner than natural, not skinny
  const gap = indicatorSize * 0.08 // Tight air between line and dot

  return (
    <div
      className="nodrag nopan absolute z-[30] flex flex-row items-start"
      style={stackAnchorStyle(side, out, indicatorSize, lineW, gap)}
      data-tt-chat-link-cue={side}
    >
      {/* Brand line — left of the dot, top edges aligned */}
      <svg
        aria-hidden
        className="pointer-events-none shrink-0"
        viewBox={LINE_VIEWBOX}
        style={{ width: lineW, height: lineH, marginRight: gap }}
      >
        <path fill="#3b83f6" d={LINE_PATH} />
      </svg>
      {/* Dot slot — center of this box is the connection point */}
      <div
        className="relative shrink-0"
        style={{ width: indicatorSize, height: indicatorSize }}
      >
        <ConnectionIndicator
          side={side}
          className={cn(
            'nodrag nopan absolute inset-0 z-[30] rounded-full border border-white bg-blue-500 shadow-sm',
            isThreadConnecting
              ? 'pointer-events-none'
              : 'cursor-crosshair hover:bg-blue-600'
          )}
          style={{
            left: 0,
            top: 0,
            right: 'auto',
            bottom: 'auto',
            width: indicatorSize,
            height: indicatorSize,
            transform: 'none', // Parent stack already centers the dot on the point
          }}
        />
      </div>
    </div>
  )
}
