'use client'

// Drag **frames** into / out of the legacy dashed wrapper (RF `blockGroup`, not a product type).
// Wrapper is an RF sibling (no parentId); membership is metadata.blockGroupId. ⋮⋮ is block-only.

import { useCallback, useRef } from 'react' // Stable drag handlers
import type { Node } from 'reactflow' // RF node shape (v11)
import { createClient } from '@/lib/supabase/client' // Persist placement to messages.metadata
import {
  blockGroupMessageIdFromNodeId, // block-group-{id} → message id
  deleteEmptyBlockGroups, // Drop group rows with no children left
  persistBlockPlacement, // Save absolute child position + optional blockGroupId
} from '@/lib/blocks'

/** Fraction of the block that must overlap a group to attach (avoid hairline hits). */
const DROP_OVERLAP_RATIO = 0.2

/** Page-absolute flow position (groups are siblings — no parent offset). */
export function absFlowPosition(node: Node, nodes: Node[]): { x: number; y: number } {
  if (!node.parentId) return { x: node.position.x, y: node.position.y } // Already page-absolute
  const parent = nodes.find((n) => n.id === node.parentId) // Legacy RF-parented leftover
  return {
    x: (parent?.position.x ?? 0) + node.position.x,
    y: (parent?.position.y ?? 0) + node.position.y,
  }
}

/** Measured or styled size with usable fallbacks for unmeasured blocks. */
export function nodeFlowSize(node: Node): { width: number; height: number } {
  const width =
    (typeof node.width === 'number' && node.width > 0 ? node.width : 0) ||
    (typeof node.style?.width === 'number' ? node.style.width : 0) ||
    280 // Typical unresized block
  const height =
    (typeof node.height === 'number' && node.height > 0 ? node.height : 0) ||
    (typeof node.style?.height === 'number' ? node.style.height : 0) ||
    160 // Typical unresized block
  return { width, height }
}

/** Overlap area (px²). */
function overlapArea(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return x * y
}

/** Group with the largest qualifying overlap under this block, or null. */
export function findDropTargetGroup(node: Node, nodes: Node[]): Node | null {
  const abs = absFlowPosition(node, nodes)
  const { width, height } = nodeFlowSize(node)
  const box = { x: abs.x, y: abs.y, w: width, h: height }
  const minArea = width * height * DROP_OVERLAP_RATIO
  let best: { group: Node; area: number } | null = null
  for (const n of nodes) {
    if (n.type !== 'blockGroup' || n.id === node.id) continue
    const gs = nodeFlowSize(n)
    const gbox = { x: n.position.x, y: n.position.y, w: gs.width, h: gs.height }
    const area = overlapArea(box, gbox)
    if (area < minArea) continue
    if (!best || area > best.area) best = { group: n, area }
  }
  return best?.group ?? null
}

/** metadata.blockGroupId on a chatPanel, if any. */
function childGroupId(node: Node): string | null {
  const id = node.data?.promptMessage?.metadata?.blockGroupId
  return typeof id === 'string' ? id : null
}

type UseBlockGroupDragOpts = {
  conversationId?: string
  getNodes: () => Node[]
  setNodes: (updater: Node[] | ((nds: Node[]) => Node[])) => void
  isLocked: boolean
}

