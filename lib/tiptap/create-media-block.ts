// Factory for slash-command media atoms (video / audio / file / bookmark).

import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MediaBlockView } from '@/components/media-block-view'

export type MediaBlockKind = 'video' | 'audio' | 'file' | 'bookmark'

export interface MediaBlockOptions {
  HTMLAttributes: Record<string, unknown>
  kind: MediaBlockKind
  dataType: string
  className: string
}

function looksLikeUrl(text: string): boolean {
  const t = (text || '').trim()
  if (!t) return false
  try {
    const u = new URL(t)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** Shared atom block for slash Media picks (empty until src/url is set). */
export function createMediaBlock(opts: {
  name: string
  kind: MediaBlockKind
  dataType: string
  className: string
}) {
  return Node.create<MediaBlockOptions>({
    name: opts.name,
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false,

    addOptions() {
      return {
        HTMLAttributes: {},
        kind: opts.kind,
        dataType: opts.dataType,
        className: opts.className,
      }
    },

    addAttributes() {
      return {
        src: {
          default: null,
          parseHTML: (el) => (el as HTMLElement).getAttribute('data-src') || null,
          renderHTML: (attrs) => (attrs.src ? { 'data-src': attrs.src } : {}),
        },
        name: {
          default: '',
          parseHTML: (el) => (el as HTMLElement).getAttribute('data-name') || '',
          renderHTML: (attrs) => (attrs.name ? { 'data-name': attrs.name } : {}),
        },
        title: {
          default: '',
          parseHTML: (el) => (el as HTMLElement).getAttribute('data-title') || '',
          renderHTML: (attrs) => (attrs.title ? { 'data-title': attrs.title } : {}),
        },
      }
    },

    parseHTML() {
      return [{ tag: `div[data-type="${opts.dataType}"]` }]
    },

    renderHTML({ HTMLAttributes }) {
      return [
        'div',
        mergeAttributes(HTMLAttributes, {
          'data-type': opts.dataType,
          class: opts.className,
        }),
      ]
    },

    addNodeView() {
      return ReactNodeViewRenderer(MediaBlockView)
    },
  })
}

export { looksLikeUrl as looksLikeMediaUrl }
