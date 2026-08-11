// Helpers to turn TipTap **blocks** / frames into linked **boards** (boardLink nodes). See DEFINITIONS.md.

import type { Editor } from '@tiptap/react' // Editor mutations
import type { SupabaseClient } from '@supabase/supabase-js' // Persist child board + body
import { newBlockMetadata, isBlockContentEmpty } from '@/lib/blocks' // Frame metadata + empty check
import { htmlForEditorRange, type EditorBlockRef } from '@/lib/tiptap/block-selection'
import { htmlToPlainText } from '@/lib/blocks/turn-into' // Strip tags → plain-text title seed

/** Attributes carried by a boardLink node. */
export type BoardLinkAttrs = {
  boardId: string // Linked child conversation id
  title: string // Display title
  icon?: string | null // Optional emoji
  variant?: 'inline' | 'title' // Chrome layout
}

/**
 * Create a child board (conversation) nested under `parentId`, seeding its body with `bodyHtml`
 * when non-empty. Returns the new board id (or null on failure).
 */
export async function createChildBoardForBlock(
  supabase: SupabaseClient,
  opts: {
    userId: string // Owner
    parentId: string // Conversation to nest under (Boards menu)
    sourceMessageId: string // Frame message that hosts the link (reverse sync)
    title: string // Board title
    bodyHtml?: string // Optional board-body content
  }
): Promise<string | null> {
  const { userId, parentId, sourceMessageId, title, bodyHtml } = opts
  const hasBody = !!bodyHtml && !isBlockContentEmpty(bodyHtml) // Only mark contentful when real content
  const boardId = crypto.randomUUID() // Client id so INSERT need not RETURNING through SELECT RLS

  // Create the nested board
  const { error } = await supabase.from('conversations').insert({
    id: boardId,
    user_id: userId,
    title: title || 'Untitled',
    metadata: {
      parent_id: parentId, // Nest under current board
      sourceBlockMessageId: sourceMessageId, // Reverse link to the hosting frame
      hasContent: hasBody, // Filled icon when it has a body
    },
  })
  if (error) {
    const msg =
      error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : 'unknown error'
    console.error('Failed to create child board for block:', msg, error)
    return null
  }

  // Seed the board body as its own frame on the child board's map
  if (hasBody) {
    const { error: bodyError } = await supabase.from('messages').insert({
      conversation_id: boardId,
      user_id: userId,
      role: 'user',
      content: bodyHtml,
      metadata: newBlockMetadata({
        isBoardBody: true, // This frame IS the board's body
        blockTitle: title || 'Untitled',
        position: { x: 80, y: 80 },
        fadeIn: true,
      }),
    })
    if (bodyError) console.error('Failed to seed child board body:', bodyError)
  }

  return boardId
}

/** Replace a block range with an inline boardLink node (icon LEFT of the link text). */
export function replaceBlockWithBoardLink(
  editor: Editor,
  block: EditorBlockRef,
  attrs: BoardLinkAttrs
): boolean {
  if (!editor || editor.isDestroyed) return false
  return editor
    .chain()
    .focus()
    .deleteRange({ from: block.from, to: block.to }) // Remove the source line
    .insertContentAt(block.from, {
      type: 'boardLink',
      attrs: { ...attrs, variant: attrs.variant || 'inline' },
    })
    .run()
}

/**
 * Insert (or update) a title-variant boardLink at the TOP of the frame — icon on top, left-aligned.
 * Idempotent: if the first node is already a boardLink for this board, just refresh its attrs.
 * Does NOT remove sibling blocks — use `setFrameToSoleBoardLink` after frame Turn into Board.
 */
export function insertBoardTitleBlock(
  editor: Editor,
  attrs: BoardLinkAttrs
): boolean {
  if (!editor || editor.isDestroyed) return false
  const first = editor.state.doc.firstChild // Existing top node
  if (first && first.type.name === 'boardLink') {
    // Already a title block — update its attrs in place (pos 0)
    return editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setNodeMarkup(0, undefined, { ...first.attrs, ...attrs, variant: 'title' })
        return true
      })
      .run()
  }
  return editor
    .chain()
    .focus()
    .insertContentAt(0, { type: 'boardLink', attrs: { ...attrs, variant: 'title' } })
    .run()
}

/**
 * Replace the whole frame doc with a sole title boardLink (matches DB after applyTurnInto).
 * Avoids prepend-only insertBoardTitleBlock leaving sibling blocks visible / re-saving into DB.
 */
export function setFrameToSoleBoardLink(
  editor: Editor,
  attrs: BoardLinkAttrs
): boolean {
  if (!editor || editor.isDestroyed) return false
  return editor
    .chain()
    .setContent(
      {
        type: 'doc',
        content: [
          {
            type: 'boardLink',
            attrs: { ...attrs, variant: 'title' },
          },
        ],
      },
      { emitUpdate: false } // DB already has sole link — don't race a blur-save of stale siblings
    )
    .focus() // Stay focused so content-sync can't re-apply stale sibling HTML before refetch
    .run()
}

/** Plain-text label for a block range (title seed). */
export function titleForBlock(editor: Editor, block: EditorBlockRef): string {
  const html = htmlForEditorRange(editor, block.from, block.to) // Serialize the block range to HTML
  return htmlToPlainText(html).split('\n')[0]?.trim() || 'Untitled' // First line becomes the board title
}
