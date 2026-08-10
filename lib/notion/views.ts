// Notion Views API — list / retrieve / query views (filters, sorts, layout) for linked DB embeds.
// Uses a newer Notion-Version than data_sources when the OpenAPI requires it.

import { NOTION_VERSION } from './config'
import type { DatabaseLayout } from './database-view'

/** Views endpoints work on 2025-09-03+; docs samples use 2026-03-11 for full view payloads. */
export const NOTION_VIEWS_VERSION = '2026-03-11'

export type NotionViewRef = { object: 'view'; id: string }

/** Full view config from GET /v1/views/:id */
export type NotionView = {
  id: string
  name: string
  type: string // table | board | list | gallery | calendar | …
  data_source_id?: string | null
  filter?: Record<string, unknown> | null
  /** Notion UI filter-bar chips — often the real filter when `filter` is null */
  quick_filters?: Record<string, Record<string, unknown>> | null
  sorts?: Array<Record<string, unknown>> | null
  url?: string
}

/**
 * Convert view `quick_filters` (property id → condition) into a data-source query filter.
 * Used only as a fallback when view-query is unavailable.
 */
export function notionQuickFiltersToFilter(
  quick: Record<string, Record<string, unknown>> | null | undefined
): Record<string, unknown> | null {
  if (!quick || typeof quick !== 'object') return null
  const clauses = Object.entries(quick).map(([property, condition]) => ({
    property,
    ...condition,
  }))
  if (!clauses.length) return null
  if (clauses.length === 1) return clauses[0]
  return { and: clauses }
}

/** Slice we attach to the table payload so the client can seed layout. */
export type NotionViewSummary = {
  id: string
  name: string
  type: string
  layout: DatabaseLayout
}

function viewsHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Notion-Version': NOTION_VIEWS_VERSION,
    'Content-Type': 'application/json',
  }
}

/** Map Notion view type → Thinktable layout id. */
export function notionViewTypeToLayout(type: string): DatabaseLayout {
  const t = (type || '').toLowerCase()
  if (t === 'board' || t === 'list' || t === 'gallery' || t === 'calendar' || t === 'timeline') {
    return t
  }
  if (t === 'chart') return 'chart'
  if (t === 'map') return 'map'
  if (t === 'feed') return 'feed'
  return 'table'
}

/** Extract `?v=` view id from a Notion deep link (with or without dashes). */
export function viewIdFromNotionUrl(url?: string | null): string | null {
  if (!url) return null
  try {
    const v = new URL(url).searchParams.get('v')
    if (!v) return null
    const h = v.replace(/-/g, '').toLowerCase()
    if (h.length !== 32) return v
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  } catch {
    return null
  }
}

function idsEqual(a: string, b: string): boolean {
  return a.replace(/-/g, '').toLowerCase() === b.replace(/-/g, '').toLowerCase()
}

/** List view refs for a database container (linked embeds) and/or a data source. */
export async function listNotionViews(
  accessToken: string,
  opts: { databaseId?: string; dataSourceId?: string }
): Promise<NotionViewRef[]> {
  if (!opts.databaseId && !opts.dataSourceId) return []
  const params = new URLSearchParams()
  if (opts.databaseId) params.set('database_id', opts.databaseId)
  if (opts.dataSourceId) params.set('data_source_id', opts.dataSourceId)
  params.set('page_size', '100')

  const out: NotionViewRef[] = []
  let cursor: string | undefined
  let pages = 0
  do {
    if (cursor) params.set('start_cursor', cursor)
    else params.delete('start_cursor')
    const res = await fetch(`https://api.notion.com/v1/views?${params.toString()}`, {
      method: 'GET',
      headers: viewsHeaders(accessToken),
    })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) {
      // Fall back: some workspaces accept views on the data_sources version
      if (pages === 0) {
        const retry = await fetch(`https://api.notion.com/v1/views?${params.toString()}`, {
          method: 'GET',
          headers: {
            ...viewsHeaders(accessToken),
            'Notion-Version': NOTION_VERSION,
          },
        })
        const retryPayload = await retry.json().catch(() => ({}))
        if (!retry.ok) {
          console.warn('[notion/views] list failed', {
            status: res.status,
            message: payload?.message,
            databaseId: opts.databaseId,
            dataSourceId: opts.dataSourceId,
          })
          return out
        }
        for (const r of retryPayload.results || []) {
          if (r?.object === 'view' && r.id) out.push({ object: 'view', id: r.id })
        }
        return out
      }
      break
    }
    for (const r of payload.results || []) {
      if (r?.object === 'view' && r.id) out.push({ object: 'view', id: r.id })
    }
    cursor = payload.has_more ? payload.next_cursor : undefined
    pages += 1
  } while (cursor && pages < 5)
  return out
}

