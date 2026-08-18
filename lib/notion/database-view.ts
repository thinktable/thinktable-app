// Thinktable database view model — layout / filter / sort / group / color / sub-tasks.
// View config is Thinktable-owned; row content stays Notion-owned.

import type { NotionDbCell, NotionDbProperty, NotionDbRow } from './database'

export type DatabaseLayout =
  | 'table'
  | 'board'
  | 'timeline'
  | 'calendar'
  | 'list'
  | 'gallery'
  | 'chart'
  | 'feed'
  | 'map'

export type FilterOperator =
  | 'is'
  | 'is_not'
  | 'contains'
  | 'does_not_contain'
  | 'is_empty'
  | 'is_not_empty'
  | 'gt'
  | 'lt'

export type DatabaseFilter = {
  id: string
  property: string // Property name
  operator: FilterOperator
  value: string // Compared as plain text / tag name / number string
}

export type DatabaseSort = {
  id: string
  property: string
  direction: 'asc' | 'desc'
}

export type ConditionalColorRule = {
  id: string
  property: string
  operator: FilterOperator
  value: string
  color: string // CSS background for the row
  applyTo: 'row' // Extensible later (cell)
}

export type SubTasksSettings = {
  enabled: boolean
  relationProperty: string | null // Relation / text holding parent ids
  display: 'nested' | 'flat' // Nested in toggle vs flat list (all rows visible)
  filterMode: 'parents_and_subs' | 'matching_only'
}

/** Map Notion Views API `configuration.subtasks` → Thinktable Sub-tasks settings. */
export function subTasksFromNotionView(
  subtasks: {
    property_id?: string | null
    display_mode?: string | null
    filter_scope?: string | null
  } | null | undefined,
  properties: NotionDbProperty[]
): SubTasksSettings {
  const base = defaultDatabaseViewSettings().subTasks
  const mode = (
    subtasks?.display_mode ||
    (subtasks?.property_id ? 'show' : '')
  ).toLowerCase()
  if (!subtasks || mode === 'disabled' || mode === '') {
    // No Notion subtask config → keep off (flat full list)
    return base
  }
  const propId = (subtasks.property_id || '').replace(/-/g, '').toLowerCase()
  const prop =
    properties.find((p) => p.id.replace(/-/g, '').toLowerCase() === propId) ||
    properties.find((p) => p.type === 'relation' && /parent/i.test(p.name)) ||
    null
  // show = nested toggles; flattened = all rows; hidden = parents only (nested, start collapsed)
  const display: 'nested' | 'flat' = mode === 'flattened' ? 'flat' : 'nested'
  const scope = (subtasks.filter_scope || '').toLowerCase()
  return {
    enabled: true,
    relationProperty: prop?.name || null,
    display,
    filterMode: scope === 'subitems' ? 'matching_only' : 'parents_and_subs',
  }
}

/** Normalize Notion property ids for loose matching (dashed vs undashed). */
function notionPropIdKey(id: string): string {
  return id.replace(/-/g, '').toLowerCase()
}

/**
 * Seed column widths / visibility / wrap from Notion view `configuration.properties`
 * (+ wrap_cells / show_vertical_lines). Widths are px as returned by the Views API.
 */
