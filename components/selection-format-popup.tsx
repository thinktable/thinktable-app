'use client'

// Notion-style selection format popup — visual skeleton + floating-ui edge awareness
import { useCallback, useEffect, useRef, useState } from 'react' // Hooks for selection tracking / layout
import { createPortal } from 'react-dom' // Render above React Flow transforms so edges are screen-true
import type { Editor } from '@tiptap/react' // TipTap editor instance type
import {
  autoUpdate, // Keep position fresh on scroll / resize / zoom pan
  type VirtualElement, // Selection rect acts as the floating reference for autoUpdate
} from '@floating-ui/dom'
import {
  Bold, // Bold toggle icon in format row
  Italic, // Italic toggle icon in format row
  Underline, // Underline toggle icon in format row
  Strikethrough, // Strikethrough toggle icon in format row
  Code, // Inline-code icon in format row
  Paintbrush, // Clear-formatting (moved from top bar)
  MoreHorizontal, // Overflow / more-options icon
  MessageSquare, // Comment row label icon
  Smile, // Add-reaction face icon
  Plus, // Plus badge on reaction / sticky actions
  ChevronRight, // Submenu chevron on style header
  Type, // "Normal Text" style glyph
  SquareRadical, // Equation / math icon
  PencilLine, // Suggest edits skill icon
  SlidersHorizontal, // Skills section settings icon
  Baseline, // Text-color / A glyph stand-in
  EyeOff, // Hide text action icon
  AlignLeft, // Text align left
  AlignCenter, // Text align center
  AlignRight, // Text align right
  AlignJustify, // Text align justify
  RotateCcw, // Revert text to original sent/received
} from 'lucide-react'
import { cn } from '@/lib/utils' // Conditional classes for active Hide text row
import { getMenuSafeRect } from '@/lib/menu-placement' // Same chrome-free lane as action menus
import { getSkill } from '@/lib/ai/skills'
import { requestAiSkill } from '@/lib/ai/attach-skill'

const EDGE_GAP = 8 // Gap between highlight edge and popup
const VIEWPORT_PAD = 8 // Minimum inset from the visible viewport edges

// Skills surfaced in the selection popup (opens AI chat with the pill attached)
const POPUP_SKILL_IDS = ['suggest-edits'] as const

// Shared class for each icon cell in the 5-column format grids
const ICON_CELL =
  'flex h-8 w-8 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'

/** Text-align values the alignment flyout can apply. */
const ALIGN_OPTIONS = [
  { value: 'left' as const, label: 'Left', Icon: AlignLeft }, // Default paragraph align
  { value: 'center' as const, label: 'Center', Icon: AlignCenter }, // Centered block
  { value: 'right' as const, label: 'Right', Icon: AlignRight }, // Right-aligned block
  { value: 'justify' as const, label: 'Justify', Icon: AlignJustify }, // Justified block
]

/** Compact text-color swatches (same set as the old top-bar picker). */
const TEXT_COLORS = [
  '#000000', // Black / default
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#3b82f6', // Blue
  '#a855f7', // Purple
  '#ec4899', // Pink
  '#6b7280', // Gray
] as const

/**
 * Formatting popup — marks, clear-format, and text align live here (moved off the top bar).
 */
