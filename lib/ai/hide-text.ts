// Hide text (TipTap haze mark) helpers for AI creates/edits and context export

import { escapeHtmlText } from '@/lib/ai/markdown-to-tiptap'

/** Plain-text marker the model can use in markdown or replacements. */
export const HIDE_OPEN = '[[hide]]'
export const HIDE_CLOSE = '[[/hide]]'

const HIDE_MARKER_RE = /\[\[hide\]\]([\s\S]*?)\[\[\/hide\]\]/gi

/** TipTap haze span wrapping escaped inner text. */
export function hazeSpanHtml(inner: string): string {
  return `<span data-haze="true" class="tt-haze">${escapeHtmlText(inner)}</span>`
}

/** Plain text with [[hide]]…[[/hide]] → inline HTML (haze spans + escaped plain). */
export function inlineHtmlWithHideMarkers(text: string): string {
  if (!text || !/\[\[hide\]\]/i.test(text)) return escapeHtmlText(text)
  const parts: string[] = []
  let last = 0
  let m: RegExpExecArray | null
  const re = new RegExp(HIDE_MARKER_RE.source, 'gi')
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(escapeHtmlText(text.slice(last, m.index)))
    parts.push(hazeSpanHtml(m[1]))
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(escapeHtmlText(text.slice(last)))
  return parts.join('')
}

/** Expand [[hide]] markers anywhere in an HTML string (model may use markers in contentHtml). */
export function expandHideMarkersInHtml(html: string): string {
  if (!html || !/\[\[hide\]\]/i.test(html)) return html
  return html.replace(HIDE_MARKER_RE, (_full, inner: string) => hazeSpanHtml(inner))
}

/** Wrap replacement newText for pending review — supports hide markers. */
export function pendingWrapReplacementHtml(newText: string): string {
  const body = /\[\[hide\]\]/i.test(newText)
    ? inlineHtmlWithHideMarkers(newText)
    : escapeHtmlText(newText)
  return `<span data-ai-pending="true" class="tt-ai-pending">${body}</span>`
}

/** Replace first haze span whose inner plain text equals `innerPlain`. */
export function replaceHazeSpanInHtml(
  html: string,
  innerPlain: string,
  newText: string
): string | null {
  const want = innerPlain.trim()
  if (!want) return null
  const re = /<span[^>]*data-haze=["']true["'][^>]*>([\s\S]*?)<\/span>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const got = m[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim()
    if (got !== want) continue
    const replacement = pendingWrapReplacementHtml(newText)
    return html.slice(0, m.index) + replacement + html.slice(m.index + m[0].length)
  }
  return null
}

/** Inner plain when oldText is [[hide]]…[[/hide]]. */
export function parseHideMarkerOldText(oldText: string): string | null {
  const m = oldText.match(/^\[\[hide\]\]([\s\S]*)\[\[\/hide\]\]$/i)
  return m ? m[1] : null
}

/** Context export: haze spans → [[hide]] markers, then strip other tags to plain. */
export function htmlToPlainWithHideAnnotations(html: string | null | undefined): string {
  if (!html) return ''
  const withMarkers = html.replace(
    /<span[^>]*data-haze=["']true["'][^>]*>([\s\S]*?)<\/span>/gi,
    `${HIDE_OPEN}$1${HIDE_CLOSE}`
  )
  return withMarkers
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
