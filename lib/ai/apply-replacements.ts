// Apply surgical text replacements inside TipTap HTML; mark only the new bits as pending/origin
import { markHtmlWithAiPending } from '@/lib/ai/wrap-ai-html'

export interface AiTextReplacement {
  oldText: string // Exact plain substring to find (first match)
  newText: string // Replacement plain text
}

/** Escape HTML special chars in plain text. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Strip tags to plain for locating matches (lossy but good enough for word edits). */
export function htmlToPlainLoose(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/**
 * Apply plain-text replacements inside HTML by rewriting the serialized HTML string.
 * Only the inserted newText is wrapped with ai-pending (not the whole block).
 */
export function applyReplacementsToHtml(
  html: string,
  replacements: AiTextReplacement[]
): { html: string; applied: number } {
  let next = html
  let applied = 0
  for (const r of replacements) {
    const oldText = (r.oldText || '').trim()
    const newText = r.newText ?? ''
    if (!oldText) continue

    // Prefer replacing inside text (avoid matching across tags when oldText is simple)
    const escapedOld = oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(escapedOld)
    if (!re.test(next.replace(/<[^>]+>/g, '\0'))) {
      // Fallback: raw HTML includes the plain substring (no tags inside the match)
      if (!next.includes(oldText)) continue
      const marked = `<span data-ai-pending="true" class="tt-ai-pending">${escapeHtml(newText)}</span>`
      next = next.replace(oldText, marked)
      applied += 1
      continue
    }

    // Walk: find oldText in tag-stripped projection, map back to HTML indices
    const mapped = replacePlainInHtml(next, oldText, newText)
    if (mapped) {
      next = mapped
      applied += 1
    }
  }
  return { html: next, applied }
}

/** Replace first plain occurrence of `oldText` inside HTML, wrapping `newText` in ai-pending. */
function replacePlainInHtml(html: string, oldText: string, newText: string): string | null {
  let plainIdx = 0
  let htmlStart = -1
  let htmlEnd = -1
  let matched = 0
  let inTag = false

  for (let i = 0; i < html.length; i++) {
    const ch = html[i]
    if (ch === '<') {
      inTag = true
      continue
    }
    if (ch === '>') {
      inTag = false
      continue
    }
    if (inTag) continue

    // Decode minimal entities at this position for matching
    let plainCh = ch
    let advance = 1
    if (ch === '&') {
      if (html.startsWith('&nbsp;', i)) {
        plainCh = ' '
        advance = 6
      } else if (html.startsWith('&amp;', i)) {
        plainCh = '&'
        advance = 5
      } else if (html.startsWith('&lt;', i)) {
        plainCh = '<'
        advance = 4
      } else if (html.startsWith('&gt;', i)) {
        plainCh = '>'
        advance = 4
      }
    }

    if (plainCh === oldText[matched]) {
      if (matched === 0) htmlStart = i
      matched += 1
      if (matched === oldText.length) {
        htmlEnd = i + advance
        break
      }
    } else {
      // Restart match if current char could start oldText
      if (plainCh === oldText[0]) {
        htmlStart = i
        matched = 1
      } else {
        matched = 0
        htmlStart = -1
      }
    }
    i += advance - 1
    plainIdx += 1
  }

  if (htmlStart < 0 || htmlEnd < 0) return null

  const marked = `<span data-ai-pending="true" class="tt-ai-pending">${escapeHtml(newText)}</span>`
  return html.slice(0, htmlStart) + marked + html.slice(htmlEnd)
}

/**
 * Infer a single old→new replacement from plain-text diff (common prefix/suffix).
 * Keeps rainbow marks on the changed span when the model rewrote the whole frame.
 */
export function inferReplacementsFromPlain(
  originalPlain: string,
  proposedPlain: string
): AiTextReplacement[] {
  const a = originalPlain
  const b = proposedPlain
  if (!a || !b || a === b) return []

  let prefix = 0
  const minLen = Math.min(a.length, b.length)
  while (prefix < minLen && a[prefix] === b[prefix]) prefix += 1

  let suffix = 0
  while (
    suffix < minLen - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const oldText = a.slice(prefix, a.length - suffix)
  const newText = b.slice(prefix, b.length - suffix)
  // Skip no-op / empty old (insertions need surrounding context — fall through to full mark)
  if (!oldText) return []
  return [{ oldText, newText }]
}

/** Build proposed HTML from original: surgical replacements, else full replace marked pending. */
export function buildProposedHtml(opts: {
  originalHtml: string
  contentHtml?: string
  replacements?: AiTextReplacement[]
}): string {
  const replacements = (opts.replacements || []).filter((r) => (r.oldText || '').trim())
  if (replacements.length > 0) {
    const { html, applied } = applyReplacementsToHtml(opts.originalHtml, replacements)
    if (applied > 0) return html
  }

  const full = opts.contentHtml?.trim()
    ? opts.contentHtml.includes('<')
      ? opts.contentHtml
      : `<p>${escapeHtml(opts.contentHtml)}</p>`
    : ''

  // Model often returns a full rewrite — derive the smallest plain diff and mark only that span
  if (full) {
    const inferred = inferReplacementsFromPlain(
      htmlToPlainLoose(opts.originalHtml),
      htmlToPlainLoose(full)
    )
    if (inferred.length > 0) {
      const { html, applied } = applyReplacementsToHtml(opts.originalHtml, inferred)
      if (applied > 0) return html
    }
    return markHtmlWithAiPending(full)
  }

  return markHtmlWithAiPending(opts.originalHtml)
}
