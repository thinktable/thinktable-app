// Frame / page helpers — a **frame** (`metadata.isBlock`, RF `chatPanel`) on a **page** holds TipTap **blocks**.
// A titled frame links to a child page. `isBlock` ≠ TipTap block. See DEFINITIONS.md.

import type { SupabaseClient } from '@supabase/supabase-js' // Typed client for sync helpers

/** RF node id for a block-group message (`block-group-{messageId}`). */
export function blockGroupNodeId(groupMessageId: string): string {
  return `block-group-${groupMessageId}` // Stable id so children can parentId this node
}

/** Message id from a block-group RF node id, or null if not a group node. */
export function blockGroupMessageIdFromNodeId(nodeId: string): string | null {
  if (!nodeId.startsWith('block-group-')) return null // Only group wrappers use this prefix
  return nodeId.slice('block-group-'.length) // Strip prefix → messages.id
}

/**
 * One-shot cutover: isNote / isItem / itemTitle / inline* → isBlock / blockTitle / isInlineBlock.
 * Drops legacy keys. Runtime after migrate only checks isBlock.
 */
export function migrateLegacyBlockFlags(meta: Record<string, unknown>): {
  meta: Record<string, unknown>
  changed: boolean
} {
  const next = { ...meta } // Shallow copy before mutating flags
  let changed = false

  // Note / item flags → block
  if (next.isNote === true || next.isItem === true) {
    if (next.isBlock !== true) {
      next.isBlock = true // Canonical block flag
      changed = true
    }
  }
  if (next.isNote !== undefined) {
    delete next.isNote
    changed = true
  }
  if (next.isItem !== undefined) {
    delete next.isItem
    changed = true
  }

  // Inline placement flag
  if (next.isInlineNote === true || next.isInlineItem === true) {
    if (next.isInlineBlock !== true) {
      next.isInlineBlock = true
      changed = true
    }
  }
  if (next.isInlineNote !== undefined) {
    delete next.isInlineNote
    changed = true
  }
  if (next.isInlineItem !== undefined) {
    delete next.isInlineItem
    changed = true
  }

  // Title key rename
  if (typeof next.itemTitle === 'string' && typeof next.blockTitle !== 'string') {
    next.blockTitle = next.itemTitle
    changed = true
  }
  if (next.itemTitle !== undefined) {
    delete next.itemTitle
    changed = true
  }

  return { meta: next, changed }
}

/** True when message metadata marks a **frame** on a page (legacy key `isBlock` — not a TipTap block). */
export function isBlockMeta(meta?: Record<string, unknown> | null): boolean {
  if (!meta) return false
  return meta.isBlock === true // Frame on the map (not flashcard/chat)
}

/** Metadata written when creating a new **frame** (no linked page until titled). */
export function newBlockMetadata(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    isBlock: true, // Legacy flag: this message is a map frame (not a TipTap block)
    isInlineBlock: true, // Placed frame (honor metadata.position)
    blockType: 'text', // Baseline Turn into kind (menu + future render)
    frameUnlocked: false, // Default: content scales with frame (proportional resize)
    ...extra, // Caller position / fadeIn / Notion fields / override blockType
  }
}

/** True when HTML/plain content has no visible text. */
export function isBlockContentEmpty(content: string | undefined | null): boolean {
  if (!content) return true
  if (content === '<p></p>' || content === '<p><br></p>') return true
  return content.replace(/<[^>]*>/g, '').trim().length === 0
}

/** True when this block is the page’s own body on its map (not a nested page card). */
export function isPageBodyMeta(meta?: Record<string, unknown> | null): boolean {
  return meta?.isPageBody === true
}

/** True when message metadata marks a visual block group container. */
export function isBlockGroupMeta(meta?: Record<string, unknown> | null): boolean {
  return meta?.isBlockGroup === true
}

/**
 * Ensure a page with content has its body as a block on its own map.
 * Skips empty pages. Idempotent when a page-body block already exists.
 */