export function applyNotionLayoutConfig(
  settings: DatabaseViewSettings,
  layoutConfig: {
    properties?: Array<{ property_id: string; visible?: boolean; width?: number }> | null
    wrap_cells?: boolean | null
    show_vertical_lines?: boolean | null
  } | null | undefined,
  properties: NotionDbProperty[]
): DatabaseViewSettings {
  if (!layoutConfig) return settings
  const byId = new Map(properties.map((p) => [notionPropIdKey(p.id), p]))
  const columnWidths: Record<string, number> = { ...(settings.columnWidths || {}) }
  const order: string[] = []
  const hidden: string[] = []
  let sawVisibility = false
  for (const entry of layoutConfig.properties || []) {
    const prop = byId.get(notionPropIdKey(entry.property_id))
    if (!prop) continue
    order.push(prop.name)
    if (typeof entry.visible === 'boolean') {
      sawVisibility = true
      if (!entry.visible) hidden.push(prop.name)
    }
    if (typeof entry.width === 'number' && entry.width > 0) {
      columnWidths[prop.name] = Math.round(entry.width)
    }
  }
  const nextOrder =
    order.length > 0
      ? [...order, ...settings.propertyOrder.filter((n) => !order.includes(n))]
      : settings.propertyOrder
  return {
    ...settings,
    columnWidths,
    propertyOrder: nextOrder,
    // Prefer Notion visibility when the view lists properties; else keep local hidden set
    hiddenProperties: sawVisibility ? hidden : settings.hiddenProperties,
    layoutOptions: {
      ...settings.layoutOptions,
      wrapAllContent:
        typeof layoutConfig.wrap_cells === 'boolean'
          ? layoutConfig.wrap_cells
          : settings.layoutOptions.wrapAllContent,
      showVerticalLines:
        typeof layoutConfig.show_vertical_lines === 'boolean'
          ? layoutConfig.show_vertical_lines
          : settings.layoutOptions.showVerticalLines,
    },
  }
}

/** Fallback px when Notion omitted `width` for a column (keeps fixed layout from growing). */
export function defaultColumnWidthPx(prop: NotionDbProperty): number {
  if (prop.type === 'title') return 280
  if (prop.type === 'checkbox') return 48
  if (prop.type === 'number') return 100
  return 160
}

/** Resolved column width for render (Notion / saved / default). */
export function columnWidthPx(
  prop: NotionDbProperty,
  settings: Pick<DatabaseViewSettings, 'columnWidths'>
): number {
  const w = settings.columnWidths?.[prop.name]
  if (typeof w === 'number' && w > 0) return w
  return defaultColumnWidthPx(prop)
}

export type LayoutOptions = {
  showDataSourceTitle: boolean
  showVerticalLines: boolean
  showPageIcon: boolean
  wrapAllContent: boolean
  openPagesIn: 'side_peek' | 'center_peek' | 'full_page'
}

export type DatabaseViewSettings = {
  name: string // View label
  layout: DatabaseLayout
  propertyOrder: string[] // Property names in display order
  hiddenProperties: string[] // Hidden property names
  /** Property name → column width in px (from Notion view config or local resize). */
  columnWidths: Record<string, number>
  filters: DatabaseFilter[]
  sorts: DatabaseSort[]
  groupBy: string | null // Property name, or null
  conditionalColors: ConditionalColorRule[]
  subTasks: SubTasksSettings
  layoutOptions: LayoutOptions
  searchQuery: string // Live search box
}

export const DATABASE_LAYOUTS: Array<{ id: DatabaseLayout; label: string }> = [
  { id: 'table', label: 'Table' },
  { id: 'board', label: 'Board' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'list', label: 'List' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'chart', label: 'Chart' },
  { id: 'feed', label: 'Feed' },
  { id: 'map', label: 'Map' },
]

/** Layouts with a full renderer today (others show a stub). */
export const IMPLEMENTED_LAYOUTS = new Set<DatabaseLayout>([
  'table',
  'board',
  'list',
  'gallery',
  'calendar',
])

export const CONDITIONAL_COLORS: Array<{ id: string; label: string; bg: string }> = [
  { id: 'green', label: 'Green', bg: '#dbeddb' },
  { id: 'red', label: 'Red', bg: '#ffe2dd' },
  { id: 'yellow', label: 'Yellow', bg: '#fdecc8' },
  { id: 'blue', label: 'Blue', bg: '#d3e5ef' },
  { id: 'purple', label: 'Purple', bg: '#e8deee' },
  { id: 'pink', label: 'Pink', bg: '#f5e0e9' },
  { id: 'orange', label: 'Orange', bg: '#fadec9' },
  { id: 'gray', label: 'Gray', bg: '#e3e2e0' },
]

