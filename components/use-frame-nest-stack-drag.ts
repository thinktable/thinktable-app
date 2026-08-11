'use client'

// Snap a **frame** flush to another frame’s edge (magnetic align). On release, link the pair
// (stack line; both stay visible). Snap does **not** lock — first **Stack** sets `snapLockGroupId`.
// Outer RF box stays upright (AABB); content may rotate inside. Snap uses upright edges.
// See DEFINITIONS.md + CONTEXT.md.

import { useCallback, useRef, useState } from 'react' // Drag UI state
import type { Node } from 'reactflow' // RF node shape
import { createClient } from '@/lib/supabase/client' // Persist snap link meta
import { absFlowPosition, nodeFlowSize } from '@/components/use-block-group-drag' // Absolute box helpers
import { persistBlockPlacement } from '@/lib/blocks' // Save snapped position

/** Side of the host frame used for stack reveal / expand / snap preview. */
export type FrameStackSide = 'top' | 'right' | 'bottom' | 'left'

/** Live snap chrome while dragging a frame near another’s edge. */
export type FrameNestStackUi = {
  targetId: string // Host frame RF id we’d snap against
  mode: 'snap' // Edge snap preview only (no auto-stack on release)
  stackSide: FrameStackSide // Which host edge is the snap target
  /** Screen rect of the target frame (for preview line placement). */
  targetRect: { top: number; left: number; width: number; height: number }
}

const STACK_EXPAND_GAP = 12 // Gap between host and first stacked frame / between mates
/** Flow gap left between snapped frames so the stack line stays clickable (not under the mate). */
export const STACK_LINE_GAP = STACK_EXPAND_GAP
/** Flow-px gap (edge-to-edge) that arms snap preview. */
const SNAP_ARM_PX = 28
/** Flow-px gap that magnets the dragged frame to the parked snap distance. */
const SNAP_MAGNET_PX = 18
/** Min fraction of the shorter parallel edge that must overlap to count as a side snap. */
const SNAP_OVERLAP_MIN = 0.25

type FlowBox = { x: number; y: number; width: number; height: number }

type SnapCandidate = {
  targetId: string
  side: FrameStackSide // Side of the HOST the dragged frame attaches to
  gap: number // Absolute edge-to-edge gap in flow px
  /** Absolute flow position for the dragged frame when flush on that side. */
  snappedAbs: { x: number; y: number }
  /** Absolute box of the host (for screen-rect sync). */
  hostAbs: FlowBox
}

/** Screen DOMRect for a chatPanel RF node, or null if unmounted. */
export function frameScreenRect(nodeId: string): DOMRect | null {
  const el = document.querySelector(
    `.react-flow__node[data-id="${CSS.escape(nodeId)}"]`
  ) as HTMLElement | null
  if (!el) return null
  return el.getBoundingClientRect()
}

/**
 * Flow position for a stacked frame expanded out from `front` on `side`.
 * `stackOrder` 0 = closest to host; later mates sit further out, adjacent to prior mates.
 */
export function stackExpandLayout(
  front: { x: number; y: number; width: number; height: number },
  side: FrameStackSide,
  stacked: { width: number; height: number },
  stackOrder = 0,
  priorSizes: Array<{ width: number; height: number }> = []
): { x: number; y: number } {
  const w = Math.max(48, stacked.width)
  const h = Math.max(32, stacked.height)
  let offset = STACK_EXPAND_GAP
  for (let i = 0; i < stackOrder; i++) {
    const prev = priorSizes[i] || stacked
    if (side === 'right' || side === 'left') {
      offset += Math.max(48, prev.width) + STACK_EXPAND_GAP
    } else {
      offset += Math.max(32, prev.height) + STACK_EXPAND_GAP
    }
  }
  if (side === 'right') {
    return { x: front.x + front.width + offset, y: front.y + (front.height - h) / 2 }
  }
  if (side === 'left') {
    return { x: front.x - w - offset, y: front.y + (front.height - h) / 2 }
  }
  if (side === 'top') {
    return { x: front.x + (front.width - w) / 2, y: front.y - h - offset }
  }
  return { x: front.x + (front.width - w) / 2, y: front.y + front.height + offset }
}