export async function ensurePageBodyBlock(
  supabase: SupabaseClient,
  opts: {
    pageId: string // Conversation / page whose map we are on
    userId: string // Owner for insert
  }
): Promise<{ created: boolean; messageId: string | null }> {
  const { pageId, userId } = opts

  // Already has a page-body block on this map → nothing to do
  const { data: existingBody } = await supabase
    .from('messages')
    .select('id')
    .eq('conversation_id', pageId)
    .contains('metadata', { isPageBody: true })
    .limit(1)
    .maybeSingle()
  if (existingBody?.id) {
    return { created: false, messageId: existingBody.id }
  }

  // Load page metadata for reverse link + title
  const { data: page } = await supabase
    .from('conversations')
    .select('id, title, metadata, user_id')
    .eq('id', pageId)
    .maybeSingle()
  if (!page || page.user_id !== userId) {
    return { created: false, messageId: null }
  }

  const pageMeta = (page.metadata as Record<string, unknown>) || {}
  // Prefer new key; migrate old sourceItemMessageId once when reading
  const sourceBlockMessageId =
    typeof pageMeta.sourceBlockMessageId === 'string'
      ? pageMeta.sourceBlockMessageId
      : typeof pageMeta.sourceItemMessageId === 'string'
        ? pageMeta.sourceItemMessageId
        : null

  // Content lives on the parent-map source block until materialized onto this page
  let bodyContent = ''
  if (sourceBlockMessageId) {
    const { data: source } = await supabase
      .from('messages')
      .select('content')
      .eq('id', sourceBlockMessageId)
      .maybeSingle()
    bodyContent = source?.content || ''
  }

  // No content yet → leave the page map empty (do not spawn a blank body block)
  if (isBlockContentEmpty(bodyContent)) {
    return { created: false, messageId: null }
  }

  const pageTitle = (page.title || '').trim() || 'Untitled'
  const { data: created, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: pageId,
      user_id: userId,
      role: 'user',
      content: bodyContent, // Page content as a block on this page’s map
      metadata: newBlockMetadata({
        isPageBody: true, // This block IS the page’s body (not a nested page link)
        blockTitle: pageTitle, // Match page name in the title chip
        position: { x: 80, y: 80 }, // Default spawn on the page map
        fadeIn: true,
      }),
    })
    .select('id')
    .single()

  if (error || !created) {
    console.error('Failed to create page-body block:', error)
    return { created: false, messageId: null }
  }

  // Mark page contentful + remember the body message for sync; drop legacy source key
  const nextPageMeta: Record<string, unknown> = {
    ...pageMeta,
    hasContent: true,
    pageBodyMessageId: created.id,
  }
  if (typeof pageMeta.sourceItemMessageId === 'string' && !pageMeta.sourceBlockMessageId) {
    nextPageMeta.sourceBlockMessageId = pageMeta.sourceItemMessageId
    delete nextPageMeta.sourceItemMessageId
  }
  await supabase
    .from('conversations')
    .update({ metadata: nextPageMeta })
    .eq('id', pageId)

  return { created: true, messageId: created.id }
}

/** Persist note/item→block migration for a batch of messages (idempotent). */
export async function migrateMessagesToBlockFlag(
  supabase: SupabaseClient,
  messages: Array<{ id: string; metadata?: Record<string, unknown> | null }>
): Promise<void> {
  for (const msg of messages) {
    if (!msg.metadata) continue
    const { meta, changed } = migrateLegacyBlockFlags(msg.metadata as Record<string, unknown>)
    if (!changed) continue
    await supabase.from('messages').update({ metadata: meta }).eq('id', msg.id)
    msg.metadata = meta // Keep in-memory rows consistent with DB
  }
}

