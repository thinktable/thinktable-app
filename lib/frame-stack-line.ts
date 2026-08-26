// Each snapped frame gets an edge-parallel bar halfway between its adjust border
// and its facing simulated thread connection point.

import type { CSSProperties } from 'react'
import { INDICATOR_OUTSET } from '@/components/threads/handle-ids'
import type { FrameStackSide } from '@/lib/frame-side-stacks'

type RectLike = { left: number; top: number; width: number; height: number }

const PARALLEL_INSET = 0.08 // Match legacy 8% inset on the long axis

export function oppositeStackSide(side: FrameStackSide): FrameStackSide {
  if (side === 'right') return 'left'
  if (side === 'left') return 'right'
  if (side === 'top') return 'bottom'
  return 'top'
}

/** Connection point on the adjust-box edge (inside anchor). */
export function adjustConnectionPointScreen(
  rect: RectLike,
  side: FrameStackSide
): { x: number; y: number } {
  const mx = rect.left + rect.width / 2
  const my = rect.top + rect.height / 2
  switch (side) {
    case 'left':
      return { x: rect.left, y: my }
    case 'right':
      return { x: rect.left + rect.width, y: my }
    case 'top':
      return { x: mx, y: rect.top }
    default:
      return { x: mx, y: rect.top + rect.height }
  }
}

/** Simulated connection indicator — outside the adjust edge (matches thread UX). */
export function adjustExitPointScreen(
  rect: RectLike,
  side: FrameStackSide,
  outsetScreen: number
): { x: number; y: number } {
  const inner = adjustConnectionPointScreen(rect, side)
  switch (side) {
    case 'left':
      return { x: inner.x - outsetScreen, y: inner.y }
    case 'right':
      return { x: inner.x + outsetScreen, y: inner.y }
    case 'top':
      return { x: inner.x, y: inner.y - outsetScreen }
    default:
      return { x: inner.x, y: inner.y + outsetScreen }
  }
}

/** True when the bar runs left↔right (top/bottom stacks); false = vertical bar in L/R gap. */
export function stackLineMarksHorizontal(stackSide: FrameStackSide): boolean {
  return stackSide === 'top' || stackSide === 'bottom'
}

/** Facing side from the live rectangles; stored side supplies the horizontal/vertical axis only. */
function facingStackSide(
  innerRect: RectLike,
  outerRect: RectLike,
  stackSide: FrameStackSide
): FrameStackSide {
  const innerCx = innerRect.left + innerRect.width / 2
  const innerCy = innerRect.top + innerRect.height / 2
  const outerCx = outerRect.left + outerRect.width / 2
  const outerCy = outerRect.top + outerRect.height / 2
  if (stackLineMarksHorizontal(stackSide)) {
    if (outerCy === innerCy) return stackSide
    return outerCy > innerCy ? 'bottom' : 'top'
  }
  if (outerCx === innerCx) return stackSide
  return outerCx > innerCx ? 'right' : 'left'
}

/** One edge-parallel bar halfway from an adjust border to its outside simulated connection point. */
function edgeLineScreenStyle(
  rect: RectLike,
  side: FrameStackSide,
  outsetScreen: number,
  hitPad: number
): CSSProperties {
  const edge = adjustConnectionPointScreen(rect, side)
  const exit = adjustExitPointScreen(rect, side, outsetScreen)
  const barHorizontal = stackLineMarksHorizontal(side)
  if (barHorizontal) {
    const pad = rect.width * PARALLEL_INSET
    const y = (edge.y + exit.y) / 2
    return {
      position: 'fixed',
      left: rect.left + pad,
      width: Math.max(2, rect.width - 2 * pad),
      top: y - hitPad / 2,
      height: hitPad,
      zIndex: 40,
    }
  }
  const pad = rect.height * PARALLEL_INSET
  const x = (edge.x + exit.x) / 2
  return {
    position: 'fixed',
    top: rect.top + pad,
    height: Math.max(2, rect.height - 2 * pad),
    left: x - hitPad / 2,
    width: hitPad,
    zIndex: 40,
  }
}

/** Settled pair: one bar outside each facing adjust border. */
export function stackLinePairScreenStyles(
  innerRect: RectLike,
  outerRect: RectLike,
  stackSide: FrameStackSide,
  zoom: number,
  frameUiScale: number
): { inner: CSSProperties; outer: CSSProperties } {
  const outsetScreen = INDICATOR_OUTSET * frameUiScale * Math.max(0.01, zoom)
  const hitPad = Math.max(12 * zoom, 10 * frameUiScale * zoom)
  const facingSide = facingStackSide(innerRect, outerRect, stackSide)
  const outerSide = oppositeStackSide(facingSide)
  return {
    inner: edgeLineScreenStyle(innerRect, facingSide, outsetScreen, hitPad),
    outer: edgeLineScreenStyle(outerRect, outerSide, outsetScreen, hitPad),
  }
}

/** Dashed snap-preview segment — anchored to the dragged adjust box, sliding along the host edge. */
export function stackLinePreviewStyle(
  hostRect: RectLike,
  draggedRect: RectLike,
  stackSide: FrameStackSide,
  _zoom: number,
  _frameUiScale: number,
  lineThickness = 2
): CSSProperties {
  const facingSide = facingStackSide(hostRect, draggedRect, stackSide)
  const mateSide = oppositeStackSide(facingSide)
  const pDrag = adjustConnectionPointScreen(draggedRect, mateSide)
  const barHorizontal = stackLineMarksHorizontal(stackSide)
  const padW = draggedRect.width * PARALLEL_INSET
  const padH = draggedRect.height * PARALLEL_INSET

  if (barHorizontal) {
    return {
      position: 'absolute',
      left: draggedRect.left + padW,
      width: Math.max(2, draggedRect.width - 2 * padW),
      height: lineThickness,
      top: pDrag.y - lineThickness / 2,
    }
  }
  return {
    position: 'absolute',
    top: draggedRect.top + padH,
    height: Math.max(2, draggedRect.height - 2 * padH),
    width: lineThickness,
    left: pDrag.x - lineThickness / 2,
  }
}