export function SelectionFormatPopup({
  editor,
  showRevertText = false,
  canRevertText = false,
  onRevertText,
}: {
  editor: Editor | null
  /** List Revert text (chat frames; board omits until wired). */
  showRevertText?: boolean
  /** True when the host body diverges from the original sent/received text. */
  canRevertText?: boolean
  /** Restore the original prompt/response body (closes selection naturally). */
  onRevertText?: () => void
}) {
  const [, setTick] = useState(0) // Re-render when marks/align change so active styles stay in sync
  const [openFlyout, setOpenFlyout] = useState<'color' | 'align' | null>(null) // One flyout at a time
  const isHazed = !!editor?.isActive('haze') // Selection already has haze mark

  useEffect(() => {
    if (!editor) return
    const bump = () => setTick((n) => n + 1) // Force active-state refresh after each transaction
    editor.on('transaction', bump)
    return () => {
      editor.off('transaction', bump)
    }
  }, [editor])

  const run = (fn: () => void) => {
    if (!editor || editor.isDestroyed) return
    fn() // Keep selection; mousedown on chrome already preventDefault
  }

  const handleHideText = () => {
    run(() => editor!.chain().focus().toggleHaze().run()) // Toggle frost on the current selection
  }

  const attachPopupSkill = (skillId: string) => {
    requestAiSkill({
      skillId,
      mode: skillId === 'suggest-edits' ? 'edit' : undefined,
    })
  }

  const currentAlign = ALIGN_OPTIONS.find((o) => editor?.isActive({ textAlign: o.value })) ?? ALIGN_OPTIONS[0] // Icon for current align
  const AlignIcon = currentAlign.Icon // Show the active alignment glyph

  return (
    // Outer card: translucent menu surface, light border, soft shadow, ~Notion corner radius.
    // `z-0` is load-bearing: it gives the card a stacking context so the `.tt-menu-surface`
    // wash pane (`z-index: -1`) sits behind the rows rather than behind the whole popup.
    <div
      className="tt-menu-surface relative z-0 w-[220px] select-none overflow-visible rounded-lg border border-gray-200 text-[13px] text-gray-900 shadow-lg dark:border-[#2f2f2f] dark:text-gray-100"
      onMouseDown={(e) => {
        // Keep TipTap selection alive when interacting with the popup chrome
        e.preventDefault()
      }}
    >
      {/* Style header — opens block-type submenu later */}
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
        tabIndex={-1}
      >
        <Type className="h-4 w-4 shrink-0 text-gray-600 dark:text-gray-300" />
        <span className="flex-1 font-medium">Normal Text</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
      </button>

      {/* Divider under style header */}
      <div className="mx-2 border-t border-gray-100 dark:border-[#2f2f2f]" />

      {/* Format row 1: color, bold, italic, underline, clear (paintbrush) */}
      <div className="flex items-center justify-between gap-0.5 px-2 py-1.5">
        <button
          type="button"
          className={cn(ICON_CELL, openFlyout === 'color' && 'bg-gray-100 dark:bg-gray-800')}
          tabIndex={-1}
          title="Color"
          onClick={() => setOpenFlyout((s) => (s === 'color' ? null : 'color'))}
        >
          <Baseline className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={cn(ICON_CELL, editor?.isActive('bold') && 'bg-gray-100 dark:bg-gray-800')}
          tabIndex={-1}
          title="Bold"
          onClick={() => run(() => editor!.chain().focus().toggleBold().run())}
        >
          <Bold className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={cn(ICON_CELL, editor?.isActive('italic') && 'bg-gray-100 dark:bg-gray-800')}
          tabIndex={-1}
          title="Italic"
          onClick={() => run(() => editor!.chain().focus().toggleItalic().run())}
        >
          <Italic className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={cn(ICON_CELL, editor?.isActive('underline') && 'bg-gray-100 dark:bg-gray-800')}
          tabIndex={-1}
          title="Underline"
          onClick={() => run(() => editor!.chain().focus().toggleUnderline().run())}
        >
          <Underline className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={ICON_CELL}
          tabIndex={-1}
          title="Clear formatting"
          onClick={() => run(() => editor!.chain().focus().clearNodes().unsetAllMarks().run())}
        >
          <Paintbrush className="h-4 w-4" />
        </button>
      </div>

      {/* Format row 2: align, strike, code, equation, more */}
      <div className="flex items-center justify-between gap-0.5 px-2 pb-1.5">
        <button
          type="button"
          className={cn(ICON_CELL, openFlyout === 'align' && 'bg-gray-100 dark:bg-gray-800')}
          tabIndex={-1}
          title="Align"
          onClick={() => setOpenFlyout((s) => (s === 'align' ? null : 'align'))}
        >
          <AlignIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={cn(ICON_CELL, editor?.isActive('strike') && 'bg-gray-100 dark:bg-gray-800')}
          tabIndex={-1}
          title="Strikethrough"
          onClick={() => run(() => editor!.chain().focus().toggleStrike().run())}
        >
          <Strikethrough className="h-4 w-4" />
        </button>
        <button type="button" className={ICON_CELL} tabIndex={-1} title="Code">
          <Code className="h-4 w-4" />
        </button>
        <button type="button" className={ICON_CELL} tabIndex={-1} title="Equation">
          <SquareRadical className="h-4 w-4" />
        </button>
        <button type="button" className={ICON_CELL} tabIndex={-1} title="More">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      {/* Color flyout — sits beside the format card */}
      {openFlyout === 'color' && (
        <div className="tt-menu-surface absolute left-full top-10 z-[1001] ml-1 w-[168px] rounded-lg border border-gray-200 p-2 shadow-lg dark:border-[#2f2f2f]">
          <div className="grid grid-cols-5 gap-1.5">
            {TEXT_COLORS.map((hex) => {
              const active = editor?.getAttributes('textStyle').color === hex || (!editor?.getAttributes('textStyle').color && hex === '#000000')
              return (
                <button
                  key={hex}
                  type="button"
                  title={hex}
                  className={cn(
                    'h-6 w-6 rounded border border-gray-200 dark:border-gray-600',
                    active && 'ring-2 ring-offset-1 ring-gray-400'
                  )}
                  style={{ backgroundColor: hex }}
                  onClick={() => {
                    run(() => {
                      if (hex === '#000000') editor!.chain().focus().unsetColor().run()
                      else editor!.chain().focus().setColor(hex).run()
                    })
                    setOpenFlyout(null)
                  }}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Align flyout — left / center / right / justify */}
      {openFlyout === 'align' && (
        <div className="tt-menu-surface absolute left-full top-20 z-[1001] ml-1 min-w-[140px] rounded-lg border border-gray-200 p-1 shadow-lg dark:border-[#2f2f2f]">
          {ALIGN_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={cn(
                'flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm hover:bg-gray-100 dark:hover:bg-[#2a2a2a]',
                editor?.isActive({ textAlign: opt.value }) && 'bg-blue-50 dark:bg-blue-950/40'
              )}
              onClick={() => {
                run(() => editor!.chain().focus().setTextAlign(opt.value).run())
                setOpenFlyout(null)
              }}
            >
              <opt.Icon className="h-4 w-4 text-gray-500" />
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Divider before interaction row */}
      <div className="mx-2 border-t border-gray-100 dark:border-[#2f2f2f]" />

      {/* Comment / reaction / sticky row */}
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
          tabIndex={-1}
        >
          <MessageSquare className="h-4 w-4 shrink-0 text-gray-600 dark:text-gray-300" />
          <span>Comment</span>
        </button>
        <button
          type="button"
          className={ICON_CELL}
          tabIndex={-1}
          title="Add reaction"
        >
          <span className="relative inline-flex">
            <Smile className="h-4 w-4" />
            <Plus className="absolute -right-1.5 -top-1 h-2.5 w-2.5" strokeWidth={3} />
          </span>
        </button>
        <button
          type="button"
          className={ICON_CELL}
          tabIndex={-1}
          title="Suggest edits"
          onClick={() => attachPopupSkill('suggest-edits')}
        >
          <PencilLine className="h-4 w-4" />
        </button>
      </div>

      {/* Hide text — applies frost mark to the selection */}
      <div className="px-1 pb-1">
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800',
            isHazed && 'bg-gray-50 dark:bg-gray-800'
          )}
          tabIndex={-1}
          onClick={handleHideText}
        >
          <EyeOff className="h-4 w-4 shrink-0 text-gray-600 dark:text-gray-300" />
          <span>{isHazed ? 'Unhide text' : 'Hide text'}</span>
        </button>
        {showRevertText ? (
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800',
              !canRevertText && 'pointer-events-none opacity-40'
            )}
            tabIndex={-1}
            disabled={!canRevertText}
            title={
              canRevertText
                ? 'Restore the original sent or received text'
                : 'No edits to revert'
            }
            onClick={() => {
              if (!canRevertText || !onRevertText) return
              onRevertText()
            }}
          >
            <RotateCcw className="h-4 w-4 shrink-0 text-gray-600 dark:text-gray-300" />
            <span>Revert text</span>
          </button>
        ) : null}
      </div>

      {/* Divider before Skills */}
      <div className="mx-2 border-t border-gray-100 dark:border-[#2f2f2f]" />

      {/* Skills header */}
      <div className="flex items-center justify-between px-3 pb-1 pt-2">
        <span className="text-xs font-medium text-gray-400">Skills</span>
        <button type="button" className="rounded p-0.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800" tabIndex={-1}>
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Skills list */}
      <div className="px-1 pb-1">
        {POPUP_SKILL_IDS.map((skillId) => {
          const skill = getSkill(skillId)
          if (!skill?.enabled) return null
          return (
            <button
              key={skillId}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
              tabIndex={-1}
              onClick={() => attachPopupSkill(skillId)}
            >
              {skillId === 'suggest-edits' && (
                <PencilLine className="h-4 w-4 shrink-0 text-gray-600 dark:text-gray-300" />
              )}
              <span>{skill.name}</span>
            </button>
          )
        })}
      </div>

      {/* Divider before Edit with AI */}
      <div className="mx-2 border-t border-gray-100 dark:border-[#2f2f2f]" />

      {/* Edit with AI footer */}
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
        tabIndex={-1}
      >
        <span className="font-medium">Edit with AI</span>
        <span className="text-xs tracking-wide text-gray-400">⌘⌃E</span>
      </button>
    </div>
  )
}

/** Visible client rects for the current DOM selection (empty → null). */
function getSelectionClientRects(): DOMRect[] | null {
  const nativeSelection = window.getSelection()
  if (!nativeSelection || nativeSelection.rangeCount === 0) return null
  const range = nativeSelection.getRangeAt(0)
  if (!range.toString().trim()) return null
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0)
  if (rects.length > 0) return rects
  const fallback = range.getBoundingClientRect()
  if (fallback.width === 0 && fallback.height === 0) return null
  return [fallback]
}

/** Viewport boundary used for edge fits (map pane ∩ chrome-free lane). */
function getBoundaryRect(): DOMRect {
  const safe = getMenuSafeRect() // Below top bar, above chat, left of chat column
  const pane = document.querySelector('.react-flow') as HTMLElement | null // Map column when present
  if (!pane) return new DOMRect(safe.left, safe.top, safe.width, safe.height) // Window minus chrome
  const p = pane.getBoundingClientRect() // Pane box
  const left = Math.max(p.left, safe.left) // Don't leave the map or the safe lane
  const top = Math.max(p.top, safe.top)
  const right = Math.min(p.right, safe.right)
  const bottom = Math.min(p.bottom, safe.bottom)
  return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top)) // Intersection
}