/** Push a title to both the block message and its linked page (keeps them in sync). */
export async function syncBlockAndPageTitle(
  supabase: SupabaseClient,
  opts: {
    messageId: string // Block message on the parent map
    linkedPageId: string // Child page conversation
    title: string // Shared title
    titleEdgeT?: number // Optional edge position to persist with the title
  }
): Promise<void> {
  const title = opts.title.trim() // Normalize before dual-write
  if (!title) return

  // Update page title (Pages menu + path bar)
  const { error: pageError } = await supabase
    .from('conversations')
    .update({ title })
    .eq('id', opts.linkedPageId)
  if (pageError) throw pageError

  // Merge block metadata so we do not wipe other fields
  const { data: row } = await supabase
    .from('messages')
    .select('metadata')
    .eq('id', opts.messageId)
    .single()
  const existing = (row?.metadata as Record<string, unknown>) || {}
  const { meta: migrated } = migrateLegacyBlockFlags(existing) // Drop leftover item/note keys
  const patch: Record<string, unknown> = {
    ...migrated,
    blockTitle: title, // Mirror of conversations.title
    linkedPageId: opts.linkedPageId, // Keep link explicit
    isPage: true, // Titled block = page card on parent map
    isBlock: true, // Canonical block flag
  }
  if (typeof opts.titleEdgeT === 'number') patch.titleEdgeT = opts.titleEdgeT

  const { error: msgError } = await supabase
    .from('messages')
    .update({ metadata: patch })
    .eq('id', opts.messageId)
  if (msgError) throw msgError
}

/** After a page is renamed in the menu, mirror the title onto its source block card. */
export async function syncPageRenameToBlock(
  supabase: SupabaseClient,
  pageId: string,
  title: string
): Promise<string | null> {
  const trimmed = title.trim()
  if (!trimmed) return null

  // Prefer reverse pointer stored on the page at promote time
  const { data: page } = await supabase
    .from('conversations')
    .select('metadata')
    .eq('id', pageId)
    .maybeSingle()
  const pageMeta = (page?.metadata as Record<string, unknown> | null) || {}
  const sourceBlockMessageId =
    typeof pageMeta.sourceBlockMessageId === 'string'
      ? pageMeta.sourceBlockMessageId
      : typeof pageMeta.sourceItemMessageId === 'string'
        ? pageMeta.sourceItemMessageId
        : null

  if (sourceBlockMessageId) {
    const { data: row } = await supabase
      .from('messages')
      .select('id, metadata, conversation_id')
      .eq('id', sourceBlockMessageId)
      .maybeSingle()
    if (row) {
      const { meta: migrated } = migrateLegacyBlockFlags((row.metadata as Record<string, unknown>) || {})
      await supabase
        .from('messages')
        .update({
          metadata: {
            ...migrated,
            blockTitle: trimmed,
            linkedPageId: pageId,
            isPage: true,
            isBlock: true,
          },
        })
        .eq('id', row.id)
      // Migrate page reverse pointer if still on legacy key
      if (pageMeta.sourceItemMessageId && !pageMeta.sourceBlockMessageId) {
        const next: Record<string, unknown> = {
          ...pageMeta,
          sourceBlockMessageId: pageMeta.sourceItemMessageId,
        }
        delete next.sourceItemMessageId
        await supabase.from('conversations').update({ metadata: next }).eq('id', pageId)
      }
      return row.conversation_id as string // Parent map to invalidate
    }
  }

  // Fallback: find block by linkedPageId (covers older rows without sourceBlockMessageId)
  const { data: messages } = await supabase
    .from('messages')
    .select('id, metadata, conversation_id')
    .contains('metadata', { linkedPageId: pageId })

  const match = (messages || [])[0]
  if (!match) return null

  const { meta: migrated } = migrateLegacyBlockFlags((match.metadata as Record<string, unknown>) || {})
  await supabase
    .from('messages')
    .update({
      metadata: {
        ...migrated,
        blockTitle: trimmed,
        linkedPageId: pageId,
        isPage: true,
        isBlock: true,
      },
    })
    .eq('id', match.id)
  return match.conversation_id as string
}

