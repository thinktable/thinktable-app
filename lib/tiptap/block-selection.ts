// TipTap helpers — resolve a Notion-like content block under a position (list item or top-level node).

import type { Editor, JSONContent } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { BlockTypeId } from '@/components/block-actions-menu'

export type EditorBlockRef = {
  from: number // Inclusive start in doc
  to: number // Exclusive end in doc
  node: PMNode
  typeName: string
}

const highlightKey = new PluginKey('blockHighlight')

/** True for nodes that act as Notion “blocks” (handles attach here). */
export function isHandleBlockType(name: string): boolean {
  return (
    name === 'paragraph' ||
    name === 'heading' ||
    name === 'listItem' ||
    name === 'taskItem' ||
    name === 'blockquote' ||
    name === 'codeBlock' ||
    name === 'callout' ||
    name === 'toggleList' ||
    name === 'toggleHeading' ||
    name === 'blockEquation' ||
    name === 'syncedBlock' ||
    name === 'columns'
  )
}

/**
 * Resolve the content block whose vertical band contains clientY (any X — full frame width).
 * Prefers listItem/taskItem over inner paragraphs; otherwise the tightest matching block.
 */
export function findEditorBlockAtClientY(editor: Editor, clientY: number): EditorBlockRef | null {
  const { doc } = editor.state
  let best: { ref: EditorBlockRef; height: number } | null = null

  doc.descendants((node, pos) => {
    const name = node.type.name
    // Descend into lists so each item is its own handle target
    if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') return true
    if (!isHandleBlockType(name)) return true

    try {
      const start = editor.view.coordsAtPos(pos + 1) // Top of block
      const endPos = Math.max(pos + 1, pos + node.nodeSize - 1)
      const end = editor.view.coordsAtPos(endPos) // Bottom of block
      const top = start.top
      const bottom = Math.max(start.bottom, end.bottom)
      if (clientY < top || clientY > bottom) {
        // Skip children of list items — the item itself is the handle unit
        return name !== 'listItem' && name !== 'taskItem'
      }
      const height = Math.max(1, bottom - top)
      const ref: EditorBlockRef = { from: pos, to: pos + node.nodeSize, node, typeName: name }
      // Prefer list/task items; else prefer the tighter (more nested) match
      const prefer =
        !best ||
        name === 'listItem' ||
        name === 'taskItem' ||
        (best.ref.typeName !== 'listItem' &&
          best.ref.typeName !== 'taskItem' &&
          height <= best.height)
      if (prefer) best = { ref, height }
    } catch {
      // coordsAtPos can throw for odd positions — skip
    }

    // Don’t treat nested paragraphs inside a list item as separate handles
    if (name === 'listItem' || name === 'taskItem') return false
    return true
  })

  return best?.ref ?? null
}

/** Resolve the content block for a document position (prefer list/task item over the list). */
export function findEditorBlockAtPos(editor: Editor, pos: number): EditorBlockRef | null {
  const { doc } = editor.state
  if (pos < 0 || pos > doc.content.size) return null
  const $pos = doc.resolve(Math.min(pos, doc.content.size))

  // Prefer listItem / taskItem (each bullet is its own block in Notion)
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d)
    if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
      return {
        from: $pos.before(d),
        to: $pos.after(d),
        node,
        typeName: node.type.name,
      }
    }
  }

  // Top-level doc child (depth 1)
  if ($pos.depth >= 1) {
    const node = $pos.node(1)
    if (isHandleBlockType(node.type.name) || node.isBlock) {
      return {
        from: $pos.before(1),
        to: $pos.after(1),
        node,
        typeName: node.type.name,
      }
    }
  }

  return null
}

/** Map TipTap node → menu BlockTypeId for checkmark. */
export function editorBlockToTypeId(block: EditorBlockRef): BlockTypeId {
  const { node, typeName } = block
  if (typeName === 'heading') {
    const level = Number(node.attrs.level) || 1
    return (`heading${Math.min(4, level)}` as BlockTypeId)
  }
  if (typeName === 'paragraph') return 'text'
  if (typeName === 'listItem') {
    // Parent list kind
    return 'bulletedList' // refined by caller with parent check
  }
  if (typeName === 'taskItem') return 'todoList'
  if (typeName === 'blockquote') return 'quote'
  if (typeName === 'codeBlock') return 'code'
  if (typeName === 'callout') return 'callout'
  if (typeName === 'toggleList') return 'toggleList'
  if (typeName === 'toggleHeading') {
    const level = Number(node.attrs.level) || 1
    return (`toggleHeading${Math.min(4, level)}` as BlockTypeId)
  }
  if (typeName === 'blockEquation') return 'blockEquation'
  if (typeName === 'syncedBlock') return 'syncedBlock'
  if (typeName === 'columns') {
    const count = Number(node.attrs.count) || 2
    return (`columns${Math.min(5, Math.max(2, count))}` as BlockTypeId)
  }
  return 'text'
}

/** Refine listItem type using parent bulletList vs orderedList. */
export function refineListBlockType(editor: Editor, block: EditorBlockRef): BlockTypeId {
  if (block.typeName !== 'listItem') return editorBlockToTypeId(block)
  const $from = editor.state.doc.resolve(block.from + 1)
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name
    if (name === 'bulletList') return 'bulletedList'
    if (name === 'orderedList') return 'numberedList'
  }
  return 'bulletedList'
}

