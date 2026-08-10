// TipTap marks for AI edit review (rainbow pending) and persisted AI provenance (reddish)
import { Mark, mergeAttributes } from '@tiptap/core' // Mark base

/** Proposed AI edit — rainbow sheer mask until save/discard. */
export const AiPending = Mark.create({
  name: 'aiPending', // Schema name
  inclusive: false, // Don't extend while typing at edges
  excludes: '', // Can coexist with other marks
  parseHTML() {
    return [{ tag: 'span[data-ai-pending="true"]' }] // Restore from HTML
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-ai-pending': 'true', // Click target for per-span controls
        class: 'tt-ai-pending', // Rainbow sheer
      }),
      0,
    ]
  },
  addCommands() {
    return {
      setAiPending:
        () =>
        ({ commands }) =>
          commands.setMark(this.name),
      unsetAiPending:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    }
  },
})

/** Persisted AI-written spans — reddish mask only when top-bar AI content toggle is on. */
export const AiOrigin = Mark.create({
  name: 'aiOrigin', // Schema name
  inclusive: false, // User typing at edges replaces / doesn't extend AI provenance
  parseHTML() {
    return [{ tag: 'span[data-ai-origin="true"]' }] // Restore from HTML
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-ai-origin': 'true', // Provenance marker
        class: 'tt-ai-origin', // Reddish sheer (CSS gated by show toggle)
      }),
      0,
    ]
  },
  addCommands() {
    return {
      setAiOrigin:
        () =>
        ({ commands }) =>
          commands.setMark(this.name),
      unsetAiOrigin:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    }
  },
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiPending: {
      setAiPending: () => ReturnType
      unsetAiPending: () => ReturnType
    }
    aiOrigin: {
      setAiOrigin: () => ReturnType
      unsetAiOrigin: () => ReturnType
    }
  }
}
