'use client'

// Stack line between snap-linked frames on one adjust-box side (one line per gap).
// Each side (top/right/bottom/left) has its own stack tree.
// • Visible when either frame on that gap is selected; always visible while mates are stacked
// • Click → Open stack / directional Stack arrows / Lock
// • First Stack sets lock for that group (snap alone does not lock)
// • Hover when any mate is stacked → fast faded preview; click one to open just that frame

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useReactFlow, useStore } from 'reactflow'
import { Eye, Lock, ArrowLeft, ArrowRight, ArrowUp, ArrowDown } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  stackExpandLayout,
  STACK_LINE_GAP,
  frameScreenRect,
  type FrameStackSide,
} from '@/components/use-frame-nest-stack-drag'
import {
  collectNestedSatelliteIds,
  findOwningMateId,
  findStackEntry,
  isGroupLocked,
  patchGroupEntry,
  readSideStacks,
  rekeyGroupSide,
  setGroupLocked,
  setParentStackHidden,
  stackIndexInGroup,
  FRAME_STACK_SIDES,
} from '@/lib/frame-side-stacks'
import { absFlowPosition, nodeFlowSize } from '@/components/use-block-group-drag'
import { persistBlockPlacement } from '@/lib/blocks'
import { cn } from '@/lib/utils'

const HOVER_DWELL_MS = 100 // Fast preview on stack-line hover
/** Mate count above this uses a dotted line (dash-count encoding stops). */
const STACK_LINE_DASH_CAP = 5
const STACK_LINE_COLOR = '#3b82f6'
const LINE_THICKNESS = 2 // Stroke width in CSS px (pill radius matches)

type FrameStackRevealLineProps = {
  nodeId: string // Frame this line sits on (inward side of the gap)
  stackGroupId: string
  stackSide: FrameStackSide // Direction toward the next mate (adjust-box side)
  frameUiScale?: number
}

function oppositeSide(side: FrameStackSide): FrameStackSide {
  if (side === 'right') return 'left'
  if (side === 'left') return 'right'
  if (side === 'top') return 'bottom'
  return 'top'
}

/** Screen-fixed box for a portaled stack line (so a selected mate cannot cover the host’s line). */
function stackLineScreenBox(
  stackSide: FrameStackSide,
  rect: DOMRect,
  zoom: number,
  frameUiScale: number
): CSSProperties {
  const lineOutset = Math.max(4, STACK_LINE_GAP / 2) * zoom // Mid-gap in screen px
  const hitPad = Math.max(STACK_LINE_GAP, 10 * frameUiScale) * zoom // Grab band
  const inset = 0.08 // Same 8% inset as the in-node line
  const span = 0.84
  if (stackSide === 'top') {
    return {
      position: 'fixed',
      left: rect.left + rect.width * inset,
      width: rect.width * span,
      top: rect.top - lineOutset - hitPad / 2,
      height: hitPad,
      paddingTop: hitPad / 2 - 1,
      zIndex: 40,
    }
  }
  if (stackSide === 'bottom') {
    return {
      position: 'fixed',
      left: rect.left + rect.width * inset,
      width: rect.width * span,
      top: rect.bottom + lineOutset - hitPad / 2,
      height: hitPad,
      paddingTop: hitPad / 2 - 1,
      zIndex: 40,
    }
  }
  if (stackSide === 'left') {
    return {
      position: 'fixed',
      top: rect.top + rect.height * inset,
      height: rect.height * span,
      left: rect.left - lineOutset - hitPad / 2,
      width: hitPad,
      paddingLeft: hitPad / 2 - 1,
      zIndex: 40,
    }
  }
  return {
    position: 'fixed',
    top: rect.top + rect.height * inset,
    height: rect.height * span,
    left: rect.right + lineOutset - hitPad / 2,
    width: hitPad,
    paddingLeft: hitPad / 2 - 1,
    zIndex: 40,
  }
}

function stackIndexOf(n: { data?: unknown }, groupId: string): number {
  const data = n.data as { promptMessage?: { metadata?: unknown } } | undefined
  return stackIndexInGroup(
    (data?.promptMessage?.metadata || {}) as Record<string, unknown>,
    groupId
  )
}

function nodeStackMeta(n: { data?: unknown }): Record<string, unknown> {
  const data = n.data as { promptMessage?: { metadata?: unknown } } | undefined
  return (data?.promptMessage?.metadata || {}) as Record<string, unknown>
}

function nodeMessageId(n: { data?: unknown }): string | undefined {
  const data = n.data as { promptMessage?: { id?: string } } | undefined
  return typeof data?.promptMessage?.id === 'string' ? data.promptMessage.id : undefined
}

function entryExpanded(
  meta: Record<string, unknown>,
  groupId: string
): boolean {
  return findStackEntry(meta, groupId)?.entry.expanded === true
}

/** How many rounded marks to paint for this mate count (1 solid / N dashes / many dots). */
function stackMarkCount(mateCount: number): number {
  if (mateCount <= 1) return 1 // Solid = one full pill
  if (mateCount > STACK_LINE_DASH_CAP) return 24 // Dense dotted run
  return mateCount // One rounded dash per mate
}

/** Mate nodes in this side’s stack group (excludes host), sorted by stackIndex. */
function collectMates(
  getNodes: () => ReturnType<ReturnType<typeof useReactFlow>['getNodes']>,
  nodeId: string,
  stackGroupId: string
) {
  return getNodes()
    .filter((n) => {
      if (n.id === nodeId || n.type !== 'chatPanel') return false
      return !!findStackEntry(nodeStackMeta(n), stackGroupId)
    })
    .sort((a, b) => stackIndexOf(a, stackGroupId) - stackIndexOf(b, stackGroupId))
}

