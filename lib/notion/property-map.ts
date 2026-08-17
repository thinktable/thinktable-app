// Map Notion database property types ↔ Thinktable propertyBlock cells (Convert layout → Card view).

import type { PropertyTypeId } from '@/lib/blocks/property' // Frame property cell kinds
import { propertyBlockHtml } from '@/lib/tiptap/property-block' // Serialized property cell HTML
import type { NotionDbCell, NotionDbProperty } from '@/lib/notion/database' // Live table schema + cells

/** Escape a value for a double-quoted HTML attribute. */
function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** Notion API property type → Thinktable PropertyTypeId (best-effort). */
export function notionPropTypeToPropertyType(notionType: string): PropertyTypeId {
  switch (notionType) {
    case 'title':
    case 'rich_text':
      return 'text' // Title/name becomes boardLink on the card; rich text stays text
    case 'number':
      return 'number'
    case 'select':
      return 'select'
    case 'multi_select':
      return 'multiSelect'
    case 'status':
      return 'status'
    case 'date':
      return 'date'
    case 'people':
      return 'person'
    case 'files':
      return 'files'
    case 'checkbox':
      return 'checkbox'
    case 'url':
      return 'url'
    case 'phone_number':
      return 'phone'
    case 'email':
      return 'email'
    case 'relation':
      return 'relation'
    case 'rollup':
      return 'rollup'
    case 'formula':
      return 'formula'
    case 'unique_id':
      return 'uniqueId'
    case 'created_time':
      return 'createdTime'
    case 'last_edited_time':
      return 'lastEditedTime'
    case 'created_by':
      return 'createdBy'
    case 'last_edited_by':
      return 'lastEditedBy'
    case 'place':
      return 'place'
    default:
      return 'text' // Unknown Notion types still get a text cell
  }
}

/** Plain display string for a Notion cell (propertyBlock `data-value`). */
export function notionCellDisplayValue(cell: NotionDbCell | undefined): string {
  if (!cell) return '' // Missing cell → Empty placeholder
  if (cell.type === 'checkbox') return cell.checked ? 'true' : 'false' // Checkbox as attr string
  if (cell.tags && cell.tags.length > 0) return cell.tags.map((t) => t.name).join(', ') // Select-like
  return (cell.text || '').trim() // title / rich_text / number / url / …
}

/** Build propertyBlock HTML for one schema column + row cell. */
export function propertyCellHtmlForNotion(
  prop: NotionDbProperty,
  cell: NotionDbCell | undefined
): string {
  const type = notionPropTypeToPropertyType(prop.type) // Map Notion → Thinktable type
  const value = notionCellDisplayValue(cell) // Plain value for the cell
  return propertyBlockHtml(type, value) // Atom HTML TipTap round-trips
}

/** Concatenate property cells for every column except title (card frame body under the boardLink). */
export function nonTitlePropertyCellsHtml(
  properties: NotionDbProperty[],
  cells: Record<string, NotionDbCell>
): string {
  return properties
    .filter((p) => p.type !== 'title') // Title is the boardLink, not a cell on the card
    .map((p) => propertyCellHtmlForNotion(p, cells[p.name]))
    .join('')
}

/** All property cells including title (child board body — properties above notes). */
export function allPropertyCellsHtml(
  properties: NotionDbProperty[],
  cells: Record<string, NotionDbCell>
): string {
  return properties.map((p) => propertyCellHtmlForNotion(p, cells[p.name])).join('')
}

/** Title-variant boardLink HTML for a row’s name → linked Thinktable board. */
export function rowBoardLinkHtml(opts: {
  boardId: string
  title: string
  icon?: string | null
}): string {
  const title = escapeAttr(opts.title || 'Untitled') // Attr-safe label
  const iconAttr = opts.icon ? ` data-icon="${escapeAttr(opts.icon)}"` : '' // Optional emoji
  return `<div data-type="boardLink" data-board-id="${escapeAttr(opts.boardId)}" data-title="${title}" data-variant="title"${iconAttr}></div>`
}

/** Read the title/name cell text from a row. */
export function rowTitleFromCells(
  properties: NotionDbProperty[],
  cells: Record<string, NotionDbCell>
): string {
  const titleProp = properties.find((p) => p.type === 'title') // Notion name column
  if (!titleProp) return 'Untitled'
  const text = notionCellDisplayValue(cells[titleProp.name])
  return text || 'Untitled'
}