/** Clamp popup top so the full card stays inside the boundary. */
function clampTop(preferredTop: number, popupH: number, boundary: DOMRect): number {
  const minTop = boundary.top + VIEWPORT_PAD
  const maxTop = boundary.bottom - VIEWPORT_PAD - popupH
  if (maxTop < minTop) return minTop // Boundary shorter than popup — pin to top pad
  return Math.min(Math.max(preferredTop, minTop), maxTop)
}

/** Clamp popup left so the full card stays inside the boundary. */
function clampLeft(preferredLeft: number, popupW: number, boundary: DOMRect): number {
  const minLeft = boundary.left + VIEWPORT_PAD
  const maxLeft = boundary.right - VIEWPORT_PAD - popupW
  if (maxLeft < minLeft) return minLeft
  return Math.min(Math.max(preferredLeft, minLeft), maxLeft)
}

/** True when popup width fits to the right of this rect's right edge. */
function fitsRightOf(rect: DOMRect, popupW: number, boundary: DOMRect): boolean {
  return rect.right + EDGE_GAP + popupW <= boundary.right - VIEWPORT_PAD
}

/** True when popup width fits to the left of this rect's left edge. */
function fitsLeftOf(rect: DOMRect, popupW: number, boundary: DOMRect): boolean {
  return rect.left - EDGE_GAP - popupW >= boundary.left + VIEWPORT_PAD
}

