// Fetch a Notion database schema + rows for an in-app table view (Notion-like structure).

import { NOTION_VERSION } from './config'
import { normalizeNotionId } from './pages'
import {
  notionQuickFiltersToFilter,
  notionViewTypeToLayout,
  queryNotionViewPageIds,
  resolveNotionViewForDatabase,
  type NotionView,
  type NotionViewSummary,
} from './views'

/** One property column in a Notion database. */
export type NotionDbProperty = {
  id: string
  name: string
  type: string // title | checkbox | number | select | multi_select | …
  options?: Array<{ id: string; name: string; color?: string }> // select / multi_select / status
}

/** One cell value ready for rendering. */
export type NotionDbCell = {
  type: string
  text?: string // Plain display for title / rich_text / number / url / …
  checked?: boolean // checkbox
  tags?: Array<{ name: string; color?: string }> // select / multi_select / status
}

/** One database row (a Notion page). */
export type NotionDbRow = {
  id: string
  url?: string
  icon?: string | null // Emoji when present
  cells: Record<string, NotionDbCell> // property name → cell
}

/** Default row page size for in-app table loads (Load more uses rowsNextCursor). */
export const NOTION_DB_CLIENT_ROW_PAGE = 50

/** Hard ceiling for rows kept in the browser for one DB (virtualization ≠ free memory). */
export const NOTION_DB_CLIENT_ROW_CAP = 200

/** Idle / Reset Table-rows floor before the first show-more unlock. */
export const COMPACT_PREVIEW_ROWS = 12

export type FetchNotionDatabaseOptions = {
  /** Cap rows returned; omit to fetch all (convert-layout / server paths). */
  rowLimit?: number
  /** Notion data_source query cursor, or numeric offset string for view-id slices. */
  rowCursor?: string
}

/** Full payload for the structured database table UI. */
export type NotionDatabaseTable = {
  id: string
  dataSourceId: string // Data source used for query / create row (2025-09-03)
  title: string
  url?: string
  icon?: string | null
  properties: NotionDbProperty[] // Column order (title first)
  rows: NotionDbRow[]
  /** More rows available — client passes rowsNextCursor on Load more. */
  rowsHasMore?: boolean
  rowsNextCursor?: string | null
  /** Notion Views API slice — filter/sorts already applied server-side; layout for client seed. */
  notionView?: NotionViewSummary | null
}

/** Pull plain text from a Notion rich_text array. */
function richTextPlain(rich: Array<{ plain_text?: string }> | undefined): string {
  return (rich || []).map((t) => t.plain_text || '').join('')
}

/** Notion select color → soft CSS background (matches Notion’s palette roughly). */
export function notionSelectColor(color?: string): { bg: string; fg: string } {
  const map: Record<string, { bg: string; fg: string }> = {
    default: { bg: '#e3e2e0', fg: '#32302c' },
    gray: { bg: '#e3e2e0', fg: '#32302c' },
    brown: { bg: '#eee0da', fg: '#442a1e' },
    orange: { bg: '#fadec9', fg: '#49290e' },
    yellow: { bg: '#fdecc8', fg: '#402c1b' },
    green: { bg: '#dbeddb', fg: '#1c3829' },
    blue: { bg: '#d3e5ef', fg: '#183347' },
    purple: { bg: '#e8deee', fg: '#412454' },
    pink: { bg: '#f5e0e9', fg: '#4c2337' },
    red: { bg: '#ffe2dd', fg: '#5c231e' },
  }
  return map[color || 'default'] || map.default
}

