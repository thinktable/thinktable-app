// Wrap TipTap HTML with AI pending / origin inline marks (block tags stay outside)
const BLOCK_RE =
  /(<(?:p|h[1-4]|li|blockquote|div)(?:\s[^>]*)?>)([\s\S]*?)(<\/(?:p|h[1-4]|li|blockquote|div)>)/gi

/** True when HTML already has any AI-origin provenance spans. */
export function htmlHasAiOrigin(html: string | null | undefined): boolean {
  return !!html && /data-ai-origin=["']true["']/.test(html)
}

/** True when HTML has pending AI edit spans. */
export function htmlHasAiPending(html: string | null | undefined): boolean {
  return !!html && /data-ai-pending=["']true["']/.test(html)
}

/** Wrap block inners with ai-pending rainbow spans (skips already marked). */
export function markHtmlWithAiPending(html: string): string {
  if (!html?.trim()) return html
  if (htmlHasAiPending(html)) return html // Idempotent
  return html.replace(BLOCK_RE, (_m, open, inner, close) => {
    if (/data-ai-pending=/.test(inner)) return `${open}${inner}${close}`
    const stripped = String(inner).replace(/^\s+|\s+$/g, '')
    if (!stripped || stripped === '<br>' || stripped === '<br/>') return `${open}${inner}${close}`
    return `${open}<span data-ai-pending="true" class="tt-ai-pending">${inner}</span>${close}`
  })
}

/** Wrap block inners with ai-origin reddish provenance (skips empty / already marked). */
export function markHtmlWithAiOrigin(html: string): string {
  if (!html?.trim()) return html
  if (htmlHasAiOrigin(html)) return html
  return html.replace(BLOCK_RE, (_m, open, inner, close) => {
    if (/data-ai-origin=/.test(inner)) return `${open}${inner}${close}`
    const stripped = String(inner).replace(/^\s+|\s+$/g, '')
    if (!stripped || stripped === '<br>' || stripped === '<br/>') return `${open}${inner}${close}`
    return `${open}<span data-ai-origin="true" class="tt-ai-origin">${inner}</span>${close}`
  })
}

/** Promote pending marks to origin (save) and drop pending class. */
export function promotePendingToOrigin(html: string): string {
  return html
    .replace(/data-ai-pending=["']true["']/g, 'data-ai-origin="true"')
    .replace(/\btt-ai-pending\b/g, 'tt-ai-origin')
}

/** Strip pending marks only (discard path keeps origin if any). */
export function stripAiPending(html: string): string {
  return html
    .replace(/<span[^>]*data-ai-pending=["']true["'][^>]*>/gi, '')
    .replace(/<\/span>/gi, (close, offset, full) => {
      // Naive strip is unsafe — use paired remove instead
      return close
    })
}

/** Remove pending wrapper spans while keeping inner HTML. */
export function unwrapAiPending(html: string): string {
  return html.replace(
    /<span[^>]*data-ai-pending=["']true["'][^>]*>([\s\S]*?)<\/span>/gi,
    '$1'
  )
}

/** Remove origin wrapper spans (rare — full rewrite by user). */
export function unwrapAiOrigin(html: string): string {
  return html.replace(
    /<span[^>]*data-ai-origin=["']true["'][^>]*>([\s\S]*?)<\/span>/gi,
    '$1'
  )
}