export function defaultDatabaseViewSettings(name = 'Default'): DatabaseViewSettings {
  return {
    name,
    layout: 'table',
    propertyOrder: [],
    hiddenProperties: [],
    columnWidths: {},
    filters: [],
    sorts: [],
    groupBy: null,
    conditionalColors: [],
    subTasks: {
      enabled: false,
      relationProperty: null,
      display: 'nested',
      filterMode: 'parents_and_subs',
    },
    layoutOptions: {
      showDataSourceTitle: true,
      showVerticalLines: false,
      showPageIcon: true,
      wrapAllContent: true,
      openPagesIn: 'side_peek',
    },
    searchQuery: '',
  }
}

/** Merge saved settings with schema (new props appear; removed props drop). */
export function normalizeViewSettings(
  settings: DatabaseViewSettings | null | undefined,
  properties: NotionDbProperty[]
): DatabaseViewSettings {
  const base = settings ? { ...defaultDatabaseViewSettings(), ...settings } : defaultDatabaseViewSettings()
  const names = properties.map((p) => p.name)
  const nameSet = new Set(names)
  const order = [
    ...base.propertyOrder.filter((n) => nameSet.has(n)),
    ...names.filter((n) => !base.propertyOrder.includes(n)),
  ]
  const columnWidths: Record<string, number> = {}
  for (const [n, w] of Object.entries(base.columnWidths || {})) {
    if (nameSet.has(n) && typeof w === 'number' && w > 0) columnWidths[n] = w
  }
  return {
    ...base,
    propertyOrder: order,
    hiddenProperties: base.hiddenProperties.filter((n) => nameSet.has(n)),
    columnWidths,
    filters: base.filters.filter((f) => nameSet.has(f.property)),
    sorts: base.sorts.filter((s) => nameSet.has(s.property)),
    groupBy: base.groupBy && nameSet.has(base.groupBy) ? base.groupBy : null,
    conditionalColors: base.conditionalColors.filter((r) => nameSet.has(r.property)),
    subTasks: {
      ...base.subTasks,
      relationProperty:
        base.subTasks.relationProperty && nameSet.has(base.subTasks.relationProperty)
          ? base.subTasks.relationProperty
          : null,
    },
    layoutOptions: { ...defaultDatabaseViewSettings().layoutOptions, ...base.layoutOptions },
  }
}

/** Plain string used for filter / sort / search comparisons. */
export function cellCompareText(cell?: NotionDbCell): string {
  if (!cell) return ''
  if (cell.tags?.length) return cell.tags.map((t) => t.name).join(', ')
  if (typeof cell.checked === 'boolean') return cell.checked ? 'true' : 'false'
  return (cell.text || '').trim()
}

function matchesFilter(row: NotionDbRow, filter: DatabaseFilter): boolean {
  const text = cellCompareText(row.cells[filter.property])
  const value = filter.value
  switch (filter.operator) {
    case 'is':
      return text.toLowerCase() === value.toLowerCase()
    case 'is_not':
      return text.toLowerCase() !== value.toLowerCase()
    case 'contains':
      return text.toLowerCase().includes(value.toLowerCase())
    case 'does_not_contain':
      return !text.toLowerCase().includes(value.toLowerCase())
    case 'is_empty':
      return text.length === 0
    case 'is_not_empty':
      return text.length > 0
    case 'gt': {
      const a = parseFloat(text)
      const b = parseFloat(value)
      return !Number.isNaN(a) && !Number.isNaN(b) && a > b
    }
    case 'lt': {
      const a = parseFloat(text)
      const b = parseFloat(value)
      return !Number.isNaN(a) && !Number.isNaN(b) && a < b
    }
    default:
      return true
  }
}

function compareRows(a: NotionDbRow, b: NotionDbRow, sorts: DatabaseSort[]): number {
  for (const sort of sorts) {
    const av = cellCompareText(a.cells[sort.property])
    const bv = cellCompareText(b.cells[sort.property])
    const an = parseFloat(av)
    const bn = parseFloat(bv)
    let cmp = 0
    if (!Number.isNaN(an) && !Number.isNaN(bn) && av !== '' && bv !== '') {
      cmp = an - bn
    } else {
      cmp = av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true })
    }
    if (cmp !== 0) return sort.direction === 'asc' ? cmp : -cmp
  }
  return 0
}

