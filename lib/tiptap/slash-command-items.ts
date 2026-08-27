// Slash-command catalog — all Notion-style / sections, headers, and items.

import type { Editor } from '@tiptap/react'
import type { Range } from '@tiptap/core'
import type { BlockTypeId } from '@/components/block-actions-menu'
import { findEditorBlockAtPos, turnEditorBlockInto } from '@/lib/tiptap/block-selection'

export type SlashCodeLanguage = {
  id: string
  label: string
}

export const SLASH_CODE_LANGUAGES: SlashCodeLanguage[] = [
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'python', label: 'Python' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'json', label: 'JSON' },
  { id: 'bash', label: 'Bash' },
  { id: 'sql', label: 'SQL' },
  { id: 'mermaid', label: 'Mermaid' },
]

export const SLASH_SECTION_ORDER = [
  'Basic blocks',
  'Advanced blocks',
  'AI',
  'Media',
  'Inline',
  'Embeds',
  'Import',
  'Turn into',
  'Actions',
  'Text color',
  'Background color',
] as const

export type SlashCommandItem = {
  id: string
  title: string
  section: string
  keywords: string[]
  shortcut?: string
  badge?: 'New' | 'Beta'
  disabled?: boolean
  preview?: string
  colorSwatch?: string // Text / background color row icon fill
  hasSubmenu?: boolean
  command: (opts: { editor: Editor; range: Range; language?: string }) => void
}

function slashDismiss(editor: Editor, range: Range) {
  editor.chain().focus().deleteRange(range).run()
}

function insertAtom(editor: Editor, range: Range, type: string, attrs?: Record<string, unknown>) {
  const { from } = range
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContentAt(from, { type, attrs: attrs || {} })
    .run()
}

function slashTurnInto(editor: Editor, range: Range, blockType: BlockTypeId) {
  const { from } = range
  editor.chain().focus().deleteRange(range).run()
  const block = findEditorBlockAtPos(editor, from)
  if (!block) return
  turnEditorBlockInto(editor, block, blockType)
}

function insertBoardLink(editor: Editor, range: Range, variant: 'inline' | 'title' = 'inline') {
  insertAtom(editor, range, 'boardLink', {
    boardId: null,
    title: 'Untitled',
    icon: null,
    variant,
  })
}

function stub(
  id: string,
  title: string,
  section: string,
  keywords: string[],
  extra?: Partial<SlashCommandItem>
): SlashCommandItem {
  return {
    id,
    title,
    section,
    keywords,
    command: ({ editor, range }) => slashDismiss(editor, range),
    ...extra,
  }
}

function turnIntoItem(
  id: string,
  title: string,
  blockType: BlockTypeId,
  keywords: string[],
  extra?: Partial<SlashCommandItem>
): SlashCommandItem {
  return {
    id,
    title,
    section: 'Turn into',
    keywords,
    command: ({ editor, range }) => slashTurnInto(editor, range, blockType),
    ...extra,
  }
}

const TEXT_COLOR_DEFS: { id: string; title: string; hex: string; keywords: string[] }[] = [
  { id: 'textColorDefault', title: 'Default text', hex: '#000000', keywords: ['default', 'black'] },
  { id: 'textColorGray', title: 'Gray text', hex: '#6b7280', keywords: ['gray'] },
  { id: 'textColorBrown', title: 'Brown text', hex: '#9F6B53', keywords: ['brown'] },
  { id: 'textColorOrange', title: 'Orange text', hex: '#f97316', keywords: ['orange'] },
  { id: 'textColorYellow', title: 'Yellow text', hex: '#eab308', keywords: ['yellow'] },
  { id: 'textColorGreen', title: 'Green text', hex: '#22c55e', keywords: ['green'] },
  { id: 'textColorBlue', title: 'Blue text', hex: '#3b82f6', keywords: ['blue'] },
  { id: 'textColorPurple', title: 'Purple text', hex: '#a855f7', keywords: ['purple'] },
  { id: 'textColorPink', title: 'Pink text', hex: '#ec4899', keywords: ['pink'] },
  { id: 'textColorRed', title: 'Red text', hex: '#ef4444', keywords: ['red'] },
]

