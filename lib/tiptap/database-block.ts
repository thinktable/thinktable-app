// databaseBlock — a TipTap **block** that represents a Notion database (compact, not a map frame).
// Keeps DB content from sprawling as separate frames when a Notion page is imported.
// Serialized into the frame message HTML via data-* attrs so it survives reload.

import { mergeAttributes, Node } from '@tiptap/core' // Custom block node
import { ReactNodeViewRenderer } from '@tiptap/react' // React NodeView for icon + title chrome
import { DatabaseBlockView } from '@/components/database-block-view' // The rendered chrome

export interface DatabaseBlockOptions {
  HTMLAttributes: Record<string, unknown>
}

/** A block whose payload is a Notion database (id + title + optional icon/url). */
export const DatabaseBlock = Node.create<DatabaseBlockOptions>({
  name: 'databaseBlock', // Node type id used by import HTML + ⋮⋮ grip
  group: 'block', // Behaves as its own block/line in the doc
  atom: true, // No inline editable content — title lives in an attribute
  selectable: true, // Can be selected/deleted like any block
  draggable: false, // Frame/⋮⋮ own dragging; the node itself doesn't drag

  addOptions() {
    return { HTMLAttributes: {} }
  },

  addAttributes() {
    return {
      notionDatabaseId: {
        default: null, // Notion database UUID this block represents
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-notion-database-id'),
        renderHTML: (attrs) =>
          attrs.notionDatabaseId ? { 'data-notion-database-id': attrs.notionDatabaseId } : {},
      },
      title: {
        default: 'Untitled database', // Display label (mirrors the Notion DB title)
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-title') || 'Untitled database',
        renderHTML: (attrs) => ({ 'data-title': attrs.title || 'Untitled database' }),
      },
      icon: {
        default: null, // Emoji string when Notion DB has an emoji icon
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-icon') || null,
        renderHTML: (attrs) => (attrs.icon ? { 'data-icon': attrs.icon } : {}),
      },
      url: {
        default: null, // Open-in-Notion deep link when available
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-url') || null,
        renderHTML: (attrs) => (attrs.url ? { 'data-url': attrs.url } : {}),
      },
      viewSettings: {
        default: null, // JSON DatabaseViewSettings (Thinktable-owned view config)
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-view-settings') || null,
        renderHTML: (attrs) =>
          attrs.viewSettings ? { 'data-view-settings': attrs.viewSettings } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="databaseBlock"]' }] // Round-trips through message HTML
  },

  renderHTML({ HTMLAttributes }) {
    // data-* attrs carry the DB payload; NodeView paints the visible chrome
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'databaseBlock', class: 'tt-database-block' }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(DatabaseBlockView) // Table icon + title + optional Notion open
  },
})
