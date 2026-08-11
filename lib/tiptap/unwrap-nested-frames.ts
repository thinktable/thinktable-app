// Flatten legacy TipTap nestedFrame wrappers so old HTML still loads after nesting was removed.
// Replaces each div[data-type=nestedFrame] with its children (keeps inner blocks).

/** True when HTML still contains a nestedFrame wrapper. */
export function htmlHasNestedFrame(html: string | null | undefined): boolean {
  if (!html) return false
  return /data-type=["']nestedFrame["']/i.test(html)
}

/**
 * Unwrap all nestedFrame shells in an HTML string.
 * Safe no-op when none are present. Browser DOMParser when available; regex fallback otherwise.
 */
export function unwrapNestedFramesHtml(html: string): string {
  if (!htmlHasNestedFrame(html)) return html

  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    // Repeat until no wrappers remain (nested nests)
    let guard = 0
    while (guard++ < 20) {
      const nests = doc.querySelectorAll('div[data-type="nestedFrame"]')
      if (nests.length === 0) break
      nests.forEach((el) => {
        const parent = el.parentNode
        if (!parent) return
        while (el.firstChild) parent.insertBefore(el.firstChild, el)
        parent.removeChild(el)
      })
    }
    return doc.body.innerHTML
  }

  // SSR / no DOM: non-greedy unwrap one level at a time
  let out = html
  for (let i = 0; i < 20; i++) {
    const next = out.replace(
      /<div\b[^>]*\bdata-type=["']nestedFrame["'][^>]*>([\s\S]*?)<\/div>/gi,
      '$1'
    )
    if (next === out) break
    out = next
  }
  return out
}
