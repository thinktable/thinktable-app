// Normalize Notion map frames to title pageLink (same chrome as local page blocks).

import type { SupabaseClient } from '@supabase/supabase-js'
import { newBlockMetadata } from '@/lib/blocks'

/** Escape text used inside HTML attrs. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Title-variant pageLink HTML — matches local page blocks. */
export function buildPageLinkHtml(opts: {
  pageId: string
  title: string
  icon?: string | null
}): string {
  const title = escapeHtml(opts.title || 'Untitled')
  const iconAttr = opts.icon ? ` data-icon="${escapeHtml(opts.icon)}"` : ''
  return `<div data-type="pageLink" data-page-id="${escapeHtml(opts.pageId)}" data-title="${title}" data-variant="title"${iconAttr}></div>`
}

/** True when the frame body is only a databaseBlock (optional empty trailing paragraphs). */
export function isSoleDatabaseBlockContent(content: string): boolean {
  if (!content || /data-type="pageLink"/.test(content)) return false
  if (!/data-type="databaseBlock"/i.test(content)) return false
  // Remove the DB atom + empty paragraphs; anything left means mixed content
  const stripped = content
    .replace(/<div\b[^>]*data-type="databaseBlock"[^>]*(?:\/>|>[\s\S]*?<\/div>)/gi, '')
    .replace(/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '')
    .replace(/\s+/g, '')
  return stripped === ''
}

/** Pull title / icon / url from a sole databaseBlock HTML string. */
export function parseDatabaseBlockAttrs(content: string): {
  title: string | null
  icon: string | null
  url: string | null
  notionDatabaseId: string | null
} {
  const title = content.match(/data-title="([^"]*)"/i)?.[1] ?? null
  const icon = content.match(/data-icon="([^"]*)"/i)?.[1] ?? null
  const url = content.match(/data-url="([^"]*)"/i)?.[1] ?? null
  const notionDatabaseId = content.match(/data-notion-database-id="([^"]*)"/i)?.[1] ?? null
  return { title, icon, url, notionDatabaseId }
}

/**
 * If `content` is a sole databaseBlock, return title-variant pageLink HTML.
 * Otherwise null.
 */
export function migrateSoleDatabaseBlockToPageLink(
  content: string,
  opts: { pageId: string; title?: string | null; icon?: string | null }
): string | null {
  if (!opts.pageId || !isSoleDatabaseBlockContent(content)) return null
  const parsed = parseDatabaseBlockAttrs(content)
  const title = (opts.title || parsed.title || 'Untitled').trim() || 'Untitled'
  const icon = opts.icon || parsed.icon || null
  return buildPageLinkHtml({ pageId: opts.pageId, title, icon })
}

/**
 * Ensure a Notion map frame that is still a sole databaseBlock becomes a pageLink frame:
 * resolve/create linkedPageId, rewrite content, persist. Returns the new HTML or null.
 */
export async function ensureNotionMapFrameIsPageLink(
  supabase: SupabaseClient,
  opts: {
    messageId: string
    userId: string
    parentConversationId: string // Board the frame sits on
    content: string
    metadata: Record<string, unknown>
  }
): Promise<{ content: string; linkedPageId: string; metadata: Record<string, unknown> } | null> {
  const { messageId, userId, parentConversationId, content, metadata } = opts
  // Intentional database map frames render a structured table — do not convert to pageLink
  if (metadata.notionObject === 'database') return null
  if (!isSoleDatabaseBlockContent(content)) return null // Already a page block / mixed body
  if (/data-type="pageLink"/.test(content)) return null

  const parsed = parseDatabaseBlockAttrs(content)
  const title =
    (typeof metadata.blockTitle === 'string' && metadata.blockTitle.trim()) ||
    parsed.title ||
    'Untitled'
  const iconMeta = metadata.notionIcon as { type?: string; emoji?: string } | null
  const emoji =
    (iconMeta?.type === 'emoji' && iconMeta.emoji) || parsed.icon || null
  const notionUrl =
    (typeof metadata.notionUrl === 'string' && metadata.notionUrl) || parsed.url || null
  const notionPageId =
    (typeof metadata.notionPageId === 'string' && metadata.notionPageId) ||
    parsed.notionDatabaseId ||
    null

  let linkedPageId =
    typeof metadata.linkedPageId === 'string' ? metadata.linkedPageId : null

  // Resolve existing nested page by Notion id when the frame never got linkedPageId
  if (!linkedPageId && notionPageId) {
    const { data: convs } = await supabase
      .from('conversations')
      .select('id, metadata')
      .eq('user_id', userId)
    const match = (convs || []).find((c) => {
      const m = (c.metadata as { notionPageId?: string } | null) || {}
      return m.notionPageId && m.notionPageId.replace(/-/g, '') === notionPageId.replace(/-/g, '')
    })
    if (match) linkedPageId = match.id as string
  }

  // Create a nested Thinktable page when none exists yet
  if (!linkedPageId) {
    const { data: created, error } = await supabase
      .from('conversations')
      .insert({
        user_id: userId,
        title,
        metadata: {
          parent_id: parentConversationId,
          sourceBlockMessageId: messageId,
          hasContent: true,
          source: 'notion',
          ...(notionPageId ? { notionPageId } : {}),
          ...(notionUrl ? { notionUrl } : {}),
          ...(emoji ? { icon: { type: 'emoji', emoji } } : {}),
        },
      })
      .select('id')
      .single()
    if (error || !created) {
      console.error('Failed to create page for Notion DB frame:', error)
      return null
    }
    linkedPageId = created.id as string
    // Seed page-body with the databaseBlock so opening the page still shows the DB atom
    await supabase.from('messages').insert({
      conversation_id: linkedPageId,
      user_id: userId,
      role: 'user',
      content, // Keep the databaseBlock on the child page
      metadata: newBlockMetadata({
        isPageBody: true,
        blockTitle: title,
        position: { x: 80, y: 80 },
        ...(notionPageId ? { notionPageId } : {}),
        ...(notionUrl ? { notionUrl } : {}),
      }),
    })
  }

  const nextContent = buildPageLinkHtml({ pageId: linkedPageId, title, icon: emoji })
  const nextMeta: Record<string, unknown> = {
    ...metadata,
    linkedPageId,
    blockTitle: title,
    isPage: true,
    blockType: 'page',
    ...(notionUrl ? { notionUrl } : {}),
    ...(notionPageId ? { notionPageId } : {}),
  }

  const { error: updateError } = await supabase
    .from('messages')
    .update({ content: nextContent, metadata: nextMeta })
    .eq('id', messageId)
  if (updateError) {
    console.error('Failed to rewrite Notion DB frame as pageLink:', updateError)
    return null
  }

  return { content: nextContent, linkedPageId, metadata: nextMeta }
}
