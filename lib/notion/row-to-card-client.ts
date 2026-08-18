// Client-side: peel one Notion DB row into a Card frame on the current board
// (boardLink + property cells, child board, thread from the DB frame).

import type { SupabaseClient } from '@supabase/supabase-js'
import { newBlockMetadata } from '@/lib/blocks'
import {
  allPropertyCellsHtml,
  nonTitlePropertyCellsHtml,
  rowBoardLinkHtml,
  rowTitleFromCells,
} from '@/lib/notion/property-map'
import type { NotionDbProperty, NotionDbRow } from '@/lib/notion/database'
import { normalizeNotionId } from '@/lib/notion/pages'

const THREAD_ALGORITHM = 'Bezier Catmull-Rom'
const CARD_GAP_X = 320

export const NOTION_ROW_DRAG_MIME = 'application/x-thinktable-notion-row'

export type NotionRowDragPayload = {
  source: 'notion-db-row'
  notionDatabaseId: string
  row: NotionDbRow
  properties: NotionDbProperty[]
  databaseTitle?: string
}

/** Build TipTap HTML for a Card-view frame: title boardLink + non-title property cells. */
export function cardFrameHtmlFromRow(opts: {
  boardId: string
  title: string
  icon?: string | null
  properties: NotionDbProperty[]
  row: NotionDbRow
}): string {
  const link = rowBoardLinkHtml({
    boardId: opts.boardId,
    title: opts.title,
    icon: opts.icon,
  })
  const props = nonTitlePropertyCellsHtml(opts.properties, opts.row.cells)
  return `${link}${props}` || link
}

/** Board-body HTML: all property cells (notes optional). */
export function cardBoardBodyHtmlFromRow(opts: {
  properties: NotionDbProperty[]
  row: NotionDbRow
  notesHtml?: string
}): string {
  const props = allPropertyCellsHtml(opts.properties, opts.row.cells)
  const notes = (opts.notesHtml || '').trim() || '<p></p>'
  return `${props}${notes}`
}

/**
 * Create one Card frame for a DB row on `conversationId`, threaded from `sourceMessageId`.
 * Uses the browser Supabase client (RLS). Returns the new frame message id.
 */
export async function createRowCardOnBoard(opts: {
  supabase: SupabaseClient
  userId: string
  conversationId: string
  sourceMessageId?: string // DB frame to thread from (optional)
  notionDatabaseId: string
  databaseTitle?: string
  properties: NotionDbProperty[]
  row: NotionDbRow
  /** Flow position for the card; default = right of origin */
  position?: { x: number; y: number }
  origin?: { x: number; y: number }
  /** Optional fixed message id (stack host needs a known id for groupId). */
  cardMessageId?: string
  /** Merged into frame metadata (e.g. sideStacks for bring-along stack). */
  frameMetadataExtras?: Record<string, unknown>
}): Promise<{ cardMessageId: string; boardId: string }> {
  const {
    supabase,
    userId,
    conversationId,
    sourceMessageId,
    notionDatabaseId,
    databaseTitle,
    properties,
    row,
  } = opts

  const title = rowTitleFromCells(properties, row.cells)
  const icon = typeof row.icon === 'string' ? row.icon : null
  const origin = opts.origin || { x: 80, y: 80 }
  const position = opts.position || { x: origin.x + CARD_GAP_X, y: origin.y }
  const boardId = crypto.randomUUID()
  const cardMessageId = opts.cardMessageId || crypto.randomUUID()
  const dbNorm = normalizeNotionId(notionDatabaseId)
  const dbTitle = databaseTitle || 'Database'
  const frameHtml = cardFrameHtmlFromRow({
    boardId,
    title,
    icon,
    properties,
    row,
  })
  const bodyHtml = cardBoardBodyHtmlFromRow({ properties, row })

  const { error: boardError } = await supabase.from('conversations').insert({
    id: boardId,
    user_id: userId,
    title: title || 'Untitled',
    metadata: {
      parent_id: conversationId,
      sourceBlockMessageId: cardMessageId,
      hasContent: true,
      notionPageId: row.id,
      notionUrl: row.url ?? null,
      notionDatabaseId: dbNorm,
      dbLayout: 'card',
    },
  })
  if (boardError) throw new Error(boardError.message || 'Failed to create row board')

  const { error: bodyError } = await supabase.from('messages').insert({
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
      notionDatabaseId: dbNorm,
    }),
  })
  if (bodyError) console.error('Failed to seed card board body:', bodyError)

  const { error: frameError } = await supabase.from('messages').insert({
    id: cardMessageId,
    conversation_id: conversationId,
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
      notionDatabaseId: dbNorm,
      notionDatabaseTitle: dbTitle,
      dbLayout: 'card',
      notionIcon: icon,
      ...(opts.frameMetadataExtras || {}),
    }),
  })
  if (frameError) throw new Error(frameError.message || 'Failed to create card frame')
  // Thread DB frame → card when we know the host frame (best-effort)
  if (sourceMessageId) {
    const edge = {
      conversation_id: conversationId,
      user_id: userId,
      source_message_id: sourceMessageId,
      target_message_id: cardMessageId,
      metadata: { algorithm: THREAD_ALGORITHM, points: [], dotted: false },
    }
    const { error: edgeError } = await supabase.from('panel_edges').upsert(edge, {
      onConflict: 'source_message_id,target_message_id',
      ignoreDuplicates: true,
    })
    if (edgeError && String(edgeError.message || '').includes('metadata')) {
      const { metadata: _m, ...bare } = edge
      await supabase.from('panel_edges').upsert(bare, {
        onConflict: 'source_message_id,target_message_id',
        ignoreDuplicates: true,
      })
    } else if (edgeError) {
      console.error('Failed to thread card to DB frame:', edgeError)
    }
  }

  return { cardMessageId, boardId }
}
