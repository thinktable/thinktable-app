// Shared floating-menu placement — stay in the window, miss chrome, miss selected content.

export type MenuRect = { left: number; top: number; right: number; bottom: number; width: number; height: number } // Screen-space box

const GAP = 8 // Space between menu, flyout, and the thing they must not cover
const PAD = 8 // Inset from the usable (chrome-free) rectangle

/** Convert a DOM rect into a plain box we can score / clamp. */
function boxFromDom(r: DOMRect): MenuRect {
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } // Copy numbers (DOMRect is live)
}

/** Intersection area of two boxes (0 when they miss). */
function overlapArea(a: MenuRect, b: MenuRect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left) // Horizontal overlap
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) // Vertical overlap
  if (w <= 0 || h <= 0) return 0 // No hit
  return w * h // px²
}

/** Build a box from left/top/size. */
function box(left: number, top: number, width: number, height: number): MenuRect {
  return { left, top, right: left + width, bottom: top + height, width, height } // Derived right/bottom
}

/**
 * Usable screen rectangle for menus.
 * Excludes the top bar (toggle + tools) and the chat dock / sidebar so menus never cover them.
 */
export function getMenuSafeRect(): MenuRect {
  let left = PAD // Start inset from the window
  let top = PAD // Start inset from the window
  let right = window.innerWidth - PAD // Start inset from the window
  let bottom = window.innerHeight - PAD // Start inset from the window

  const topBar = document.querySelector('[data-edit-top-bar]') as HTMLElement | null // Actions / Layout / Draw / View bar
  if (topBar) {
    const r = topBar.getBoundingClientRect() // Current bar box
    if (r.height > 1) top = Math.max(top, r.bottom + PAD) // Sit fully below the bar (toggle + title + tools)
  }

  const dock = document.querySelector('[data-chat-map-dock]') as HTMLElement | null // Phone AI composer stack
  if (dock) {
    const r = dock.getBoundingClientRect() // Dock box
    const shown = r.height > 1 && getComputedStyle(dock).opacity !== '0' && getComputedStyle(dock).pointerEvents !== 'none' // Closed dock stays mounted at opacity 0
    if (shown) bottom = Math.min(bottom, r.top - PAD) // Stay above the chat cards (transcript / chrome / prompt)
  }

  const sidebar = document.querySelector('[data-chat-sidebar]:not([data-chat-map-dock])') as HTMLElement | null // Desktop chat column
  if (sidebar) {
    const r = sidebar.getBoundingClientRect() // Column box
    if (r.width > 1 && r.left > window.innerWidth * 0.4) right = Math.min(right, r.left - PAD) // Don't spill into the chat column
  }

  const toggle = document.querySelector('[data-chat-sidebar-toggle]') as HTMLElement | null // Brand mark that opens chat
  if (toggle) {
    const r = toggle.getBoundingClientRect() // Toggle box
    if (r.height > 1 && r.top > window.innerHeight * 0.5) bottom = Math.min(bottom, r.top - PAD) // Stay above the brand when the dock is closed
  }

  if (right < left) right = left // Degenerate: empty width
  if (bottom < top) bottom = top // Degenerate: empty height
  return { left, top, right, bottom, width: right - left, height: bottom - top } // Usable area
}

/** Re-place when the window or the phone keyboard (visualViewport) changes the safe rect. */
export function watchMenuSafeRect(cb: () => void): () => void {
  window.addEventListener('resize', cb) // Desktop window / top-bar wrap
  window.visualViewport?.addEventListener('resize', cb) // iOS keyboard inset
  window.visualViewport?.addEventListener('scroll', cb) // iOS visualViewport offset while typing
  return () => {
    window.removeEventListener('resize', cb)
    window.visualViewport?.removeEventListener('resize', cb)
    window.visualViewport?.removeEventListener('scroll', cb)
  }
}

/** Top-bar tool dropdowns — same as Actions (Filter / Automations): under the trigger, never over the board path. */
export const TOOLBAR_MENU_PLACEMENT = {
  align: 'start' as const, // Grow right from the glyph, not left across the path
  side: 'bottom' as const, // Stay under the 52px bar
  sideOffset: 8, // Clear the bar like Automations (default 4px still sits on the path)
  sticky: 'always' as const, // Tall Capture/Present panels must not flip up over the path
}

