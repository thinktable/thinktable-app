const EDGE = 4 // px slack for at-edge detection

/** Mac trackpad pinch arrives as ctrl+wheel — never treat as table scroll. */
function isMacTrackpadPinch(e: WheelEvent): boolean {
  const isMac = /Mac|iPhone|iPod|iPad/i.test(navigator.platform)
  return isMac && e.ctrlKey && !e.metaKey
}

/** Cmd/Ctrl flips Scroll↔Zoom — always let the board handle (zoom in Scroll mode). */
function isWheelAlternateMod(e: WheelEvent): boolean {
  if (e.metaKey) return true
  if (e.ctrlKey && !isMacTrackpadPinch(e)) return true
  return false
}

export type NotionDbWheelOpts = {
  /** false when Zoom nav is sticky — plain wheel should zoom the map, not scroll the table. */
  isScrollMode?: boolean
}

/**
 * Plain wheel over a selected Notion DB scroll body (Scroll nav only): scroll when
 * possible; at edges absorb so the board does not pan. Pinch / Cmd/Ctrl zoom always
 * pass through to the map.
 */
export function notionDbConsumeWheelScroll(
  target: EventTarget | null,
  e: WheelEvent,
  opts?: NotionDbWheelOpts
): boolean {
  // Pinch + Cmd/Ctrl zoom must still reach the board handlers
  if (isMacTrackpadPinch(e) || isWheelAlternateMod(e)) return false

  // Zoom-nav sticky: plain wheel zooms the map (not table scroll)
  if (opts?.isScrollMode === false) return false

  if (!(target instanceof Element)) return false
  const scrollEl = target.closest('.tt-notion-db-scroll-active') as HTMLElement | null
  if (!scrollEl) return false

  const canScrollY = scrollEl.scrollHeight > scrollEl.clientHeight + EDGE
  const canScrollX = scrollEl.scrollWidth > scrollEl.clientWidth + EDGE
  if (!canScrollY && !canScrollX) return false

  const atTop = scrollEl.scrollTop <= EDGE
  const atBottom = scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - EDGE
  const atLeft = scrollEl.scrollLeft <= EDGE
  const atRight = scrollEl.scrollLeft + scrollEl.clientWidth >= scrollEl.scrollWidth - EDGE

  const { deltaY, deltaX } = e
  let blockPan = false

  if (deltaY !== 0 && canScrollY) {
    const goingUp = deltaY < 0
    const goingDown = deltaY > 0
    if ((goingUp && atTop) || (goingDown && atBottom)) {
      blockPan = true // At edge — swallow pan only
    } else {
      scrollEl.scrollTop += deltaY
      blockPan = true
    }
  }

  if (deltaX !== 0 && canScrollX) {
    const goingLeft = deltaX < 0
    const goingRight = deltaX > 0
    if ((goingLeft && atLeft) || (goingRight && atRight)) {
      blockPan = true
    } else {
      scrollEl.scrollLeft += deltaX
      blockPan = true
    }
  }

  if (!blockPan) return false
  e.preventDefault()
  e.stopPropagation()
  return true
}
