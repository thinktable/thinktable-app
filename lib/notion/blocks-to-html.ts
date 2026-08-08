// Convert a Notion block tree into TipTap HTML for one Thinktable frame

import { richTextToHtml, type NotionBlock, type NotionRichText } from './blocks'

/** Read the typed payload object for a block (e.g. block.paragraph). */
function payload(block: NotionBlock): Record<string, unknown> {
  const data = block[block.type] // Notion nests fields under the type key
  return (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
}

/** Rich text from a block payload. */
function blockRichText(block: NotionBlock): NotionRichText[] {
  const p = payload(block)
  return (p.rich_text as NotionRichText[] | undefined) || []
}

/** Convert nested children (or empty paragraph) for container blocks. */
function childrenHtml(block: NotionBlock): string {
  if (block.children && block.children.length > 0) {
    return notionBlocksToHtml(block.children) // Recurse into nested tree
  }
  return '<p></p>' // TipTap containers require at least one block
}

/** Emit HTML for a single Notion block (lists are handled by the grouper). */
function blockToHtml(block: NotionBlock): string {
  const type = block.type // Discriminator
  const text = richTextToHtml(blockRichText(block)) // Common rich_text path
  const p = payload(block)

  switch (type) {
    case 'paragraph':
      return `<p>${text || '<br>'}</p>` // Empty → keep a paragraph node
    case 'heading_1':
      return `<h1>${text}</h1>`
    case 'heading_2':
      return `<h2>${text}</h2>`
    case 'heading_3':
      return `<h3>${text}</h3>`
    case 'quote':
      return `<blockquote><p>${text || '<br>'}</p></blockquote>`
    case 'code': {
      const codeText = richTextToHtml(blockRichText(block)) // Code is plain-ish rich_text
      const lang = typeof p.language === 'string' ? p.language : '' // Optional language
      const langAttr = lang ? ` class="language-${escapeAttr(lang)}"` : ''
      return `<pre><code${langAttr}>${codeText}</code></pre>`
    }
    case 'divider':
      return '<hr>'
    case 'bulleted_list_item': {
      const nested = block.children?.length ? notionBlocksToHtml(block.children) : ''
      return `<li><p>${text || '<br>'}</p>${nested}</li>` // Nested lists stay inside the li
    }
    case 'numbered_list_item': {
      const nested = block.children?.length ? notionBlocksToHtml(block.children) : ''
      return `<li><p>${text || '<br>'}</p>${nested}</li>`
    }
    case 'to_do': {
      const checked = p.checked === true // Checkbox state
      const nested = block.children?.length ? notionBlocksToHtml(block.children) : ''
      return `<li data-type="taskItem" data-checked="${checked ? 'true' : 'false'}"><label><input type="checkbox"${checked ? ' checked' : ''}><div><p>${text || '<br>'}</p>${nested}</div></label></li>`
    }
    case 'callout': {
      const nested = block.children?.length ? notionBlocksToHtml(block.children) : '' // Optional nested blocks
      return `<div data-type="callout"><p>${text || '<br>'}</p>${nested}</div>`
    }
    case 'toggle': {
      const nested = block.children?.length ? notionBlocksToHtml(block.children) : ''
      return `<div data-type="toggleList"><p>${text || '<br>'}</p>${nested}</div>`
    }
    case 'equation': {
      const expr = typeof p.expression === 'string' ? p.expression : text // Prefer expression field
      return `<div data-type="blockEquation"><p>${escapeText(expr)}</p></div>`
    }
    case 'image': {
      const url = externalOrFileUrl(p) // Notion file / external
      const caption = richTextToHtml((p.caption as NotionRichText[]) || [])
      if (!url) return caption ? `<p>${caption}</p>` : ''
      return `<p><a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${caption || escapeText(url)}</a></p>`
    }
    case 'bookmark':
    case 'embed':
    case 'link_preview':
    case 'video':
    case 'file':
    case 'pdf': {
      const url = typeof p.url === 'string' ? p.url : externalOrFileUrl(p)
      const caption = richTextToHtml((p.caption as NotionRichText[]) || [])
      if (!url) return caption ? `<p>${caption}</p>` : ''
      return `<p><a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${caption || escapeText(url)}</a></p>`
    }
    case 'child_page': {
      const title = typeof p.title === 'string' ? p.title : 'Untitled' // Nested page title
      return `<p>${escapeText(title)}</p>` // Mention as text; mindmap mode maps pages separately
    }
    case 'child_database': {
      const title = typeof p.title === 'string' ? p.title : 'Untitled database'
      return `<p>${escapeText(title)}</p>`
    }
    case 'column_list': {
      const cols = block.children || [] // column blocks
      const count = Math.min(5, Math.max(2, cols.length || 2))
      const inner = cols.map((col) => childrenHtml(col)).join('') // Flatten column bodies
      return `<div data-type="columns" data-columns="${count}">${inner || '<p></p>'}</div>`
    }
    case 'column':
      return childrenHtml(block) // Flattened by column_list
    case 'table':
    case 'table_row':
      // Tables need structure TipTap doesn’t model yet — flatten cell text
      if (type === 'table_row') {
        const cells = (p.cells as NotionRichText[][] | undefined) || []
        const cellText = cells.map((c) => richTextToHtml(c)).filter(Boolean).join(' · ')
        return cellText ? `<p>${cellText}</p>` : ''
      }
      return block.children?.length ? notionBlocksToHtml(block.children) : ''
    case 'synced_block':
      return `<div data-type="syncedBlock">${childrenHtml(block)}</div>`
    case 'unsupported':
    case 'breadcrumb':
    case 'table_of_contents':
      return '' // No useful body content
    default: {
      // Unknown block with rich_text → paragraph; else skip
      if (blockRichText(block).length > 0) return `<p>${text}</p>`
      if (block.children?.length) return notionBlocksToHtml(block.children)
      return ''
    }
  }
}

/** Pull url from Notion file/external wrappers. */
function externalOrFileUrl(p: Record<string, unknown>): string | null {
  const external = p.external as { url?: string } | undefined
  if (external?.url) return external.url
  const file = p.file as { url?: string } | undefined
  if (file?.url) return file.url
  return null
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Convert an ordered Notion block list to TipTap HTML.
 * Consecutive list / to_do items are wrapped in one ul/ol so they stay one list.
 */
export function notionBlocksToHtml(blocks: NotionBlock[]): string {
  const parts: string[] = [] // Output fragments
  let i = 0

  while (i < blocks.length) {
    const block = blocks[i]
    const type = block.type

    // Group consecutive bulleted items
    if (type === 'bulleted_list_item') {
      const items: string[] = []
      while (i < blocks.length && blocks[i].type === 'bulleted_list_item') {
        items.push(blockToHtml(blocks[i]))
        i += 1
      }
      parts.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    // Group consecutive numbered items
    if (type === 'numbered_list_item') {
      const items: string[] = []
      while (i < blocks.length && blocks[i].type === 'numbered_list_item') {
        items.push(blockToHtml(blocks[i]))
        i += 1
      }
      parts.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    // Group consecutive to-dos into a TipTap taskList
    if (type === 'to_do') {
      const items: string[] = []
      while (i < blocks.length && blocks[i].type === 'to_do') {
        items.push(blockToHtml(blocks[i]))
        i += 1
      }
      parts.push(`<ul data-type="taskList">${items.join('')}</ul>`)
      continue
    }

    const html = blockToHtml(block)
    if (html) parts.push(html)
    i += 1
  }

  return parts.join('') // Single HTML string for one frame
}

/** Full page body HTML, or empty paragraph when the Notion page has no blocks. */
export function notionPageBodyToHtml(blocks: NotionBlock[]): string {
  const html = notionBlocksToHtml(blocks).trim()
  return html || '<p></p>' // TipTap always needs a node
}
