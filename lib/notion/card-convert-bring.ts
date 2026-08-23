// Card-view convert: bring sub-rows / parent rows + collapsed stack order.

import type { NotionDbProperty, NotionDbRow } from '@/lib/notion/database'
import {
  buildSubTaskTree,
  cellCompareText,
} from '@/lib/notion/database-view'

/** localStorage key — remembered checkbox picks for Card convert bring-along. */
export const CARD_CONVERT_BRING_PREFS_KEY = 'thinktable-card-convert-bring-v3'

export type CardConvertBringPrefs = {
  subRows: boolean // Bring nested children (default on)
  parentRows: boolean // Bring ancestor parents (default on)
}

export const DEFAULT_CARD_CONVERT_BRING_PREFS: CardConvertBringPrefs = {
  subRows: true,
  parentRows: true,
}

/** Load last checkbox picks (defaults when missing / corrupt). */
export function loadCardConvertBringPrefs(): CardConvertBringPrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_CARD_CONVERT_BRING_PREFS }
  try {
    const raw = localStorage.getItem(CARD_CONVERT_BRING_PREFS_KEY)
    if (!raw) return { ...DEFAULT_CARD_CONVERT_BRING_PREFS }
    const parsed = JSON.parse(raw) as Partial<CardConvertBringPrefs>
    return {
      subRows:
        typeof parsed.subRows === 'boolean'
          ? parsed.subRows
          : DEFAULT_CARD_CONVERT_BRING_PREFS.subRows,
      parentRows:
        typeof parsed.parentRows === 'boolean'
          ? parsed.parentRows
          : DEFAULT_CARD_CONVERT_BRING_PREFS.parentRows,
    }
  } catch {
    return { ...DEFAULT_CARD_CONVERT_BRING_PREFS }
  }
}

/** Persist checkbox picks for the next convert. */
export function saveCardConvertBringPrefs(prefs: CardConvertBringPrefs): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(CARD_CONVERT_BRING_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Quota / private mode — ignore
  }
}

/** Normalize Notion page ids for Map lookups. */
export function notionPageIdKey(id: string): string {
  return id.replace(/-/g, '').toLowerCase()
}

/** @deprecated Use notionPageIdKey */
function idKey(id: string): string {
  return notionPageIdKey(id)
}

/** Resolve Parent-item relation name from settings or schema heuristics. */
export function resolveParentRelationProperty(
  properties: NotionDbProperty[],
  configured: string | null | undefined
): string | null {
  if (configured && properties.some((p) => p.name === configured)) return configured
  const parent =
    properties.find((p) => p.type === 'relation' && /parent/i.test(p.name)) || null
  return parent?.name || null
}

/** Page ids stored in a relation cell (comma-separated). */
function relationIdsFromCell(row: NotionDbRow, propName: string): string[] {
  const raw = cellCompareText(row.cells[propName])
  if (!raw) return []
  return raw.split(/[,\s]+/).filter(Boolean)
}

/**
 * True when this row is nested under a parent or itself has sub-rows
 * (popup only for hierarchy rows).
 */
export function rowIsNestedOrParent(
  row: NotionDbRow,
  allRows: NotionDbRow[],
  parentRelation: string | null
): boolean {
  if (!parentRelation) return false
  const { childrenOf } = buildSubTaskTree(allRows, parentRelation)
  if ((childrenOf.get(row.id)?.length ?? 0) > 0) return true
  // Nested = points at a parent that exists in this table
  const byId = new Map(allRows.map((r) => [idKey(r.id), r]))
  for (const part of relationIdsFromCell(row, parentRelation)) {
    if (byId.has(idKey(part))) return true
  }
  return false
}

/** Walk Parent-item pointers upward (closest parent first → highest last). */
function collectAncestors(
  row: NotionDbRow,
  allRows: NotionDbRow[],
  parentRelation: string | null
): NotionDbRow[] {
  if (!parentRelation) return []
  const byId = new Map(allRows.map((r) => [idKey(r.id), r]))
  const out: NotionDbRow[] = []
  const seen = new Set<string>([idKey(row.id)])
  let current: NotionDbRow | undefined = row
  while (current) {
    const parentParts = relationIdsFromCell(current, parentRelation)
    let next: NotionDbRow | undefined
    for (const part of parentParts) {
      const p = byId.get(idKey(part))
      if (p && !seen.has(idKey(p.id))) {
        next = p
        break
      }
    }
    if (!next) break
    seen.add(idKey(next.id))
    out.push(next)
    current = next
  }
  return out // [parent, grandparent, …]
}

/** BFS descendants via the Parent-item sub-task tree. */
function collectDescendants(
  row: NotionDbRow,
  allRows: NotionDbRow[],
  parentRelation: string | null
): NotionDbRow[] {
  if (!parentRelation) return []
  const { childrenOf } = buildSubTaskTree(allRows, parentRelation)
  const out: NotionDbRow[] = []
  const queue = [...(childrenOf.get(row.id) || [])]
  const seen = new Set<string>([idKey(row.id)])
  while (queue.length) {
    const child = queue.shift()!
    const k = idKey(child.id)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(child)
    for (const grand of childrenOf.get(child.id) || []) queue.push(grand)
  }
  return out
}

export type CollectBringRowsResult = {
  /** Highest → … → parent → primary → subs (stack index 0 = highest on top). */
  ordered: NotionDbRow[]
}

/**
 * Build the ordered row list for convert: primary always included;
 * optional parents (highest first), then sub-rows.
 */
export function collectRowsForCardConvert(opts: {
  primary: NotionDbRow
  allRows: NotionDbRow[]
  parentRelation: string | null
  prefs: CardConvertBringPrefs
}): CollectBringRowsResult {
  const { primary, allRows, parentRelation, prefs } = opts
  const ancestors = prefs.parentRows
    ? collectAncestors(primary, allRows, parentRelation)
    : []
  // Highest on top → reverse ancestors (grandparent … parent)
  const highestFirst = [...ancestors].reverse()
  const descendants = prefs.subRows
    ? collectDescendants(primary, allRows, parentRelation)
    : []

  const ordered: NotionDbRow[] = []
  const seen = new Set<string>()
  const push = (r: NotionDbRow) => {
    const k = idKey(r.id)
    if (seen.has(k)) return
    seen.add(k)
    ordered.push(r)
  }
  for (const r of highestFirst) push(r)
  push(primary)
  for (const r of descendants) push(r)
  return { ordered }
}

/**
 * Notion page ids already peeled into Card-view frames on this board
 * (same DB) — those rows must not stay in the live table.
 */
export function cardedPageIdsFromMessages(
  messages: Array<{ metadata?: Record<string, unknown> | null } | null | undefined>,
  notionDatabaseId: string,
  hostPeeledPageIds?: string[] | null
): Set<string> {
  const dbKey = notionPageIdKey(notionDatabaseId)
  const out = new Set<string>()
  for (const msg of messages) {
    const meta = msg?.metadata
    if (!meta || meta.dbLayout !== 'card') continue
    const msgDb =
      typeof meta.notionDatabaseId === 'string' ? notionPageIdKey(meta.notionDatabaseId) : ''
    if (msgDb && msgDb !== dbKey) continue // Other DB’s cards
    const pageId = typeof meta.notionPageId === 'string' ? meta.notionPageId : ''
    if (pageId) out.add(notionPageIdKey(pageId))
  }
  for (const id of hostPeeledPageIds || []) {
    if (typeof id === 'string' && id.trim()) out.add(notionPageIdKey(id))
  }
  return out
}