/** Visible properties in configured order. */
export function visibleProperties(
  properties: NotionDbProperty[],
  settings: DatabaseViewSettings
): NotionDbProperty[] {
  const byName = new Map(properties.map((p) => [p.name, p]))
  const hidden = new Set(settings.hiddenProperties)
  return settings.propertyOrder
    .map((n) => byName.get(n))
    .filter((p): p is NotionDbProperty => !!p && !hidden.has(p.name))
}

/** First matching conditional color background for a row. */
export function rowBackground(
  row: NotionDbRow,
  rules: ConditionalColorRule[]
): string | undefined {
  for (const rule of rules) {
    if (matchesFilter(row, rule)) {
      const swatch = CONDITIONAL_COLORS.find((c) => c.id === rule.color || c.bg === rule.color)
      return swatch?.bg || rule.color
    }
  }
  return undefined
}

export type RowGroup = {
  key: string // Group label
  rows: NotionDbRow[]
}

/** Apply search → filters → sorts (group is separate). */
export function applyViewRows(
  rows: NotionDbRow[],
  settings: DatabaseViewSettings
): NotionDbRow[] {
  let out = rows
  const q = settings.searchQuery.trim().toLowerCase()
  if (q) {
    out = out.filter((row) =>
      Object.values(row.cells).some((c) => cellCompareText(c).toLowerCase().includes(q))
    )
  }
  for (const filter of settings.filters) {
    if (filter.operator !== 'is_empty' && filter.operator !== 'is_not_empty' && !filter.value) {
      continue // Incomplete filter — ignore until configured
    }
    out = out.filter((row) => matchesFilter(row, filter))
  }
  if (settings.sorts.length) {
    out = [...out].sort((a, b) => compareRows(a, b, settings.sorts))
  }
  return out
}

/** Partition rows by groupBy property (empty → "No value"). */
export function groupRows(rows: NotionDbRow[], groupBy: string | null): RowGroup[] {
  if (!groupBy) return [{ key: '', rows }]
  const map = new Map<string, NotionDbRow[]>()
  for (const row of rows) {
    const key = cellCompareText(row.cells[groupBy]) || 'No value'
    const list = map.get(key) || []
    list.push(row)
    map.set(key, list)
  }
  return Array.from(map.entries()).map(([key, grouped]) => ({ key, rows: grouped }))
}

/**
 * Build parent→children map from a relation-like property (comma-separated page ids in cell.text).
 * Falls back to empty map when relation data isn't populated yet.
 */
export function buildSubTaskTree(
  rows: NotionDbRow[],
  relationProperty: string | null
): { roots: NotionDbRow[]; childrenOf: Map<string, NotionDbRow[]> } {
  const childrenOf = new Map<string, NotionDbRow[]>()
  if (!relationProperty) return { roots: rows, childrenOf }
  const byId = new Map(rows.map((r) => [r.id.replace(/-/g, '').toLowerCase(), r]))
  const childIds = new Set<string>()
  for (const row of rows) {
    const raw = cellCompareText(row.cells[relationProperty])
    if (!raw) continue
    // Relation cells store ids comma-separated; also accept a single title match no-op
    for (const part of raw.split(/[,\s]+/).filter(Boolean)) {
      const key = part.replace(/-/g, '').toLowerCase()
      const parent = byId.get(key)
      if (!parent) continue
      const list = childrenOf.get(parent.id) || []
      list.push(row)
      childrenOf.set(parent.id, list)
      childIds.add(row.id)
    }
  }
  const roots = rows.filter((r) => !childIds.has(r.id))
  return { roots: roots.length ? roots : rows, childrenOf }
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

/** Parse view settings JSON from TipTap attr / localStorage. */
export function parseViewSettings(raw: unknown): DatabaseViewSettings | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as DatabaseViewSettings
    } catch {
      return null
    }
  }
  if (typeof raw === 'object') return raw as DatabaseViewSettings
  return null
}
