// Convert a Notion database table frame ↔ Card view frames (threaded property frames + linked boards).

import type { SupabaseClient } from '@supabase/supabase-js'
import { newBlockMetadata } from '@/lib/blocks' // Canonical frame metadata
import { fetchNotionPageBlockTree } from '@/lib/notion/blocks' // Row page body tree
import { notionPageBodyToHtml } from '@/lib/notion/blocks-to-html' // Notes → TipTap HTML
import {
  fetchNotionDatabaseTable,
  type NotionDatabaseTable,
  type NotionDbRow,
} from '@/lib/notion/database'
import { parseDatabaseBlockAttrs, isSoleDatabaseBlockContent } from '@/lib/notion/migrate-frame' // Pull DB id from sole databaseBlock
import { normalizeNotionId } from '@/lib/notion/pages'
import {
  allPropertyCellsHtml,
  nonTitlePropertyCellsHtml,
  rowBoardLinkHtml,
  rowTitleFromCells,
} from '@/lib/notion/property-map'

/** Default Smooth thread algorithm (matches board-flow / EditableThread). */
const THREAD_ALGORITHM = 'Bezier Catmull-Rom'

/** Gap between card frames in flow units. */
const CARD_GAP_X = 320
/** Vertical gap when wrapping rows of cards. */
const CARD_GAP_Y = 220
/** How many cards per horizontal row before wrapping. */
const CARDS_PER_ROW = 4

export type ConvertDbLayoutOpts = {
  admin: SupabaseClient // Service role — insert frames/boards/threads
  accessToken: string // Notion OAuth token
  userId: string // Owner
  conversationId: string // Board the table frame sits on
  sourceMessageId: string // The database table frame message id
  layout: 'card' | 'table' // Target layout
  /** When set with layout=card, convert only this Notion page (row) → one threaded card. */
  rowId?: string
}

export type ConvertDbLayoutResult = {
  layout: 'card' | 'table'
  cardCount: number
  messageIds: string[] // Created or remaining frame message ids
  /** Board that now holds the cards / table (may differ from the map when converting a DB boardLink). */
  boardId: string
}

