// TipTap **block** helpers (paragraph / heading / list item — not the **frame**). See DEFINITIONS.md.

import type { Editor, JSONContent } from '@tiptap/react'
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model' // Slice → HTML; PM node type
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { BlockTypeId } from '@/components/block-actions-menu'
import { looksLikeImageSrc } from '@/lib/tiptap/image-block'
import type { PropertyTypeId } from '@/lib/blocks/property' // Turn into → Property cell

const editorsByHostId = new Map<string, Editor>() // host **frame** RF id → TipTap editor (⋮⋮ drop targets)

/** Register this frame’s editor so ⋮⋮ block-drag can drop into it. */
export function registerHostEditor(hostNodeId: string, editor: Editor) {
  editorsByHostId.set(hostNodeId, editor) // Latest editor for this frame
}

/** Drop registration when the handles unmount or the editor is replaced. */
export function unregisterHostEditor(hostNodeId: string, editor: Editor) {
  if (editorsByHostId.get(hostNodeId) === editor) editorsByHostId.delete(hostNodeId)
}

/** Editor for a map-card RF node, if still mounted. */
export function editorForHostNode(hostNodeId: string): Editor | null {
  const editor = editorsByHostId.get(hostNodeId)
  return editor && !editor.isDestroyed ? editor : null
}

/** Frame + editor under the pointer (skips ⋮⋮ drag chrome). */
export function findHostEditorAtPoint(
  clientX: number,
  clientY: number,
  skipHostNodeId?: string // Ignore this frame (e.g. the one being RF-dragged)
): { hostNodeId: string; editor: Editor } | null {
  const els = document.elementsFromPoint(clientX, clientY) // Topmost → bottom
  for (const el of els) {
    if (!(el instanceof HTMLElement)) continue
    if (el.closest('[data-tt-block-drag-ghost], [data-tt-drop-line]')) continue // Ignore drag overlays
    if (el.closest('[data-tt-frame-drop-overlay]')) continue // Ignore stack drop chrome
    const node = el.closest('.react-flow__node') as HTMLElement | null
    const id = node?.getAttribute('data-id')
    if (!id || id === skipHostNodeId) continue
    const editor = editorForHostNode(id)
    if (editor) return { hostNodeId: id, editor }
  }
  return null
}

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
    name === 'columns' ||
    name === 'boardLink' || // Linked-page block (inline/title) gets the ⋮⋮ grip too
    name === 'databaseBlock' || // Notion database block gets the ⋮⋮ grip too
    name === 'imageBlock' || // Image (placeholder or <img>) gets the ⋮⋮ grip too
    name === 'videoBlock' ||
    name === 'audioBlock' ||
    name === 'fileBlock' ||
    name === 'bookmarkBlock' ||
    name === 'propertyBlock' // Property cell (icon + Empty) gets the ⋮⋮ grip too
  )
}

/** Screen Y band for a handle-block — prefer the block’s own DOM rect. */
function blockScreenYBand(
  editor: Editor,
  node: PMNode,
  pos: number
): { top: number; bottom: number } | null {
  try {
    const dom = editor.view.nodeDOM(pos)
    // Prefer the content element for a reliable painted band
    let el: HTMLElement | null =
      dom instanceof HTMLElement
        ? dom
        : dom?.parentElement instanceof HTMLElement
          ? dom.parentElement
          : null
    if (el) {
      if (
        el.classList.contains('tt-property-block-header-only') ||
        el.getAttribute('data-header-only') === 'true'
      ) {
        return null // Top-strip only — no inline band to hover
      }
      const rect = el.getBoundingClientRect()
      if (rect.height > 0) return { top: rect.top, bottom: rect.bottom }
    }
    if (node.isAtom || node.isLeaf) return null
    const start = editor.view.coordsAtPos(pos + 1)
    const endPos = Math.max(pos + 1, pos + node.nodeSize - 1)
    const end = editor.view.coordsAtPos(endPos)
    return { top: start.top, bottom: Math.max(start.bottom, end.bottom) }
  } catch {
    return null
  }
}