/** All frames in this side’s group (including host). */
function collectGroup(
  getNodes: () => ReturnType<ReturnType<typeof useReactFlow>['getNodes']>,
  stackGroupId: string
) {
  return getNodes().filter((n) => {
    if (n.type !== 'chatPanel') return false
    return !!findStackEntry(nodeStackMeta(n), stackGroupId)
  })
}

/**
 * Park nested side-tree satellites relative to already-placed mates.
 * Skips the parent `excludeGroupId` so A’s bottom pack lays out from A, not from B.
 */
function layoutNestedFromMates(
  live: ReturnType<ReturnType<typeof useReactFlow>['getNodes']>,
  placedPos: Map<string, { x: number; y: number }>,
  excludeGroupId: string
): Map<string, { x: number; y: number }> {
  const nestedPos = new Map<string, { x: number; y: number }>()
  const sizeOf = (id: string) => {
    const n = live.find((x) => x.id === id)
    return n ? nodeFlowSize(n) : { width: 280, height: 120 }
  }
  const queue = [...placedPos.keys()]
  const visitedGroups = new Set<string>([excludeGroupId])
  while (queue.length > 0) {
    const pid = queue.shift() as string
    const pPos = placedPos.get(pid) || nestedPos.get(pid)
    if (!pPos) continue
    const pNode = live.find((n) => n.id === pid)
    if (!pNode) continue
    const pSize = sizeOf(pid)
    const pBox = { x: pPos.x, y: pPos.y, width: pSize.width, height: pSize.height }
    const stacks = readSideStacks(nodeStackMeta(pNode))
    for (const side of FRAME_STACK_SIDES) {
      const entry = stacks[side]
      if (!entry || visitedGroups.has(entry.groupId)) continue
      // Only hosts of this side tree fan mates outward
      if (!(entry.index === 0 || entry.anchor === true)) continue
      visitedGroups.add(entry.groupId)
      const mates = live
        .filter((n) => {
          if (n.id === pid || n.type !== 'chatPanel') return false
          return !!findStackEntry(nodeStackMeta(n), entry.groupId)
        })
        .sort(
          (a, b) =>
            stackIndexInGroup(nodeStackMeta(a), entry.groupId) -
            stackIndexInGroup(nodeStackMeta(b), entry.groupId)
        )
      const sizes = mates.map((n) => sizeOf(n.id))
      mates.forEach((mate, order) => {
        const pos = stackExpandLayout(pBox, side, sizes[order], order, sizes.slice(0, order))
        nestedPos.set(mate.id, pos)
        placedPos.set(mate.id, pos) // Allow deeper nesting from this mate
        queue.push(mate.id)
      })
    }
  }
  return nestedPos
}

function clearPreviewStyle(n: { style?: Record<string, unknown>; className?: string }) {
  const { opacity: _o, ...restStyle } = (n.style || {}) as Record<string, unknown>
  const className = (n.className || '')
    .split(/\s+/)
    .filter((c) => c && c !== 'tt-stack-preview')
    .join(' ')
  return { restStyle, className: className || undefined }
}

