// Shared TipTap extension stack for panel editors (Turn into types included).

import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import TextAlign from '@tiptap/extension-text-align'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Haze } from '@/lib/tiptap/haze'
import { AiPending, AiOrigin } from '@/lib/tiptap/ai-marks' // AI edit review + provenance
import {
  BlockEquation,
  Callout,
  Columns,
  SyncedBlock,
  ToggleHeading,
  ToggleList,
} from '@/lib/tiptap/block-nodes'
import { BoardLink } from '@/lib/tiptap/board-link' // Linked-page block (inline + title + preview)
import { DatabaseBlock } from '@/lib/tiptap/database-block' // Notion database as a compact TipTap block
import { ImageBlock } from '@/lib/tiptap/image-block' // Turn into → Image atom
import { PropertyBlock } from '@/lib/tiptap/property-block' // Turn into → Property atom (icon + Empty cell)
import { EmptyBlockBackspace } from '@/lib/tiptap/empty-block-backspace' // Backspace empty block → previous line
import { Extension } from '@tiptap/core'
import { createBlockHighlightPlugin } from '@/lib/tiptap/block-selection'

/** Decoration plugin — Notion blue wash on the active content block. */
const BlockHighlight = Extension.create({
  name: 'blockHighlight',
  addProseMirrorPlugins() {
    return [createBlockHighlightPlugin()]
  },
})

/** Host frame ids for NodeViews (TipTap React NodeViews can miss React context). */
const FrameHost = Extension.create({
  name: 'frameHost',
  addStorage() {
    return {
      conversationId: null as string | null, // Board the host frame sits on
      hostMessageId: null as string | null, // Host frame message id
    }
  },
})

/** Build editor extensions; optional placeholder text. */
export function createPanelExtensions(placeholder?: string): any[] {
  const extensions: any[] = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] }, // Notion H1–H4
      // TaskList replaces default list behavior where needed; keep bullet/ordered
      // TrailingNode re-inserts an empty <p> after boardLink/atoms, so empty-block
      // Backspace looked like it deleted the block but left the blank line space.
      trailingNode: false,
    }),
    Highlight.configure({ multicolor: true }),
    Haze,
    AiPending, // Rainbow pending AI edits
    AiOrigin, // Persisted AI-written spans (toggleable reddish mask)
    TextStyle,
    Color,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Callout,
    ToggleList,
    ToggleHeading,
    BlockEquation,
    SyncedBlock,
    Columns,
    BoardLink, // Block that links to a child page (Notion child-page block)
    DatabaseBlock, // Notion database stays one block (no map-frame sprawl of rows)
    ImageBlock, // Image block (placeholder until src is set)
    PropertyBlock, // Property cell (type icon + Empty box; frame still has top icon)
    EmptyBlockBackspace, // Empty block: Backspace → previous; Enter → no new blank line
    BlockHighlight, // Per-content-block menu highlight (not the map card)
    FrameHost, // conversationId + hostMessageId for databaseBlock / boardLink NodeViews
  ]

  if (placeholder !== undefined && placeholder !== '') {
    extensions.push(
      Placeholder.configure({
        placeholder,
        emptyNodeClass: 'is-editor-empty',
        emptyEditorClass: 'is-editor-empty',
      })
    )
  } else if (placeholder === undefined) {
    extensions.push(
      Placeholder.configure({
        placeholder: 'Type something…',
        emptyNodeClass: 'is-editor-empty',
        emptyEditorClass: 'is-editor-empty',
      })
    )
  }

  return extensions
}
