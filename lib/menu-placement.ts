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
 * Selected content menus should not cover: armed TipTap blocks, then selected frames.
 * `exclude` is the menu root so we never treat ourselves as an obstacle.
 */
export function getMenuAvoidRects(exclude?: Element | null): MenuRect[] {
  const out: MenuRect[] = [] // Collected obstacles
  const push = (el: Element) => {
    if (exclude && (exclude === el || exclude.contains(el) || el.contains(exclude))) return // Skip the menu itself
    const r = el.getBoundingClientRect() // Screen box
    if (r.width < 1 || r.height < 1) return // Invisible
    out.push(boxFromDom(r)) // Keep
  }
  document.querySelectorAll('.tt-block-highlight').forEach(push) // Armed / selected blocks (blue wash)
  if (out.length === 0) document.querySelectorAll('.react-flow__node.selected').forEach(push) // Frame selection when no block is armed
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

/** Sum of overlap with every avoid rect (lower is better). */
function avoidScore(placed: MenuRect, avoid: MenuRect[]): number {
  let s = 0 // Accumulator
  for (const a of avoid) s += overlapArea(placed, a) // Covering selected content is expensive
  return s
}

export type ApplyMenuPlacementOpts = {
  anchorX: number // Preferred menu origin X (grip / click)
  anchorY: number // Preferred menu origin Y
  openLeft: boolean // Caller preference: park to the left of the anchor
  preferredFlyoutTop?: number // Viewport Y to align a row flyout (Color / Connections)
  fromExisting?: boolean // Keep CSS first-paint (e.g. above-click) and only clamp / attach flyouts
}

/**
 * Measure a fixed/absolute menu + its `[data-tt-menu-flyout]` children and park them
 * inside the safe rect. Submenus always open to the RIGHT of the parent card; the main
 * card may slide left on first place so the strip fits, then stays locked under the pointer.
 */
export function applyMenuPlacement(root: HTMLElement, opts: ApplyMenuPlacementOpts): void {
  const safe = getMenuSafeRect() // Chrome-free window
  const avoid = getMenuAvoidRects(root) // Selected block / frame
  const body = root.querySelector('[data-tt-menu-body]') as HTMLElement | null // Inner scroller (search chrome stays put)
  const flyout = root.querySelector('[data-tt-menu-flyout="main"]') as HTMLElement | null // Turn into / Color / Shape / …
  const nested = root.querySelector('[data-tt-menu-flyout="nested"]') as HTMLElement | null // Board in (off Turn into)

  root.style.maxHeight = '' // Measure natural height
  root.style.overflow = 'visible' // Flyouts must not clip during measure
  if (body) body.style.maxHeight = '' // Natural body
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
  // Lock Y when a flyout is attaching — shifting the card under the pointer closes Turn into on hover.
  const top = clampStart(
    existing ? existing.top : opts.anchorY, // Cursor menus stay where CSS put them; grip menus use the click Y
    existing ? menuMaxH : clusterH, // Existing: only keep the main card in-lane; flyout clamps on its own
    safe.top,
    safe.bottom
  ) // Keep the main card in the vertical lane

  type Side = 'left' | 'right' // Flyout parks on this side of the menu
  type Cand = { menuLeft: number; flyoutSide: Side; nestedSide: Side; score: number } // One horizontal layout

  // Submenus always open to the RIGHT of the parent card (Turn into / Color / Shape / Board in / …).
  const flyoutSide: Side = 'right'
  const nestedSide: Side = 'right'
  const extra = (flyoutW ? GAP + flyoutW : 0) + (nestedW ? GAP + nestedW : 0) // Width added by right-side submenus
  const clusterW = menuW + extra // Total strip when flyouts sit beside the menu

  const cands: Cand[] = [] // Try left-of-anchor and right-of-anchor for the main card only
  const menuLeftPrefs: number[] = existing
    ? [existing.left] // Keep the card under the pointer once a flyout is open
    : [opts.anchorX - GAP - menuW, opts.anchorX + GAP] // openLeft then open-right

  for (const pref of menuLeftPrefs) {
    let menuLeft = pref // Start from the preferred menu origin
    // When not locked under the pointer, slide the card left so the right-side strip fits.
    if (!existing && extra > 0) {
      const clusterRight = menuLeft + menuW + extra // Strip grows rightward
      if (clusterRight > safe.right) menuLeft -= clusterRight - safe.right // Make room on the right
    }
    menuLeft = clampStart(menuLeft, menuW, safe.left, safe.right) // Menu itself must stay in the lane
    const clusterBox = box(menuLeft, top, Math.min(clusterW, safe.width), clusterH) // Score the right-growing strip
    const sidePenalty =
      existing || (pref < opts.anchorX) === opts.openLeft ? 0 : 50_000 // Prefer the caller's openLeft unless we kept CSS paint
    const score = avoidScore(clusterBox, avoid) + sidePenalty // Covering selection is the main cost
    cands.push({ menuLeft, flyoutSide, nestedSide, score }) // Keep
  }

  cands.sort((a, b) => a.score - b.score) // Best (least coverage / closest to preference) first
  const best = cands[0] ?? {
    menuLeft: clampStart(existing?.left ?? opts.anchorX, menuW, safe.left, safe.right),
    flyoutSide: 'right' as Side,
    nestedSide: 'right' as Side,
    score: 0,
  } // Fallback

  setViewportPos(root, best.menuLeft, top) // Park the main card
  const chrome = body ? Math.max(0, root.getBoundingClientRect().height - body.getBoundingClientRect().height) : 0 // Search + label above the scroller
  if (body) body.style.maxHeight = `${Math.max(0, menuMaxH - chrome)}px` // Shrink rows; keep search visible
  else {
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
