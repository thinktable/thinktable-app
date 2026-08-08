// Import selected Notion pages onto a Thinktable page as frames (title + body in one frame)

import { createAdminClient } from '@/lib/supabase/admin'
import { newBlockMetadata } from '@/lib/blocks'
import { fetchNotionPageBlockTree } from './blocks'
import { notionPageBodyToHtml } from './blocks-to-html'
import {
  collectPageAndDescendants,
  filterTopLevelSharedPages,
  normalizeNotionId,
  searchAllAccessibleNotionPages,
  type NotionSearchPage,
} from './pages'

const COLS = 3 // Grid columns for frame layout
const GAP_X = 320 // Horizontal spacing between imported frames
const GAP_Y = 180 // Vertical spacing between imported frames
const START_X = 80 // Left origin for the import grid
const START_Y = 80 // Top origin for the import grid
const TREE_GAP_X = 280 // Mindmap horizontal indent per depth
const TREE_GAP_Y = 140 // Mindmap vertical spacing between siblings

/** Escape text used inside fallback HTML titles. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export type ImportNotionResult = {
  conversationId: string // Page that received the frames
  importedCount: number // Newly created frames
  skippedCount: number // Already-linked Notion pages skipped
  pages: NotionSearchPage[] // Pages that were considered for import
  nestedPageCount?: number // Child Thinktable pages created in the nav
}

function parseBoardIdFromReturnTo(returnTo: string): string | null {
  const match = returnTo.match(/^\/board\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) // UUID board path
  return match?.[1] ?? null // null → need a new board
}

async function resolveConversationId(opts: {
  userId: string
  returnTo?: string
  workspaceName?: string | null
}): Promise<string> {
  const admin = createAdminClient() // Service role
  let conversationId = opts.returnTo ? parseBoardIdFromReturnTo(opts.returnTo) : null // Prefer open board

  if (conversationId) {
    const { data: existing } = await admin
      .from('conversations')
      .select('id, user_id')
      .eq('id', conversationId)
      .maybeSingle() // Confirm board exists and is owned by user
    if (!existing || existing.user_id !== opts.userId) {
      conversationId = null // Fall back to creating a new board
    }
  }

  if (!conversationId) {
    const title = opts.workspaceName ? `${opts.workspaceName}` : 'Notion' // Name the new map after the workspace
    const { data: created, error: createError } = await admin
      .from('conversations')
      .insert({
        user_id: opts.userId,
        title,
        metadata: { position: -1, source: 'notion' }, // Pin near top; mark origin
      })
      .select('id')
      .single()

    if (createError || !created) {
      throw new Error(createError?.message || 'Failed to create board for Notion import')
    }
    conversationId = created.id // New board id
  }

  if (!conversationId) {
    throw new Error('Failed to resolve page for Notion import') // Should be unreachable
  }
  return conversationId
}

function layoutPositions(
  pages: NotionSearchPage[],
  mode: 'card' | 'mindmap',
  allPages: NotionSearchPage[]
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>() // id → canvas pos

  if (mode === 'card' || pages.length <= 1) {
    pages.forEach((page, index) => {
      const col = index % COLS // Grid column
      const row = Math.floor(index / COLS) // Grid row
      positions.set(page.id, {
        x: START_X + col * GAP_X,
        y: START_Y + row * GAP_Y,
      })
    })
    return positions
  }

  // Mindmap: place root at origin and walk descendants in DFS with depth indent
  const root = pages[0] // First page is the selected root
  const byParent = new Map<string, NotionSearchPage[]>() // children grouped by parent
  for (const page of allPages) {
    const parent = page.parent
    let parentKey: string | null = null
    if (parent?.type === 'page_id') parentKey = normalizeNotionId(String(parent.page_id || ''))
    if (parent?.type === 'database_id') parentKey = normalizeNotionId(String(parent.database_id || ''))
    if (!parentKey) continue
    const list = byParent.get(parentKey) || []
    list.push(page)
    byParent.set(parentKey, list)
  }

  let cursorY = START_Y // Vertical cursor for leaf placement
  const place = (page: NotionSearchPage, depth: number) => {
    positions.set(page.id, { x: START_X + depth * TREE_GAP_X, y: cursorY }) // Depth → x
    const children = (byParent.get(normalizeNotionId(page.id)) || []).filter((c) =>
      pages.some((p) => p.id === c.id)
    ) // Only layout pages in the import set
    if (children.length === 0) {
      cursorY += TREE_GAP_Y // Advance for next leaf
      return
    }
    for (const child of children) place(child, depth + 1) // Recurse
  }
  place(root, 0)

  // Any remaining selected pages not reached via tree get stacked below
  pages.forEach((page) => {
    if (positions.has(page.id)) return
    positions.set(page.id, { x: START_X, y: cursorY })
    cursorY += TREE_GAP_Y
  })

  return positions
}

export async function importNotionPagesToBoard(opts: {
  userId: string // Thinktable user
  accessToken: string // Notion OAuth token
  returnTo?: string // Path user started connect from
  workspaceName?: string | null // Optional board title seed
  pageIds?: string[] // Explicit picks from the import modal
  mode?: 'card' | 'mindmap' // card = one frame per pick; mindmap = pick + descendants
}): Promise<ImportNotionResult> {
  const admin = createAdminClient() // Service role for tokens + inserts
  const allPages = await searchAllAccessibleNotionPages(opts.accessToken) // Full accessible set
  const mode = opts.mode || 'card' // Default: add as frame(s)

  let pages: NotionSearchPage[] // Pages that become frames
  if (opts.pageIds && opts.pageIds.length > 0) {
    const wanted = new Set(opts.pageIds.map(normalizeNotionId)) // Selected ids
    if (mode === 'mindmap' && opts.pageIds.length === 1) {
      pages = collectPageAndDescendants(opts.pageIds[0], allPages) // Root + nested pages
    } else {
      pages = allPages.filter((p) => wanted.has(normalizeNotionId(p.id))) // Exact picks only
    }
  } else {
    // Legacy auto-import: top-level shares only (no nested content pages)
    pages = filterTopLevelSharedPages(allPages)
  }

  const conversationId = await resolveConversationId({
    userId: opts.userId,
    returnTo: opts.returnTo,
    workspaceName: opts.workspaceName,
  })

  const { data: existingMessages } = await admin
    .from('messages')
    .select('id, metadata')
    .eq('conversation_id', conversationId) // Existing frames on this page

  const alreadyLinked = new Set<string>() // notionPageIds already on the page
  for (const msg of existingMessages || []) {
    const notionPageId = (msg.metadata as { notionPageId?: string } | null)?.notionPageId
    if (notionPageId) alreadyLinked.add(normalizeNotionId(notionPageId)) // Skip duplicates
  }

  const toImport = pages.filter((p) => !alreadyLinked.has(normalizeNotionId(p.id))) // Only new
  const positions = layoutPositions(toImport, mode, allPages) // Canvas coordinates

  // Fetch each Notion page body once — all TipTap blocks land in that page’s single frame
  const bodyByNotionId = new Map<string, string>() // notion id → TipTap HTML
  await Promise.all(
    toImport.map(async (page) => {
      if (page.object !== 'page') {
        // Databases have no page body; keep the title as the frame content
        bodyByNotionId.set(normalizeNotionId(page.id), `<p>${escapeHtml(page.title || 'Untitled database')}</p>`)
        return
      }
      try {
        const tree = await fetchNotionPageBlockTree(opts.accessToken, page.id) // Nested block tree
        bodyByNotionId.set(normalizeNotionId(page.id), notionPageBodyToHtml(tree)) // One HTML doc
      } catch (err) {
        console.error('Failed to fetch Notion page body:', page.id, err)
        // Fall back to title so import still creates a usable frame
        bodyByNotionId.set(normalizeNotionId(page.id), `<p>${escapeHtml(page.title || 'Untitled')}</p>`)
      }
    })
  )

  const rows = toImport.map((page) => {
    const position = positions.get(page.id) || { x: START_X, y: START_Y } // Fallback origin
    const body =
      bodyByNotionId.get(normalizeNotionId(page.id)) ||
      `<p>${escapeHtml(page.title || 'Untitled')}</p>` // Safety fallback
    return {
      conversation_id: conversationId, // Target page
      user_id: opts.userId, // Owner
      role: 'user', // Frames are user-role messages in this app
      content: body, // Full Notion page body as TipTap HTML (one frame)
      metadata: newBlockMetadata({
        position, // Canvas coordinates
        blockTitle: page.title || 'Untitled', // Frame title chip = Notion page name
        notionPageId: page.id, // Link back for sync later
        notionObject: page.object, // page vs database
        notionUrl: page.url ?? null, // Deep link
        notionIcon: page.icon ?? null, // Optional icon payload
      }),
    }
  })

  // notion id → inserted message id (for linking nested Thinktable pages)
  const notionIdToMessageId = new Map<string, string>()

  if (rows.length > 0) {
    const { data: inserted, error: insertError } = await admin
      .from('messages')
      .insert(rows)
      .select('id, metadata') // Need ids to link child pages
    if (insertError) {
      throw new Error(insertError.message || 'Failed to import Notion pages as frames')
    }
    for (const msg of inserted || []) {
      const notionPageId = (msg.metadata as { notionPageId?: string } | null)?.notionPageId
      if (notionPageId) notionIdToMessageId.set(normalizeNotionId(notionPageId), msg.id)
    }
  }

  // Also create nested Thinktable pages in the nav under the current page (with Notion icons)
  const { data: existingConvs } = await admin
    .from('conversations')
    .select('id, metadata')
    .eq('user_id', opts.userId)

  const alreadyMenuLinked = new Set<string>() // notionPageIds already represented as child pages
  for (const conv of existingConvs || []) {
    const meta = (conv.metadata as { notionPageId?: string } | null) || {}
    if (meta.notionPageId) alreadyMenuLinked.add(normalizeNotionId(meta.notionPageId))
  }

  const pagesForMenu = pages.filter((p) => !alreadyMenuLinked.has(normalizeNotionId(p.id))) // New menu pages only
  const notionIdToConvId = new Map<string, string>() // Notion id → new Thinktable page id (for mindmap nesting)

  // Create parents before children so mindmap nesting can resolve
  const orderedForMenu =
    mode === 'mindmap'
      ? pagesForMenu // Already DFS-ish from collectPageAndDescendants when single root
      : pagesForMenu

  for (const page of orderedForMenu) {
    // Resolve Thinktable parent: current page, or the child page created for this Notion page's parent
    let parentId = conversationId
    if (mode === 'mindmap' && page.parent) {
      let notionParentKey: string | null = null
      if (page.parent.type === 'page_id') notionParentKey = normalizeNotionId(String(page.parent.page_id || ''))
      if (page.parent.type === 'database_id') notionParentKey = normalizeNotionId(String(page.parent.database_id || ''))
      if (notionParentKey && notionIdToConvId.has(notionParentKey)) {
        parentId = notionIdToConvId.get(notionParentKey)! // Nest under sibling Thinktable page
      }
    }

    const iconMeta = page.icon
      ? page.icon.type === 'emoji' && page.icon.emoji
        ? { type: 'emoji' as const, emoji: page.icon.emoji }
        : page.icon.type === 'external' && page.icon.external?.url
          ? { type: 'external' as const, url: page.icon.external.url }
          : page.icon.type === 'file' && page.icon.file?.url
            ? { type: 'file' as const, url: page.icon.file.url }
            : null
      : null

    const sourceBlockMessageId = notionIdToMessageId.get(normalizeNotionId(page.id)) || null // Frame on parent page
    const body =
      bodyByNotionId.get(normalizeNotionId(page.id)) ||
      `<p>${escapeHtml(page.title || 'Untitled')}</p>` // Same body as the map frame
    const hasBody = body.replace(/<[^>]*>/g, '').trim().length > 0 // Visible text?

    const { data: createdChild, error: childError } = await admin
      .from('conversations')
      .insert({
        user_id: opts.userId,
        title: page.title || 'Untitled',
        metadata: {
          parent_id: parentId, // Nest under the Thinktable page where import ran
          notionPageId: page.id, // Link back to Notion
          notionObject: page.object,
          notionUrl: page.url ?? null,
          icon: iconMeta, // Show Notion emoji/file icon in the Pages menu
          source: 'notion',
          hasContent: hasBody, // True when Notion body (or title fallback) has text
          ...(sourceBlockMessageId ? { sourceBlockMessageId } : {}), // Dual-link with map frame
        },
      })
      .select('id')
      .single()

    if (childError || !createdChild) {
      console.error('Failed to create nested page for Notion import:', childError)
      continue
    }
    notionIdToConvId.set(normalizeNotionId(page.id), createdChild.id)

    // Point the parent-page frame at this child page (title chip / preview / expand)
    if (sourceBlockMessageId) {
      const { data: frameRow } = await admin
        .from('messages')
        .select('metadata')
        .eq('id', sourceBlockMessageId)
        .maybeSingle()
      const existingMeta = (frameRow?.metadata as Record<string, unknown>) || {}
      await admin
        .from('messages')
        .update({
          metadata: {
            ...existingMeta,
            linkedPageId: createdChild.id, // Frame ↔ nested page
            blockTitle: page.title || 'Untitled',
          },
        })
        .eq('id', sourceBlockMessageId)
    }

    // Materialize the same Notion body as the page-body frame on the child page
    if (hasBody) {
      const { error: bodyError } = await admin.from('messages').insert({
        conversation_id: createdChild.id, // Child page’s map
        user_id: opts.userId,
        role: 'user',
        content: body, // Same TipTap HTML as the parent map frame
        metadata: newBlockMetadata({
          isPageBody: true, // This frame IS the page’s body
          blockTitle: page.title || 'Untitled',
          position: { x: START_X, y: START_Y },
          notionPageId: page.id,
          notionObject: page.object,
          notionUrl: page.url ?? null,
          notionIcon: page.icon ?? null,
        }),
      })
      if (bodyError) {
        console.error('Failed to create page-body frame for Notion import:', bodyError)
      }
    }
  }

  return {
    conversationId, // Page to open after redirect
    importedCount: rows.length, // How many new frames
    skippedCount: pages.length - rows.length, // Already present
    pages, // Pages considered
    nestedPageCount: notionIdToConvId.size, // Child pages added to the Pages menu
  }
}