/** Edge line on the stack side of the host frame; stroke encodes mate count. */
export function FrameStackRevealLine({
  nodeId,
  stackGroupId,
  stackSide,
  frameUiScale = 1,
}: FrameStackRevealLineProps) {
  const { getNodes, setNodes } = useReactFlow()
  // Re-render when stack mate expand/hidden/lock changes (RF v11: nodeInternals)
  const mateStateKey = useStore((s) => {
    const parts: string[] = []
    s.nodeInternals.forEach((n) => {
      if (n.type !== 'chatPanel') return
      const m = nodeStackMeta(n)
      if (n.id !== nodeId && !findStackEntry(m, stackGroupId)) return
      if (n.id === nodeId && !findStackEntry(m, stackGroupId)) return
      const lock = isGroupLocked(m, stackGroupId) ? 1 : 0
      const expanded = entryExpanded(m, stackGroupId) ? 1 : 0
      parts.push(`${n.id}:${expanded}:${n.hidden ? 1 : 0}:${lock}:${n.selected ? 1 : 0}`)
    })
    return parts.join('|')
  })
  const viewportKey = useStore((s) => s.transform.join(',')) // Re-place the portaled line on pan/zoom
  const [previewing, setPreviewing] = useState(false) // Hover-dwell preview active
  const [menuOpen, setMenuOpen] = useState(false) // Eye / Stack / Lock menu
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 }) // Screen coords for portal menu
  const dwellRef = useRef<number | null>(null)
  const endPreviewRef = useRef<number | null>(null) // Delayed dismiss so pointer can cross gap → mate
  const previewingRef = useRef(false)
  previewingRef.current = previewing
  const lineBtnRef = useRef<HTMLButtonElement>(null)
  const mateIdsRef = useRef<Set<string>>(new Set()) // Live mate ids for preview-zone hit tests
  // Snapshot before hover preview so cancel can restore (e.g. one open, rest stacked)
  const prePreviewRef = useRef<
    { id: string; expanded: boolean; hidden: boolean }[] | null
  >(null)

  const clearDwell = useCallback(() => {
    if (dwellRef.current != null) {
      window.clearTimeout(dwellRef.current)
      dwellRef.current = null
    }
  }, [])

  const clearEndPreview = useCallback(() => {
    if (endPreviewRef.current != null) {
      window.clearTimeout(endPreviewRef.current)
      endPreviewRef.current = null
    }
  }, [])

  useEffect(
    () => () => {
      clearDwell()
      clearEndPreview()
    },
    [clearDwell, clearEndPreview]
  )

  /** Place mates at expand layout (visible). `expanded` = full open vs faded preview.
   *  Nested side-tree satellites (e.g. C on A’s bottom) park with their owning mate.
   *  `onlyId` → that mate alone (+ its nested), always parked flush next to the host. */
  const showMatesOut = useCallback(
    (expanded: boolean, onlyId?: string | null) => {
      const live = getNodes()
      const host = live.find((n) => n.id === nodeId)
      if (!host) return
      const frontAbs = absFlowPosition(host, live)
      const frontSize = nodeFlowSize(host)
      const frontBox = {
        x: frontAbs.x,
        y: frontAbs.y,
        width: frontSize.width,
        height: frontSize.height,
      }
      const sortedMates = collectMates(getNodes, nodeId, stackGroupId)
      // Layout order: single open → just that mate at host edge;
      // preview/show-all → already-open mates stay closest, then stacked ones further out
      let layoutMates = sortedMates
      if (onlyId) {
        layoutMates = sortedMates.filter((n) => n.id === onlyId)
      } else if (!expanded) {
        const openFirst: typeof sortedMates = []
        const rest: typeof sortedMates = []
        for (const n of sortedMates) {
          const m = nodeStackMeta(n)
          if (!n.hidden && entryExpanded(m, stackGroupId)) openFirst.push(n)
          else rest.push(n)
        }
        layoutMates = [...openFirst, ...rest]
      }
      const sizes = layoutMates.map((n) => nodeFlowSize(n))
      const posById = new Map<string, { x: number; y: number }>()
      layoutMates.forEach((n, order) => {
        posById.set(
          n.id,
          stackExpandLayout(frontBox, stackSide, sizes[order], order, sizes.slice(0, order))
        )
      })
      // Nested satellites of the mates we’re showing (A’s bottom C, etc.)
      const showMateIds = layoutMates.map((n) => n.id)
      const nestedIds = collectNestedSatelliteIds(live, showMateIds, [stackGroupId])
      const nestedPos = layoutNestedFromMates(live, new Map(posById), stackGroupId)
      for (const [id, pos] of nestedPos) {
        if (nestedIds.includes(id)) posById.set(id, pos)
      }
      // Hide other direct mates (+ their nested) when opening a single mate
      const hideMateIds = onlyId
        ? sortedMates.filter((n) => n.id !== onlyId).map((n) => n.id)
        : []
      const hideNestedIds = onlyId
        ? collectNestedSatelliteIds(live, hideMateIds, [stackGroupId])
        : []
      // Promote opened mate to front of stack (index 1); renumber the rest 2..n
      const indexById = new Map<string, number>()
      if (onlyId && expanded) {
        indexById.set(onlyId, 1)
        let next = 2
        for (const m of sortedMates) {
          if (m.id === onlyId) continue
          indexById.set(m.id, next++)
        }
      }
      const showSet = new Set([...showMateIds, ...nestedIds])
      const hideSet = new Set([...hideMateIds, ...hideNestedIds])
      setNodes((nds) =>
        nds.map((n) => {
          if (hideSet.has(n.id)) {
            const m = nodeStackMeta(n)
            let meta = findStackEntry(m, stackGroupId)
              ? patchGroupEntry(m, stackGroupId, { expanded: false })
              : m
            const idx = indexById.get(n.id)
            if (typeof idx === 'number' && findStackEntry(meta, stackGroupId)) {
              meta = patchGroupEntry(meta, stackGroupId, { index: idx })
            }
            // Nested under the still-collapsed parent group until a full open clears it
            meta = setParentStackHidden(meta, stackGroupId)
            const { restStyle, className } = clearPreviewStyle(
              n as { style?: Record<string, unknown>; className?: string }
            )
            return {
              ...n,
              hidden: true,
              style: restStyle,
              className,
              data: {
                ...n.data,
                promptMessage: n.data?.promptMessage
                  ? { ...n.data.promptMessage, metadata: meta }
                  : n.data?.promptMessage,
              },
            }
          }
          const pos = posById.get(n.id)
          if (!pos || !showSet.has(n.id)) return n
          const m = nodeStackMeta(n)
          let meta = findStackEntry(m, stackGroupId)
            ? patchGroupEntry(m, stackGroupId, { expanded })
            : m
          // Clear nested-hide marker while preview/open shows this satellite
          meta = setParentStackHidden(meta, null)
          meta = { ...meta, position: pos }
          const idx = indexById.get(n.id)
          if (typeof idx === 'number' && findStackEntry(meta, stackGroupId)) {
            meta = patchGroupEntry(meta, stackGroupId, { index: idx })
          }
          return {
            ...n,
            position: pos,
            hidden: false,
            zIndex: expanded ? 3 : 2,
            style: {
              ...(n.style || {}),
              opacity: expanded ? 1 : 0.72,
              pointerEvents: 'all',
            },
            className: cn(
              (n.className || '')
                .split(/\s+/)
                .filter((c) => c && c !== 'tt-stack-preview')
                .join(' '),
              !expanded && 'tt-stack-preview'
            ),
            data: {
              ...n.data,
              promptMessage: n.data?.promptMessage
                ? { ...n.data.promptMessage, metadata: meta }
                : n.data?.promptMessage,
            },
          }
        })
      )
    },
    [getNodes, nodeId, setNodes, stackGroupId, stackSide]
  )

  /** Stack under `keeperId` — that frame stays visible; others (+ nested side packs) hide. Locks this side’s group. */
  const actionStackUnder = useCallback(
    async (keeperId: string) => {
      setMenuOpen(false)
      setPreviewing(false)
      const live = getNodes()
      const group = collectGroup(getNodes, stackGroupId)
      if (group.length === 0) return
      // Side points from keeper toward where the hidden pack sits
      const newSide = keeperId === nodeId ? stackSide : oppositeSide(stackSide)
      // Renumber: keeper = 0; others keep relative order among themselves
      const others = group
        .filter((n) => n.id !== keeperId)
        .sort((a, b) => stackIndexOf(a, stackGroupId) - stackIndexOf(b, stackGroupId))
      const indexById = new Map<string, number>()
      indexById.set(keeperId, 0)
      others.forEach((n, i) => indexById.set(n.id, i + 1))

      // Nested satellites of frames going under the keeper (hide with their owners)
      const hideNestedIds = collectNestedSatelliteIds(
        live,
        others.map((n) => n.id),
        [stackGroupId]
      )
      // Keeper’s own nested packs stay visible — clear any stale parentStackHidden
      const keeperNestedIds = collectNestedSatelliteIds(live, [keeperId], [stackGroupId])
      const hideSet = new Set([...others.map((n) => n.id), ...hideNestedIds])
      const groupIdSet = new Set(group.map((n) => n.id))

      setNodes((nds) =>
        nds.map((n) => {
          const m = nodeStackMeta(n)
          const inGroup = findStackEntry(m, stackGroupId) || n.id === keeperId
          if (!inGroup && !hideSet.has(n.id) && !keeperNestedIds.includes(n.id)) return n

          if (hideSet.has(n.id)) {
            let meta = m
            if (findStackEntry(m, stackGroupId)) {
              const entry = {
                groupId: stackGroupId,
                index: indexById.get(n.id) ?? 99,
                expanded: false,
              }
              meta = rekeyGroupSide(m, stackGroupId, newSide, entry)
              meta = setGroupLocked(meta, stackGroupId, true)
            }
            meta = setParentStackHidden(meta, stackGroupId)
            const { restStyle, className } = clearPreviewStyle(
              n as { style?: Record<string, unknown>; className?: string }
            )
            return {
              ...n,
              hidden: true,
              style: restStyle,
              className,
              data: {
                ...n.data,
                promptMessage: n.data?.promptMessage
                  ? { ...n.data.promptMessage, metadata: meta }
                  : n.data?.promptMessage,
              },
            }
          }

          // Keeper or keeper’s nested satellites — visible
          let meta = m
          if (groupIdSet.has(n.id) || n.id === keeperId) {
            const isKeeper = n.id === keeperId
            const entry = {
              groupId: stackGroupId,
              index: indexById.get(n.id) ?? 99,
              expanded: isKeeper,
              ...(isKeeper ? { anchor: true as const } : {}),
            }
            meta = rekeyGroupSide(m, stackGroupId, newSide, entry)
            meta = setGroupLocked(meta, stackGroupId, true)
          }
          meta = setParentStackHidden(meta, null)
          const { restStyle, className } = clearPreviewStyle(
            n as { style?: Record<string, unknown>; className?: string }
          )
          return {
            ...n,
            hidden: false,
            style: restStyle,
            className,
            data: {
              ...n.data,
              promptMessage: n.data?.promptMessage
                ? { ...n.data.promptMessage, metadata: meta }
                : n.data?.promptMessage,
            },
          }
        })
      )

      try {
        const supabase = createClient()
        const persistIds = new Set([
          ...group.map((n) => n.id),
          ...hideNestedIds,
          ...keeperNestedIds,
        ])
        for (const id of persistIds) {
          const n = live.find((x) => x.id === id)
          if (!n) continue
          const msgId = nodeMessageId(n)
          if (!msgId) continue
          const { data: row } = await supabase
            .from('messages')
            .select('metadata')
            .eq('id', msgId)
            .maybeSingle()
          if (!row) continue
          let meta = (row.metadata as Record<string, unknown>) || {}
          if (hideSet.has(id)) {
            if (findStackEntry(meta, stackGroupId)) {
              const entry = {
                groupId: stackGroupId,
                index: indexById.get(id) ?? 99,
                expanded: false,
              }
              meta = rekeyGroupSide(meta, stackGroupId, newSide, entry)
              meta = setGroupLocked(meta, stackGroupId, true)
            }
            meta = setParentStackHidden(meta, stackGroupId)
          } else {
            if (groupIdSet.has(id) || id === keeperId) {
              const isKeeper = id === keeperId
              const entry = {
                groupId: stackGroupId,
                index: indexById.get(id) ?? 99,
                expanded: isKeeper,
                ...(isKeeper ? { anchor: true as const } : {}),
              }
              meta = rekeyGroupSide(meta, stackGroupId, newSide, entry)
              meta = setGroupLocked(meta, stackGroupId, true)
            }
            meta = setParentStackHidden(meta, null)
          }
          await supabase.from('messages').update({ metadata: meta }).eq('id', msgId)
        }
      } catch (err) {
        console.error('Failed to stack frames:', err)
      }
    },
    [getNodes, nodeId, setNodes, stackGroupId, stackSide]
  )

  /** Hide all mates (+ nested satellites) — keep current host. */
  const hideMates = useCallback(() => {
    const live = getNodes()
    const mates = collectMates(getNodes, nodeId, stackGroupId)
    const nestedIds = collectNestedSatelliteIds(
      live,
      mates.map((n) => n.id),
      [stackGroupId]
    )
    const hideSet = new Set([...mates.map((n) => n.id), ...nestedIds])
    setNodes((nds) =>
      nds.map((n) => {
        if (!hideSet.has(n.id)) return n
        const m = nodeStackMeta(n)
        let meta = findStackEntry(m, stackGroupId)
          ? patchGroupEntry(m, stackGroupId, { expanded: false })
          : m
        meta = setParentStackHidden(meta, stackGroupId)
        const { restStyle, className } = clearPreviewStyle(
          n as { style?: Record<string, unknown>; className?: string }
        )
        return {
          ...n,
          hidden: true,
          style: restStyle,
          className,
          data: {
            ...n.data,
            promptMessage: n.data?.promptMessage
              ? { ...n.data.promptMessage, metadata: meta }
              : n.data?.promptMessage,
          },
        }
      })
    )
  }, [getNodes, nodeId, setNodes, stackGroupId])

  /** End hover preview — restore pre-preview open/stacked layout (not always hide-all). */
  const endPreview = useCallback(() => {
    const snap = prePreviewRef.current
    prePreviewRef.current = null
    setPreviewing(false)
    if (!snap || snap.length === 0) {
      hideMates()
      return
    }
    const byId = new Map(snap.map((s) => [s.id, s]))
    setNodes((nds) =>
      nds.map((n) => {
        const prev = byId.get(n.id)
        if (!prev) return n
        const m = nodeStackMeta(n)
        let meta = findStackEntry(m, stackGroupId)
          ? patchGroupEntry(m, stackGroupId, { expanded: prev.expanded })
          : m
        // Nested satellites: restore hidden via parentStackHidden when they were stacked
        if (prev.hidden && !findStackEntry(m, stackGroupId)) {
          meta = setParentStackHidden(meta, stackGroupId)
        } else if (!prev.hidden) {
          meta = setParentStackHidden(meta, null)
        }
        const { restStyle, className } = clearPreviewStyle(
          n as { style?: Record<string, unknown>; className?: string }
        )
        return {
          ...n,
          hidden: prev.hidden,
          style: prev.expanded ? { ...restStyle, opacity: 1 } : restStyle,
          className,
          zIndex: prev.expanded ? 3 : n.zIndex,
          data: {
            ...n.data,
            promptMessage: n.data?.promptMessage
              ? { ...n.data.promptMessage, metadata: meta }
              : n.data?.promptMessage,
          },
        }
      })
    )
  }, [hideMates, setNodes, stackGroupId])

  const persistMatePatch = useCallback(
    async (
      patchForMate: (
        order: number,
        pos: { x: number; y: number },
        meta: Record<string, unknown>
      ) => Record<string, unknown>
    ) => {
      const live = getNodes()
      const host = live.find((n) => n.id === nodeId)
      if (!host) return
      const frontAbs = absFlowPosition(host, live)
      const frontSize = nodeFlowSize(host)
      const sortedMates = collectMates(getNodes, nodeId, stackGroupId)
      const sizes = sortedMates.map((n) => nodeFlowSize(n))
      const posById = new Map<string, { x: number; y: number }>()
      sortedMates.forEach((n, order) => {
        posById.set(
          n.id,
          stackExpandLayout(
            {
              x: frontAbs.x,
              y: frontAbs.y,
              width: frontSize.width,
              height: frontSize.height,
            },
            stackSide,
            sizes[order],
            order,
            sizes.slice(0, order)
          )
        )
      })
      const nestedIds = collectNestedSatelliteIds(
        live,
        sortedMates.map((n) => n.id),
        [stackGroupId]
      )
      const nestedPos = layoutNestedFromMates(live, new Map(posById), stackGroupId)
      for (const [id, pos] of nestedPos) {
        if (nestedIds.includes(id)) posById.set(id, pos)
      }
      const supabase = createClient()
      for (let order = 0; order < sortedMates.length; order++) {
        const mate = sortedMates[order]
        const msgId = nodeMessageId(mate)
        if (!msgId) continue
        const pos = posById.get(mate.id)
        if (!pos) continue
        const { data: row } = await supabase
          .from('messages')
          .select('metadata')
          .eq('id', msgId)
          .maybeSingle()
        if (!row) continue
        const base = (row.metadata as Record<string, unknown>) || {}
        const next = setParentStackHidden(patchForMate(order, pos, base), null)
        await supabase.from('messages').update({ metadata: next }).eq('id', msgId)
        if (entryExpanded(next, stackGroupId)) {
          await persistBlockPlacement(supabase, { messageId: msgId, position: pos })
        }
      }
      // Persist nested satellites parked with their owning mates
      for (const nid of nestedIds) {
        const n = live.find((x) => x.id === nid)
        const msgId = n ? nodeMessageId(n) : undefined
        const pos = posById.get(nid)
        if (!msgId || !pos) continue
        const { data: row } = await supabase
          .from('messages')
          .select('metadata')
          .eq('id', msgId)
          .maybeSingle()
        if (!row) continue
        const next = setParentStackHidden(
          { ...((row.metadata as Record<string, unknown>) || {}), position: pos },
          null
        )
        await supabase.from('messages').update({ metadata: next }).eq('id', msgId)
        await persistBlockPlacement(supabase, { messageId: msgId, position: pos })
      }
    },
    [getNodes, nodeId, stackGroupId, stackSide]
  )

  /** Eye — fully open all mates. */
  const actionShowAll = useCallback(async () => {
    setMenuOpen(false)
    setPreviewing(false)
    showMatesOut(true)
    try {
      await persistMatePatch((_order, pos, meta) => {
        const next = patchGroupEntry(meta, stackGroupId, { expanded: true })
        return { ...next, position: pos }
      })
    } catch (err) {
      console.error('Failed to show stacked frames:', err)
    }
  }, [persistMatePatch, showMatesOut, stackGroupId])

  /** Lock — toggle lock on this side’s group (drag moves that tree together). */
  const actionLock = useCallback(async () => {
    setMenuOpen(false)
    const live = getNodes()
    const hostMeta = nodeStackMeta(live.find((n) => n.id === nodeId) || {})
    const currentlyLocked = isGroupLocked(hostMeta, stackGroupId)
    const nextLocked = !currentlyLocked
    const supabase = createClient()
    try {
      setNodes((nds) =>
        nds.map((n) => {
          const m = nodeStackMeta(n)
          if (n.id !== nodeId && !findStackEntry(m, stackGroupId)) return n
          const meta = setGroupLocked(m, stackGroupId, nextLocked)
          return {
            ...n,
            data: {
              ...n.data,
              promptMessage: n.data?.promptMessage
                ? { ...n.data.promptMessage, metadata: meta }
                : n.data?.promptMessage,
            },
          }
        })
      )
      for (const n of live) {
        const m = nodeStackMeta(n)
        if (n.id !== nodeId && !findStackEntry(m, stackGroupId)) continue
        const msgId = nodeMessageId(n)
        if (!msgId) continue
        const { data: row } = await supabase
          .from('messages')
          .select('metadata')
          .eq('id', msgId)
          .maybeSingle()
        if (!row) continue
        const meta = setGroupLocked(
          (row.metadata as Record<string, unknown>) || {},
          stackGroupId,
          nextLocked
        )
        await supabase.from('messages').update({ metadata: meta }).eq('id', msgId)
      }
    } catch (err) {
      console.error('Failed to toggle snap-lock:', err)
    }
  }, [getNodes, nodeId, setNodes, stackGroupId])

  /** Fully open one mate from preview click — park it flush next to the host. */
  const openOneMate = useCallback(
    async (mateId: string) => {
      setPreviewing(false)
      clearDwell()
      clearEndPreview()
      showMatesOut(true, mateId)
      try {
        const live = getNodes()
        const host = live.find((n) => n.id === nodeId)
        if (!host) return
        const frontAbs = absFlowPosition(host, live)
        const frontSize = nodeFlowSize(host)
        const frontBox = {
          x: frontAbs.x,
          y: frontAbs.y,
          width: frontSize.width,
          height: frontSize.height,
        }
        const sorted = collectMates(getNodes, nodeId, stackGroupId)
        const target = sorted.find((n) => n.id === mateId)
        const targetSize = target ? nodeFlowSize(target) : { width: 280, height: 120 }
        // Always adjacent to host (order 0), even if this mate was deeper in the stack
        const adjacentPos = stackExpandLayout(frontBox, stackSide, targetSize, 0, [])
        // Promote clicked mate to stackIndex 1; renumber others 2..n in prior order
        const indexById = new Map<string, number>()
        indexById.set(mateId, 1)
        let next = 2
        for (const m of sorted) {
          if (m.id === mateId) continue
          indexById.set(m.id, next++)
        }
        const supabase = createClient()
        const showNested = collectNestedSatelliteIds(live, [mateId], [stackGroupId])
        const hideMateIds = sorted.filter((n) => n.id !== mateId).map((n) => n.id)
        const hideNested = collectNestedSatelliteIds(live, hideMateIds, [stackGroupId])
        const placed = new Map<string, { x: number; y: number }>([[mateId, adjacentPos]])
        const nestedPos = layoutNestedFromMates(live, placed, stackGroupId)

        for (const mate of sorted) {
          const msgId = nodeMessageId(mate)
          if (!msgId) continue
          const isTarget = mate.id === mateId
          const { data: row } = await supabase
            .from('messages')
            .select('metadata')
            .eq('id', msgId)
            .maybeSingle()
          if (!row) continue
          let meta = patchGroupEntry(
            (row.metadata as Record<string, unknown>) || {},
            stackGroupId,
            {
              expanded: isTarget,
              index: indexById.get(mate.id) ?? 99,
            }
          )
          if (isTarget) {
            meta = setParentStackHidden({ ...meta, position: adjacentPos }, null)
            await persistBlockPlacement(supabase, {
              messageId: msgId,
              position: adjacentPos,
            })
          } else {
            meta = setParentStackHidden(meta, stackGroupId)
          }
          await supabase.from('messages').update({ metadata: meta }).eq('id', msgId)
        }
        for (const nid of showNested) {
          const n = live.find((x) => x.id === nid)
          const msgId = n ? nodeMessageId(n) : undefined
          const pos = nestedPos.get(nid)
          if (!msgId || !pos) continue
          const { data: row } = await supabase
            .from('messages')
            .select('metadata')
            .eq('id', msgId)
            .maybeSingle()
          if (!row) continue
          const meta = setParentStackHidden(
            { ...((row.metadata as Record<string, unknown>) || {}), position: pos },
            null
          )
          await supabase.from('messages').update({ metadata: meta }).eq('id', msgId)
          await persistBlockPlacement(supabase, { messageId: msgId, position: pos })
        }
        for (const nid of hideNested) {
          const n = live.find((x) => x.id === nid)
          const msgId = n ? nodeMessageId(n) : undefined
          if (!msgId) continue
          const { data: row } = await supabase
            .from('messages')
            .select('metadata')
            .eq('id', msgId)
            .maybeSingle()
          if (!row) continue
          const meta = setParentStackHidden(
            (row.metadata as Record<string, unknown>) || {},
            stackGroupId
          )
          await supabase.from('messages').update({ metadata: meta }).eq('id', msgId)
        }
      } catch (err) {
        console.error('Failed to open stacked frame:', err)
      }
    },
    [
      clearDwell,
      clearEndPreview,
      getNodes,
      nodeId,
      showMatesOut,
      stackGroupId,
      stackSide,
    ]
  )

  /** True if element is the stack line or a mate frame in this group. */
  const isPreviewZoneEl = useCallback((el: Element | null) => {
    if (!el) return false
    if (el.closest?.('[data-tt-stack-reveal], [data-tt-stack-line-menu]')) return true
    const rfNode = el.closest?.('.react-flow__node') as HTMLElement | null
    if (!rfNode) return false
    const id = rfNode.getAttribute('data-id')
    return Boolean(id && mateIdsRef.current.has(id))
  }, [])

  const scheduleEndPreview = useCallback(() => {
    clearEndPreview()
    endPreviewRef.current = window.setTimeout(() => {
      endPreviewRef.current = null
      if (!previewingRef.current) return
      endPreview()
    }, 220) // Long enough to cross the snap gap onto a mate
  }, [clearEndPreview, endPreview])

  // While previewing: keep open across line↔mate gap; click mate → open just that one
  useEffect(() => {
    if (!previewing) return
    const onPointerMove = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (isPreviewZoneEl(el)) clearEndPreview()
      else scheduleEndPreview()
    }
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null
      if (!t) return
      if (t.closest?.('[data-tt-stack-reveal], [data-tt-stack-line-menu]')) return
      const rfNode = t.closest?.('.react-flow__node') as HTMLElement | null
      if (!rfNode) {
        clearEndPreview()
        endPreview()
        return
      }
      const id = rfNode.getAttribute('data-id')
      if (!id || id === nodeId || !mateIdsRef.current.has(id)) {
        clearEndPreview()
        endPreview()
        return
      }
      // Click previewed mate (or nested satellite) → open that owning mate + its nested pack
      e.stopPropagation()
      e.preventDefault()
      clearEndPreview()
      prePreviewRef.current = null // Commit — don't restore on cancel paths
      const live = getNodes()
      const mates = collectMates(getNodes, nodeId, stackGroupId)
      const owner =
        findOwningMateId(
          live,
          id,
          mates.map((m) => m.id),
          [stackGroupId]
        ) || id
      void openOneMate(owner)
    }
    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [
    clearEndPreview,
    endPreview,
    getNodes,
    isPreviewZoneEl,
    nodeId,
    openOneMate,
    previewing,
    scheduleEndPreview,
    stackGroupId,
  ])

  // Close menu on outside click / Escape
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('[data-tt-stack-line-menu], [data-tt-stack-reveal]')) return
      setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [menuOpen])

  // Derive mate state after hooks (mateStateKey forces refresh)
  void mateStateKey
  const mates = collectMates(getNodes, nodeId, stackGroupId)
  const nestedForLine = collectNestedSatelliteIds(
    getNodes(),
    mates.map((n) => n.id),
    [stackGroupId]
  )
  // Preview hit-tests: direct mates + nested satellites (C on A’s bottom, etc.)
  mateIdsRef.current = new Set([...mates.map((n) => n.id), ...nestedForLine])
  // Truly stacked (collapsed) — not counting in-progress hover preview
  const anyHidden = mates.some((n) => n.hidden === true) || nestedForLine.some((id) => {
    const n = getNodes().find((x) => x.id === id)
    return n?.hidden === true
  })
  const allOpen =
    mates.length > 0 &&
    mates.every((n) => {
      const m = nodeStackMeta(n)
      return entryExpanded(m, stackGroupId) && !n.hidden
    }) &&
    nestedForLine.every((id) => {
      const n = getNodes().find((x) => x.id === id)
      return n && !n.hidden
    })
  const hostNode = getNodes().find((n) => n.id === nodeId)
  const isLocked =
    isGroupLocked(nodeStackMeta(hostNode || {}), stackGroupId) ||
    mates.some((n) => isGroupLocked(nodeStackMeta(n), stackGroupId))

  const onEnter = () => {
    if (menuOpen) return
    clearEndPreview()
    if (previewingRef.current) return // Already showing preview — stay
    // Start preview only when at least one mate is stacked/hidden
    const live = collectMates(getNodes, nodeId, stackGroupId)
    const nested = collectNestedSatelliteIds(
      getNodes(),
      live.map((n) => n.id),
      [stackGroupId]
    )
    const stacked = live.filter((n) => {
      if (n.hidden) return true
      const m = nodeStackMeta(n)
      return !entryExpanded(m, stackGroupId)
    })
    const nestedStacked = nested.filter((id) => {
      const n = getNodes().find((x) => x.id === id)
      return !n || n.hidden === true
    })
    if (stacked.length === 0 && nestedStacked.length === 0) return
    clearDwell()
    dwellRef.current = window.setTimeout(() => {
      // Snapshot mates + nested so cancel restores which frames were open
      const snapNodes = [
        ...live,
        ...nested
          .map((id) => getNodes().find((x) => x.id === id))
          .filter(Boolean),
      ] as typeof live
      prePreviewRef.current = snapNodes.map((n) => {
        const m = nodeStackMeta(n)
        return {
          id: n.id,
          expanded: entryExpanded(m, stackGroupId),
          hidden: n.hidden === true,
        }
      })
      setPreviewing(true)
      showMatesOut(false) // Faded preview of all stacked mates + nested packs
    }, HOVER_DWELL_MS)
  }

  // Leaving the line: delay dismiss so pointer can reach a previewed mate across the gap
  const onLinePointerLeave = () => {
    clearDwell()
    if (!previewingRef.current) return
    scheduleEndPreview()
  }

  const onClickLine = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    clearDwell()
    clearEndPreview()
    // End preview before opening menu
    if (previewingRef.current) {
      endPreview()
    }
    const rect = lineBtnRef.current?.getBoundingClientRect()
    setMenuPos({
      x: rect ? rect.left + rect.width / 2 : e.clientX,
      y: rect ? rect.top : e.clientY,
    })
    setMenuOpen((o) => !o)
  }

  if (mates.length === 0) return null

  const isHorizontal = stackSide === 'top' || stackSide === 'bottom'
  // This gap's "outward" count = mates further out than this frame
  const myIndex = (() => {
    const self = getNodes().find((n) => n.id === nodeId)
    return self ? stackIndexOf(self, stackGroupId) : 0
  })()
  const outwardMates = mates
    .filter((n) => stackIndexOf(n, stackGroupId) > myIndex)
    .sort((a, b) => stackIndexOf(a, stackGroupId) - stackIndexOf(b, stackGroupId))
  const nextOutId = outwardMates[0]?.id as string | undefined
  // Count nested satellites of outward mates (C under A) in the line encoding
  const outwardNestedCount = collectNestedSatelliteIds(
    getNodes(),
    outwardMates.map((n) => n.id),
    [stackGroupId]
  ).length
  const totalOutCount = outwardMates.length + outwardNestedCount
  const markCount = stackMarkCount(Math.max(1, totalOutCount))
  const isDotted = totalOutCount > STACK_LINE_DASH_CAP
  const gapPct = isDotted ? undefined : markCount <= 1 ? 0 : `${100 / (markCount * 4)}%`
  // Expanded snap: show when either frame on this gap is selected. Collapsed stack: always show.
  const mateStacked = outwardMates.some((n) => n.hidden === true || !entryExpanded(nodeStackMeta(n), stackGroupId))
  const showLine = anyHidden || mateStacked || !!hostNode?.selected || !!outwardMates[0]?.selected
  void viewportKey // Re-place after pan/zoom
  const zoom = Number(String(viewportKey).split(',')[2]) || 1
  const hostRect = showLine ? frameScreenRect(nodeId) : null
  if (!showLine || !hostRect || typeof document === 'undefined') return null
  const lineBox = stackLineScreenBox(stackSide, hostRect, zoom, frameUiScale)
  const stroke = LINE_THICKNESS * zoom // Match former in-node thickness (viewport-scaled)

  // Arrow toward this frame (inward) vs toward the next mate (outward)
  const InwardIcon =
    stackSide === 'right'
      ? ArrowLeft
      : stackSide === 'left'
        ? ArrowRight
        : stackSide === 'bottom'
          ? ArrowUp
          : ArrowDown
  const OutwardIcon =
    stackSide === 'right'
      ? ArrowRight
      : stackSide === 'left'
        ? ArrowLeft
        : stackSide === 'bottom'
          ? ArrowDown
          : ArrowUp
  const stackBtnClass =
    'flex h-8 w-8 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'

  return (
    <>
      {createPortal(
      <button
        ref={lineBtnRef}
        type="button"
        data-tt-stack-reveal
        className={cn(
          'nodrag nopan cursor-pointer border-0 p-0',
          'opacity-80 hover:opacity-100'
        )}
        style={{
          ...lineBox,
          background: 'transparent',
        }}
        title="Stack line"
        aria-label="Stack line menu"
        aria-expanded={menuOpen}
        onMouseEnter={onEnter}
        onMouseLeave={onLinePointerLeave}
        onClick={onClickLine}
      >
        <span
          className="pointer-events-none flex h-full w-full"
          style={{
            flexDirection: isHorizontal ? 'row' : 'column',
            alignItems: 'center',
            justifyContent: isDotted ? 'space-between' : 'stretch',
            gap: gapPct,
            height: isHorizontal ? stroke : '100%',
            width: isHorizontal ? '100%' : stroke,
            margin: isHorizontal ? undefined : '0 auto',
          }}
        >
          {Array.from({ length: markCount }, (_, i) => (
            <span
              key={i}
              aria-hidden
              style={{
                flex: isDotted ? '0 0 auto' : '1 1 0',
                ...(isDotted
                  ? { width: stroke, height: stroke }
                  : isHorizontal
                    ? { height: stroke, minWidth: stroke }
                    : { width: stroke, minHeight: stroke }),
                background: STACK_LINE_COLOR,
                borderRadius: 9999,
              }}
            />
          ))}
        </span>
      </button>,
        document.body
      )}

      {menuOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            data-tt-stack-line-menu
            role="menu"
            className="fixed z-[1000] flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-[#2f2f2f] dark:bg-[#1f1f1f]"
            style={{
              left: menuPos.x,
              top: menuPos.y,
              transform: 'translate(-50%, calc(-100% - 8px))',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800',
                allOpen && 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300'
              )}
              title="Open stack"
              aria-label="Open stack"
              onClick={() => void actionShowAll()}
            >
              <Eye className="h-4 w-4" />
              <span>Open stack</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={stackBtnClass}
              title="Stack under this frame"
              aria-label="Stack under this frame"
              onClick={() => void actionStackUnder(nodeId)}
            >
              <InwardIcon className="h-4 w-4" />
            </button>
            {nextOutId && (
              <button
                type="button"
                role="menuitem"
                className={stackBtnClass}
                title="Stack under the other frame"
                aria-label="Stack under the other frame"
                onClick={() => void actionStackUnder(nextOutId)}
              >
                <OutwardIcon className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800',
                isLocked && 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300'
              )}
              title={isLocked ? 'Unlock' : 'Lock'}
              aria-label={isLocked ? 'Unlock' : 'Lock'}
              onClick={() => void actionLock()}
            >
              <Lock className="h-4 w-4" />
              <span>Lock</span>
            </button>
          </div>,
          document.body
        )}
    </>
  )
}