const BG_COLOR_DEFS: { id: string; title: string; hex: string; keywords: string[] }[] = [
  { id: 'bgColorDefault', title: 'Default background', hex: '', keywords: ['default'] },
  { id: 'bgColorGray', title: 'Gray background', hex: '#F1F1EF', keywords: ['gray'] },
  { id: 'bgColorBrown', title: 'Brown background', hex: '#F4EEEE', keywords: ['brown'] },
  { id: 'bgColorOrange', title: 'Orange background', hex: '#FBECDD', keywords: ['orange'] },
  { id: 'bgColorYellow', title: 'Yellow background', hex: '#FBF3DB', keywords: ['yellow'] },
  { id: 'bgColorGreen', title: 'Green background', hex: '#EDF3EC', keywords: ['green'] },
  { id: 'bgColorBlue', title: 'Blue background', hex: '#E7F3F8', keywords: ['blue'] },
  { id: 'bgColorPurple', title: 'Purple background', hex: '#F6F3F9', keywords: ['purple'] },
  { id: 'bgColorPink', title: 'Pink background', hex: '#F9F2F5', keywords: ['pink'] },
  { id: 'bgColorRed', title: 'Red background', hex: '#FDEBEC', keywords: ['red'] },
]

const IMPORT_TOOLS = [
  'CSV',
  'Text and Markdown',
  'Asana',
  'Confluence',
  'Google Docs',
  'Trello',
  'Evernote',
  'Workflowy',
  'Word',
  'Monday',
  'Quip',
  'ZIP',
  'PDF',
] as const

const EMBED_TOOLS: { title: string; keywords: string[]; badge?: 'New'; preview?: string }[] = [
  { title: 'Embed', keywords: ['embed', 'url', 'iframe'] },
  { title: 'HTML', keywords: ['html'], badge: 'New' },
  { title: 'Google Drive', keywords: ['google', 'drive'] },
  { title: 'Tweet', keywords: ['tweet', 'twitter', 'x'], preview: 'Embed a Tweet' },
  { title: 'GitHub Gist', keywords: ['github', 'gist'] },
  { title: 'Google Maps', keywords: ['maps', 'google'] },
  { title: 'Figma', keywords: ['figma', 'design'] },
  { title: 'Loom', keywords: ['loom', 'video'] },
  { title: 'Typeform', keywords: ['typeform', 'form'] },
  { title: 'CodePen', keywords: ['codepen'] },
]

