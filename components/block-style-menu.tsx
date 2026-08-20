'use client'

// Style-bar Block style dropdown — Notion-like text color + highlight (background).
// Applies TipTap Color / Highlight marks on the active editor selection.

import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { cn } from '@/lib/utils' // Class merge

/** Notion-like text + highlight palette (same hues as frame Color flyout). */
export const BLOCK_COLOR_SWATCHES = [
  { id: 'default', name: 'Default', text: '', highlight: '' }, // Empty = unset mark
  { id: 'gray', name: 'Gray', text: '#787774', highlight: '#F1F1EF' },
  { id: 'brown', name: 'Brown', text: '#9F6B53', highlight: '#F4EEEE' },
  { id: 'orange', name: 'Orange', text: '#D9730D', highlight: '#FBECDD' },
  { id: 'yellow', name: 'Yellow', text: '#CB912F', highlight: '#FBF3DB' },
  { id: 'green', name: 'Green', text: '#448361', highlight: '#EDF3EC' },
  { id: 'blue', name: 'Blue', text: '#337EA9', highlight: '#E7F3F8' },
  { id: 'purple', name: 'Purple', text: '#9065B0', highlight: '#F6F3F9' },
  { id: 'pink', name: 'Pink', text: '#C14C8A', highlight: '#F9F2F5' },
  { id: 'red', name: 'Red', text: '#E03E3E', highlight: '#FDEBEC' },
] as const

type BlockColorKind = 'text' | 'highlight' // Which mark a last-used / pick targets

/** Persisted “Last used” row for the Block style menu. */
type BlockLastColor = {
  kind: BlockColorKind
  id: string
  value: string
  label: string
}

const BLOCK_LAST_COLOR_KEY = 'thinktable-block-last-color' // localStorage key

/** Case-insensitive hex/empty match for active row highlighting. */
function colorsMatch(a: string, b: string): boolean {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase()
}