/** Attach / detach chatPanel blocks. Group frame move is custom (ring) — not RF node drag. */
export function useBlockGroupDrag({ conversationId, getNodes, setNodes, isLocked }: UseBlockGroupDragOpts) {
  const dragRafRef = useRef<number | null>(null)
  const pendingNodeRef = useRef<Node | null>(null)

  const runDropHighlight = useCallback(
    (node: Node) => {
      const live = getNodes().map((n) => (n.id === node.id ? { ...n, position: node.position } : n))
      const targetId = findDropTargetGroup({ ...node, parentId: undefined }, live)?.id ?? null
      const current = getNodes()
      const needsUpdate = current.some((n) => {
        if (n.type !== 'blockGroup') return false
        const nextClass = targetId === n.id ? 'drop-target' : ''
        return (n.className || '') !== nextClass
      })
      if (!needsUpdate) return
      setNodes((nds) =>
        nds.map((n) => {
          if (n.type !== 'blockGroup') return n
          const nextClass = targetId === n.id ? 'drop-target' : ''
          if ((n.className || '') === nextClass) return n
          return { ...n, className: nextClass }
        })
      )
    },
    [getNodes, setNodes]
  )

  const onNodeDrag = useCallback(
    (_event: unknown, node: Node) => {
      if (isLocked || node.type !== 'chatPanel') return // Groups aren’t RF-draggable
      pendingNodeRef.current = node
      if (dragRafRef.current != null) return
      dragRafRef.current = requestAnimationFrame(() => {
        dragRafRef.current = null
        const pending = pendingNodeRef.current
        if (pending) runDropHighlight(pending)
      })
    },
    [isLocked, runDropHighlight]
  )

  const onNodeDragStop = useCallback(
    async (_event: unknown, node: Node) => {
      if (isLocked || !conversationId) {
        setNodes((nds) =>
          nds.map((n) => (n.type === 'blockGroup' && n.className ? { ...n, className: '' } : n))
        )
        return
      }

      const live = getNodes().map((n) =>
        n.id === node.id
          ? { ...n, position: node.position, parentId: undefined, extent: undefined } // Never keep RF parenting
          : n.type === 'blockGroup' && n.className
            ? { ...n, className: '' }
            : n
      )

      if (node.type !== 'chatPanel') {
        setNodes(live)
        return
      }

      const selected = live.filter((n) => n.selected && n.type === 'chatPanel' && n.data?.promptMessage?.id)
      const moving =
        selected.some((n) => n.id === node.id) && selected.length > 0
          ? selected
          : [live.find((n) => n.id === node.id) ?? node]

      const initiator = live.find((n) => n.id === node.id) ?? node
      const targetGroup = findDropTargetGroup({ ...initiator, parentId: undefined }, live)
      const targetGroupMessageId = targetGroup ? blockGroupMessageIdFromNodeId(targetGroup.id) : null
      const leftGroupIds = new Set<string>()

      const nextNodes = live.map((n) => {
        const isMoving = moving.some((m) => m.id === n.id)
        if (!isMoving || n.type !== 'chatPanel') return n
        const prevGroup = childGroupId(n)
        if (prevGroup && prevGroup !== targetGroupMessageId) leftGroupIds.add(prevGroup)
        const meta = { ...(n.data?.promptMessage?.metadata || {}) }
        if (targetGroupMessageId) meta.blockGroupId = targetGroupMessageId
        else delete meta.blockGroupId
        return {
          ...n,
          parentId: undefined, // Sibling layout — never RF-parented
          extent: undefined,
          data: {
            ...n.data,
            promptMessage: n.data?.promptMessage
              ? { ...n.data.promptMessage, metadata: meta }
              : n.data?.promptMessage,
          },
        }
      })

      setNodes(nextNodes)

      const supabase = createClient()
      try {
        for (const moved of moving) {
          const msgId = moved.data?.promptMessage?.id as string | undefined
          if (!msgId) continue
          const updated = nextNodes.find((n) => n.id === moved.id)
          if (!updated) continue
          await persistBlockPlacement(supabase, {
            messageId: msgId,
            position: updated.position,
            blockGroupId: targetGroupMessageId,
          })
        }
        if (leftGroupIds.size > 0) {
          const deleted = await deleteEmptyBlockGroups(supabase, [...leftGroupIds])
          if (deleted.length > 0) {
            const deletedNodeIds = new Set(deleted.map((id) => `block-group-${id}`))
            setNodes((nds) => nds.filter((n) => !deletedNodeIds.has(n.id)))
          }
        }
      } catch (err) {
        console.error('Failed to persist frame wrapper attach/detach:', err)
      }
    },
    [conversationId, getNodes, isLocked, setNodes]
  )

  return { onNodeDrag, onNodeDragStop }
}
