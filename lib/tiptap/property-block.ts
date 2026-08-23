// propertyBlock — a TipTap **block** for Turn into → Property / DB Card view.
// Atom like imageBlock: type + value (+ placement) live in attrs and round-trip via data-*.
// Placement: empty + !inline → top strip only (hidden in body); inline or filled → body cell once.

import { mergeAttributes, Node } from '@tiptap/core' // Custom block node
import type { Editor } from '@tiptap/core' // Walk the live doc for top-strip grips
import { ReactNodeViewRenderer } from '@tiptap/react' // React NodeView for icon + cell
import { PropertyBlockView } from '@/components/property-block-view' // The rendered chrome
import { isPropertyTypeId, type PropertyTypeId } from '@/lib/blocks/property' // Known type ids
import type { EditorBlockRef } from '@/lib/tiptap/block-selection' // Top ⋮⋮ click → that propertyBlock

export interface PropertyBlockOptions {
  HTMLAttributes: Record<string, unknown> // Passthrough HTML attrs for mergeAttributes
}

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

/** True when the cell has no persisted value. */
export function isPropertyBlockValueEmpty(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '' // Whitespace-only counts as empty
}

/** True when attrs mark this cell as user-inlined (stay in body when empty). */
export function isPropertyBlockInline(attrs: Record<string, unknown> | null | undefined): boolean {
  return attrs?.inline === true || attrs?.inline === 'true' // Attr may round-trip as string
}

/**
 * Top-strip membership: empty and not inline.
 * Filled cells and user-inlined empties show once in the body only.
 */
export function isPropertyBlockHeaderOnly(attrs: Record<string, unknown> | null | undefined): boolean {
  if (!attrs) return false
  return isPropertyBlockValueEmpty(attrs.value) && !isPropertyBlockInline(attrs)
}

/** One top-strip icon: type glyph + optional Notion column name. */
export type PropertyHeaderItem = {
  type: PropertyTypeId
  name: string // `data-property-name` when set (card view)
}

/** Property headers in doc order (header-only cells). */
export function readPropertyBlockHeadersFromDoc(doc: {
  descendants: (
    fn: (node: { type: { name: string }; attrs: Record<string, unknown> }) => boolean | void
  ) => void
}): PropertyHeaderItem[] {
  const items: PropertyHeaderItem[] = []
  doc.descendants((node) => {
    if (node.type.name !== 'propertyBlock') return true
    if (!isPropertyBlockHeaderOnly(node.attrs)) return false
    const t = node.attrs.propertyType
    if (!isPropertyTypeId(t)) return false
    const raw = node.attrs.propertyName
    const name = typeof raw === 'string' ? raw.trim() : ''
    items.push({ type: t, name })
    return false
  })
  return items
}

/** Header-only list from persisted HTML (before the editor mounts). */
export function readPropertyBlockHeadersFromHtml(html: string): PropertyHeaderItem[] {
  if (!html || !html.includes('propertyBlock')) return []
  const items: PropertyHeaderItem[] = []
  const re = /<div\b[^>]*data-type=["']propertyBlock["'][^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const { type, empty, inline, propertyName } = parsePropertyBlockTag(m[0])
    if (!empty || inline || !type) continue
    items.push({ type, name: propertyName })
  }
  return items
}

/** Property types in doc order for the top strip (header-only cells). */
export function readPropertyBlockTypesFromDoc(doc: {
  descendants: (
    fn: (node: { type: { name: string }; attrs: Record<string, unknown> }) => boolean | void
  ) => void
}): PropertyTypeId[] {
  const types: PropertyTypeId[] = [] // First header-only propertyBlock → first top icon
  doc.descendants((node) => {
    if (node.type.name !== 'propertyBlock') return true // Keep walking non-property blocks
    if (!isPropertyBlockHeaderOnly(node.attrs)) return false // Body cell — skip top strip
    const t = node.attrs.propertyType
    if (isPropertyTypeId(t)) types.push(t) // Same order as header-only blocks in the frame
    return false // Atom — nothing nested to visit
  })
  return types
}

/** True when the HTML still has any propertyBlock (filled or empty) — vs legacy metadata-only. */
export function htmlHasPropertyBlocks(html: string): boolean {
  return !!html && /data-type=["']propertyBlock["']/.test(html) // Any cell present
}

/** Parse one propertyBlock opening tag for top-strip / inline harvest. */
function parsePropertyBlockTag(tag: string): {
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

/**
 * Notion property names marked `data-inline="true"` in card HTML.
 * Used when collapsing cards → table so table→card can restore inline empties.
 */
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

/** propertyBlock refs in document order (optionally header-only for the top icon row). */
export function collectPropertyBlocks(
  editor: Editor,
  opts?: { emptyOnly?: boolean } // emptyOnly = header-only (empty + !inline); omit → every cell
): EditorBlockRef[] {
  if (!editor || editor.isDestroyed) return [] // Unmounted — nothing to arm
  const headerOnly = !!opts?.emptyOnly // Keep param name for call sites; means top-strip set
  const refs: EditorBlockRef[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'propertyBlock') return true // Skip non-property blocks
    if (headerOnly && !isPropertyBlockHeaderOnly(node.attrs)) return false // Skip body cells
    refs.push({ from: pos, to: pos + node.nodeSize, node, typeName: node.type.name })
    return false // Atom — don't walk inside
  })
  return refs
}

/** A block whose payload is a property type + optional cell value + placement. */
export const PropertyBlock = Node.create<PropertyBlockOptions>({
  name: 'propertyBlock', // Node type id used by Turn into + ⋮⋮ grip
  group: 'block', // Own line in the doc
  atom: true, // No inline editable content — value lives in an attribute
  selectable: true, // Can be selected/deleted like any block
  draggable: false, // Frame/⋮⋮ own dragging; the node itself doesn't drag

  addOptions() {
    return { HTMLAttributes: {} } // Default empty passthrough
  },

  addAttributes() {
    return {
      propertyType: {
        default: 'text' as PropertyTypeId, // Fallback when HTML is missing a type
        parseHTML: (el) => {
          const raw = (el as HTMLElement).getAttribute('data-property-type') // Round-trip from message HTML
          return isPropertyTypeId(raw) ? raw : 'text' // Unknown → text so the node still mounts
        },
        renderHTML: (attrs) =>
          attrs.propertyType ? { 'data-property-type': attrs.propertyType } : {},
      },
      value: {
        default: '', // Cell text; empty → NodeView shows Empty placeholder (when inline)
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-value') || '',
        renderHTML: (attrs) => (attrs.value ? { 'data-value': attrs.value } : {}),
      },
      inline: {
        default: false, // DB card empties stay top-only until user Turn into / future “add inline”
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-inline') === 'true',
        renderHTML: (attrs) => (attrs.inline ? { 'data-inline': 'true' } : {}),
      },
      propertyName: {
        default: '', // Notion column name — card↔table inline preference key
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-property-name') || '',
        renderHTML: (attrs) =>
          attrs.propertyName ? { 'data-property-name': attrs.propertyName } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="propertyBlock"]' }] // Round-trips through message HTML
  },

  renderHTML({ HTMLAttributes }) {
    // data-* attrs carry the payload; NodeView paints the visible chrome (or hides header-only)
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'propertyBlock', class: 'tt-property-block' }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PropertyBlockView) // Icon + Empty cell (or hidden header-only)
  },
})