/** Plugin that paints a Notion-style blue wash on [from, to). */
export function createBlockHighlightPlugin() {
  return new Plugin({
    key: highlightKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        const meta = tr.getMeta(highlightKey) as { from: number; to: number } | 'clear' | undefined
        if (meta === 'clear') return DecorationSet.empty
        if (meta && typeof meta.from === 'number') {
          // Node decoration paints the whole list item / paragraph (Notion wash)
          return DecorationSet.create(tr.doc, [
            Decoration.node(meta.from, meta.to, { class: 'tt-block-highlight' }),
          ])
        }
        return old.map(tr.mapping, tr.doc)
      },
    },
    props: {
      decorations(state) {
        return highlightKey.getState(state)
      },
    },
  })
}

/** Set or clear the active block highlight decoration. */
export function setEditorBlockHighlight(
  editor: Editor,
  range: { from: number; to: number } | null
) {
  if (!editor || editor.isDestroyed) return
  const tr = editor.state.tr
  if (!range) {
    tr.setMeta(highlightKey, 'clear')
  } else {
    tr.setMeta(highlightKey, range)
  }
  editor.view.dispatch(tr)
}

/**
 * Turn the selected editor block into a Notion-like type (TipTap commands).
 * Selects the block range first so list/heading transforms apply correctly.
 */
export function turnEditorBlockInto(
  editor: Editor,
  block: EditorBlockRef,
  blockType: BlockTypeId
): boolean {
  if (!editor || editor.isDestroyed) return false
  const { from, to } = block
  editor.chain().focus().setTextSelection({ from: from + 1, to: Math.max(from + 1, to - 1) }).run()

  const clearLists = () => {
    editor.chain().focus().liftListItem('listItem').run()
    editor.chain().focus().liftListItem('taskItem').run()
  }

  switch (blockType) {
    case 'text':
      clearLists()
      return editor.chain().focus().setParagraph().run()
    case 'heading1':
      clearLists()
      return editor.chain().focus().setHeading({ level: 1 }).run()
    case 'heading2':
      clearLists()
      return editor.chain().focus().setHeading({ level: 2 }).run()
    case 'heading3':
      clearLists()
      return editor.chain().focus().setHeading({ level: 3 }).run()
    case 'heading4':
      clearLists()
      return editor.chain().focus().setHeading({ level: 4 }).run()
    case 'bulletedList':
      return editor.chain().focus().toggleBulletList().run()
    case 'numberedList':
      return editor.chain().focus().toggleOrderedList().run()
    case 'todoList':
      return editor.chain().focus().toggleTaskList().run()
    case 'code':
      clearLists()
      return editor.chain().focus().toggleCodeBlock().run()
    case 'quote':
      clearLists()
      return editor.chain().focus().toggleBlockquote().run()
    case 'callout': {
      clearLists()
      const text = editor.state.doc.textBetween(from, to, '\n')
      return editor
        .chain()
        .focus()
        .deleteRange({ from, to })
        .insertContentAt(from, {
          type: 'callout',
          content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
        } as JSONContent)
        .run()
    }
    case 'toggleList': {
      clearLists()
      const text = editor.state.doc.textBetween(from, to, '\n')
      return editor
        .chain()
        .focus()
        .deleteRange({ from, to })
        .insertContentAt(from, {
          type: 'toggleList',
          content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
        } as JSONContent)
        .run()
    }
    case 'toggleHeading1':
    case 'toggleHeading2':
    case 'toggleHeading3':
    case 'toggleHeading4': {
      clearLists()
      const level = Number(blockType.replace('toggleHeading', '')) || 1
      const text = editor.state.doc.textBetween(from, to, '\n')
      return editor
        .chain()
        .focus()
        .deleteRange({ from, to })
        .insertContentAt(from, {
          type: 'toggleHeading',
          attrs: { level },
          content: [
            {
              type: 'heading',
              attrs: { level },
              content: text ? [{ type: 'text', text }] : [],
            },
          ],
        } as JSONContent)
        .run()
    }
    case 'blockEquation': {
      clearLists()
      const text = editor.state.doc.textBetween(from, to, '\n') || 'E = mc^2'
      return editor
        .chain()
        .focus()
        .deleteRange({ from, to })
        .insertContentAt(from, {
          type: 'blockEquation',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        } as JSONContent)
        .run()
    }
    case 'syncedBlock': {
      clearLists()
      const text = editor.state.doc.textBetween(from, to, '\n')
      return editor
        .chain()
        .focus()
        .deleteRange({ from, to })
        .insertContentAt(from, {
          type: 'syncedBlock',
          content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
        } as JSONContent)
        .run()
    }
    case 'columns2':
    case 'columns3':
    case 'columns4':
    case 'columns5': {
      clearLists()
      const count = Number(blockType.replace('columns', '')) || 2
      const text = editor.state.doc.textBetween(from, to, '\n')
      const lines = text.split('\n').filter(Boolean)
      const cols: string[][] = Array.from({ length: count }, () => [])
      lines.forEach((line, i) => cols[i % count].push(line))
      const content = cols.map((colLines) => ({
        type: 'paragraph',
        content: colLines.length
          ? [{ type: 'text', text: colLines.join('\n') }]
          : [],
      }))
      return editor
        .chain()
        .focus()
        .deleteRange({ from, to })
        .insertContentAt(from, {
          type: 'columns',
          attrs: { count },
          content,
        } as JSONContent)
        .run()
    }
    case 'page':
    case 'pageIn':
      // Handled by board-flow promote (map-card level) — leave editor content
      return false
    default:
      return false
  }
}
