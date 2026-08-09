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
    default:
      // relation / rollup / people / files — show a short placeholder for now
      return { type, text: '' }
  }
}

/** Emoji from Notion icon payload. */
function emojiFromIcon(icon: { type?: string; emoji?: string } | null | undefined): string | null {
  return icon?.type === 'emoji' && icon.emoji ? icon.emoji : null
}

/**
 * Load database title/properties + all queryable rows for the structured table UI.
 */
export async function fetchNotionDatabaseTable(
  accessToken: string,
  databaseId: string
): Promise<NotionDatabaseTable> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  }

  const dbRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    method: 'GET',
    headers,
  })
  const dbPayload = await dbRes.json()
  if (!dbRes.ok) {
    throw new Error(dbPayload?.message || `Failed to load Notion database ${databaseId}`)
  }

  const propsObj = (dbPayload.properties || {}) as Record<
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

  const titleArr = (dbPayload.title as Array<{ plain_text?: string }> | undefined) || []
  const title = titleArr.map((t) => t.plain_text || '').join('').trim() || 'Untitled database'

  const rows: NotionDbRow[] = []
  let startCursor: string | undefined
  do {
    const qRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ page_size: 100, start_cursor: startCursor }),
    })
    const qPayload = await qRes.json()
    if (!qRes.ok) {
      throw new Error(qPayload?.message || `Failed to query Notion database ${databaseId}`)
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
    id: dbPayload.id || databaseId,
    title,
    url: dbPayload.url,
    icon: emojiFromIcon(dbPayload.icon),
    properties,
    rows,
  }
}

/** Normalize ids when comparing route params to stored Notion ids. */
export function notionIdsEqual(a: string, b: string): boolean {
  return normalizeNotionId(a) === normalizeNotionId(b)
}
