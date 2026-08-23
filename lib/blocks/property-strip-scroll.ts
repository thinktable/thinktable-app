const EDGE = 2 // px slack for at-edge detection

/**
 * Plain wheel over the top property strip: scroll horizontally when possible;
 * at edges let the board pan/zoom. Used from board-flow capture handler.
 */
export function propertyStripConsumeWheelScroll(
  target: EventTarget | null,
  e: WheelEvent
): boolean {
  if (!(target instanceof Element)) return false
  const scrollEl = target.closest('[data-tt-property-scroll]') as HTMLElement | null
  if (!scrollEl) return false

  const canScrollX = scrollEl.scrollWidth > scrollEl.clientWidth + EDGE
  if (!canScrollX) return false

  const atLeft = scrollEl.scrollLeft <= EDGE
  const atRight = scrollEl.scrollLeft + scrollEl.clientWidth >= scrollEl.scrollWidth - EDGE
  const { deltaY, deltaX } = e

  if (deltaX !== 0) {
    const goingLeft = deltaX < 0
    const goingRight = deltaX > 0
    if ((goingLeft && atLeft) || (goingRight && atRight)) {
      e.preventDefault()
      e.stopPropagation()
      return true
    }
    scrollEl.scrollLeft += deltaX
    e.preventDefault()
    e.stopPropagation()
    return true
  }

  if (deltaY === 0) return false
  const goingUp = deltaY < 0
  const goingDown = deltaY > 0
  if ((goingUp && atLeft) || (goingDown && atRight)) return false

  scrollEl.scrollLeft += deltaY
  e.preventDefault()
  e.stopPropagation()
  return true
}