/** Radix collisionPadding matching getMenuSafeRect (viewport insets). */
export function getMenuCollisionPadding(): { top: number; left: number; right: number; bottom: number } {
  const s = getMenuSafeRect() // Same chrome exclusions
  return {
    top: s.top, // Distance from window top → safe top
    left: s.left, // Distance from window left → safe left
    right: window.innerWidth - s.right, // Distance from window right → safe right
    bottom: window.innerHeight - s.bottom, // Distance from window bottom → safe bottom
  }
}

/**
 * Soft obstacles: armed TipTap blocks, then selected frames.
 * `exclude` is the menu root so we never treat ourselves as an obstacle.
 */
export function getMenuAvoidRects(exclude?: Element | null): MenuRect[] {
  const out: MenuRect[] = [] // Collected obstacles
  const seen = new Set<Element>() // Don't add the same node twice (thread + overlap)
  const push = (el: Element) => {
    if (seen.has(el)) return // Already in the list
    if (exclude && (exclude === el || exclude.contains(el) || el.contains(exclude))) return // Skip the menu itself
    const r = el.getBoundingClientRect() // Screen box
    if (r.width < 1 || r.height < 1) return // Invisible
    seen.add(el) // Remember
    out.push(boxFromDom(r)) // Keep
  }
  document.querySelectorAll('.tt-block-highlight').forEach(push) // Armed / selected blocks (blue wash)
  if (out.length === 0) document.querySelectorAll('.react-flow__node.selected').forEach(push) // Frame selection when no block is armed
  // Selected thread curve + the frames it meets — thread click menu must not sit on the arch.
  const edgeBoxes: MenuRect[] = [] // Thread AABBs used to find attached frames
  document.querySelectorAll('.react-flow__edge.selected').forEach((el) => {
    const r = el.getBoundingClientRect() // Path + interaction stroke
    if (r.width < 0.5 && r.height < 0.5) return // Degenerate
    const b = boxFromDom(r) // Screen box
    edgeBoxes.push(b) // For frame overlap
    if (exclude && (exclude === el || exclude.contains(el) || el.contains(exclude))) return // Skip if somehow inside the menu
    out.push(b) // Soft-avoid the curve
  })
  if (edgeBoxes.length > 0) {
    document.querySelectorAll('.react-flow__node').forEach((el) => {
      const r = el.getBoundingClientRect() // Frame box
      if (r.width < 1 || r.height < 1) return // Hidden
      const nb = boxFromDom(r) // Screen box
      for (const eb of edgeBoxes) {
        if (overlapArea(nb, inflate(eb, GAP)) > 0) {
          push(el) // Attached / overlapping frame (snapped pair under a top↔top thread)
          break
        }
      }
    })
  }
  return out
}

/**
 * Hard obstacles: ⋮⋮ grips (TipTap + pre-frame I-bar). Menu must never cover these —
 * even when it still overlaps the block text.
 */
export function getMenuHandleRects(exclude?: Element | null): MenuRect[] {
  const out: MenuRect[] = [] // Collected grips
  const push = (el: Element) => {
    if (exclude && (exclude === el || exclude.contains(el) || el.contains(exclude))) return // Skip the menu itself
    const r = el.getBoundingClientRect() // Screen box
    if (r.width < 1 || r.height < 1) return // Invisible
    out.push(boxFromDom(r)) // Keep
  }
  document.querySelectorAll('[data-tt-block-handle], [data-tt-ibar-grip]').forEach(push) // Frame ⋮⋮ + I-bar grip
  return out
}

/** Clamp a size into the safe rect (shrink if the window is shorter than the menu). */
function clampSize(natural: number, limit: number): number {
  return Math.max(0, Math.min(natural, Math.max(0, limit))) // Fit the lane even when it's shorter than a few rows
}

/** Clamp a point so a box of `size` stays inside [min, max]. */
function clampStart(pref: number, size: number, min: number, max: number): number {
  if (size >= max - min) return min // Bigger than the lane — pin to the start and let maxHeight shrink
  return Math.min(Math.max(pref, min), max - size) // Prefer pref, then slide
}

/** Inflate a box by `pad` so near-misses still count as covering. */
function inflate(r: MenuRect, pad: number): MenuRect {
  return box(r.left - pad, r.top - pad, r.width + pad * 2, r.height + pad * 2) // Grow outward
}

