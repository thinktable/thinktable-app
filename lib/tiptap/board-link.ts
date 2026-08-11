// boardLink — a block that links to a child **board** (Notion-style child link). See DEFINITIONS.md.
// Two variants: 'inline' (board/emoji icon LEFT of the link text) and 'title' (icon on TOP, left-aligned).
// Serialized into the frame message HTML via data-* attrs so it survives reload.
// Dual-read: still parses legacy data-type="pageLink" / data-page-id from older messages.

import { mergeAttributes, Node } from '@tiptap/core' // Custom block node
import { ReactNodeViewRenderer } from '@tiptap/react' // React NodeView for icon + preview chrome
import { BoardLinkView } from '@/components/board-link-view' // The rendered chrome

export interface BoardLinkOptions {
  HTMLAttributes: Record<string, unknown> // Passthrough HTML attrs for mergeAttributes
}

/** A block whose payload is a link to a child board (boardId + title + optional emoji icon). */
export const BoardLink = Node.create<BoardLinkOptions>({
  name: 'boardLink', // Node type id used by turn-into + parsing
  group: 'block', // Behaves as its own block/line in the doc
  atom: true, // No inline editable content — title lives in an attribute
  selectable: true, // Can be selected/deleted like any block
  draggable: false, // Frame/⋮⋮ own dragging; the node itself doesn't drag

  addOptions() {
    return { HTMLAttributes: {} } // Default empty passthrough
  },

  addAttributes() {
    return {
      boardId: {
        default: null, // Child conversation id this block links to
        // Prefer new attr; fall back to legacy data-page-id so old HTML still loads
        parseHTML: (el) =>
          (el as HTMLElement).getAttribute('data-board-id') ||
          (el as HTMLElement).getAttribute('data-page-id'),
        renderHTML: (attrs) => (attrs.boardId ? { 'data-board-id': attrs.boardId } : {}),
      },
      title: {
        default: '', // Display label (mirrors the linked board title)
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-title') || '',
        renderHTML: (attrs) => ({ 'data-title': attrs.title || '' }),
      },
      icon: {
        default: null, // Emoji string (else default board icon)
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
    // Accept both new boardLink and legacy pageLink tags from persisted messages
    return [{ tag: 'div[data-type="boardLink"]' }, { tag: 'div[data-type="pageLink"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    // Writers emit boardLink only; NodeView paints the visible chrome
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'boardLink', class: 'tt-board-link' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(BoardLinkView) // Icon + link text + hover-overlap preview button
  },
})
