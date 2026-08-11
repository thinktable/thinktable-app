'use client'

// ⋮⋮ on each TipTap **block** (not the host **frame**). Click selects the block (+ menu);
// drag moves that block only when it is already selected — otherwise RF drags the frame. See DEFINITIONS.md.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { GripVertical } from 'lucide-react' // ⋮⋮ grip; between-block add is a short centered hairline
import { useReactFlow, useStore } from 'reactflow' // screenToFlowPosition when extracting a line onto the map; useStore = live zoom to keep grips screen-constant
import { useQueryClient } from '@tanstack/react-query' // Refresh panels after extract-to-card
import { createClient } from '@/lib/supabase/client' // Persist a new map card from a dragged line
import { newBlockMetadata } from '@/lib/blocks' // Canonical isBlock metadata for extracted cards
import { cn } from '@/lib/utils'
import { elementUniformScale, screenToLocal } from '@/lib/dom-transform' // Rotation-safe local↔screen
import {
  BlockActionsMenu,
  type BlockActionId,
  type BlockActionPayload,
  type BlockTypeId,
  type BoardInTarget,
} from '@/components/block-actions-menu'
import {
  deleteEditorBlockRange,
  findContentBlockDropTarget,
  findEditorBlockAtClientY,
  findEditorBlockAtPos,
  findHostEditorAtPoint,
  htmlForEditorRange,
  isHandleBlockType,
  jsonForEditorRange,
  moveEditorBlockToPos,
  refineListBlockType,
  registerHostEditor,
  setEditorBlockHighlight,
  setEditorBlockHighlightRanges,
  turnEditorBlockInto,
  unregisterHostEditor,
  wrapJsonForInsert,
  type EditorBlockRef,
} from '@/lib/tiptap/block-selection'
import { setAiBlockSelection } from '@/lib/ai/selection-bridge' // Live block pills in AI composer (⋮⋮ only)
import { htmlToPlain } from '@/lib/ai/context-pack' // Block hover preview from HTML
import {
  createChildBoardForBlock,
  insertBoardTitleBlock,
  replaceBlockWithBoardLink,
  titleForBlock,
} from '@/lib/tiptap/board-blocks' // Block → linked page (inline boardLink node)

type HandleLayout = {
  top: number // CSS px relative to host gutter container
  height: number
  firstLineH: number // First-line box height (local px) — grip centers vertically on the first line
  lineCenter: number // Vertical center of the FIRST rendered text line (local px) — where the grip sits
  block: EditorBlockRef
}

type TipTapBlockHandlesProps = {
  editor: Editor | null
  enabled?: boolean // Off for flashcards / project boards
  isPanelSelected?: boolean // Host frame must be selected before ⋮⋮ can drag a block
  hostNodeId?: string // Host **frame** RF id — Page promote / extract target
  conversationId?: string // Page id — extract a block onto the page as its own frame
  boardInTargets?: BoardInTarget[]
  onPageTurnInto?: (blockType: 'board' | 'boardIn', boardInParentId?: string | null) => void
}

type DropLine = { top: number; left: number; width: number } // Viewport dashed insert marker
const GRIP_W = 20 // Matches ⋮⋮ `w-5` — insert line uses the same width
const HANDLE_GUTTER = 24 // Text starts here (row `pl-6`), in local px — where the ⋮⋮ column lives
const GRIP_H = 24 // ⋮⋮ button height (`h-6`) — used to vertically center it on the first line
const GUTTER_EDGE_PAD = 6 // Extra gutter height so top/bottom hairlines stay inside the hover group

/** True when a TipTap block range contains an aiPending mark. */
function blockHasAiPending(editor: Editor, block: EditorBlockRef): boolean {
  let found = false
  editor.state.doc.nodesBetween(block.from, block.to, (node) => {
    if (found) return false
    if (node.isText && node.marks.some((m) => m.type.name === 'aiPending')) {
      found = true
      return false
    }
    return true
  })
  return found
}

/** All handle-blocks in the doc that contain a pending AI edit span. */
function collectAiPendingBlocks(editor: Editor): EditorBlockRef[] {
  const out: EditorBlockRef[] = []
  editor.state.doc.descendants((node, pos) => {
    const name = node.type.name
    if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') return true
    if (!isHandleBlockType(name)) return true
    const block: EditorBlockRef = {
      from: pos,
      to: pos + node.nodeSize,
      node,
      typeName: name,
    }
    if (blockHasAiPending(editor, block)) out.push(block)
    if (name === 'listItem' || name === 'taskItem') return false
    return true
  })
  return out
}

/** Resolve the DOM element for a ProseMirror block (handles sit beside this). */
function blockDom(editor: Editor, block: EditorBlockRef): HTMLElement | null {
  const node = editor.view.nodeDOM(block.from)
  if (node instanceof HTMLElement) return node
  if (node?.parentElement instanceof HTMLElement) return node.parentElement
  return null
}


/** Topmost non-empty client rect from a Range — the FIRST visual text line (not a flex-centered icon). */
function topmostClientRect(el: HTMLElement): DOMRect | null {
  try {
    const r = el.ownerDocument.createRange()
    r.selectNodeContents(el)
    const rects = r.getClientRects()
    let best: DOMRect | null = null
    for (let i = 0; i < rects.length; i++) {
      const fr = rects[i]
      if (fr.height <= 0 || fr.width <= 0) continue
      if (!best || fr.top < best.top) best = fr
    }
    return best
  } catch {
    return null
  }
}

