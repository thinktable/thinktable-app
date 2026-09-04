// Scoped Revert text for AI chat turns: frame / block / selection — never cross-silo.

import type { Editor } from '@tiptap/react'
import {
  DOMParser as PMDOMParser,
  DOMSerializer,
  type Node as PMNode,
} from '@tiptap/pm/model'
import {
  htmlForEditorRange,
  isHandleBlockType,
  type EditorBlockRef,
} from '@/lib/tiptap/block-selection'

/** Handle-blocks in doc order (listItem/taskItem are the unit — skip nested paragraphs). */
export function listHandleBlocks(doc: PMNode): Array<{ from: number; to: number; node: PMNode }> {
  const out: Array<{ from: number; to: number; node: PMNode }> = []
  doc.descendants((node, pos) => {
    const name = node.type.name
    if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') return true
    if (!isHandleBlockType(name)) return true
    out.push({ from: pos, to: pos + node.nodeSize, node })
    if (name === 'listItem' || name === 'taskItem') return false // Item is the grip unit
    return true
  })
  return out
}

/** Parse frozen original HTML with the live editor schema. */
export function parseOriginalDoc(editor: Editor, originalHtml: string): PMNode | null {
  if (!originalHtml.trim() || editor.isDestroyed) return null
  try {
    const el = document.createElement('div')
    el.innerHTML = originalHtml
    return PMDOMParser.fromSchema(editor.schema).parse(el)
  } catch {
    return null
  }
}

/** Serialize a doc slice to HTML with the editor schema. */
function sliceToHtml(editor: Editor, doc: PMNode, from: number, to: number): string {
  const ser = DOMSerializer.fromSchema(editor.schema)
  const div = document.createElement('div')
  div.appendChild(ser.serializeFragment(doc.slice(from, to).content))
  return div.innerHTML || ''
}

/** Soft-save payload after any scoped revert (keeps original* stamps). */
export function softSaveAfterRevert(
  editor: Editor,
  baseline: { content: string; html: string },
  meta: Record<string, unknown>
): { content: string; html: string; metadata: Record<string, unknown> } {
  const html = editor.getHTML()
  const content = editor.getText()
  return {
    content,
    html,
    metadata: {
      ...meta,
      html,
      originalContent: baseline.content,
      originalHtml: baseline.html,
    },
  }
}

/** Whole-turn dirty vs frozen original. */
export function frameDiffersFromOriginal(
  editor: Editor,
  baseline: { content: string; html: string }
): boolean {
  if (editor.isDestroyed) return false
  return editor.getText() !== baseline.content || editor.getHTML() !== baseline.html
}

/** Index of a handle-block among siblings (stable while that block’s from matches). */
function blockIndex(doc: PMNode, block: EditorBlockRef): number {
  return listHandleBlocks(doc).findIndex((c) => c.from === block.from && c.to === block.to)
}

/** Selected block(s) dirty vs same-index blocks in the original doc. */
export function blocksDifferFromOriginal(
  editor: Editor,
  originalHtml: string,
  blocks: EditorBlockRef[]
): boolean {
  if (!editor || editor.isDestroyed || blocks.length === 0) return false
  const originalDoc = parseOriginalDoc(editor, originalHtml)
  if (!originalDoc) return false
  const originalBlocks = listHandleBlocks(originalDoc)
  for (const b of blocks) {
    const idx = blockIndex(editor.state.doc, b)
    if (idx < 0) return true
    const orig = originalBlocks[idx]
    if (!orig) return true // Block added after send
    const curHtml = htmlForEditorRange(editor, b.from, b.to)
    const origHtml = sliceToHtml(editor, originalDoc, orig.from, orig.to) || '<p></p>'
    if (curHtml !== origHtml) return true
  }
  return false
}

/** Text selection dirty vs the same absolute range in the original doc. */
export function selectionDiffersFromOriginal(editor: Editor, originalHtml: string): boolean {
  if (!editor || editor.isDestroyed) return false
  const { from, to } = editor.state.selection
  if (from === to) return false
  const originalDoc = parseOriginalDoc(editor, originalHtml)
  if (!originalDoc) return false
  if (to > originalDoc.content.size) return true
  const cur = editor.state.doc.textBetween(from, to, '\n', '\n')
  const orig = originalDoc.textBetween(from, to, '\n', '\n')
  if (cur !== orig) return true
  const curHtml = sliceToHtml(editor, editor.state.doc, from, to)
  const origHtml = sliceToHtml(editor, originalDoc, from, to)
  return curHtml !== origHtml
}

/** Restore the entire turn body from the frozen original. */
export function revertFrameContent(editor: Editor, baseline: { content: string; html: string }): boolean {
  if (!editor || editor.isDestroyed) return false
  const html = baseline.html?.trim()
    ? baseline.html
    : `<p>${escapeText(baseline.content)}</p>`
  editor.commands.setContent(html, { emitUpdate: false })
  return true
}

/**
 * Restore only the given handle-blocks from same-index originals.
 * Snapshot indices first, then replace high→low so earlier ranges stay valid.
 */
export function revertBlockContents(
  editor: Editor,
  originalHtml: string,
  blocks: EditorBlockRef[]
): boolean {
  if (!editor || editor.isDestroyed || blocks.length === 0) return false
  const originalDoc = parseOriginalDoc(editor, originalHtml)
  if (!originalDoc) return false
  const originalBlocks = listHandleBlocks(originalDoc)
  // Capture index + live range before any mutation
  const jobs = blocks
    .map((b) => {
      const idx = blockIndex(editor.state.doc, b)
      return idx >= 0 && originalBlocks[idx] ? { idx, from: b.from, to: b.to } : null
    })
    .filter((j): j is { idx: number; from: number; to: number } => !!j)
    .sort((a, b) => b.from - a.from)

  if (jobs.length === 0) return false

  let changed = false
  for (const job of jobs) {
    const orig = originalBlocks[job.idx]
    if (!orig) continue
    // Re-read live block at this index after prior high-position replacements
    const live = listHandleBlocks(editor.state.doc)[job.idx]
    if (!live) continue
    const html = sliceToHtml(editor, originalDoc, orig.from, orig.to) || '<p></p>'
    editor.chain().focus().insertContentAt({ from: live.from, to: live.to }, html).run()
    changed = true
  }
  return changed
}

/** Restore only the current text selection from the same absolute range in the original. */
export function revertSelectionContent(editor: Editor, originalHtml: string): boolean {
  if (!editor || editor.isDestroyed) return false
  const { from, to } = editor.state.selection
  if (from === to) return false
  const originalDoc = parseOriginalDoc(editor, originalHtml)
  if (!originalDoc) return false

  if (from >= originalDoc.content.size) {
    editor.chain().focus().deleteRange({ from, to }).run()
    return true
  }

  const overlapTo = Math.min(to, originalDoc.content.size)
  const html = sliceToHtml(editor, originalDoc, from, overlapTo)
  editor.chain().focus().insertContentAt({ from, to }, html).run()
  return true
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