/** Find the board panel/item that owns this selection (not the text block). */
function getSelectionItemRect(containerEl?: HTMLElement | null): DOMRect | null {
  const fromContainer = containerEl?.closest('[data-panel-container="true"]') as HTMLElement | null
  if (fromContainer) return fromContainer.getBoundingClientRect()

  const nativeSelection = window.getSelection()
  const range = nativeSelection?.rangeCount ? nativeSelection.getRangeAt(0) : null
  const anchorNode = range?.commonAncestorContainer
  const anchorEl = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement
  const panel = anchorEl?.closest('[data-panel-container="true"]') as HTMLElement | null
  if (panel) return panel.getBoundingClientRect()
  return null
}

/**
 * Place beside the right edge of the panel/item.
 * Vertically aligns with the selection, then clamps into view.
 */
function placeRightOfItem(
  itemRect: DOMRect,
  selectionTop: number,
  popupW: number,
  popupH: number,
  boundary: DOMRect
) {
  return {
    left: clampLeft(itemRect.right + EDGE_GAP, popupW, boundary),
    top: clampTop(selectionTop, popupH, boundary),
  }
}

/**
 * Place beside the left edge of the panel/item.
 */
function placeLeftOfItem(
  itemRect: DOMRect,
  selectionTop: number,
  popupW: number,
  popupH: number,
  boundary: DOMRect
) {
  return {
    left: clampLeft(itemRect.left - EDGE_GAP - popupW, popupW, boundary),
    top: clampTop(selectionTop, popupH, boundary),
  }
}