/**
 * Measure grip Y from the block’s first line into the host gutter container.
 */
function layoutForBlock(
  editor: Editor,
  container: HTMLElement,
  block: EditorBlockRef
): HandleLayout | null {
  try {
    const root = container
    const el = blockDom(editor, block)

    const dbHeader = el
      ? ((el.querySelector?.('.tt-database-block-row') as HTMLElement | null) ||
          (el.querySelector?.('.tt-database-block-label') as HTMLElement | null))
      : null
    const pageLabel = el?.querySelector?.('.tt-board-link-label') as HTMLElement | null
    const textEl = dbHeader || pageLabel || el

    // Always pin to first-line mid via screen→local on the layout root (rotation-safe)
    if (textEl) {
      const lh = parseFloat(getComputedStyle(textEl).lineHeight)
      const fr = topmostClientRect(textEl)
      let firstLineH =
        Number.isFinite(lh) && lh > 0 ? lh : fr && fr.height > 0 ? Math.min(fr.height, 28) : 22
      let lineCenter: number
      if (fr && fr.height > 0) {
        const isDb = !!(dbHeader || el?.classList?.contains?.('tt-database-block'))
        const useTop = isDb || fr.height > firstLineH * 2
        const midY = useTop ? fr.top + Math.min(firstLineH, fr.height) / 2 : (fr.top + fr.bottom) / 2
        lineCenter = screenToLocal(root, (fr.left + fr.right) / 2, midY).y
        if (!(Number.isFinite(lh) && lh > 0)) {
          firstLineH = Math.min(Math.max(14, fr.height), 28)
        }
      } else {
        const start = editor.view.coordsAtPos(block.from + 1)
        lineCenter = screenToLocal(root, start.left, (start.top + start.bottom) / 2).y
      }
      return {
        top: lineCenter - firstLineH / 2,
        height: firstLineH,
        firstLineH,
        lineCenter,
        block,
      }
    }

    const start = editor.view.coordsAtPos(block.from + 1)
    const end = editor.view.coordsAtPos(Math.max(block.from + 1, block.to - 1))
    const startLocal = screenToLocal(root, start.left, start.top)
    const endLocal = screenToLocal(root, end.left, end.bottom)
    const top = startLocal.y
    const height = Math.max(22, Math.abs(endLocal.y - startLocal.y))
    const lineCenter = screenToLocal(root, start.left, (start.top + start.bottom) / 2).y
    return {
      top,
      height,
      firstLineH: Math.min(height, 28),
      lineCenter,
      block,
    }
  } catch {
    return null
  }
}

/** Host **frame** that owns this editor (full width hover target — RF node DOM). */
function frameForEditor(dom: HTMLElement): HTMLElement {
  return (dom.closest('.react-flow__node') as HTMLElement | null) ?? dom.parentElement ?? dom
}

