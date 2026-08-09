/**
 * DOM transform helpers — rotation-safe local↔screen math for frame chrome.
 * getBoundingClientRect AABB width/height ≠ local×scale once an ancestor has CSS rotate.
 */

/** Uniform local→screen scale from ancestor CSS transforms (RF zoom, frameScale, rotate, …). */
export function elementUniformScale(el: HTMLElement): number {
  let m = new DOMMatrix() // Accumulate CTM linear part
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const t = getComputedStyle(n).transform // Per-element matrix — walk parents
    if (t && t !== 'none') m = new DOMMatrix(t).multiply(m)
  }
  const s = Math.hypot(m.a, m.b) // Length of transformed local X basis
  return s > 0.01 ? s : 1
}

/** Cumulative linear transform matrix from localEl up through ancestors. */
function cumulativeLinear(localEl: HTMLElement): DOMMatrix {
  let m = new DOMMatrix()
  for (let n: HTMLElement | null = localEl; n; n = n.parentElement) {
    const t = getComputedStyle(n).transform
    if (t && t !== 'none') m = new DOMMatrix(t).multiply(m)
  }
  return new DOMMatrix([m.a, m.b, m.c, m.d, 0, 0]) // Drop translation — layout origin via probe
}

/** Screen position of local (0,0) inside localEl (0×0 probe — not an AABB corner). */
function localOriginScreen(localEl: HTMLElement): { x: number; y: number } {
  const probe = localEl.ownerDocument.createElement('div')
  probe.style.cssText =
    'position:absolute;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none'
  const cs = getComputedStyle(localEl)
  const needsRel = cs.position === 'static'
  if (needsRel) localEl.style.position = 'relative'
  localEl.appendChild(probe)
  const o = probe.getBoundingClientRect()
  localEl.removeChild(probe)
  if (needsRel) localEl.style.position = ''
  return { x: o.left, y: o.top }
}

/**
 * Map a screen (client) point into `localEl`'s CSS px — correct under ancestor rotate/scale.
 * Uses a 0×0 probe at local (0,0) plus the inverse of the cumulative linear transform.
 */
export function screenToLocal(
  localEl: HTMLElement,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const linInv = cumulativeLinear(localEl).inverse()
  const o = localOriginScreen(localEl)
  const p = new DOMPoint(clientX - o.x, clientY - o.y).matrixTransform(linInv)
  return { x: p.x, y: p.y }
}

/** Map a local CSS px point inside `localEl` to screen (client) coords — rotation-safe. */
export function localToScreen(
  localEl: HTMLElement,
  localX: number,
  localY: number
): { x: number; y: number } {
  const lin = cumulativeLinear(localEl)
  const o = localOriginScreen(localEl)
  const p = new DOMPoint(localX, localY).matrixTransform(lin)
  return { x: o.x + p.x, y: o.y + p.y }
}