/**
 * Place at the end of the highlighted text (last client rect's trailing edge).
 * Prefers just after the end; clamps into the boundary if the end is near a screen edge.
 */
function placeAtSelectionEnd(endRect: DOMRect, popupW: number, popupH: number, boundary: DOMRect) {
  let left = endRect.right + EDGE_GAP
  if (!fitsRightOf(endRect, popupW, boundary) && fitsLeftOf(endRect, popupW, boundary)) {
    left = endRect.left - EDGE_GAP - popupW // Flip to just before the end glyph when right is tight
  }
  return {
    left: clampLeft(left, popupW, boundary),
    top: clampTop(endRect.top, popupH, boundary),
  }
}

/**
 * Resolve popup viewport position from the live selection.
 * - One line → at end of highlighted text
 * - Multiple rows → right of panel/item edge → left of panel/item edge → end of text
 */
function resolveSelectionPopupPosition(
  popupW: number,
  popupH: number,
  containerEl?: HTMLElement | null
): { top: number; left: number } | null {
  const rects = getSelectionClientRects()
  if (!rects) return null

  const boundary = getBoundaryRect()
  const endRect = rects[rects.length - 1] // Trailing edge of the highlight

  // Always prefer the RIGHT edge of the frame/item when there's room, then left, then end of text.
  // (Single- and multi-line alike anchor to the frame so the popup sits opposite the ⋮⋮ handle menu.)
  const itemRect = getSelectionItemRect(containerEl)
  const selectionTop = Math.min(...rects.map((r) => r.top)) // Keep vertical alignment with the highlight
  if (itemRect) {
    if (fitsRightOf(itemRect, popupW, boundary)) {
      return placeRightOfItem(itemRect, selectionTop, popupW, popupH, boundary)
    }
    if (fitsLeftOf(itemRect, popupW, boundary)) {
      return placeLeftOfItem(itemRect, selectionTop, popupW, popupH, boundary)
    }
  }
  return placeAtSelectionEnd(endRect, popupW, popupH, boundary)
}

/** Virtual element for autoUpdate — tracks the selection end rect. */
function getSelectionVirtualElement(): VirtualElement | null {
  const rects = getSelectionClientRects()
  if (!rects) return null
  const endRect = rects[rects.length - 1]
  const nativeSelection = window.getSelection()
  const range = nativeSelection?.rangeCount ? nativeSelection.getRangeAt(0) : null

  return {
    getBoundingClientRect: () => endRect,
    contextElement: range
      ? (range.commonAncestorContainer instanceof Element
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement ?? undefined)
      : undefined,
  }
}

/**
 * Anchors SelectionFormatPopup per selection shape:
 * single line → end of text; multi-line → right/left of panel item → end.
 * Portals with position:fixed so React Flow transforms do not skew edge math.
 */
