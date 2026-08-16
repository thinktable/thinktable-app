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
import { isBlockContentEmpty, newBlockMetadata } from '@/lib/blocks' // Canonical isBlock metadata + empty check
import { bodyHtmlWithoutBoardTitle } from '@/lib/blocks/turn-into' // Title line ≠ board body block
import { cn } from '@/lib/utils'
import { screenToLocal } from '@/lib/dom-transform' // Rotation-safe screen→local (frame rotate)
import {
  BlockActionsMenu,
  type BlockActionId,
  type BlockActionPayload,
  type BlockTypeId,
  type BoardInTarget,
  type PropertyTypeId,
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
  turnEditorBlockIntoProperty,
  unregisterHostEditor,
  wrapJsonForInsert,
  type EditorBlockRef,
} from '@/lib/tiptap/block-selection'
import { collectPropertyBlocks } from '@/lib/tiptap/property-block' // Top icon row is one block; ⋮⋮ arms all property cells
import { setAiBlockSelection } from '@/lib/ai/selection-bridge' // Live block pills in AI composer (⋮⋮ only)
import { htmlToPlain } from '@/lib/ai/context-pack' // Block hover preview from HTML
import { type NotionSyncMode } from '@/lib/blocks' // Connections ⋮⋮ → Live Sync / Manual
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
  blockTop: number // Full block box top (local px) — add-block hairlines share a neighbor mid-gap
  blockBottom: number // Full block box bottom (local px) — wrapped lines / tall atoms included
  block: EditorBlockRef
  propertyHeader?: boolean // Top icon list — one block; from/to span all property cells
  connectionsHeader?: boolean // Bottom Notion/connectors strip — chrome-only block (no TipTap range)
  insertFrom?: number // Add-block hairline above (header uses first cell)
  insertTo?: number // Add-block hairline below (header uses last cell)
}

type TipTapBlockHandlesProps = {
  editor: Editor | null
  enabled?: boolean // Off for flashcards / project boards
  isPanelSelected?: boolean // Host frame must be selected before ⋮⋮ can drag a block
  hostNodeId?: string // Host **frame** RF id — Page promote / extract target
  conversationId?: string // Page id — extract a block onto the page as its own frame
  boardInTargets?: BoardInTarget[]
  onPageTurnInto?: (blockType: 'board' | 'boardIn', boardInParentId?: string | null) => void
  onPropertyTurnInto?: (propertyType: PropertyTypeId) => void // Turn into → Property
  notionConnected?: boolean // Notion-connected frame → slimmer block ⋮⋮ menu + connections strip grip
  notionSync?: NotionSyncMode // Live Sync vs Manual — connections ⋮⋮ menu
  onNotionConnection?: (next: { connected: boolean; sync?: NotionSyncMode }) => void // Connections ⋮⋮ actions
  /** contentFit paddingLeft — absolute grips originate inside the padded content box, not the fill edge */
  contentPadLeft?: number
  /** Host locked-resize scale — CSS transform skips ResizeObserver; re-measure when it changes */
  frameScale?: number
  /** Blue adjust L gutter width in flow px — local ⋮⋮ left = this / frameScale so it fits after CSS scale */
  handleGutterFlow?: number
}

/** Measure grip Y from the top property-icon row (one block for the whole list). */
function layoutForPropertyHeader(
  container: HTMLElement,
  block: EditorBlockRef,
  insertFrom: number,
  insertTo: number
): HandleLayout | null {
  // Header may live in the panel’s top chrome band (outside the fill) — search the host frame.
  const frame = container.closest('.react-flow__node') as HTMLElement | null
  const header = (
    frame?.querySelector('[data-tt-property-header]') ||
    container.querySelector('[data-tt-property-header]')
  ) as HTMLElement | null
  if (!header) return null // Strip not mounted
  const fr = header.getBoundingClientRect()
  if (fr.height <= 0) return null
  const mid = screenToLocal(container, (fr.left + fr.right) / 2, (fr.top + fr.bottom) / 2)
  const firstLineH = Math.min(Math.max(14, fr.height), 28) // Same band as a one-line block
  return {
    top: mid.y - firstLineH / 2,
    height: firstLineH,
    firstLineH,
    lineCenter: mid.y,
    blockTop: mid.y - firstLineH / 2, // Icon strip is a single band — no wrapped-line box
    blockBottom: mid.y + firstLineH / 2,
    block, // Range covering all property cells so drag/menu act on the list
    propertyHeader: true,
    insertFrom, // Hairline above the first property cell
    insertTo, // Hairline below the last property cell
  }
}

/** Measure grip Y from the bottom connections strip (Notion / connectors — chrome-only block). */
function layoutForConnectionsHeader(
  container: HTMLElement,
  block: EditorBlockRef
): HandleLayout | null {
  // Strip may live in the panel’s bottom chrome band (outside the fill) — search the host frame.
  const frame = container.closest('.react-flow__node') as HTMLElement | null
  const header = (
    frame?.querySelector('[data-tt-connections-header]') ||
    container.querySelector('[data-tt-connections-header]')
  ) as HTMLElement | null
  if (!header) return null // Strip not mounted
  const fr = header.getBoundingClientRect()
  if (fr.height <= 0) return null
  const mid = screenToLocal(container, (fr.left + fr.right) / 2, (fr.top + fr.bottom) / 2)
  const firstLineH = Math.min(Math.max(14, fr.height), 28) // Same band as a one-line block
  return {
    top: mid.y - firstLineH / 2,
    height: firstLineH,
    firstLineH,
    lineCenter: mid.y,
    blockTop: mid.y - firstLineH / 2,
    blockBottom: mid.y + firstLineH / 2,
    block, // Sentinel — no TipTap range; menu is notionConnection only
    connectionsHeader: true,
  }
}

