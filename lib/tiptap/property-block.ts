// propertyBlock — a TipTap **block** for Turn into → Property.
// Atom like imageBlock: type + value live in attrs and round-trip via data-*.
// NodeView paints the type icon + Empty cell; the frame still shows its top property icon.

import { mergeAttributes, Node } from '@tiptap/core' // Custom block node
import type { Editor } from '@tiptap/core' // Walk the live doc for top-strip grips
import { ReactNodeViewRenderer } from '@tiptap/react' // React NodeView for icon + cell
import { PropertyBlockView } from '@/components/property-block-view' // The rendered chrome
import { isPropertyTypeId, type PropertyTypeId } from '@/lib/blocks/property' // Known type ids
import type { EditorBlockRef } from '@/lib/tiptap/block-selection' // Top ⋮⋮ click → that propertyBlock

export interface PropertyBlockOptions {
  HTMLAttributes: Record<string, unknown> // Passthrough HTML attrs for mergeAttributes
}

/** Escape a value for a double-quoted HTML attribute. */
function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** Serialized HTML for a new empty property cell (I-bar / Turn into seed). */
export function propertyBlockHtml(type: PropertyTypeId, value = ''): string {
  const typeAttr = ` data-property-type="${type}"` // Which Property pane type this cell is
  const valueAttr = value ? ` data-value="${escapeAttr(value)}"` : '' // Omit when empty (placeholder)
  return `<div data-type="propertyBlock"${typeAttr}${valueAttr}></div>`
}

/** Property types in doc order (top strip icons follow this sequence). */
export function readPropertyBlockTypesFromDoc(doc: {
  descendants: (
    fn: (node: { type: { name: string }; attrs: Record<string, unknown> }) => boolean | void
  ) => void
}): PropertyTypeId[] {
  const types: PropertyTypeId[] = [] // First propertyBlock → first top icon
  doc.descendants((node) => {
    if (node.type.name !== 'propertyBlock') return true // Keep walking non-property blocks
    const t = node.attrs.propertyType
    if (isPropertyTypeId(t)) types.push(t) // Same order as blocks in the frame
    return false // Atom — nothing nested to visit
  })
  return types
}

/** Same list from persisted HTML (before the editor mounts). */
export function readPropertyBlockTypesFromHtml(html: string): PropertyTypeId[] {
  if (!html || !html.includes('propertyBlock')) return [] // Fast out
  const types: PropertyTypeId[] = []
  const re = /<div\b[^>]*data-type=["']propertyBlock["'][^>]*>/gi // Opening tag, any attr order
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const tm = m[0].match(/data-property-type=["']([^"']+)["']/) // Type on that same tag
    if (tm && isPropertyTypeId(tm[1])) types.push(tm[1])
  }
  return types
}

/** propertyBlock refs in document order (same sequence as the top icon row). */
export function collectPropertyBlocks(editor: Editor): EditorBlockRef[] {
  if (!editor || editor.isDestroyed) return [] // Unmounted — nothing to arm
  const refs: EditorBlockRef[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'propertyBlock') return true // Skip non-property blocks
    refs.push({ from: pos, to: pos + node.nodeSize, node, typeName: node.type.name })
    return false // Atom — don't walk inside
  })
  return refs
}

/** A block whose payload is a property type + optional cell value. */
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
        default: '', // Cell text; empty → NodeView shows Empty placeholder
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-value') || '',
        renderHTML: (attrs) => (attrs.value ? { 'data-value': attrs.value } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="propertyBlock"]' }] // Round-trips through message HTML
  },

  renderHTML({ HTMLAttributes }) {
    // data-* attrs carry the payload; NodeView paints the visible chrome
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'propertyBlock', class: 'tt-property-block' }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PropertyBlockView) // Icon + Empty cell
  },
})
