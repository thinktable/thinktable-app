// propertyBlock HTML serialize/parse — string-only, no TipTap or React imports.
// Server routes (Convert layout) need these helpers; importing them from `property-block.ts`
// dragged `@tiptap/react` + the NodeView component into the server bundle, and `next build`
// died collecting page data ("Class extends value undefined"). Keep this module dependency-free.

import { isPropertyTypeId, type PropertyTypeId } from '@/lib/blocks/property' // Known type ids

/** Options when serializing a property cell to HTML. */
export type PropertyBlockHtmlOpts = {
  inline?: boolean // User Turn into / persisted preference — stay in body even when empty
  propertyName?: string // Notion column name (card↔table inline preference key)
}

/** Escape a value for a double-quoted HTML attribute. */
function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** Serialized HTML for a property cell (I-bar / Turn into / DB card seed). */
export function propertyBlockHtml(
  type: PropertyTypeId,
  value = '',
  opts?: PropertyBlockHtmlOpts
): string {
  const typeAttr = ` data-property-type="${type}"` // Which Property pane type this cell is
  const valueAttr = value ? ` data-value="${escapeAttr(value)}"` : '' // Omit when empty (placeholder)
  const inlineAttr = opts?.inline ? ' data-inline="true"' : '' // Default false — omit attr
  const nameAttr =
    opts?.propertyName && opts.propertyName.trim()
      ? ` data-property-name="${escapeAttr(opts.propertyName.trim())}"`
      : '' // Notion column name for round-trip
  return `<div data-type="propertyBlock"${typeAttr}${valueAttr}${inlineAttr}${nameAttr}></div>`
}

/** True when the HTML still has any propertyBlock (filled or empty) — vs legacy metadata-only. */
export function htmlHasPropertyBlocks(html: string): boolean {
  return !!html && /data-type=["']propertyBlock["']/.test(html) // Any cell present
}

/** Parse one propertyBlock opening tag for top-strip / inline harvest. */
export function parsePropertyBlockTag(tag: string): {
  type: PropertyTypeId | null
  empty: boolean
  inline: boolean
  propertyName: string
} {
  const vm = tag.match(/data-value=["']([^"']*)["']/) // Missing / blank → empty
  const empty = !(vm && vm[1].trim() !== '')
  const inline = /\bdata-inline=["']true["']/i.test(tag) // User / persisted inline
  const tm = tag.match(/data-property-type=["']([^"']+)["']/)
  const type = tm && isPropertyTypeId(tm[1]) ? tm[1] : null
  const nm = tag.match(/data-property-name=["']([^"']*)["']/)
  const propertyName = nm ? nm[1].trim() : ''
  return { type, empty, inline, propertyName }
}

/** Header-only type list from persisted HTML (before the editor mounts). */
export function readPropertyBlockTypesFromHtml(html: string): PropertyTypeId[] {
  if (!html || !html.includes('propertyBlock')) return [] // Fast out
  const types: PropertyTypeId[] = []
  const re = /<div\b[^>]*data-type=["']propertyBlock["'][^>]*>/gi // Opening tag, any attr order
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const { type, empty, inline } = parsePropertyBlockTag(m[0])
    if (!empty || inline) continue // Body-only — skip top strip
    if (type) types.push(type)
  }
  return types
}

/** Inline (body-cell) property names from persisted HTML — card↔table round-trip. */
export function readInlinePropertyNamesFromHtml(html: string): string[] {
  if (!html || !html.includes('propertyBlock')) return []
  const names: string[] = []
  const re = /<div\b[^>]*data-type=["']propertyBlock["'][^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const { inline, propertyName } = parsePropertyBlockTag(m[0])
    if (inline && propertyName && !names.includes(propertyName)) names.push(propertyName)
  }
  return names
}