const HANDLE_COVER_PENALTY = 1_000_000_000 // Any grip overlap beats every soft preference
// Cost per px travelled from the click. Soft scores are px², so ~500px of travel costs about as
// much as covering a 10k px² sliver: the card sticks beside the frame it belongs to instead of
// taking a clear-but-distant slot (e.g. clamped against the chat column) that also scored 0.
const DIST_WEIGHT = 20

/** Soft block/frame coverage (px², GAP-padded). */
function softAvoidScore(placed: MenuRect, avoid: MenuRect[]): number {
  let s = 0 // Accumulator
  for (const a of avoid) s += overlapArea(placed, inflate(a, GAP)) // Prefer missing the wash
  return s
}

/** Distance from a point to a box (0 when the point is inside). */
function distToBox(x: number, y: number, b: MenuRect): number {
  const dx = Math.max(b.left - x, 0, x - b.right) // Horizontal gap
  const dy = Math.max(b.top - y, 0, y - b.bottom) // Vertical gap
  return Math.hypot(dx, dy) // Straight-line gap
}

/** The box the anchor sits in / closest to — the one the menu is actually about. */
function nearestBox(list: MenuRect[], x: number, y: number): MenuRect | null {
  let best: MenuRect | null = null // Winner
  let bestD = Infinity // Its distance
  for (const b of list) {
    const d = distToBox(x, y, b) // Gap from the click
    if (d < bestD) {
      best = b
      bestD = d
    }
  }
  return best
}

// Selection chrome is absolutely positioned and spills OUTSIDE the node's own border box, which
// `getBoundingClientRect` on the node does not include — measuring the node alone left the card
// sitting on the blue ring / connection dots.
const FRAME_CHROME_SEL =
  '.react-flow__resize-control, [data-frame-chrome], [data-tt-connection-indicator], [data-tt-block-handle]'

/** A frame's real on-screen box: its own rect grown to cover its selection chrome. */
function visualNodeRect(el: Element): MenuRect {
  let r = boxFromDom(el.getBoundingClientRect()) // Node border box
  el.querySelectorAll(FRAME_CHROME_SEL).forEach((c) => {
    const cr = boxFromDom(c.getBoundingClientRect()) // Ring / dot / ⋮⋮ box
    if (cr.width < 1 || cr.height < 1) return // Hidden
    r = unionBox(r, cr) // Grow
  })
  return r
}

/** Smallest frame box that fully contains `inner` — an armed block's host frame. */
function hostFrameRect(inner: MenuRect): MenuRect | null {
  let best: Element | null = null // Tightest container so far
  let bestArea = Infinity // Its area
  const nodes = document.querySelectorAll('.react-flow__node') // Frames (selected or not)
  nodes.forEach((el) => {
    const r = boxFromDom(el.getBoundingClientRect()) // Frame box (chrome measured only for the winner)
    if (r.width < 1 || r.height < 1) return // Hidden
    const contains =
      r.left <= inner.left + 1 && r.right >= inner.right - 1 && r.top <= inner.top + 1 && r.bottom >= inner.bottom - 1
    if (!contains) return // Not the host
    const area = r.width * r.height // Prefer the tightest (frame, not a blockGroup wrapper)
    if (area < bestArea) {
      best = el
      bestArea = area
    }
  })
  return best ? visualNodeRect(best) : null
}

/** Smallest box covering both inputs. */
function unionBox(a: MenuRect, b: MenuRect): MenuRect {
  const left = Math.min(a.left, b.left) // Outer edges
  const top = Math.min(a.top, b.top)
  return box(left, top, Math.max(a.right, b.right) - left, Math.max(a.bottom, b.bottom) - top) // Cover both
}

/** Hard grip coverage — must stay 0 whenever a clear placement exists. */
function hardHandleScore(placed: MenuRect, handles: MenuRect[]): number {
  let s = 0 // Accumulator
  for (const h of handles) s += overlapArea(placed, inflate(h, GAP)) // Never cover ⋮⋮
  return s * HANDLE_COVER_PENALTY // Dominates soft avoid + side preference
}

export type ApplyMenuPlacementOpts = {
  anchorX: number // Preferred menu origin X (grip / click)
  anchorY: number // Preferred menu origin Y
  openLeft: boolean // Caller preference: park to the left of the anchor
  preferredFlyoutTop?: number // Viewport Y to align a row flyout (Color / Connections)
  fromExisting?: boolean // Keep CSS first-paint (e.g. above-click) and only clamp / attach flyouts
  extraHard?: MenuRect[] // Extra never-cover boxes (clicked thread curve + its frames)
}