/** Retrieve full view config (filter / sorts / type / data_source_id). */
export async function retrieveNotionView(
  accessToken: string,
  viewId: string
): Promise<NotionView | null> {
  const tryVersion = async (version: string) => {
    const res = await fetch(`https://api.notion.com/v1/views/${viewId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Notion-Version': version,
        'Content-Type': 'application/json',
      },
    })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok || payload?.object !== 'view') return null
    return {
      id: payload.id as string,
      name: String(payload.name || ''),
      type: String(payload.type || 'table'),
      data_source_id: (payload.data_source_id as string | null | undefined) ?? null,
      filter: (payload.filter as Record<string, unknown> | null | undefined) ?? null,
      quick_filters:
        (payload.quick_filters as Record<string, Record<string, unknown>> | null | undefined) ??
        null,
      sorts: (payload.sorts as Array<Record<string, unknown>> | null | undefined) ?? null,
      url: payload.url as string | undefined,
    } satisfies NotionView
  }

  return (await tryVersion(NOTION_VIEWS_VERSION)) || (await tryVersion(NOTION_VERSION))
}

/**
 * Execute the view’s saved filter/sorts via POST /v1/views/{id}/queries.
 * Returns ordered page ids (Notion applies filters server-side — do not reimplement).
 */
export async function queryNotionViewPageIds(
  accessToken: string,
  viewId: string
): Promise<string[] | null> {
  const createRes = await fetch(`https://api.notion.com/v1/views/${viewId}/queries`, {
    method: 'POST',
    headers: viewsHeaders(accessToken),
    body: JSON.stringify({ page_size: 100 }),
  })
  const createPayload = await createRes.json().catch(() => ({}))
  if (!createRes.ok || createPayload?.object !== 'view_query') {
    console.warn('[notion/views] view query create failed', {
      viewId,
      status: createRes.status,
      message: createPayload?.message,
    })
    return null
  }

  const pageIds: string[] = []
  const pushResults = (results: Array<{ object?: string; id?: string }> | undefined) => {
    for (const r of results || []) {
      if (r?.id && (r.object === 'page' || !r.object)) pageIds.push(r.id)
    }
  }

  pushResults(createPayload.results)
  const queryId = createPayload.id as string
  let cursor: string | undefined = createPayload.has_more ? createPayload.next_cursor : undefined
  let pages = 0
  while (cursor && pages < 100) {
    const params = new URLSearchParams({
      start_cursor: cursor,
      page_size: '100',
    })
    const moreRes = await fetch(
      `https://api.notion.com/v1/views/${viewId}/queries/${queryId}?${params}`,
      { method: 'GET', headers: viewsHeaders(accessToken) }
    )
    const morePayload = await moreRes.json().catch(() => ({}))
    if (!moreRes.ok) break
    pushResults(morePayload.results)
    cursor = morePayload.has_more ? morePayload.next_cursor : undefined
    pages += 1
  }

  // Best-effort cleanup of cached query
  void fetch(`https://api.notion.com/v1/views/${viewId}/queries/${queryId}`, {
    method: 'DELETE',
    headers: viewsHeaders(accessToken),
  }).catch(() => {})

  return pageIds
}

/**
 * Pick the best view for an embed: explicit id → URL ?v= → name match → first.
 * Loads full config for the chosen view.
 * `embedOnly`: for linked DBs, do not fall back to listing every view on the source data_source
 * (that picks an unfiltered “All” view and dumps the whole DB).
 */
export async function resolveNotionViewForDatabase(
  accessToken: string,
  opts: {
    databaseId: string // Embed / container id (child_database block id)
    dataSourceId?: string | null
    titleHint?: string
    url?: string | null
    preferredViewId?: string | null
    /** When true, only use views owned by this database container (linked embeds). */
    embedOnly?: boolean
  }
): Promise<NotionView | null> {
  const preferred =
    opts.preferredViewId || viewIdFromNotionUrl(opts.url || undefined) || null

  // Prefer views owned by this database container (linked embed’s own view)
  let refs = await listNotionViews(accessToken, { databaseId: opts.databaseId })
  if (!refs.length && preferred) {
    const direct = await retrieveNotionView(accessToken, preferred)
    if (direct) return direct
  }
  // Linked embed with no container views: match a source view by the embed’s title (not “first”)
  if (!refs.length && opts.embedOnly && opts.dataSourceId && opts.titleHint?.trim()) {
    const sourceRefs = await listNotionViews(accessToken, { dataSourceId: opts.dataSourceId })
    const hint = opts.titleHint.trim().toLowerCase()
    for (const ref of sourceRefs.slice(0, 20)) {
      const v = await retrieveNotionView(accessToken, ref.id)
      if (!v) continue
      const name = v.name.trim().toLowerCase()
      if (name === hint || hint.includes(name) || name.includes(hint)) return v
    }
  }
  // Source data_source views only when this is not a linked-view embed
  if (!refs.length && opts.dataSourceId && !opts.embedOnly) {
    refs = await listNotionViews(accessToken, { dataSourceId: opts.dataSourceId })
  }
  if (!refs.length && preferred) {
    return retrieveNotionView(accessToken, preferred)
  }
  if (!refs.length) return null

  if (preferred) {
    const hit = refs.find((r) => idsEqual(r.id, preferred))
    if (hit) return retrieveNotionView(accessToken, hit.id)
    const direct = await retrieveNotionView(accessToken, preferred)
    if (direct) return direct
  }

  // Load views (linked embeds usually have 1) and pick by title / filter presence
  const loaded: NotionView[] = []
  for (const ref of refs.slice(0, 12)) {
    const v = await retrieveNotionView(accessToken, ref.id)
    if (v) loaded.push(v)
  }
  if (!loaded.length) return null

  const hint = (opts.titleHint || '').trim().toLowerCase()
  if (hint) {
    const exact = loaded.find((v) => v.name.trim().toLowerCase() === hint)
    if (exact) return exact
    const partial = loaded.find(
      (v) =>
        hint.includes(v.name.trim().toLowerCase()) ||
        v.name.trim().toLowerCase().includes(hint)
    )
    if (partial) return partial
  }

  // Prefer a view that actually has a filter / quick_filters when choosing among source views
  const hasAnyFilter = (v: NotionView) =>
    (v.filter && typeof v.filter === 'object' && Object.keys(v.filter).length > 0) ||
    (v.quick_filters && Object.keys(v.quick_filters).length > 0)
  const withFilter = loaded.find(hasAnyFilter)
  if (withFilter && loaded.length > 1 && !opts.embedOnly) return withFilter

  return loaded[0]
}