/** One EditorBlockRef spanning every propertyBlock (the top icon list as a single block). */
function propertyHeaderBlock(editor: Editor): { block: EditorBlockRef; insertFrom: number; insertTo: number } | null {
  const blocks = collectPropertyBlocks(editor)
  if (blocks.length === 0) return null
  const first = blocks[0]
  const last = blocks[blocks.length - 1]
  return {
    block: {
      from: first.from,
      to: last.to, // Inclusive of the last property cell
      node: first.node,
      typeName: 'propertyBlock',
    },
    insertFrom: first.from,
    insertTo: last.to,
  }
}

/** Sentinel block for the connections strip — not a doc range (grip key is `connections-header`). */
function connectionsHeaderBlock(editor: Editor): EditorBlockRef | null {
  const first = editor.state.doc.firstChild
  if (!first) return null // Empty doc — no sentinel node to hang the type off
  return {
    from: 0,
    to: 0,
    node: first,
    typeName: 'connectionsHeader',
  }
}

type DropLine = { top: number; left: number; width: number } // Viewport dashed insert marker
const GRIP_W = 20 // Matches ⋮⋮ `w-5` — insert line uses the same width
const HANDLE_GUTTER = 24 // Text starts here (row `pl-6`), in local px — where the ⋮⋮ column lives
const GRIP_H = 24 // ⋮⋮ button height (`h-6`) — used to vertically center it on the first line
const INSERT_HIT = 8 // Add-block hit strip (px) — hairline centered in this band
const INSERT_GAP = 4 // First/last offset from ⋮⋮ (fill pad); neighbors use the shared mid-gap instead
const FILL_PAD_Y = 4 // Host contentFit BLOCK_FRAME_PAD_Y — first/last hairline may sit in that pad

/** Nearest positioned ancestor — absolute ⋮⋮ `top`/`left` are in this box (the pl-6 gutter wrapper). */
function positionedAncestor(el: HTMLElement): HTMLElement {
  let n: HTMLElement | null = el
  while (n) {
    const p = getComputedStyle(n).position
    if (p === 'relative' || p === 'absolute' || p === 'fixed' || p === 'sticky') return n
    n = n.parentElement
  }
  return el
}

/** Layout root for ⋮⋮ Y — not PM’s parent (that sits below the property-icon row). */
function gripLayoutRoot(editor: Editor): HTMLElement | null {
  const flow = editor.view.dom.parentElement
  return flow ? positionedAncestor(flow) : null
}

