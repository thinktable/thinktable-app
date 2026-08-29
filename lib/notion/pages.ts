// Notion Data API helpers for listing pages and building a sidebar-style tree

import { NOTION_VERSION } from './config'
import { fetchBlockChildren } from './blocks' // Walk child_page blocks for mindmap subtrees

export type NotionPageParent =
  | { type: 'workspace'; workspace: boolean }
  | { type: 'page_id'; page_id: string }
  | { type: 'database_id'; database_id: string }
  | { type: 'data_source_id'; data_source_id: string } // 2025-09-03: rows parent under a data source
  | { type: 'block_id'; block_id: string }
  | { type: string; [key: string]: unknown }

export type NotionSearchPage = {
  id: string // Notion page / database / data_source id
  object: 'page' | 'database' // data_source results normalized to 'database'
  url?: string // Open-in-Notion URL when present
  icon?: { type?: string; emoji?: string; external?: { url?: string }; file?: { url?: string } } | null
  title: string // Extracted display title for the mind-map node
  parent?: NotionPageParent | null // Used for tree nesting + top-level filtering
  lastEditedTime?: string // ISO last_edited_time — Recents sort (view recency is not in the public API)
}

export type NotionPageTreeNode = NotionSearchPage & {
  children: NotionPageTreeNode[] // Nested pages/databases (Notion sidebar order)
}

/** Notion sidebar sections used by the Import pages picker (same labels / order as Notion). */
export type NotionPickerSectionId = 'recents' | 'favorites' | 'shared' | 'private'

export type NotionPickerSection = {
  id: NotionPickerSectionId // Stable section key for collapse state
  title: string // Recents / Favorites / Shared / Private
  nodes: NotionPageTreeNode[] // Pages under this heading (trees start collapsed in the UI)
}

const PICKER_RECENTS_LIMIT = 10 // Notion Recents shows a short flat list, not the full tree

export function normalizeNotionId(id: string | undefined | null): string {
  return (id || '').replace(/-/g, '').toLowerCase() // Compare dashed vs undashed Notion ids
}

function extractTitle(result: Record<string, unknown>): string {
  if (result.object === 'database' || result.object === 'data_source') {
    const titleArr = (result.title as Array<{ plain_text?: string }> | undefined) || [] // DB / data source title
    const text = titleArr.map((t) => t.plain_text || '').join('').trim() // Flatten rich text
    if (text) return text
    // Search sometimes puts the label in `name` for data sources
    if (typeof result.name === 'string' && result.name.trim()) return result.name.trim()
    return 'Untitled database'
  }

  const properties = (result.properties as Record<string, { type?: string; title?: Array<{ plain_text?: string }> }> | undefined) || {}
  for (const prop of Object.values(properties)) {
    if (prop?.type === 'title') {
      const text = (prop.title || []).map((t) => t.plain_text || '').join('').trim() // Page title property
      if (text) return text // Prefer first non-empty title prop
    }
  }
  return 'Untitled' // Notion pages without a title still get a node
}

function parentTargetId(parent: NotionPageParent | null | undefined): string | null {
  if (!parent) return null // No parent info
  if (parent.type === 'page_id') return normalizeNotionId(String(parent.page_id || '')) // Nest under page
  if (parent.type === 'database_id') return normalizeNotionId(String(parent.database_id || '')) // Nest under database
  if (parent.type === 'data_source_id') return normalizeNotionId(String(parent.data_source_id || '')) // Nest under data source
  return null // workspace / unresolved block_id → treat as root in the picker tree
}

/**
 * Walk Notion block parents until we hit a page/database (nested DBs often use block_id).
 * Returns normalized page/database id, or null.
 */
