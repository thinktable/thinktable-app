// Item / page helpers — map cards are items; a titled item links to a child page (own map).

import type { SupabaseClient } from '@supabase/supabase-js' // Typed client for sync helpers

/** Rewrite legacy isNote / isInlineNote → isItem / isInlineItem (drops old keys). */
export function migrateLegacyItemFlags(meta: Record<string, unknown>): {
  meta: Record<string, unknown>
  changed: boolean
} {
  const next = { ...meta } // Shallow copy before mutating flags
  let changed = false
  if (next.isNote === true) {
    next.isItem = true // Switch old note flag to item
    delete next.isNote
    changed = true
  }
  if (next.isInlineNote === true) {
    next.isInlineItem = true // Switch old inline flag
    delete next.isInlineNote
    changed = true
  }
  return { meta: next, changed }
}

/** True when message metadata marks a map item (isItem, or not-yet-migrated isNote). */
export function isItemMeta(meta?: Record<string, unknown> | null): boolean {
  if (!meta) return false
  return meta.isItem === true || meta.isNote === true // isNote only until migrateLegacyItemFlags runs
}

/** Metadata written when creating a new map item (no page until titled). */
export function newItemMetadata(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    isItem: true, // Canonical item flag
    isInlineItem: true, // Placed item (honor metadata.position)
    ...extra, // Caller position / fadeIn / Notion fields
  }
}

/** Persist isNote→isItem migration for a batch of messages (idempotent). */
export async function migrateMessagesToItemFlag(
  supabase: SupabaseClient,
  messages: Array<{ id: string; metadata?: Record<string, unknown> | null }>
): Promise<void> {
  for (const msg of messages) {
    if (!msg.metadata) continue
    const { meta, changed } = migrateLegacyItemFlags(msg.metadata as Record<string, unknown>)
    if (!changed) continue
    await supabase.from('messages').update({ metadata: meta }).eq('id', msg.id)
    msg.metadata = meta // Keep in-memory rows consistent with DB
  }
}

/** Push a title to both the item message and its linked page (keeps them in sync). */
export async function syncItemAndPageTitle(
  supabase: SupabaseClient,
  opts: {
    messageId: string // Item message on the parent map
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

  // Merge item metadata so we do not wipe other fields
  const { data: row } = await supabase
    .from('messages')
    .select('metadata')
    .eq('id', opts.messageId)
    .single()
  const existing = (row?.metadata as Record<string, unknown>) || {}
  const { meta: migrated } = migrateLegacyItemFlags(existing) // Drop any leftover isNote keys
  const patch: Record<string, unknown> = {
    ...migrated,
    itemTitle: title, // Mirror of conversations.title
    linkedPageId: opts.linkedPageId, // Keep link explicit
    isPage: true, // Titled item = page card on parent map
    isItem: true, // Canonical item flag
  }
  if (typeof opts.titleEdgeT === 'number') patch.titleEdgeT = opts.titleEdgeT

  const { error: msgError } = await supabase
    .from('messages')
    .update({ metadata: patch })
    .eq('id', opts.messageId)
  if (msgError) throw msgError
}

/** After a page is renamed in the menu, mirror the title onto its source item card. */
export async function syncPageRenameToItem(
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
  const sourceItemMessageId = (page?.metadata as { sourceItemMessageId?: string } | null)?.sourceItemMessageId

  if (sourceItemMessageId) {
    const { data: row } = await supabase
      .from('messages')
      .select('id, metadata, conversation_id')
      .eq('id', sourceItemMessageId)
      .maybeSingle()
    if (row) {
      const { meta: migrated } = migrateLegacyItemFlags((row.metadata as Record<string, unknown>) || {})
      await supabase
        .from('messages')
        .update({
          metadata: {
            ...migrated,
            itemTitle: trimmed,
            linkedPageId: pageId,
            isPage: true,
            isItem: true,
          },
        })
        .eq('id', row.id)
      return row.conversation_id as string // Parent map to invalidate
    }
  }

  // Fallback: find item by linkedPageId (covers older rows without sourceItemMessageId)
  const { data: messages } = await supabase
    .from('messages')
    .select('id, metadata, conversation_id')
    .contains('metadata', { linkedPageId: pageId })

  const match = (messages || [])[0]
  if (!match) return null

  const { meta: migrated } = migrateLegacyItemFlags((match.metadata as Record<string, unknown>) || {})
  await supabase
    .from('messages')
    .update({
      metadata: {
        ...migrated,
        itemTitle: trimmed,
        linkedPageId: pageId,
        isPage: true,
        isItem: true,
      },
    })
    .eq('id', match.id)
  return match.conversation_id as string
}

/** When a page is deleted from the menu, demote its item card (keep body, clear page link). */
export async function demoteItemForDeletedPage(
  supabase: SupabaseClient,
  pageId: string
): Promise<string | null> {
  const { data: page } = await supabase
    .from('conversations')
    .select('metadata')
    .eq('id', pageId)
    .maybeSingle()
  const sourceItemMessageId = (page?.metadata as { sourceItemMessageId?: string } | null)?.sourceItemMessageId

  const clearMeta = async (messageId: string, conversationId: string) => {
    const { data: row } = await supabase
      .from('messages')
      .select('metadata')
      .eq('id', messageId)
      .single()
    const existing = { ...((row?.metadata as Record<string, unknown>) || {}) }
    delete existing.itemTitle // No longer a titled page card
    delete existing.linkedPageId
    delete existing.isPage
    await supabase.from('messages').update({ metadata: existing }).eq('id', messageId)
    return conversationId
  }

  if (sourceItemMessageId) {
    const { data: row } = await supabase
      .from('messages')
      .select('id, conversation_id')
      .eq('id', sourceItemMessageId)
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

/** When an item card is deleted, delete its linked page so nav stays in sync. */
export async function deleteLinkedPageForItem(
  supabase: SupabaseClient,
  meta?: Record<string, unknown> | null
): Promise<string | null> {
  const linkedPageId = typeof meta?.linkedPageId === 'string' ? meta.linkedPageId : null
  if (!linkedPageId) return null
  const { error } = await supabase.from('conversations').delete().eq('id', linkedPageId)
  if (error) throw error
  return linkedPageId
}
