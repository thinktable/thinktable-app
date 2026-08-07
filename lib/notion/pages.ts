// Notion Data API helpers for listing pages and building a sidebar-style tree

import { NOTION_VERSION } from './config'

export type NotionPageParent =
  | { type: 'workspace'; workspace: boolean }
  | { type: 'page_id'; page_id: string }
  | { type: 'database_id'; database_id: string }
  | { type: 'block_id'; block_id: string }
  | { type: string; [key: string]: unknown }

export type NotionSearchPage = {
  id: string // Notion page/database id
  object: 'page' | 'database' // Resource type from search
  url?: string // Open-in-Notion URL when present
  icon?: { type?: string; emoji?: string; external?: { url?: string }; file?: { url?: string } } | null
  title: string // Extracted display title for the mind-map node
  parent?: NotionPageParent | null // Used for tree nesting + top-level filtering
}

export type NotionPageTreeNode = NotionSearchPage & {
  children: NotionPageTreeNode[] // Nested pages/databases (Notion sidebar order)
}

export function normalizeNotionId(id: string | undefined | null): string {
  return (id || '').replace(/-/g, '').toLowerCase() // Compare dashed vs undashed Notion ids
}

function extractTitle(result: Record<string, unknown>): string {
  if (result.object === 'database') {
    const titleArr = (result.title as Array<{ plain_text?: string }> | undefined) || [] // DB title is top-level
    const text = titleArr.map((t) => t.plain_text || '').join('').trim() // Flatten rich text
    return text || 'Untitled database' // Fallback label
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
  return null // workspace / block_id → treat as root in the picker tree
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

    if (parent.type === 'block_id') {
      return false // Block children are page "contents", not map roots
    }

    return true // Unknown parent shape: keep rather than drop user selections
  })
}

/** Collect a page and all of its descendants (for Generate mindmap). */
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

/** Flat list of every page/database currently shared with the connection (includes children). */
export async function searchAllAccessibleNotionPages(accessToken: string): Promise<NotionSearchPage[]> {
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
    })

    const payload = await res.json() // Parse Notion body
    if (!res.ok) {
      throw new Error(payload?.message || 'Notion search failed') // Surface API error
    }

    for (const result of payload.results || []) {
      if (result.object !== 'page' && result.object !== 'database') continue // Skip unexpected objects
      pages.push({
        id: result.id, // Notion UUID
        object: result.object, // page | database
        url: result.url, // Deep link back to Notion
        icon: result.icon ?? null, // Emoji / file icon for later UI
        title: extractTitle(result), // Human label for the note
        parent: (result.parent as NotionPageParent) ?? null, // Needed for tree nesting
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