async function resolveBlockOwnerId(accessToken: string, blockId: string): Promise<string | null> {
  let current = blockId
  for (let i = 0; i < 8; i++) {
    const res = await fetch(`https://api.notion.com/v1/blocks/${current}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Notion-Version': NOTION_VERSION,
      },
    })
    const payload = await res.json()
    if (!res.ok) return null
    const parent = payload?.parent as NotionPageParent | undefined
    if (!parent) return null
    if (parent.type === 'page_id') return normalizeNotionId(String(parent.page_id || ''))
    if (parent.type === 'database_id') return normalizeNotionId(String(parent.database_id || ''))
    if (parent.type === 'data_source_id') return normalizeNotionId(String(parent.data_source_id || ''))
    if (parent.type === 'block_id') {
      current = String(parent.block_id || '')
      if (!current) return null
      continue
    }
    return null // workspace
  }
  return null
}

/** Rewrite block_id parents to the owning page/database so the picker/search tree nests correctly. */
export async function resolveBlockIdParents(
  accessToken: string,
  pages: NotionSearchPage[]
): Promise<NotionSearchPage[]> {
  const cache = new Map<string, string | null>() // block id → owner page/db id
  const out: NotionSearchPage[] = []
  for (const page of pages) {
    if (page.parent?.type !== 'block_id') {
      out.push(page)
      continue
    }
    const blockId = String(page.parent.block_id || '')
    if (!blockId) {
      out.push(page)
      continue
    }
    const key = normalizeNotionId(blockId)
    if (!cache.has(key)) cache.set(key, await resolveBlockOwnerId(accessToken, blockId))
    const owner = cache.get(key)
    if (!owner) {
      out.push(page)
      continue
    }
    // Prefer page_id when the owner is a page in the set; else database_id
    const ownerIsDb = pages.some(
      (p) => p.object === 'database' && normalizeNotionId(p.id) === owner
    )
    out.push({
      ...page,
      parent: ownerIsDb
        ? { type: 'database_id', database_id: owner }
        : { type: 'page_id', page_id: owner },
    })
  }
  return out
}

/**
 * Build a Notion-sidebar-like tree from flat search results.
 * Children nest under page/database parents that are also in the accessible set.
 */
export function buildNotionPageTree(pages: NotionSearchPage[]): NotionPageTreeNode[] {
  const byNormId = new Map<string, NotionPageTreeNode>() // Fast parent lookup
  for (const page of pages) {
    byNormId.set(normalizeNotionId(page.id), { ...page, children: [] }) // Seed every node
  }

  const roots: NotionPageTreeNode[] = [] // Top of the picker tree
  for (const page of pages) {
    const node = byNormId.get(normalizeNotionId(page.id))! // Current node
    const parentId = parentTargetId(page.parent) // Normalized parent id if page/db
    const parentNode = parentId ? byNormId.get(parentId) : undefined // Parent in accessible set?
    if (parentNode && parentNode.id !== page.id) {
      parentNode.children.push(node) // Nest like Notion sidebar
    } else {
      roots.push(node) // Workspace roots + orphans (e.g. block-parented pages)
    }
  }

  const sortRecursively = (nodes: NotionPageTreeNode[]) => {
    nodes.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })) // Alpha like Notion
    for (const n of nodes) sortRecursively(n.children) // Sort each level
  }
  sortRecursively(roots)
  return roots
}

/** Copy a search hit as a Recents leaf (Notion Recents is flat — no nested chevrons). */
function clonePickerLeaf(page: NotionSearchPage): NotionPageTreeNode {
  return { ...page, children: [] } // Drop children so Recents cannot expand into the private tree
}

/**
 * Group accessible pages like Notion's sidebar: Recents, Favorites, Shared, Private.
 * Favorites is omitted — the public API does not expose starred pages.
 * Recents uses last_edited_time (closest public-API stand-in for last viewed).
 * Private = workspace-parented roots + their nested tree.
 * Shared = roots whose parent is not in the accessible set (shared-with-me style).
 */
export function buildNotionPickerSections(pages: NotionSearchPage[]): NotionPickerSection[] {
  const tree = buildNotionPageTree(pages) // Full nested tree; roots are workspace + orphans
  const privateRoots: NotionPageTreeNode[] = [] // parent.type === workspace (or missing)
  const sharedRoots: NotionPageTreeNode[] = [] // Parent page/db not shared with the connection
  for (const node of tree) {
    const parentType = node.parent?.type // workspace / page_id / database_id / …
    if (!parentType || parentType === 'workspace') {
      privateRoots.push(node) // Personal-workspace top level lives under Private
    } else {
      sharedRoots.push(node) // Orphan root → Shared (parent not in the accessible set)
    }
  }

  const recents = [...pages] // Shallow copy so sort does not mutate search order
    .sort((a, b) => (b.lastEditedTime || '').localeCompare(a.lastEditedTime || '')) // Newest first
    .slice(0, PICKER_RECENTS_LIMIT) // Cap like Notion Recents
    .map(clonePickerLeaf) // Flat rows — same page may also appear under Private/Shared

  const sections: NotionPickerSection[] = [] // Skip empty sections the way Notion hides unused sidebar groups
  if (recents.length) sections.push({ id: 'recents', title: 'Recents', nodes: recents })
  if (sharedRoots.length) sections.push({ id: 'shared', title: 'Shared', nodes: sharedRoots })
  if (privateRoots.length) sections.push({ id: 'private', title: 'Private', nodes: privateRoots })
  return sections
}

/**
 * Only pages/databases the user effectively shared as roots (not nested children).
 * Used when importing without an explicit page pick list.
 */
export function filterTopLevelSharedPages(pages: NotionSearchPage[]): NotionSearchPage[] {
  const accessible = new Set(pages.map((p) => normalizeNotionId(p.id))) // All ids the connection can see

  return pages.filter((page) => {
    const parent = page.parent // Workspace / page / database / block
    if (!parent || parent.type === 'workspace') return true // Workspace root = explicitly shared top-level

    if (parent.type === 'page_id') {
      const parentId = normalizeNotionId(String(parent.page_id || '')) // Parent page id
      return !accessible.has(parentId) // Keep only if parent was NOT also shared
    }

    if (parent.type === 'database_id') {
      const parentId = normalizeNotionId(String(parent.database_id || '')) // Parent database id
      return !accessible.has(parentId) // Skip database rows when the DB itself is in the set
    }

    if (parent.type === 'data_source_id') {
      const parentId = normalizeNotionId(String(parent.data_source_id || '')) // Parent data source id
      return !accessible.has(parentId) // Skip rows when the data source is in the set
    }

    if (parent.type === 'block_id') {
      return false // Block children are page "contents", not map roots
    }

    return true // Unknown parent shape: keep rather than drop user selections
  })
}

/** Collect a page and all of its descendants from the search tree (may miss nested child_pages). */
export function collectPageAndDescendants(rootId: string, allPages: NotionSearchPage[]): NotionSearchPage[] {
  const tree = buildNotionPageTree(allPages) // Hierarchy for DFS
  const byId = new Map(allPages.map((p) => [normalizeNotionId(p.id), p])) // Flat lookup
  const target = normalizeNotionId(rootId) // Selected root
  const found: NotionSearchPage[] = [] // Output in DFS order

  const walk = (nodes: NotionPageTreeNode[]) => {
    for (const node of nodes) {
      if (normalizeNotionId(node.id) === target) {
        const take = (n: NotionPageTreeNode) => {
          const page = byId.get(normalizeNotionId(n.id))
          if (page) found.push(page) // Include this node
          n.children.forEach(take) // Then descendants
        }
        take(node)
        return true // Stop after locating subtree
      }
      if (walk(node.children)) return true // Search deeper
    }
    return false
  }
  walk(tree)

  if (found.length === 0) {
    const solo = byId.get(target) // Fallback if tree miss
    if (solo) found.push(solo)
  }
  return found
}

/** GET /v1/pages/{id} → NotionSearchPage when search omitted a nested child. */
async function retrieveNotionPage(
  accessToken: string,
  pageId: string,
  parentOverride?: NotionPageParent | null
): Promise<NotionSearchPage | null> {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Notion-Version': NOTION_VERSION,
    },
  })
  const payload = await res.json()
  if (!res.ok || payload?.object !== 'page') {
    console.error('Failed to retrieve Notion page:', pageId, payload?.message)
    return null
  }
  return {
    id: payload.id,
    object: 'page',
    url: payload.url,
    icon: payload.icon ?? null,
    title: extractTitle(payload),
    // Prefer the owning page from the child_page walk (search parents are often block_id)
    parent: parentOverride ?? (payload.parent as NotionPageParent) ?? null,
  }
}

/** GET /v1/databases/{id} → NotionSearchPage (nested DBs often missing from search trees). */
async function retrieveNotionDatabase(
  accessToken: string,
  databaseId: string,
  parentOverride?: NotionPageParent | null
): Promise<NotionSearchPage | null> {
  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Notion-Version': NOTION_VERSION,
    },
  })
  const payload = await res.json()
  if (!res.ok || payload?.object !== 'database') {
    console.error('Failed to retrieve Notion database:', databaseId, payload?.message)
    return null
  }
  return {
    id: payload.id,
    object: 'database',
    url: payload.url,
    icon: payload.icon ?? null,
    title: extractTitle(payload),
    // Map parent to owning page so layout/threads ignore Notion's block_id parent
    parent: parentOverride ?? (payload.parent as NotionPageParent) ?? null,
  }
}

/** Rows of a database from search (+ optional query) — Notion rows are pages. */
export async function collectDatabaseRows(
  accessToken: string,
  databaseId: string,
  allPages: NotionSearchPage[]
): Promise<NotionSearchPage[]> {
  const dbKey = normalizeNotionId(databaseId)
  const parent: NotionPageParent = { type: 'database_id', database_id: databaseId }
  const byId = new Map<string, NotionSearchPage>()

  // Include pages parented by this database id OR this data_source id (search may use either)
  for (const page of allPages) {
    if (page.object !== 'page') continue
    if (page.parent?.type === 'database_id') {
      if (normalizeNotionId(String(page.parent.database_id || '')) !== dbKey) continue
      byId.set(normalizeNotionId(page.id), { ...page, parent })
    } else if (page.parent?.type === 'data_source_id') {
      if (normalizeNotionId(String(page.parent.data_source_id || '')) !== dbKey) continue
      byId.set(normalizeNotionId(page.id), { ...page, parent })
    }
  }

  // Resolve data source id(s) then query rows the search pagination missed
  const dataSourceIds: string[] = []
  try {
    const dbRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Notion-Version': NOTION_VERSION,
      },
    })
    const dbPayload = await dbRes.json()
    if (dbRes.ok && Array.isArray(dbPayload?.data_sources)) {
      for (const s of dbPayload.data_sources) {
        if (s?.id) dataSourceIds.push(String(s.id))
      }
    }
  } catch (err) {
    console.error('Database retrieve for row query failed:', databaseId, err)
  }
  // Id may already be a data_source id
  if (dataSourceIds.length === 0) dataSourceIds.push(databaseId)

  for (const dataSourceId of dataSourceIds) {
    let startCursor: string | undefined
    try {
      do {
        const res = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Notion-Version': NOTION_VERSION,
          },
          body: JSON.stringify({ page_size: 100, start_cursor: startCursor }),
        })
        const payload = await res.json()
        if (!res.ok) {
          console.error('Data source query failed:', dataSourceId, payload?.message)
          break
        }
        for (const result of payload.results || []) {
          if (result?.object !== 'page') continue
          const key = normalizeNotionId(result.id)
          if (byId.has(key)) continue
          byId.set(key, {
            id: result.id,
            object: 'page',
            url: result.url,
            icon: result.icon ?? null,
            title: extractTitle(result),
            parent,
          })
        }
        startCursor = payload.has_more ? payload.next_cursor : undefined
      } while (startCursor)
    } catch (err) {
      console.error('Data source query threw:', dataSourceId, err)
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  )
}

/**
 * Discover mindmap map-frames: child_page + child_database under a root page/DB.
 * Database **rows** stay off the map — they become TipTap blocks inside the DB frame body.
 */
export async function collectMindmapSubtreeViaBlocks(
  accessToken: string,
  rootId: string,
  allPages: NotionSearchPage[],
  maxDepth = 8,
  signal?: AbortSignal // Picker Cancel — stop the child_page walk
): Promise<NotionSearchPage[]> {
  const byId = new Map(allPages.map((p) => [normalizeNotionId(p.id), p])) // Enrich from search when present
  const ordered: NotionSearchPage[] = [] // DFS order for layout
  const seen = new Set<string>() // Prevent cycles / duplicate frames

  const push = (page: NotionSearchPage) => {
    const key = normalizeNotionId(page.id)
    if (seen.has(key)) return false
    seen.add(key)
    ordered.push(page)
    return true
  }

  /** One map frame for the database (rows land in its page-body as blocks later). */
  const addDatabaseFrame = async (
    databaseId: string,
    titleHint: string,
    parentForDb: NotionPageParent | null
  ) => {
    const dbKey = normalizeNotionId(databaseId)
    const fromSearch = byId.get(dbKey)
    let db: NotionSearchPage | null = fromSearch
      ? { ...fromSearch, parent: parentForDb ?? fromSearch.parent ?? null, object: 'database' }
      : await retrieveNotionDatabase(accessToken, databaseId, parentForDb)
    if (!db) {
      db = {
        id: databaseId,
        object: 'database',
        title: titleHint || 'Untitled database',
        parent: parentForDb,
        icon: null,
      }
    } else if (!db.title || db.title === 'Untitled database') {
      db = { ...db, title: titleHint || db.title }
    }
    push(db)
  }

  // Seed root from search, else retrieve as page or database
  const rootKey = normalizeNotionId(rootId)
  let root = byId.get(rootKey) || null
  if (!root) root = await retrieveNotionPage(accessToken, rootId)
  if (!root) root = await retrieveNotionDatabase(accessToken, rootId)
  if (!root) return [] // Cannot mindmap without the selected object

  if (root.object === 'database') {
    await addDatabaseFrame(root.id, root.title, root.parent ?? null) // Single DB frame; rows → body blocks
    return ordered
  }

  push(root)

  /** Recurse block children; child_page / child_database become map frames. */
  const walk = async (blockParentId: string, owningPageId: string, depth: number) => {
    if (signal?.aborted) {
      const err = new Error('Import cancelled')
      err.name = 'AbortError'
      throw err
    }
    if (depth > maxDepth) return // Cap API fan-out on huge trees
    let children
    try {
      children = await fetchBlockChildren(accessToken, blockParentId, signal)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err
      console.error('Mindmap block walk failed for', blockParentId, err)
      return
    }
    for (const block of children) {
      if (block.type === 'child_page') {
        const childId = block.id // child_page block id === page id
        const parent: NotionPageParent = { type: 'page_id', page_id: owningPageId }
        const fromSearch = byId.get(normalizeNotionId(childId))
        // Read once through the optional shape — a required-property cast doesn't overlap NotionBlock
        const childPageTitle = (block as { child_page?: { title?: string } }).child_page?.title
        const titleFromBlock = typeof childPageTitle === 'string' ? childPageTitle : 'Untitled'

        let page: NotionSearchPage | null = fromSearch
          ? { ...fromSearch, parent }
          : await retrieveNotionPage(accessToken, childId, parent)

        if (!page) {
          page = { id: childId, object: 'page', title: titleFromBlock, parent, icon: null }
        } else if (!page.title || page.title === 'Untitled') {
          page = { ...page, title: titleFromBlock || page.title }
        }

        if (push(page)) await walk(childId, childId, depth + 1) // Nested sub-pages
      } else if (block.type === 'child_database') {
        // Nested DBs often live under headings (parent.block_id) — still one map frame
        const childDbTitle = (block as { child_database?: { title?: string } }).child_database?.title
        const titleFromBlock = typeof childDbTitle === 'string' ? childDbTitle : 'Untitled database'
        await addDatabaseFrame(block.id, titleFromBlock, {
          type: 'page_id',
          page_id: owningPageId, // Thread DB under the page that contains it
        })
      } else if (block.has_children) {
        // Headings/toggles/columns may wrap child_page / child_database
        await walk(block.id, owningPageId, depth + 1)
      }
    }
  }

  await walk(root.id, root.id, 0)

  // Union search-tree page/DB descendants — never promote DB rows to map frames
  const fromSearchTree = collectPageAndDescendants(rootId, allPages)
  const dbIds = new Set(
    [...ordered, ...fromSearchTree]
      .filter((p) => p.object === 'database')
      .map((p) => normalizeNotionId(p.id))
  )
  for (const page of fromSearchTree) {
    if (seen.has(normalizeNotionId(page.id))) continue
    // Skip rows of a DB / data source that is (or will be) its own map frame
    if (page.object === 'page') {
      if (
        page.parent?.type === 'database_id' &&
        dbIds.has(normalizeNotionId(String(page.parent.database_id || '')))
      ) {
        continue
      }
      if (
        page.parent?.type === 'data_source_id' &&
        dbIds.has(normalizeNotionId(String(page.parent.data_source_id || '')))
      ) {
        continue
      }
    }
    push(page)
  }

  return ordered
}

/** Flat list of every page/database currently shared with the connection (includes children). */
export async function searchAllAccessibleNotionPages(
  accessToken: string,
  signal?: AbortSignal // Optional Cancel from Import pages
): Promise<NotionSearchPage[]> {
  const pages: NotionSearchPage[] = [] // Accumulator across paginated search
  let startCursor: string | undefined // Notion pagination cursor

  do {
    const res = await fetch('https://api.notion.com/v1/search', {
      method: 'POST', // Search endpoint is always POST
      headers: {
        Authorization: `Bearer ${accessToken}`, // User's OAuth install token
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_VERSION,
      },
      body: JSON.stringify({
        page_size: 100, // Max page size
        start_cursor: startCursor, // Continue when present
        sort: { direction: 'ascending', timestamp: 'last_edited_time' }, // Stable-ish order
      }),
      signal, // Abort when the picker Cancel fires
    })

    const payload = await res.json() // Parse Notion body
    if (!res.ok) {
      throw new Error(payload?.message || 'Notion search failed') // Surface API error
    }

    for (const result of payload.results || []) {
      // 2025-09-03 search returns data_source instead of database
      if (
        result.object !== 'page' &&
        result.object !== 'database' &&
        result.object !== 'data_source'
      ) {
        continue
      }
      pages.push({
        id: result.id, // page id, or data_source id (usable for query)
        object: result.object === 'data_source' ? 'database' : result.object, // Normalize for picker/import
        url: result.url, // Deep link back to Notion
        icon: result.icon ?? null, // Emoji / file icon for later UI
        title: extractTitle(result), // Human label for the note
        parent: (result.parent as NotionPageParent) ?? null, // Needed for tree nesting
        lastEditedTime: typeof result.last_edited_time === 'string' ? result.last_edited_time : undefined, // Recents
      })
    }

    startCursor = payload.has_more ? payload.next_cursor : undefined // Next page or stop
  } while (startCursor)

  return pages // Full accessible set for the picker tree
}

/** Top-level shared pages only (auto-import fallback). */
export async function searchAccessibleNotionPages(accessToken: string): Promise<NotionSearchPage[]> {
  const pages = await searchAllAccessibleNotionPages(accessToken) // Fetch everything first
  return filterTopLevelSharedPages(pages) // Then keep roots only
}