export function TipTapBlockHandles({
  editor,
  enabled = true,
  isPanelSelected = false,
  hostNodeId,
  conversationId,
  boardInTargets = [],
  onPageTurnInto,
}: TipTapBlockHandlesProps) {
  const { screenToFlowPosition } = useReactFlow() // Drop-on-page → flow coords for a new frame
  const rfZoom = useStore((s) => s.transform[2] || 1) // Live zoom — re-render on board zoom so grips can counter-scale to a constant screen size
  const queryClient = useQueryClient() // Refetch messages after extract
  const [hover, setHover] = useState<HandleLayout | null>(null) // Handle beside hovered block
  const [aiPendingBlocks, setAiPendingBlocks] = useState<EditorBlockRef[]>([]) // Blocks with rainbow AI edits
  const [focusLayout, setFocusLayout] = useState<HandleLayout | null>(null) // Handle beside focused/caret block
  const [menu, setMenu] = useState<{
    x: number // viewport
    y: number
    block: EditorBlockRef
    blockType: BlockTypeId
    openLeft: boolean // Anchor menu to the left of the frame when there's room
  } | null>(null)
  const [dropLine, setDropLine] = useState<DropLine | null>(null) // Dashed insert line while dragging a content block
  const [ghost, setGhost] = useState<{ x: number; y: number; text: string; width: number } | null>(null) // Floating preview of the dragged line
  // In-frame multi-block selection (Shift = range, Cmd/Ctrl = toggle). Empty = no multi-selection.
  // A plain ⋮⋮ click also arms a single-block selection so a later drag can move that block.
  const [selection, setSelection] = useState<EditorBlockRef[]>([])
  const selectionRef = useRef<EditorBlockRef[]>([]) // Latest selection for click handlers
  selectionRef.current = selection
  const anchorRef = useRef<EditorBlockRef | null>(null) // Anchor block for Shift range-select
  // Keep latest layouts in refs so transaction refresh doesn’t need stale state
  const hoverRef = useRef<HandleLayout | null>(null)
  const focusRef = useRef<HandleLayout | null>(null)
  hoverRef.current = hover
  focusRef.current = focusLayout
  // Click vs drag on the ⋮⋮ grip — drag moves the **block** only when it is already selected
  const gripPointerRef = useRef<{ x: number; y: number; dragged: boolean } | null>(null)
  const draggingRef = useRef(false) // Freeze hover/handle while a content-block drag is live

  // Register this frame’s editor so ⋮⋮ block-drag can drop into it (and unregister on unmount)
  useEffect(() => {
    if (!editor || !hostNodeId || editor.isDestroyed) return
    registerHostEditor(hostNodeId, editor)
    return () => {
      unregisterHostEditor(hostNodeId, editor)
      setAiBlockSelection(null) // Drop AI block pill if this frame unmounts
    }
  }, [editor, hostNodeId])

  // Keep ⋮⋮ grips visible + rainbow-styled for blocks with pending AI edits
  useEffect(() => {
    if (!editor || !enabled || editor.isDestroyed) {
      setAiPendingBlocks([])
      return
    }
    const refresh = () => setAiPendingBlocks(collectAiPendingBlocks(editor))
    refresh()
    editor.on('transaction', refresh)
    return () => {
      editor.off('transaction', refresh)
    }
  }, [editor, enabled])

  // Drop block wash + selection + menu (frame deselect, click away, etc.)
  const clearBlockSelection = useCallback(() => {
    if (editor) setEditorBlockHighlight(editor, null) // Wipe single + multi wash
    setSelection([])
    anchorRef.current = null
    setMenu(null)
    if (hostNodeId) setAiBlockSelection(null) // Drop AI block pill when disarmed
  }, [editor, hostNodeId])

  // Close the actions menu only — keep the block selection so a follow-up ⋮⋮ drag can move it
  const closeMenu = useCallback(() => {
    setMenu(null)
  }, [])

  // Frame deselected → drop any armed block selection (no block drag without a selected frame)
  useEffect(() => {
    if (isPanelSelected) return
    clearBlockSelection()
  }, [isPanelSelected, clearBlockSelection])

  // Apply a multi-block selection: update state + paint the multi-range wash.
  // Only ⋮⋮ handle selection publishes a block pill — I-bar/caret alone stays "Selected frame".
  // Same-frame multi-block still publishes ONE AI context pill (not one per block).
  const applySelection = useCallback(
    (blocks: EditorBlockRef[]) => {
      setSelection(blocks)
      if (editor) setEditorBlockHighlightRanges(editor, blocks.map((b) => ({ from: b.from, to: b.to })))
      if (!hostNodeId) return
      if (blocks.length === 0) {
        setAiBlockSelection(null)
        return
      }
      // Join armed block plain text for the context-pill hover preview
      const preview = blocks
        .map((b) => {
          if (!editor) return ''
          return htmlToPlain(htmlForEditorRange(editor, b.from, b.to))
        })
        .filter(Boolean)
        .join('\n')
      setAiBlockSelection({
        frameId: hostNodeId,
        count: blocks.length,
        preview,
      })
    },
    [editor, hostNodeId]
  )

  // All handle-blocks whose range lies between two clicked blocks (Shift range-select, same frame).
  const collectBlocksBetween = useCallback(
    (a: EditorBlockRef, b: EditorBlockRef): EditorBlockRef[] => {
      if (!editor || editor.isDestroyed) return [b]
      const lo = Math.min(a.from, b.from)
      const hi = Math.max(a.to, b.to)
      const out: EditorBlockRef[] = []
      editor.state.doc.descendants((node, pos) => {
        const name = node.type.name
        if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') return true
        if (!isHandleBlockType(name)) return true
        if (pos >= lo && pos + node.nodeSize <= hi) {
          out.push({ from: pos, to: pos + node.nodeSize, node, typeName: name })
        }
        if (name === 'listItem' || name === 'taskItem') return false // item is the unit
        return true
      })
      return out.length ? out : [b]
    },
    [editor]
  )

  // Show handle when pointer Y is in a block’s band — anywhere across the full frame width
  useEffect(() => {
    if (!editor || !enabled || editor.isDestroyed) return
    const dom = editor.view.dom
    const container = dom.parentElement
    if (!container) return
    const frame = frameForEditor(dom)

    const resolveFromPoint = (clientX: number, clientY: number, target: EventTarget | null) => {
      if (menu || draggingRef.current) return // Keep handle on the open-menu / in-drag block
      const el = target as HTMLElement | null
      // Pointer on grip / gutter / add-line / menu — keep current hover (CSS shows add lines)
      if (
        el?.closest?.(
          '[data-tt-block-handle], [data-tt-gutter-hover], [data-tt-insert-line], .block-actions-menu'
        )
      ) {
        return
      }
      // Rotate/lock/wrap lives under the node but outside content — never treat as content hover
      if (el?.closest?.('[data-frame-chrome]')) {
        setHover(null)
        return
      }

      // Only while over this map-card frame (full width)
      if (!frame.contains(el) && el !== frame) {
        const fr = frame.getBoundingClientRect()
        if (
          clientX < fr.left ||
          clientX > fr.right ||
          clientY < fr.top ||
          clientY > fr.bottom
        ) {
          setHover(null)
          return
        }
      }

      const block = findEditorBlockAtClientY(editor, clientY)
      if (!block) {
        setHover(null)
        return
      }
      setHover(layoutForBlock(editor, container, block))
    }

    const onMove = (event: MouseEvent) => {
      resolveFromPoint(event.clientX, event.clientY, event.target)
    }

    const onLeave = (event: MouseEvent) => {
      if (menu || draggingRef.current) return
      const related = event.relatedTarget as HTMLElement | null
      if (
        related?.closest?.(
          '[data-tt-block-handle], [data-tt-gutter-hover], [data-tt-insert-line], .block-actions-menu'
        )
      ) {
        return
      }
      if (related?.closest?.('[data-frame-chrome]')) {
        setHover(null)
        return
      }
      if (related && frame.contains(related)) return
      setHover(null)
    }

    frame.addEventListener('mousemove', onMove)
    frame.addEventListener('mouseleave', onLeave)
    return () => {
      frame.removeEventListener('mousemove', onMove)
      frame.removeEventListener('mouseleave', onLeave)
    }
  }, [editor, enabled, menu])

  // Keep a handle beside the block that owns the caret (cursor placed → handle stays without hover)
  useEffect(() => {
    if (!editor || !enabled || editor.isDestroyed) return
    const container = editor.view.dom.parentElement
    if (!container) return

    // Same block + ~same geometry → keep prior layout object (avoids RO/transaction setState thrash)
    const sameLayout = (prev: HandleLayout | null, next: HandleLayout | null) =>
      !!prev &&
      !!next &&
      prev.block.from === next.block.from &&
      Math.abs(prev.top - next.top) < 0.5 &&
      Math.abs(prev.height - next.height) < 0.5 &&
      Math.abs(prev.lineCenter - next.lineCenter) < 0.5

    const syncFocus = () => {
      if (menu) return
      if (!editor.isFocused) return // blur handler decides whether to clear
      const block = findEditorBlockAtPos(editor, editor.state.selection.from)
      if (!block) {
        setFocusLayout(null)
        return
      }
      const next = layoutForBlock(editor, container, block)
      setFocusLayout((prev) => (sameLayout(prev, next) ? prev : next))
    }

    const onBlur = ({ event }: { event?: FocusEvent }) => {
      if (menu) return
      const related = event?.relatedTarget as HTMLElement | null
      // Keep handle when focus moves to the grip / add-line / actions menu
      if (
        related?.closest?.(
          '[data-tt-block-handle], [data-tt-gutter-hover], [data-tt-insert-line], .block-actions-menu'
        )
      ) {
        return
      }
      setFocusLayout(null)
    }

    // Re-measure after typing / Enter / zoom-driven reflow so grips stay glued to lines
    const refreshLayouts = () => {
      if (menu) {
        const next = layoutForBlock(editor, container, menu.block)
        if (next) {
          setHover((prev) => (sameLayout(prev, next) ? prev : next))
          setFocusLayout((prev) => (sameLayout(prev, next) ? prev : next))
        }
        return
      }
      const h = hoverRef.current
      if (h) {
        const next = layoutForBlock(editor, container, h.block)
        if (next) setHover((prev) => (sameLayout(prev, next) ? prev : next))
        else setHover(null)
      }
      syncFocus()
    }

    editor.on('selectionUpdate', syncFocus)
    editor.on('focus', syncFocus)
    editor.on('blur', onBlur)
    editor.on('transaction', refreshLayouts)
    syncFocus()

    // RF zoom / panel grow changes getBoundingClientRect without a TipTap transaction
    const ro = new ResizeObserver(() => {
      refreshLayouts()
    })
    ro.observe(container)
    const frame = frameForEditor(editor.view.dom)
    if (frame !== container) ro.observe(frame)

    return () => {
      editor.off('selectionUpdate', syncFocus)
      editor.off('focus', syncFocus)
      editor.off('blur', onBlur)
      editor.off('transaction', refreshLayouts)
      ro.disconnect()
    }
  }, [editor, enabled, menu])

  // Outside click: dismiss menu + clear armed block selection (unless clicking another grip / the menu)
  useEffect(() => {
    if (!menu && selection.length === 0) return // Nothing armed
    const onDoc = (event: MouseEvent) => {
      const t = event.target as HTMLElement
      if (t.closest?.('.block-actions-menu, [data-tt-block-handle]')) return
      clearBlockSelection()
    }
    document.addEventListener('mousedown', onDoc, true)
    return () => document.removeEventListener('mousedown', onDoc, true)
  }, [menu, selection.length, clearBlockSelection])

  // Prefer opening the actions menu to the LEFT of the frame (the ⋮⋮ handle lives in the left gutter);
  // fall back to the default right-of-handle spot when there isn't room on the left.
  const menuPlacement = useCallback(
    (clientX: number, clientY: number): { x: number; y: number; openLeft: boolean } => {
      if (!editor) return { x: clientX, y: clientY, openLeft: false }
      const frameRect = frameForEditor(editor.view.dom).getBoundingClientRect() // Host frame bounds
      const MENU_W = 248 // Approx BlockActionsMenu width (min-w 240 + border/padding)
      const GAP = 8 // Breathing room between menu and frame edge
      // Room for the whole card between the viewport edge and the frame's left edge?
      if (frameRect.left - GAP - MENU_W >= 0) return { x: frameRect.left, y: clientY, openLeft: true }
      return { x: clientX, y: clientY, openLeft: false }
    },
    [editor]
  )

  const openForBlock = useCallback(
    (block: EditorBlockRef, clientX: number, clientY: number) => {
      if (!editor) return
      // Arm this block for a follow-up ⋮⋮ drag (selection persists after the menu closes)
      applySelection([block])
      anchorRef.current = block
      const blockType = refineListBlockType(editor, block)
      setMenu({ ...menuPlacement(clientX, clientY), block, blockType })
      const container = editor.view.dom.parentElement
      const layout = container ? layoutForBlock(editor, container, block) : null
      if (layout) {
        setHover(layout)
        setFocusLayout(layout)
      }
    },
    [editor, menuPlacement, applySelection]
  )

  // Between-block add line: click inserts an empty paragraph at that line’s doc edge
  const onInsertLineClick = useCallback(
    (e: React.MouseEvent, insertPos: number) => {
      // Unselected frame: let RF select/drag — do not insert or place a caret
      if (!isPanelSelected) return
      e.stopPropagation() // Don't bubble to frame / RF
      e.preventDefault()
      if (!editor || editor.isDestroyed) return
      editor
        .chain()
        .insertContentAt(insertPos, { type: 'paragraph' }) // New empty block at the gap
        .setTextSelection(insertPos + 1) // Caret inside the new block
        .focus()
        .run()
    },
    [editor, isPanelSelected]
  )

  // True when this block was armed by a prior ⋮⋮ click (single or multi) — only then may ⋮⋮ drag it
  const isBlockArmed = useCallback(
    (block: EditorBlockRef) => selectionRef.current.some((b) => b.from === block.from),
    []
  )

  // Block drag only when frame + this block are selected; otherwise let RF drag the frame
  const onGripPointerDown = useCallback((e: ReactPointerEvent, target?: EditorBlockRef) => {
    if (e.button !== 0 || !editor) return // Left button + live editor
    const block = target ?? (hover ?? focusLayout)?.block
    if (!block) return
    // Frame not selected, or block not armed via ⋮⋮ click → do not steal the pointer (RF drags the frame)
    if (!isPanelSelected || !isBlockArmed(block)) {
      gripPointerRef.current = { x: e.clientX, y: e.clientY, dragged: false }
      return // No stopPropagation / no nodrag path — frame moves
    }
    e.stopPropagation() // Armed block drag — never start RF frame drag from ⋮⋮
    // Modifier+click is a multi-select gesture (handled in onClick) — don't start a drag
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      gripPointerRef.current = { x: e.clientX, y: e.clientY, dragged: false }
      return
    }
    gripPointerRef.current = { x: e.clientX, y: e.clientY, dragged: false } // Baseline for click vs drag
    setMenu(null) // Dismiss actions while dragging the armed block
    const sourceHostId = hostNodeId // Frame this block currently lives in
    const sourceFrom = block.from // Snapshot — docs shift after delete
    const sourceTo = block.to
    const ghostText = editor.state.doc.textBetween(sourceFrom, sourceTo, ' ').trim() || ' ' // Preview label
    const ghostWidth = Math.max(80, Math.min(360, ghostText.length * 8)) // Approximate line width
    setEditorBlockHighlight(editor, { from: sourceFrom, to: sourceTo }) // Keep blue wash while dragging

    const onMove = (ev: PointerEvent) => {
      const start = gripPointerRef.current
      if (!start) return
      const dx = ev.clientX - start.x
      const dy = ev.clientY - start.y
      if (!start.dragged) {
        if (dx * dx + dy * dy <= 16) return // Still a click
        start.dragged = true // Crossed ~4px → content-block drag
        draggingRef.current = true // Freeze ⋮⋮ beside this line
      }
      setGhost({ x: ev.clientX, y: ev.clientY, text: ghostText, width: ghostWidth }) // Follow pointer
      const hit = findHostEditorAtPoint(ev.clientX, ev.clientY)
      if (!hit) {
        setDropLine(null) // Over empty canvas — extract on drop
        return
      }
      const dropTarget = findContentBlockDropTarget(hit.editor, ev.clientY)
      if (!dropTarget) {
        setDropLine(null)
        return
      }
      // Hide the line if it would insert the block back into itself
      if (hit.hostNodeId === sourceHostId && dropTarget.insertPos >= sourceFrom && dropTarget.insertPos <= sourceTo) {
        setDropLine(null)
        return
      }
      setDropLine({ top: dropTarget.lineTop, left: dropTarget.lineLeft, width: dropTarget.lineWidth }) // Dashed insert marker
    }

    const onUp = async (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      const start = gripPointerRef.current
      const didDrag = !!start?.dragged
      draggingRef.current = false
      setDropLine(null)
      setGhost(null)
      if (!didDrag) return // Click handler opens the actions menu
      if (editor.isDestroyed) return

      const hit = findHostEditorAtPoint(ev.clientX, ev.clientY)
      const payload = jsonForEditorRange(editor, sourceFrom, sourceTo)
      if (payload.length === 0) {
        clearBlockSelection()
        return
      }

      if (hit && hit.hostNodeId === sourceHostId) {
        const dropTarget = findContentBlockDropTarget(hit.editor, ev.clientY)
        if (dropTarget) moveEditorBlockToPos(editor, sourceFrom, sourceTo, dropTarget.insertPos) // Reorder in this frame
        clearBlockSelection()
        return
      }

      if (hit && hit.hostNodeId !== sourceHostId) {
        const dropTarget = findContentBlockDropTarget(hit.editor, ev.clientY)
        const insertPos = dropTarget?.insertPos ?? hit.editor.state.doc.content.size
        let toInsert = payload // List items stay bare inside a list
        try {
          const $ins = hit.editor.state.doc.resolve(Math.min(insertPos, hit.editor.state.doc.content.size))
          const inList =
            $ins.parent.type.name === 'bulletList' ||
            $ins.parent.type.name === 'orderedList' ||
            $ins.parent.type.name === 'taskList'
          if (!inList) toInsert = wrapJsonForInsert(editor, block, payload) // Doc-level needs a list wrapper
        } catch {
          toInsert = wrapJsonForInsert(editor, block, payload)
        }
        const inserted = hit.editor.chain().focus().insertContentAt(insertPos, toInsert).run()
        if (inserted) deleteEditorBlockRange(editor, sourceFrom, sourceTo) // Leave source frame
        clearBlockSelection()
        return
      }

      // Drop on empty **page** → new **frame** with this block’s HTML
      if (!conversationId) {
        clearBlockSelection()
        return
      }
      const html = htmlForEditorRange(editor, sourceFrom, sourceTo)
      const flow = screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          clearBlockSelection()
          return
        }
        const { error } = await supabase.from('messages').insert({
          conversation_id: conversationId,
          user_id: user.id,
          role: 'user',
          content: html, // This block becomes the new frame body
          metadata: newBlockMetadata({
            position: { x: flow.x, y: flow.y }, // Drop point
            fadeIn: true,
          }),
        })
        if (error) {
          console.error('Error extracting content block:', error)
          clearBlockSelection()
          return
        }
        deleteEditorBlockRange(editor, sourceFrom, sourceTo) // Remove from source after persist
        await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
        await queryClient.refetchQueries({ queryKey: ['messages-for-panels', conversationId] })
      } catch (err) {
        console.error('Error extracting content block:', err)
      }
      clearBlockSelection()
    }

    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
  }, [
    clearBlockSelection,
    conversationId,
    editor,
    focusLayout,
    hostNodeId,
    hover,
    isBlockArmed,
    isPanelSelected,
    queryClient,
    screenToFlowPosition,
  ])

  // Single block → linked page: create a child page seeded with this block's content,
  // then replace the block with an inline boardLink node (icon LEFT of the link text).
  const turnBlockIntoBoard = useCallback(
    async (block: EditorBlockRef, blockType: 'board' | 'boardIn', boardInParentId?: string | null) => {
      if (!editor || editor.isDestroyed || !conversationId) return
      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return
        const bodyHtml = htmlForEditorRange(editor, block.from, block.to) // Seed page body
        const title = titleForBlock(editor, block) // First-line label
        const parentId =
          blockType === 'boardIn' && boardInParentId ? boardInParentId : conversationId // Nest target
        const boardId = await createChildBoardForBlock(supabase, {
          userId: user.id,
          parentId,
          sourceMessageId: hostNodeId ?? '',
          title,
          bodyHtml,
        })
        if (!boardId) return
        replaceBlockWithBoardLink(editor, block, { boardId, title, icon: null, variant: 'inline' })
        await queryClient.invalidateQueries({ queryKey: ['conversations'] })
        await queryClient.refetchQueries({ queryKey: ['conversations'] })
      } catch (err) {
        console.error('Failed to turn block into page:', err)
      }
    },
    [editor, conversationId, hostNodeId, queryClient]
  )

  // Multiple selected blocks → one linked page (snapshot: blocks stay, a title boardLink is added on top).
  const turnSelectionIntoBoard = useCallback(
    async (blocks: EditorBlockRef[], blockType: 'board' | 'boardIn', boardInParentId?: string | null) => {
      if (!editor || editor.isDestroyed || !conversationId || blocks.length === 0) return
      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return
        const ordered = [...blocks].sort((a, b) => a.from - b.from) // Document order
        const bodyHtml = ordered.map((b) => htmlForEditorRange(editor, b.from, b.to)).join('') // Combined body
        const title = titleForBlock(editor, ordered[0]) // Seed from first block
        const parentId = blockType === 'boardIn' && boardInParentId ? boardInParentId : conversationId
        const boardId = await createChildBoardForBlock(supabase, {
          userId: user.id,
          parentId,
          sourceMessageId: hostNodeId ?? '',
          title,
          bodyHtml,
        })
        if (!boardId) return
        insertBoardTitleBlock(editor, { boardId, title, icon: null, variant: 'title' }) // Title link on top of frame
        await queryClient.invalidateQueries({ queryKey: ['conversations'] })
        await queryClient.refetchQueries({ queryKey: ['conversations'] })
      } catch (err) {
        console.error('Failed to turn selection into page:', err)
      }
    },
    [editor, conversationId, hostNodeId, queryClient]
  )

  const onAction = useCallback(
    (action: BlockActionId, payload?: BlockActionPayload) => {
      if (!editor || !menu) return
      // Group actions apply to the whole multi-selection (highest → lowest keeps positions valid)
      const sel = selectionRef.current
      const isMulti = sel.length > 1
      const ordered = isMulti
        ? [...sel].sort((a, b) => b.from - a.from) // Reverse doc order for safe range edits
        : [menu.block]

      if (action === 'turnInto' && payload?.blockType) {
        if (payload.blockType === 'board' || payload.blockType === 'boardIn') {
          if (isMulti) void turnSelectionIntoBoard(sel, payload.blockType, payload.boardInParentId)
          else void turnBlockIntoBoard(menu.block, payload.blockType, payload.boardInParentId)
          clearBlockSelection()
          return
        }
        for (const b of ordered) turnEditorBlockInto(editor, b, payload.blockType) // Per-block transform
        clearBlockSelection()
        return
      }
      if (action === 'duplicate') {
        for (const b of ordered) {
          const slice = editor.state.doc.slice(b.from, b.to)
          editor.chain().focus().insertContentAt(b.to, slice.content.toJSON()).run()
        }
        clearBlockSelection()
        return
      }
      if (action === 'delete') {
        for (const b of ordered) deleteEditorBlockRange(editor, b.from, b.to)
        clearBlockSelection()
        return
      }
      if (action === 'copyLink' && hostNodeId) {
        const url = `${window.location.href.split('?')[0]}?block=${hostNodeId}&pos=${menu.block.from}`
        void navigator.clipboard.writeText(url).catch(() => {})
        clearBlockSelection()
        return
      }
      clearBlockSelection()
    },
    [editor, menu, clearBlockSelection, turnBlockIntoBoard, turnSelectionIntoBoard, hostNodeId]
  )

  // Grip click: plain = arm block + actions menu; Shift/⌘ = multi-select.
  // Unselected frame: do not steal the click — RF selects the frame first.
  const onGripClick = useCallback(
    (e: React.MouseEvent, block: EditorBlockRef) => {
      const start = gripPointerRef.current
      gripPointerRef.current = null
      if (start?.dragged) return // Drag moved this block — don't open the menu
      // Frame not selected yet → let the click bubble so RF selects the frame (no block menu)
      if (!isPanelSelected) return
      e.stopPropagation()
      e.preventDefault()
      if (!editor) return
      if (e.shiftKey) {
        const anchor = anchorRef.current ?? block
        applySelection(collectBlocksBetween(anchor, block)) // All blocks in between (same frame)
        if (!anchorRef.current) anchorRef.current = block
        return
      }
      if (e.metaKey || e.ctrlKey) {
        const cur = selectionRef.current
        const exists = cur.some((b) => b.from === block.from)
        applySelection(exists ? cur.filter((b) => b.from !== block.from) : [...cur, block]) // Toggle
        anchorRef.current = block
        return
      }
      // Plain click on a block that's part of a multi-selection → group actions menu (keep wash)
      const cur = selectionRef.current
      if (cur.length > 1 && cur.some((b) => b.from === block.from)) {
        const blockType = refineListBlockType(editor, block)
        setMenu({ ...menuPlacement(e.clientX, e.clientY), block, blockType })
        return
      }
      // Arm this single block + open its menu (follow-up ⋮⋮ drag can move it)
      openForBlock(block, e.clientX, e.clientY)
    },
    [editor, applySelection, collectBlocksBetween, openForBlock, menuPlacement, isPanelSelected]
  )

  if (!editor || !enabled) return null

  // Grips render for every selected block (persistent wash) + the hovered/caret/menu block.
  const container = editor.view.dom.parentElement
  // Local→screen scale (RF zoom × frameScale) measured off the container; grips live in local px
  // inside these transforms, so counter-scaling by 1/scale keeps them a constant SCREEN size
  // (like the portaled actions menu). `rfZoom` in deps forces this to re-measure on zoom.
  void rfZoom // Referenced so zoom changes re-render this component (measurement below reads live DOM)
  const localToScreen = container ? elementUniformScale(container) : 1 // Rotation-safe (not AABB height ratio)
  void localToScreen
  // Horizontal: keep the grip CENTERED in the gutter — midway between the frame's left edge (local 0)
  // and the block's text left (local HANDLE_GUTTER).
  const gutterCenterLeft = HANDLE_GUTTER / 2 - GRIP_W / 2 // Left so the grip's center sits at gutter mid
  const gripLayouts = new Map<number, HandleLayout>() // keyed by block.from (dedupe)
  if (container) {
    for (const b of selection) {
            // Re-measure fresh from live DOM
      const gl = layoutForBlock(editor, container, b)
      if (gl) gripLayouts.set(b.from, gl)
    }
    for (const b of aiPendingBlocks) {
      if (gripLayouts.has(b.from)) continue
      const gl = layoutForBlock(editor, container, b)
      if (gl) gripLayouts.set(b.from, gl)
    }
  }
  const hoverLayout =
    hover
      ? hover
      : focusLayout
        ? focusLayout
        : null
  if (hoverLayout && !gripLayouts.has(hoverLayout.block.from) && container) {
    // Refresh Y from live DOM
    const fresh = layoutForBlock(editor, container, hoverLayout.block)
    if (fresh) gripLayouts.set(fresh.block.from, fresh)
  }
  if (menu && container && !gripLayouts.has(menu.block.from)) {
    const ml = layoutForBlock(editor, container, menu.block)
    if (ml) gripLayouts.set(menu.block.from, ml)
  }
  // Menu count reflects the group when the menu block is part of a multi-selection
  const menuCount =
    menu && selection.length > 1 && selection.some((b) => b.from === menu.block.from)
      ? selection.length
      : 1

  return (
    <>
      {Array.from(gripLayouts.values()).map((gl) => {
        // nodrag only when this block is armed — otherwise RF must receive the pointer to drag the frame
        const armed = isPanelSelected && isBlockArmed(gl.block)
        const aiPending = blockHasAiPending(editor, gl.block)
        // First-line band only — do NOT grow with wrapped multi-line text (add lines stay by the ⋮⋮)
        const lineH = Math.max(gl.firstLineH || GRIP_H, GRIP_H)
        const firstLineTop = gl.lineCenter - lineH / 2
        const gutterTop = firstLineTop - GUTTER_EDGE_PAD
        const gutterH = lineH + GUTTER_EDGE_PAD * 2
        const gripTopInGutter = gl.lineCenter - gutterTop
        const gripRoot = container
        const uniformScale = gripRoot ? elementUniformScale(gripRoot) : 1
        const gripChromeScale = 1 / Math.max(1, Math.sqrt(uniformScale))
        const grip = (
          <div
            key={gl.block.from}
            data-tt-gutter-hover
            data-tt-block-handle
            className="group/gutter absolute z-[59] pointer-events-auto"
            style={{
              left: gutterCenterLeft,
              top: gutterTop,
              width: GRIP_W,
              height: gutterH,
            }}
          >
            {isPanelSelected ? (
              <>
                <button
                  type="button"
                  data-tt-insert-line
                  title="Add block"
                  aria-label="Add block above"
                  className={cn(
                    'group/insert absolute left-0 right-0 top-0 z-[1] h-3',
                    'nodrag nopan cursor-pointer',
                    'opacity-0 group-hover/gutter:opacity-100'
                  )}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => onInsertLineClick(e, gl.block.from)}
                >
                  <span
                    className={cn(
                      'pointer-events-none absolute left-1/2 top-0 h-px w-3 -translate-x-1/2 rounded-full',
                      'bg-gray-200 transition-colors group-hover/insert:bg-black/35',
                      'dark:bg-gray-600 dark:group-hover/insert:bg-white/40'
                    )}
                    aria-hidden
                    style={{ transform: `translateX(-50%) scale(${gripChromeScale})` }}
                  />
                </button>
                <button
                  type="button"
                  data-tt-insert-line
                  title="Add block"
                  aria-label="Add block below"
                  className={cn(
                    'group/insert absolute left-0 right-0 bottom-0 z-[1] h-3',
                    'nodrag nopan cursor-pointer',
                    'opacity-0 group-hover/gutter:opacity-100'
                  )}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => onInsertLineClick(e, gl.block.to)}
                >
                  <span
                    className={cn(
                      'pointer-events-none absolute left-1/2 bottom-0 h-px w-3 -translate-x-1/2 rounded-full',
                      'bg-gray-200 transition-colors group-hover/insert:bg-black/35',
                      'dark:bg-gray-600 dark:group-hover/insert:bg-white/40'
                    )}
                    aria-hidden
                    style={{ transform: `translateX(-50%) scale(${gripChromeScale})` }}
                  />
                </button>
              </>
            ) : null}
            <div
              role="button"
              tabIndex={0}
              data-tt-block-handle
              data-ai-pending-handle={aiPending ? 'true' : undefined}
              className={cn(
                'absolute left-0 z-[2] w-5 h-6 flex items-center justify-center rounded',
                armed ? 'nodrag nopan' : 'nopan',
                aiPending
                  ? 'tt-ai-pending-handle text-violet-600 dark:text-violet-300'
                  : 'text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-black/5 dark:hover:bg-white/10',
                'pointer-events-auto cursor-grab active:cursor-grabbing select-none'
              )}
              style={{
                top: gripTopInGutter,
                transform: `translateY(-50%) scale(${gripChromeScale})`,
                transformOrigin: 'center',
              }}
              title={
                armed
                  ? 'Drag to move block · click for actions · Shift/⌘-click to multi-select'
                  : isPanelSelected
                    ? 'Click to select block · drag moves frame'
                    : 'Drag to move frame · click to select frame'
              }
              onPointerDown={(e) => onGripPointerDown(e, gl.block)}
              onClick={(e) => onGripClick(e, gl.block)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                if (!isPanelSelected) return
                e.preventDefault()
                openForBlock(
                  gl.block,
                  e.currentTarget.getBoundingClientRect().right,
                  e.currentTarget.getBoundingClientRect().top
                )
              }}
            >
              <GripVertical className="h-4 w-4 pointer-events-none" />
            </div>
          </div>
        )
        return grip
      })}

      {dropLine &&
        createPortal(
          <div
            data-tt-drop-line
            className="pointer-events-none fixed z-[80]"
            style={{
              top: dropLine.top - 1, // Center the 2px marker on the insert edge
              left: dropLine.left,
              width: Math.max(48, dropLine.width), // Always wide enough to see
              height: 2,
              backgroundImage: 'repeating-linear-gradient(90deg, #3b82f6 0 6px, transparent 6px 10px)', // Dashed insert line
            }}
          />,
          document.body
        )}

      {ghost &&
        createPortal(
          <div
            data-tt-block-drag-ghost
            className="pointer-events-none fixed z-[81] rounded bg-blue-500/15 px-2 py-0.5 text-sm text-gray-800 shadow-sm dark:text-gray-100"
            style={{
              left: ghost.x + 12,
              top: ghost.y - 10,
              width: ghost.width,
              maxWidth: 360,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            {ghost.text}
          </div>,
          document.body
        )}

      {menu &&
        createPortal(
          <BlockActionsMenu
            x={menu.x}
            y={menu.y}
            zoom={1}
            positionMode="fixed"
            openLeft={menu.openLeft}
            currentBlockType={menu.blockType}
            boardInTargets={boardInTargets}
            showAddChild={false}
            selectedCount={menuCount}
            canUngroup={false}
            onAction={onAction}
            onClose={closeMenu}
          />,
          document.body
        )}
    </>
  )
}