/** Screen boxes for a clicked thread — curve + endpoint frames. Menu must not sit on these. */
export function getThreadCoverRects(edgeId?: string, sourceId?: string, targetId?: string): MenuRect[] {
  const out: MenuRect[] = [] // Collected never-cover boxes
  const pushSel = (sel: string) => {
    document.querySelectorAll(sel).forEach((el) => {
      const r = el.getBoundingClientRect() // Path / node screen box
      if (r.width < 0.5 && r.height < 0.5) return // Degenerate
      out.push(boxFromDom(r)) // Keep
    })
  }
  if (edgeId) {
    const id = CSS.escape(edgeId) // RF id may contain special chars
    pushSel(`.react-flow__edge[data-id="${id}"]`) // Wrapper g / div
    pushSel(`[data-testid="rf__edge-${id}"]`) // RF 11 test id fallback
  }
  pushSel('.react-flow__edge.selected') // Any selected thread curve
  if (sourceId) {
    const id = CSS.escape(sourceId) // Frame id
    pushSel(`.react-flow__node[data-id="${id}"]`) // Source frame
    pushSel(`[data-testid="rf__node-${id}"]`) // RF 11 test id fallback
  }
  if (targetId) {
    const id = CSS.escape(targetId) // Frame id
    pushSel(`.react-flow__node[data-id="${id}"]`) // Target frame
    pushSel(`[data-testid="rf__node-${id}"]`) // RF 11 test id fallback
  }
  return out
}

/**
 * Measure a fixed/absolute menu + its `[data-tt-menu-flyout]` children and park them
 * inside the safe rect. Submenus always open to the RIGHT of the parent card; the main
 * card may slide left on first place so the strip fits, then stays locked under the pointer
 * — except it will still shift to clear a ⋮⋮ grip.
 */
