import { Mark, mergeAttributes } from '@tiptap/core' // TipTap mark base + HTML attrs helper

/**
 * Inline "Hide text" mark — frosted/hazed span until the user clicks to reveal.
 * Reveal is a temporary DOM class (`tt-haze-revealed`), not document state.
 */
export const Haze = Mark.create({
  name: 'haze', // Schema mark name used by setMark('haze') / unsetMark('haze')

  inclusive: false, // Don't keep extending haze while typing at the edges

  parseHTML() {
    return [
      { tag: 'span[data-haze="true"]' }, // Restore from saved HTML
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-haze': 'true', // Click target for temporary reveal
        class: 'tt-haze', // Default hazed appearance
      }),
      0, // Mark content hole
    ]
  },

  addCommands() {
    return {
      setHaze:
        () =>
        ({ commands }) =>
          commands.setMark(this.name), // Apply haze to the current selection
      unsetHaze:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name), // Clear haze from the current selection
      toggleHaze:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name), // Toggle haze on the current selection
    }
  },
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    haze: {
      setHaze: () => ReturnType // Apply haze mark
      unsetHaze: () => ReturnType // Remove haze mark
      toggleHaze: () => ReturnType // Toggle haze mark
    }
  }
}
