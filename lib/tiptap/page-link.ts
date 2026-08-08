// pageLink — a block that links to a child **page** (Notion child-page block). See DEFINITIONS.md.
// Two variants: 'inline' (page/emoji icon LEFT of the link text) and 'title' (icon on TOP, left-aligned).
// Serialized into the frame message HTML via data-* attrs so it survives reload.

import { mergeAttributes, Node } from '@tiptap/core' // Custom block node
import { ReactNodeViewRenderer } from '@tiptap/react' // React NodeView for icon + preview chrome
import { PageLinkView } from '@/components/page-link-view' // The rendered chrome

export interface PageLinkOptions {
  HTMLAttributes: Record<string, unknown>
}

/** A block whose payload is a link to a child page (pageId + title + optional emoji icon). */
export const PageLink = Node.create<PageLinkOptions>({
  name: 'pageLink', // Node type id used by turn-into + parsing
  group: 'block', // Behaves as its own block/line in the doc
  atom: true, // No inline editable content — title lives in an attribute
  selectable: true, // Can be selected/deleted like any block
  draggable: false, // Frame/⋮⋮ own dragging; the node itself doesn't drag

  addOptions() {
    return { HTMLAttributes: {} }
  },

  addAttributes() {
    return {
      pageId: {
        default: null, // Child conversation id this block links to
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-page-id'),
        renderHTML: (attrs) => (attrs.pageId ? { 'data-page-id': attrs.pageId } : {}),
      },
      title: {
        default: '', // Display label (mirrors the linked page title)
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-title') || '',
        renderHTML: (attrs) => ({ 'data-title': attrs.title || '' }),
      },
      icon: {
        default: null, // Emoji string (else default page icon)
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-icon') || null,
        renderHTML: (attrs) => (attrs.icon ? { 'data-icon': attrs.icon } : {}),
      },
      variant: {
        default: 'inline', // 'inline' (icon left) | 'title' (icon on top)
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-variant') || 'inline',
        renderHTML: (attrs) => ({ 'data-variant': attrs.variant || 'inline' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="pageLink"]' }] // Round-trips through message HTML
  },

  renderHTML({ HTMLAttributes }) {
    // data-* attrs carry the link payload; NodeView paints the visible chrome
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'pageLink', class: 'tt-page-link' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageLinkView) // Icon + link text + hover-overlap preview button
  },
})