/** Convert one Notion property value object into a render cell. */
function cellFromProperty(prop: Record<string, unknown> | undefined): NotionDbCell {
  if (!prop || typeof prop !== 'object') return { type: 'unknown', text: '' }
  const type = String(prop.type || 'unknown')
  switch (type) {
    case 'title':
      return { type, text: richTextPlain(prop.title as Array<{ plain_text?: string }>) }
    case 'rich_text':
      return { type, text: richTextPlain(prop.rich_text as Array<{ plain_text?: string }>) }
    case 'number':
      return { type, text: prop.number == null ? '' : String(prop.number) }
    case 'checkbox':
      return { type, checked: prop.checkbox === true }
    case 'select': {
      const sel = prop.select as { name?: string; color?: string } | null
      return {
        type,
        text: sel?.name || '',
        tags: sel?.name ? [{ name: sel.name, color: sel.color }] : [],
      }
    }
    case 'multi_select': {
      const tags = (prop.multi_select as Array<{ name?: string; color?: string }> | undefined) || []
      return {
        type,
        tags: tags.filter((t) => t.name).map((t) => ({ name: t.name!, color: t.color })),
        text: tags.map((t) => t.name).filter(Boolean).join(', '),
      }
    }
    case 'status': {
      const st = prop.status as { name?: string; color?: string } | null
      return {
        type,
        text: st?.name || '',
        tags: st?.name ? [{ name: st.name, color: st.color }] : [],
      }
    }
    case 'date': {
      const d = prop.date as { start?: string; end?: string } | null
      if (!d?.start) return { type, text: '' }
      return { type, text: d.end ? `${d.start} → ${d.end}` : d.start }
    }
    case 'url':
      return { type, text: typeof prop.url === 'string' ? prop.url : '' }
    case 'email':
      return { type, text: typeof prop.email === 'string' ? prop.email : '' }
    case 'phone_number':
      return { type, text: typeof prop.phone_number === 'string' ? prop.phone_number : '' }
    case 'formula': {
      const f = prop.formula as { type?: string; string?: string; number?: number; boolean?: boolean } | undefined
      if (!f) return { type, text: '' }
      if (f.type === 'string') return { type, text: f.string || '' }
      if (f.type === 'number') return { type, text: f.number == null ? '' : String(f.number) }
      if (f.type === 'boolean') return { type, checked: !!f.boolean, text: f.boolean ? 'Yes' : 'No' }
      return { type, text: '' }
    }
    case 'created_time':
    case 'last_edited_time':
      return { type, text: typeof prop[type] === 'string' ? String(prop[type]).slice(0, 10) : '' }
    case 'relation': {
      // Store related page ids so sub-task nesting can resolve parent→child
      const rels = (prop.relation as Array<{ id?: string }> | undefined) || []
      const ids = rels.map((r) => r.id).filter((id): id is string => !!id)
      return { type, text: ids.join(',') }
    }
    default:
      // rollup / people / files — show a short placeholder for now
      return { type, text: '' }
  }
}

/** Emoji from Notion icon payload. */
function emojiFromIcon(icon: { type?: string; emoji?: string } | null | undefined): string | null {
  return icon?.type === 'emoji' && icon.emoji ? icon.emoji : null
}

/** Pull a Notion UUID from a deep link (linked views often URL to the source DB). */
function notionIdFromUrl(url: string): string | null {
  const dashed = url.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  )
  if (dashed) return dashed[1].toLowerCase()
  const compact = url.match(/([0-9a-f]{32})/i)
  if (!compact) return null
  const h = compact[1].toLowerCase()
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function normalizeNotionIdLoose(id: string): string {
  const h = id.replace(/-/g, '').toLowerCase()
  if (h.length !== 32) return id.toLowerCase()
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Normalize a DB / view title for matching (drop view-type suffixes). */
function normalizeDbTitle(s: string): string {
  return s
    .replace(/\s*[—–-]\s*(list|board|table|gallery|calendar|timeline|chart|folder|view)\s*$/i, '')
    .trim()
    .toLowerCase()
}

/** Token set for fuzzy title overlap (ignore tiny words). */
function titleTokens(s: string): Set<string> {
  return new Set(
    normalizeDbTitle(s)
      .split(/[^a-z0-9]+/i)
      .map((t) => t.trim())
      .filter((t) => t.length > 1)
  )
}

function titleScore(hint: string, candidate: string): number {
  const a = normalizeDbTitle(hint)
  const b = normalizeDbTitle(candidate)
  if (!a || !b) return 0
  if (a === b) return 100
  if (a.includes(b) || b.includes(a)) return 80
  const ta = titleTokens(a)
  const tb = titleTokens(b)
  if (!ta.size || !tb.size) return 0
  let hit = 0
  for (const t of ta) if (tb.has(t)) hit += 1
  return (hit / Math.max(ta.size, tb.size)) * 60
}

type ResolvedDataSource = {
  dataSourceId: string
  databaseId?: string
  title?: string
  url?: string
  icon?: string | null
}

/**
 * Linked Notion views often retrieve as a database with an empty `data_sources` list
 * (API does not expose the link target). Find an accessible data_source by title —
 * targeted search first, then a broader scan of shared data_sources.
 */
async function resolveDataSourceByTitleSearch(
  headers: Record<string, string>,
  titleHint: string
): Promise<ResolvedDataSource | null> {
  const query = normalizeDbTitle(titleHint) || titleHint.trim()
  if (!query) return null

  const titleOf = (obj: {
    title?: Array<{ plain_text?: string }>
    name?: string
  }) => {
    const fromArr = (obj.title || []).map((t) => t.plain_text || '').join('').trim()
    return fromArr || (typeof obj.name === 'string' ? obj.name.trim() : '')
  }

  type SearchHit = {
    object?: string
    id?: string
    url?: string
    icon?: unknown
    title?: Array<{ plain_text?: string }>
    name?: string
    parent?: { database_id?: string; type?: string }
  }

  const pickFromHits = async (results: SearchHit[]): Promise<ResolvedDataSource | null> => {
    // Holder object, not a `let`: TS narrows a captured `let` to its initializer and can't see the
    // assignment inside `consider`, which typed the winner as `never` at the return below.
    const best: { top: { score: number; hit: ResolvedDataSource } | null } = { top: null }

    const consider = (score: number, hit: ResolvedDataSource) => {
      if (score < 30) return // Allow single shared token (e.g. "tasks") across view vs source titles
      if (!best.top || score > best.top.score) best.top = { score, hit }
    }

    for (const r of results) {
      if (!r.id) continue
      if (r.object === 'data_source') {
        const t = titleOf(r)
        consider(titleScore(titleHint, t), {
          dataSourceId: r.id,
          databaseId: r.parent?.database_id,
          title: t || undefined,
          url: r.url,
          icon: emojiFromIcon(r.icon as { type?: string; emoji?: string } | null),
        })
        continue
      }
      if (r.object !== 'database') continue
      const t = titleOf(r)
      const score = titleScore(titleHint, t)
      if (score < 30) continue
      const dbRes = await fetch(`https://api.notion.com/v1/databases/${r.id}`, {
        method: 'GET',
        headers,
      })
      const dbPayload = await dbRes.json().catch(() => ({}))
      const sources =
        (dbPayload?.data_sources as Array<{ id?: string; name?: string }> | undefined) || []
      if (!dbRes.ok || !sources.length) continue
      const named =
        sources.find((s) => titleScore(titleHint, s.name || '') >= 80) ||
        sources.find((s) => titleScore(titleHint, s.name || '') >= 30) ||
        sources[0]
      if (!named?.id) continue
      consider(Math.max(score, titleScore(titleHint, named.name || t)), {
        dataSourceId: named.id,
        databaseId: dbPayload.id || r.id,
        title: named.name || t || undefined,
        url: dbPayload.url || r.url,
        icon: emojiFromIcon((dbPayload.icon || r.icon) as { type?: string; emoji?: string } | null),
      })
    }

    return best.top?.hit || null
  }

  // 1) Targeted search with the cleaned title
  const targeted = await fetch('https://api.notion.com/v1/search', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, page_size: 25 }),
  })
  const targetedPayload = await targeted.json().catch(() => ({}))
  if (targeted.ok) {
    const hit = await pickFromHits((targetedPayload.results || []) as SearchHit[])
    if (hit) return hit
  }

  // 2) Broader scan — linked views often need the *source* DB which has a different title
  const pool: SearchHit[] = []
  let cursor: string | undefined
  let pages = 0
  do {
    const res = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        page_size: 100,
        start_cursor: cursor,
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
      }),
    })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) break
    for (const r of payload.results || []) {
      if (r?.object === 'data_source' || r?.object === 'database') pool.push(r)
    }
    cursor = payload.has_more ? payload.next_cursor : undefined
    pages += 1
  } while (cursor && pages < 5)

  return pickFromHits(pool)
}

