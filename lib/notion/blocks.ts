// Fetch Notion block trees for a page (why: import page body into one Thinktable frame)

import { NOTION_VERSION } from './config'

/** Minimal Notion rich-text span used when rendering TipTap HTML. */
export type NotionRichText = {
  type?: string // Usually "text"
  plain_text?: string // Visible characters
  href?: string | null // Link target when present
  annotations?: {
    bold?: boolean
    italic?: boolean
    strikethrough?: boolean
    underline?: boolean
    code?: boolean
  }
  text?: { content?: string; link?: { url?: string } | null } // Structured text payload
}

/** Notion block shape we care about for HTML conversion. */
export type NotionBlock = {
  id: string // Block UUID
  type: string // paragraph | heading_1 | … 
  has_children?: boolean // Nested blocks under this one
  children?: NotionBlock[] // Filled when we recurse
  [key: string]: unknown // Type-specific payload (paragraph.rich_text, …)
}

/** Escape HTML special chars so Notion text cannot break our markup. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;') // Entity first so later tags stay literal
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Render one Notion rich_text array to inline HTML TipTap understands. */
export function richTextToHtml(richText: NotionRichText[] | undefined | null): string {
  if (!richText || richText.length === 0) return '' // Empty span → empty string
  return richText
    .map((span) => {
      let html = escapeHtml(span.plain_text || span.text?.content || '') // Start with plain text
      const a = span.annotations || {} // Formatting flags
      if (a.code) html = `<code>${html}</code>` // Inline code
      if (a.bold) html = `<strong>${html}</strong>`
      if (a.italic) html = `<em>${html}</em>`
      if (a.strikethrough) html = `<s>${html}</s>`
      if (a.underline) html = `<u>${html}</u>`
      const href = span.href || span.text?.link?.url // Prefer top-level href
      if (href) html = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${html}</a>`
      return html
    })
    .join('') // Concatenate adjacent spans
}

/** Paginate GET /v1/blocks/{id}/children for one parent. */
export async function fetchBlockChildren(
  accessToken: string,
  blockId: string,
  signal?: AbortSignal // Optional Cancel from Import pages / Generate mindmap
): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [] // Flat children of this parent
  let startCursor: string | undefined // Notion pagination cursor

  do {
    const url = new URL(`https://api.notion.com/v1/blocks/${blockId}/children`) // Children endpoint
    url.searchParams.set('page_size', '100') // Max page size
    if (startCursor) url.searchParams.set('start_cursor', startCursor) // Continue when set

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`, // User OAuth token
        'Notion-Version': NOTION_VERSION,
      },
      signal, // Stop paging when the user cancels
    })

    const payload = await res.json() // Parse Notion body
    if (!res.ok) {
      throw new Error(payload?.message || `Failed to fetch Notion blocks for ${blockId}`)
    }

    for (const result of payload.results || []) {
      if (result?.object === 'block' && result.id && result.type) {
        blocks.push(result as NotionBlock) // Keep API order
      }
    }

    startCursor = payload.has_more ? payload.next_cursor : undefined // Next page or stop
  } while (startCursor)

  return blocks
}

/**
 * Fetch a page’s block tree (top-level + nested children for toggles/lists/callouts).
 * Caps depth so deep pages don’t hammer the API.
 */
export async function fetchNotionPageBlockTree(
  accessToken: string,
  pageId: string,
  maxDepth = 4,
  signal?: AbortSignal // Optional Cancel from Import pages
): Promise<NotionBlock[]> {
  const walk = async (parentId: string, depth: number): Promise<NotionBlock[]> => {
    const children = await fetchBlockChildren(accessToken, parentId, signal) // One parent’s children
    if (depth >= maxDepth) return children // Stop recursing; keep leaf stubs

    // Load nested children only when Notion says they exist (and type needs them)
    await Promise.all(
      children.map(async (block) => {
        if (!block.has_children) return // Nothing nested
        // Skip child_page / child_database — those are separate Notion pages, not body content
        if (block.type === 'child_page' || block.type === 'child_database') return
        block.children = await walk(block.id, depth + 1) // Attach nested tree
      })
    )

    return children
  }

  return walk(pageId, 0) // Page id is a valid block parent for children
}
