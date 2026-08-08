'use client'

// Notion-style ⋮⋮ handles per TipTap content block (not the map-card frame).

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  BlockActionsMenu,
  type BlockActionId,
  type BlockActionPayload,
  type BlockTypeId,
  type PageInTarget,
} from '@/components/block-actions-menu'
import {
  findEditorBlockAtClientY,
  findEditorBlockAtPos,
  refineListBlockType,
  setEditorBlockHighlight,
  turnEditorBlockInto,
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
  pageInTargets?: PageInTarget[]
  onPageTurnInto?: (blockType: 'page' | 'pageIn', pageInParentId?: string | null) => void
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

/** Map-card frame that owns this editor (full width hover target). */
function frameForEditor(dom: HTMLElement): HTMLElement {
  return (dom.closest('.react-flow__node') as HTMLElement | null) ?? dom.parentElement ?? dom
}

export function TipTapBlockHandles({
  editor,
  enabled = true,
  hostNodeId,
  pageInTargets = [],
  onPageTurnInto,
}: TipTapBlockHandlesProps) {
  const [hover, setHover] = useState<HandleLayout | null>(null) // Handle beside hovered block
  const [focusLayout, setFocusLayout] = useState<HandleLayout | null>(null) // Handle beside focused/caret block
  const [menu, setMenu] = useState<{
    x: number // viewport
    y: number
    block: EditorBlockRef
    blockType: BlockTypeId
  } | null>(null)
  // Keep latest layouts in refs so transaction refresh doesn’t need stale state
  const hoverRef = useRef<HandleLayout | null>(null)
  const focusRef = useRef<HandleLayout | null>(null)
  hoverRef.current = hover
  focusRef.current = focusLayout
  // Click vs drag on the ⋮⋮ grip — click opens menu; drag moves the map card (RF node)
  const gripPointerRef = useRef<{ x: number; y: number; dragged: boolean } | null>(null)

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
      if (menu) return // Keep handle on the open-menu block
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
      if (menu) return
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

  // Click vs drag: window listeners survive RF capturing the pointer after node-drag starts
  const onGripPointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0) return // Left button only
    gripPointerRef.current = { x: e.clientX, y: e.clientY, dragged: false } // Baseline
    const onMove = (ev: PointerEvent) => {
      const start = gripPointerRef.current
      if (!start || start.dragged) return
      const dx = ev.clientX - start.x
      const dy = ev.clientY - start.y
      if (dx * dx + dy * dy > 16) start.dragged = true // ~4px → node drag, not menu
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
    }
    window.addEventListener('pointermove', onMove, true) // Capture even after RF takes the pointer
    window.addEventListener('pointerup', onUp, true)
    // Do not stopPropagation — React Flow needs this pointerdown/mousedown to drag the map card
  }, [])

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
            'nopan absolute z-[60] w-5 h-6 flex items-center justify-center rounded', // Div, not button — RF ignores drag starts on BUTTON
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
            if (start?.dragged) return // Drag moved the card — don’t open the menu
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