/** When a page is deleted from the menu, demote its block card (keep body, clear page link). */
export async function demoteBlockForDeletedPage(
  supabase: SupabaseClient,
  pageId: string
): Promise<string | null> {
  const { data: page } = await supabase
    .from('conversations')
    .select('metadata')
    .eq('id', pageId)
    .maybeSingle()
  const pageMeta = (page?.metadata as Record<string, unknown> | null) || {}
  const sourceBlockMessageId =
    typeof pageMeta.sourceBlockMessageId === 'string'
      ? pageMeta.sourceBlockMessageId
      : typeof pageMeta.sourceItemMessageId === 'string'
        ? pageMeta.sourceItemMessageId
        : null

  const clearMeta = async (messageId: string, conversationId: string) => {
    const { data: row } = await supabase
      .from('messages')
      .select('metadata')
      .eq('id', messageId)
      .single()
    const existing = { ...((row?.metadata as Record<string, unknown>) || {}) }
    delete existing.blockTitle // No longer a titled page card
    delete existing.itemTitle
    delete existing.linkedPageId
    delete existing.isPage
    await supabase.from('messages').update({ metadata: existing }).eq('id', messageId)
    return conversationId
  }

  if (sourceBlockMessageId) {
    const { data: row } = await supabase
      .from('messages')
      .select('id, conversation_id')
      .eq('id', sourceBlockMessageId)
      .maybeSingle()
    if (row) return clearMeta(row.id, row.conversation_id as string)
  }

  const { data: messages } = await supabase
    .from('messages')
    .select('id, conversation_id')
    .contains('metadata', { linkedPageId: pageId })
  const match = (messages || [])[0]
  if (!match) return null
  return clearMeta(match.id, match.conversation_id as string)
}

/** When a block card is deleted, delete its linked page so nav stays in sync. */
export async function deleteLinkedPageForBlock(
  supabase: SupabaseClient,
  meta?: Record<string, unknown> | null
): Promise<string | null> {
  const linkedPageId = typeof meta?.linkedPageId === 'string' ? meta.linkedPageId : null
  if (!linkedPageId) return null
  const { error } = await supabase.from('conversations').delete().eq('id', linkedPageId)
  if (error) throw error
  return linkedPageId
}

/** Padding inside a visual block group frame (px). */
export const BLOCK_GROUP_PADDING = 24

/**
 * Metadata for a duplicated block — keeps content flags, drops page link so two cards
 * never share one linked page, and clears group membership (caller may re-group).
 */
export function duplicateBlockMetadata(
  source: Record<string, unknown>,
  position: { x: number; y: number }
): Record<string, unknown> {
  const { meta: migrated } = migrateLegacyBlockFlags({ ...source })
  const next: Record<string, unknown> = {
    ...migrated,
    isBlock: true,
    isInlineBlock: true,
    position,
    fadeIn: true,
  }
  delete next.linkedPageId // Duplicate is not the same page card
  delete next.isPage
  delete next.blockTitle // Untitled until user retitles
  delete next.blockGroupId // Outside any group until grouped again
  delete next.isBlockGroup
  return next
}

/** Create a block-group message and attach children via metadata.blockGroupId. */
export async function createBlockGroup(
  supabase: SupabaseClient,
  opts: {
    conversationId: string
    userId: string
    childMessageIds: string[] // Blocks to put inside the group
    bounds: { x: number; y: number; width: number; height: number } // Absolute frame in flow coords
  }
): Promise<string | null> {
  const { conversationId, userId, childMessageIds, bounds } = opts
  if (childMessageIds.length < 2) return null

  const { data: group, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      user_id: userId,
      role: 'user',
      content: '', // Groups have no body text
      metadata: {
        isBlockGroup: true, // Visual container (not a content block)
        position: { x: bounds.x, y: bounds.y },
        resizeDimensions: { width: bounds.width, height: bounds.height },
        fadeIn: true,
      },
    })
    .select('id')
    .single()

  if (error || !group) {
    console.error('Failed to create block group:', error)
    return null
  }

  for (const messageId of childMessageIds) {
    const { data: row } = await supabase
      .from('messages')
      .select('metadata')
      .eq('id', messageId)
      .maybeSingle()
    if (!row) continue
    const { meta: migrated } = migrateLegacyBlockFlags((row.metadata as Record<string, unknown>) || {})
    await supabase
      .from('messages')
      .update({
        metadata: {
          ...migrated,
          isBlock: true,
          blockGroupId: group.id, // Child → group link for load/MCP
        },
      })
      .eq('id', messageId)
  }

  return group.id as string
}

