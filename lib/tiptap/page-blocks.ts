// Helpers to turn TipTap **blocks** / frames into linked **pages** (pageLink nodes). See DEFINITIONS.md.

import type { Editor } from '@tiptap/react' // Editor mutations
import type { SupabaseClient } from '@supabase/supabase-js' // Persist child page + body
import { newBlockMetadata, isBlockContentEmpty } from '@/lib/blocks' // Frame metadata + empty check
import { htmlForEditorRange, type EditorBlockRef } from '@/lib/tiptap/block-selection'
import { htmlToPlainText } from '@/lib/blocks/turn-into' // Strip tags → plain-text title seed

/** Attributes carried by a pageLink node. */
export type PageLinkAttrs = {
  pageId: string
  title: string
  icon?: string | null
  variant?: 'inline' | 'title'
}

/**
 * Create a child page (conversation) nested under `parentId`, seeding its body with `bodyHtml`
 * when non-empty. Returns the new page id (or null on failure).
 */
export async function createChildPageForBlock(
  supabase: SupabaseClient,
  opts: {
    userId: string // Owner
    parentId: string // Conversation to nest under (Pages menu)
    sourceMessageId: string // Frame message that hosts the link (reverse sync)
    title: string // Page title
    bodyHtml?: string // Optional page-body content
  }
): Promise<string | null> {
  const { userId, parentId, sourceMessageId, title, bodyHtml } = opts
  const hasBody = !!bodyHtml && !isBlockContentEmpty(bodyHtml) // Only mark contentful when real content

  // Create the nested page
  const { data: child, error } = await supabase
    .from('conversations')
    .insert({
      user_id: userId,
      title: title || 'Untitled',
      metadata: {
        parent_id: parentId, // Nest under current page
        sourceBlockMessageId: sourceMessageId, // Reverse link to the hosting frame
        hasContent: hasBody, // Filled icon when it has a body
      },
    })
    .select('id')
    .single()
  if (error || !child) {
    console.error('Failed to create child page for block:', error)
    return null
  }

  // Seed the page body as its own block on the child page's map
  if (hasBody) {
    const { error: bodyError } = await supabase.from('messages').insert({
      conversation_id: child.id,
      user_id: userId,
      role: 'user',
      content: bodyHtml,
      metadata: newBlockMetadata({
        isPageBody: true, // This block IS the page's body
        blockTitle: title || 'Untitled',
        position: { x: 80, y: 80 },
        fadeIn: true,
      }),
    })
    if (bodyError) console.error('Failed to seed child page body:', bodyError)
  }

  return child.id as string
}

/** Replace a block range with an inline pageLink node (icon LEFT of the link text). */
export function replaceBlockWithPageLink(
  editor: Editor,
  block: EditorBlockRef,
  attrs: PageLinkAttrs
): boolean {
  if (!editor || editor.isDestroyed) return false
  return editor
    .chain()
    .focus()
    .deleteRange({ from: block.from, to: block.to }) // Remove the source line
    .insertContentAt(block.from, {
      type: 'pageLink',
      attrs: { ...attrs, variant: attrs.variant || 'inline' },
    })
    .run()
}

/**
 * Insert (or update) a title-variant pageLink at the TOP of the frame — icon on top, left-aligned.
 * Idempotent: if the first node is already a pageLink for this page, just refresh its attrs.
 */
export function insertPageTitleBlock(
  editor: Editor,
  attrs: PageLinkAttrs
): boolean {
  if (!editor || editor.isDestroyed) return false
  const first = editor.state.doc.firstChild // Existing top node
  if (first && first.type.name === 'pageLink') {
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
    .insertContentAt(0, { type: 'pageLink', attrs: { ...attrs, variant: 'title' } })
    .run()
}

/** Plain-text label for a block range (title seed). */
export function titleForBlock(editor: Editor, block: EditorBlockRef): string {
  const html = htmlForEditorRange(editor, block.from, block.to)
  return htmlToPlainText(html).split('\n')[0]?.trim() || 'Untitled'
}