export function SelectionFormatPopupAnchor({
  editor,
  containerRef,
  showRevertText = false,
  canRevertText = false,
  onRevertText,
}: {
  editor: Editor | null // Active TipTap editor for this panel section
  containerRef: React.RefObject<HTMLDivElement | null> // TipTapContent root (ownership / click tests)
  /** List Revert text (chat frames). */
  showRevertText?: boolean
  /** True when the host body diverges from the original sent/received text. */
  canRevertText?: boolean
  /** Restore the original prompt/response body. */
  onRevertText?: () => void
}) {
  const [showPopup, setShowPopup] = useState(false) // Whether a valid selection is active
  const [isNavigating, setIsNavigating] = useState(false) // Hide while the board pans/zooms; return when nav stops
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0 }) // Viewport (fixed) coords
  const [savedSelection, setSavedSelection] = useState<{ from: number; to: number } | null>(null) // Preserve range across blur
  const popupRef = useRef<HTMLDivElement>(null) // Floating element for autoUpdate + hit tests
  const cleanupAutoUpdateRef = useRef<(() => void) | null>(null) // Dispose autoUpdate on hide
  const userClearedSelectionRef = useRef(false) // Skip restore when user intentionally collapses

  // Measure popup and apply single-line / multi-line placement rules
  const placePopup = useCallback(() => {
    const floatingEl = popupRef.current
    if (!floatingEl) return

    const measured = floatingEl.getBoundingClientRect()
    const popupW = measured.width || 220
    const popupH = measured.height || 360
    const next = resolveSelectionPopupPosition(popupW, popupH, containerRef.current)
    if (!next) return
    setPopupPosition({ top: Math.round(next.top), left: Math.round(next.left) })
  }, [containerRef])

  // Show/hide from TipTap selection; start autoUpdate while visible
  useEffect(() => {
    if (!editor) return

    const syncFromSelection = () => {
      const { from, to } = editor.state.selection
      if (from === to || from >= to) {
        cleanupAutoUpdateRef.current?.()
        cleanupAutoUpdateRef.current = null
        setShowPopup(false)
        return
      }

      const selectedText = editor.state.doc.textBetween(from, to).trim()
      if (!selectedText) {
        cleanupAutoUpdateRef.current?.()
        cleanupAutoUpdateRef.current = null
        setShowPopup(false)
        return
      }

      const reference = getSelectionVirtualElement()
      if (!reference) {
        cleanupAutoUpdateRef.current?.()
        cleanupAutoUpdateRef.current = null
        setShowPopup(false)
        return
      }

      // Prefer focused editor; allow unfocused only if no other editor owns a selection
      if (!editor.view.hasFocus()) {
        const allEditors = document.querySelectorAll('.ProseMirror')
        for (const editorEl of allEditors) {
          if (editorEl === editor.view.dom) continue
          if (editorEl === document.activeElement || editorEl.contains(document.activeElement)) {
            const sel = window.getSelection()
            if (sel && sel.rangeCount > 0 && sel.getRangeAt(0).toString().trim().length > 0) {
              cleanupAutoUpdateRef.current?.()
              cleanupAutoUpdateRef.current = null
              setShowPopup(false)
              return
            }
          }
        }
      }

      setSavedSelection({ from, to })
      setShowPopup(true)

      // Restore selection if popup mount stole focus/range
      requestAnimationFrame(() => {
        const current = editor.state.selection
        if (current.from === current.to) {
          editor.commands.setTextSelection({ from, to })
        }
      })
    }

    const handleEditorUpdate = () => {
      requestAnimationFrame(syncFromSelection)
    }

    editor.on('selectionUpdate', handleEditorUpdate)
    editor.on('update', handleEditorUpdate)
    document.addEventListener('selectionchange', handleEditorUpdate)
    syncFromSelection()

    return () => {
      editor.off('selectionUpdate', handleEditorUpdate)
      editor.off('update', handleEditorUpdate)
      document.removeEventListener('selectionchange', handleEditorUpdate)
      cleanupAutoUpdateRef.current?.()
      cleanupAutoUpdateRef.current = null
    }
  }, [editor])

  // While visible, autoUpdate position from the live selection
  useEffect(() => {
    if (!showPopup || !popupRef.current) return

    const floatingEl = popupRef.current
    const reference: VirtualElement = {
      getBoundingClientRect: () => {
        const live = getSelectionVirtualElement()
        return live?.getBoundingClientRect() ?? new DOMRect()
      },
    }

    cleanupAutoUpdateRef.current?.()
    cleanupAutoUpdateRef.current = autoUpdate(reference, floatingEl, () => {
      placePopup()
    }, {
      ancestorScroll: true,
      ancestorResize: true,
      elementResize: true,
      animationFrame: true, // Follow React Flow pan/zoom every frame while open
    })

    placePopup() // Immediate place on show

    return () => {
      cleanupAutoUpdateRef.current?.()
      cleanupAutoUpdateRef.current = null
    }
  }, [showPopup, placePopup])

  // Hide the popup while the board is navigating (pan/zoom), re-show once the viewport settles
  useEffect(() => {
    if (!showPopup) return
    // The React Flow viewport transform mutates on every pan/zoom frame — watch it as the nav signal
    const viewportEl = document.querySelector('.react-flow__viewport') as HTMLElement | null
    if (!viewportEl) return

    let settleTimer: number | undefined // Debounce: nav is "stopped" after a quiet gap
    const observer = new MutationObserver(() => {
      setIsNavigating(true) // Any transform change → treat as active navigation → hide
      if (settleTimer !== undefined) window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        setIsNavigating(false) // No transform change for the gap → nav stopped → reveal again
        placePopup() // Re-anchor to the settled selection position
      }, 150) // Short enough to feel instant, long enough to span momentum/settle frames
    })
    observer.observe(viewportEl, { attributes: true, attributeFilter: ['style'] }) // Only the transform style

    return () => {
      observer.disconnect()
      if (settleTimer !== undefined) window.clearTimeout(settleTimer)
      setIsNavigating(false) // Reset so a re-open isn't stuck hidden
    }
  }, [showPopup, placePopup])

  // Detect intentional collapse clicks inside the editor so we don't fight the user
  useEffect(() => {
    if (!showPopup || !savedSelection || !editor) return

    const handleEditorClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const isInEditor = editor.view.dom.contains(target)
      const isInPopup = popupRef.current?.contains(target)
      if (isInEditor && !isInPopup) {
        userClearedSelectionRef.current = true
        setSavedSelection(null)
        setTimeout(() => {
          userClearedSelectionRef.current = false
        }, 200)
      }
    }

    editor.view.dom.addEventListener('mousedown', handleEditorClick, true)
    return () => {
      editor.view.dom.removeEventListener('mousedown', handleEditorClick, true)
    }
  }, [showPopup, savedSelection, editor])

  // Keep selection alive while the popup is open
  useEffect(() => {
    if (!showPopup || !savedSelection || !editor) return

    const checkSelection = () => {
      if (userClearedSelectionRef.current) return
      const current = editor.state.selection
      if (current.from === current.to && savedSelection.from !== savedSelection.to) {
        editor.commands.setTextSelection({ from: savedSelection.from, to: savedSelection.to })
      }
    }

    const interval = setInterval(checkSelection, 100)
    const handleSelectionUpdate = () => {
      requestAnimationFrame(checkSelection)
    }
    editor.on('selectionUpdate', handleSelectionUpdate)

    return () => {
      clearInterval(interval)
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [showPopup, savedSelection, editor])

  // Close when clicking outside editor + popup
  useEffect(() => {
    if (!showPopup || !editor) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      const isInPopup = popupRef.current?.contains(target)
      const isInEditor = editor.view.dom.contains(target)
      // Also ignore clicks inside this editor's container (handles padding chrome)
      const isInContainer = containerRef.current?.contains(target)
      if (!isInPopup && !isInEditor && !isInContainer) {
        setShowPopup(false)
        setSavedSelection(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showPopup, editor, containerRef])

  if (!showPopup || typeof document === 'undefined') return null

  // Portal to body so React Flow overflow/transform cannot clip or skew edge math
  return createPortal(
    <div
      ref={popupRef}
      className="pointer-events-auto fixed z-[10000]"
      style={{
        top: `${popupPosition.top}px`,
        left: `${popupPosition.left}px`,
        // Stay mounted (so we can measure/re-place) but disappear while the board is being navigated
        visibility: isNavigating ? 'hidden' : 'visible',
        pointerEvents: isNavigating ? 'none' : 'auto',
      }}
    >
      <SelectionFormatPopup
        editor={editor}
        showRevertText={showRevertText}
        canRevertText={canRevertText}
        onRevertText={onRevertText}
      />
    </div>,
    document.body
  )
}
