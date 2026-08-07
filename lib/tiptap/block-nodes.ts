// TipTap nodes for Notion-like Turn into types (callout, toggle, equation, synced, columns).

import { mergeAttributes, Node } from '@tiptap/core' // Custom block nodes

/** Callout — colored info box with block content inside. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout', class: 'tt-callout' }), 0]
  },
})

/** Toggle list — collapsible block (Notion toggle); click chrome to expand later. */
export const ToggleList = Node.create({
  name: 'toggleList',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-type="toggleList"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggleList', class: 'tt-toggle' }), 0]
  },
})

/** Toggle heading — toggle whose first line reads as h1–h4. */
export const ToggleHeading = Node.create({
  name: 'toggleHeading',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      level: {
        default: 1,
        parseHTML: (el) => Number((el as HTMLElement).getAttribute('data-level') || 1),
        renderHTML: (attrs) => ({ 'data-level': attrs.level }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="toggleHeading"]' }]
  },
  renderHTML({ HTMLAttributes, node }) {
    const level = Math.min(4, Math.max(1, Number(node.attrs.level) || 1))
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'toggleHeading',
        'data-level': level,
        class: `tt-toggle tt-toggle-heading-${level}`,
      }),
      0,
    ]
  },
})

/** Block equation — display math (plain text now; KaTeX later). */
export const BlockEquation = Node.create({
  name: 'blockEquation',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-type="blockEquation"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'blockEquation', class: 'tt-block-equation' }),
      0,
    ]
  },
})

/** Synced block — visual sync chrome; multi-instance sync later. */
export const SyncedBlock = Node.create({
  name: 'syncedBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-type="syncedBlock"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'syncedBlock', class: 'tt-synced-block' }),
      0,
    ]
  },
})

/** Column layout — N equal columns of block content. */
export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      count: {
        default: 2,
        parseHTML: (el) => Number((el as HTMLElement).getAttribute('data-columns') || 2),
        renderHTML: (attrs) => ({ 'data-columns': attrs.count }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }]
  },
  renderHTML({ HTMLAttributes, node }) {
    const count = Math.min(5, Math.max(2, Number(node.attrs.count) || 2))
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'columns',
        'data-columns': count,
        class: `tt-columns tt-columns-${count}`,
      }),
      0,
    ]
  },
})
