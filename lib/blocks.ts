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

/** True when HTML/plain content has no visible text (spaces / &nbsp; / empty tags only). */
export function isBlockContentEmpty(content: string | undefined | null): boolean {
  if (!content) return true
  if (content === '<p></p>' || content === '<p><br></p>') return true
  // boardLink / legacy pageLink / databaseBlock / imageBlock store payload in attrs — stripping tags looks empty
  if (/data-type=["'](?:boardLink|pageLink|databaseBlock|imageBlock)["']/i.test(content)) return false
  // TipTap often stores spaces as &nbsp; / &#160; / U+00A0 — treat those as empty too
  const plain = content
    .replace(/<[^>]*>/g, ' ') // Drop tags; leftover is typed text only
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/\u00a0/g, ' ') // Literal non-breaking space from the editor DOM
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length === 0
}

/** Notion connection sync mode on a frame (Connections menu). */
export type NotionSyncMode = 'live' | 'manual'

/** Read whether this frame is Notion-connected and which sync mode is on. */
export function readNotionConnection(meta?: Record<string, unknown> | null): {
  connected: boolean
  sync: NotionSyncMode
} {
  if (!meta) return { connected: false, sync: 'live' }
  if (meta.notionConnected === false) return { connected: false, sync: 'live' } // Explicit unlink
  const sync: NotionSyncMode = meta.notionSync === 'manual' ? 'manual' : 'live'
  if (meta.notionConnected === true) return { connected: true, sync }
  // Imported Notion frames already have a page/url — treat as connected
  const imported =
    typeof meta.notionPageId === 'string' || typeof meta.notionUrl === 'string'
  return { connected: imported, sync }
}

/** Dual-read linked child board id from message metadata (linkedBoardId || linkedPageId). */
export function getLinkedBoardId(meta?: Record<string, unknown> | null): string | null {
  if (typeof meta?.linkedBoardId === 'string') return meta.linkedBoardId // Prefer new key
  if (typeof meta?.linkedPageId === 'string') return meta.linkedPageId // Legacy key
  return null
}

/** True when this frame is the board’s own body on its map (not a nested board card). Dual-reads isPageBody. */
export function isBoardBodyMeta(meta?: Record<string, unknown> | null): boolean {
  return meta?.isBoardBody === true || meta?.isPageBody === true // New or legacy body flag
}

/** True when message metadata marks a visual block group container. */
export function isBlockGroupMeta(meta?: Record<string, unknown> | null): boolean {
  return meta?.isBlockGroup === true
}

/**
 * Ensure a board has its body frame when the caller supplies content.
 * Never copies the parent-map source frame — sibling blocks / boardLinks stay on the parent.
 * Idempotent when a board-body frame already exists. Empty / missing bodyHtml → leave board empty.
 */
export async function ensureBoardBodyBlock(
  supabase: SupabaseClient,
  opts: {
    boardId: string // Conversation / board whose map we are on
    userId: string // Owner for insert
    /** Explicit HTML to seed; required to create a body (no auto-copy from source frame). */
    bodyHtml?: string
  }
): Promise<{ created: boolean; messageId: string | null }> {
  const { boardId, userId, bodyHtml } = opts

  // Already has a board-body frame on this map → nothing to do
  // Dual-read: new isBoardBody or legacy isPageBody already on this map
  const { data: existingBodies } = await supabase
    .from('messages')
    .select('id, metadata')
    .eq('conversation_id', boardId)
  const existingBody = (existingBodies || []).find((m) => {
    const meta = (m.metadata as Record<string, unknown>) || {}
    return meta.isBoardBody === true || meta.isPageBody === true
  })
  if (existingBody?.id) {
    return { created: false, messageId: existingBody.id }
  }

  // No explicit seed → leave empty (do not pull sibling content from the linking frame)
  if (isBlockContentEmpty(bodyHtml)) {
    return { created: false, messageId: null }
  }

  // Load board metadata for title + legacy key cleanup
  const { data: page } = await supabase
    .from('conversations')
    .select('id, title, metadata, user_id')
    .eq('id', boardId)
    .maybeSingle()
  if (!page || page.user_id !== userId) {
    // Cannot verify ownership / read the new board — surface so Turn into doesn't look like a silent no-op
    if (!isBlockContentEmpty(bodyHtml)) {
      throw new Error(
        !page
          ? `Cannot read board ${boardId} to seed body (RLS or missing row)`
          : `Cannot seed board body: user_id mismatch`
      )
    }
    return { created: false, messageId: null }
  }

  const pageMeta = (page.metadata as Record<string, unknown>) || {}
  const pageTitle = (page.title || '').trim() || 'Untitled'
  const { data: created, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: boardId,
      user_id: userId,
      role: 'user',
      content: bodyHtml, // Only what the caller seeded
      metadata: newBlockMetadata({
        isBoardBody: true, // This frame IS the board’s body (not a nested board link)
        blockTitle: pageTitle, // Match board name in the title chip
        position: { x: 80, y: 80 }, // Default spawn on the board map
        fadeIn: true,
      }),
    })
    .select('id')
    .single()

  if (error || !created) {
    const msg =
      error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : 'unknown error'
    throw new Error(`Failed to create board-body frame: ${msg}`)
  }

  // Mark board contentful + remember the body message for sync; drop legacy source key
  const nextPageMeta: Record<string, unknown> = {
    ...pageMeta,
    hasContent: true,
    boardBodyMessageId: created.id,
  }
  if (typeof pageMeta.sourceItemMessageId === 'string' && !pageMeta.sourceBlockMessageId) {
    nextPageMeta.sourceBlockMessageId = pageMeta.sourceItemMessageId
    delete nextPageMeta.sourceItemMessageId
  }
  await supabase
    .from('conversations')
    .update({ metadata: nextPageMeta })
    .eq('id', boardId)

  return { created: true, messageId: created.id }
}