/** True when frame HTML / metadata is a Notion database table (not already Card view). */
export function isNotionDatabaseTableFrame(
  content: string,
  metadata?: Record<string, unknown> | null
): boolean {
  if (metadata?.dbLayout === 'card') return false // Already converted to cards
  if (metadata?.notionObject === 'database') return true // Imported DB map frame / body
  // Sole databaseBlock, or any frame that embeds one (block ⋮⋮ Convert uses host frame)
  if (isSoleDatabaseBlockContent(content || '')) return true
  return /data-type=["']databaseBlock["']/i.test(content || '')
}

/** Resolve Notion database id from a table frame. */
export function resolveNotionDatabaseIdFromFrame(
  content: string,
  metadata?: Record<string, unknown> | null
): string | null {
  if (typeof metadata?.notionDatabaseId === 'string' && metadata.notionDatabaseId) {
    return metadata.notionDatabaseId
  }
  if (typeof metadata?.notionPageId === 'string' && metadata.notionObject === 'database') {
    return metadata.notionPageId // Import stores DB id as notionPageId
  }
  return parseDatabaseBlockAttrs(content || '').notionDatabaseId
}

/** Build TipTap HTML for a Card-view frame: title boardLink + non-title property cells. */
function cardFrameHtml(opts: {
  boardId: string
  title: string
  icon?: string | null
  table: NotionDatabaseTable
  row: NotionDbRow
}): string {
  const link = rowBoardLinkHtml({
    boardId: opts.boardId,
    title: opts.title,
    icon: opts.icon,
  })
  const props = nonTitlePropertyCellsHtml(opts.table.properties, opts.row.cells)
  return `${link}${props}` || link // Always at least the boardLink
}

/** Build board-body HTML: all property cells, then Notion note blocks. */
function boardBodyHtml(opts: {
  table: NotionDatabaseTable
  row: NotionDbRow
  notesHtml: string
}): string {
  const props = allPropertyCellsHtml(opts.table.properties, opts.row.cells)
  const notes = (opts.notesHtml || '').trim() || '<p></p>' // TipTap needs a node
  return `${props}${notes}`
}

/** Layout origin from the source frame’s saved position. */
function originFromMeta(metadata?: Record<string, unknown> | null): { x: number; y: number } {
  const pos = metadata?.position as { x?: number; y?: number } | undefined
  const x = typeof pos?.x === 'number' ? pos.x : 80
  const y = typeof pos?.y === 'number' ? pos.y : 80
  return { x, y }
}

/** Flow position for card index i in a wrapping grid. */
function cardPosition(origin: { x: number; y: number }, index: number): { x: number; y: number } {
  const col = index % CARDS_PER_ROW
  const row = Math.floor(index / CARDS_PER_ROW)
  return { x: origin.x + col * CARD_GAP_X, y: origin.y + row * CARD_GAP_Y }
}

/** Strip databaseBlock atoms from frame HTML (keep sibling blocks). */
function stripDatabaseBlocks(content: string): string {
  return content
    .replace(/<div\b[^>]*data-type="databaseBlock"[^>]*(?:\/>|>[\s\S]*?<\/div>)/gi, '')
    .replace(/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '')
    .trim()
}

/** True when HTML is a title/inline boardLink (map DB frame after Add frame). */
function isBoardLinkHtml(content: string): boolean {
  return /data-type=["']boardLink["']/i.test(content || '')
}

/**
 * Where Card-view frames go + which table frames to remove.
 * Map DB boardLink → cards on the nested board (keep the link); table body → cards here.
 */
async function resolveCardConvertTarget(
  admin: SupabaseClient,
  opts: {
    userId: string
    conversationId: string
    sourceMessageId: string
    content: string
    meta: Record<string, unknown>
  }
): Promise<{
  cardsConversationId: string
  origin: { x: number; y: number }
  removeMessageIds: string[]
  stripSourceContent: boolean // Mixed body: strip DB atom instead of deleting the frame
}> {
  const { userId, conversationId, sourceMessageId, content, meta } = opts
  const linkedBoardId = typeof meta.linkedBoardId === 'string' ? meta.linkedBoardId : null
  const isDbMapLink =
    meta.notionObject === 'database' &&
    !!linkedBoardId &&
    (isBoardLinkHtml(content) || meta.blockType === 'board')

  if (isDbMapLink && linkedBoardId) {
    // Table lives on the nested board body — convert there; keep map boardLink
    const { data: nestedMsgs } = await admin
      .from('messages')
      .select('id, content, metadata')
      .eq('conversation_id', linkedBoardId)
      .eq('user_id', userId)
    const removeMessageIds: string[] = []
    let origin = { x: 80, y: 80 }
    for (const m of nestedMsgs || []) {
      const mMeta = (m.metadata as Record<string, unknown>) || {}
      if (mMeta.dbLayout === 'card') continue // Already a card frame
      const mContent = String(m.content || '')
      const isTableBody =
        isSoleDatabaseBlockContent(mContent) ||
        (mMeta.notionObject === 'database' && !isBoardLinkHtml(mContent))
      if (!isTableBody) continue
      removeMessageIds.push(m.id as string)
      if (removeMessageIds.length === 1) origin = originFromMeta(mMeta)
    }
    return {
      cardsConversationId: linkedBoardId,
      origin,
      removeMessageIds,
      stripSourceContent: false,
    }
  }

  // Table frame on this board (sole databaseBlock, or mixed page with a DB atom)
  const sole = isSoleDatabaseBlockContent(content)
  const hasDb = /data-type=["']databaseBlock["']/i.test(content)
  return {
    cardsConversationId: conversationId,
    origin: originFromMeta(meta),
    removeMessageIds: sole || !hasDb ? [sourceMessageId] : [],
    stripSourceContent: !sole && hasDb,
  }
}

/** Upsert Smooth threads between frames (metadata optional on older schemas). */
async function upsertCardThreads(
  admin: SupabaseClient,
  edgeRows: Array<{
    conversation_id: string
    user_id: string
    source_message_id: string
    target_message_id: string
    metadata: { algorithm: string; points: []; dotted: boolean }
  }>
): Promise<void> {
  if (edgeRows.length === 0) return
  const { error: edgeError } = await admin.from('panel_edges').upsert(edgeRows, {
    onConflict: 'source_message_id,target_message_id',
    ignoreDuplicates: true,
  })
  if (edgeError) {
    if (String(edgeError.message || '').includes('metadata')) {
      const bare = edgeRows.map(({ metadata: _m, ...rest }) => rest)
      const { error: retryError } = await admin.from('panel_edges').upsert(bare, {
        onConflict: 'source_message_id,target_message_id',
        ignoreDuplicates: true,
      })
      if (retryError) console.error('Failed to create card threads:', retryError)
    } else {
      console.error('Failed to create card threads:', edgeError)
    }
  }
}

/**
 * Create one Card-view frame for a Notion DB row (boardLink + property cells + child board).
 * Returns the new frame message id.
 */
async function insertRowCardFrame(opts: {
  admin: SupabaseClient
  accessToken: string
  userId: string
  cardsConversationId: string
  databaseId: string
  dbTitle: string
  table: NotionDatabaseTable
  row: NotionDbRow
  position: { x: number; y: number }
}): Promise<string> {
  const { admin, accessToken, userId, cardsConversationId, databaseId, dbTitle, table, row, position } =
    opts
  const title = rowTitleFromCells(table.properties, row.cells)
  const icon = typeof row.icon === 'string' ? row.icon : null

  let notesHtml = '<p></p>'
  try {
    const tree = await fetchNotionPageBlockTree(accessToken, row.id)
    notesHtml = notionPageBodyToHtml(tree)
  } catch (err) {
    console.error('Failed to fetch Notion row body for card:', row.id, err)
  }

  const boardId = crypto.randomUUID()
  const cardMessageId = crypto.randomUUID()
  const bodyHtml = boardBodyHtml({ table, row, notesHtml })
  const frameHtml = cardFrameHtml({ boardId, title, icon, table, row })

  const { error: boardError } = await admin.from('conversations').insert({
    id: boardId,
    user_id: userId,
    title: title || 'Untitled',
    metadata: {
      parent_id: cardsConversationId,
      sourceBlockMessageId: cardMessageId,
      hasContent: true,
      notionPageId: row.id,
      notionUrl: row.url ?? null,
      notionDatabaseId: normalizeNotionId(databaseId),
      dbLayout: 'card',
    },
  })
  if (boardError) throw new Error(boardError.message || 'Failed to create row board')

  const { error: bodyError } = await admin.from('messages').insert({
    conversation_id: boardId,
    user_id: userId,
    role: 'user',
    content: bodyHtml,
    metadata: newBlockMetadata({
      isBoardBody: true,
      blockTitle: title || 'Untitled',
      position: { x: 80, y: 80 },
      fadeIn: true,
      notionPageId: row.id,
      notionUrl: row.url ?? null,
      notionDatabaseId: normalizeNotionId(databaseId),
    }),
  })
  if (bodyError) console.error('Failed to seed card board body:', bodyError)

  const { error: frameError } = await admin.from('messages').insert({
    id: cardMessageId,
    conversation_id: cardsConversationId,
    user_id: userId,
    role: 'user',
    content: frameHtml,
    metadata: newBlockMetadata({
      position,
      fadeIn: true,
      blockTitle: title || 'Untitled',
      linkedBoardId: boardId,
      isBoard: true,
      blockType: 'board',
      notionPageId: row.id,
      notionUrl: row.url ?? null,
      notionObject: 'page',
      notionDatabaseId: normalizeNotionId(databaseId),
      notionDatabaseTitle: dbTitle,
      dbLayout: 'card',
      notionIcon: icon,
    }),
  })
  if (frameError) throw new Error(frameError.message || 'Failed to create card frame')

  return cardMessageId
}

/**
 * Convert a single Notion DB **row** into one Card-view frame threaded to the DB frame.
 * Keeps the live table; places the card to the right of the source frame.
 */
async function convertRowToCard(opts: ConvertDbLayoutOpts): Promise<ConvertDbLayoutResult> {
  const { admin, accessToken, userId, conversationId, sourceMessageId, rowId } = opts
  if (!rowId) throw new Error('rowId is required to convert a single row')

  const { data: source, error: sourceError } = await admin
    .from('messages')
    .select('id, content, metadata, conversation_id, user_id')
    .eq('id', sourceMessageId)
    .maybeSingle()
  if (sourceError || !source) throw new Error('Source frame not found')
  if (source.user_id !== userId) throw new Error('Not allowed to convert this frame')

  // Always place the card on the board that actually holds the DB frame (ignore stale client ids)
  const boardId = String(source.conversation_id)
  const clientBoard = conversationId ? String(conversationId).replace(/-/g, '') : ''
  const sourceBoard = boardId.replace(/-/g, '')
  if (clientBoard && clientBoard !== sourceBoard) {
    console.warn('Convert row: client board ≠ DB frame board; using frame board', {
      conversationId,
      boardId,
    })
  }

  const meta = (source.metadata as Record<string, unknown>) || {}
  const sourceContent = String(source.content || '')
  const databaseId = resolveNotionDatabaseIdFromFrame(sourceContent, meta)
  if (!databaseId) throw new Error('Frame is not a Notion database table')

  const table = await fetchNotionDatabaseTable(accessToken, databaseId)
  const rowNorm = normalizeNotionId(rowId)
  const row = table.rows.find((r) => normalizeNotionId(r.id) === rowNorm)
  if (!row) throw new Error('Row not found in this database')

  const origin = originFromMeta(meta)
  // Sit to the right of the DB frame so the thread reads DB → card
  const position = { x: origin.x + CARD_GAP_X, y: origin.y }
  const dbTitle = table.title || (typeof meta.blockTitle === 'string' ? meta.blockTitle : 'Database')

  const cardMessageId = await insertRowCardFrame({
    admin,
    accessToken,
    userId,
    cardsConversationId: boardId, // Same Thinktable board as the table
    databaseId,
    dbTitle,
    table,
    row,
    position,
  })

  // Thread DB frame → this card (table stays)
  await upsertCardThreads(admin, [
    {
      conversation_id: boardId,
      user_id: userId,
      source_message_id: sourceMessageId,
      target_message_id: cardMessageId,
      metadata: {
        algorithm: THREAD_ALGORITHM,
        points: [],
        dotted: false,
      },
    },
  ])

  return {
    layout: 'card',
    cardCount: 1,
    messageIds: [cardMessageId],
    boardId,
  }
}

/**
 * Convert a Notion database **table** frame into threaded **Card view** frames.
 * Each row → frame (boardLink title + property cells) + child board (properties + notes).
 * Consecutive cards get a thread. The original table body is removed (map boardLink kept).
 */
async function convertTableToCards(opts: ConvertDbLayoutOpts): Promise<ConvertDbLayoutResult> {
  const { admin, accessToken, userId, conversationId, sourceMessageId } = opts

  const { data: source, error: sourceError } = await admin
    .from('messages')
    .select('id, content, metadata, conversation_id, user_id')
    .eq('id', sourceMessageId)
    .maybeSingle()
  if (sourceError || !source) throw new Error('Source frame not found')
  if (source.conversation_id !== conversationId) throw new Error('Frame is not on this board')
  if (source.user_id !== userId) throw new Error('Not allowed to convert this frame')

  const meta = (source.metadata as Record<string, unknown>) || {}
  const sourceContent = String(source.content || '')
  const databaseId = resolveNotionDatabaseIdFromFrame(sourceContent, meta)
  if (!databaseId) throw new Error('Frame is not a Notion database table')

  const table = await fetchNotionDatabaseTable(accessToken, databaseId)
  if (!table.rows.length) throw new Error('Database has no rows to convert')

  const target = await resolveCardConvertTarget(admin, {
    userId,
    conversationId,
    sourceMessageId,
    content: sourceContent,
    meta,
  })
  const cardsConversationId = target.cardsConversationId
  const origin = target.origin
  const dbTitle = table.title || (typeof meta.blockTitle === 'string' ? meta.blockTitle : 'Database')
  const createdMessageIds: string[] = []
  const edgeRows: Array<{
    conversation_id: string
    user_id: string
    source_message_id: string
    target_message_id: string
    metadata: { algorithm: string; points: []; dotted: boolean }
  }> = []

  let prevMessageId: string | null = null

  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i]
    const cardMessageId = await insertRowCardFrame({
      admin,
      accessToken,
      userId,
      cardsConversationId,
      databaseId,
      dbTitle,
      table,
      row,
      position: cardPosition(origin, i),
    })
    createdMessageIds.push(cardMessageId)

    if (prevMessageId) {
      edgeRows.push({
        conversation_id: cardsConversationId,
        user_id: userId,
        source_message_id: prevMessageId,
        target_message_id: cardMessageId,
        metadata: {
          algorithm: THREAD_ALGORITHM,
          points: [],
          dotted: false,
        },
      })
    }
    prevMessageId = cardMessageId
  }

  // Remove table frame(s) / body (never delete a map DB boardLink — cards go inside its board)
  for (const id of target.removeMessageIds) {
    await admin.from('panel_edges').delete().or(`source_message_id.eq.${id},target_message_id.eq.${id}`)
    const { error: deleteError } = await admin.from('messages').delete().eq('id', id)
    if (deleteError) throw new Error(deleteError.message || 'Failed to remove table frame')
  }
  if (target.stripSourceContent) {
    const next = stripDatabaseBlocks(sourceContent)
    if (!next || isBlockContentEmptyish(next)) {
      await admin.from('panel_edges').delete().or(
        `source_message_id.eq.${sourceMessageId},target_message_id.eq.${sourceMessageId}`
      )
      const { error: deleteError } = await admin.from('messages').delete().eq('id', sourceMessageId)
      if (deleteError) throw new Error(deleteError.message || 'Failed to remove table frame')
    } else {
      const { error: updateError } = await admin
        .from('messages')
        .update({ content: next })
        .eq('id', sourceMessageId)
      if (updateError) throw new Error(updateError.message || 'Failed to strip database block')
    }
  }

  await upsertCardThreads(admin, edgeRows)

  return {
    layout: 'card',
    cardCount: createdMessageIds.length,
    messageIds: createdMessageIds,
    boardId: cardsConversationId,
  }
}

/** True when stripped HTML has no meaningful TipTap content left. */
function isBlockContentEmptyish(content: string): boolean {
  const text = content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
  return text.length === 0 && !/data-type=/.test(content)
}

/**
 * Convert Card-view frames (same Notion database) back into one table frame.
 * Uses the right-clicked card (or any card in the group) as the anchor position.
 */
async function convertCardsToTable(opts: ConvertDbLayoutOpts): Promise<ConvertDbLayoutResult> {
  const { admin, userId, conversationId, sourceMessageId } = opts

  const { data: source, error: sourceError } = await admin
    .from('messages')
    .select('id, content, metadata, conversation_id, user_id')
    .eq('id', sourceMessageId)
    .maybeSingle()
  if (sourceError || !source) throw new Error('Source frame not found')
  if (source.conversation_id !== conversationId) throw new Error('Frame is not on this board')
  if (source.user_id !== userId) throw new Error('Not allowed to convert this frame')

  const meta = (source.metadata as Record<string, unknown>) || {}
  const databaseId =
    (typeof meta.notionDatabaseId === 'string' && meta.notionDatabaseId) ||
    resolveNotionDatabaseIdFromFrame(String(source.content || ''), meta)
  if (!databaseId) throw new Error('Frame is not part of a Notion database Card view')
  if (meta.dbLayout !== 'card') {
    throw new Error('Select a Card view frame to convert to Table view')
  }

  const { data: allMessages, error: listError } = await admin
    .from('messages')
    .select('id, metadata')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
  if (listError) throw new Error(listError.message || 'Failed to list frames')

  const cardIds = (allMessages || [])
    .filter((m) => {
      const mMeta = (m.metadata as Record<string, unknown>) || {}
      if (mMeta.dbLayout !== 'card') return false
      const id = typeof mMeta.notionDatabaseId === 'string' ? mMeta.notionDatabaseId : ''
      return normalizeNotionId(id) === normalizeNotionId(databaseId)
    })
    .map((m) => m.id as string)

  if (cardIds.length === 0) throw new Error('No Card view frames found for this database')

  const origin = originFromMeta(meta)
  const dbTitle =
    (typeof meta.notionDatabaseTitle === 'string' && meta.notionDatabaseTitle) ||
    (typeof meta.blockTitle === 'string' && meta.blockTitle) ||
    'Database'
  const notionUrl = typeof meta.notionUrl === 'string' ? meta.notionUrl : null
  const tableMessageId = crypto.randomUUID()
  const titleEsc = dbTitle.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const urlAttr = notionUrl
    ? ` data-url="${notionUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`
    : ''
  const content = `<div data-type="databaseBlock" data-notion-database-id="${normalizeNotionId(databaseId)}" data-title="${titleEsc}"${urlAttr}></div>`

  // Drop card frames + their threads first
  for (const id of cardIds) {
    await admin.from('panel_edges').delete().or(`source_message_id.eq.${id},target_message_id.eq.${id}`)
  }
  const { error: deleteError } = await admin.from('messages').delete().in('id', cardIds)
  if (deleteError) throw new Error(deleteError.message || 'Failed to remove card frames')

  const { error: insertError } = await admin.from('messages').insert({
    id: tableMessageId,
    conversation_id: conversationId,
    user_id: userId,
    role: 'user',
    content,
    metadata: newBlockMetadata({
      position: origin,
      fadeIn: true,
      blockTitle: dbTitle,
      notionPageId: databaseId,
      notionObject: 'database',
      notionUrl,
      notionDatabaseId: normalizeNotionId(databaseId),
      isBoard: true,
      blockType: 'text',
      dbLayout: 'table',
    }),
  })
  if (insertError) throw new Error(insertError.message || 'Failed to create table frame')

  return { layout: 'table', cardCount: 0, messageIds: [tableMessageId], boardId: conversationId }
}

/** Convert the focused frame’s Notion database between Table and Card layouts.
 * Pass `rowId` with layout=card to peel one row into a card threaded to the DB frame.
 */
export async function convertNotionDbLayout(
  opts: ConvertDbLayoutOpts
): Promise<ConvertDbLayoutResult> {
  if (opts.layout === 'card' && opts.rowId) return convertRowToCard(opts)
  if (opts.layout === 'card') return convertTableToCards(opts)
  return convertCardsToTable(opts)
}
