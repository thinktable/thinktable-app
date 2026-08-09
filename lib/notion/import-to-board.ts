// Import selected Notion pages onto a Thinktable page as pageLink frames (body on nested pages)

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

/** Escape text used inside fallback HTML titles / attrs. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Build TipTap HTML for a Notion database as one compact databaseBlock (not sprawled frames). */
function databaseBlockHtml(page: NotionSearchPage): string {
  const title = escapeHtml(page.title || 'Untitled database') // Visible label
  const id = escapeHtml(page.id) // Notion database UUID
  const url = page.url ? escapeHtml(page.url) : '' // Open-in-Notion when present
  const icon =
    page.icon?.type === 'emoji' && page.icon.emoji ? escapeHtml(page.icon.emoji) : '' // Optional emoji
  const urlAttr = url ? ` data-url="${url}"` : ''
  const iconAttr = icon ? ` data-icon="${icon}"` : ''
  return `<div data-type="databaseBlock" data-notion-database-id="${id}" data-title="${title}"${urlAttr}${iconAttr}></div>`
}

/** Title-variant pageLink HTML — same chrome as local page blocks (icon + title + open menu). */
function pageLinkHtml(opts: {
  pageId: string // Thinktable child page id
  title: string // Display label
  icon?: string | null // Emoji when Notion had one
}): string {
  const title = escapeHtml(opts.title || 'Untitled') // Attr-safe title
  const iconAttr = opts.icon ? ` data-icon="${escapeHtml(opts.icon)}"` : '' // Optional emoji
  return `<div data-type="pageLink" data-page-id="${escapeHtml(opts.pageId)}" data-title="${title}" data-variant="title"${iconAttr}></div>`
}

/** Emoji string from a Notion icon payload, else null (default page icon in the NodeView). */
function emojiFromNotionIcon(icon: NotionSearchPage['icon']): string | null {
  return icon?.type === 'emoji' && icon.emoji ? icon.emoji : null
}

/**
 * Enrich child_database → databaseBlock tags in page HTML with url/icon from search results.
 * Why: blocks-to-html only has the Notion block title/id; search has deep links + icons.
 */
function enrichDatabaseBlocksInHtml(html: string, byId: Map<string, NotionSearchPage>): string {
  return html.replace(
    /<div\s+([^>]*data-type="databaseBlock"[^>]*)>/gi,
    (full, attrs: string) => {
      const idMatch = attrs.match(/data-notion-database-id="([^"]*)"/i) // Pull DB id from the tag
      if (!idMatch) return full
      const page = byId.get(normalizeNotionId(idMatch[1])) // Lookup accessible Notion DB
      if (!page) return full
      let next = attrs
      if (page.url && !/data-url=/.test(next)) {
        next += ` data-url="${escapeHtml(page.url)}"` // Add deep link when missing
      }
      if (page.icon?.type === 'emoji' && page.icon.emoji && !/data-icon=/.test(next)) {
        next += ` data-icon="${escapeHtml(page.icon.emoji)}"` // Add emoji when missing
      }
      if (page.title && !/data-title="[^"]+"/.test(next)) {
        next += ` data-title="${escapeHtml(page.title)}"` // Prefer search title if attr empty
      }
      return `<div ${next}>`
    }
  )
}

/**
 * Decide which Notion objects become map **frames**.
 * Databases nest as TipTap databaseBlocks inside the parent page frame; DB rows stay out of the
 * map so import doesn't sprawl one frame per row. Explicit root picks of a DB still get one frame.
 */
