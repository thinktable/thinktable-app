// Convert markdown-ish AI content into TipTap-ready HTML (task lists, bullets, tables→checklists)

/** Escape plain text for TipTap HTML. */
export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** One TipTap task-list item (unchecked). */
function taskItemHtml(text: string): string {
  return `<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>${escapeHtmlText(text) || '<br>'}</p></div></li>`
}

/** One TipTap bullet list item. */
function bulletItemHtml(text: string): string {
  return `<li><p>${escapeHtmlText(text) || '<br>'}</p></li>`
}

/** One TipTap ordered list item. */
function orderedItemHtml(text: string): string {
  return `<li><p>${escapeHtmlText(text) || '<br>'}</p></li>`
}

/** True when line looks like a markdown pipe-table row. */
function isPipeRow(line: string): boolean {
  const t = line.trim()
  return t.startsWith('|') && t.includes('|', 1)
}

/** True when line is a markdown table separator (|---|---|). */
function isPipeSeparator(line: string): boolean {
  const t = line.trim()
  return /^\|?[\s:|-]+\|[\s:|-]*\|?$/.test(t) && /-/.test(t)
}

/** Parse a pipe row into cell strings. */
function splitPipeCells(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|').map((c) => c.trim())
}

/**
 * Convert markdown-ish text (or already-HTML) into TipTap HTML.
 * - `- [ ]` / `- [x]` → taskList
 * - pipe tables → taskList ("col1 — col2 …"), never raw `|` paragraphs
 * - `- item` → bulletList
 * - `1. item` → orderedList
 * - blank lines split paragraph/list groups
 */
export function markdownToTipTapHtml(input: string): string {
  const raw = (input || '').trim()
  if (!raw) return '<p></p>'
  // Already TipTap/HTML — leave alone (model may return contentHtml)
  if (/<(?:p|ul|ol|h[1-4]|table|div|li)\b/i.test(raw)) return raw

  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      i += 1
      continue
    }

    // Markdown pipe table → checklist (no TipTap Table extension)
    if (isPipeRow(trimmed)) {
      const tableLines: string[] = []
      while (i < lines.length && isPipeRow(lines[i].trim())) {
        tableLines.push(lines[i].trim())
        i += 1
      }
      const dataRows = tableLines.filter((r) => !isPipeSeparator(r))
      // Drop header row when a separator follows in the original block
      const hadSeparator = tableLines.some(isPipeSeparator)
      const rows = hadSeparator && dataRows.length > 1 ? dataRows.slice(1) : dataRows
      const items = rows.map((r) => {
        const cells = splitPipeCells(r).filter(Boolean)
        return cells.join(' — ')
      })
      if (items.length) {
        out.push(`<ul data-type="taskList">${items.map(taskItemHtml).join('')}</ul>`)
      }
      continue
    }

    // Task checklist lines
    if (/^[-*]\s+\[[ xX]\]\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^[-*]\s+\[[ xX]\]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+\[[ xX]\]\s+/, ''))
        i += 1
      }
      out.push(`<ul data-type="taskList">${items.map(taskItemHtml).join('')}</ul>`)
      continue
    }

    // Bullet list
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim()) && !/^[-*]\s+\[[ xX]\]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''))
        i += 1
      }
      out.push(`<ul>${items.map(bulletItemHtml).join('')}</ul>`)
      continue
    }

    // Numbered list
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ''))
        i += 1
      }
      out.push(`<ol>${items.map(orderedItemHtml).join('')}</ol>`)
      continue
    }

    // Plain paragraph (join soft-wrapped consecutive non-list lines until blank)
    const para: string[] = [trimmed]
    i += 1
    while (i < lines.length) {
      const n = lines[i].trim()
      if (!n) break
      if (isPipeRow(n) || /^[-*]\s+/.test(n) || /^\d+[.)]\s+/.test(n)) break
      para.push(n)
      i += 1
    }
    out.push(`<p>${escapeHtmlText(para.join(' '))}</p>`)
  }

  return out.join('') || '<p></p>'
}

/** Title paragraph + body (markdown or HTML). Title is content, not metadata.blockTitle. */
export function frameContentFromAi(title: string, body: string): string {
  const bodyHtml = markdownToTipTapHtml(body)
  const t = (title || '').trim()
  if (!t) return bodyHtml
  // Avoid duplicating title when body already starts with it
  const plainStart = bodyHtml.replace(/<[^>]+>/g, '').trim().toLowerCase()
  if (plainStart.startsWith(t.toLowerCase())) return bodyHtml
  return `<p><strong>${escapeHtmlText(t)}</strong></p>${bodyHtml}`
}
