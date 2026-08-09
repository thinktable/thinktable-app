'use client'

// ⋮⋮ on each TipTap **block** (not the host **frame**). Click = actions; drag = that block only. See DEFINITIONS.md.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { GripVertical } from 'lucide-react' // ⋮⋮ grip; between-block add is a short centered hairline
import { useReactFlow } from 'reactflow' // screenToFlowPosition when extracting a line onto the map
import { useQueryClient } from '@tanstack/react-query' // Refresh panels after extract-to-card
import { createClient } from '@/lib/supabase/client' // Persist a new map card from a dragged line
import { newBlockMetadata } from '@/lib/blocks' // Canonical isBlock metadata for extracted cards
import { cn } from '@/lib/utils'
import {
  BlockActionsMenu,
  type BlockActionId,
  type BlockActionPayload,
  type BlockTypeId,
  type PageInTarget,
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
import {
  createChildPageForBlock,
  insertPageTitleBlock,
  replaceBlockWithPageLink,
  titleForBlock,
} from '@/lib/tiptap/page-blocks' // Block → linked page (inline pageLink node)

type HandleLayout = {
  top: number // CSS px relative to editor gutter container (local, not screen)
  height: number
  block: EditorBlockRef
}

type TipTapBlockHandlesProps = {
  editor: Editor | null
  enabled?: boolean // Off for flashcards / project boards
  hostNodeId?: string // Host **frame** RF id — Page promote / extract target
  conversationId?: string // Page id — extract a block onto the page as its own frame
  pageInTargets?: PageInTarget[]
  onPageTurnInto?: (blockType: 'page' | 'pageIn', pageInParentId?: string | null) => void
}

type DropLine = { top: number; left: number; width: number } // Viewport dashed insert marker
type InsertLine = { top: number; insertPos: number } // Gap mid in editor-container local CSS px
const INSERT_EDGE_PX = 14 // Screen px around a block join → show the add line
const GRIP_W = 20 // Matches ⋮⋮ `w-5` — insert line uses the same width
const GRIP_H = 24 // Matches ⋮⋮ `h-6` — vertical align / hit band

/** Gap between blocks (or above/below) under clientY — lineTop is the visual midpoint. */
function findBlockInsertGap(
  editor: Editor,
  clientY: number
): { insertPos: number; lineTop: number } | null {
  const blocks: { from: number; to: number; top: number; bottom: number }[] = []
  editor.state.doc.descendants((node, pos) => {
    const name = node.type.name
    if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') return true
    if (!isHandleBlockType(name)) return true
    try {
      const el = editor.view.nodeDOM(pos)
      const rect = el instanceof HTMLElement ? el.getBoundingClientRect() : null
      if (rect && rect.height > 0) {
        blocks.push({ from: pos, to: pos + node.nodeSize, top: rect.top, bottom: rect.bottom })
      } else {
        const start = editor.view.coordsAtPos(pos + 1)
        const end = editor.view.coordsAtPos(Math.max(pos + 1, pos + node.nodeSize - 1))
        blocks.push({
          from: pos,
          to: pos + node.nodeSize,
          top: start.top,
          bottom: Math.max(start.bottom, end.bottom),
        })
      }
    } catch {
      // skip
    }
    // Don’t flatten nested handle units inside lists / quotes / toggles
    if (
      name === 'listItem' ||
      name === 'taskItem' ||
      name === 'blockquote' ||
      name === 'toggleList' ||
      name === 'toggleHeading' ||
      name === 'callout' ||
      name === 'columns'
    ) {
      return false
    }
    return true
  })
  if (blocks.length === 0) return null

  // Paragraphs use margin 0 — joins touch. Hit a band around each join, place line at midpoint.
  let best: { insertPos: number; lineTop: number; dist: number } | null = null
  for (let i = 0; i < blocks.length - 1; i++) {
    const a = blocks[i]
    const b = blocks[i + 1]
    const mid = (a.bottom + b.top) / 2 // Center between the two block boxes
    const lo = Math.min(a.bottom, b.top) - INSERT_EDGE_PX
    const hi = Math.max(a.bottom, b.top) + INSERT_EDGE_PX
    if (clientY < lo || clientY > hi) continue
    const dist = Math.abs(clientY - mid)
    if (!best || dist < best.dist) {
      best = { insertPos: a.to, lineTop: mid, dist }
    }
  }
  if (best) return { insertPos: best.insertPos, lineTop: best.lineTop }

  const first = blocks[0]
  const last = blocks[blocks.length - 1]
  if (clientY <= first.top + INSERT_EDGE_PX) {
    return { insertPos: first.from, lineTop: first.top } // Above first block
  }
  if (clientY >= last.bottom - INSERT_EDGE_PX) {
    return { insertPos: last.to, lineTop: last.bottom } // Below last block
  }
  return null
}

/** Resolve the DOM element for a ProseMirror block (handles sit beside this). */
function blockDom(editor: Editor, block: EditorBlockRef): HTMLElement | null {
  const node = editor.view.nodeDOM(block.from)
  if (node instanceof HTMLElement) return node
  if (node?.parentElement instanceof HTMLElement) return node.parentElement
  return null
}

/**
 * Measure handle Y/height in the gutter container’s local CSS pixels.
 * Must divide out React Flow viewport scale — getBoundingClientRect is screen-space,
 * but position:absolute top is pre-transform CSS px inside .react-flow__viewport.
 */
function layoutForBlock(
  editor: Editor,
  container: HTMLElement,
  block: EditorBlockRef
): HandleLayout | null {
  try {
    const el = blockDom(editor, block)
    const containerRect = container.getBoundingClientRect()
    // Visual scale from RF zoom (and any nested transforms)
    const scaleY =
      container.offsetHeight > 0 ? containerRect.height / container.offsetHeight : 1
    const safeScale = scaleY > 0.01 ? scaleY : 1

    if (el) {
      const blockRect = el.getBoundingClientRect()
      const top = (blockRect.top - containerRect.top) / safeScale
      const height = Math.max(22, blockRect.height / safeScale)
      return { top, height, block }
    }

    // Fallback: coordsAtPos is also screen-space — same scale correction
    const start = editor.view.coordsAtPos(block.from + 1)
    const end = editor.view.coordsAtPos(Math.max(block.from + 1, block.to - 1))
    const top = (start.top - containerRect.top) / safeScale
    const height = Math.max(22, (end.bottom - start.top) / safeScale)
    return { top, height, block }
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
  hostNodeId,
  conversationId,
  pageInTargets = [],
  onPageTurnInto,
}: TipTapBlockHandlesProps) {
  const { screenToFlowPosition } = useReactFlow() // Drop-on-page → flow coords for a new frame
  const queryClient = useQueryClient() // Refetch messages after extract
  const [hover, setHover] = useState<HandleLayout | null>(null) // Handle beside hovered block
  const [focusLayout, setFocusLayout] = useState<HandleLayout | null>(null) // Handle beside focused/caret block
  const [menu, setMenu] = useState<{
    x: number // viewport
    y: number
    block: EditorBlockRef
    blockType: BlockTypeId
  } | null>(null)
  const [dropLine, setDropLine] = useState<DropLine | null>(null) // Dashed insert line while dragging a content block
  const [insertLine, setInsertLine] = useState<InsertLine | null>(null) // Hover gap → centered add hairline
  const [ghost, setGhost] = useState<{ x: number; y: number; text: string; width: number } | null>(null) // Floating preview of the dragged line
  // In-frame multi-block selection (Shift = range, Cmd/Ctrl = toggle). Empty = no multi-selection.
  const [selection, setSelection] = useState<EditorBlockRef[]>([])
  const selectionRef = useRef<EditorBlockRef[]>([]) // Latest selection for click handlers
  selectionRef.current = selection
  const anchorRef = useRef<EditorBlockRef | null>(null) // Anchor block for Shift range-select
  // Keep latest layouts in refs so transaction refresh doesn’t need stale state
  const hoverRef = useRef<HandleLayout | null>(null)
  const focusRef = useRef<HandleLayout | null>(null)
  hoverRef.current = hover
  focusRef.current = focusLayout
  // Click vs drag on the ⋮⋮ grip — click opens menu; drag moves this **block** only (never the frame)
  const gripPointerRef = useRef<{ x: number; y: number; dragged: boolean } | null>(null)
  const draggingRef = useRef(false) // Freeze hover/handle while a content-block drag is live

  // Register this frame’s editor so ⋮⋮ block-drag can drop into it (and unregister on unmount)
  useEffect(() => {
    if (!editor || !hostNodeId || editor.isDestroyed) return
    registerHostEditor(hostNodeId, editor)
    return () => unregisterHostEditor(hostNodeId, editor)
  }, [editor, hostNodeId])

  // Clear highlight + multi-selection when menu closes
  const closeMenu = useCallback(() => {
    if (editor) setEditorBlockHighlight(editor, null) // 'clear' wipes single + multi wash
    setSelection([]) // Drop the multi-selection
    anchorRef.current = null
    setMenu(null)
  }, [editor])

  // Apply a multi-block selection: update state + paint the multi-range wash.
  const applySelection = useCallback(
    (blocks: EditorBlockRef[]) => {
      setSelection(blocks)
      if (editor) setEditorBlockHighlightRanges(editor, blocks.map((b) => ({ from: b.from, to: b.to })))
    },
    [editor]
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
      // Pointer on the grip / add-line / menu — keep current hover
      if (el?.closest?.('[data-tt-block-handle], [data-tt-insert-line], .block-actions-menu')) return

      // Only while over this map-card frame (full width)
      if (!frame.contains(el) && el !== frame) {
        // Still allow coords that fall inside the frame rect (child may be null mid-move)
        const fr = frame.getBoundingClientRect()
        if (
          clientX < fr.left ||
          clientX > fr.right ||
          clientY < fr.top ||
          clientY > fr.bottom
        ) {
          setHover(null)
          setInsertLine(null)
          return
        }
      }

      // Near a gap → short line in the ⋮⋮ column, mid-gap (same width as the grip button)
      const gap = findBlockInsertGap(editor, clientY)
      if (gap) {
        const containerRect = container.getBoundingClientRect()
        const scaleY =
          container.offsetHeight > 0 ? containerRect.height / container.offsetHeight : 1
        const safeScaleY = scaleY > 0.01 ? scaleY : 1
        setInsertLine({
          top: (gap.lineTop - containerRect.top) / safeScaleY, // Gap midpoint in gutter-container local px
          insertPos: gap.insertPos,
        })
        setHover(null) // Gap wins — hide ⋮⋮ while the add line is up
        return
      }
      setInsertLine(null)

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
      // Leaving into grip / add-line / menu keeps hover so the control stays clickable
      if (related?.closest?.('[data-tt-block-handle], [data-tt-insert-line], .block-actions-menu')) return
      // Leaving to another node inside the same frame — mousemove will re-resolve
      if (related && frame.contains(related)) return
      setHover(null)
      setInsertLine(null)
    }

    // Listen on the frame so empty padding / right side of short lines still count
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

    const syncFocus = () => {
      if (menu) return
      if (!editor.isFocused) return // blur handler decides whether to clear
      const block = findEditorBlockAtPos(editor, editor.state.selection.from)
      if (!block) {
        setFocusLayout(null)
        return
      }
      setFocusLayout(layoutForBlock(editor, container, block))
    }

    const onBlur = ({ event }: { event?: FocusEvent }) => {
      if (menu) return
      const related = event?.relatedTarget as HTMLElement | null
      // Keep handle when focus moves to the grip / add-line / actions menu
      if (related?.closest?.('[data-tt-block-handle], [data-tt-insert-line], .block-actions-menu')) return
      setFocusLayout(null)
    }

    // Re-measure after typing / Enter / zoom-driven reflow so grips stay glued to lines
    const refreshLayouts = () => {
      setInsertLine(null) // Gap line re-resolves on next mousemove after doc shift
      if (menu) {
        const next = layoutForBlock(editor, container, menu.block)
        if (next) {
          setHover(next)
          setFocusLayout(next)
        }
        return
      }
      const h = hoverRef.current
      if (h) {
        const next = layoutForBlock(editor, container, h.block)
        if (next) setHover(next)
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

  // Close menu on outside click
  useEffect(() => {
    if (!menu) return
    const onDoc = (event: MouseEvent) => {
      const t = event.target as HTMLElement
      if (t.closest?.('.block-actions-menu, [data-tt-block-handle]')) return
      closeMenu()
    }
    document.addEventListener('mousedown', onDoc, true)
    return () => document.removeEventListener('mousedown', onDoc, true)
  }, [menu, closeMenu])

  const openForBlock = useCallback(
    (block: EditorBlockRef, clientX: number, clientY: number) => {
      if (!editor) return
      setEditorBlockHighlight(editor, { from: block.from, to: block.to })
      const blockType = refineListBlockType(editor, block)
      setMenu({ x: clientX, y: clientY, block, blockType })
      const container = editor.view.dom.parentElement
      const layout = container ? layoutForBlock(editor, container, block) : null
      if (layout) {
        setHover(layout)
        setFocusLayout(layout)
      }
    },
    [editor]
  )

  // Between-block add line: click inserts an empty paragraph at the hovered gap
  const onInsertLineClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation() // Don't bubble to frame / RF
      e.preventDefault()
      if (!editor || editor.isDestroyed || !insertLine) return
      const at = insertLine.insertPos // Doc edge between (or above/below) blocks
      editor
        .chain()
        .insertContentAt(at, { type: 'paragraph' }) // New empty block at the gap
        .setTextSelection(at + 1) // Caret inside the new block
        .focus()
        .run()
      setInsertLine(null) // Hide until next hover
    },
    [editor, insertLine]
  )

  // Click vs drag: nodrag so RF never starts; pointermove/up on window for this content block only
  const onGripPointerDown = useCallback((e: ReactPointerEvent, target?: EditorBlockRef) => {
    if (e.button !== 0 || !editor) return // Left button + live editor
    e.stopPropagation() // Never start RF frame drag from ⋮⋮
    // Modifier+click is a multi-select gesture (handled in onClick) — don't start a drag
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      gripPointerRef.current = { x: e.clientX, y: e.clientY, dragged: false }
      return
    }
    const block = target ?? (hover ?? focusLayout)?.block
    if (!block) return
    gripPointerRef.current = { x: e.clientX, y: e.clientY, dragged: false } // Baseline for click vs drag
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
      const target = findContentBlockDropTarget(hit.editor, ev.clientY)
      if (!target) {
        setDropLine(null)
        return
      }
      // Hide the line if it would insert the block back into itself
      if (hit.hostNodeId === sourceHostId && target.insertPos >= sourceFrom && target.insertPos <= sourceTo) {
        setDropLine(null)
        return
      }
      setDropLine({ top: target.lineTop, left: target.lineLeft, width: target.lineWidth }) // Dashed insert marker
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
        setEditorBlockHighlight(editor, null)
        return
      }

      if (hit && hit.hostNodeId === sourceHostId) {
        const target = findContentBlockDropTarget(hit.editor, ev.clientY)
        if (target) moveEditorBlockToPos(editor, sourceFrom, sourceTo, target.insertPos) // Reorder in this card
        setEditorBlockHighlight(editor, null)
        return
      }

      if (hit && hit.hostNodeId !== sourceHostId) {
        const target = findContentBlockDropTarget(hit.editor, ev.clientY)
        const insertPos = target?.insertPos ?? hit.editor.state.doc.content.size
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
        if (inserted) deleteEditorBlockRange(editor, sourceFrom, sourceTo) // Leave source card
        setEditorBlockHighlight(editor, null)
        return
      }

      // Drop on empty **page** → new **frame** with this block’s HTML
      if (!conversationId) {
        setEditorBlockHighlight(editor, null)
        return
      }
      const html = htmlForEditorRange(editor, sourceFrom, sourceTo)
      const flow = screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setEditorBlockHighlight(editor, null)
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
          setEditorBlockHighlight(editor, null)
          return
        }
        deleteEditorBlockRange(editor, sourceFrom, sourceTo) // Remove from source after persist
        await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
        await queryClient.refetchQueries({ queryKey: ['messages-for-panels', conversationId] })
      } catch (err) {
        console.error('Error extracting content block:', err)
      }
      setEditorBlockHighlight(editor, null)
    }

    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
  }, [conversationId, editor, focusLayout, hostNodeId, hover, queryClient, screenToFlowPosition])

  // Single block → linked page: create a child page seeded with this block's content,
  // then replace the block with an inline pageLink node (icon LEFT of the link text).
  const turnBlockIntoPage = useCallback(
    async (block: EditorBlockRef, blockType: 'page' | 'pageIn', pageInParentId?: string | null) => {
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
          blockType === 'pageIn' && pageInParentId ? pageInParentId : conversationId // Nest target
        const pageId = await createChildPageForBlock(supabase, {
          userId: user.id,
          parentId,
          sourceMessageId: hostNodeId ?? '',
          title,
          bodyHtml,
        })
        if (!pageId) return
        replaceBlockWithPageLink(editor, block, { pageId, title, icon: null, variant: 'inline' })
        await queryClient.invalidateQueries({ queryKey: ['conversations'] })
        await queryClient.refetchQueries({ queryKey: ['conversations'] })
      } catch (err) {
        console.error('Failed to turn block into page:', err)
      }
    },
    [editor, conversationId, hostNodeId, queryClient]
  )

  // Multiple selected blocks → one linked page (snapshot: blocks stay, a title pageLink is added on top).
  const turnSelectionIntoPage = useCallback(
    async (blocks: EditorBlockRef[], blockType: 'page' | 'pageIn', pageInParentId?: string | null) => {
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
        const parentId = blockType === 'pageIn' && pageInParentId ? pageInParentId : conversationId
        const pageId = await createChildPageForBlock(supabase, {
          userId: user.id,
          parentId,
          sourceMessageId: hostNodeId ?? '',
          title,
          bodyHtml,
        })
        if (!pageId) return
        insertPageTitleBlock(editor, { pageId, title, icon: null, variant: 'title' }) // Title link on top of frame
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
        if (payload.blockType === 'page' || payload.blockType === 'pageIn') {
          if (isMulti) void turnSelectionIntoPage(sel, payload.blockType, payload.pageInParentId)
          else void turnBlockIntoPage(menu.block, payload.blockType, payload.pageInParentId)
          closeMenu()
          return
        }
        for (const b of ordered) turnEditorBlockInto(editor, b, payload.blockType) // Per-block transform
        closeMenu()
        return
      }
      if (action === 'duplicate') {
        for (const b of ordered) {
          const slice = editor.state.doc.slice(b.from, b.to)
          editor.chain().focus().insertContentAt(b.to, slice.content.toJSON()).run()
        }
        closeMenu()
        return
      }
      if (action === 'delete') {
        for (const b of ordered) deleteEditorBlockRange(editor, b.from, b.to)
        closeMenu()
        return
      }
      if (action === 'copyLink' && hostNodeId) {
        const url = `${window.location.href.split('?')[0]}?block=${hostNodeId}&pos=${menu.block.from}`
        void navigator.clipboard.writeText(url).catch(() => {})
        closeMenu()
        return
      }
      closeMenu()
    },
    [editor, menu, closeMenu, turnBlockIntoPage, turnSelectionIntoPage, hostNodeId]
  )

  // Grip click: plain = actions menu (single, or group when block is already multi-selected);
  // Shift = range-select to anchor; Cmd/Ctrl = toggle this block in the selection.
  const onGripClick = useCallback(
    (e: React.MouseEvent, block: EditorBlockRef) => {
      e.stopPropagation()
      e.preventDefault()
      const start = gripPointerRef.current
      gripPointerRef.current = null
      if (start?.dragged) return // Drag moved this block — don't open the menu
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
        setMenu({ x: e.clientX, y: e.clientY, block, blockType })
        return
      }
      // Otherwise reset to a single-block selection + open its menu
      anchorRef.current = block
      setSelection([])
      openForBlock(block, e.clientX, e.clientY)
    },
    [editor, applySelection, collectBlocksBetween, openForBlock]
  )

  if (!editor || !enabled) return null

  // Grips render for every selected block (persistent wash) + the hovered/caret/menu block.
  const container = editor.view.dom.parentElement
  const gripLayouts = new Map<number, HandleLayout>() // keyed by block.from (dedupe)
  if (container) {
    for (const b of selection) {
      const gl = layoutForBlock(editor, container, b)
      if (gl) gripLayouts.set(b.from, gl)
    }
  }
  const hoverLayout = insertLine ? null : hover ?? focusLayout // Gap line hides hover/caret grip
  if (hoverLayout && !gripLayouts.has(hoverLayout.block.from)) {
    gripLayouts.set(hoverLayout.block.from, hoverLayout)
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
      {Array.from(gripLayouts.values()).map((gl) => (
        <div key={gl.block.from} data-tt-block-handle>
          {/* ⋮⋮ grip — sole gutter control (add-block is the between-line) */}
          <div
            role="button"
            tabIndex={0}
            data-tt-block-handle
            className={cn(
              'nodrag nopan absolute z-[60] w-5 h-6 flex items-center justify-center rounded', // nodrag: ⋮⋮ never starts RF frame drag
              'text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-black/5 dark:hover:bg-white/10',
              'pointer-events-auto cursor-grab active:cursor-grabbing select-none'
            )}
            style={{
              left: 0, // Sole control in the narrowed gutter
              top: gl.top, // Align grip to top of the content block (not vertically centered)
            }}
            title="Drag to move · click for actions · Shift/⌘-click to multi-select"
            onPointerDown={(e) => onGripPointerDown(e, gl.block)}
            onClick={(e) => onGripClick(e, gl.block)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              openForBlock(gl.block, e.currentTarget.getBoundingClientRect().right, e.currentTarget.getBoundingClientRect().top)
            }}
          >
            <GripVertical className="h-4 w-4 pointer-events-none" />
          </div>
        </div>
      ))}

      {/* Same column/width as ⋮⋮ grip; vertically centered on the gap */}
      {insertLine && (
        <div
          role="button"
          tabIndex={0}
          data-tt-insert-line
          className="nodrag nopan absolute z-[61] cursor-pointer select-none"
          style={{
            left: 0, // Same gutter column as ⋮⋮
            top: insertLine.top - GRIP_H / 2, // Vertically center the grip-sized hit band on the gap
            width: GRIP_W, // Same width as the ⋮⋮ handle button
            height: GRIP_H,
          }}
          title="Add block"
          onPointerDown={(e) => e.stopPropagation()} // Never start RF frame drag
          onClick={onInsertLineClick}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault()
            onInsertLineClick(e as unknown as React.MouseEvent)
          }}
        >
          {/* Hairline centered in the same column as ⋮⋮ */}
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-px w-3 -translate-x-1/2 -translate-y-1/2 bg-black/20 dark:bg-white/25"
            aria-hidden
          />
        </div>
      )}

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
            currentBlockType={menu.blockType}
            pageInTargets={pageInTargets}
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