function pagesForMapFrames(
  pages: NotionSearchPage[],
  allPages: NotionSearchPage[],
  mode: 'card' | 'mindmap',
  explicitIds?: string[]
): NotionSearchPage[] {
  const importIds = new Set(pages.map((p) => normalizeNotionId(p.id))) // Everything in this import set
  const explicit = new Set((explicitIds || []).map(normalizeNotionId)) // User-picked ids from the modal
  const byId = new Map(allPages.map((p) => [normalizeNotionId(p.id), p])) // Flat lookup

  // Mindmap with a single database root → one frame for that DB only (rows are not frames)
  if (mode === 'mindmap' && explicitIds?.length === 1) {
    const root = byId.get(normalizeNotionId(explicitIds[0]))
    if (root?.object === 'database') return [root]
  }

  return pages.filter((page) => {
    const id = normalizeNotionId(page.id)

    // Database: only a map frame when the user explicitly picked it (or it's the sole card pick).
    // Nested DBs under an imported page become databaseBlocks in that page's body instead.
    if (page.object === 'database') {
      if (explicit.has(id)) return true // User asked for this DB as its own frame
      // In card mode with no explicit list (legacy), top-level DBs still get a frame
      if (mode === 'card' && (!explicitIds || explicitIds.length === 0)) return true
      // Nested under a page that is also importing → embed as block, skip frame
      const parent = page.parent
      if (parent?.type === 'page_id') {
        const parentId = normalizeNotionId(String(parent.page_id || ''))
        if (importIds.has(parentId)) return false
      }
      return true // Orphan / workspace DB with no parent frame in set → one frame
    }

    // Page that is a database row: skip map frame when its parent DB is in this import
    // (those rows would otherwise sprawl across the page). Explicit picks still import.
    const parent = page.parent
    if (parent?.type === 'database_id') {
      const dbId = normalizeNotionId(String(parent.database_id || ''))
      if (importIds.has(dbId) && !explicit.has(id)) return false
      // Parent DB not imported as its own object but we're mindmapping a page tree that includes
      // the DB via collectPageAndDescendants — still skip rows (DB is represented as a block).
      if (mode === 'mindmap' && importIds.has(dbId)) return false
    }

    return true // Regular Notion pages → one frame each
  })
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

  // Map frames: pages only (plus explicitly picked DBs). Nested DBs → TipTap blocks; DB rows stay off the map.
  const framePages = pagesForMapFrames(pages, allPages, mode, opts.pageIds).filter(
    (p) => !alreadyLinked.has(normalizeNotionId(p.id))
  )
  const positions = layoutPositions(framePages, mode, allPages) // Canvas coordinates
  const pagesById = new Map(allPages.map((p) => [normalizeNotionId(p.id), p])) // Enrich DB blocks

  // Fetch each Notion page body once — all TipTap blocks land in that page’s single frame
  const bodyByNotionId = new Map<string, string>() // notion id → TipTap HTML
  await Promise.all(
    framePages.map(async (page) => {
      if (page.object !== 'page') {
        // Database → one compact databaseBlock (not a frame-per-row sprawl)
        bodyByNotionId.set(normalizeNotionId(page.id), databaseBlockHtml(page))
        return
      }
      try {
        const tree = await fetchNotionPageBlockTree(opts.accessToken, page.id) // Nested block tree
        const html = enrichDatabaseBlocksInHtml(notionPageBodyToHtml(tree), pagesById) // child_database → databaseBlock + url/icon
        bodyByNotionId.set(normalizeNotionId(page.id), html) // One HTML doc
      } catch (err) {
        console.error('Failed to fetch Notion page body:', page.id, err)
        // Fall back to title so the nested page-body is still usable
        bodyByNotionId.set(normalizeNotionId(page.id), `<p>${escapeHtml(page.title || 'Untitled')}</p>`)
      }
    })
  )

  // Map frames: Notion pages *and* explicitly picked databases become pageLink-only (same chrome as
  // local page blocks). Nested DBs inside a page body stay as databaseBlock atoms. Page link HTML is
  // patched in once the child conversation id exists.
  const rows = framePages.map((page) => {
    const position = positions.get(page.id) || { x: START_X, y: START_Y } // Fallback origin
    // Temp title until linkedPageId → pageLink (DBs no longer use databaseBlock on the map)
    const content = `<p>${escapeHtml(page.title || 'Untitled')}</p>`
    return {
      conversation_id: conversationId, // Target page
      user_id: opts.userId, // Owner
      role: 'user', // Frames are user-role messages in this app
      content, // Replaced with pageLink after nested page is created
      metadata: newBlockMetadata({
        position, // Canvas coordinates
        blockTitle: page.title || 'Untitled', // Mirrors pageLink title
        notionPageId: page.id, // Link back for sync later
        notionObject: page.object, // page vs database
        notionUrl: page.url ?? null, // Deep link for Open in Notion
        notionIcon: page.icon ?? null, // Optional icon payload
        isPage: true, // Same page-block flags as snapshot / local pages
        blockType: 'page',
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

  const pagesForMenu = framePages.filter((p) => !alreadyMenuLinked.has(normalizeNotionId(p.id))) // New menu pages only (same set as map frames — no DB-row sprawl)
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
      (page.object === 'database'
        ? databaseBlockHtml(page)
        : `<p>${escapeHtml(page.title || 'Untitled')}</p>`) // Same body as the map frame
    const hasBody = body.replace(/<[^>]*>/g, '').trim().length > 0 || body.includes('data-type="databaseBlock"') // Visible text or a database block


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

    // Point the parent-page frame at this child page; Notion pages/DBs become a pageLink block
    // (same look as local page blocks) with Open in Notion via metadata.notionUrl.
    if (sourceBlockMessageId) {
      const { data: frameRow } = await admin
        .from('messages')
        .select('metadata')
        .eq('id', sourceBlockMessageId)
        .maybeSingle()
      const existingMeta = (frameRow?.metadata as Record<string, unknown>) || {}
      const linkContent = pageLinkHtml({
        pageId: createdChild.id, // Thinktable nested page
        title: page.title || 'Untitled',
        icon: emojiFromNotionIcon(page.icon), // Notion emoji when present
      })
      await admin
        .from('messages')
        .update({
          content: linkContent, // Replace temp title with pageLink
          metadata: {
            ...existingMeta,
            linkedPageId: createdChild.id, // Frame ↔ nested page
            blockTitle: page.title || 'Untitled',
            notionUrl: page.url ?? null, // Open-menu deep link
            isPage: true,
            blockType: 'page',
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
        content: body, // Notion TipTap HTML lives on the nested page, not the map pageLink
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
    skippedCount: pages.length - framePages.length, // Already present or collapsed into database blocks
    pages, // Pages considered
    nestedPageCount: notionIdToConvId.size, // Child pages added to the Pages menu
  }
}