/** Remove blockGroupId from the given child messages; delete empty group rows. */
export async function ungroupBlocks(
  supabase: SupabaseClient,
  opts: {
    childMessageIds: string[]
    groupMessageId?: string | null
  }
): Promise<void> {
  const groupIds = new Set<string>()
  if (opts.groupMessageId) groupIds.add(opts.groupMessageId)

  for (const messageId of opts.childMessageIds) {
    const { data: row } = await supabase
      .from('messages')
      .select('metadata')
      .eq('id', messageId)
      .maybeSingle()
    if (!row) continue
    const existing = { ...((row.metadata as Record<string, unknown>) || {}) }
    if (typeof existing.blockGroupId === 'string') groupIds.add(existing.blockGroupId)
    delete existing.blockGroupId
    await supabase.from('messages').update({ metadata: existing }).eq('id', messageId)
  }

  // Drop group containers that no longer have children (best-effort)
  await deleteEmptyBlockGroups(supabase, [...groupIds])
}

/**
 * Write absolute map position + optional group membership on a block message.
 * Position is always flow-absolute (load converts to relative when parented).
 */
export async function persistBlockPlacement(
  supabase: SupabaseClient,
  opts: {
    messageId: string // Block message to update
    position: { x: number; y: number } // Absolute flow coords
    blockGroupId?: string | null // Group message id, or null to stand alone on the page
  }
): Promise<void> {
  const { data: row } = await supabase
    .from('messages')
    .select('metadata')
    .eq('id', opts.messageId)
    .maybeSingle()
  if (!row) return
  const { meta: migrated } = migrateLegacyBlockFlags((row.metadata as Record<string, unknown>) || {})
  const next: Record<string, unknown> = {
    ...migrated,
    isBlock: true, // Keep canonical block flag
    position: opts.position, // Absolute; RF subtracts group origin when parented
  }
  if (opts.blockGroupId) next.blockGroupId = opts.blockGroupId // Join / stay in this group
  else delete next.blockGroupId // Standalone on the page
  await supabase.from('messages').update({ metadata: next }).eq('id', opts.messageId)
}

/** Persist group frame position/size (after drag or expand-to-fit on attach). */
export async function persistBlockGroupFrame(
  supabase: SupabaseClient,
  opts: {
    groupMessageId: string // isBlockGroup message id
    position: { x: number; y: number } // Frame origin in flow coords
    size: { width: number; height: number } // Frame size
  }
): Promise<void> {
  const { data: row } = await supabase
    .from('messages')
    .select('metadata')
    .eq('id', opts.groupMessageId)
    .maybeSingle()
  if (!row) return
  const existing = { ...((row.metadata as Record<string, unknown>) || {}) }
  await supabase
    .from('messages')
    .update({
      metadata: {
        ...existing,
        isBlockGroup: true, // Keep group flag
        position: opts.position,
        resizeDimensions: opts.size,
      },
    })
    .eq('id', opts.groupMessageId)
}

/** Delete group messages that no longer have any children. Returns deleted ids. */
export async function deleteEmptyBlockGroups(
  supabase: SupabaseClient,
  groupMessageIds: string[]
): Promise<string[]> {
  const deleted: string[] = []
  for (const groupId of groupMessageIds) {
    const { data: stillGrouped } = await supabase
      .from('messages')
      .select('id')
      .contains('metadata', { blockGroupId: groupId })
      .limit(1)
    if (stillGrouped && stillGrouped.length > 0) continue // Still has children
    await supabase.from('messages').delete().eq('id', groupId)
    deleted.push(groupId)
  }
  return deleted
}
