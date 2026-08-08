'use client'

// Notion-style ⋮⋮ handles per TipTap content block (not the map-card frame).

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { GripVertical } from 'lucide-react'
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
  jsonForEditorRange,
  moveEditorBlockToPos,
  refineListBlockType,
  registerHostEditor,
  setEditorBlockHighlight,
  turnEditorBlockInto,
  unregisterHostEditor,
  wrapJsonForInsert,
  type EditorBlockRef,
} from '@/lib/tiptap/block-selection'

type HandleLayout = {
  top: number // CSS px relative to editor gutter container (local, not screen)
  height: number
  block: EditorBlockRef
}

type TipTapBlockHandlesProps = {
  editor: Editor | null
  enabled?: boolean // Off for flashcards / project boards
  hostNodeId?: string // RF node id — for Page promote via board-flow
  conversationId?: string // Board id — extract a line onto the map as its own card
  pageInTargets?: PageInTarget[]
  onPageTurnInto?: (blockType: 'page' | 'pageIn', pageInParentId?: string | null) => void
}

type DropLine = { top: number; left: number; width: number } // Viewport dashed insert marker

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

/** Map-card frame that owns this editor (full width hover target). */
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
  const { screenToFlowPosition } = useReactFlow() // Drop-on-canvas → flow coords for a new card
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
  const [ghost, setGhost] = useState<{ x: number; y: number; text: string; width: number } | null>(null) // Floating preview of the dragged line
  // Keep latest layouts in refs so transaction refresh doesn’t need stale state
  const hoverRef = useRef<HandleLayout | null>(null)
  const focusRef = useRef<HandleLayout | null>(null)
  hoverRef.current = hover
  focusRef.current = focusLayout
  // Click vs drag on the ⋮⋮ grip — click opens menu; drag moves this content block only
  const gripPointerRef = useRef<{ x: number; y: number; dragged: boolean } | null>(null)
  const draggingRef = useRef(false) // Freeze hover/handle while a content-block drag is live

  // Register this card’s editor so ⋮⋮ drag can drop into it (and unregister on unmount)
  useEffect(() => {
    if (!editor || !hostNodeId || editor.isDestroyed) return
    registerHostEditor(hostNodeId, editor)
    return () => unregisterHostEditor(hostNodeId, editor)
  }, [editor, hostNodeId])

  // Clear highlight when menu closes
  const closeMenu = useCallback(() => {
    if (editor) setEditorBlockHighlight(editor, null)
    setMenu(null)
  }, [editor])

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
      // Pointer on the grip / menu — keep current hover
      if (el?.closest?.('[data-tt-block-handle], .block-actions-menu')) return

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
      // Leaving into grip / menu keeps hover so the control stays clickable
      if (related?.closest?.('[data-tt-block-handle], .block-actions-menu')) return
      // Leaving to another node inside the same frame — mousemove will re-resolve
      if (related && frame.contains(related)) return
      setHover(null)
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
      // Keep handle when focus moves to the grip / actions menu
      if (related?.closest?.('[data-tt-block-handle], .block-actions-menu')) return
      setFocusLayout(null)
    }

    // Re-measure after typing / Enter / zoom-driven reflow so grips stay glued to lines
    const refreshLayouts = () => {
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

  // Click vs drag: nodrag so RF never starts; pointermove/up on window for this content block only
  const onGripPointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0 || !editor) return // Left button + live editor
    e.stopPropagation() // Never start RF card / group drag from ⋮⋮
    const block = (hover ?? focusLayout)?.block
    if (!block) return
    gripPointerRef.current = { x: e.clientX, y: e.clientY, dragged: false } // Baseline for click vs drag
    const sourceHostId = hostNodeId // Card this line currently lives in
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

      // Drop on empty canvas → new map card with this line’s HTML
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
          content: html, // This content block becomes the new card body
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

  const onAction = useCallback(
    (action: BlockActionId, payload?: BlockActionPayload) => {
      if (!editor || !menu) return
      if (action === 'turnInto' && payload?.blockType) {
        if (payload.blockType === 'page' || payload.blockType === 'pageIn') {
          onPageTurnInto?.(payload.blockType, payload.pageInParentId)
          closeMenu()
          return
        }
        turnEditorBlockInto(editor, menu.block, payload.blockType)
        closeMenu()
        return
      }
      if (action === 'duplicate') {
        const { from, to } = menu.block
        const slice = editor.state.doc.slice(from, to)
        editor
          .chain()
          .focus()
          .insertContentAt(to, slice.content.toJSON())
          .run()
        closeMenu()
        return
      }
      if (action === 'delete') {
        editor.chain().focus().deleteRange({ from: menu.block.from, to: menu.block.to }).run()
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
    [editor, menu, closeMenu, onPageTurnInto, hostNodeId]
  )

  if (!editor || !enabled) return null

  // Hover (full-frame Y band) wins; else caret’s block
  const layout = hover ?? focusLayout
  const active = menu?.block ?? layout?.block

  return (
    <>
      {layout && active && (
        <div
          role="button"
          tabIndex={0}
          data-tt-block-handle
          className={cn(
            'nodrag nopan absolute z-[60] w-5 h-6 flex items-center justify-center rounded', // nodrag: ⋮⋮ never starts RF card drag
            'text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-black/5 dark:hover:bg-white/10',
            'pointer-events-auto cursor-grab active:cursor-grabbing select-none'
          )}
          style={{
            left: 0,
            top: layout.top, // Align grip to top of the content block (not vertically centered)
          }}
          title="Drag to move · click for actions"
          onPointerDown={onGripPointerDown}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            const start = gripPointerRef.current
            gripPointerRef.current = null
            if (start?.dragged) return // Drag moved this content block — don’t open the menu
            openForBlock(layout.block, e.clientX, e.clientY) // Click → content-block actions
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault()
            openForBlock(layout.block, e.currentTarget.getBoundingClientRect().right, e.currentTarget.getBoundingClientRect().top)
          }}
        >
          <GripVertical className="h-4 w-4 pointer-events-none" />
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
            selectedCount={1}
            canUngroup={false}
            onAction={onAction}
            onClose={closeMenu}
          />,
          document.body
        )}
    </>
  )
}
