// Stack line sits between simulated thread connection points:
// inner frame’s outside indicator (exit) ↔ outer frame’s inside edge anchor.

import type { CSSProperties } from 'react'
import { INDICATOR_OUTSET } from '@/components/threads/handle-ids'
import type { FrameStackSide } from '@/lib/frame-side-stacks'

type RectLike = { left: number; top: number; width: number; height: number }

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

/** Screen-fixed hit box + stroke lane for the settled stack line portal. */
export function stackLineScreenStyle(
  innerRect: RectLike,
  outerRect: RectLike,
  stackSide: FrameStackSide,
  zoom: number,
  frameUiScale: number
): CSSProperties {
  const outsetScreen = INDICATOR_OUTSET * frameUiScale * Math.max(0.01, zoom)
  const hitPad = Math.max(12 * zoom, 10 * frameUiScale * zoom)
  const mateSide = oppositeStackSide(stackSide)
  const pInner = adjustExitPointScreen(innerRect, stackSide, outsetScreen)
  const pOuter = adjustConnectionPointScreen(outerRect, mateSide)
  const segmentHorizontal = stackSide === 'left' || stackSide === 'right'

  if (segmentHorizontal) {
    const left = Math.min(pInner.x, pOuter.x)
    const width = Math.max(2, Math.abs(pOuter.x - pInner.x))
    const y = (pInner.y + pOuter.y) / 2
    return {
      position: 'fixed',
      left,
      width,
      top: y - hitPad / 2,
      height: hitPad,
      paddingTop: hitPad / 2 - 1,
      zIndex: 40,
    }
  }
  const top = Math.min(pInner.y, pOuter.y)
  const height = Math.max(2, Math.abs(pOuter.y - pInner.y))
  const x = (pInner.x + pOuter.x) / 2
  return {
    position: 'fixed',
    top,
    height,
    left: x - hitPad / 2,
    width: hitPad,
    paddingLeft: hitPad / 2 - 1,
    zIndex: 40,
  }
}

/** True when stack marks should run horizontally (L/R stacks). */
export function stackLineMarksHorizontal(stackSide: FrameStackSide): boolean {
  return stackSide === 'left' || stackSide === 'right'
}

/** Dashed snap-preview segment in viewport coordinates. */
export function stackLinePreviewStyle(
  innerRect: RectLike,
  outerRect: RectLike,
  stackSide: FrameStackSide,
  zoom: number,
  frameUiScale: number,
  lineThickness = 2
): CSSProperties {
  const outsetScreen = INDICATOR_OUTSET * frameUiScale * Math.max(0.01, zoom)
  const mateSide = oppositeStackSide(stackSide)
  const pInner = adjustExitPointScreen(innerRect, stackSide, outsetScreen)
  const pOuter = adjustConnectionPointScreen(outerRect, mateSide)
  const segmentHorizontal = stackSide === 'left' || stackSide === 'right'

  if (segmentHorizontal) {
    const left = Math.min(pInner.x, pOuter.x)
    const width = Math.max(2, Math.abs(pOuter.x - pInner.x))
    const y = (pInner.y + pOuter.y) / 2
    return {
      position: 'absolute',
      left,
      width,
      height: lineThickness,
      top: y - lineThickness / 2,
    }
  }
  const top = Math.min(pInner.y, pOuter.y)
  const height = Math.max(2, Math.abs(pOuter.y - pInner.y))
  const x = (pInner.x + pOuter.x) / 2
  return {
    position: 'absolute',
    top,
    height,
    width: lineThickness,
    left: x - lineThickness / 2,
  }
}