/**
 * Resolve the content block whose vertical band contains clientY (any X — full frame width).
 * Prefers listItem/taskItem; otherwise the **tightest** matching block DOM rect.
 */
export function findEditorBlockAtClientY(editor: Editor, clientY: number): EditorBlockRef | null {
  const { doc } = editor.state
  // Holder object, not a `let`: TS narrows a captured `let` to its initializer and can't see the
  // assignment inside `descendants`, which typed the winner as `never` at the return below.
  const best: { top: { ref: EditorBlockRef; height: number } | null } = { top: null }

  doc.descendants((node, pos) => {
    const name = node.type.name
    if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') return true
    if (!isHandleBlockType(name)) return true

    const band = blockScreenYBand(editor, node, pos)
    if (!band) return true
    const { top, bottom } = band
    if (clientY < top || clientY > bottom) {
      return name !== 'listItem' && name !== 'taskItem'
    }
    const height = Math.max(1, bottom - top)
    const ref: EditorBlockRef = { from: pos, to: pos + node.nodeSize, node, typeName: name }
    const prefer =
      !best.top ||
      name === 'listItem' ||
      name === 'taskItem' ||
      (best.top.ref.typeName !== 'listItem' &&
        best.top.ref.typeName !== 'taskItem' &&
        height < best.top.height) // Strictly tighter — equal height keeps earlier (doc order)
    if (prefer) best.top = { ref, height }

    if (name === 'listItem' || name === 'taskItem') return false
    return true
  })

  return best.top?.ref ?? null
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

  // Nearest handle-block ancestor
  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d)
    if (isHandleBlockType(node.type.name) || node.isBlock) {
      return {
        from: $pos.before(d),
        to: $pos.after(d),
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
  if (typeName === 'imageBlock') return 'image'
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
        const meta = tr.getMeta(highlightKey) as
          | { from: number; to: number }
          | { ranges: { from: number; to: number }[] }
          | 'clear'
          | undefined
        if (meta === 'clear') return DecorationSet.empty
        // Multi-range wash (in-frame multi-block selection)
        if (meta && 'ranges' in meta) {
          if (meta.ranges.length === 0) return DecorationSet.empty
          return DecorationSet.create(
            tr.doc,
            meta.ranges.map((r) => Decoration.node(r.from, r.to, { class: 'tt-block-highlight' }))
          )
        }
        if (meta && 'from' in meta && typeof meta.from === 'number') {
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

/** Paint a Notion wash across several block ranges at once (in-frame multi-block selection). */
export function setEditorBlockHighlightRanges(
  editor: Editor,
  ranges: { from: number; to: number }[]
) {
  if (!editor || editor.isDestroyed) return
  const tr = editor.state.tr
  tr.setMeta(highlightKey, ranges.length ? { ranges } : 'clear')
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
  const { from, to, typeName } = block

  // Atom image has no inner caret — unwrap to a paragraph, then apply the target type
  if (typeName === 'imageBlock' && blockType !== 'image') {
    const src = (block.node.attrs.src as string | null) || ''
    const seed = src && !src.startsWith('data:') ? src : '' // Don't dump data URLs into a paragraph
    editor
      .chain()
      .focus()
      .deleteRange({ from, to })
      .insertContentAt(from, {
        type: 'paragraph',
        content: seed ? [{ type: 'text', text: seed }] : [],
      } as JSONContent)
      .run()
    const next = findEditorBlockAtPos(editor, from + 1)
    if (!next) return true
    return turnEditorBlockInto(editor, next, blockType)
  }

  // Property cell is an atom — unwrap the value (if any) then apply the target type
  if (typeName === 'propertyBlock') {
    const seed = String(block.node.attrs.value || '').trim() // Empty cell → blank paragraph
    editor
      .chain()
      .focus()
      .deleteRange({ from, to })
      .insertContentAt(from, {
        type: 'paragraph',
        content: seed ? [{ type: 'text', text: seed }] : [],
      } as JSONContent)
      .run()
    const next = findEditorBlockAtPos(editor, from + 1)
    if (!next) return true
    return turnEditorBlockInto(editor, next, blockType)
  }

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
    case 'image': {
      clearLists()
      // If this block is already an image, keep it (image menu lives on the NodeView)
      if (typeName === 'imageBlock') return true
      const text = editor.state.doc.textBetween(from, to, '\n').trim()
      const src = looksLikeImageSrc(text) ? text : null // URL-only blocks become the image src
      return editor
        .chain()
        .focus()
        .deleteRange({ from, to })
        .insertContentAt(from, {
          type: 'imageBlock',
          attrs: { src, alt: '' },
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
    case 'board':
    case 'boardIn':
      // Handled by board-flow promote (map-card level) — leave editor content
      return false
    default:
      return false
  }
}

/**
 * Replace the selected editor **block** with a property cell (type icon + Empty box).
 * Frame-top property chrome is stamped separately via metadata.propertyType.
 */
export function turnEditorBlockIntoProperty(
  editor: Editor,
  block: EditorBlockRef,
  propertyType: PropertyTypeId
): boolean {
  if (!editor || editor.isDestroyed) return false // Unmounted editor — nothing to convert
  const { from, to, typeName, node } = block
  // Already a property cell — switch type; mark inline so it stays in the body when empty
  if (typeName === 'propertyBlock') {
    return editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setNodeMarkup(from, undefined, { ...node.attrs, propertyType, inline: true })
        return true
      })
      .run()
  }
  // Replace this block with an empty **inline** property cell (user Turn into — stay in body)
  return editor
    .chain()
    .focus()
    .deleteRange({ from, to })
    .insertContentAt(from, {
      type: 'propertyBlock',
      attrs: { propertyType, value: '', inline: true },
    } as JSONContent)
    .run()
}

/** HTML for a content-block range (extract onto the map as its own card). */
export function htmlForEditorRange(editor: Editor, from: number, to: number): string {
  const slice = editor.state.doc.slice(from, to) // Block slice (from inclusive, to exclusive)
  const serializer = DOMSerializer.fromSchema(editor.schema) // Schema-aware HTML
  const div = document.createElement('div') // Off-DOM target
  div.appendChild(serializer.serializeFragment(slice.content))
  return div.innerHTML || '<p></p>'
}

/** Wrap a list-item slice so it can insert at doc / list boundaries. */
export function wrapJsonForInsert(editor: Editor, block: EditorBlockRef, json: JSONContent[]): JSONContent[] {
  if (json.length === 0) return json
  const first = json[0]
  if (first && typeof first === 'object' && (first.type === 'listItem' || first.type === 'taskItem')) {
    try {
      const $from = editor.state.doc.resolve(block.from) // Parent list type at source
      const parentName = $from.node(-1)?.type.name
      const listType =
        parentName === 'orderedList' || parentName === 'taskList' || parentName === 'bulletList'
          ? parentName
          : first.type === 'taskItem'
            ? 'taskList'
            : 'bulletList'
      return [{ type: listType, content: json }] // Valid top-level list
    } catch {
      return [{ type: first.type === 'taskItem' ? 'taskList' : 'bulletList', content: json }]
    }
  }
  return json
}

/** JSON nodes for inserting a content-block range into another editor. */
export function jsonForEditorRange(editor: Editor, from: number, to: number): JSONContent[] {
  const json = editor.state.doc.slice(from, to).content.toJSON() // Fragment → child JSON
  return Array.isArray(json) ? json : json ? [json] : []
}

/** Screen Y + insert pos for a dashed drop line (before/after the block under clientY). */
export function findContentBlockDropTarget(
  editor: Editor,
  clientY: number
): { insertPos: number; lineTop: number; lineLeft: number; lineWidth: number } | null {
  const { doc } = editor.state
  const blocks: { from: number; to: number; top: number; bottom: number; left: number; width: number }[] = []
  doc.descendants((node, pos) => {
    const name = node.type.name
    if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') return true
    if (!isHandleBlockType(name)) return true
    try {
      const start = editor.view.coordsAtPos(pos + 1)
      const endPos = Math.max(pos + 1, pos + node.nodeSize - 1)
      const end = editor.view.coordsAtPos(endPos)
      const el = editor.view.nodeDOM(pos)
      const rect = el instanceof HTMLElement ? el.getBoundingClientRect() : null
      blocks.push({
        from: pos,
        to: pos + node.nodeSize,
        top: start.top,
        bottom: Math.max(start.bottom, end.bottom),
        left: rect?.left ?? start.left,
        width: rect?.width ?? Math.max(40, (start.right || start.left + 120) - start.left),
      })
    } catch {
      // skip
    }
    if (name === 'listItem' || name === 'taskItem') return false
    return true
  })
  if (blocks.length === 0) return null
  const first = blocks[0]
  const last = blocks[blocks.length - 1]
  if (clientY < first.top) {
    return { insertPos: first.from, lineTop: first.top, lineLeft: first.left, lineWidth: first.width }
  }
  if (clientY > last.bottom) {
    return { insertPos: last.to, lineTop: last.bottom, lineLeft: last.left, lineWidth: last.width }
  }
  for (const b of blocks) {
    if (clientY < b.top || clientY > b.bottom) continue
    const mid = (b.top + b.bottom) / 2
    if (clientY <= mid) {
      return { insertPos: b.from, lineTop: b.top, lineLeft: b.left, lineWidth: b.width } // Drop above this block
    }
    return { insertPos: b.to, lineTop: b.bottom, lineLeft: b.left, lineWidth: b.width } // Drop below
  }
  return { insertPos: last.to, lineTop: last.bottom, lineLeft: last.left, lineWidth: last.width }
}

/** Move a content block to insertPos in the same editor (no-op if it wouldn’t change order). */
export function moveEditorBlockToPos(editor: Editor, from: number, to: number, insertPos: number): boolean {
  if (insertPos === from || insertPos === to) return false // Already there
  if (insertPos > from && insertPos < to) return false // Inside itself
  const json = jsonForEditorRange(editor, from, to)
  if (json.length === 0) return false
  let mapped = insertPos
  if (insertPos > to) mapped = insertPos - (to - from) // Delete first, then insert
  // List items stay unwrapped inside a list; wrap if the drop is at doc level
  let payload: JSONContent[] = json
  try {
    const $ins = editor.state.doc.resolve(Math.min(insertPos, editor.state.doc.content.size))
    const inList = $ins.parent.type.name === 'bulletList' || $ins.parent.type.name === 'orderedList' || $ins.parent.type.name === 'taskList'
    if (!inList && json[0] && (json[0].type === 'listItem' || json[0].type === 'taskItem')) {
      payload = wrapJsonForInsert(editor, { from, to, node: editor.state.doc.nodeAt(from)!, typeName: json[0].type || 'listItem' }, json)
    }
  } catch {
    // keep unwrapped
  }
  return editor.chain().focus().deleteRange({ from, to }).insertContentAt(mapped, payload).run()
}

/** Delete a content-block range; leave an empty paragraph if the doc would be empty. */
export function deleteEditorBlockRange(editor: Editor, from: number, to: number): boolean {
  const ok = editor.chain().focus().deleteRange({ from, to }).run()
  if (!ok) return false
  if (editor.state.doc.content.size <= 2) {
    editor.commands.setContent('<p></p>') // PM docs need at least one block
  }
  return true
}
