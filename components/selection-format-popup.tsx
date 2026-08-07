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
  Link, // Insert-link icon in format row
  Code, // Inline-code icon in format row
  RemoveFormatting, // Clear-formatting icon in format row
  MoreHorizontal, // Overflow / more-options icon
  MessageSquare, // Comment row label icon
  Smile, // Add-reaction face icon
  Plus, // Plus badge on reaction / sticky actions
  ChevronRight, // Submenu chevron on style header
  Type, // "Normal Text" style glyph
  SquareRadical, // Equation / math icon
  StickyNote, // Suggest-edit / sticky action icon
  SlidersHorizontal, // Skills section settings icon
  Baseline, // Text-color / A glyph stand-in
  EyeOff, // Hide text action icon
} from 'lucide-react'
import { cn } from '@/lib/utils' // Conditional classes for active Hide text row

const EDGE_GAP = 8 // Gap between highlight edge and popup
const VIEWPORT_PAD = 8 // Minimum inset from the visible viewport edges
const ROW_TOP_TOLERANCE = 3 // Client rects within this Y delta count as the same visual row

// Static Skills list shown in the Notion-style AI section (labels only for now)
const SKILL_LABELS = [
  'Improve writing', // Placeholder skill row
  'Proofread', // Placeholder skill row
  'Explain', // Placeholder skill row
  'Reformat', // Placeholder skill row
] as const

// Shared class for each icon cell in the 5-column format grids
const ICON_CELL =
  'flex h-8 w-8 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'

/**
 * Formatting popup chrome. Hide text is wired; other controls stay visual-only for now.
 */
export function SelectionFormatPopup({ editor }: { editor: Editor | null }) {
  const isHazed = !!editor?.isActive('haze') // Selection already has haze mark

  const handleHideText = () => {
    if (!editor || editor.isDestroyed) return
    editor.chain().focus().toggleHaze().run() // Toggle frost on the current selection
  }

  return (
    // Outer card: white surface, light border, soft shadow, ~Notion corner radius
    <div
      className="w-[220px] select-none overflow-hidden rounded-lg border border-gray-200 bg-white text-[13px] text-gray-900 shadow-lg dark:border-[#2f2f2f] dark:bg-[#1f1f1f] dark:text-gray-100"
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

      {/* Format row 1: color, bold, italic, underline, clear */}
      <div className="flex items-center justify-between gap-0.5 px-2 py-1.5">
        <button type="button" className={ICON_CELL} tabIndex={-1} title="Color">
          <Baseline className="h-4 w-4" />
        </button>
        <button type="button" className={ICON_CELL} tabIndex={-1} title="Bold">
          <Bold className="h-4 w-4" />
        </button>
        <button type="button" className={ICON_CELL} tabIndex={-1} title="Italic">
          <Italic className="h-4 w-4" />
        </button>
        <button type="button" className={ICON_CELL} tabIndex={-1} title="Underline">
          <Underline className="h-4 w-4" />
        </button>
        <button type="button" className={ICON_CELL} tabIndex={-1} title="Clear formatting">
          <RemoveFormatting className="h-4 w-4" />
        </button>
      </div>

      {/* Format row 2: link, strike, code, equation, more */}
      <div className="flex items-center justify-between gap-0.5 px-2 pb-1.5">
        <button type="button" className={ICON_CELL} tabIndex={-1} title="Link">
          <Link className="h-4 w-4" />
        </button>
        <button type="button" className={ICON_CELL} tabIndex={-1} title="Strikethrough">
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
          title="Suggest edit"
        >
          <StickyNote className="h-4 w-4" />
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

      {/* Skills list — labels only */}
      <div className="px-1 pb-1">
        {SKILL_LABELS.map((label) => (
          <button
            key={label}
            type="button"
            className="flex w-full rounded-md px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
            tabIndex={-1}
          >
            {label}
          </button>
        ))}
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

/** Count distinct visual rows from selection client rects. */
function countSelectionRows(rects: DOMRect[]): number {
  const rowTops: number[] = []
  for (const rect of rects) {
    const matchesExisting = rowTops.some((top) => Math.abs(top - rect.top) <= ROW_TOP_TOLERANCE)
    if (!matchesExisting) rowTops.push(rect.top)
  }
  return rowTops.length
}

/** Viewport boundary used for edge fits (React Flow pane when present). */
function getBoundaryRect(): DOMRect {
  const pane = document.querySelector('.react-flow') as HTMLElement | null
  if (pane) return pane.getBoundingClientRect()
  return new DOMRect(0, 0, window.innerWidth, window.innerHeight)
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
  const isMultiLine = countSelectionRows(rects) > 1

  if (!isMultiLine) {
    return placeAtSelectionEnd(endRect, popupW, popupH, boundary)
  }

  // Multi-line: anchor to the panel/item edges (not the text-block bounding box)
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
}: {
  editor: Editor | null // Active TipTap editor for this panel section
  containerRef: React.RefObject<HTMLDivElement | null> // TipTapContent root (ownership / click tests)
}) {
  const [showPopup, setShowPopup] = useState(false) // Whether a valid selection is active
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
      }}
    >
      <SelectionFormatPopup editor={editor} />
    </div>,
    document.body
  )
}
