// Empty TipTap block keys: Backspace removes the block; Enter does not spawn another empty block.
// Fresh frames (sole empty block) keep Backspace as a no-op. pageLink / other atoms get title focus.
// Frame deselect also prunes leftover empty top-level textblocks (blank Enter lines).

import { Extension, type Editor } from '@tiptap/core' // Editor type for prune helper
import { NodeSelection, TextSelection } from '@tiptap/pm/state'

/** True when a textblock has no visible text (empty paragraph / heading). */
export function isEmptyTextblock(node: { isTextblock: boolean; textContent: string; content: { size: number } }) {
  if (!node.isTextblock) return false // Atoms / lists are not empty “lines”
  return node.content.size === 0 || node.textContent.length === 0
}

/**
 * Remove empty top-level textblocks from a frame editor (blank lines left after Enter).
 * Keeps pageLink/databaseBlock atoms. Never empties the doc — leaves one node so sole-empty
 * frame deletion (or a typing shell) can still run. Returns true when something was deleted.
 */
export function pruneEmptyTextblocks(editor: Editor): boolean {
  if (editor.isDestroyed) return false // Unmounted editor — nothing to prune
  const { state, view } = editor
  const { doc } = state

  // Collect empty top-level textblock ranges (delete high→low so positions stay valid)
  const ranges: { from: number; to: number }[] = []
  let pos = 0
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i)
    const from = pos
    const to = pos + child.nodeSize
    if (isEmptyTextblock(child)) ranges.push({ from, to }) // Blank paragraph / heading only
    pos = to
  }
  if (ranges.length === 0) return false // Nothing empty

  // Would delete every child → keep one shell (PM needs a node; sole-empty path may remove the frame)
  if (ranges.length >= doc.childCount) ranges.pop()
  if (ranges.length === 0) return false // Sole empty textblock — leave for frame-delete logic

  let tr = state.tr
  for (let i = ranges.length - 1; i >= 0; i--) {
    tr = tr.delete(ranges[i].from, ranges[i].to) // Strip blank line from the frame
  }
  view.dispatch(tr) // onUpdate persists HTML via existing content-change path
  return true
}

export const EmptyBlockBackspace = Extension.create({
  name: 'emptyBlockBackspace',
  priority: 1000, // Prefer our handlers over StarterKit Backspace/Enter when both see the event

  addKeyboardShortcuts() {
    return {
      // Enter in an empty block would splitBlock → another blank line; swallow it instead
      Enter: ({ editor }) => {
        const { selection } = editor.state
        if (!selection.empty) return false // Let default replace/split the selection
        if (!isEmptyTextblock(selection.$from.parent)) return false // Non-empty: Enter still creates the next block
        return true // Consume — stay on this empty block
      },

      Backspace: ({ editor }) => {
        const { state, view } = editor
        const { selection } = state
        if (!selection.empty) return false // Let default delete the selection

        const $from = selection.$from
        if ($from.parentOffset !== 0) return false // Not at the start of the block
        if (!isEmptyTextblock($from.parent)) return false // Only empty “fresh” blocks

        // Sole empty block in the frame — keep it (fresh frame / typing target)
        if (state.doc.childCount === 1) return true

        // Need a previous sibling at this level (top-level blocks in the frame doc)
        if ($from.depth < 1) return false
        const indexInParent = $from.index($from.depth - 1)
        if (indexInParent === 0) return true // First block empty — don’t destroy the frame shell

        const parent = $from.node($from.depth - 1)
        const prevNode = parent.child(indexInParent - 1)
        // Delete the whole empty textblock (not just its inner content)
        const blockStart = $from.before($from.depth)
        const blockEnd = $from.after($from.depth)

        // Absolute start position of the previous sibling
        let prevStart = $from.start($from.depth - 1)
        for (let i = 0; i < indexInParent - 1; i++) prevStart += parent.child(i).nodeSize

        const tr = state.tr
        tr.delete(blockStart, blockEnd) // Remove the empty block (and its line space)
        const mappedPrevStart = tr.mapping.map(prevStart, -1)

        if (prevNode.isTextblock) {
          // Caret at end of the previous line
          const mapped = tr.doc.resolve(mappedPrevStart)
          const prev = mapped.nodeAfter
          if (prev && prev.isTextblock) {
            const end = mappedPrevStart + 1 + prev.content.size
            tr.setSelection(TextSelection.create(tr.doc, end))
          }
        } else {
          // Atom / pageLink — select the node; DOM focus lands on the title below
          try {
            tr.setSelection(NodeSelection.create(tr.doc, mappedPrevStart))
          } catch {
            /* ignore invalid selection */
          }
        }
        view.dispatch(tr.scrollIntoView())

        // pageLink / databaseBlock: place the I-bar in the editable title (PM can’t caret inside an atom)
        if (prevNode.type.name === 'pageLink' || prevNode.type.name === 'databaseBlock') {
          requestAnimationFrame(() => {
            if (editor.isDestroyed) return
            const mappedPos = editor.state.selection.from // NodeSelection at atom
            const dom = editor.view.nodeDOM(mappedPos) as HTMLElement | null
            const root =
              dom?.closest?.('.tt-page-link') ||
              dom?.closest?.('.tt-database-block') ||
              dom
            const label = root?.querySelector?.(
              prevNode.type.name === 'databaseBlock' ? '.tt-database-block-label' : '.tt-page-link-label'
            ) as HTMLElement | null
            if (!label) return
            label.focus()
            const range = document.createRange()
            range.selectNodeContents(label)
            range.collapse(false) // End of title
            const sel = window.getSelection()
            sel?.removeAllRanges()
            sel?.addRange(range)
          })
        }

        return true
      },
    }
  },
})
