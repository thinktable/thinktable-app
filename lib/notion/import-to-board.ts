// Import selected Notion pages onto a Thinktable page as boardLink frames (body on nested pages)

import { createAdminClient } from '@/lib/supabase/admin'
import { newBlockMetadata } from '@/lib/blocks'
import { fetchNotionPageBlockTree, type NotionBlock } from './blocks'
import {
  collectChildPageRefs,
  notionPageBodyToHtml,
  type ChildPageLinkMap,
} from './blocks-to-html'
import {
  collectMindmapSubtreeViaBlocks,
  filterTopLevelSharedPages,
  normalizeNotionId,
  resolveBlockIdParents,
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

/** Build TipTap HTML for a Notion database as one compact databaseBlock (header chrome). */
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


/** Title-variant boardLink HTML — same chrome as local page blocks (icon + title + open menu). */
function boardLinkHtml(opts: {
  boardId: string // Thinktable child board id
  title: string // Display label
  icon?: string | null // Emoji when Notion had one
}): string {
  const title = escapeHtml(opts.title || 'Untitled') // Attr-safe title
  const iconAttr = opts.icon ? ` data-icon="${escapeHtml(opts.icon)}"` : '' // Optional emoji
  return `<div data-type="boardLink" data-board-id="${escapeHtml(opts.boardId)}" data-title="${title}" data-variant="title"${iconAttr}></div>`
}

/** Emoji string from a Notion icon payload, else null (default page icon in the NodeView). */
function emojiFromNotionIcon(icon: NotionSearchPage['icon']): string | null {
  return icon?.type === 'emoji' && icon.emoji ? icon.emoji : null
}

/** Notion page/database parent id when the page is nested under another imported object. */
function notionParentKey(page: NotionSearchPage): string | null {
  const parent = page.parent // Workspace / page / database / block
  if (!parent) return null // Top-level share — no parent thread
  if (parent.type === 'page_id') return normalizeNotionId(String(parent.page_id || '')) // Nest under page
  if (parent.type === 'database_id') return normalizeNotionId(String(parent.database_id || '')) // Nest under DB
  return null // block_id / unknown — no map-level parent link
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
 * Card: nested DBs → databaseBlock in parent body; DB rows stay off the map.
 * Mindmap: pages + databases as frames; DB rows become TipTap blocks inside the DB frame body.
 */
function pagesForMapFrames(
  pages: NotionSearchPage[],
  allPages: NotionSearchPage[],
  mode: 'card' | 'mindmap',
  explicitIds?: string[]
): NotionSearchPage[] {
  const importIds = new Set(pages.map((p) => normalizeNotionId(p.id))) // Everything in this import set
  const explicit = new Set((explicitIds || []).map(normalizeNotionId)) // User-picked ids from the modal
  const dbIds = new Set(
    pages.filter((p) => p.object === 'database').map((p) => normalizeNotionId(p.id))
  )
  void allPages // Lookup reserved for future card enrichments

  // Mindmap: keep pages + DBs; never one map frame per DB row
  if (mode === 'mindmap') {
    return pages.filter((page) => {
      if (page.object === 'database') return true
      if (page.parent?.type === 'database_id') {
        const dbId = normalizeNotionId(String(page.parent.database_id || ''))
        if (dbIds.has(dbId)) return false // Rows live as blocks in the DB frame
      }
      return true
    })
  }

  return pages.filter((page) => {
    const id = normalizeNotionId(page.id)

    // Database: only a map frame when the user explicitly picked it (or it's the sole card pick).
    // Nested DBs under an imported page become databaseBlocks in that page's body instead.
    if (page.object === 'database') {
      if (explicit.has(id)) return true // User asked for this DB as its own frame
      // In card mode with no explicit list (legacy), top-level DBs still get a frame
      if (!explicitIds || explicitIds.length === 0) return true
      // Nested under a page that is also importing → embed as block, skip frame
      const parent = page.parent
      if (parent?.type === 'page_id') {
        const parentId = normalizeNotionId(String(parent.page_id || ''))
        if (importIds.has(parentId)) return false
      }
      return true // Orphan / workspace DB with no parent frame in set → one frame
    }

    // Page that is a database row: skip map frame when its parent DB is in this card import
    const parent = page.parent
    if (parent?.type === 'database_id') {
      const dbId = normalizeNotionId(String(parent.database_id || ''))
      if (importIds.has(dbId) && !explicit.has(id)) return false
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
  mode: 'card' | 'mindmap'
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
  for (const page of pages) {
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
  signal?: AbortSignal // Picker Cancel — stop before writing frames
}): Promise<ImportNotionResult> {
  const throwIfAborted = () => {
    if (!opts.signal?.aborted) return
    const err = new Error('Import cancelled')
    err.name = 'AbortError'
    throw err
  }

  const admin = createAdminClient() // Service role for tokens + inserts
  const rawPages = await searchAllAccessibleNotionPages(opts.accessToken, opts.signal) // Full accessible set
  throwIfAborted()
  // Nested DBs often report parent.block_id — rewrite to owning page for tree/threads
  const allPages = await resolveBlockIdParents(opts.accessToken, rawPages)
  throwIfAborted()
  const mode = opts.mode || 'card' // Default: add as frame(s)

  let pages: NotionSearchPage[] // Pages that become frames
  if (opts.pageIds && opts.pageIds.length > 0) {
    const wanted = new Set(opts.pageIds.map(normalizeNotionId)) // Selected ids
    if (mode === 'mindmap' && opts.pageIds.length === 1) {
      // Walk child_page blocks — search alone often returns only the shared root
      pages = await collectMindmapSubtreeViaBlocks(
        opts.accessToken,
        opts.pageIds[0],
        allPages,
        8,
        opts.signal
      )
    } else {
      pages = allPages.filter((p) => wanted.has(normalizeNotionId(p.id))) // Exact picks only
    }
  } else {
    // Legacy auto-import: top-level shares only (no nested content pages)
    pages = filterTopLevelSharedPages(allPages)
  }
  throwIfAborted()

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
  const positions = layoutPositions(framePages, mode) // Canvas coordinates
  const pagesById = new Map(allPages.map((p) => [normalizeNotionId(p.id), p])) // Enrich DB blocks

  // Fetch Notion trees for map frames + discover nested child_pages (their own boards, not inlined)
  const treesByNotionId = new Map<string, NotionBlock[]>() // notion id → block tree
  const bodyPagesNeeded = new Map<string, NotionSearchPage>() // every page/DB that gets a Thinktable board
  for (const page of framePages) {
    bodyPagesNeeded.set(normalizeNotionId(page.id), page)
  }

  /** Recursively fetch a page tree and queue its child_pages for their own boards. */
  const fetchTreeAndDiscover = async (page: NotionSearchPage): Promise<void> => {
    throwIfAborted()
    const id = normalizeNotionId(page.id)
    if (page.object !== 'page') return // Databases have no child_page body tree here
    if (treesByNotionId.has(id)) return // Already fetched
    try {
      const tree = await fetchNotionPageBlockTree(opts.accessToken, page.id, 4, opts.signal)
      treesByNotionId.set(id, tree)
      for (const ref of collectChildPageRefs(tree)) {
        const cid = normalizeNotionId(ref.id)
        if (bodyPagesNeeded.has(cid)) continue // Already queued (map frame or earlier discovery)
        const fromSearch = pagesById.get(cid)
        const childPage: NotionSearchPage = fromSearch
          ? {
              ...fromSearch,
              parent: { type: 'page_id', page_id: page.id }, // Nest under this Notion page
            }
          : {
              id: ref.id,
              object: 'page',
              title: ref.title,
              parent: { type: 'page_id', page_id: page.id },
              icon: null,
            }
        bodyPagesNeeded.set(cid, childPage)
        await fetchTreeAndDiscover(childPage) // Recurse into nested sub-pages
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err // Cancel must stop the import
      console.error('Failed to fetch Notion page body:', page.id, err)
      treesByNotionId.set(id, []) // Empty tree → title fallback later
    }
  }

  await Promise.all(framePages.map((page) => fetchTreeAndDiscover(page)))
  throwIfAborted()

  // Map frames: Notion pages + databases → temp title, then title-variant boardLink
  // (DB table lives on the nested board body as databaseBlock — same as Add frame pages)
  const rows = framePages.map((page) => {
    const position = positions.get(page.id) || { x: START_X, y: START_Y } // Fallback origin
    const isDatabase = page.object === 'database'
    const title = page.title || (isDatabase ? 'Untitled database' : 'Untitled')
    return {
      conversation_id: conversationId, // Target board
      user_id: opts.userId, // Owner
      role: 'user', // Frames are user-role messages in this app
      content: `<p>${escapeHtml(title)}</p>`, // Temp until boardLink patch (pages + DBs)
      metadata: newBlockMetadata({
        position, // Canvas coordinates
        blockTitle: title,
        notionPageId: page.id, // Link back for sync later
        notionObject: page.object, // page vs database
        notionUrl: page.url ?? null, // Deep link for Open in Notion
        notionIcon: page.icon ?? null, // Optional icon payload
        isBoard: true, // Map frame links a nested Thinktable board
        blockType: 'board', // Title boardLink chrome after patch
      }),
    }
  })

  // notion id → inserted message id (for linking nested Thinktable boards)
  const notionIdToMessageId = new Map<string, string>()

  if (rows.length > 0) {
    throwIfAborted() // Don't write frames after Cancel
    const { data: inserted, error: insertError } = await admin
      .from('messages')
      .insert(rows)
      .select('id, metadata') // Need ids to link child boards
    if (insertError) {
      throw new Error(insertError.message || 'Failed to import Notion pages as frames')
    }
    for (const msg of inserted || []) {
      const notionPageId = (msg.metadata as { notionPageId?: string } | null)?.notionPageId
      if (notionPageId) notionIdToMessageId.set(normalizeNotionId(notionPageId), msg.id)
    }
  }

  // Mindmap: thread parent → child frames so the tree is wired (not just laid out).
  // Board load picks closest connection points from positions (root left → children right).
  if (mode === 'mindmap') {
    for (const msg of existingMessages || []) {
      const notionPageId = (msg.metadata as { notionPageId?: string } | null)?.notionPageId
      if (!notionPageId) continue
      const nid = normalizeNotionId(notionPageId)
      if (!notionIdToMessageId.has(nid)) notionIdToMessageId.set(nid, msg.id) // Reuse existing frames
    }

    const allMapFrames = pagesForMapFrames(pages, allPages, mode, opts.pageIds) // Full tree set
    const mapFrameIds = new Set(allMapFrames.map((p) => normalizeNotionId(p.id))) // Fast parent check
    const seenPairs = new Set<string>() // Dedupe batch rows
    const edgeRows: Array<{
      conversation_id: string
      user_id: string
      source_message_id: string
      target_message_id: string
      metadata: { algorithm: string; points: []; dotted: boolean }
    }> = []

    for (const page of allMapFrames) {
      const childMsgId = notionIdToMessageId.get(normalizeNotionId(page.id)) // Child frame
      if (!childMsgId) continue
      const parentNotionId = notionParentKey(page) // Notion hierarchy parent
      if (!parentNotionId || !mapFrameIds.has(parentNotionId)) continue // Parent not a map frame
      const parentMsgId = notionIdToMessageId.get(parentNotionId) // Parent frame
      if (!parentMsgId || parentMsgId === childMsgId) continue
      const pairKey = `${parentMsgId}->${childMsgId}`
      if (seenPairs.has(pairKey)) continue
      seenPairs.add(pairKey)
      edgeRows.push({
        conversation_id: conversationId, // Same board as the map frames
        user_id: opts.userId,
        source_message_id: parentMsgId, // Thread starts at parent
        target_message_id: childMsgId, // Ends at child sub-page frame
        metadata: {
          algorithm: 'Bezier Catmull-Rom', // Default Smooth thread (matches DEFAULT_THREAD_ALGORITHM)
          points: [], // Unbent — board uses Miro bezier between sides
          dotted: false,
        },
      })
    }

    if (edgeRows.length > 0) {
      const { error: edgeError } = await admin.from('panel_edges').upsert(edgeRows, {
        onConflict: 'source_message_id,target_message_id', // UNIQUE pair — skip duplicates
        ignoreDuplicates: true,
      })
      if (edgeError) {
        // Retry without metadata if column not migrated yet (same path as board-flow)
        if (String(edgeError.message || '').includes('metadata')) {
          const bare = edgeRows.map(({ metadata: _m, ...rest }) => rest)
          const { error: retryError } = await admin.from('panel_edges').upsert(bare, {
            onConflict: 'source_message_id,target_message_id',
            ignoreDuplicates: true,
          })
          if (retryError) console.error('Failed to create mindmap threads:', retryError)
        } else {
          console.error('Failed to create mindmap threads:', edgeError)
        }
      }
    }
  }

  // Create nested Thinktable boards (map frames + discovered child_pages) under the current board
  const { data: existingConvs } = await admin
    .from('conversations')
    .select('id, metadata')
    .eq('user_id', opts.userId)

  const notionIdToConvId = new Map<string, string>() // Notion id → Thinktable board id
  // Reuse existing boards already linked to these Notion pages
  for (const conv of existingConvs || []) {
    const meta = (conv.metadata as { notionPageId?: string } | null) || {}
    if (!meta.notionPageId) continue
    const nid = normalizeNotionId(meta.notionPageId)
    if (bodyPagesNeeded.has(nid) && !notionIdToConvId.has(nid)) {
      notionIdToConvId.set(nid, conv.id as string)
    }
  }

  // Parent-before-child order so Boards menu nesting resolves
  const orderedForMenu: NotionSearchPage[] = []
  const queued = new Set<string>()
  const enqueue = (page: NotionSearchPage) => {
    const id = normalizeNotionId(page.id)
    if (queued.has(id)) return
    queued.add(id)
    const parentKey = notionParentKey(page)
    if (parentKey && bodyPagesNeeded.has(parentKey) && !queued.has(parentKey)) {
      enqueue(bodyPagesNeeded.get(parentKey)!) // Parent first
    }
    orderedForMenu.push(page)
  }
  for (const page of bodyPagesNeeded.values()) enqueue(page)

  for (const page of orderedForMenu) {
    const nid = normalizeNotionId(page.id)
    const sourceBlockMessageId = notionIdToMessageId.get(nid) || null // Map-frame message when present

    // Create a board only when we don't already have one for this Notion page
    if (!notionIdToConvId.has(nid)) {
      // Resolve Thinktable parent: import board, or the board created for this Notion page's parent
      let parentId = conversationId
      const notionParent = notionParentKey(page)
      if (notionParent && notionIdToConvId.has(notionParent)) {
        parentId = notionIdToConvId.get(notionParent)! // Nest under parent’s Thinktable board
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

      const { data: createdChild, error: childError } = await admin
        .from('conversations')
        .insert({
          user_id: opts.userId,
          title: page.title || (page.object === 'database' ? 'Untitled database' : 'Untitled'),
          metadata: {
            parent_id: parentId,
            notionPageId: page.id,
            notionObject: page.object,
            notionUrl: page.url ?? null,
            icon: iconMeta,
            source: 'notion',
            hasContent: false, // Flipped true after body seed
            ...(sourceBlockMessageId ? { sourceBlockMessageId } : {}),
          },
        })
        .select('id')
        .single()

      if (childError || !createdChild) {
        console.error('Failed to create nested board for Notion import:', childError)
        continue
      }
      notionIdToConvId.set(nid, createdChild.id)
    }

    const linkedBoardId = notionIdToConvId.get(nid)
    if (!linkedBoardId) continue

    // Wire map frame ↔ nested board: pages + databases → sole title boardLink
    // (databaseBlock / page body live on the child board)
    if (sourceBlockMessageId) {
      const { data: frameRow } = await admin
        .from('messages')
        .select('content, metadata')
        .eq('id', sourceBlockMessageId)
        .maybeSingle()
      const existingMeta = (frameRow?.metadata as Record<string, unknown>) || {}
      const notionTitle = page.title || (page.object === 'database' ? 'Untitled database' : 'Untitled')
      const linkContent = boardLinkHtml({
        boardId: linkedBoardId,
        title: notionTitle,
        icon: emojiFromNotionIcon(page.icon),
      })
      await admin
        .from('messages')
        .update({
          content: linkContent,
          metadata: {
            ...existingMeta,
            linkedBoardId,
            blockTitle: notionTitle,
            notionUrl: page.url ?? null,
            isBoard: true,
            blockType: 'board',
          },
        })
        .eq('id', sourceBlockMessageId)
    }
  }

  // Build child_page → boardLink map once all boards exist
  const childPageLinks: ChildPageLinkMap = new Map()
  for (const [nid, boardId] of notionIdToConvId) {
    const page = bodyPagesNeeded.get(nid)
    childPageLinks.set(nid, {
      boardId,
      title: page?.title || 'Untitled',
      icon: emojiFromNotionIcon(page?.icon ?? null),
    })
  }

  // Seed each board body with THAT page’s content only (child_pages → boardLinks, not inlined)
  for (const page of orderedForMenu) {
    const nid = normalizeNotionId(page.id)
    const boardId = notionIdToConvId.get(nid)
    if (!boardId) continue

    let body: string
    if (page.object === 'database') {
      body = databaseBlockHtml(page)
    } else {
      const tree = treesByNotionId.get(nid)
      if (tree) {
        body = enrichDatabaseBlocksInHtml(
          notionPageBodyToHtml(tree, { childPageLinks }),
          pagesById
        )
      } else {
        body = `<p>${escapeHtml(page.title || 'Untitled')}</p>`
      }
    }

    const hasBody =
      body.replace(/<[^>]*>/g, '').trim().length > 0 ||
      body.includes('data-type="databaseBlock"') ||
      body.includes('data-type="boardLink"')

    if (!hasBody) continue

    // Skip if this board already has a body frame (reused existing board)
    const { data: existingBodies } = await admin
      .from('messages')
      .select('id, metadata')
      .eq('conversation_id', boardId)
    const hasBodyFrame = (existingBodies || []).some((m) => {
      const meta = (m.metadata as Record<string, unknown>) || {}
      return meta.isBoardBody === true || meta.isPageBody === true
    })
    if (hasBodyFrame) continue

    const { error: bodyError } = await admin.from('messages').insert({
      conversation_id: boardId,
      user_id: opts.userId,
      role: 'user',
      content: body,
      metadata: newBlockMetadata({
        isBoardBody: true,
        blockTitle: page.title || 'Untitled',
        position: { x: START_X, y: START_Y },
        notionPageId: page.id,
        notionObject: page.object,
        notionUrl: page.url ?? null,
        notionIcon: page.icon ?? null,
      }),
    })
    if (bodyError) {
      console.error('Failed to create board-body frame for Notion import:', bodyError)
      continue
    }

    // Mark board contentful
    const { data: convRow } = await admin
      .from('conversations')
      .select('metadata')
      .eq('id', boardId)
      .maybeSingle()
    const convMeta = (convRow?.metadata as Record<string, unknown>) || {}
    await admin
      .from('conversations')
      .update({ metadata: { ...convMeta, hasContent: true } })
      .eq('id', boardId)
  }

  return {
    conversationId, // Board to open after redirect
    importedCount: rows.length, // How many new frames
    skippedCount: pages.length - framePages.length, // Already present or collapsed into database blocks
    pages, // Pages considered
    nestedPageCount: notionIdToConvId.size, // Child boards added to the Boards menu
  }
}
