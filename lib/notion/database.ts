// Fetch a Notion database schema + rows for an in-app table view (Notion-like structure).

import { NOTION_VERSION } from './config'
import { normalizeNotionId } from './pages'

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

/** Full payload for the structured database table UI. */
export type NotionDatabaseTable = {
  id: string
  title: string
  url?: string
  icon?: string | null
  properties: NotionDbProperty[] // Column order (title first)
  rows: NotionDbRow[]
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

/**
 * Load database title/properties + all queryable rows for the structured table UI.
 * Accepts a Notion **database** id (container) or **data_source** id (table).
 * Uses API 2025-09-03 data_sources endpoints (schema + query live on the data source).
 */
export async function fetchNotionDatabaseTable(
  accessToken: string,
  databaseOrDataSourceId: string
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
      throw new Error(
        'No data sources accessible for this database. In Notion, open the database → ••• → Connections and share it with Thinktable.'
      )
    }
    // Prefer a source whose name matches the DB title; else first accessible source
    const named =
      sources.find((s) => (s.name || '').trim().toLowerCase() === title.toLowerCase()) || sources[0]
    dataSourceId = named.id || null
    if (named.name?.trim()) title = named.name.trim()
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
    } else if (dbErrorMessage) {
      throw new Error(dbErrorMessage)
    } else {
      throw new Error(dsProbePayload?.message || 'Notion data source unavailable')
    }
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

  // Prefer data-source title/url/icon when present
  const dsTitleArr = (dsPayload.title as Array<{ plain_text?: string }> | undefined) || []
  const dsTitle = dsTitleArr.map((t) => t.plain_text || '').join('').trim()
  if (dsTitle) title = dsTitle
  if (dsPayload.url) url = dsPayload.url
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

  const rows: NotionDbRow[] = []
  let startCursor: string | undefined
  do {
    const qRes = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ page_size: 100, start_cursor: startCursor }),
    })
    const qPayload = await qRes.json()
    if (!qRes.ok) {
      throw new Error(qPayload?.message || `Failed to query Notion data source ${dataSourceId}`)
    }
    for (const result of qPayload.results || []) {
      if (result?.object !== 'page') continue
      const pageProps = (result.properties || {}) as Record<string, Record<string, unknown>>
      const cells: Record<string, NotionDbCell> = {}
      for (const [name, prop] of Object.entries(pageProps)) {
        cells[name] = cellFromProperty(prop)
      }
      rows.push({
        id: result.id,
        url: result.url,
        icon: emojiFromIcon(result.icon),
        cells,
      })
    }
    startCursor = qPayload.has_more ? qPayload.next_cursor : undefined
  } while (startCursor)

  return {
    id: databaseId,
    title,
    url,
    icon,
    properties,
    rows,
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
