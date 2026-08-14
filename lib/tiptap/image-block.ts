// imageBlock — a TipTap **block** for an image (Turn into → Image).
// Atom like boardLink: no inner text; src/alt live in attrs and round-trip via data-*.
// Empty src renders an Upload / Embed placeholder (NodeView).

import { mergeAttributes, Node } from '@tiptap/core' // Custom block node
import { ReactNodeViewRenderer } from '@tiptap/react' // React NodeView for placeholder + <img>
import { ImageBlockView } from '@/components/image-block-view' // The rendered chrome

export interface ImageBlockOptions {
  HTMLAttributes: Record<string, unknown> // Passthrough HTML attrs for mergeAttributes
}

/** True when text can be used as an image src (http(s) or data:image). */
export function looksLikeImageSrc(text: string): boolean {
  const t = (text || '').trim() // Ignore surrounding whitespace from the source block
  if (!t) return false // Empty block → placeholder, not a broken img
  if (t.startsWith('data:image/')) return true // Inline data URLs from local upload
  try {
    const u = new URL(t) // Reject non-URLs (plain sentences)
    return u.protocol === 'http:' || u.protocol === 'https:' // Embed only web URLs
  } catch {
    return false // Not a URL
  }
}

/** A block whose payload is an image URL (or empty until the user adds one). */
export const ImageBlock = Node.create<ImageBlockOptions>({
  name: 'imageBlock', // Node type id used by Turn into + ⋮⋮ grip
  group: 'block', // Own line in the doc
  atom: true, // No inline editable content — src lives in an attribute
  selectable: true, // Can be selected/deleted like any block
  draggable: false, // Frame/⋮⋮ own dragging; the node itself doesn't drag

  addOptions() {
    return { HTMLAttributes: {} } // Default empty passthrough
  },

  addAttributes() {
    return {
      src: {
        default: null, // Image URL or data: URL; null = empty placeholder
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-src') || null,
        renderHTML: (attrs) => (attrs.src ? { 'data-src': attrs.src } : {}),
      },
      alt: {
        default: '', // Accessible label (optional)
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-alt') || '',
        renderHTML: (attrs) => (attrs.alt ? { 'data-alt': attrs.alt } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="imageBlock"]' }] // Round-trips through message HTML
  },

  renderHTML({ HTMLAttributes }) {
    // data-* attrs carry the payload; NodeView paints the visible chrome
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'imageBlock', class: 'tt-image-block' }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageBlockView) // Placeholder or <img>
  },
})
