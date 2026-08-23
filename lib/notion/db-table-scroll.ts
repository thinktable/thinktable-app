import { DB_TABLE_ROW_HEIGHT } from '@/components/notion-db-virtual-body'

const EDGE = 4 // px slack for at-edge detection
const LOAD_MORE_RESERVE = 36 // px under scroll body for Load more row

/** Innermost overflow:hidden ancestor — the unlocked-resize spacer (not the outer fill shell). */
function findFrameClipEl(from: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = from.parentElement
  while (node) {
    const st = getComputedStyle(node)
    const clips = st.overflowY === 'hidden' || st.overflow === 'hidden'
    if (clips && node.clientHeight >= 48) return node
    if (node.classList.contains('react-flow__node')) break
    node = node.parentElement
  }
  return null
}

/** Uniform scale on el (1 when untransformed). */
function uniformScale(el: HTMLElement): number {
  const rect = el.getBoundingClientRect()
  const oh = el.offsetHeight
  if (oh > 0 && rect.height > 0) {
    const s = rect.height / oh
    if (s > 0.05 && s < 20) return s
  }
  let node: HTMLElement | null = el.parentElement
  while (node) {
    const r = node.getBoundingClientRect()
    const h = node.offsetHeight
    if (h > 0 && r.height > 0) {
      const s = r.height / h
      if (Math.abs(s - 1) > 0.02 && s > 0.05 && s < 20) return s
    }
    if (node.classList.contains('react-flow__node')) break
    node = node.parentElement
  }
  return 1
}

/**
 * Free-resize: scroll max-height in layout px (as many rows as fit in the clip box).
 * Screen clip bottom → scroll top, ÷ CSS scale; falls back to host clipBoxH − chrome.
 */
export function notionDbFreeResizeScrollCap(
  scrollEl: HTMLElement,
  clipHeightHint?: number | null
): number | null {
  const clip = findFrameClipEl(scrollEl)
  const scale = Math.max(0.15, uniformScale(scrollEl))

  if (clip) {
    const clipRect = clip.getBoundingClientRect()
    const scrollRect = scrollEl.getBoundingClientRect()
    const available = (clipRect.bottom - scrollRect.top - LOAD_MORE_RESERVE) / scale
    if (available >= DB_TABLE_ROW_HEIGHT * 2) return Math.floor(available)
  }

  if (clipHeightHint != null && clipHeightHint > 96) {
    return Math.max(DB_TABLE_ROW_HEIGHT * 3, Math.floor(clipHeightHint - 88))
  }

  return null
}

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
