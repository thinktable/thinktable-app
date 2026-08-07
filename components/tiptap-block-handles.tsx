'use client'

// Notion-style ⋮⋮ handles per TipTap content block (not the map-card frame).

import { useCallback, useEffect, useState } from 'react'
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
  findEditorBlockAtPos,
  refineListBlockType,
  setEditorBlockHighlight,
  turnEditorBlockInto,
  type EditorBlockRef,
} from '@/lib/tiptap/block-selection'

type HandleLayout = {
  top: number // px relative to editor container
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

export function TipTapBlockHandles({
  editor,
  enabled = true,
  hostNodeId,
  pageInTargets = [],
  onPageTurnInto,
}: TipTapBlockHandlesProps) {
  const [hover, setHover] = useState<HandleLayout | null>(null) // Handle beside hovered block
  const [menu, setMenu] = useState<{
    x: number // viewport
    y: number
    block: EditorBlockRef
    blockType: BlockTypeId
  } | null>(null)

  // Clear highlight when menu closes
  const closeMenu = useCallback(() => {
    if (editor) setEditorBlockHighlight(editor, null)
    setMenu(null)
  }, [editor])

  // Track hovered block → position handle in the left gutter
  useEffect(() => {
    if (!editor || !enabled || editor.isDestroyed) return
    const dom = editor.view.dom
    const container = dom.parentElement
    if (!container) return

    const onMove = (event: MouseEvent) => {
      if (menu) return // Keep handle on the open-menu block
      const pos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
      if (pos == null) {
        setHover(null)
        return
      }
      const block = findEditorBlockAtPos(editor, pos.pos)
      if (!block) {
        setHover(null)
        return
      }
      try {
        const start = editor.view.coordsAtPos(block.from + 1)
        const end = editor.view.coordsAtPos(Math.max(block.from + 1, block.to - 1))
        const containerRect = container.getBoundingClientRect()
        const top = start.top - containerRect.top
        const height = Math.max(22, end.bottom - start.top)
        setHover({ top, height, block })
      } catch {
        setHover(null)
      }
    }

    const onLeave = (event: MouseEvent) => {
      if (menu) return
      const related = event.relatedTarget as HTMLElement | null
      if (related?.closest?.('[data-tt-block-handle], .block-actions-menu')) return
      setHover(null)
    }

    container.addEventListener('mousemove', onMove)
    container.addEventListener('mouseleave', onLeave)
    return () => {
      container.removeEventListener('mousemove', onMove)
      container.removeEventListener('mouseleave', onLeave)
    }
  }, [editor, enabled, menu])

  // Close menu on outside click / Escape is handled by menu; clear when editor destroyed
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
      setHover({
        top: hover?.top ?? 0,
        height: hover?.height ?? 24,
        block,
      })
    },
    [editor, hover]
  )

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
      // Stubs / map-card-only actions
      closeMenu()
    },
    [editor, menu, closeMenu, onPageTurnInto, hostNodeId]
  )

  if (!editor || !enabled) return null

  const active = menu?.block ?? hover?.block
  const layout = hover

  return (
    <>
      {/* Left gutter for handles (Notion margin) */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-6 z-[5]" aria-hidden />

      {layout && active && (
        <button
          type="button"
          data-tt-block-handle
          className={cn(
            'nodrag nopan absolute z-[60] w-5 h-6 flex items-center justify-center rounded',
            'text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-black/5 dark:hover:bg-white/10',
            'pointer-events-auto cursor-grab'
          )}
          style={{
            left: 0,
            top: layout.top + Math.max(0, (layout.height - 24) / 2),
          }}
          title="Block actions"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            openForBlock(layout.block, e.clientX, e.clientY)
          }}
        >
          <GripVertical className="h-4 w-4" />
        </button>
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
