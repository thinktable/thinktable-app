// Turn into — transform block HTML + metadata like Notion (page promote included).

import type { SupabaseClient } from '@supabase/supabase-js' // Persist transforms
import type { BlockTypeId } from '@/components/block-actions-menu' // Shared type ids
import { looksLikeImageSrc } from '@/lib/tiptap/image-block' // URL-only blocks become image src
import { ensureBoardBodyBlock, isBlockContentEmpty, migrateLegacyBlockFlags } from '@/lib/blocks'
import { boardTitleOrDefault } from '@/lib/board-title' // Turn into Board with no first line → New board

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

/**
 * Top-level TipTap blocks in document order (p / headings / lists / quote / pre / div).
 * Used to peel the title line off a frame before seeding a child board body.
 */
function topLevelBlocks(html: string): string[] {
  const trimmed = (html || '').trim()
  if (!trimmed) return []
  const blocks: string[] = []
  const re = /<(p|h[1-6]|blockquote|pre|ul|ol|div)(\s[^>]*)?>[\s\S]*?<\/\1>/gi
  for (const m of trimmed.matchAll(re)) blocks.push(m[0])
  return blocks
}

/**
 * Board name is the first plain-text line — it must NOT also appear as a body block on the
 * child board. Returns leftover HTML after removing that title line (empty → no body).
 */
export function bodyHtmlWithoutBoardTitle(html: string, title: string): string {
  const t = (title || '').trim()
  const raw = (html || '').trim()
  if (!raw || !t) return raw
  const blocks = topLevelBlocks(raw)
  if (blocks.length === 0) {
    // No structured blocks — plain compare
    return htmlToPlainText(raw) === t ? '' : raw
  }
  const firstPlain = htmlToPlainText(blocks[0])
  const firstLines = firstPlain.split('\n').map((l) => l.trim()).filter(Boolean)
  // First block is exactly the title (one line) → drop the whole block
  if (firstLines.length === 1 && firstLines[0] === t) {
    return blocks.slice(1).join('').trim()
  }
  // First block starts with the title line then more → keep remaining lines as paragraphs
  if (firstLines.length > 1 && firstLines[0] === t) {
    const restLines = firstLines.slice(1).map((l) => `<p>${escapeHtml(l)}</p>`).join('')
    return (restLines + blocks.slice(1).join('')).trim()
  }
  // Title didn't match first block — leave body as-is (title may have come from metadata)
  return raw
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
    /^<div[^>]*data-type="(?:callout|toggleList|toggleHeading|blockEquation|syncedBlock|columns|imageBlock|propertyBlock)"[^>]*>([\s\S]*)<\/div>$/i,
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
    case 'image': {
      const plain = htmlToPlainText(html).trim()
      const src = looksLikeImageSrc(plain) ? plain : ''
      return `<div data-type="imageBlock"${src ? ` data-src="${escapeHtml(src)}"` : ''}></div>`
    }
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
    case 'board':
    case 'boardIn':
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
  boardInParentId?: string | null
}

/**
 * Apply Turn into: rewrite HTML + metadata; promote to Board / Board in when needed.
 */
