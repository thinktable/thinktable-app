// Image src predicate — string-only, no TipTap or React imports.
// Server code (Turn into → Notion convert routes) needs this; importing it from `image-block.ts`
// pulled @tiptap/core + the NodeView component into server bundles and broke `next build`.

/** True when text can be used as an image src (http(s) or data:image). */
export function looksLikeImageSrc(text: string): boolean {
  const t = (text || '').trim() // Ignore surrounding whitespace from the source block
  if (!t) return false // Empty block → placeholder, not a broken img
  if (t.startsWith('data:image/')) return true // Inline data URLs from local upload
  try {
    const u = new URL(t) // Reject non-URLs (plain sentences)
    return u.protocol === 'http:' || u.protocol === 'https:' // Embed only web URLs
  } catch {
    return false // Not a URL
  }
}