/** True when this chatPanel is a collapsed (hidden) stack mate. */
export function isStackCollapsedMeta(meta?: Record<string, unknown> | null): boolean {
  if (!meta || typeof meta.stackGroupId !== 'string') return false
  if (meta.stackIndex === 0 || meta.stackAnchor === true) return false // Host stays visible
  return meta.stackExpanded !== true // Expanded mates are visible
}

/** Parallel-axis overlap length between two intervals. */
function overlapLen(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

/**
 * Among visible frames in a stack group, the box furthest on `side`
 * (so a newly snapped frame parks past the whole stack — existing mates stay put).
 */
function groupExtentOnSide(
  groupId: string,
  side: FrameStackSide,
  live: Node[],
  fallback: FlowBox
): FlowBox {
  const boxes: FlowBox[] = []
  for (const n of live) {
    if (n.type !== 'chatPanel' || n.hidden) continue
    const m = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
    if (m.stackGroupId !== groupId) continue
    const abs = absFlowPosition(n, live)
    const size = nodeFlowSize(n)
    boxes.push({ x: abs.x, y: abs.y, width: size.width, height: size.height })
  }
  if (boxes.length === 0) return fallback
  if (side === 'right') {
    return boxes.reduce((a, b) => (a.x + a.width >= b.x + b.width ? a : b))
  }
  if (side === 'left') {
    return boxes.reduce((a, b) => (a.x <= b.x ? a : b))
  }
  if (side === 'bottom') {
    return boxes.reduce((a, b) => (a.y + a.height >= b.y + b.height ? a : b))
  }
  return boxes.reduce((a, b) => (a.y <= b.y ? a : b))
}

/**
 * Best edge-snap of `dragged` onto another chatPanel (host).
 * Prefers small edge gap + strong overlap along the shared edge.
 * If the target is already in a stack, parks past the outermost mate on that side
 * so previously snapped frames are not shoved.
 */
export function findFrameEdgeSnap(
  dragged: Node,
  live: Node[],
  armPx = SNAP_ARM_PX,
  excludeTargetIds?: Set<string> // Skip these hosts (e.g. just-unstacked mates)
): SnapCandidate | null {
  if (dragged.type !== 'chatPanel') return null
  const dragMeta = (dragged.data?.promptMessage?.metadata || {}) as Record<string, unknown>
  const dragGroup =
    typeof dragMeta.stackGroupId === 'string' ? dragMeta.stackGroupId : null

  const dAbs = absFlowPosition(dragged, live)
  const dSize = nodeFlowSize(dragged)
  const dBox: FlowBox = { x: dAbs.x, y: dAbs.y, width: dSize.width, height: dSize.height }

  let best: SnapCandidate | null = null
  let bestScore = Infinity

  for (const host of live) {
    if (host.id === dragged.id || host.type !== 'chatPanel') continue
    if (excludeTargetIds?.has(host.id)) continue
    if (!host.data?.promptMessage?.id) continue
    if (host.hidden) continue
    const hMeta = (host.data?.promptMessage?.metadata || {}) as Record<string, unknown>
    // Don’t snap onto your own stack mates
    if (dragGroup && hMeta.stackGroupId === dragGroup) continue

    const hAbs = absFlowPosition(host, live)
    const hSize = nodeFlowSize(host)
    const hBox: FlowBox = { x: hAbs.x, y: hAbs.y, width: hSize.width, height: hSize.height }
    const hostGroup =
      typeof hMeta.stackGroupId === 'string' ? hMeta.stackGroupId : null

    const sides: FrameStackSide[] = ['right', 'left', 'bottom', 'top']
    for (const side of sides) {
      let gap = Infinity
      let overlap = 0
      let parallel = 1

      // Park past the whole stack on this side when the target is already linked
      const parkBox = hostGroup
        ? groupExtentOnSide(hostGroup, side, live, hBox)
        : hBox

      let snappedAbs = { x: dBox.x, y: dBox.y }
      if (side === 'right') {
        gap = dBox.x - (hBox.x + hBox.width)
        overlap = overlapLen(dBox.y, dBox.y + dBox.height, hBox.y, hBox.y + hBox.height)
        parallel = Math.min(dBox.height, hBox.height)
        snappedAbs = {
          x: parkBox.x + parkBox.width + STACK_LINE_GAP,
          y: dBox.y,
        }
      } else if (side === 'left') {
        gap = hBox.x - (dBox.x + dBox.width)
        overlap = overlapLen(dBox.y, dBox.y + dBox.height, hBox.y, hBox.y + hBox.height)
        parallel = Math.min(dBox.height, hBox.height)
        snappedAbs = {
          x: parkBox.x - dBox.width - STACK_LINE_GAP,
          y: dBox.y,
        }
      } else if (side === 'bottom') {
        gap = dBox.y - (hBox.y + hBox.height)
        overlap = overlapLen(dBox.x, dBox.x + dBox.width, hBox.x, hBox.x + hBox.width)
        parallel = Math.min(dBox.width, hBox.width)
        snappedAbs = {
          x: dBox.x,
          y: parkBox.y + parkBox.height + STACK_LINE_GAP,
        }
      } else {
        gap = hBox.y - (dBox.y + dBox.height)
        overlap = overlapLen(dBox.x, dBox.x + dBox.width, hBox.x, hBox.x + hBox.width)
        parallel = Math.min(dBox.width, hBox.width)
        snappedAbs = {
          x: dBox.x,
          y: parkBox.y - dBox.height - STACK_LINE_GAP,
        }
      }

      // Gap is measured to the hovered frame (arm), but park uses stack extent
      if (hostGroup && parkBox !== hBox) {
        if (side === 'right') gap = dBox.x - (parkBox.x + parkBox.width)
        else if (side === 'left') gap = parkBox.x - (dBox.x + dBox.width)
        else if (side === 'bottom') gap = dBox.y - (parkBox.y + parkBox.height)
        else gap = parkBox.y - (dBox.y + dBox.height)
      }

      if (gap < -2 || gap > armPx) continue
      if (parallel <= 0 || overlap / parallel < SNAP_OVERLAP_MIN) continue

      const score = Math.abs(gap - STACK_LINE_GAP) + (1 - overlap / parallel) * 8
      if (score >= bestScore) continue
      bestScore = score
      best = {
        targetId: host.id,
        side,
        gap: Math.abs(gap),
        snappedAbs,
        hostAbs: hBox,
      }
    }
  }

  return best
}

/** Convert absolute flow position to RF node.position (respect parent group origin). */
function absToNodePosition(
  node: Node,
  abs: { x: number; y: number },
  live: Node[]
): { x: number; y: number } {
  if (!node.parentId) return abs
  const parent = live.find((n) => n.id === node.parentId)
  if (!parent) return abs
  const pAbs = absFlowPosition(parent, live)
  return { x: abs.x - pAbs.x, y: abs.y - pAbs.y }
}

/** True when stack line Lock is on for this frame (`snapLockGroupId` === `stackGroupId`). */
export function isSnapLockedMeta(meta?: Record<string, unknown> | null): boolean {
  if (!meta) return false
  return (
    typeof meta.snapLockGroupId === 'string' &&
    typeof meta.stackGroupId === 'string' &&
    meta.snapLockGroupId === meta.stackGroupId
  )
}

/** Strip stack / snap-lock fields from message metadata (frame leaves the stack). */
function stripStackFields(meta: Record<string, unknown>): Record<string, unknown> {
  const next = { ...meta }
  delete next.stackGroupId
  delete next.stackSide
  delete next.stackIndex
  delete next.stackExpanded
  delete next.stackAnchor
  delete next.snapLockGroupId
  return next
}

function nodeMeta(n: Node): Record<string, unknown> {
  return (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
}

/** Min drag distance (flow px) before an unlocked stacked frame unstacks. */
const UNSTACK_MOVE_PX = 6

type UseFrameNestStackDragOpts = {
  conversationId?: string
  getNodes: () => Node[]
  setNodes: (updater: Node[] | ((nds: Node[]) => Node[])) => void
  isLocked: boolean
  takeSnapshot?: () => void
  refetchMessages?: () => void
}

/**
 * Edge-snap while dragging a chatPanel.
 * Lock (`snapLockGroupId`): drag moves the whole connected stack together.
 * Unlocked stack: dragging a frame far enough clears its stack link (unstacks).
 */
export function useFrameNestStackDrag({
  conversationId,
  getNodes,
  setNodes,
  isLocked,
  takeSnapshot,
}: UseFrameNestStackDragOpts) {
  const [dropUi, setDropUi] = useState<FrameNestStackUi | null>(null) // Snap preview chrome
  const dropUiRef = useRef<FrameNestStackUi | null>(null)
  dropUiRef.current = dropUi
  const snapRef = useRef<SnapCandidate | null>(null) // Latest snap for dragStop link
  // Locked-group drag: origins at drag start so mates track the primary delta
  const lockDragRef = useRef<{
    primaryId: string
    lockId: string
    origins: Map<string, { x: number; y: number }>
  } | null>(null)
  const unstackedThisDragRef = useRef(false) // Only unstack once per drag
  const dragStartPosRef = useRef<{ id: string; x: number; y: number } | null>(null)
  // After unstack, don't magnet/re-link to these former mates for the rest of the drag
  const excludeSnapIdsRef = useRef<Set<string>>(new Set())

  const clearUi = useCallback(() => {
    dropUiRef.current = null
    snapRef.current = null
    setDropUi(null)
  }, [])

  const onNodeDragStart = useCallback(
    (_event: unknown, node: Node) => {
      if (node.type !== 'chatPanel') return
      unstackedThisDragRef.current = false
      lockDragRef.current = null
      excludeSnapIdsRef.current = new Set()
      dragStartPosRef.current = { id: node.id, x: node.position.x, y: node.position.y }
      // Prefer live store meta (menu Unlock may have just cleared snapLockGroupId)
      const live = getNodes()
      const liveNode = live.find((n) => n.id === node.id) || node
      const meta = nodeMeta(liveNode)
      if (!isSnapLockedMeta(meta)) return
      const lockId = meta.snapLockGroupId as string
      const origins = new Map<string, { x: number; y: number }>()
      for (const n of live) {
        if (n.type !== 'chatPanel') continue
        const m = nodeMeta(n)
        if (m.snapLockGroupId !== lockId) continue
        origins.set(n.id, { x: n.position.x, y: n.position.y })
      }
      lockDragRef.current = { primaryId: node.id, lockId, origins }
    },
    [getNodes]
  )

  /** Persist cleared stack meta for one message. */
  const persistStripStack = useCallback(async (msgId: string) => {
    if (!msgId) return
    const supabase = createClient()
    const { data: row } = await supabase
      .from('messages')
      .select('metadata')
      .eq('id', msgId)
      .maybeSingle()
    if (!row) return
    await supabase
      .from('messages')
      .update({
        metadata: stripStackFields((row.metadata as Record<string, unknown>) || {}),
      })
      .eq('id', msgId)
  }, [])

  /**
   * Remove `node` from its stack group (unlocked drag).
   * If ≤1 frame would remain in the group, clear the whole group.
   */
  const unstackNode = useCallback(
    (node: Node) => {
      const live = getNodes()
      const liveNode = live.find((n) => n.id === node.id) || node
      const meta = nodeMeta(liveNode)
      const groupId = meta.stackGroupId
      if (typeof groupId !== 'string' || isSnapLockedMeta(meta)) return
      takeSnapshot?.()
      const groupMembers = live.filter((n) => {
        if (n.type !== 'chatPanel') return false
        return nodeMeta(n).stackGroupId === groupId
      })
      // Don't re-snap to anyone we just delinked from
      for (const n of groupMembers) {
        if (n.id !== liveNode.id) excludeSnapIdsRef.current.add(n.id)
      }
      snapRef.current = null
      clearUi()

      const remaining = groupMembers.filter((n) => n.id !== liveNode.id)
      const clearIds = new Set<string>([liveNode.id])
      if (remaining.length <= 1) {
        remaining.forEach((n) => clearIds.add(n.id))
      }

      // Dragged host with 2+ mates left: promote another to anchor
      let promoteId: string | null = null
      if (
        remaining.length > 1 &&
        (meta.stackAnchor === true || meta.stackIndex === 0)
      ) {
        const promote = [...remaining].sort((a, b) => {
          const ai = nodeMeta(a).stackIndex
          const bi = nodeMeta(b).stackIndex
          return (typeof ai === 'number' ? ai : 99) - (typeof bi === 'number' ? bi : 99)
        })[0]
        promoteId = promote?.id ?? null
      }

      setNodes((nds) =>
        nds.map((n) => {
          if (clearIds.has(n.id)) {
            const nextMeta = stripStackFields(nodeMeta(n))
            return {
              ...n,
              hidden: false,
              data: {
                ...n.data,
                promptMessage: n.data?.promptMessage
                  ? { ...n.data.promptMessage, metadata: nextMeta }
                  : n.data?.promptMessage,
              },
            }
          }
          if (promoteId && n.id === promoteId) {
            const nextMeta = {
              ...nodeMeta(n),
              stackIndex: 0,
              stackAnchor: true,
              stackExpanded: true,
            }
            delete nextMeta.snapLockGroupId // Unlocked until re-snapped
            return {
              ...n,
              hidden: false,
              data: {
                ...n.data,
                promptMessage: n.data?.promptMessage
                  ? { ...n.data.promptMessage, metadata: nextMeta }
                  : n.data?.promptMessage,
              },
            }
          }
          return n
        })
      )

      void (async () => {
        try {
          for (const id of clearIds) {
            const n = live.find((x) => x.id === id)
            const msgId = n?.data?.promptMessage?.id as string | undefined
            if (msgId) await persistStripStack(msgId)
          }
          if (promoteId) {
            const promo = live.find((x) => x.id === promoteId)
            const promoId = promo?.data?.promptMessage?.id as string | undefined
            if (promoId) {
              const supabase = createClient()
              const { data: row } = await supabase
                .from('messages')
                .select('metadata')
                .eq('id', promoId)
                .maybeSingle()
              if (row) {
                const next = {
                  ...((row.metadata as Record<string, unknown>) || {}),
                  stackIndex: 0,
                  stackAnchor: true,
                  stackExpanded: true,
                }
                delete next.snapLockGroupId
                await supabase.from('messages').update({ metadata: next }).eq('id', promoId)
              }
            }
          }
        } catch (err) {
          console.error('Failed to persist unstack:', err)
        }
      })()
    },
    [clearUi, getNodes, persistStripStack, setNodes, takeSnapshot]
  )

  const onNodeDrag = useCallback(
    (_event: { clientX: number; clientY: number } | undefined, node: Node) => {
      if (isLocked || node.type !== 'chatPanel') {
        if (dropUiRef.current) clearUi()
        return
      }

      const live = getNodes()
      const liveNode = live.find((n) => n.id === node.id) || node
      // Position from the drag event (RF); meta from live store (Unlock is live)
      const dragNode = { ...liveNode, position: node.position }
      const meta = nodeMeta(liveNode)

      // Locked: move every frame sharing snapLockGroupId by the same delta
      if (isSnapLockedMeta(meta) && lockDragRef.current?.primaryId === node.id) {
        const { lockId, origins } = lockDragRef.current
        const origin = origins.get(node.id)
        if (origin) {
          const dx = node.position.x - origin.x
          const dy = node.position.y - origin.y
          setNodes((nds) =>
            nds.map((n) => {
              if (n.id === node.id) return n // Primary already at RF position
              const o = origins.get(n.id)
              if (!o) return n
              if (nodeMeta(n).snapLockGroupId !== lockId) return n
              return { ...n, position: { x: o.x + dx, y: o.y + dy } }
            })
          )
        }
        // Locked stacks don't edge-snap mid-drag (would break the rigid group)
        if (dropUiRef.current) clearUi()
        return
      }

      // Unlocked but stacked: drag apart → delink from stack
      if (
        typeof meta.stackGroupId === 'string' &&
        !isSnapLockedMeta(meta) &&
        !unstackedThisDragRef.current
      ) {
        const start = dragStartPosRef.current
        const moved =
          start?.id === node.id
            ? Math.hypot(node.position.x - start.x, node.position.y - start.y)
            : UNSTACK_MOVE_PX
        if (moved >= UNSTACK_MOVE_PX) {
          unstackedThisDragRef.current = true
          unstackNode(dragNode)
          return // Skip snap this tick; former mates are excluded going forward
        }
      }

      // After an unstack this drag, never re-magnet to the old partners
      if (unstackedThisDragRef.current) {
        const snap = findFrameEdgeSnap(
          dragNode,
          live,
          SNAP_ARM_PX,
          excludeSnapIdsRef.current
        )
        if (!snap) {
          if (dropUiRef.current) clearUi()
          return
        }
        snapRef.current = snap
        const rect = frameScreenRect(snap.targetId)
        setDropUi({
          targetId: snap.targetId,
          mode: 'snap',
          stackSide: snap.side,
          targetRect: rect
            ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
            : {
                top: 0,
                left: 0,
                width: snap.hostAbs.width,
                height: snap.hostAbs.height,
              },
        })
        if (snap.gap <= SNAP_MAGNET_PX) {
          const nextPos = absToNodePosition(dragNode, snap.snappedAbs, live)
          const cur = dragNode.position
          if (Math.abs(cur.x - nextPos.x) > 0.5 || Math.abs(cur.y - nextPos.y) > 0.5) {
            setNodes((nds) =>
              nds.map((n) => (n.id === dragNode.id ? { ...n, position: nextPos } : n))
            )
          }
        }
        return
      }

      const snap = findFrameEdgeSnap(dragNode, live)
      if (!snap) {
        if (dropUiRef.current) clearUi()
        return
      }

      snapRef.current = snap
      const rect = frameScreenRect(snap.targetId)
      const targetRect = rect
        ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
        : {
            top: 0,
            left: 0,
            width: snap.hostAbs.width,
            height: snap.hostAbs.height,
          }

      setDropUi({
        targetId: snap.targetId,
        mode: 'snap',
        stackSide: snap.side,
        targetRect,
      })

      if (snap.gap <= SNAP_MAGNET_PX) {
        const nextPos = absToNodePosition(dragNode, snap.snappedAbs, live)
        const cur = dragNode.position
        if (Math.abs(cur.x - nextPos.x) > 0.5 || Math.abs(cur.y - nextPos.y) > 0.5) {
          setNodes((nds) =>
            nds.map((n) => (n.id === dragNode.id ? { ...n, position: nextPos } : n))
          )
        }
      }
    },
    [clearUi, getNodes, isLocked, setNodes, unstackNode]
  )

  const onNodeDragStop = useCallback(
    async (_event: unknown, node: Node) => {
      const snap = snapRef.current
      const lockSession = lockDragRef.current
      const didUnstack = unstackedThisDragRef.current
      const excludeIds = excludeSnapIdsRef.current
      clearUi()
      lockDragRef.current = null
      dragStartPosRef.current = null
      unstackedThisDragRef.current = false
      excludeSnapIdsRef.current = new Set()

      // Persist locked-group positions
      if (
        lockSession &&
        lockSession.primaryId === node.id &&
        conversationId &&
        node.type === 'chatPanel'
      ) {
        const live = getNodes()
        const supabase = createClient()
        try {
          for (const n of live) {
            if (n.type !== 'chatPanel') continue
            if (nodeMeta(n).snapLockGroupId !== lockSession.lockId) continue
            const msgId = n.data?.promptMessage?.id as string | undefined
            if (!msgId) continue
            const abs = absFlowPosition(n, live)
            await persistBlockPlacement(supabase, { messageId: msgId, position: abs })
          }
        } catch (err) {
          console.error('Failed to persist locked stack positions:', err)
        }
        return
      }

      // Unlocked drag-away already delinked — don't re-link to former mates on release
      if (didUnstack) {
        if (!snap || excludeIds.has(snap.targetId)) return
        // Allow linking to a *new* frame if they dragged onto a different one
      }

      if (isLocked || !conversationId || node.type !== 'chatPanel' || !snap) return
      if (snap.targetId === node.id) return
      if (excludeIds.has(snap.targetId)) return
      if (snap.gap > SNAP_ARM_PX) return

      const sourceMsgId = node.data?.promptMessage?.id as string | undefined
      const live = getNodes()
      const front = live.find((n) => n.id === snap.targetId)
      const targetMsgId = front?.data?.promptMessage?.id as string | undefined
      if (!sourceMsgId || !targetMsgId || !front) return

      const dragMeta = nodeMeta(live.find((n) => n.id === node.id) || node)
      const frontMeta = { ...nodeMeta(front) }
      const existingGroup =
        typeof frontMeta.stackGroupId === 'string' ? frontMeta.stackGroupId : null
      if (
        existingGroup &&
        dragMeta.stackGroupId === existingGroup &&
        frontMeta.stackSide === snap.side
      ) {
        return
      }

      const stackGroupId = existingGroup || targetMsgId
      const groupSide =
        (existingGroup &&
        (['top', 'right', 'bottom', 'left'] as const).includes(
          frontMeta.stackSide as FrameStackSide
        )
          ? (frontMeta.stackSide as FrameStackSide)
          : snap.side)
      const existingMates = live.filter((n) => {
        if (n.id === node.id) return false
        return nodeMeta(n).stackGroupId === stackGroupId
      })
      const nextIndex = existingGroup
        ? existingMates.reduce((max, n) => {
            const i = nodeMeta(n).stackIndex
            return typeof i === 'number' && i > max ? i : max
          }, 0) + 1
        : 1

      // Drag-time snap already parks past the stack extent — only the new frame moves
      const parkAbs = snap.snappedAbs
      const snappedNodePos = absToNodePosition(node, parkAbs, live)

      takeSnapshot?.()

      // Join existing group: only move the new frame; keep original host/anchor.
      // New group: target becomes host. Snap does NOT lock — Lock happens on first Stack.
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === node.id) {
            const nextMeta = {
              ...nodeMeta(n),
              stackGroupId,
              stackSide: groupSide,
              stackIndex: nextIndex,
              stackExpanded: true,
              position: parkAbs,
            }
            delete nextMeta.stackAnchor
            delete nextMeta.snapLockGroupId
            return {
              ...n,
              position: snappedNodePos,
              hidden: false,
              zIndex: 1,
              data: {
                ...n.data,
                promptMessage: n.data?.promptMessage
                  ? { ...n.data.promptMessage, metadata: nextMeta }
                  : n.data?.promptMessage,
              },
            }
          }
          if (existingGroup) {
            // Existing members: side only — never rewrite position / steal anchor / auto-lock
            if (nodeMeta(n).stackGroupId === stackGroupId) {
              const nextMeta = {
                ...nodeMeta(n),
                stackSide: groupSide,
              }
              return {
                ...n,
                data: {
                  ...n.data,
                  promptMessage: n.data?.promptMessage
                    ? { ...n.data.promptMessage, metadata: nextMeta }
                    : n.data?.promptMessage,
                },
              }
            }
            return n
          }
          if (n.id === snap.targetId) {
            const nextMeta = {
              ...nodeMeta(n),
              stackGroupId,
              stackSide: groupSide,
              stackIndex: 0,
              stackAnchor: true,
            }
            delete nextMeta.snapLockGroupId
            return {
              ...n,
              zIndex: 1,
              data: {
                ...n.data,
                promptMessage: n.data?.promptMessage
                  ? { ...n.data.promptMessage, metadata: nextMeta }
                  : n.data?.promptMessage,
              },
            }
          }
          return n
        })
      )

      const supabase = createClient()
      try {
        const { data: mateRow } = await supabase
          .from('messages')
          .select('metadata')
          .eq('id', sourceMsgId)
          .maybeSingle()
        if (mateRow) {
          const mateMeta = {
            ...((mateRow.metadata as Record<string, unknown>) || {}),
            stackGroupId,
            stackSide: groupSide,
            stackIndex: nextIndex,
            stackExpanded: true,
            position: parkAbs,
          }
          delete mateMeta.stackAnchor
          delete mateMeta.snapLockGroupId
          await supabase.from('messages').update({ metadata: mateMeta }).eq('id', sourceMsgId)
        }
        if (!existingGroup) {
          const { data: hostRow } = await supabase
            .from('messages')
            .select('metadata')
            .eq('id', targetMsgId)
            .maybeSingle()
          if (hostRow) {
            const hostMeta = {
              ...((hostRow.metadata as Record<string, unknown>) || {}),
              stackGroupId,
              stackSide: groupSide,
              stackIndex: 0,
              stackAnchor: true,
            }
            delete hostMeta.snapLockGroupId
            await supabase.from('messages').update({ metadata: hostMeta }).eq('id', targetMsgId)
          }
        } else {
          for (const n of live) {
            if (n.id === node.id) continue
            if (nodeMeta(n).stackGroupId !== stackGroupId) continue
            const msgId = n.data?.promptMessage?.id as string | undefined
            if (!msgId) continue
            const { data: row } = await supabase
              .from('messages')
              .select('metadata')
              .eq('id', msgId)
              .maybeSingle()
            if (!row) continue
            await supabase
              .from('messages')
              .update({
                metadata: {
                  ...((row.metadata as Record<string, unknown>) || {}),
                  stackSide: groupSide,
                },
              })
              .eq('id', msgId)
          }
        }
        await persistBlockPlacement(supabase, {
          messageId: sourceMsgId,
          position: parkAbs,
        })
      } catch (err) {
        console.error('Failed to persist snap stack line:', err)
      }
    },
    [clearUi, conversationId, getNodes, isLocked, setNodes, takeSnapshot]
  )

  return { dropUi, onNodeDrag, onNodeDragStart, onNodeDragStop, clearUi }
}