/** Persist note/item→block migration for a batch of messages (idempotent). */
export async function migrateMessagesToBlockFlag(
  supabase: SupabaseClient,
  messages: Array<{ id: string; metadata?: Record<string, unknown> | null }>
): Promise<void> {
  const toPersist: Array<{ id: string; meta: Record<string, unknown> }> = [] // Rows that still need DB write
  for (const msg of messages) {
    if (!msg.metadata) continue
    const { meta, changed } = migrateLegacyBlockFlags(msg.metadata as Record<string, unknown>)
    if (!changed) continue
    msg.metadata = meta // Apply in memory immediately so first paint uses canonical flags
    toPersist.push({ id: msg.id, meta }) // Queue DB write — do not block on serial UPDATEs
  }
  if (toPersist.length === 0) return
  // Fire-and-forget parallel persists so cold load returns after one messages select
  void Promise.all(
    toPersist.map(({ id, meta }) =>
      supabase.from('messages').update({ metadata: meta }).eq('id', id)
    )
  ).catch((err) => {
    console.error('migrateMessagesToBlockFlag persist failed:', err)
  })
}

/** Push a title to both the block message and its linked page (keeps them in sync). */
export async function syncBlockAndBoardTitle(
  supabase: SupabaseClient,
  opts: {
    messageId: string // Block message on the parent map
    linkedBoardId: string // Child board conversation
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
    .eq('id', opts.linkedBoardId)
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
    linkedBoardId: opts.linkedBoardId, // Keep link explicit
    isBoard: true, // Titled block = page card on parent map
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
export async function syncBoardRenameToBlock(
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
            linkedBoardId: pageId,
            isBoard: true,
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

  // Fallback: find block by linkedBoardId / legacy linkedPageId
  let match: { id: string; metadata: unknown; conversation_id: string } | undefined
  {
    const { data: messages } = await supabase
      .from('messages')
      .select('id, metadata, conversation_id')
      .contains('metadata', { linkedBoardId: pageId })
    match = (messages || [])[0]
  }
  if (!match) {
    const { data: messages } = await supabase
      .from('messages')
      .select('id, metadata, conversation_id')
      .contains('metadata', { linkedPageId: pageId })
    match = (messages || [])[0]
  }
  if (!match) return null

  const { meta: migrated } = migrateLegacyBlockFlags((match.metadata as Record<string, unknown>) || {})
  await supabase
    .from('messages')
    .update({
      metadata: {
        ...migrated,
        blockTitle: trimmed,
        linkedBoardId: pageId,
        isBoard: true,
        isBlock: true,
      },
    })
    .eq('id', match.id)
  return match.conversation_id as string
}

/** When a page is deleted from the menu, demote its block card (keep body, clear page link). */
export async function demoteBlockForDeletedBoard(
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
    delete existing.linkedBoardId
    delete existing.linkedPageId
    delete existing.isBoard
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

  {
    const { data: messages } = await supabase
      .from('messages')
      .select('id, conversation_id')
      .contains('metadata', { linkedBoardId: pageId })
    const match = (messages || [])[0]
    if (match) return clearMeta(match.id, match.conversation_id as string)
  }
  {
    const { data: messages } = await supabase
      .from('messages')
      .select('id, conversation_id')
      .contains('metadata', { linkedPageId: pageId })
    const match = (messages || [])[0]
    if (match) return clearMeta(match.id, match.conversation_id as string)
  }
  return null
}

/** When a block card is deleted, delete its linked page so nav stays in sync. */
export async function deleteLinkedBoardForBlock(
  supabase: SupabaseClient,
  meta?: Record<string, unknown> | null
): Promise<string | null> {
  const linkedBoardId = getLinkedBoardId(meta)
  if (!linkedBoardId) return null
  const { error } = await supabase.from('conversations').delete().eq('id', linkedBoardId)
  if (error) throw error
  return linkedBoardId
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
  delete next.linkedBoardId // Duplicate is not the same board card
  delete next.linkedPageId
  delete next.isBoard
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
