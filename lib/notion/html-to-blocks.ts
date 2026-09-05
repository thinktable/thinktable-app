// TipTap HTML → Notion block payloads (push page body back to Notion)

import type { NotionRichText } from './blocks'

/** Shape for PATCH /v1/blocks/{id}/children — one new block. */
export type NotionBlockCreate = {
  object: 'block'
  type: string
  [key: string]: unknown
}

const MAX_RICH_TEXT = 2000 // Notion per-span limit (truncate long lines)

/** Strip tags to plain text for a simple rich_text span. */
function plainFromHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/** One Notion text span (formatting stripped in v1 — plain sync). */
function textSpan(content: string): NotionRichText[] {
  const text = content.slice(0, MAX_RICH_TEXT)
  if (!text) return []
  return [{ type: 'text', text: { content: text } }]
}

function paragraphBlock(text: string): NotionBlockCreate {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: textSpan(text) },
  }
}

function headingBlock(level: 1 | 2 | 3, text: string): NotionBlockCreate {
  const key = `heading_${level}` as const
  return {
    object: 'block',
    type: key,
    [key]: { rich_text: textSpan(text) },
  }
}

function todoBlock(text: string, checked: boolean): NotionBlockCreate {
  return {
    object: 'block',
    type: 'to_do',
    to_do: { rich_text: textSpan(text), checked },
  }
}

function listItemBlock(type: 'bulleted_list_item' | 'numbered_list_item', text: string): NotionBlockCreate {
  return {
    object: 'block',
    type,
    [type]: { rich_text: textSpan(text) },
  }
}

/** Extract inner HTML of the first matching tag (non-greedy). */
function firstInner(html: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const m = html.match(re)
  return m ? m[1] : html
}

/** Split `<li>...</li>` chunks from a list element. */
function splitListItems(listHtml: string): string[] {
  const items: string[] = []
  const re = /<li\b[^>]*>([\s\S]*?)<\/li>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(listHtml))) {
    items.push(m[1])
  }
  return items
}

/** Skip or stub TipTap atoms that have no Notion block equivalent. */
function atomToParagraph(outer: string): NotionBlockCreate | null {
  if (/data-type=["']boardLink["']/i.test(outer)) {
    const title = outer.match(/data-title=["']([^"']*)["']/i)?.[1] || 'Linked page'
    return paragraphBlock(`[Page: ${plainFromHtml(title)}]`)
  }
  if (/data-type=["']databaseBlock["']/i.test(outer)) {
    const title = outer.match(/data-title=["']([^"']*)["']/i)?.[1] || 'Database'
    return paragraphBlock(`[Database: ${plainFromHtml(title)}]`)
  }
  if (/data-type=["'](?:propertyBlock|imageBlock)["']/i.test(outer)) return null
  return null
}

/**
 * Convert TipTap frame HTML to top-level Notion blocks for page-body sync.
 * Supports paragraphs, headings, lists, tasks, quotes, dividers, and code blocks.
 */
export function htmlToNotionBlocks(html: string): NotionBlockCreate[] {
  const trimmed = (html || '').trim()
  if (!trimmed || trimmed === '<p></p>' || trimmed === '<p><br></p>') {
    return [paragraphBlock('')]
  }

  const blocks: NotionBlockCreate[] = []
  const re =
    /<(p|h1|h2|h3|ul|ol|blockquote|hr|pre|div)\b[^>]*>[\s\S]*?<\/\1>|<hr\s*\/?>/gi
  let match: RegExpExecArray | null
  let lastIndex = 0
  const matches: Array<{ index: number; chunk: string }> = []

  while ((match = re.exec(trimmed))) {
    matches.push({ index: match.index, chunk: match[0] })
    lastIndex = re.lastIndex
  }

  if (matches.length === 0) {
    const plain = plainFromHtml(trimmed)
    return plain ? [paragraphBlock(plain)] : [paragraphBlock('')]
  }

  for (const { chunk } of matches) {
  const tag = chunk.match(/^<(\w+)/i)?.[1]?.toLowerCase() || ''

    if (tag === 'hr') {
      blocks.push({ object: 'block', type: 'divider', divider: {} })
      continue
    }

    if (tag === 'div' && /data-type=["'](?:boardLink|databaseBlock)["']/i.test(chunk)) {
      const stub = atomToParagraph(chunk)
      if (stub) blocks.push(stub)
      continue
    }

    if (tag === 'div') continue // Other atoms / columns — skip in v1

    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      const level = Number(tag[1]) as 1 | 2 | 3
      blocks.push(headingBlock(level, plainFromHtml(firstInner(chunk, tag))))
      continue
    }

    if (tag === 'blockquote') {
      const inner = plainFromHtml(firstInner(chunk, 'blockquote'))
      blocks.push({
        object: 'block',
        type: 'quote',
        quote: { rich_text: textSpan(inner) },
      })
      continue
    }

    if (tag === 'pre') {
      const codeInner = firstInner(chunk, 'pre')
      const code = plainFromHtml(firstInner(codeInner, 'code') || codeInner)
      blocks.push({
        object: 'block',
        type: 'code',
        code: { rich_text: textSpan(code), language: 'plain text' },
      })
      continue
    }

    if (tag === 'ul') {
      const isTask = /data-type=["']taskList["']/i.test(chunk)
      for (const li of splitListItems(chunk)) {
        if (isTask) {
          const checked = /data-checked=["']true["']/i.test(li)
          const body = plainFromHtml(firstInner(li, 'li'))
          blocks.push(todoBlock(body, checked))
        } else {
          blocks.push(listItemBlock('bulleted_list_item', plainFromHtml(firstInner(li, 'li'))))
        }
      }
      continue
    }

    if (tag === 'ol') {
      for (const li of splitListItems(chunk)) {
        blocks.push(listItemBlock('numbered_list_item', plainFromHtml(firstInner(li, 'li'))))
      }
      continue
    }

    if (tag === 'p') {
      const text = plainFromHtml(chunk)
      blocks.push(paragraphBlock(text || ''))
    }
  }

  return blocks.length > 0 ? blocks : [paragraphBlock('')]
}