export const SLASH_COMMAND_ITEMS: SlashCommandItem[] = [
  // —— Basic blocks ——
  {
    id: 'text',
    title: 'Text',
    section: 'Basic blocks',
    keywords: ['text', 'paragraph', 'plain'],
    preview: 'Just start writing with plain text',
    command: ({ editor, range }) => slashTurnInto(editor, range, 'text'),
  },
  {
    id: 'heading1',
    title: 'Heading 1',
    section: 'Basic blocks',
    keywords: ['heading', 'h1', 'title'],
    shortcut: '#',
    preview: 'Big section heading',
    command: ({ editor, range }) => slashTurnInto(editor, range, 'heading1'),
  },
  {
    id: 'heading2',
    title: 'Heading 2',
    section: 'Basic blocks',
    keywords: ['heading', 'h2', 'subtitle'],
    shortcut: '##',
    preview: 'Medium section heading',
    command: ({ editor, range }) => slashTurnInto(editor, range, 'heading2'),
  },
  {
    id: 'heading3',
    title: 'Heading 3',
    section: 'Basic blocks',
    keywords: ['heading', 'h3'],
    shortcut: '###',
    preview: 'Small section heading',
    command: ({ editor, range }) => slashTurnInto(editor, range, 'heading3'),
  },
  {
    id: 'heading4',
    title: 'Heading 4',
    section: 'Basic blocks',
    keywords: ['heading', 'h4'],
    shortcut: '####',
    command: ({ editor, range }) => slashTurnInto(editor, range, 'heading4'),
  },
  {
    id: 'bulletedList',
    title: 'Bulleted list',
    section: 'Basic blocks',
    keywords: ['bullet', 'list', 'ul'],
    shortcut: '-',
    preview: 'Create a simple bulleted list',
    command: ({ editor, range }) => slashTurnInto(editor, range, 'bulletedList'),
  },
  {
    id: 'numberedList',
    title: 'Numbered list',
    section: 'Basic blocks',
    keywords: ['numbered', 'ordered', 'list', 'ol'],
    shortcut: '1.',
    preview: 'Create a list with numbering',
    command: ({ editor, range }) => slashTurnInto(editor, range, 'numberedList'),
  },
  {
    id: 'todoList',
    title: 'To-do list',
    section: 'Basic blocks',
    keywords: ['todo', 'task', 'checkbox', 'checklist'],
    shortcut: '[]',
    preview: 'Track tasks with a to-do list',
    command: ({ editor, range }) => slashTurnInto(editor, range, 'todoList'),
  },
  {
    id: 'toggleList',
    title: 'Toggle list',
    section: 'Basic blocks',
    keywords: ['toggle', 'collapse', 'accordion'],
    shortcut: '>',
    preview: 'Hide and show content inside toggles',
    command: ({ editor, range }) => slashTurnInto(editor, range, 'toggleList'),
  },
  {
    id: 'board',
    title: 'Board',
    section: 'Basic blocks',
    keywords: ['board', 'page', 'subpage', 'child'],
    preview: 'Embed a sub-board inside the page',
    command: ({ editor, range }) => insertBoardLink(editor, range, 'inline'),
  },
  {
    id: 'boardIn',
    title: 'Board in',
    section: 'Basic blocks',
    keywords: ['board in', 'nest', 'sub-board'],
    hasSubmenu: true,
    command: ({ editor, range }) => insertBoardLink(editor, range, 'inline'),
  },
  {
    id: 'callout',
    title: 'Callout',
    section: 'Basic blocks',
    keywords: ['callout', 'banner', 'alert'],
    preview: 'Make writing stand out',
    command: ({ editor, range }) => slashTurnInto(editor, range, 'callout'),
  },
  {
    id: 'quote',
    title: 'Quote',
    section: 'Basic blocks',
    keywords: ['quote', 'blockquote', 'citation'],
    shortcut: '"',
    preview: 'Capture a quote',
    command: ({ editor, range }) => slashTurnInto(editor, range, 'quote'),
  },
  {
    id: 'table',
    title: 'Table',
    section: 'Basic blocks',
    keywords: ['table', 'database', 'grid', 'spreadsheet'],
    command: ({ editor, range }) =>
      insertAtom(editor, range, 'databaseBlock', {
        title: 'Untitled database',
        notionDatabaseId: null,
      }),
  },
  {
    id: 'divider',
    title: 'Divider',
    section: 'Basic blocks',
    keywords: ['divider', 'hr', 'line', 'separator'],
    preview: 'Visually divide blocks',
    command: ({ editor, range }) => {
      const { from } = range
      editor.chain().focus().deleteRange(range).insertContentAt(from, { type: 'horizontalRule' }).run()
    },
  },
  {
    id: 'linkToPage',
    title: 'Link to page',
    section: 'Basic blocks',
    keywords: ['link', 'page', 'board', 'embed'],
    preview: 'Link to another board',
    command: ({ editor, range }) => insertBoardLink(editor, range, 'inline'),
  },

  // —— Advanced blocks ——
  stub('tableOfContents', 'Table of contents', 'Advanced blocks', ['toc', 'contents', 'outline'], {
    preview: 'Show an outline of your page',
  }),
  {
    id: 'blockEquation',
    title: 'Block equation',
    section: 'Advanced blocks',
    keywords: ['equation', 'math', 'latex', 'sigma'],
    preview: 'Display a LaTeX equation',
    command: ({ editor, range }) => slashTurnInto(editor, range, 'blockEquation'),
  },
  stub('button', 'Button', 'Advanced blocks', ['button', 'click', 'cta'], {
    preview: 'Add a clickable button',
  }),
  stub('breadcrumb', 'Breadcrumb', 'Advanced blocks', ['breadcrumb', 'nav', 'path'], {
    preview: 'Show the page path',
  }),
  stub('tabs', 'Tabs', 'Advanced blocks', ['tabs', 'tabbed'], {
    badge: 'New',
    preview: 'Organize content in tabs',
  }),
  {
    id: 'syncedBlock',
    title: 'Synced block',
    section: 'Advanced blocks',
    keywords: ['synced', 'sync', 'reuse'],
    preview: 'Sync content across pages',
    command: ({ editor, range }) => slashTurnInto(editor, range, 'syncedBlock'),
  },
  {
    id: 'toggleHeading1',
    title: 'Toggle heading 1',
    section: 'Advanced blocks',
    keywords: ['toggle', 'heading', 'h1'],
    shortcut: '# >',
    command: ({ editor, range }) => slashTurnInto(editor, range, 'toggleHeading1'),
  },
  {
    id: 'toggleHeading2',
    title: 'Toggle heading 2',
    section: 'Advanced blocks',
    keywords: ['toggle', 'heading', 'h2'],
    shortcut: '## >',
    command: ({ editor, range }) => slashTurnInto(editor, range, 'toggleHeading2'),
  },
  {
    id: 'toggleHeading3',
    title: 'Toggle heading 3',
    section: 'Advanced blocks',
    keywords: ['toggle', 'heading', 'h3'],
    shortcut: '### >',
    command: ({ editor, range }) => slashTurnInto(editor, range, 'toggleHeading3'),
  },
  {
    id: 'toggleHeading4',
    title: 'Toggle heading 4',
    section: 'Advanced blocks',
    keywords: ['toggle', 'heading', 'h4'],
    shortcut: '#### >',
    command: ({ editor, range }) => slashTurnInto(editor, range, 'toggleHeading4'),
  },
  {
    id: 'columns2',
    title: '2 columns',
    section: 'Advanced blocks',
    keywords: ['columns', '2', 'split'],
    preview: 'Create 2 columns of blocks',
    command: ({ editor, range }) => slashTurnInto(editor, range, 'columns2'),
  },
  {
    id: 'columns3',
    title: '3 columns',
    section: 'Advanced blocks',
    keywords: ['columns', '3'],
    preview: 'Create 3 columns of blocks',
    command: ({ editor, range }) => slashTurnInto(editor, range, 'columns3'),
  },
  {
    id: 'columns4',
    title: '4 columns',
    section: 'Advanced blocks',
    keywords: ['columns', '4'],
    preview: 'Create 4 columns of blocks',
    command: ({ editor, range }) => slashTurnInto(editor, range, 'columns4'),
  },
  {
    id: 'columns5',
    title: '5 columns',
    section: 'Advanced blocks',
    keywords: ['columns', '5'],
    preview: 'Create 5 columns of blocks',
    command: ({ editor, range }) => slashTurnInto(editor, range, 'columns5'),
  },

  // —— AI ——
  stub('aiMeetingNotes', 'AI Meeting Notes', 'AI', ['ai', 'meeting', 'notes', 'transcript'], {
    badge: 'Beta',
    preview: 'Generate notes from a meeting',
  }),
  stub('codeMermaid', 'Code - Mermaid', 'AI', ['mermaid', 'diagram', 'chart'], {
    preview: 'Render a Mermaid diagram',
  }),
  stub('aiBlock', 'AI Block', 'AI', ['ai', 'block', 'generate'], {
    preview: 'Generate content with AI',
  }),

  // —— Media ——
  {
    id: 'image',
    title: 'Image',
    section: 'Media',
    keywords: ['image', 'photo', 'picture', 'img'],
    preview: 'Upload or embed with a link',
    command: ({ editor, range }) => insertAtom(editor, range, 'imageBlock', { src: null, alt: '' }),
  },
  {
    id: 'video',
    title: 'Video',
    section: 'Media',
    keywords: ['video', 'movie', 'mp4'],
    command: ({ editor, range }) => insertAtom(editor, range, 'videoBlock'),
  },
  {
    id: 'audio',
    title: 'Audio',
    section: 'Media',
    keywords: ['audio', 'sound', 'music', 'mp3'],
    command: ({ editor, range }) => insertAtom(editor, range, 'audioBlock'),
  },
  {
    id: 'code',
    title: 'Code',
    section: 'Media',
    keywords: ['code', 'snippet', 'programming'],
    hasSubmenu: true,
    preview: 'Capture a code snippet',
    command: ({ editor, range, language }) => {
      const { from } = range
      editor.chain().focus().deleteRange(range).run()
      editor
        .chain()
        .focus()
        .insertContentAt(from, {
          type: 'codeBlock',
          attrs: language ? { language } : {},
          content: [],
        })
        .run()
    },
  },
  {
    id: 'file',
    title: 'File',
    section: 'Media',
    keywords: ['file', 'attachment', 'upload', 'paperclip'],
    command: ({ editor, range }) => insertAtom(editor, range, 'fileBlock'),
  },
  {
    id: 'webBookmark',
    title: 'Web bookmark',
    section: 'Media',
    keywords: ['bookmark', 'link', 'web', 'url'],
    command: ({ editor, range }) => insertAtom(editor, range, 'bookmarkBlock'),
  },

  // —— Inline ——
  stub('mentionPerson', 'Mention a person', 'Inline', ['mention', 'person', 'user', '@'], {
    preview: 'Mention a teammate',
  }),
  stub('mentionPage', 'Mention a page or data source', 'Inline', ['mention', 'page', 'board', 'data'], {
    preview: 'Link to a board or database',
  }),
  stub('dateReminder', 'Date or reminder', 'Inline', ['date', 'reminder', 'time', '@'], {
    preview: 'Insert a date or reminder in text',
  }),
  stub('emoji', 'Emoji', 'Inline', ['emoji', 'smile', 'icon'], {
    preview: 'Insert an emoji in text',
  }),
  stub('inlineEquation', 'Inline equation', 'Inline', ['equation', 'math', 'latex', 'inline'], {
    preview: 'Insert inline math',
  }),

  // —— Embeds ——
  ...EMBED_TOOLS.map((e) =>
    stub(
      `embed_${e.title.replace(/\s+/g, '_').toLowerCase()}`,
      e.title,
      'Embeds',
      e.keywords,
      { badge: e.badge, preview: e.preview }
    )
  ),

  // —— Import ——
  ...IMPORT_TOOLS.map((name) =>
    stub(
      `import_${name.replace(/\s+/g, '_').toLowerCase()}`,
      name,
      'Import',
      [name.toLowerCase(), 'import', 'upload'],
      {
        badge: name === 'Google Docs' ? 'New' : undefined,
        preview:
          name === 'ZIP'
            ? 'Bring data from other tools into Thinktable'
            : `Import from ${name}`,
      }
    )
  ),

  // —— Turn into ——
  turnIntoItem('turnText', 'Text', 'text', ['text', 'paragraph']),
  turnIntoItem('turnHeading1', 'Heading 1', 'heading1', ['h1', 'heading'], { shortcut: '#' }),
  turnIntoItem('turnHeading2', 'Heading 2', 'heading2', ['h2', 'heading'], { shortcut: '##' }),
  turnIntoItem('turnHeading3', 'Heading 3', 'heading3', ['h3', 'heading'], { shortcut: '###' }),
  turnIntoItem('turnHeading4', 'Heading 4', 'heading4', ['h4', 'heading'], { shortcut: '####' }),
  {
    id: 'turnBoard',
    title: 'Board',
    section: 'Turn into',
    keywords: ['board', 'page'],
    command: ({ editor, range }) => insertBoardLink(editor, range, 'inline'),
  },
  {
    id: 'turnBoardIn',
    title: 'Board in',
    section: 'Turn into',
    keywords: ['board in', 'nest'],
    hasSubmenu: true,
    command: ({ editor, range }) => insertBoardLink(editor, range, 'inline'),
  },
  turnIntoItem('turnBulletedList', 'Bulleted list', 'bulletedList', ['bullet', 'list'], { shortcut: '-' }),
  turnIntoItem('turnNumberedList', 'Numbered list', 'numberedList', ['numbered', 'list'], { shortcut: '1.' }),
  turnIntoItem('turnTodoList', 'To-do list', 'todoList', ['todo', 'task'], { shortcut: '[]' }),
  turnIntoItem('turnToggleList', 'Toggle list', 'toggleList', ['toggle'], { shortcut: '>' }),
  turnIntoItem('turnCode', 'Code', 'code', ['code'], { preview: 'Capture a code snippet' }),
  turnIntoItem('turnQuote', 'Quote', 'quote', ['quote'], { shortcut: '"' }),
  turnIntoItem('turnCallout', 'Callout', 'callout', ['callout']),
  turnIntoItem('turnBlockEquation', 'Block equation', 'blockEquation', ['equation', 'math']),
  turnIntoItem('turnSyncedBlock', 'Synced block', 'syncedBlock', ['synced'], {
    preview: 'Sync content across pages',
  }),
  turnIntoItem('turnToggleHeading1', 'Toggle heading 1', 'toggleHeading1', ['toggle', 'h1'], {
    shortcut: '# >',
  }),
  turnIntoItem('turnToggleHeading2', 'Toggle heading 2', 'toggleHeading2', ['toggle', 'h2'], {
    shortcut: '## >',
  }),
  turnIntoItem('turnToggleHeading3', 'Toggle heading 3', 'toggleHeading3', ['toggle', 'h3'], {
    shortcut: '### >',
  }),
  turnIntoItem('turnToggleHeading4', 'Toggle heading 4', 'toggleHeading4', ['toggle', 'h4'], {
    shortcut: '#### >',
  }),
  turnIntoItem('turnColumns2', '2 columns', 'columns2', ['columns', '2'], {
    preview: 'Create 2 columns of blocks',
  }),
  turnIntoItem('turnColumns3', '3 columns', 'columns3', ['columns', '3']),
  turnIntoItem('turnColumns4', '4 columns', 'columns4', ['columns', '4']),
  turnIntoItem('turnColumns5', '5 columns', 'columns5', ['columns', '5']),

  // —— Actions ——
  stub('actionCopyLink', 'Copy link to block', 'Actions', ['copy', 'link', 'block'], {
    shortcut: '⌘^L',
    preview: 'Copy a link to this block',
  }),
  stub('actionDuplicate', 'Duplicate', 'Actions', ['duplicate', 'copy'], { shortcut: '⌘D' }),
  stub('actionMoveTo', 'Move to', 'Actions', ['move', 'relocate'], { shortcut: '⌘⇧P', hasSubmenu: true }),
  stub('actionDelete', 'Delete', 'Actions', ['delete', 'remove'], { shortcut: 'Del' }),
  stub('actionPresent', 'Present from here', 'Actions', ['present', 'slideshow'], {
    badge: 'Beta',
    disabled: true,
    shortcut: '⌘⌥P',
  }),
  stub('actionAskAi', 'Ask AI', 'Actions', ['ai', 'ask', 'generate'], { shortcut: '⌘J' }),

  // —— Text color ——
  ...TEXT_COLOR_DEFS.map((c) => ({
    id: c.id,
    title: c.title,
    section: 'Text color',
    keywords: c.keywords,
    colorSwatch: c.hex,
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      editor.chain().focus().deleteRange(range).run()
      if (c.hex === '#000000') editor.chain().focus().unsetColor().run()
      else editor.chain().focus().setColor(c.hex).run()
    },
  })),

  // —— Background color ——
  ...BG_COLOR_DEFS.map((c) => ({
    id: c.id,
    title: c.title,
    section: 'Background color',
    keywords: c.keywords,
    colorSwatch: c.hex || '#ffffff',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      editor.chain().focus().deleteRange(range).run()
      if (!c.hex) editor.chain().focus().unsetHighlight().run()
      else editor.chain().focus().setHighlight({ color: c.hex }).run()
    },
  })),
]

/** Filter slash items by query (title, keywords, section). */
export function filterSlashCommandItems(query: string): SlashCommandItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return SLASH_COMMAND_ITEMS
  return SLASH_COMMAND_ITEMS.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.section.toLowerCase().includes(q) ||
      item.keywords.some((k) => k.includes(q) || q.includes(k))
  )
}

/** Section order for grouped menu rendering. */
export function slashCommandSections(items: SlashCommandItem[]): string[] {
  const present = new Set(items.map((i) => i.section))
  return SLASH_SECTION_ORDER.filter((s) => present.has(s))
}
