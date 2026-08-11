'use client'

// Snap a **frame** flush to another frame’s upright adjust-box edge (magnetic align).
// On release, link into that side’s stack tree (stack line; both stay visible).
// Each side (top/right/bottom/left) has its own tree — a frame can belong to several.
// Snap does **not** lock — first **Stack** sets lock for that group only.
// See DEFINITIONS.md + CONTEXT.md.

import { useCallback, useRef, useState } from 'react' // Drag UI state
import type { Node } from 'reactflow' // RF node shape
import { createClient } from '@/lib/supabase/client' // Persist snap link meta
import { absFlowPosition, nodeFlowSize } from '@/components/use-block-group-drag' // Absolute box helpers
import { persistBlockPlacement } from '@/lib/blocks' // Save snapped position
import {
  findStackEntry,
  groupIdsOf,
  isGroupLocked,
  isSnapLockedMeta,
  readSideStacks,
  setSideStackEntry,
  sideStackGroupId,
  stackIndexInGroup,
  stripGroupFromMeta,
  collectNestedSatelliteIds,
  type FrameStackSide,
  type SideStackEntry,
} from '@/lib/frame-side-stacks'

export type { FrameStackSide }
export { isSnapLockedMeta }

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

function nodeMeta(n: Node): Record<string, unknown> {
  return (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
}

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

/** True when this chatPanel is a collapsed (hidden) stack mate on every tree it belongs to. */
export function isStackCollapsedMeta(meta?: Record<string, unknown> | null): boolean {
  if (!meta) return false
  // Nested under a collapsed parent tree (e.g. C on A’s bottom while A is under B)
  if (typeof meta.parentStackHidden === 'string') return true
  const entries = Object.values(readSideStacks(meta))
  if (entries.length === 0) return false
  // Anchor on any side stays visible
  if (entries.some((e) => e.index === 0 || e.anchor === true)) return false
  // Visible if expanded on any side tree
  return entries.every((e) => e.expanded !== true)
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
    if (!findStackEntry(nodeMeta(n), groupId)) continue
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
 * Parks past the outermost mate on that **side’s** tree only (other sides untouched).
 */
export function findFrameEdgeSnap(
  dragged: Node,
  live: Node[],
  armPx = SNAP_ARM_PX,
  excludeHostSides?: Set<string> // `${hostId}:${side}` — e.g. just-left edge after unstack
): SnapCandidate | null {
  if (dragged.type !== 'chatPanel') return null
  const dragMeta = nodeMeta(dragged)
  const dragGroups = new Set(groupIdsOf(dragMeta))

  const dAbs = absFlowPosition(dragged, live)
  const dSize = nodeFlowSize(dragged)
  const dBox: FlowBox = { x: dAbs.x, y: dAbs.y, width: dSize.width, height: dSize.height }

  let best: SnapCandidate | null = null
  let bestScore = Infinity

  for (const host of live) {
    if (host.id === dragged.id || host.type !== 'chatPanel') continue
    if (!host.data?.promptMessage?.id) continue
    if (host.hidden) continue
    const hMeta = nodeMeta(host)

    const hAbs = absFlowPosition(host, live)
    const hSize = nodeFlowSize(host)
    const hBox: FlowBox = { x: hAbs.x, y: hAbs.y, width: hSize.width, height: hSize.height }
    const hostStacks = readSideStacks(hMeta)

    const sides: FrameStackSide[] = ['right', 'left', 'bottom', 'top']
    for (const side of sides) {
      // Just delinked from this host edge — allow other sides / other frames same drag
      if (excludeHostSides?.has(`${host.id}:${side}`)) continue
      // Already in this side’s tree → skip (other sides of the same host still OK)
      const sideGroup = hostStacks[side]?.groupId
      if (sideGroup && dragGroups.has(sideGroup)) continue

      let gap = Infinity
      let overlap = 0
      let parallel = 1

      // Park past the whole stack on this side when the target already has that side tree
      const parkBox = sideGroup
        ? groupExtentOnSide(sideGroup, side, live, hBox)
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
      if (sideGroup && parkBox !== hBox) {
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

/**
 * Repark snap/stack mates when a frame’s upright AABB changes (e.g. rotation).
 * Walks every side-tree `frameId` belongs to, lays mates out from that tree’s
 * anchor against the current (or overridden) host box, then parks nested
 * side-packs of those mates. Returns abs flow positions to apply.
 */
export function computeSnapMateRelayout(
  frameId: string,
  live: Node[],
  frameSizeOverride?: { width: number; height: number }
): Map<string, { x: number; y: number }> {
  const self = live.find((n) => n.id === frameId)
  if (!self || self.type !== 'chatPanel') return new Map()

  const sizeOf = (n: Node): { width: number; height: number } => {
    if (n.id === frameId && frameSizeOverride) return frameSizeOverride
    // Prefer explicit style (AABB push) over RF measured width — measure lags updateNodeInternals
    const sw =
      typeof n.style?.width === 'number' ? n.style.width : parseFloat(String(n.style?.width ?? ''))
    const sh =
      typeof n.style?.height === 'number' ? n.style.height : parseFloat(String(n.style?.height ?? ''))
    if (Number.isFinite(sw) && Number.isFinite(sh) && sw > 0 && sh > 0) {
      return { width: sw, height: sh }
    }
    return nodeFlowSize(n)
  }

  const absPosOf = (
    n: Node,
    pending: Map<string, { x: number; y: number }>
  ): { x: number; y: number } => {
    const pendingPos = pending.get(n.id)
    if (pendingPos) {
      // pending stores node.position — convert to abs if parented
      if (!n.parentId) return pendingPos
      const parent = live.find((p) => p.id === n.parentId)
      if (!parent) return pendingPos
      const pAbs = absFlowPosition(parent, live)
      return { x: pAbs.x + pendingPos.x, y: pAbs.y + pendingPos.y }
    }
    return absFlowPosition(n, live)
  }

  const absById = new Map<string, { x: number; y: number }>() // Absolute flow positions
  const nodePosById = new Map<string, { x: number; y: number }>() // RF node.position
  const visitedGroups = new Set<string>()
  const queue: string[] = [frameId] // BFS: frame → its trees → nested trees of mates

  while (queue.length > 0) {
    const seedId = queue.shift() as string
    const seed = live.find((n) => n.id === seedId)
    if (!seed || seed.type !== 'chatPanel') continue
    const seedMeta = nodeMeta(seed)
    for (const groupId of groupIdsOf(seedMeta)) {
      if (visitedGroups.has(groupId)) continue
      visitedGroups.add(groupId)
      const side = findStackEntry(seedMeta, groupId)?.side
      if (!side) continue

      const members = live
        .filter(
          (n) => n.type === 'chatPanel' && !!findStackEntry(nodeMeta(n), groupId)
        )
        .sort(
          (a, b) =>
            stackIndexInGroup(nodeMeta(a), groupId) -
            stackIndexInGroup(nodeMeta(b), groupId)
        )
      if (members.length < 2) continue

      const anchor = members[0]
      const aAbs = absPosOf(anchor, nodePosById)
      const aSize = sizeOf(anchor)
      const frontBox = {
        x: aAbs.x,
        y: aAbs.y,
        width: aSize.width,
        height: aSize.height,
      }
      // Keep anchor put — only repark higher-index mates (and record abs for nesting)
      absById.set(anchor.id, aAbs)

      const mates = members.slice(1)
      const sizes = mates.map((m) => sizeOf(m))
      mates.forEach((mate, order) => {
        const abs = stackExpandLayout(
          frontBox,
          side,
          sizes[order],
          order,
          sizes.slice(0, order)
        )
        absById.set(mate.id, abs)
        nodePosById.set(mate.id, absToNodePosition(mate, abs, live))
        queue.push(mate.id) // Their other-side packs ride along
      })
    }
  }

  // Don’t move the rotating/resized frame itself — only its mates / nested packs
  nodePosById.delete(frameId)
  return nodePosById
}

/** Apply `computeSnapMateRelayout` into an RF nodes array (same tick as AABB update). */
export function applySnapMateRelayout(
  nodes: Node[],
  frameId: string,
  frameSizeOverride?: { width: number; height: number }
): Node[] {
  const posById = computeSnapMateRelayout(frameId, nodes, frameSizeOverride)
  if (posById.size === 0) return nodes
  let changed = false
  const next = nodes.map((n) => {
    const pos = posById.get(n.id)
    if (!pos) return n
    if (Math.abs(n.position.x - pos.x) < 0.5 && Math.abs(n.position.y - pos.y) < 0.5) {
      return n
    }
    changed = true
    const meta = { ...nodeMeta(n), position: { x: pos.x, y: pos.y } }
    // position in meta is page-absolute for persist helpers
    const abs = absFlowPosition({ ...n, position: pos }, nodes)
    meta.position = abs
    return {
      ...n,
      position: pos,
      data: {
        ...n.data,
        promptMessage: n.data?.promptMessage
          ? { ...n.data.promptMessage, metadata: meta }
          : n.data?.promptMessage,
      },
    }
  })
  return changed ? next : nodes
}

/** Persist abs positions for mates moved by rotation/AABB (fire-and-forget). */
export async function persistSnapMateRelayout(
  live: Node[],
  frameId: string,
  frameSizeOverride?: { width: number; height: number }
): Promise<void> {
  const posById = computeSnapMateRelayout(frameId, live, frameSizeOverride)
  if (posById.size === 0) return
  const supabase = createClient()
  for (const [id, pos] of posById) {
    const n = live.find((x) => x.id === id)
    const msgId = n?.data?.promptMessage?.id as string | undefined
    if (!msgId) continue
    const abs = absFlowPosition({ ...n!, position: pos }, live)
    try {
      await persistBlockPlacement(supabase, { messageId: msgId, position: abs })
    } catch (err) {
      console.error('Failed to persist snap mate after rotate:', err)
    }
  }
}

/** True when stack line Lock is on for any tree this frame is in. */
// isSnapLockedMeta re-exported from lib/frame-side-stacks

/** Remove one side-tree membership (used when a multi-side frame only leaves one group). */
function stripOneGroup(meta: Record<string, unknown>, groupId: string): Record<string, unknown> {
  return stripGroupFromMeta(meta, groupId)
}

// nodeMeta defined above with FlowBox

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
  // After unstack, block only the edges we left (`hostId:side`) — other sides/frames OK same drag
  const excludeSnapSidesRef = useRef<Set<string>>(new Set())

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
      excludeSnapSidesRef.current = new Set()
      dragStartPosRef.current = { id: node.id, x: node.position.x, y: node.position.y }
      // Prefer live store meta (menu Unlock may have just cleared locks)
      const live = getNodes()
      const liveNode = live.find((n) => n.id === node.id) || node
      const meta = nodeMeta(liveNode)
      if (!isSnapLockedMeta(meta)) return
      // Rigid-move union of every tree this frame is in, plus nested side-tree satellites
      const myGroups = new Set(groupIdsOf(meta))
      const lockId = [...myGroups].find((g) => isGroupLocked(meta, g)) || [...myGroups][0]
      if (!lockId) return
      const seedIds: string[] = []
      for (const n of live) {
        if (n.type !== 'chatPanel') continue
        const ids = groupIdsOf(nodeMeta(n))
        if (!ids.some((g) => myGroups.has(g))) continue
        seedIds.push(n.id)
      }
      const nested = collectNestedSatelliteIds(live, seedIds, [])
      const moveIds = new Set([...seedIds, ...nested])
      const origins = new Map<string, { x: number; y: number }>()
      for (const n of live) {
        if (!moveIds.has(n.id)) continue
        origins.set(n.id, { x: n.position.x, y: n.position.y })
      }
      lockDragRef.current = { primaryId: node.id, lockId, origins }
    },
    [getNodes]
  )

  /**
   * Remove `node` from all unlocked side trees (unlocked drag-apart).
   * If ≤1 frame would remain in a group, clear that whole group.
   */
  const unstackNode = useCallback(
    (node: Node) => {
      const live = getNodes()
      const liveNode = live.find((n) => n.id === node.id) || node
      const meta = nodeMeta(liveNode)
      const groups = groupIdsOf(meta)
      if (groups.length === 0 || isSnapLockedMeta(meta)) return
      takeSnapshot?.()

      // Block only the edges we just left — other sides of the same frame (and other frames) stay armable
      for (const groupId of groups) {
        const found = findStackEntry(meta, groupId)
        if (!found) continue
        for (const n of live) {
          if (n.id === liveNode.id || n.type !== 'chatPanel') continue
          if (!findStackEntry(nodeMeta(n), groupId)) continue
          excludeSnapSidesRef.current.add(`${n.id}:${found.side}`)
        }
      }
      snapRef.current = null
      clearUi()

      // Per group: strip this node; clear whole group if ≤1 left; promote anchor if needed
      type Promote = { id: string; groupId: string; side: FrameStackSide }
      const promoteList: Promote[] = []
      const clearEntire = new Map<string, Set<string>>() // groupId → node ids to fully strip
      const stripOnly = new Set<string>([liveNode.id]) // always strip dragged from all its groups

      for (const groupId of groups) {
        const members = live.filter(
          (n) => n.type === 'chatPanel' && findStackEntry(nodeMeta(n), groupId)
        )
        const remaining = members.filter((n) => n.id !== liveNode.id)
        if (remaining.length <= 1) {
          const ids = clearEntire.get(groupId) || new Set<string>()
          remaining.forEach((n) => ids.add(n.id))
          ids.add(liveNode.id)
          clearEntire.set(groupId, ids)
          continue
        }
        const found = findStackEntry(meta, groupId)
        if (found && (found.entry.anchor === true || found.entry.index === 0)) {
          const promote = [...remaining].sort(
            (a, b) =>
              stackIndexInGroup(nodeMeta(a), groupId) - stackIndexInGroup(nodeMeta(b), groupId)
          )[0]
          if (promote) {
            const pSide =
              findStackEntry(nodeMeta(promote), groupId)?.side || found.side
            promoteList.push({ id: promote.id, groupId, side: pSide })
          }
        }
      }

      setNodes((nds) =>
        nds.map((n) => {
          let nextMeta = { ...nodeMeta(n) }
          let changed = false

          for (const [groupId, ids] of clearEntire) {
            if (!ids.has(n.id)) continue
            nextMeta = stripOneGroup(nextMeta, groupId)
            changed = true
          }
          if (stripOnly.has(n.id)) {
            for (const groupId of groups) {
              if (clearEntire.has(groupId) && clearEntire.get(groupId)!.has(n.id)) continue
              if (findStackEntry(nextMeta, groupId)) {
                nextMeta = stripOneGroup(nextMeta, groupId)
                changed = true
              }
            }
          }
          for (const p of promoteList) {
            if (n.id !== p.id) continue
            nextMeta = setSideStackEntry(nextMeta, p.side, {
              groupId: p.groupId,
              index: 0,
              anchor: true,
              expanded: true,
            })
            changed = true
          }
          if (!changed) return n
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
        })
      )

      void (async () => {
        try {
          const touched = new Set<string>()
          for (const ids of clearEntire.values()) ids.forEach((id) => touched.add(id))
          stripOnly.forEach((id) => touched.add(id))
          promoteList.forEach((p) => touched.add(p.id))
          for (const id of touched) {
            const n = live.find((x) => x.id === id)
            const msgId = n?.data?.promptMessage?.id as string | undefined
            if (!msgId) continue
            // Re-read from the RF update path: persist by recomputing from live logic
            const supabase = createClient()
            const { data: row } = await supabase
              .from('messages')
              .select('metadata')
              .eq('id', msgId)
              .maybeSingle()
            if (!row) continue
            let nextMeta = (row.metadata as Record<string, unknown>) || {}
            for (const [groupId, ids] of clearEntire) {
              if (ids.has(id)) nextMeta = stripOneGroup(nextMeta, groupId)
            }
            if (stripOnly.has(id)) {
              for (const groupId of groups) {
                if (clearEntire.has(groupId) && clearEntire.get(groupId)!.has(id)) continue
                if (findStackEntry(nextMeta, groupId)) nextMeta = stripOneGroup(nextMeta, groupId)
              }
            }
            for (const p of promoteList) {
              if (p.id !== id) continue
              nextMeta = setSideStackEntry(nextMeta, p.side, {
                groupId: p.groupId,
                index: 0,
                anchor: true,
                expanded: true,
              })
            }
            await supabase.from('messages').update({ metadata: nextMeta }).eq('id', msgId)
          }
        } catch (err) {
          console.error('Failed to persist unstack:', err)
        }
      })()
    },
    [clearUi, getNodes, setNodes, takeSnapshot]
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

      // Locked: move every frame sharing any tree with the primary (origins captured at start)
      if (isSnapLockedMeta(meta) && lockDragRef.current?.primaryId === node.id) {
        const { origins } = lockDragRef.current
        const origin = origins.get(node.id)
        if (origin) {
          const dx = node.position.x - origin.x
          const dy = node.position.y - origin.y
          setNodes((nds) =>
            nds.map((n) => {
              if (n.id === node.id) return n // Primary already at RF position
              const o = origins.get(n.id)
              if (!o) return n
              return { ...n, position: { x: o.x + dx, y: o.y + dy } }
            })
          )
        }
        // Locked stacks don't edge-snap mid-drag (would break the rigid group)
        if (dropUiRef.current) clearUi()
        return
      }

      // Unlocked but stacked on any side: drag apart → delink from those trees
      if (
        groupIdsOf(meta).length > 0 &&
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
          // Fall through: same gesture can arm a new side/frame snap on later ticks
          return // Skip snap this tick while RF applies the delink
        }
      }

      // After unstack: arm any edge except the ones we just left (other side / other frame OK).
      // Strip stale stack membership on the drag candidate until RF setNodes from unstack flushes —
      // otherwise dragGroups.has(sideGroup) can still skip the host edge we are free to rejoin
      // under a fresh group / other side.
      const snapDrag =
        unstackedThisDragRef.current
          ? (() => {
              const m = { ...nodeMeta(dragNode) }
              delete m.sideStacks
              delete m.stackGroupId
              delete m.stackSide
              delete m.stackIndex
              delete m.stackAnchor
              delete m.stackExpanded
              delete m.parentStackHidden
              return {
                ...dragNode,
                data: {
                  ...dragNode.data,
                  promptMessage: dragNode.data?.promptMessage
                    ? { ...dragNode.data.promptMessage, metadata: m }
                    : dragNode.data?.promptMessage,
                },
              }
            })()
          : dragNode
      const snap = findFrameEdgeSnap(
        snapDrag,
        live,
        SNAP_ARM_PX,
        unstackedThisDragRef.current ? excludeSnapSidesRef.current : undefined
      )
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
      const excludeSides = excludeSnapSidesRef.current
      clearUi()
      lockDragRef.current = null
      dragStartPosRef.current = null
      unstackedThisDragRef.current = false
      excludeSnapSidesRef.current = new Set()

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
            if (!lockSession.origins.has(n.id)) continue
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

      // Unlocked drag-away delinked — still link if they snapped a *different* side/frame
      if (didUnstack) {
        if (!snap || excludeSides.has(`${snap.targetId}:${snap.side}`)) return
      }

      if (isLocked || !conversationId || node.type !== 'chatPanel' || !snap) return
      if (snap.targetId === node.id) return
      if (excludeSides.has(`${snap.targetId}:${snap.side}`)) return
      if (snap.gap > SNAP_ARM_PX) return

      const sourceMsgId = node.data?.promptMessage?.id as string | undefined
      const live = getNodes()
      const front = live.find((n) => n.id === snap.targetId)
      const targetMsgId = front?.data?.promptMessage?.id as string | undefined
      if (!sourceMsgId || !targetMsgId || !front) return

      const dragMeta = nodeMeta(live.find((n) => n.id === node.id) || node)
      const frontMeta = nodeMeta(front)
      const frontStacks = readSideStacks(frontMeta)
      // Join / create the tree on the snapped adjust-box side only
      const existingGroup = frontStacks[snap.side]?.groupId ?? null
      if (existingGroup && groupIdsOf(dragMeta).includes(existingGroup)) {
        return
      }

      const groupSide = snap.side
      const stackGroupId =
        existingGroup || sideStackGroupId(targetMsgId, groupSide)
      const existingMates = live.filter((n) => {
        if (n.id === node.id) return false
        return !!findStackEntry(nodeMeta(n), stackGroupId)
      })
      const nextIndex = existingGroup
        ? existingMates.reduce((max, n) => {
            const i = stackIndexInGroup(nodeMeta(n), stackGroupId)
            return i > max ? i : max
          }, 0) + 1
        : 1

      // Drag-time snap already parks past the stack extent — only the new frame moves
      const parkAbs = snap.snappedAbs
      const snappedNodePos = absToNodePosition(node, parkAbs, live)

      takeSnapshot?.()

      const mateEntry: SideStackEntry = {
        groupId: stackGroupId,
        index: nextIndex,
        expanded: true,
      }
      const hostEntry: SideStackEntry = {
        groupId: stackGroupId,
        index: 0,
        anchor: true,
      }

      // Join existing side tree: only move the new frame. New tree: target becomes side host.
      // Snap does NOT lock — Lock happens on first Stack / Lock on that side’s line.
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === node.id) {
            const nextMeta = setSideStackEntry(nodeMeta(n), groupSide, mateEntry)
            nextMeta.position = parkAbs
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
          if (!existingGroup && n.id === snap.targetId) {
            const nextMeta = setSideStackEntry(nodeMeta(n), groupSide, hostEntry)
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
          const mateMeta = setSideStackEntry(
            (mateRow.metadata as Record<string, unknown>) || {},
            groupSide,
            mateEntry
          )
          mateMeta.position = parkAbs
          await supabase.from('messages').update({ metadata: mateMeta }).eq('id', sourceMsgId)
        }
        if (!existingGroup) {
          const { data: hostRow } = await supabase
            .from('messages')
            .select('metadata')
            .eq('id', targetMsgId)
            .maybeSingle()
          if (hostRow) {
            const hostMeta = setSideStackEntry(
              (hostRow.metadata as Record<string, unknown>) || {},
              groupSide,
              hostEntry
            )
            await supabase.from('messages').update({ metadata: hostMeta }).eq('id', targetMsgId)
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
