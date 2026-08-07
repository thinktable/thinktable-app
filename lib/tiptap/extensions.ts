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
import {
  BlockEquation,
  Callout,
  Columns,
  SyncedBlock,
  ToggleHeading,
  ToggleList,
} from '@/lib/tiptap/block-nodes'
import { Extension } from '@tiptap/core'
import { createBlockHighlightPlugin } from '@/lib/tiptap/block-selection'

/** Decoration plugin — Notion blue wash on the active content block. */
const BlockHighlight = Extension.create({
  name: 'blockHighlight',
  addProseMirrorPlugins() {
    return [createBlockHighlightPlugin()]
  },
})

/** Build editor extensions; optional placeholder text. */
export function createPanelExtensions(placeholder?: string): any[] {
  const extensions: any[] = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] }, // Notion H1–H4
      // TaskList replaces default list behavior where needed; keep bullet/ordered
    }),
    Highlight.configure({ multicolor: true }),
    Haze,
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
    BlockHighlight, // Per-content-block menu highlight (not the map card)
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
