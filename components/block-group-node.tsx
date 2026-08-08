'use client'

// Legacy dashed wrapper (RF type `blockGroup`) around **frames**. Not a product type — see DEFINITIONS.md.
// RF drag OFF (`draggable: false`). Hollow interior so ⋮⋮ (**blocks**) / frames receive events.
// Ring drag moves the wrapper + member frames.

import { memo, useRef, type PointerEvent as ReactPointerEvent } from 'react' // Stable node type + drag baseline
import { NodeProps, useReactFlow } from 'reactflow' // RF node props + flow coords / setNodes
import { cn } from '@/lib/utils' // Class merge
import { createClient } from '@/lib/supabase/client' // Persist after ring drag
import {
  blockGroupMessageIdFromNodeId, // block-group-{id} → message id
  persistBlockGroupFrame, // Save frame origin + size
  persistBlockPlacement, // Save member absolute positions
} from '@/lib/blocks'

export type BlockGroupNodeData = {
  conversationId?: string // Owning map (persist after drag)
  label?: string // Optional group label
}

/** Border hit-target thickness (px) — padding ring around child cards. */
const GROUP_DRAG_EDGE = 10 // Thinner than BLOCK_GROUP_PADDING (24) so ⋮⋮ on inset cards doesn’t hit the ring

function BlockGroupNodeComponent({ id, selected, data }: NodeProps<BlockGroupNodeData>) {
  const { getNodes, setNodes, screenToFlowPosition } = useReactFlow() // Flow coords + live nodes
  const dragRef = useRef<{
    pointerId: number
    startFlow: { x: number; y: number } // Pointer in flow space at down
    startGroup: { x: number; y: number } // Frame origin at down
    members: Array<{ id: string; x: number; y: number; messageId: string }> // Member baselines
  } | null>(null)

  const onRingPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return // Left button only
    e.stopPropagation() // Don’t start RF selection / pane pan
    e.preventDefault()
    const nodes = getNodes()
    const group = nodes.find((n) => n.id === id)
    if (!group) return
    const groupMessageId = blockGroupMessageIdFromNodeId(id)
    const startFlow = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const members = nodes
      .filter(
        (n) =>
          n.type === 'chatPanel' &&
          n.data?.promptMessage?.metadata?.blockGroupId === groupMessageId
      )
      .map((n) => ({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        messageId: (n.data?.promptMessage?.id as string) || '',
      }))
    dragRef.current = {
      pointerId: e.pointerId,
      startFlow,
      startGroup: { x: group.position.x, y: group.position.y },
      members,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) // Keep drag off the ring
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        selected: n.id === id, // Select only the frame (cards must not be in RF dragItems)
      }))
    )
  }

  const onRingPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current
    if (!drag || e.pointerId !== drag.pointerId) return
    const now = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const dx = now.x - drag.startFlow.x // Flow delta X
    const dy = now.y - drag.startFlow.y // Flow delta Y
    const memberMap = new Map(drag.members.map((m) => [m.id, m]))
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === id) {
          return { ...n, position: { x: drag.startGroup.x + dx, y: drag.startGroup.y + dy } }
        }
        const m = memberMap.get(n.id)
        if (!m) return n
        return { ...n, position: { x: m.x + dx, y: m.y + dy } } // Keep members inside the moving frame
      })
    )
  }

  const onRingPointerUp = async (e: ReactPointerEvent) => {
    const drag = dragRef.current
    if (!drag || e.pointerId !== drag.pointerId) return
    dragRef.current = null
    const groupMessageId = blockGroupMessageIdFromNodeId(id)
    const conversationId = data?.conversationId
    if (!groupMessageId || !conversationId) return
    const group = getNodes().find((n) => n.id === id)
    if (!group) return
    const w = (typeof group.style?.width === 'number' ? group.style.width : group.width) || 400
    const h = (typeof group.style?.height === 'number' ? group.style.height : group.height) || 300
    try {
      const supabase = createClient()
      await persistBlockGroupFrame(supabase, {
        groupMessageId,
        position: group.position,
        size: { width: Number(w), height: Number(h) },
      })
      for (const m of drag.members) {
        if (!m.messageId) continue
        const live = getNodes().find((n) => n.id === m.id)
        if (!live) continue
        await persistBlockPlacement(supabase, {
          messageId: m.messageId,
          position: live.position,
          blockGroupId: groupMessageId,
        })
      }
    } catch (err) {
      console.error('Failed to persist group ring drag:', err)
    }
  }

  return (
    <div
      data-block-group="true" // Legacy wrapper chrome (not a product type)
      className="relative w-full h-full pointer-events-none" // Interior hollow — frames / ⋮⋮ receive events
      style={{ minWidth: 120, minHeight: 80 }}
      title={data?.label || 'Frame'}
    >
      {/* Visual dashed frame (no hit) */}
      <div
        className={cn(
          'absolute inset-0 rounded-2xl border-2 border-dashed pointer-events-none',
          selected
            ? 'border-blue-500 dark:border-blue-400 bg-blue-50/30 dark:bg-blue-950/20'
            : 'border-gray-300 dark:border-[#3a3a3a] bg-gray-50/40 dark:bg-[#1a1a1a]/40'
        )}
      />
      {/* Padding ring — only hittable surface; custom drag (RF drag is disabled on this node) */}
      <div
        className="block-group-drag-handle pointer-events-auto absolute top-0 left-0 right-0 cursor-grab active:cursor-grabbing"
        style={{ height: GROUP_DRAG_EDGE }}
        onPointerDown={onRingPointerDown}
        onPointerMove={onRingPointerMove}
        onPointerUp={onRingPointerUp}
      />
      <div
        className="block-group-drag-handle pointer-events-auto absolute bottom-0 left-0 right-0 cursor-grab active:cursor-grabbing"
        style={{ height: GROUP_DRAG_EDGE }}
        onPointerDown={onRingPointerDown}
        onPointerMove={onRingPointerMove}
        onPointerUp={onRingPointerUp}
      />
      <div
        className="block-group-drag-handle pointer-events-auto absolute top-0 bottom-0 left-0 cursor-grab active:cursor-grabbing"
        style={{ width: GROUP_DRAG_EDGE }}
        onPointerDown={onRingPointerDown}
        onPointerMove={onRingPointerMove}
        onPointerUp={onRingPointerUp}
      />
      <div
        className="block-group-drag-handle pointer-events-auto absolute top-0 bottom-0 right-0 cursor-grab active:cursor-grabbing"
        style={{ width: GROUP_DRAG_EDGE }}
        onPointerDown={onRingPointerDown}
        onPointerMove={onRingPointerMove}
        onPointerUp={onRingPointerUp}
      />
    </div>
  )
}

export const BlockGroupNode = memo(BlockGroupNodeComponent) // RF requires stable node types