/** True when a TipTap block range contains an aiPending mark. */
function blockHasAiPending(editor: Editor, block: EditorBlockRef): boolean {
  if (!editor || editor.isDestroyed) return false
  const doc = editor.state.doc
  const size = doc.content.size // Valid positions are 0..size (inclusive end for nodesBetween)
  // Stale grips after doc swaps (Turn into Board → boardLink) can hold from/to past the new doc
  const from = Math.max(0, Math.min(block.from, size))
  const to = Math.max(from, Math.min(block.to, size))
  if (from >= to) return false
  let found = false
  try {
    doc.nodesBetween(from, to, (node) => {
      if (found) return false
      if (node.isText && node.marks.some((m) => m.type.name === 'aiPending')) {
        found = true
        return false
      }
      return true
    })
  } catch {
    return false // Doc mutated mid-walk — treat as no pending marks
  }
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
    if (!editor || editor.isDestroyed) return null
    const size = editor.state.doc.content.size
    if (block.from < 0 || block.from >= size || block.to > size || block.from >= block.to) return null
    const root = container
    const el = blockDom(editor, block)

    const dbHeader = el
      ? ((el.querySelector?.('.tt-database-block-row') as HTMLElement | null) ||
          (el.querySelector?.('.tt-database-block-label') as HTMLElement | null))
      : null
    const imageRow = el?.querySelector?.('.tt-image-block-row') as HTMLElement | null
    const propertyRow = el?.querySelector?.('.tt-property-block-row') as HTMLElement | null
    const pageLabel = el?.querySelector?.('.tt-board-link-label') as HTMLElement | null
    const textEl = dbHeader || imageRow || propertyRow || pageLabel || el

    // Prefer the atom’s chrome row box (stable under frameScale) over Range ink fragments.
    const rowBox = propertyRow || dbHeader || imageRow || pageLabel
    const fr = rowBox
      ? rowBox.getBoundingClientRect()
      : textEl
        ? topmostClientRect(textEl)
        : null
    if (textEl || fr) {
      const lh = textEl ? parseFloat(getComputedStyle(textEl).lineHeight) : NaN
      let firstLineH =
        Number.isFinite(lh) && lh > 0 ? lh : fr && fr.height > 0 ? Math.min(fr.height, 28) : 22
      let lineCenter: number
      if (fr && fr.height > 0) {
        const isDb = !!(dbHeader || el?.classList?.contains?.('tt-database-block'))
        const isImage = !!(imageRow || el?.classList?.contains?.('tt-image-block'))
        const isProperty = !!(propertyRow || el?.classList?.contains?.('tt-property-block'))
        // DB / image: pin to the TOP chrome band (tall atoms). Property + text: true vertical center
        // of the measured box — top-band + lineHeight sat the ⋮⋮ on the cell’s top after resize.
        const midY =
          isDb || isImage
            ? fr.top + Math.min(firstLineH, fr.height) / 2
            : (fr.top + fr.bottom) / 2
        lineCenter = screenToLocal(root, (fr.left + fr.right) / 2, midY).y
        if (isProperty || pageLabel) {
          // Row box height in local px (frameScale-safe) — keep firstLineH in sync with the cell
          const localH = Math.abs(
            screenToLocal(root, fr.left, fr.bottom).y - screenToLocal(root, fr.left, fr.top).y
          )
          if (localH > 0) firstLineH = Math.min(Math.max(14, localH), 40)
        } else if (!(Number.isFinite(lh) && lh > 0) || !(isDb || isImage)) {
          // Text grips: first-line height from the glyph rect (local), not a tall line-box
          const localH = Math.abs(
            screenToLocal(root, fr.left, fr.bottom).y - screenToLocal(root, fr.left, fr.top).y
          )
          if (localH > 0) firstLineH = Math.min(Math.max(14, localH), 28)
        }
      } else {
        const start = editor.view.coordsAtPos(block.from + 1)
        lineCenter = screenToLocal(root, start.left, (start.top + start.bottom) / 2).y
      }
      const bandTop = lineCenter - firstLineH / 2 // First-line top — fallback if the node has no box
      const bandBottom = lineCenter + firstLineH / 2
      let blockTop = bandTop
      let blockBottom = bandBottom
      if (el) {
        const br = el.getBoundingClientRect() // Full block (wrapped lines / tall atoms) — neighbor mid-gap
        if (br.height > 0) {
          blockTop = screenToLocal(root, br.left, br.top).y
          blockBottom = screenToLocal(root, br.left, br.bottom).y
        }
      }
      return {
        top: bandTop,
        height: firstLineH,
        firstLineH,
        lineCenter,
        blockTop,
        blockBottom,
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
      blockTop: top,
      blockBottom: top + height,
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
  onPropertyTurnInto,
  notionConnected = false,
  notionSync = 'live',
  onNotionConnection,
  contentPadLeft = 0, // Match host contentFit pad so ⋮⋮ centers in the blue-box gutter
  frameScale = 1, // Locked resize CSS scale — force re-measure (RO ignores transform)
  handleGutterFlow = 0, // Host adjustChromeX — inverse-scale local left so ⋮⋮ fits the blue gutter
}: TipTapBlockHandlesProps) {
  const { screenToFlowPosition } = useReactFlow() // Drop-on-page → flow coords for a new frame
  const rfZoom = useStore((s) => s.transform[2] || 1) // Live zoom — re-render on board zoom so grips can counter-scale to a constant screen size
  void frameScale // Re-render + remeasure when host locked-resize scale changes (transform ≠ layout)
  void handleGutterFlow // Re-render when blue gutter / screen chrome scale changes
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
  // Connections strip ⋮⋮ — same Live Sync / Manual / Remove menu as the Notion mark
  const [connectionsMenu, setConnectionsMenu] = useState<{
    x: number
    y: number
    openLeft: boolean
  } | null>(null)
  const [dropLine, setDropLine] = useState<DropLine | null>(null) // Dashed insert line while dragging a content block
  const [ghost, setGhost] = useState<{ x: number; y: number; text: string; width: number } | null>(null) // Floating preview of the dragged line
  // In-frame multi-block selection (Shift = range, Cmd/Ctrl = toggle). Empty = no multi-selection.
  // A plain ⋮⋮ click also arms a single-block selection so a later drag can move that block.
  const [selection, setSelection] = useState<EditorBlockRef[]>([])
  const selectionRef = useRef<EditorBlockRef[]>([]) // Latest selection for click handlers
  selectionRef.current = selection
  // Top icon row armed as ONE block — selection still lists every property cell for drag/delete,
  // but grips/wash stay on the header only (not a ⋮⋮ per cell). Cleared with the selection.
  const [propertyHeaderArmed, setPropertyHeaderArmed] = useState(false)
  // Bottom connections strip armed — chrome-only (no TipTap cells). Cleared with the selection.
  const [connectionsHeaderArmed, setConnectionsHeaderArmed] = useState(false)
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
    setPropertyHeaderArmed(false) // Header is not a separate selection — drop with the cells
    setConnectionsHeaderArmed(false) // Connections strip wash / grip arm
    anchorRef.current = null
    setMenu(null)
    setConnectionsMenu(null)
    if (hostNodeId) setAiBlockSelection(null) // Drop AI block pill when disarmed
  }, [editor, hostNodeId])

  // Close the actions menu only — keep the block selection so a follow-up ⋮⋮ drag can move it
  const closeMenu = useCallback(() => {
    setMenu(null)
    setConnectionsMenu(null)
  }, [])

  // Frame deselected → drop hover/caret grips and any armed block selection
  useEffect(() => {
    if (isPanelSelected) return
    setHover(null) // No ⋮⋮ on unselected frame hover
    setFocusLayout(null)
    clearBlockSelection()
  }, [isPanelSelected, clearBlockSelection])

  // Apply a multi-block selection: update state + paint the multi-range wash.
  // Only ⋮⋮ handle selection publishes a block pill — I-bar/caret alone stays "Selected frame".
  // Same-frame multi-block still publishes ONE AI context pill (not one per block).
  // `asPropertyHeader`: top icon row — keep cell refs for actions, wash/grip on the header only.
  const applySelection = useCallback(
    (blocks: EditorBlockRef[], opts?: { asPropertyHeader?: boolean }) => {
      const asHeader = !!opts?.asPropertyHeader
      setSelection(blocks)
      setPropertyHeaderArmed(asHeader)
      setConnectionsHeaderArmed(false) // Content / property arm clears connections strip
      setConnectionsMenu(null)
      if (editor) {
        // Header wash is a class on [data-tt-property-header] — do not paint every cell
        if (asHeader) setEditorBlockHighlight(editor, null)
        else setEditorBlockHighlightRanges(editor, blocks.map((b) => ({ from: b.from, to: b.to })))
      }
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

  // Show handle when pointer Y is in a block’s band — anywhere across the full frame width.
  // Only while the host **frame** is selected (unselected hover must not paint ⋮⋮).
  useEffect(() => {
    if (!editor || !enabled || editor.isDestroyed) return
    if (!isPanelSelected) return // Unselected: never arm hover grips
    const dom = editor.view.dom
    const container = gripLayoutRoot(editor)
    if (!container) return
    const frame = frameForEditor(dom)

    const resolveFromPoint = (clientX: number, clientY: number, target: EventTarget | null) => {
      if (menu || connectionsMenu || draggingRef.current) return // Keep handle on the open-menu / in-drag block
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

      const headerEl = frame.querySelector('[data-tt-property-header]') as HTMLElement | null
      if (headerEl) {
        const hr = headerEl.getBoundingClientRect()
        if (clientY >= hr.top && clientY <= hr.bottom) {
          const group = propertyHeaderBlock(editor) // Top icon list = one block
          if (group) {
            setHover(layoutForPropertyHeader(container, group.block, group.insertFrom, group.insertTo))
            return
          }
        }
      }

      // Bottom connections strip — same Y-band rule as the property header
      if (notionConnected) {
        const connEl = frame.querySelector('[data-tt-connections-header]') as HTMLElement | null
        if (connEl) {
          const cr = connEl.getBoundingClientRect()
          if (clientY >= cr.top && clientY <= cr.bottom) {
            const sentinel = connectionsHeaderBlock(editor)
            if (sentinel) {
              setHover(layoutForConnectionsHeader(container, sentinel))
              return
            }
          }
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
      if (menu || connectionsMenu || draggingRef.current) return
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
  }, [editor, enabled, menu, connectionsMenu, isPanelSelected, notionConnected])

  // Keep a handle beside the block that owns the caret (cursor placed → handle stays without hover).
  // Also re-measure on TipTap transactions / RO so grips stay glued after typing / zoom.
  useEffect(() => {
    if (!editor || !enabled || editor.isDestroyed) return
    if (!isPanelSelected) {
      setFocusLayout(null) // No caret grip on an unselected frame
      return
    }
    const container = gripLayoutRoot(editor)
    if (!container) return

    // Same block + ~same geometry → keep prior layout object (avoids RO/transaction setState thrash)
    const sameLayout = (prev: HandleLayout | null, next: HandleLayout | null) =>
      !!prev &&
      !!next &&
      prev.block.from === next.block.from &&
      Math.abs(prev.top - next.top) < 0.5 &&
      Math.abs(prev.height - next.height) < 0.5 &&
      Math.abs(prev.lineCenter - next.lineCenter) < 0.5 &&
      Math.abs(prev.blockTop - next.blockTop) < 0.5 &&
      Math.abs(prev.blockBottom - next.blockBottom) < 0.5

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
  }, [editor, enabled, menu, isPanelSelected, frameScale])

  // Outside click: dismiss menu + clear armed block selection (unless clicking another grip / the menu)
  useEffect(() => {
    if (!menu && !connectionsMenu && selection.length === 0 && !connectionsHeaderArmed) return
    const onDoc = (event: MouseEvent) => {
      const t = event.target as HTMLElement
      // Keep wash when clicking grips, menus, or the property / connections chrome strips
      if (
        t.closest?.(
          '.block-actions-menu, [data-tt-block-handle], [data-tt-property-header], [data-tt-connections-header]'
        )
      ) {
        return
      }
      clearBlockSelection()
    }
    document.addEventListener('mousedown', onDoc, true)
    return () => document.removeEventListener('mousedown', onDoc, true)
  }, [menu, connectionsMenu, selection.length, connectionsHeaderArmed, clearBlockSelection])

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

  /** Arm the connections strip + open Live Sync / Manual / Remove (same as the Notion mark). */
  const openForConnections = useCallback(
    (clientX: number, clientY: number) => {
      if (!editor || !notionConnected) return
      const sentinel = connectionsHeaderBlock(editor)
      if (!sentinel) return
      setSelection([])
      setPropertyHeaderArmed(false)
      setConnectionsHeaderArmed(true)
      setMenu(null)
      if (editor) setEditorBlockHighlight(editor, null)
      if (hostNodeId) setAiBlockSelection(null) // Connections aren't TipTap content for AI pills
      const place = menuPlacement(clientX, clientY)
      setConnectionsMenu(place)
      const container = gripLayoutRoot(editor)
      const layout = container ? layoutForConnectionsHeader(container, sentinel) : null
      if (layout) {
        setHover(layout)
        setFocusLayout(layout)
      }
    },
    [editor, notionConnected, hostNodeId, menuPlacement]
  )

  const openForBlock = useCallback(
    (block: EditorBlockRef, clientX: number, clientY: number, asPropertyHeader = false) => {
      if (!editor) return
      if (asPropertyHeader) {
        const props = collectPropertyBlocks(editor) // Arm every property cell (the list is one block)
        if (props.length === 0) return
        applySelection(props, { asPropertyHeader: true }) // One header ⋮⋮ — not a grip per cell
        anchorRef.current = props[0]
        const blockType = refineListBlockType(editor, props[0])
        setMenu({ ...menuPlacement(clientX, clientY), block: props[0], blockType })
        const container = gripLayoutRoot(editor)
        const group = propertyHeaderBlock(editor)
        const layout =
          container && group
            ? layoutForPropertyHeader(container, group.block, group.insertFrom, group.insertTo)
            : null
        if (layout) {
          setHover(layout)
          setFocusLayout(layout)
        }
        return
      }
      // Arm this block for a follow-up ⋮⋮ drag (selection persists after the menu closes)
      applySelection([block]) // Cell / text block — clears propertyHeaderArmed + connectionsHeaderArmed
      anchorRef.current = block
      const blockType = refineListBlockType(editor, block)
      setMenu({ ...menuPlacement(clientX, clientY), block, blockType })
      const container = gripLayoutRoot(editor)
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
  const onGripPointerDown = useCallback(
    (e: ReactPointerEvent, target?: EditorBlockRef, asConnectionsHeader = false) => {
      if (e.button !== 0 || !editor) return // Left button + live editor
      // Connections strip: arm via click only — no TipTap range to drag
      if (asConnectionsHeader) {
        if (!isPanelSelected || !connectionsHeaderArmed) {
          gripPointerRef.current = { x: e.clientX, y: e.clientY, dragged: false }
          return // Unarmed → RF may drag the frame
        }
        e.stopPropagation() // Armed — don't start frame drag from ⋮⋮
        gripPointerRef.current = { x: e.clientX, y: e.clientY, dragged: false }
        return
      }
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
      setConnectionsMenu(null)
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
    },
    [
      clearBlockSelection,
      connectionsHeaderArmed,
      conversationId,
      editor,
      focusLayout,
      hostNodeId,
      hover,
      isBlockArmed,
      isPanelSelected,
      queryClient,
      screenToFlowPosition,
    ]
  )

  // Single TipTap block → linked board: seed child board with this block's HTML, replace with boardLink
  const turnBlockIntoBoard = useCallback(
    async (block: EditorBlockRef, blockType: 'board' | 'boardIn', boardInParentId?: string | null) => {
      if (!editor || editor.isDestroyed || !conversationId) return
      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return
        const rawBody = htmlForEditorRange(editor, block.from, block.to) // Block HTML before title strip
        const title = titleForBlock(editor, block) // First-line label → board name
        // Name lives on the board — don't also seed it as the only body block
        const bodyHtml = bodyHtmlWithoutBoardTitle(rawBody, title)
        const parentId =
          blockType === 'boardIn' && boardInParentId ? boardInParentId : conversationId // Nest target
        // RF node id is `panel-{messageId}` — reverse-link needs the message UUID
        const sourceMessageId = (hostNodeId || '').replace(/^panel-/, '').replace(/-panel-.*$/, '')
        if (!sourceMessageId) {
          console.error('Failed to turn block into board: missing host message id')
          return
        }
        const boardId = await createChildBoardForBlock(supabase, {
          userId: user.id,
          parentId,
          sourceMessageId,
          title,
          bodyHtml: isBlockContentEmpty(bodyHtml) ? undefined : bodyHtml,
        })
        if (!boardId) {
          throw new Error('Failed to create child board (see prior console error)')
        }
        replaceBlockWithBoardLink(editor, block, { boardId, title, icon: null, variant: 'inline' })
        await queryClient.invalidateQueries({ queryKey: ['conversations'] })
        await queryClient.refetchQueries({ queryKey: ['conversations'] })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('Failed to turn block into board:', msg, err)
      }
    },
    [editor, conversationId, hostNodeId, queryClient]
  )

  // Multiple selected blocks → one linked board (snapshot: blocks stay, a title boardLink is added on top).
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
        const rawBody = ordered.map((b) => htmlForEditorRange(editor, b.from, b.to)).join('') // Combined body
        const title = titleForBlock(editor, ordered[0]) // Seed from first block → board name
        // Don't duplicate the title line as the first body block on the child board
        const bodyHtml = bodyHtmlWithoutBoardTitle(rawBody, title)
        const parentId = blockType === 'boardIn' && boardInParentId ? boardInParentId : conversationId
        const sourceMessageId = (hostNodeId || '').replace(/^panel-/, '').replace(/-panel-.*$/, '')
        if (!sourceMessageId) {
          console.error('Failed to turn selection into board: missing host message id')
          return
        }
        const boardId = await createChildBoardForBlock(supabase, {
          userId: user.id,
          parentId,
          sourceMessageId,
          title,
          bodyHtml: isBlockContentEmpty(bodyHtml) ? undefined : bodyHtml,
        })
        if (!boardId) {
          throw new Error('Failed to create child board (see prior console error)')
        }
        insertBoardTitleBlock(editor, { boardId, title, icon: null, variant: 'title' }) // Title link on top of frame
        await queryClient.invalidateQueries({ queryKey: ['conversations'] })
        await queryClient.refetchQueries({ queryKey: ['conversations'] })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('Failed to turn selection into board:', msg, err)
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

      if (action === 'turnInto' && payload?.propertyType) {
        for (const b of ordered) turnEditorBlockIntoProperty(editor, b, payload.propertyType) // Block → icon + Empty cell
        onPropertyTurnInto?.(payload.propertyType) // Stamp propertyType on the host frame (top icon)
        clearBlockSelection()
        return
      }
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
    [editor, menu, clearBlockSelection, turnBlockIntoBoard, turnSelectionIntoBoard, hostNodeId, onPropertyTurnInto]
  )

  // Grip click: plain = arm block + actions menu; Shift/⌘ = multi-select.
  // Unselected frame: do not steal the click — RF selects the frame first.
  const onGripClick = useCallback(
    (e: React.MouseEvent, block: EditorBlockRef, asPropertyHeader = false, asConnectionsHeader = false) => {
      const start = gripPointerRef.current
      gripPointerRef.current = null
      if (start?.dragged) return // Drag moved this block — don't open the menu
      // Frame not selected yet → let the click bubble so RF selects the frame (no block menu)
      if (!isPanelSelected) return
      e.stopPropagation()
      e.preventDefault()
      if (!editor) return
      if (asConnectionsHeader) {
        // Connections strip is one chrome block — ⋮⋮ again closes the menu
        if (connectionsMenu) {
          setConnectionsMenu(null)
          return
        }
        openForConnections(e.clientX, e.clientY)
        return
      }
      if (asPropertyHeader) {
        // Top icon list is one block — ⋮⋮ again closes the menu like any other block
        if (menu) {
          setMenu(null)
          return
        }
        openForBlock(block, e.clientX, e.clientY, true)
        return
      }
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
        // Same group ⋮⋮ again → close the menu (selection wash stays)
        if (menu && cur.some((b) => b.from === menu.block.from)) {
          setMenu(null)
          return
        }
        const blockType = refineListBlockType(editor, block)
        setMenu({ ...menuPlacement(e.clientX, e.clientY), block, blockType })
        return
      }
      // Same armed ⋮⋮ again → close the menu (block stays selected for a follow-up drag)
      if (menu && menu.block.from === block.from) {
        setMenu(null)
        return
      }
      // Arm this single block + open its menu (follow-up ⋮⋮ drag can move it)
      openForBlock(block, e.clientX, e.clientY)
    },
    [
      editor,
      applySelection,
      collectBlocksBetween,
      openForBlock,
      openForConnections,
      menuPlacement,
      isPanelSelected,
      menu,
      connectionsMenu,
    ]
  )

  // Blue wash on the top icon list when that block is armed / hovered
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const el =
      frameForEditor(editor.view.dom).querySelector('[data-tt-property-header]') ||
      gripLayoutRoot(editor)?.querySelector('[data-tt-property-header]')
    if (!el) return
    const on = propertyHeaderArmed || !!hover?.propertyHeader
    el.classList.toggle('tt-block-highlight', on)
    return () => el.classList.remove('tt-block-highlight')
  }, [editor, propertyHeaderArmed, hover?.propertyHeader])

  // Blue wash on the bottom connections strip when that block is armed / hovered
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const el =
      frameForEditor(editor.view.dom).querySelector('[data-tt-connections-header]') ||
      gripLayoutRoot(editor)?.querySelector('[data-tt-connections-header]')
    if (!el) return
    const on = connectionsHeaderArmed || !!hover?.connectionsHeader
    el.classList.toggle('tt-block-highlight', on)
    return () => el.classList.remove('tt-block-highlight')
  }, [editor, connectionsHeaderArmed, hover?.connectionsHeader])

  if (!editor || !enabled) return null
  // Unselected frames never paint ⋮⋮ (hover / caret / AI pending) — only when the blue adjust box is up
  if (!isPanelSelected) return null

  // Grips render for every selected block (persistent wash) + the hovered/caret/menu block.
  const container = gripLayoutRoot(editor)
  // `rfZoom` / handleGutterFlow / frameScale in render deps so grips remeasure when chrome scale changes
  void rfZoom
  // Horizontal: ⋮⋮ centered in the LEFT chrome strip (outside the filled frame).
  // Absolute grips are positioned in the content box (inside contentFit pad), so subtract
  // contentPadLeft to measure from the fill’s left edge — otherwise the pad pulls grips
  // toward the fill and they look off-center in the blue gutter (worse after resize scale).
  // When the host passes handleGutterFlow (screen-sized blue gutter), use localGutter =
  // flow/frameScale so after contentFit CSS scale the ⋮⋮ still sits inside that strip.
  const contentCssScale = Math.max(0.15, frameScale || 1)
  const localGutter =
    handleGutterFlow > 0 ? handleGutterFlow / contentCssScale : HANDLE_GUTTER
  const gutterCenterLeft =
    -contentPadLeft - localGutter + (localGutter / 2 - GRIP_W / 2)
  const gripLayouts = new Map<string | number, HandleLayout>() // keyed by block.from (headers = named keys)
  if (container) {
    for (const b of selection) {
      // Header mode: cells stay in `selection` for menu/drag, but only the top-row ⋮⋮ paints
      if (propertyHeaderArmed && b.typeName === 'propertyBlock') continue
      const gl = layoutForBlock(editor, container, b)
      if (gl) gripLayouts.set(b.from, gl)
    }
    for (const b of aiPendingBlocks) {
      if (gripLayouts.has(b.from)) continue
      if (propertyHeaderArmed && b.typeName === 'propertyBlock') continue
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
  if (hoverLayout?.propertyHeader && container) {
    const group = propertyHeaderBlock(editor)
    if (group) {
      const fresh = layoutForPropertyHeader(container, group.block, group.insertFrom, group.insertTo)
      if (fresh) gripLayouts.set('property-header', fresh)
    }
  } else if (hoverLayout?.connectionsHeader && container && notionConnected) {
    const sentinel = connectionsHeaderBlock(editor)
    if (sentinel) {
      const fresh = layoutForConnectionsHeader(container, sentinel)
      if (fresh) gripLayouts.set('connections-header', fresh)
    }
  } else if (hoverLayout && !gripLayouts.has(hoverLayout.block.from) && container) {
    // Don't park a cell grip from caret/hover while the header owns the property list
    if (!(propertyHeaderArmed && hoverLayout.block.typeName === 'propertyBlock')) {
      const fresh = layoutForBlock(editor, container, hoverLayout.block)
      if (fresh) gripLayouts.set(fresh.block.from, fresh)
    }
  }
  if (menu && container && !gripLayouts.has(menu.block.from)) {
    if (!(propertyHeaderArmed && menu.block.typeName === 'propertyBlock')) {
      const ml = layoutForBlock(editor, container, menu.block)
      if (ml) gripLayouts.set(ml.block.from, ml)
    }
  }
  const group = propertyHeaderBlock(editor)
  if (container && group && (propertyHeaderArmed || hover?.propertyHeader) && !gripLayouts.has('property-header')) {
    const hl = layoutForPropertyHeader(container, group.block, group.insertFrom, group.insertTo)
    if (hl) gripLayouts.set('property-header', hl)
  }
  // Armed / menu-open connections strip — keep the ⋮⋮ parked on the footer band
  if (
    container &&
    notionConnected &&
    (connectionsHeaderArmed || connectionsMenu || hover?.connectionsHeader) &&
    !gripLayouts.has('connections-header')
  ) {
    const sentinel = connectionsHeaderBlock(editor)
    if (sentinel) {
      const hl = layoutForConnectionsHeader(container, sentinel)
      if (hl) gripLayouts.set('connections-header', hl)
    }
  }
  // Menu count reflects the group when the menu block is part of a multi-selection
  const menuCount =
    menu && selection.length > 1 && selection.some((b) => b.from === menu.block.from)
      ? selection.length
      : 1

  return (
    <>
      {Array.from(gripLayouts.entries()).map(([gripKey, gl]) => {
        // Skip grips whose range no longer exists in the doc (e.g. after Turn into Board)
        const docSize = editor.state.doc.content.size
        if (
          !gl.connectionsHeader &&
          (gl.block.from < 0 || gl.block.from >= docSize || gl.block.to > docSize)
        ) {
          return null
        }
        // nodrag only when this block is armed — otherwise RF must receive the pointer to drag the frame
        const armed =
          isPanelSelected &&
          (gl.connectionsHeader
            ? connectionsHeaderArmed
            : gl.propertyHeader
              ? propertyHeaderArmed
              : isBlockArmed(gl.block))
        const aiPending = gl.connectionsHeader ? false : blockHasAiPending(editor, gl.block)
        // Screen-relative icon: flow size ≈ GRIP_W × (handleGutterFlow/HANDLE_GUTTER).
        // Divide out contentFit frameScale so locked resize does not inflate the ⋮⋮ past the blue gutter.
        const screenFactor =
          handleGutterFlow > 0 ? handleGutterFlow / HANDLE_GUTTER : 1 / Math.max(1, Math.sqrt(rfZoom || 1))
        const gripChromeScale = screenFactor / contentCssScale
        // Layout ⋮⋮ hit box stays GRIP_H; insert Y uses the *visual* extent after counter-scale
        // so hairlines keep screen-constant distance when frameScale / zoom change.
        const gripLayoutTop = gl.lineCenter - GRIP_H / 2
        const gripLayoutBottom = gl.lineCenter + GRIP_H / 2
        const visualGripTop = gl.lineCenter - (GRIP_H * gripChromeScale) / 2
        const visualGripBottom = gl.lineCenter + (GRIP_H * gripChromeScale) / 2
        // Insert gap + hit band in local px so after CSS scale they match screen chrome (same as ⋮⋮)
        const localInsertGap = INSERT_GAP * gripChromeScale
        const localInsertHit = Math.max(4, INSERT_HIT * gripChromeScale)
        // Equal air above/below the visual ⋮⋮ — do NOT mix mid-gap on one side with grip±gap on
        // the other (that parked the hairlines unevenly around the handle).
        const insertAboveY = visualGripTop - localInsertGap
        const insertBelowY = visualGripBottom + localInsertGap
        // Gutter may extend into fill pad (negative top) so the first add-above can paint
        const localFillPadY = FILL_PAD_Y * gripChromeScale
        const gutterTop = Math.max(
          -localFillPadY,
          Math.min(insertAboveY - localInsertHit / 2, gripLayoutTop)
        )
        const gutterBottom = Math.max(insertBelowY + localInsertHit / 2, gripLayoutBottom)
        const gutterH = gutterBottom - gutterTop
        // Top edge of the ⋮⋮ in gutter space — do NOT also translateY(-50%) (that parked grips
        // on the block’s top edge, especially visible after frameScale resize).
        const gripTopInGutter = gripLayoutTop - gutterTop
        const insertAboveTop = insertAboveY - gutterTop - localInsertHit / 2
        const insertBelowTop = insertBelowY - gutterTop - localInsertHit / 2
        const insertAbove = gl.insertFrom ?? gl.block.from
        const insertBelow = gl.insertTo ?? gl.block.to
        // Property / connections chrome strips — ⋮⋮ only, no between-block hairlines
        const showInsertLines = isPanelSelected && !gl.propertyHeader && !gl.connectionsHeader
        const grip = (
          <div
            key={gripKey}
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
            {showInsertLines ? (
              <>
                <button
                  type="button"
                  data-tt-insert-line
                  title="Add block"
                  aria-label="Add block above"
                  className={cn(
                    'group/insert absolute left-0 right-0 z-[1]',
                    'nodrag nopan cursor-pointer',
                    'opacity-0 group-hover/gutter:opacity-100'
                  )}
                  style={{ top: insertAboveTop, height: localInsertHit }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => onInsertLineClick(e, insertAbove)}
                >
                  <span
                    className={cn(
                      'pointer-events-none absolute left-1/2 top-1/2 h-px w-3 rounded-full',
                      'bg-gray-200 transition-colors group-hover/insert:bg-black/35',
                      'dark:bg-gray-600 dark:group-hover/insert:bg-white/40'
                    )}
                    aria-hidden
                    style={{
                      transform: `translate(-50%, -50%) scale(${gripChromeScale})`,
                      transformOrigin: 'center',
                    }}
                  />
                </button>
                <button
                  type="button"
                  data-tt-insert-line
                  title="Add block"
                  aria-label="Add block below"
                  className={cn(
                    'group/insert absolute left-0 right-0 z-[1]',
                    'nodrag nopan cursor-pointer',
                    'opacity-0 group-hover/gutter:opacity-100'
                  )}
                  style={{ top: insertBelowTop, height: localInsertHit }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => onInsertLineClick(e, insertBelow)}
                >
                  <span
                    className={cn(
                      'pointer-events-none absolute left-1/2 top-1/2 h-px w-3 rounded-full',
                      'bg-gray-200 transition-colors group-hover/insert:bg-black/35',
                      'dark:bg-gray-600 dark:group-hover/insert:bg-white/40'
                    )}
                    aria-hidden
                    style={{
                      transform: `translate(-50%, -50%) scale(${gripChromeScale})`,
                      transformOrigin: 'center',
                    }}
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
                // Scale about center so board-zoom comfort does not shift the mid-line lock
                transform: `scale(${gripChromeScale})`,
                transformOrigin: 'center center',
              }}
              title={
                gl.connectionsHeader
                  ? armed
                    ? 'Click for connection actions'
                    : isPanelSelected
                      ? 'Click to select connections · drag moves frame'
                      : 'Drag to move frame · click to select frame'
                  : armed
                    ? 'Drag to move block · click for actions · Shift/⌘-click to multi-select'
                    : isPanelSelected
                      ? 'Click to select block · drag moves frame'
                      : 'Drag to move frame · click to select frame'
              }
              onPointerDown={(e) => onGripPointerDown(e, gl.block, !!gl.connectionsHeader)}
              onClick={(e) => onGripClick(e, gl.block, !!gl.propertyHeader, !!gl.connectionsHeader)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                if (!isPanelSelected) return
                e.preventDefault()
                if (gl.connectionsHeader) {
                  openForConnections(
                    e.currentTarget.getBoundingClientRect().right,
                    e.currentTarget.getBoundingClientRect().top
                  )
                  return
                }
                openForBlock(
                  gl.block,
                  e.currentTarget.getBoundingClientRect().right,
                  e.currentTarget.getBoundingClientRect().top,
                  gl.propertyHeader
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
            notionConnected={notionConnected} // Slimmer ⋮⋮ when the frame is Notion-linked
            onAction={onAction}
            onClose={closeMenu}
          />,
          document.body
        )}

      {connectionsMenu &&
        createPortal(
          <BlockActionsMenu
            variant="notionConnection"
            x={connectionsMenu.x}
            y={connectionsMenu.y}
            zoom={1}
            positionMode="fixed"
            openLeft={connectionsMenu.openLeft}
            notionSync={notionSync}
            onAction={(action, payload) => {
              if (action === 'setNotionSync') {
                onNotionConnection?.({ connected: true, sync: payload?.notionSync ?? 'live' })
              } else if (action === 'removeNotionConnection') {
                onNotionConnection?.({ connected: false })
                clearBlockSelection() // Unlink removes the strip — drop arm
                return
              }
              setConnectionsMenu(null) // Keep strip armed after sync change
            }}
            onClose={() => setConnectionsMenu(null)}
          />,
          document.body
        )}
    </>
  )
}
