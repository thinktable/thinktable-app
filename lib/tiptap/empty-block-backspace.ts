// Backspace on an empty TipTap block: delete it and move the I-bar to the previous block.
// Fresh frames (sole empty block) are left alone. pageLink / other atoms get their title focused.

import { Extension } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'

/** True when a textblock has no visible text (empty paragraph / heading). */
function isEmptyTextblock(node: { isTextblock: boolean; textContent: string; content: { size: number } }) {
  if (!node.isTextblock) return false
  return node.content.size === 0 || node.textContent.length === 0
}

export const EmptyBlockBackspace = Extension.create({
  name: 'emptyBlockBackspace',
  priority: 1000, // Run before StarterKit Backspace (which selectNodeBackward’s the atom and leaves the empty block)

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { state } = editor
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
        const blockStart = $from.before() // Start of the empty block
        const blockEnd = $from.after() // End of the empty block

        // Absolute start position of the previous sibling
        let prevStart = $from.start($from.depth - 1)
        for (let i = 0; i < indexInParent - 1; i++) prevStart += parent.child(i).nodeSize

        const handled = editor
          .chain()
          .command(({ tr, dispatch }) => {
            if (!dispatch) return true
            tr.delete(blockStart, blockEnd) // Remove the empty block
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
            dispatch(tr.scrollIntoView())
            return true
          })
          .run()

        if (!handled) return false

        // pageLink: place the I-bar in the editable title (PM can’t caret inside an atom)
        if (prevNode.type.name === 'pageLink') {
          requestAnimationFrame(() => {
            if (editor.isDestroyed) return
            const mappedPrevStart = editor.state.selection.from // NodeSelection at atom
            const dom = editor.view.nodeDOM(mappedPrevStart) as HTMLElement | null
            const root = dom?.closest?.('.tt-page-link') || dom
            const label = root?.querySelector?.('.tt-page-link-label') as HTMLElement | null
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