export function applyMenuPlacement(root: HTMLElement, opts: ApplyMenuPlacementOpts): void {
  const safe = getMenuSafeRect() // Chrome-free window
  // Obstacles outside the lane can never be covered, so they only add noise — worse, each one
  // offers a "beside me" origin, and a grip inside the open chat column pushed the card against
  // the column edge instead of leaving it beside the frame.
  const inLane = (b: MenuRect) => overlapArea(b, safe) > 0
  const avoid = getMenuAvoidRects(root).filter(inLane) // Selected block / frame (soft)
  const handles = [...getMenuHandleRects(root), ...(opts.extraHard ?? [])].filter(inLane) // ⋮⋮ grips + thread curve (hard — never cover)
  const body = root.querySelector('[data-tt-menu-body]') as HTMLElement | null // Inner scroller (search chrome stays put)
  const flyout = root.querySelector('[data-tt-menu-flyout="main"]') as HTMLElement | null // Turn into / Color / Shape / …
  const nested = root.querySelector('[data-tt-menu-flyout="nested"]') as HTMLElement | null // Board in (off Turn into)

  root.style.maxHeight = '' // Measure natural height
  root.style.overflow = 'visible' // Flyouts must not clip during measure
  root.style.display = '' // Flex column applied after measure
  root.style.flexDirection = ''
  root.style.overflowY = ''
  if (body) {
    body.style.maxHeight = '' // Natural body
    body.style.minHeight = ''
    body.style.flex = ''
    body.style.overflowY = ''
  }
  for (const child of root.children) {
    const el = child as HTMLElement
    if (el === body || el.dataset.ttMenuFlyout) continue
    el.style.flexShrink = '' // Clear chrome clamp from the last pass
  }
  if (flyout) flyout.style.maxHeight = '' // Natural flyout
  if (nested) nested.style.maxHeight = '' // Natural nested

  const menuW = Math.ceil(root.getBoundingClientRect().width) // Card width (overflow flyouts do not expand the box)
  const menuH = Math.ceil(root.getBoundingClientRect().height) // Card height — not scrollHeight (that includes flyouts)
  const flyoutW = flyout ? Math.ceil(flyout.getBoundingClientRect().width) : 0 // Flyout width (0 = closed)
  const flyoutH = flyout ? Math.ceil(flyout.getBoundingClientRect().height) : 0 // Flyout card height
  const nestedW = nested ? Math.ceil(nested.getBoundingClientRect().width) : 0 // Nested width
  const nestedH = nested ? Math.ceil(nested.getBoundingClientRect().height) : 0 // Nested card height

  const menuMaxH = clampSize(menuH, safe.height) // Shrink the main card if the lane is short
  const flyoutMaxH = flyout ? clampSize(flyoutH, safe.height) : 0 // Shrink the flyout independently
  const nestedMaxH = nested ? clampSize(nestedH, safe.height) : 0 // Shrink Board in independently

  const clusterH = Math.max(menuMaxH, flyoutMaxH, nestedMaxH) // Tallest card in the cluster
  const existing = opts.fromExisting ? root.getBoundingClientRect() : null // First-paint box (translate already applied)

  type Side = 'left' | 'right' // Flyout parks on this side of the menu
  type Cand = {
    menuLeft: number
    top: number
    flyoutSide: Side
    nestedSide: Side
    score: number
    dist: number // Tiebreak: how far this box sits from the click / current card
  } // One layout

  // Submenus always open to the RIGHT of the parent card (Turn into / Color / Shape / Board in / …).
  const flyoutSide: Side = 'right'
  const nestedSide: Side = 'right'
  const extra = (flyoutW ? GAP + flyoutW : 0) + (nestedW ? GAP + nestedW : 0) // Width added by right-side submenus
  const clusterW = menuW + extra // Total strip when flyouts sit beside the menu

  // Preferred origins: miss grips hard, miss block soft — left/right/above/below.
  const originPrefs: Array<{ left: number; top: number; prefer: boolean }> = []
  const pushOrigin = (left: number, top: number, prefer = false) => {
    originPrefs.push({ left, top, prefer }) // Deduped below
  }
  if (existing) {
    // Prefer staying under the pointer once a flyout is open — but still try clear-of-grip nudges.
    pushOrigin(existing.left, existing.top, true)
  } else {
    // Caller openLeft / open-right of the grip (first paint matches BlockActionsMenu CSS).
    pushOrigin(opts.anchorX - GAP - menuW, opts.anchorY, opts.openLeft)
    pushOrigin(opts.anchorX + GAP, opts.anchorY, !opts.openLeft)
  }
  // Soft: clear of the highlighted block / selected frame.
  // Only while the card is being placed. Re-offering these once it is up (`existing`) is what
  // made the card hop to the far side of the frame the moment a flyout opened — the submenu is
  // allowed to cover the frame instead.
  // Only the obstacle under (or nearest) the anchor supplies origins: a selected thread pulls
  // every frame it touches into `avoid`, and offering a slot beside each of those parked the card
  // against the far window edge while a clear gap sat right beside the clicked frame. The rest of
  // `avoid` is still scored, so the winner still prefers to miss them.
  const primaryAvoid = existing ? null : nearestBox(avoid, opts.anchorX, opts.anchorY)
  for (const a of primaryAvoid ? [primaryAvoid] : []) {
    pushOrigin(a.left - GAP - menuW, existing?.top ?? opts.anchorY, opts.openLeft) // Left of block
    pushOrigin(a.right + GAP, existing?.top ?? opts.anchorY, !opts.openLeft) // Right of block
    pushOrigin(a.left - GAP - menuW, a.top - GAP - menuMaxH, opts.openLeft) // Above-left
    pushOrigin(a.right + GAP, a.top - GAP - menuMaxH, !opts.openLeft) // Above-right
    pushOrigin(a.left - GAP - menuW, a.bottom + GAP, opts.openLeft) // Below-left
    pushOrigin(a.right + GAP, a.bottom + GAP, !opts.openLeft) // Below-right
  }
  // Hard: every candidate that fully clears a ⋮⋮ (required when the soft placement still hits the grip).
  for (const h of handles) {
    pushOrigin(h.left - GAP - menuW, existing?.top ?? opts.anchorY, opts.openLeft) // Left of grip
    pushOrigin(h.right + GAP, existing?.top ?? opts.anchorY, !opts.openLeft) // Right of grip
    pushOrigin(h.left - GAP - menuW, h.top - GAP - menuMaxH, opts.openLeft) // Above-left of grip
    pushOrigin(h.right + GAP, h.top - GAP - menuMaxH, !opts.openLeft) // Above-right of grip
    pushOrigin(h.left - GAP - menuW, h.bottom + GAP, opts.openLeft) // Below-left of grip
    pushOrigin(h.right + GAP, h.bottom + GAP, !opts.openLeft) // Below-right of grip
    if (existing) {
      // Keep Y under the flyout row when possible; only slide X clear of the grip.
      pushOrigin(h.left - GAP - menuW, existing.top, true)
      pushOrigin(h.right + GAP, existing.top, true)
    }
  }

  const cands: Cand[] = [] // Scored placements
  const refLeft = existing?.left ?? opts.anchorX // Tiebreak origin: current card, else the click
  const refTop = existing?.top ?? opts.anchorY
  const seen = new Set<string>() // Skip duplicate left/top after clamp
  for (const pref of originPrefs) {
    let menuLeft = pref.left // Start from the preferred menu origin
    // When not locked under the pointer, slide the card left so the right-side strip fits.
    if (!existing && extra > 0) {
      const clusterRight = menuLeft + menuW + extra // Strip grows rightward
      if (clusterRight > safe.right) menuLeft -= clusterRight - safe.right // Make room on the right
    }
    menuLeft = clampStart(menuLeft, menuW, safe.left, safe.right) // Menu itself must stay in the lane
    const top = clampStart(pref.top, existing ? menuMaxH : clusterH, safe.top, safe.bottom) // Vertical lane
    const key = `${menuLeft}|${top}` // After clamp, many prefs collapse
    if (seen.has(key)) continue // Already scored this box
    seen.add(key)
    // Score the main card for handle clearance (flyouts attach later; grip must stay clickable).
    const menuBox = box(menuLeft, top, menuW, menuMaxH) // Card only — not the whole flyout strip
    const clusterBox = box(menuLeft, top, Math.min(clusterW, safe.width), clusterH) // Soft-score the strip vs block
    // Covering a grip is forbidden; covering the block is discouraged; soft prefer openLeft / existing.
    const sidePenalty = existing || pref.prefer ? 0 : 1_000
    // Once placed, only the card is scored against the frame — scoring the whole strip made an
    // opening flyout look like new frame overlap and moved the card out from under the pointer.
    const softBox = existing ? menuBox : clusterBox
    const score = hardHandleScore(menuBox, handles) + softAvoidScore(softBox, avoid) + sidePenalty
    // Distance from the click (or the card's current spot) — several origins clear every obstacle
    // and used to tie at 0, so insertion order decided and the card could land against the far
    // window edge while a clear gap sat right beside the frame.
    const dist = Math.abs(menuLeft - refLeft) + Math.abs(top - refTop)
    cands.push({ menuLeft, top, flyoutSide, nestedSide, score: score + dist * DIST_WEIGHT, dist }) // Keep
  }

  // Explicit side rule for the card the user just opened: park flush LEFT of the frame / armed
  // block when the lane has room for it, else flush RIGHT of it. Scoring only gets a say when
  // neither side fits or both would cover a ⋮⋮ grip.
  const sideSlot = ((): Cand | null => {
    if (existing || !primaryAvoid) return null // Locked under the pointer / nothing to sit beside
    // Sit beside the whole FRAME, not just the armed block: `avoid` reports the block wash when one
    // is armed, and its right edge sits inside the frame — the card then landed on the frame's own
    // right edge. Union covers the block-only case (no host found) too.
    const host = hostFrameRect(primaryAvoid) // Frame that owns the block / the frame itself
    const beside = host ? unionBox(primaryAvoid, host) : primaryAvoid // Box the card must clear
    const top = clampStart(opts.anchorY, clusterH, safe.top, safe.bottom) // Same vertical lane as any candidate
    const slots = [beside.left - GAP - menuW, beside.right + GAP] // Left first, then right
    for (const menuLeft of slots) {
      if (menuLeft < safe.left || menuLeft + menuW > safe.right) continue // No room on this side
      if (hardHandleScore(box(menuLeft, top, menuW, menuMaxH), handles) > 0) continue // Would bury a ⋮⋮
      return { menuLeft, top, flyoutSide, nestedSide, score: 0, dist: 0 }
    }
    return null // Neither side fits — fall back to the scored candidates
  })()

  // Best (clear grips → least block cover → preference), then the closest such box to the anchor.
  cands.sort((a, b) => a.score - b.score || a.dist - b.dist)
  const best = sideSlot ?? cands[0] ?? {
    menuLeft: clampStart(existing?.left ?? opts.anchorX, menuW, safe.left, safe.right),
    top: clampStart(existing?.top ?? opts.anchorY, menuMaxH, safe.top, safe.bottom),
    flyoutSide: 'right' as Side,
    nestedSide: 'right' as Side,
    score: 0,
    dist: 0,
  } // Fallback

  setViewportPos(root, best.menuLeft, best.top) // Park the main card
  const top = best.top // Flyouts share this cluster top when not row-aligned
  const chrome = body ? Math.max(0, menuH - Math.ceil(body.getBoundingClientRect().height)) : 0 // Search + label above the scroller
  const bodyMaxH = Math.max(32, menuMaxH - chrome) // At least one row; clip from the bottom, never squash rows
  if (body) {
    root.style.display = 'flex' // Column: fixed chrome on top, scroller eats the rest
    root.style.flexDirection = 'column'
    root.style.maxHeight = `${menuMaxH}px` // Card height matches the safe lane
    for (const child of root.children) {
      const el = child as HTMLElement
      if (el === body || el.dataset.ttMenuFlyout) continue // Flyouts stay absolute outside the column
      el.style.flexShrink = '0' // Search / label never compress
    }
    body.style.flex = '1 1 auto' // Take leftover height under chrome
    body.style.minHeight = '0' // Let overflow-y scroll instead of flex-squashing rows
    body.style.maxHeight = `${bodyMaxH}px` // Clip from the bottom of the list
    body.style.overflowY = 'auto' // Scroll hidden rows
  } else {
    root.style.maxHeight = `${menuMaxH}px` // Slim menus (Notion connection) scroll as a whole
    root.style.overflowY = 'auto' // Enable the shrink
  }

  if (flyout) {
    const flyoutLeft = best.menuLeft + menuW + GAP // Always to the right of the menu
    const clampedFlyoutLeft = clampStart(flyoutLeft, flyoutW, safe.left, safe.right) // Stay in-window even if that overlaps the menu
    const prefFlyoutTop = opts.preferredFlyoutTop ?? top // Row-align Color / Connections; else share the cluster top
    const flyoutTop = clampStart(prefFlyoutTop, flyoutMaxH, safe.top, safe.bottom) // Vertical clamp for the flyout alone
    setRelativeTo(flyout, root, clampedFlyoutLeft, flyoutTop) // Position as an absolute child
    flyout.style.maxHeight = `${flyoutMaxH}px` // Shrink if the lane is short
    flyout.style.overflowY = 'auto' // Scroll leftover rows
  }

  if (nested && flyout) {
    const flyoutBox = flyout.getBoundingClientRect() // After the flyout has been placed
    const nestedLeft = flyoutBox.right + GAP // Always continue to the right of Turn into
    const clampedNestedLeft = clampStart(nestedLeft, nestedW, safe.left, safe.right) // Stay in-window
    const nestedTop = clampStart(flyoutBox.top, nestedMaxH, safe.top, safe.bottom) // Align with Turn into, then clamp
    setRelativeTo(nested, flyout, clampedNestedLeft, nestedTop) // Nested is a child of the Turn into flyout
    nested.style.maxHeight = `${nestedMaxH}px` // Shrink if needed
    nested.style.overflowY = 'auto' // Scroll leftover boards
  }
}

/** Write viewport left/top onto a fixed or absolute element. */
function setViewportPos(el: HTMLElement, left: number, top: number): void {
  const fixed = getComputedStyle(el).position === 'fixed' // Portaled menus are fixed
  if (fixed) {
    el.style.left = `${left}px` // Viewport X
    el.style.top = `${top}px` // Viewport Y
    el.style.transform = 'none' // Drop the CSS translate used for the first paint
    return
  }
  const parent = el.offsetParent as HTMLElement | null // Pane-absolute menus
  const pr = parent?.getBoundingClientRect() ?? { left: 0, top: 0 } // Parent origin in viewport
  el.style.left = `${left - pr.left}px` // Convert to parent space
  el.style.top = `${top - pr.top}px` // Convert to parent space
  el.style.transform = 'none' // Drop the CSS translate
}

/** Position `el` (absolute) so its viewport origin matches left/top, relative to `parent`. */
function setRelativeTo(el: HTMLElement, parent: HTMLElement, left: number, top: number): void {
  const pr = parent.getBoundingClientRect() // Parent viewport box
  el.style.left = `${left - pr.left}px` // Child offset X
  el.style.right = 'auto' // Don't fight left-full / right-full classes
  el.style.top = `${top - pr.top}px` // Child offset Y
}
