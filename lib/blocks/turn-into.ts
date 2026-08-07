// Turn into — transform block HTML + metadata like Notion (page promote included).

import type { SupabaseClient } from '@supabase/supabase-js' // Persist transforms
import type { BlockTypeId } from '@/components/block-actions-menu' // Shared type ids
import { ensurePageBodyBlock, migrateLegacyBlockFlags, syncBlockAndPageTitle } from '@/lib/blocks'

/** Strip tags → plain text (title / list item seed). */
export function htmlToPlainText(html: string): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n+/g, '\n')
    .trim()
}

/** Escape text for safe HTML insertion. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Split plain text into non-empty lines (fallback to single empty line). */
function linesFromHtml(html: string): string[] {
  const text = htmlToPlainText(html)
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.length > 0 ? lines : ['']
}

/** Inner block HTML preserved when wrapping (unwrap known turn-into shells first). */
function unwrapKnownShells(html: string): string {
  const trimmed = (html || '').trim() || '<p></p>'
  // Pull content out of our custom wrappers / headings / lists / quote / code
  const wrappers = [
    /^<div[^>]*data-type="(?:callout|toggleList|toggleHeading|blockEquation|syncedBlock|columns)"[^>]*>([\s\S]*)<\/div>$/i,
    /^<h[1-4][^>]*>([\s\S]*)<\/h[1-4]>$/i,
    /^<blockquote[^>]*>([\s\S]*)<\/blockquote>$/i,
    /^<pre[^>]*><code[^>]*>([\s\S]*)<\/code><\/pre>$/i,
    /^<ul[^>]*data-type="taskList"[^>]*>([\s\S]*)<\/ul>$/i,
    /^<ul[^>]*>([\s\S]*)<\/ul>$/i,
    /^<ol[^>]*>([\s\S]*)<\/ol>$/i,
  ]
  for (const re of wrappers) {
    const m = trimmed.match(re)
    if (m) {
      // List items → paragraphs
      if (/^<ul|^<ol/i.test(trimmed)) {
        const items = [...trimmed.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((x) => {
          const inner = x[1].replace(/<[^>]+>/g, '').trim()
          return `<p>${escapeHtml(inner) || '<br>'}</p>`
        })
        return items.join('') || '<p></p>'
      }
      const inner = m[1].trim()
      if (/^<p[\s>]/i.test(inner) || /^<h[1-4]/i.test(inner) || /^<div/i.test(inner)) {
        return inner || '<p></p>'
      }
      return `<p>${inner || '<br>'}</p>`
    }
  }
  return trimmed
}

/** Ensure content is at least one paragraph block. */
function asParagraphs(html: string): string {
  const unwrapped = unwrapKnownShells(html)
  if (/^<(p|h[1-4]|ul|ol|blockquote|pre|div)\b/i.test(unwrapped.trim())) {
    // If it's a bare heading, keep as paragraph body text
    const heading = unwrapped.trim().match(/^<h[1-4][^>]*>([\s\S]*)<\/h[1-4]>$/i)
    if (heading) return `<p>${heading[1] || '<br>'}</p>`
    return unwrapped
  }
  const text = htmlToPlainText(unwrapped)
  return text ? `<p>${escapeHtml(text)}</p>` : '<p></p>'
}

/**
 * Transform block HTML into the target Notion-like type.
 * Page / Page in do not change HTML here (promote handled separately).
 */
export function transformHtmlToBlockType(html: string, blockType: BlockTypeId): string {
  const body = asParagraphs(html)
  const lines = linesFromHtml(html)

  switch (blockType) {
    case 'text':
      return body
    case 'heading1':
      return `<h1>${escapeHtml(lines[0] || '') || '<br>'}</h1>`
    case 'heading2':
      return `<h2>${escapeHtml(lines[0] || '') || '<br>'}</h2>`
    case 'heading3':
      return `<h3>${escapeHtml(lines[0] || '') || '<br>'}</h3>`
    case 'heading4':
      return `<h4>${escapeHtml(lines[0] || '') || '<br>'}</h4>`
    case 'bulletedList':
      return `<ul>${lines.map((l) => `<li><p>${escapeHtml(l) || '<br>'}</p></li>`).join('')}</ul>`
    case 'numberedList':
      return `<ol>${lines.map((l) => `<li><p>${escapeHtml(l) || '<br>'}</p></li>`).join('')}</ol>`
    case 'todoList':
      return `<ul data-type="taskList">${lines
        .map(
          (l) =>
            `<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>${escapeHtml(l) || '<br>'}</p></div></li>`
        )
        .join('')}</ul>`
    case 'toggleList':
      return `<div data-type="toggleList">${body}</div>`
    case 'code': {
      const plain = htmlToPlainText(html)
      return `<pre><code>${escapeHtml(plain)}</code></pre>`
    }
    case 'quote':
      return `<blockquote>${body}</blockquote>`
    case 'callout':
      return `<div data-type="callout">${body}</div>`
    case 'blockEquation': {
      const plain = htmlToPlainText(html) || 'E = mc^2'
      return `<div data-type="blockEquation"><p>${escapeHtml(plain)}</p></div>`
    }
    case 'syncedBlock':
      return `<div data-type="syncedBlock">${body}</div>`
    case 'toggleHeading1':
      return `<div data-type="toggleHeading" data-level="1"><h1>${escapeHtml(lines[0] || '') || '<br>'}</h1>${lines
        .slice(1)
        .map((l) => `<p>${escapeHtml(l)}</p>`)
        .join('')}</div>`
    case 'toggleHeading2':
      return `<div data-type="toggleHeading" data-level="2"><h2>${escapeHtml(lines[0] || '') || '<br>'}</h2>${lines
        .slice(1)
        .map((l) => `<p>${escapeHtml(l)}</p>`)
        .join('')}</div>`
    case 'toggleHeading3':
      return `<div data-type="toggleHeading" data-level="3"><h3>${escapeHtml(lines[0] || '') || '<br>'}</h3>${lines
        .slice(1)
        .map((l) => `<p>${escapeHtml(l)}</p>`)
        .join('')}</div>`
    case 'toggleHeading4':
      return `<div data-type="toggleHeading" data-level="4"><h4>${escapeHtml(lines[0] || '') || '<br>'}</h4>${lines
        .slice(1)
        .map((l) => `<p>${escapeHtml(l)}</p>`)
        .join('')}</div>`
    case 'columns2':
    case 'columns3':
    case 'columns4':
    case 'columns5': {
      const count =
        blockType === 'columns2' ? 2 : blockType === 'columns3' ? 3 : blockType === 'columns4' ? 4 : 5
      // Distribute lines across columns (Notion-style multi-column layout)
      const cols = Array.from({ length: count }, () => [] as string[])
      lines.forEach((line, i) => {
        cols[i % count].push(`<p>${escapeHtml(line) || '<br>'}</p>`)
      })
      // Ensure every column has at least an empty paragraph
      const colHtml = cols.map((c) => c.join('') || '<p></p>').join('')
      return `<div data-type="columns" data-columns="${count}">${colHtml}</div>`
    }
    case 'page':
    case 'pageIn':
      // Content stays; promote creates the linked page
      return body
    default:
      return body
  }
}

export type ApplyTurnIntoOpts = {
  messageId: string
  conversationId: string // Current map
  userId: string
  blockType: BlockTypeId
  /** For pageIn — nest the new page under this conversation (defaults to current map). */
  pageInParentId?: string | null
}

/**
 * Apply Turn into: rewrite HTML + metadata; promote to Page / Page in when needed.
 */
export async function applyTurnInto(
  supabase: SupabaseClient,
  opts: ApplyTurnIntoOpts
): Promise<{ linkedPageId?: string | null }> {
  const { messageId, conversationId, userId, blockType } = opts

  const { data: row, error: loadError } = await supabase
    .from('messages')
    .select('id, content, metadata, conversation_id')
    .eq('id', messageId)
    .single()
  if (loadError || !row) throw loadError || new Error('Block message not found')

  const { meta: migrated } = migrateLegacyBlockFlags((row.metadata as Record<string, unknown>) || {})
  const nextContent = transformHtmlToBlockType(row.content || '', blockType)

  // Page / Page in — promote untitled block to a linked page (Notion parity)
  if (blockType === 'page' || blockType === 'pageIn') {
    const title =
      htmlToPlainText(row.content || '').split('\n')[0]?.trim() ||
      (typeof migrated.blockTitle === 'string' && migrated.blockTitle.trim()) ||
      'Untitled'
    const parentId =
      blockType === 'pageIn' && opts.pageInParentId ? opts.pageInParentId : conversationId

    let linkedPageId =
      typeof migrated.linkedPageId === 'string' ? migrated.linkedPageId : null

    if (!linkedPageId) {
      const { data: child, error: childError } = await supabase
        .from('conversations')
        .insert({
          user_id: userId,
          title,
          metadata: {
            parent_id: parentId,
            sourceBlockMessageId: messageId,
            hasContent: false,
          },
        })
        .select('id')
        .single()
      if (childError || !child) throw childError || new Error('Failed to create page')
      const newPageId = child.id as string
      linkedPageId = newPageId
      await syncBlockAndPageTitle(supabase, {
        messageId,
        linkedPageId: newPageId,
        title,
      })
      await ensurePageBodyBlock(supabase, { pageId: newPageId, userId })
    } else if (linkedPageId && blockType === 'pageIn' && opts.pageInParentId) {
      // Re-parent existing linked page
      const existingPageId = linkedPageId
      const { data: page } = await supabase
        .from('conversations')
        .select('metadata')
        .eq('id', existingPageId)
        .maybeSingle()
      const pageMeta = (page?.metadata as Record<string, unknown>) || {}
      await supabase
        .from('conversations')
        .update({ metadata: { ...pageMeta, parent_id: opts.pageInParentId } })
        .eq('id', existingPageId)
      await syncBlockAndPageTitle(supabase, { messageId, linkedPageId: existingPageId, title })
    } else if (linkedPageId) {
      await syncBlockAndPageTitle(supabase, { messageId, linkedPageId, title })
    }

    const { data: refreshed } = await supabase
      .from('messages')
      .select('metadata')
      .eq('id', messageId)
      .single()
    const meta = (refreshed?.metadata as Record<string, unknown>) || migrated
    await supabase
      .from('messages')
      .update({
        content: nextContent,
        metadata: {
          ...meta,
          isBlock: true,
          blockType,
          isPage: true,
          linkedPageId,
          blockTitle: title,
          columnCount: null,
          isSyncedBlock: false,
        },
      })
      .eq('id', messageId)

    return { linkedPageId }
  }

  // Non-page types — clear page-only flags only when leaving page type
  const wasPage = migrated.blockType === 'page' || migrated.blockType === 'pageIn' || migrated.isPage === true
  const metaPatch: Record<string, unknown> = {
    ...migrated,
    isBlock: true,
    blockType,
    columnCount:
      blockType === 'columns2'
        ? 2
        : blockType === 'columns3'
          ? 3
          : blockType === 'columns4'
            ? 4
            : blockType === 'columns5'
              ? 5
              : null,
    isSyncedBlock: blockType === 'syncedBlock',
  }
  if (blockType === 'syncedBlock' && !metaPatch.syncedBlockId) {
    metaPatch.syncedBlockId = messageId // Source id for future replicas
  }

  // Turning away from page does not delete the linked page (Notion keeps the page in workspace);
  // card stays linked if already a page card — only change display type when not demoting.
  // If user turns a page card into text, keep link but update blockType for rendering.
  if (!wasPage) {
    // leave linkedPageId as-is when absent
  }

  const { error: updateError } = await supabase
    .from('messages')
    .update({ content: nextContent, metadata: metaPatch })
    .eq('id', messageId)
  if (updateError) throw updateError

  return { linkedPageId: typeof migrated.linkedPageId === 'string' ? migrated.linkedPageId : null }
}