/**
 * Load database title/properties + all queryable rows for the structured table UI.
 * Accepts a Notion **database** id (container) or **data_source** id (table).
 * Uses API 2025-09-03 data_sources endpoints (schema + query live on the data source).
 */
export async function fetchNotionDatabaseTable(
  accessToken: string,
  databaseOrDataSourceId: string,
  options?: FetchNotionDatabaseOptions
): Promise<NotionDatabaseTable> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  }

  // Resolve container id → accessible data_source id + metadata
  let dataSourceId: string | null = null
  let databaseId = databaseOrDataSourceId
  let title = 'Untitled database'
  let url: string | undefined
  let icon: string | null = null
  let dbErrorMessage: string | null = null
  let emptySources = false // Linked views often return database + [] data_sources

  const dbRes = await fetch(`https://api.notion.com/v1/databases/${databaseOrDataSourceId}`, {
    method: 'GET',
    headers,
  })
  const dbPayload = await dbRes.json()
  if (dbRes.ok && dbPayload?.object === 'database') {
    databaseId = dbPayload.id || databaseOrDataSourceId
    const titleArr = (dbPayload.title as Array<{ plain_text?: string }> | undefined) || []
    title = titleArr.map((t) => t.plain_text || '').join('').trim() || title
    url = dbPayload.url
    icon = emojiFromIcon(dbPayload.icon)
    const sources = (dbPayload.data_sources as Array<{ id?: string; name?: string }> | undefined) || []
    if (sources.length === 0) {
      // Don't throw — linked views / partial share leave this empty; try other resolvers
      emptySources = true
    } else {
      // Prefer a source whose name matches the DB title; else first accessible source
      const named =
        sources.find((s) => (s.name || '').trim().toLowerCase() === title.toLowerCase()) ||
        sources[0]
      dataSourceId = named.id || null
      if (named.name?.trim()) title = named.name.trim()
    }
  } else {
    dbErrorMessage = dbPayload?.message || `Failed to load Notion database ${databaseOrDataSourceId}`
  }

  // Id may already be a data_source id (search returns those on 2025-09-03)
  if (!dataSourceId) {
    const dsProbe = await fetch(
      `https://api.notion.com/v1/data_sources/${databaseOrDataSourceId}`,
      { method: 'GET', headers }
    )
    const dsProbePayload = await dsProbe.json()
    if (dsProbe.ok && dsProbePayload?.object === 'data_source') {
      dataSourceId = dsProbePayload.id
      databaseId =
        (dsProbePayload.parent as { database_id?: string } | undefined)?.database_id ||
        databaseOrDataSourceId
      const dsTitleArr = (dsProbePayload.title as Array<{ plain_text?: string }> | undefined) || []
      const dsTitle = dsTitleArr.map((t) => t.plain_text || '').join('').trim()
      if (dsTitle) title = dsTitle
      url = dsProbePayload.url || url
      icon = emojiFromIcon(dsProbePayload.icon) || icon
    }
  }

  // Always resolve views against the *request* id (linked embed container), not the source DB
  const embedDatabaseId = databaseOrDataSourceId
  let notionView: NotionView | null = null
  try {
    notionView = await resolveNotionViewForDatabase(accessToken, {
      databaseId: embedDatabaseId,
      dataSourceId,
      titleHint: title,
      url,
      embedOnly: emptySources, // Don't list source “All” views for linked embeds
    })
  } catch (e) {
    console.warn('[notion/database] resolve view failed', e)
    notionView = null
  }
  if (notionView?.data_source_id && !dataSourceId) {
    dataSourceId = notionView.data_source_id
  }
  // Prefer the embed/view label over the underlying source DB name for linked views
  const keepLinkedTitle: string | null = emptySources
    ? notionView?.name?.trim() || title || null
    : null

  // Linked view URL often points at the *source* database — try that id’s data_sources
  if (!dataSourceId && emptySources && url) {
    const fromUrl = notionIdFromUrl(url)
    if (fromUrl && fromUrl !== normalizeNotionIdLoose(databaseOrDataSourceId)) {
      const srcRes = await fetch(`https://api.notion.com/v1/databases/${fromUrl}`, {
        method: 'GET',
        headers,
      })
      const srcPayload = await srcRes.json().catch(() => ({}))
      const sources =
        (srcPayload?.data_sources as Array<{ id?: string; name?: string }> | undefined) || []
      if (srcRes.ok && sources.length) {
        const named =
          sources.find((s) => titleScore(title, s.name || '') >= 40) || sources[0]
        if (named?.id) {
          dataSourceId = named.id
          databaseId = srcPayload.id || fromUrl
          if (named.name?.trim() && !keepLinkedTitle) title = named.name.trim()
          if (srcPayload.url) url = srcPayload.url
          icon = emojiFromIcon(srcPayload.icon) || icon
        }
      }
    }
  }

  // Linked view / empty data_sources → find the real source via search (title / fuzzy)
  if (!dataSourceId && (emptySources || dbErrorMessage)) {
    const found = await resolveDataSourceByTitleSearch(headers, title)
    if (found) {
      dataSourceId = found.dataSourceId
      if (found.databaseId) databaseId = found.databaseId
      if (found.title && !keepLinkedTitle) title = found.title
      if (found.url) url = found.url
      if (found.icon) icon = found.icon
    }
  }

  // Retry once we know the data_source (linked embeds can title-match a source view)
  if (dataSourceId && !notionView) {
    try {
      notionView = await resolveNotionViewForDatabase(accessToken, {
        databaseId: embedDatabaseId,
        dataSourceId,
        titleHint: keepLinkedTitle || title,
        url,
        embedOnly: emptySources,
      })
      if (notionView?.data_source_id && notionView.data_source_id !== dataSourceId) {
        // Prefer the view’s declared source when present
        dataSourceId = notionView.data_source_id
      }
    } catch {
      /* keep null */
    }
  }

  if (!dataSourceId) {
    if (emptySources) {
      throw new Error(
        'Linked Notion view — share the original database with Thinktable (••• → Connections), not only this view.'
      )
    }
    if (dbErrorMessage) throw new Error(dbErrorMessage)
    throw new Error('Notion data source unavailable')
  }

  // Schema lives on the data source (not the database container)
  const dsRes = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}`, {
    method: 'GET',
    headers,
  })
  const dsPayload = await dsRes.json()
  if (!dsRes.ok || dsPayload?.object !== 'data_source') {
    throw new Error(dsPayload?.message || `Failed to load Notion data source ${dataSourceId}`)
  }

  // Prefer data-source title/url/icon when present (keep linked-view label when applicable)
  const dsTitleArr = (dsPayload.title as Array<{ plain_text?: string }> | undefined) || []
  const dsTitle = dsTitleArr.map((t) => t.plain_text || '').join('').trim()
  if (keepLinkedTitle) {
    title = keepLinkedTitle
  } else if (dsTitle) {
    title = dsTitle
  }
  if (dsPayload.url && !emptySources) url = dsPayload.url
  if (dsPayload.icon) icon = emojiFromIcon(dsPayload.icon)

  const propsObj = (dsPayload.properties || {}) as Record<
    string,
    {
      id?: string
      type?: string
      select?: { options?: Array<{ id: string; name: string; color?: string }> }
      multi_select?: { options?: Array<{ id: string; name: string; color?: string }> }
      status?: { options?: Array<{ id: string; name: string; color?: string }> }
    }
  >

  const properties: NotionDbProperty[] = Object.entries(propsObj).map(([name, p]) => ({
    id: p.id || name,
    name,
    type: p.type || 'rich_text',
    options:
      p.select?.options ||
      p.multi_select?.options ||
      p.status?.options ||
      undefined,
  }))
  // Title first, then common Notion table columns, then the rest A–Z
  const priority = ['active', 'servings', 'prep time', 'cuisine', 'status', 'tags']
  properties.sort((a, b) => {
    if (a.type === 'title' && b.type !== 'title') return -1
    if (b.type === 'title' && a.type !== 'title') return 1
    const ai = priority.indexOf(a.name.toLowerCase())
    const bi = priority.indexOf(b.name.toLowerCase())
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    }
    return a.name.localeCompare(b.name)
  })

  // Prefer official view-query (Notion applies filter/sorts server-side). Copying
  // filter onto data_source query often no-ops or fails; we used to silently dump the whole DB.
  let viewPageIds: string[] | null = null
  if (notionView?.id) {
    viewPageIds = await queryNotionViewPageIds(accessToken, notionView.id)
    console.info('[notion/database] view query', {
      viewId: notionView.id,
      viewName: notionView.name,
      pageCount: viewPageIds?.length ?? null,
      hasFilter: !!(notionView.filter && Object.keys(notionView.filter).length),
      hasQuickFilters: !!(notionView.quick_filters && Object.keys(notionView.quick_filters).length),
    })
  }

  const viewFilter =
    (notionView?.filter && Object.keys(notionView.filter).length > 0
      ? notionView.filter
      : null) || notionQuickFiltersToFilter(notionView?.quick_filters)
  const viewSorts =
    Array.isArray(notionView?.sorts) && notionView!.sorts!.length > 0 ? notionView!.sorts : null

  type QueryRowsResult = { rows: NotionDbRow[]; hasMore: boolean; nextCursor: string | null }

  const rowFromPage = (result: Record<string, unknown>): NotionDbRow | null => {
    if (result?.object !== 'page') return null
    const pageProps = (result.properties || {}) as Record<string, Record<string, unknown>>
    const cells: Record<string, NotionDbCell> = {}
    for (const [name, prop] of Object.entries(pageProps)) {
      cells[name] = cellFromProperty(prop)
    }
    return {
      id: String(result.id),
      url: result.url as string | undefined,
      icon: emojiFromIcon(result.icon as { type?: string; emoji?: string } | null | undefined),
      cells,
    }
  }

  /** Paginate data_source query; optionally apply view filter/sorts. */
  const queryRowsPaged = async (
    withView: boolean,
    pageOpts?: { limit?: number; startCursor?: string }
  ): Promise<QueryRowsResult> => {
    const out: NotionDbRow[] = []
    let cursor: string | undefined = pageOpts?.startCursor || undefined
    const limit = pageOpts?.limit

    while (true) {
      const pageSize = limit ? Math.min(100, Math.max(1, limit - out.length)) : 100
      const body: Record<string, unknown> = { page_size: pageSize }
      if (cursor) body.start_cursor = cursor
      if (withView && viewFilter) body.filter = viewFilter
      if (withView && viewSorts) body.sorts = viewSorts
      const qRes = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const qPayload = await qRes.json()
      if (!qRes.ok) {
        throw new Error(qPayload?.message || `Failed to query Notion data source ${dataSourceId}`)
      }
      for (const result of qPayload.results || []) {
        const row = rowFromPage(result as Record<string, unknown>)
        if (!row) continue
        out.push(row)
        if (limit && out.length >= limit) {
          return {
            rows: out.slice(0, limit),
            hasMore: !!qPayload.has_more,
            nextCursor: qPayload.has_more ? (qPayload.next_cursor as string) : null,
          }
        }
      }
      if (!qPayload.has_more) {
        return { rows: out, hasMore: false, nextCursor: null }
      }
      cursor = qPayload.next_cursor as string | undefined
    }
  }

  const sliceRows = (
    ordered: NotionDbRow[],
    limit?: number,
    offsetCursor?: string
  ): { rows: NotionDbRow[]; hasMore: boolean; nextCursor: string | null } => {
    if (limit == null) return { rows: ordered, hasMore: false, nextCursor: null }
    const offset = offsetCursor ? parseInt(offsetCursor, 10) : 0
    const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0
    const page = ordered.slice(safeOffset, safeOffset + limit)
    const hasMore = safeOffset + limit < ordered.length
    return {
      rows: page,
      hasMore,
      nextCursor: hasMore ? String(safeOffset + limit) : null,
    }
  }

  let rows: NotionDbRow[]
  let rowsHasMore = false
  let rowsNextCursor: string | null = null
  const rowLimit = options?.rowLimit
  const rowCursor = options?.rowCursor

  if (viewPageIds) {
    // Hydrate properties from data_source, then keep/order only view-query page ids
    const all = (await queryRowsPaged(false)).rows
    const byId = new Map(all.map((r) => [r.id.replace(/-/g, '').toLowerCase(), r]))
    const ordered = viewPageIds
      .map((id) => byId.get(id.replace(/-/g, '').toLowerCase()))
      .filter((r): r is NotionDbRow => !!r)
    const sliced = sliceRows(ordered, rowLimit, rowCursor)
    rows = sliced.rows
    rowsHasMore = sliced.hasMore
    rowsNextCursor = sliced.nextCursor
  } else if (viewFilter || viewSorts) {
    try {
      const paged = await queryRowsPaged(true, { limit: rowLimit, startCursor: rowCursor })
      rows = paged.rows
      rowsHasMore = paged.hasMore
      rowsNextCursor = paged.nextCursor
    } catch (e) {
      console.warn('[notion/database] filter query failed; not dumping full DB', e)
      rows = []
    }
  } else if (emptySources) {
    // Linked embed without a resolvable view — refuse to dump the unfiltered source
    console.warn('[notion/database] linked embed: no view resolved; returning empty rows', {
      embedDatabaseId,
      title,
    })
    rows = []
  } else {
    const paged = await queryRowsPaged(false, { limit: rowLimit, startCursor: rowCursor })
    rows = paged.rows
    rowsHasMore = paged.hasMore
    rowsNextCursor = paged.nextCursor
  }

  const notionViewSummary: NotionViewSummary | null = notionView
    ? {
        id: notionView.id,
        name: notionView.name || title,
        type: notionView.type,
        layout: notionViewTypeToLayout(notionView.type),
        subtasks: notionView.subtasks ?? null,
        layoutConfig: notionView.layoutConfig ?? null,
      }
    : null

  return {
    // Keep the request/embed id so the client keeps fetching the linked container (not the source DS)
    id: embedDatabaseId,
    dataSourceId: dataSourceId!,
    title,
    url,
    icon,
    properties,
    rows,
    rowsHasMore: rowsHasMore || undefined,
    rowsNextCursor: rowsNextCursor ?? undefined,
    notionView: notionViewSummary,
  }
}

/** Normalize ids when comparing route params to stored Notion ids. */
export function notionIdsEqual(a: string, b: string): boolean {
  return normalizeNotionId(a) === normalizeNotionId(b)
}

/** Property types we allow editing from the in-app table (writes back via PATCH page). */
export const EDITABLE_NOTION_PROPERTY_TYPES = new Set([
  'title',
  'rich_text',
  'number',
  'checkbox',
  'select',
  'multi_select',
  'status',
  'url',
  'email',
  'phone_number',
  'date',
])

export function isNotionPropertyEditable(type: string): boolean {
  return EDITABLE_NOTION_PROPERTY_TYPES.has(type)
}

/** Client → server value for one property write. */
export type NotionPropertyEditValue =
  | { type: 'title' | 'rich_text' | 'url' | 'email' | 'phone_number' | 'date'; text: string }
  | { type: 'number'; number: number | null }
  | { type: 'checkbox'; checked: boolean }
  | { type: 'select' | 'status'; name: string | null } // null clears
  | { type: 'multi_select'; names: string[] }

/** Build the Notion `properties` object fragment for a single property update. */
export function buildNotionPropertyPayload(
  propertyName: string,
  value: NotionPropertyEditValue
): Record<string, unknown> {
  switch (value.type) {
    case 'title':
      return {
        [propertyName]: {
          title: value.text
            ? [{ type: 'text', text: { content: value.text } }]
            : [],
        },
      }
    case 'rich_text':
      return {
        [propertyName]: {
          rich_text: value.text
            ? [{ type: 'text', text: { content: value.text } }]
            : [],
        },
      }
    case 'number':
      return { [propertyName]: { number: value.number } }
    case 'checkbox':
      return { [propertyName]: { checkbox: value.checked } }
    case 'select':
      return {
        [propertyName]: {
          select: value.name ? { name: value.name } : null,
        },
      }
    case 'status':
      return {
        [propertyName]: {
          status: value.name ? { name: value.name } : null,
        },
      }
    case 'multi_select':
      return {
        [propertyName]: {
          multi_select: value.names.map((name) => ({ name })),
        },
      }
    case 'url':
      return { [propertyName]: { url: value.text || null } }
    case 'email':
      return { [propertyName]: { email: value.text || null } }
    case 'phone_number':
      return { [propertyName]: { phone_number: value.text || null } }
    case 'date':
      return {
        [propertyName]: {
          date: value.text ? { start: value.text } : null,
        },
      }
    default:
      throw new Error('Unsupported property type')
  }
}

/** Apply an edit to a local render cell (optimistic UI). */
export function applyEditToCell(
  prev: NotionDbCell | undefined,
  value: NotionPropertyEditValue,
  options?: Array<{ id: string; name: string; color?: string }>
): NotionDbCell {
  const colorFor = (name: string) => options?.find((o) => o.name === name)?.color
  switch (value.type) {
    case 'title':
    case 'rich_text':
    case 'url':
    case 'email':
    case 'phone_number':
    case 'date':
      return { type: value.type, text: value.text }
    case 'number':
      return { type: 'number', text: value.number == null ? '' : String(value.number) }
    case 'checkbox':
      return { type: 'checkbox', checked: value.checked }
    case 'select':
    case 'status':
      return {
        type: value.type,
        text: value.name || '',
        tags: value.name ? [{ name: value.name, color: colorFor(value.name) }] : [],
      }
    case 'multi_select':
      return {
        type: 'multi_select',
        tags: value.names.map((name) => ({ name, color: colorFor(name) })),
        text: value.names.join(', '),
      }
    default:
      return prev || { type: 'unknown', text: '' }
  }
}

/**
 * PATCH a Notion page property (database row cell). Source of truth stays in Notion.
 */
export async function updateNotionPageProperty(
  accessToken: string,
  pageId: string,
  propertyName: string,
  value: NotionPropertyEditValue
): Promise<void> {
  const properties = buildNotionPropertyPayload(propertyName, value)
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties }),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(payload?.message || `Failed to update Notion page ${pageId}`)
  }
}

/**
 * Create a new empty row (page) in a Notion data source.
 * Returns a render-ready row for optimistic UI.
 */
export async function createNotionDatabaseRow(
  accessToken: string,
  dataSourceId: string,
  titlePropertyName: string
): Promise<NotionDbRow> {
  const properties: Record<string, unknown> = {
    [titlePropertyName]: {
      title: [{ type: 'text', text: { content: '' } }],
    },
  }
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { type: 'data_source_id', data_source_id: dataSourceId },
      properties,
    }),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(payload?.message || 'Failed to create Notion database row')
  }
  const cells: Record<string, NotionDbCell> = {
    [titlePropertyName]: { type: 'title', text: '' },
  }
  return {
    id: payload.id,
    url: payload.url,
    icon: emojiFromIcon(payload.icon),
    cells,
  }
}

/** Archive (soft-delete) a Notion page / database row. */
export async function archiveNotionPage(
  accessToken: string,
  pageId: string
): Promise<void> {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ archived: true }),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(payload?.message || `Failed to archive Notion page ${pageId}`)
  }
}

/** Property types we can recreate when spinning a one-row DB from a drag. */
const COPYABLE_PROP_TYPES = new Set([
  'title',
  'rich_text',
  'number',
  'select',
  'multi_select',
  'status',
  'checkbox',
  'url',
  'email',
  'phone_number',
  'date',
])

/** Build Notion create-database property schema from our table columns. */
function schemaPropertiesForCreate(
  properties: NotionDbProperty[]
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const prop of properties) {
    if (!COPYABLE_PROP_TYPES.has(prop.type)) continue
    if (prop.type === 'title') {
      out[prop.name] = { title: {} }
      continue
    }
    if (prop.type === 'rich_text') {
      out[prop.name] = { rich_text: {} }
      continue
    }
    if (prop.type === 'number') {
      out[prop.name] = { number: {} }
      continue
    }
    if (prop.type === 'checkbox') {
      out[prop.name] = { checkbox: {} }
      continue
    }
    if (prop.type === 'url') {
      out[prop.name] = { url: {} }
      continue
    }
    if (prop.type === 'email') {
      out[prop.name] = { email: {} }
      continue
    }
    if (prop.type === 'phone_number') {
      out[prop.name] = { phone_number: {} }
      continue
    }
    if (prop.type === 'date') {
      out[prop.name] = { date: {} }
      continue
    }
    if (prop.type === 'select' || prop.type === 'status') {
      const options = (prop.options || []).map((o) => ({
        name: o.name,
        ...(o.color ? { color: o.color } : {}),
      }))
      out[prop.name] = { [prop.type]: { options } }
      continue
    }
    if (prop.type === 'multi_select') {
      const options = (prop.options || []).map((o) => ({
        name: o.name,
        ...(o.color ? { color: o.color } : {}),
      }))
      out[prop.name] = { multi_select: { options } }
    }
  }
  // Notion requires exactly one title property
  if (!Object.values(out).some((p) => 'title' in p)) {
    out.Name = { title: {} }
  }
  return out
}

/** Build page properties payload from a render-ready row. */
function pagePropertiesFromRow(
  properties: NotionDbProperty[],
  row: NotionDbRow
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const prop of properties) {
    if (!COPYABLE_PROP_TYPES.has(prop.type)) continue
    const cell = row.cells[prop.name]
    if (prop.type === 'title') {
      out[prop.name] = {
        title: [{ type: 'text', text: { content: (cell?.text || '').slice(0, 2000) } }],
      }
      continue
    }
    if (prop.type === 'rich_text') {
      out[prop.name] = {
        rich_text: [{ type: 'text', text: { content: (cell?.text || '').slice(0, 2000) } }],
      }
      continue
    }
    if (prop.type === 'number') {
      const n = cell?.text != null && cell.text !== '' ? Number(cell.text) : null
      out[prop.name] = { number: Number.isFinite(n as number) ? n : null }
      continue
    }
    if (prop.type === 'checkbox') {
      out[prop.name] = { checkbox: !!cell?.checked }
      continue
    }
    if (prop.type === 'url') {
      out[prop.name] = { url: cell?.text || null }
      continue
    }
    if (prop.type === 'email') {
      out[prop.name] = { email: cell?.text || null }
      continue
    }
    if (prop.type === 'phone_number') {
      out[prop.name] = { phone_number: cell?.text || null }
      continue
    }
    if (prop.type === 'date') {
      const raw = (cell?.text || '').trim()
      out[prop.name] = raw ? { date: { start: raw } } : { date: null }
      continue
    }
    if (prop.type === 'select' || prop.type === 'status') {
      const name = cell?.tags?.[0]?.name
      out[prop.name] = name ? { [prop.type]: { name } } : { [prop.type]: null }
      continue
    }
    if (prop.type === 'multi_select') {
      const names = (cell?.tags || []).map((t) => ({ name: t.name }))
      out[prop.name] = { multi_select: names }
    }
  }
  return out
}

/**
 * Create a new Notion database (same copyable schema) under the source DB's parent page,
 * seed it with one page copied from `row`, return ids for a Thinktable databaseBlock frame.
 */
export async function createNotionDatabaseFromRow(
  accessToken: string,
  sourceDatabaseId: string,
  row: NotionDbRow
): Promise<{
  databaseId: string
  dataSourceId: string
  title: string
  url?: string
  icon?: string | null
  rowId: string
}> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  }

  // Load source schema + parent
  const table = await fetchNotionDatabaseTable(accessToken, sourceDatabaseId)
  const dbRes = await fetch(`https://api.notion.com/v1/databases/${table.id}`, {
    method: 'GET',
    headers,
  })
  const dbPayload = await dbRes.json().catch(() => ({}))
  if (!dbRes.ok) {
    throw new Error(dbPayload?.message || 'Failed to load source database')
  }
  const parent = dbPayload.parent as
    | { type?: string; page_id?: string; workspace?: boolean }
    | undefined
  let parentBody: Record<string, unknown>
  if (parent?.type === 'page_id' && parent.page_id) {
    parentBody = { type: 'page_id', page_id: parent.page_id }
  } else if (parent?.type === 'workspace' || parent?.workspace) {
    parentBody = { type: 'workspace', workspace: true }
  } else {
    // Fallback: nest under the row page's... can't. Try data_source parent page via row page parent.
    const pageRes = await fetch(`https://api.notion.com/v1/pages/${row.id}`, {
      method: 'GET',
      headers,
    })
    const pagePayload = await pageRes.json().catch(() => ({}))
    const pageParent = pagePayload?.parent as
      | { type?: string; page_id?: string; database_id?: string }
      | undefined
    if (pageParent?.type === 'page_id' && pageParent.page_id) {
      parentBody = { type: 'page_id', page_id: pageParent.page_id }
    } else {
      throw new Error(
        'Cannot create a new database — share a parent page with Thinktable (not only this database).'
      )
    }
  }

  const titleProp = table.properties.find((p) => p.type === 'title')
  const rowTitle =
    (titleProp && row.cells[titleProp.name]?.text?.trim()) ||
    table.title ||
    'Untitled database'
  const schema = schemaPropertiesForCreate(table.properties)

  const createRes = await fetch('https://api.notion.com/v1/databases', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      parent: parentBody,
      title: [{ type: 'text', text: { content: rowTitle.slice(0, 100) } }],
      properties: schema,
      ...(row.icon ? { icon: { type: 'emoji', emoji: row.icon } } : {}),
    }),
  })
  const created = await createRes.json().catch(() => ({}))
  if (!createRes.ok) {
    throw new Error(created?.message || 'Failed to create Notion database')
  }

  const newDatabaseId = created.id as string
  const sources =
    (created.data_sources as Array<{ id?: string }> | undefined) || []
  let dataSourceId = sources[0]?.id || ''
  if (!dataSourceId) {
    // Resolve via retrieve
    const fresh = await fetchNotionDatabaseTable(accessToken, newDatabaseId)
    dataSourceId = fresh.dataSourceId
  }

  const pageProps = pagePropertiesFromRow(table.properties, row)
  const pageRes = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      parent: { type: 'data_source_id', data_source_id: dataSourceId },
      properties: pageProps,
      ...(row.icon ? { icon: { type: 'emoji', emoji: row.icon } } : {}),
    }),
  })
  const pagePayload = await pageRes.json().catch(() => ({}))
  if (!pageRes.ok) {
    throw new Error(pagePayload?.message || 'Failed to copy row into new database')
  }

  const titleArr = (created.title as Array<{ plain_text?: string }> | undefined) || []
  const title =
    titleArr.map((t) => t.plain_text || '').join('').trim() || rowTitle

  return {
    databaseId: newDatabaseId,
    dataSourceId,
    title,
    url: created.url,
    icon: row.icon || null,
    rowId: pagePayload.id as string,
  }
}