/** Read last-used block color from localStorage (null if missing/corrupt). */
function readBlockLastColor(): BlockLastColor | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(BLOCK_LAST_COLOR_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as BlockLastColor
    if (!parsed || (parsed.kind !== 'text' && parsed.kind !== 'highlight')) return null
    if (typeof parsed.label !== 'string' || typeof parsed.value !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

/** Persist last-used block color for the top of the Block style menu. */
function writeBlockLastColor(entry: BlockLastColor) {
  try {
    localStorage.setItem(BLOCK_LAST_COLOR_KEY, JSON.stringify(entry))
  } catch {
    // Ignore quota / private-mode failures
  }
}

/** Current TipTap text color (empty = default). */
export function readEditorTextColor(editor: Editor | null): string {
  if (!editor || editor.isDestroyed) return ''
  const color = editor.getAttributes('textStyle').color as string | undefined
  if (!color || colorsMatch(color, '#000000') || colorsMatch(color, '#37352f')) return ''
  return color
}

/** Current TipTap highlight color (empty = none). */
export function readEditorHighlightColor(editor: Editor | null): string {
  if (!editor || editor.isDestroyed) return ''
  if (!editor.isActive('highlight')) return ''
  return (editor.getAttributes('highlight').color as string | undefined) || ''
}

/** Apply text color or highlight to the editor selection (keeps menu open). */
export function applyBlockColor(
  editor: Editor | null,
  kind: BlockColorKind,
  value: string
): boolean {
  if (!editor || editor.isDestroyed || !editor.isEditable) return false
  const chain = editor.chain().focus()
  if (kind === 'text') {
    if (!value) chain.unsetColor().run()
    else chain.setColor(value).run()
  } else {
    if (!value) chain.unsetHighlight().run()
    else chain.setHighlight({ color: value }).run()
  }
  return true
}

/** Block style menu body — Last used / Text color / Background color (Notion list). */
export function BlockStyleMenuItems({
  editor,
  textColor,
  highlightColor,
  onApplied,
}: {
  editor: Editor | null // Active TipTap (selection / caret)
  textColor: string // Current text color for active row (empty = default)
  highlightColor: string // Current highlight for active row (empty = none)
  onApplied?: () => void // Optional bump so parent re-reads active marks
}) {
  const [lastUsed, setLastUsed] = useState<BlockLastColor | null>(null) // Last used text/highlight

  useEffect(() => {
    setLastUsed(readBlockLastColor()) // Hydrate after mount
  }, [])

  const pick = (kind: BlockColorKind, swatch: (typeof BLOCK_COLOR_SWATCHES)[number]) => {
    const value = kind === 'text' ? swatch.text : swatch.highlight
    const label =
      kind === 'text'
        ? swatch.id === 'default'
          ? 'Default text'
          : `${swatch.name} text`
        : swatch.id === 'default'
          ? 'Default background'
          : `${swatch.name} background`
    const entry: BlockLastColor = { kind, id: swatch.id, value, label }
    writeBlockLastColor(entry)
    setLastUsed(entry)
    applyBlockColor(editor, kind, value)
    onApplied?.()
  }

  const pickLast = () => {
    if (!lastUsed) return
    writeBlockLastColor(lastUsed)
    applyBlockColor(editor, lastUsed.kind, lastUsed.value)
    onApplied?.()
  }

  return (
    <div
      className="max-h-[min(70vh,420px)] overflow-y-auto py-1"
      onMouseDown={(e) => e.preventDefault()} // Keep TipTap selection while picking
    >
      <div className="px-3 pt-1 pb-1 text-[11px] font-medium text-gray-400">Last used</div>
      {lastUsed ? (
        <button
          type="button"
          className="mx-1 flex w-[calc(100%-8px)] items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-gray-900 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-[#2a2a2a]"
          onClick={(e) => {
            e.preventDefault()
            pickLast()
          }}
        >
          {lastUsed.kind === 'text' ? (
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-gray-200 bg-white text-[11px] font-semibold dark:border-gray-600 dark:bg-[#1f1f1f]"
              style={{ color: lastUsed.value || '#37352F' }}
              aria-hidden
            >
              A
            </span>
          ) : (
            <span
              className="h-5 w-5 shrink-0 rounded-[4px] border border-gray-200 dark:border-gray-600"
              style={{ backgroundColor: lastUsed.value || '#ffffff' }}
              aria-hidden
            />
          )}
          <span className="flex-1 truncate">{lastUsed.label}</span>
          <span className="text-[11px] text-gray-400 tabular-nums">⌘⇧H</span>
        </button>
      ) : (
        <div className="px-3 py-1.5 text-[12px] text-gray-400">None yet</div>
      )}

      <div className="my-1.5 mx-2 h-px bg-gray-100 dark:bg-[#2f2f2f]" />

      <div className="px-3 pt-0.5 pb-1 text-[11px] font-medium text-gray-400">Text color</div>
      {BLOCK_COLOR_SWATCHES.map((swatch) => {
        const selected = colorsMatch(textColor, swatch.text)
        return (
          <button
            key={`text-${swatch.id}`}
            type="button"
            className={cn(
              'mx-1 flex w-[calc(100%-8px)] items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-gray-900 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-[#2a2a2a]',
              selected &&
                'bg-purple-50/60 outline outline-2 outline-blue-500 outline-offset-[-1px] dark:bg-purple-950/30'
            )}
            onClick={(e) => {
              e.preventDefault()
              pick('text', swatch)
            }}
          >
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-gray-200 bg-white text-[11px] font-semibold dark:border-gray-600 dark:bg-[#1f1f1f]"
              style={{ color: swatch.text || '#37352F' }}
              aria-hidden
            >
              A
            </span>
            <span className="flex-1 truncate">
              {swatch.id === 'default' ? 'Default text' : `${swatch.name} text`}
            </span>
          </button>
        )
      })}

      <div className="my-1.5 mx-2 h-px bg-gray-100 dark:bg-[#2f2f2f]" />

      <div className="px-3 pt-0.5 pb-1 text-[11px] font-medium text-gray-400">Background color</div>
      {BLOCK_COLOR_SWATCHES.map((swatch) => {
        const selected = colorsMatch(highlightColor, swatch.highlight)
        return (
          <button
            key={`bg-${swatch.id}`}
            type="button"
            className={cn(
              'mx-1 flex w-[calc(100%-8px)] items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-gray-900 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-[#2a2a2a]',
              selected &&
                'bg-purple-50/60 outline outline-2 outline-blue-500 outline-offset-[-1px] dark:bg-purple-950/30'
            )}
            onClick={(e) => {
              e.preventDefault()
              pick('highlight', swatch)
            }}
          >
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-gray-200 dark:border-gray-600"
              style={{ backgroundColor: swatch.highlight || '#ffffff' }}
              aria-hidden
            />
            <span className="flex-1 truncate">
              {swatch.id === 'default' ? 'Default background' : `${swatch.name} background`}
            </span>
          </button>
        )
      })}
    </div>
  )
}
