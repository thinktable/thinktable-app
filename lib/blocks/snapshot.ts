// Snapshot a page selection (frames + threads + drawings/shapes) into a new page — see DEFINITIONS.md.
// Copies the selected items exactly as they are (positions, thread connections, canvas nodes) onto a
// fresh child page, then drops a title-variant boardLink frame on the source page linking to it.

import type { SupabaseClient } from '@supabase/supabase-js'
import { newBlockMetadata } from '@/lib/blocks' // Canonical frame metadata

/** Escape text for safe HTML attribute insertion. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** A selected frame (message) to copy. */
export type SnapshotFrame = {
  oldId: string // Source message id (for edge remapping)
  content: string // Frame HTML content
  metadata: Record<string, unknown> // Frame metadata (position/colors/etc.)
  position: { x: number; y: number } // Absolute page position (preserves relative layout)
}

/** A thread between two selected frames (by source message id). */
export type SnapshotEdge = { source: string; target: string }

/** A selected canvas node (freehand drawing / shape). */
export type SnapshotCanvasNode = {
  node_type: string // 'freehand' | 'shape'
  position_x: number
  position_y: number
  width: number
  height: number
  data: unknown
}

export type SnapshotOpts = {
  userId: string
  sourceConversationId: string // Page the selection came from
  parentId: string // Page to nest the new snapshot page under (current or chosen)
  title: string // New board title
  frames: SnapshotFrame[]
  edges: SnapshotEdge[]
  canvas: SnapshotCanvasNode[]
  linkPosition: { x: number; y: number } // Where to drop the link frame on the source page
}

/**
 * Create a new page containing a snapshot of the selection; link to it from the source page.
 * Returns the new page id + the source-page link message id (or null on failure).
 */
export async function snapshotSelectionToBoard(
  supabase: SupabaseClient,
  opts: SnapshotOpts
): Promise<{ pageId: string; linkMessageId: string } | null> {
  const { userId, sourceConversationId, parentId, title, frames, edges, canvas, linkPosition } = opts
  const hasContent = frames.length > 0 || canvas.length > 0

  // 1) Create the new child page
  const { data: page, error: pageError } = await supabase
    .from('conversations')
    .insert({
      user_id: userId,
      title: title || 'Untitled',
      metadata: {
        parent_id: parentId, // Nest under current page in the Pages menu
        hasContent, // Filled icon when it carries a snapshot
      },
    })
    .select('id')
    .single()
  if (pageError || !page) {
    console.error('Snapshot: failed to create page:', pageError)
    return null
  }
  const pageId = page.id as string

  // 2) Copy frames (preserve position; drop legacy group membership)
  const idMap = new Map<string, string>() // oldMessageId → newMessageId
  for (const frame of frames) {
    const { blockGroupId: _drop, ...restMeta } = (frame.metadata || {}) as Record<string, unknown>
    const { data: inserted, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: pageId,
        user_id: userId,
        role: 'user',
        content: frame.content || '',
        metadata: {
          ...restMeta,
          isBlock: true, // Frames on a page
          position: frame.position, // Absolute → keeps relative arrangement
          blockGroupId: null, // Standalone on the snapshot page
          fadeIn: true,
        },
      })
      .select('id')
      .single()
    if (error || !inserted) {
      console.error('Snapshot: failed to copy frame:', error)
      continue
    }
    idMap.set(frame.oldId, inserted.id as string)
  }

  // 3) Recreate threads among the copied frames (remap message ids)
  const edgeRows = edges
    .map((e) => ({ source: idMap.get(e.source), target: idMap.get(e.target) }))
    .filter((e): e is { source: string; target: string } => !!e.source && !!e.target)
    .map((e) => ({
      conversation_id: pageId,
      user_id: userId,
      source_message_id: e.source,
      target_message_id: e.target,
    }))
  if (edgeRows.length > 0) {
    const { error } = await supabase.from('panel_edges').insert(edgeRows)
    if (error) console.error('Snapshot: failed to copy threads:', error)
  }

  // 4) Copy canvas nodes (drawings / shapes) with fresh ids
  if (canvas.length > 0) {
    const canvasRows = canvas.map((c) => ({
      id: crypto.randomUUID(),
      conversation_id: pageId,
      user_id: userId,
      node_type: c.node_type,
      position_x: c.position_x,
      position_y: c.position_y,
      width: c.width,
      height: c.height,
      data: c.data,
    }))
    const { error } = await supabase.from('canvas_nodes').insert(canvasRows)
    if (error) console.error('Snapshot: failed to copy canvas nodes:', error)
  }

  // 5) Drop a title-variant boardLink frame on the SOURCE page linking to the snapshot
  const titleDiv = `<div data-type="boardLink" data-board-id="${pageId}" data-title="${escapeHtml(
    title || 'Untitled'
  )}" data-variant="title"></div>`
  const { data: link, error: linkError } = await supabase
    .from('messages')
    .insert({
      conversation_id: sourceConversationId,
      user_id: userId,
      role: 'user',
      content: titleDiv,
      metadata: newBlockMetadata({
        position: linkPosition, // Where the popup was
        linkedBoardId: pageId,
        blockTitle: title || 'Untitled',
        isBoard: true,
        blockType: 'board',
        fadeIn: true,
      }),
    })
    .select('id')
    .single()
  if (linkError || !link) {
    console.error('Snapshot: failed to create link frame:', linkError)
    return { pageId, linkMessageId: '' }
  }
  const linkMessageId = link.id as string

  // 6) Reverse link: page knows which source frame links to it (menu rename/delete sync)
  await supabase
    .from('conversations')
    .update({ metadata: { parent_id: parentId, hasContent, sourceBlockMessageId: linkMessageId } })
    .eq('id', pageId)

  return { pageId, linkMessageId }
}
