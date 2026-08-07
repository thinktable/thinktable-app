// Import selected Notion page titles onto a Thinktable board as note nodes

import { createAdminClient } from '@/lib/supabase/admin'
import {
  collectPageAndDescendants,
  filterTopLevelSharedPages,
  normalizeNotionId,
  searchAllAccessibleNotionPages,
  type NotionSearchPage,
} from './pages'

const COLS = 3 // Grid columns for card layout
const GAP_X = 320 // Horizontal spacing between imported notes
const GAP_Y = 180 // Vertical spacing between imported notes
const START_X = 80 // Left origin for the import grid
const START_Y = 80 // Top origin for the import grid
const TREE_GAP_X = 280 // Mindmap horizontal indent per depth
const TREE_GAP_Y = 140 // Mindmap vertical spacing between siblings

export type ImportNotionResult = {
  conversationId: string // Board that received the nodes
  importedCount: number // Newly created notes
  skippedCount: number // Already-linked Notion pages skipped
  pages: NotionSearchPage[] // Pages that were considered for import
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
  mode?: 'card' | 'mindmap' // card = titles only for picks; mindmap = pick + descendants
}): Promise<ImportNotionResult> {
  const admin = createAdminClient() // Service role for tokens + inserts
  const allPages = await searchAllAccessibleNotionPages(opts.accessToken) // Full accessible set
  const mode = opts.mode || 'card' // Default: add as card(s)

  let pages: NotionSearchPage[] // Pages whose titles become notes
  if (opts.pageIds && opts.pageIds.length > 0) {
    const wanted = new Set(opts.pageIds.map(normalizeNotionId)) // Selected ids
    if (mode === 'mindmap' && opts.pageIds.length === 1) {
      pages = collectPageAndDescendants(opts.pageIds[0], allPages) // Root + nested titles
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
    .eq('conversation_id', conversationId) // Existing nodes on this board

  const alreadyLinked = new Set<string>() // notionPageIds already on the board
  for (const msg of existingMessages || []) {
    const notionPageId = (msg.metadata as { notionPageId?: string } | null)?.notionPageId
    if (notionPageId) alreadyLinked.add(normalizeNotionId(notionPageId)) // Skip duplicates
  }

  const toImport = pages.filter((p) => !alreadyLinked.has(normalizeNotionId(p.id))) // Only new
  const positions = layoutPositions(toImport, mode, allPages) // Canvas coordinates

  const rows = toImport.map((page) => {
    const position = positions.get(page.id) || { x: START_X, y: START_Y } // Fallback origin
    return {
      conversation_id: conversationId, // Target board
      user_id: opts.userId, // Owner
      role: 'user', // Notes are user-role messages in this app
      content: page.title, // Node label = Notion page/database name only
      metadata: {
        isNote: true, // Render as note panel
        isInlineNote: true, // Honor metadata.position in board-flow
        position, // Canvas coordinates
        notionPageId: page.id, // Link back for sync later
        notionObject: page.object, // page vs database
        notionUrl: page.url ?? null, // Deep link
        notionIcon: page.icon ?? null, // Optional icon payload
      },
    }
  })

  if (rows.length > 0) {
    const { error: insertError } = await admin.from('messages').insert(rows) // Bulk create note nodes
    if (insertError) {
      throw new Error(insertError.message || 'Failed to import Notion pages as notes')
    }
  }

  return {
    conversationId, // Board to open after redirect
    importedCount: rows.length, // How many new notes
    skippedCount: pages.length - rows.length, // Already present
    pages, // Pages considered
  }
}