export async function applyTurnInto(
  supabase: SupabaseClient,
  opts: ApplyTurnIntoOpts
): Promise<{ linkedBoardId?: string | null }> {
  const { messageId, conversationId, userId, blockType } = opts

  const { data: row, error: loadError } = await supabase
    .from('messages')
    .select('id, content, metadata, conversation_id')
    .eq('id', messageId)
    .single()
  if (loadError || !row) {
    throw new Error(`Frame message not found (${messageId}): ${formatSbError(loadError)}`)
  }

  const { meta: migrated } = migrateLegacyBlockFlags((row.metadata as Record<string, unknown>) || {})
  const nextContent = transformHtmlToBlockType(row.content || '', blockType)

  // Board / Board in — promote frame to a linked board; dual-read legacy page*
  const bt = blockType as string
  if (bt === 'board' || bt === 'boardIn' || bt === 'page' || bt === 'pageIn') {
    const title = boardTitleOrDefault(
      htmlToPlainText(row.content || '').split('\n')[0]?.trim() ||
        (typeof migrated.blockTitle === 'string' ? migrated.blockTitle : '')
    )
    const parentId =
      (bt === 'boardIn' || bt === 'pageIn') && opts.boardInParentId
        ? opts.boardInParentId
        : conversationId

    let linkedBoardId =
      typeof migrated.linkedBoardId === 'string' && migrated.linkedBoardId.trim()
        ? migrated.linkedBoardId.trim()
        : typeof migrated.linkedPageId === 'string' && migrated.linkedPageId.trim()
          ? migrated.linkedPageId.trim()
          : null

    if (!linkedBoardId) {
      // Move non-link content onto the child board; parent frame becomes boardLink-only
      // Title = first line — strip it from the body so the board name isn't a duplicate block
      const withoutLinks = (row.content || '')
        .replace(/<div[^>]*data-type=["'](?:boardLink|pageLink)["'][^>]*>[\s\S]*?<\/div>/gi, '')
        .trim()
      const bodySeed = bodyHtmlWithoutBoardTitle(withoutLinks, title)
      const hasBody = !isBlockContentEmpty(bodySeed)
      const newBoardId = crypto.randomUUID() // Avoid INSERT…RETURNING SELECT-policy race

      const { error: childError } = await supabase.from('conversations').insert({
        id: newBoardId,
        user_id: userId,
        title,
        metadata: {
          parent_id: parentId,
          sourceBlockMessageId: messageId,
          hasContent: hasBody,
        },
      })
      if (childError) {
        throw new Error(`Failed to create board: ${formatSbError(childError)}`)
      }
      linkedBoardId = newBoardId

      // Seed body explicitly (never auto-copy from the linking frame on open)
      await ensureBoardBodyBlock(supabase, {
        boardId: linkedBoardId,
        userId,
        bodyHtml: hasBody ? bodySeed : undefined,
      })
    } else if ((bt === 'boardIn' || bt === 'pageIn') && opts.boardInParentId) {
      const { data: page } = await supabase
        .from('conversations')
        .select('metadata')
        .eq('id', linkedBoardId)
        .maybeSingle()
      const pageMeta = (page?.metadata as Record<string, unknown>) || {}
      const { error: reparentError } = await supabase
        .from('conversations')
        .update({ metadata: { ...pageMeta, parent_id: opts.boardInParentId } })
        .eq('id', linkedBoardId)
      if (reparentError) {
        throw new Error(`Failed to re-parent board: ${formatSbError(reparentError)}`)
      }
      await supabase.from('conversations').update({ title }).eq('id', linkedBoardId)
    } else {
      await supabase.from('conversations').update({ title }).eq('id', linkedBoardId)
    }

    // Parent frame = sole title boardLink; body lives on the linked board
    const titleDiv = `<div data-type="boardLink" data-board-id="${linkedBoardId}" data-title="${escapeHtml(
      title
    )}" data-variant="title"></div>`
    // Keep nextContent only when it is already a sole boardLink (no sibling blocks)
    const withoutLinks = nextContent.replace(
      /<div[^>]*data-type=["'](?:boardLink|pageLink)["'][^>]*>[\s\S]*?<\/div>/gi,
      ''
    )
    const alreadyLinkOnly =
      /data-type="(?:boardLink|pageLink)"/.test(nextContent) && isBlockContentEmpty(withoutLinks)
    const linkOnlyContent = alreadyLinkOnly ? nextContent : titleDiv

    const normalizedBoardType = bt === 'pageIn' || bt === 'boardIn' ? 'boardIn' : 'board'

    const { error: msgError } = await supabase
      .from('messages')
      .update({
        content: linkOnlyContent,
        metadata: {
          ...migrated,
          isBlock: true,
          blockType: normalizedBoardType,
          isBoard: true,
          linkedBoardId,
          blockTitle: title,
          columnCount: null,
          isSyncedBlock: false,
        },
      })
      .eq('id', messageId)
    if (msgError) {
      throw new Error(`Failed to update frame to boardLink: ${formatSbError(msgError)}`)
    }

    return { linkedBoardId }
  }

  // Non-board types
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
    metaPatch.syncedBlockId = messageId
  }

  const { error: updateError } = await supabase
    .from('messages')
    .update({ content: nextContent, metadata: metaPatch })
    .eq('id', messageId)
  if (updateError) throw new Error(`Failed to update frame: ${formatSbError(updateError)}`)

  return {
    linkedBoardId:
      typeof migrated.linkedBoardId === 'string'
        ? migrated.linkedBoardId
        : typeof migrated.linkedPageId === 'string'
          ? migrated.linkedPageId
          : null,
  }
}

/** Readable Supabase / Postgrest error for UI logs (avoids `{}` from Error serialization). */
function formatSbError(err: unknown): string {
  if (!err) return 'unknown error'
  if (typeof err === 'string') return err
  if (err instanceof Error && err.message) {
    const anyErr = err as Error & { code?: string; details?: string; hint?: string }
    const parts = [anyErr.message]
    if (anyErr.code) parts.push(`code=${anyErr.code}`)
    if (anyErr.details) parts.push(String(anyErr.details))
    if (anyErr.hint) parts.push(String(anyErr.hint))
    return parts.join(' | ')
  }
  if (typeof err === 'object') {
    const o = err as { message?: string; code?: string; details?: string; hint?: string }
    if (o.message || o.code) {
      return [o.message, o.code && `code=${o.code}`, o.details, o.hint].filter(Boolean).join(' | ')
    }
  }
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}
