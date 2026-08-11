'use client'

// Stack line between snap-linked frames (one line per gap).
// • Click → Open stack / directional Stack arrows / Lock
// • First Stack sets snapLockGroupId (snap alone does not lock)
// • Hover when any mate is stacked → fast faded preview; click one to open just that frame

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useReactFlow, useStore } from 'reactflow'
import { Eye, Lock, ArrowLeft, ArrowRight, ArrowUp, ArrowDown } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  stackExpandLayout,
  STACK_LINE_GAP,
  type FrameStackSide,
} from '@/components/use-frame-nest-stack-drag'
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
  stackSide: FrameStackSide // Direction toward the next mate
  frameUiScale?: number
}

function oppositeSide(side: FrameStackSide): FrameStackSide {
  if (side === 'right') return 'left'
  if (side === 'left') return 'right'
  if (side === 'top') return 'bottom'
  return 'top'
}

function stackIndexOf(n: { data?: { promptMessage?: { metadata?: unknown } } }): number {
  const m = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
  if (typeof m.stackIndex === 'number') return m.stackIndex
  if (m.stackAnchor === true) return 0
  return 99
}

/** How many rounded marks to paint for this mate count (1 solid / N dashes / many dots). */
function stackMarkCount(mateCount: number): number {
  if (mateCount <= 1) return 1 // Solid = one full pill
  if (mateCount > STACK_LINE_DASH_CAP) return 24 // Dense dotted run
  return mateCount // One rounded dash per mate
}

/** Mate nodes in this stack group (excludes host), sorted by stackIndex. */
function collectMates(
  getNodes: () => ReturnType<ReturnType<typeof useReactFlow>['getNodes']>,
  nodeId: string,
  stackGroupId: string
) {
  return getNodes()
    .filter((n) => {
      if (n.id === nodeId || n.type !== 'chatPanel') return false
      const m = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
      return m.stackGroupId === stackGroupId
    })
    .sort((a, b) => {
      const ai =
        typeof (a.data?.promptMessage?.metadata as Record<string, unknown>)?.stackIndex ===
        'number'
          ? ((a.data?.promptMessage?.metadata as Record<string, unknown>).stackIndex as number)
          : 99
      const bi =
        typeof (b.data?.promptMessage?.metadata as Record<string, unknown>)?.stackIndex ===
        'number'
          ? ((b.data?.promptMessage?.metadata as Record<string, unknown>).stackIndex as number)
          : 99
      return ai - bi
    })
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
      const m = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
      if (n.id !== nodeId && m.stackGroupId !== stackGroupId) return
      const lock =
        typeof m.snapLockGroupId === 'string' && m.snapLockGroupId === stackGroupId ? 1 : 0
      parts.push(
        `${n.id}:${m.stackExpanded === true ? 1 : 0}:${n.hidden ? 1 : 0}:${lock}`
      )
    })
    return parts.join('|')
  })
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
   *  `onlyId` → that mate alone, always parked flush next to the host (order 0), not at its old deep index. */
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
          const m = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
          if (!n.hidden && m.stackExpanded === true) openFirst.push(n)
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
      setNodes((nds) =>
        nds.map((n) => {
          // Opening a single frame: hide every other mate
          if (onlyId && n.id !== onlyId) {
            const m = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
            if (m.stackGroupId !== stackGroupId || n.id === nodeId) return n
            const meta: Record<string, unknown> = { ...m, stackExpanded: false }
            const idx = indexById.get(n.id)
            if (typeof idx === 'number') meta.stackIndex = idx
            const { opacity: _o, ...restStyle } = (n.style || {}) as Record<string, unknown>
            const className = (n.className || '')
              .split(/\s+/)
              .filter((c) => c && c !== 'tt-stack-preview')
              .join(' ')
            return {
              ...n,
              hidden: true,
              style: restStyle,
              className: className || undefined,
              data: {
                ...n.data,
                promptMessage: n.data?.promptMessage
                  ? { ...n.data.promptMessage, metadata: meta }
                  : n.data?.promptMessage,
              },
            }
          }
          const pos = posById.get(n.id)
          if (!pos) return n
          const m = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
          const meta: Record<string, unknown> = {
            ...m,
            stackExpanded: expanded,
            position: pos,
          }
          const idx = indexById.get(n.id)
          if (typeof idx === 'number') meta.stackIndex = idx
          return {
            ...n,
            position: pos,
            hidden: false,
            zIndex: expanded ? 3 : 2, // Above host chrome so preview is clickable
            style: {
              ...(n.style || {}),
              opacity: expanded ? 1 : 0.72, // Preview is slightly faded
              pointerEvents: 'all', // Ensure preview mates receive clicks
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

  /** Stack under `keeperId` — that frame stays visible; others hide. Locks the group. */
  const actionStackUnder = useCallback(
    async (keeperId: string) => {
      setMenuOpen(false)
      setPreviewing(false)
      const live = getNodes()
      const group = live.filter((n) => {
        if (n.type !== 'chatPanel') return false
        return (
          n.id === keeperId ||
          ((n.data?.promptMessage?.metadata || {}) as Record<string, unknown>).stackGroupId ===
            stackGroupId
        )
      })
      if (group.length === 0) return
      // Side points from keeper toward where the hidden pack sits
      const newSide = keeperId === nodeId ? stackSide : oppositeSide(stackSide)
      // Renumber: keeper = 0; others keep relative order among themselves
      const others = group
        .filter((n) => n.id !== keeperId)
        .sort((a, b) => stackIndexOf(a) - stackIndexOf(b))
      const indexById = new Map<string, number>()
      indexById.set(keeperId, 0)
      others.forEach((n, i) => indexById.set(n.id, i + 1))

      setNodes((nds) =>
        nds.map((n) => {
          const m = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
          if (m.stackGroupId !== stackGroupId && n.id !== keeperId) return n
          const isKeeper = n.id === keeperId
          const meta: Record<string, unknown> = {
            ...m,
            stackGroupId,
            stackSide: newSide,
            stackIndex: indexById.get(n.id) ?? 99,
            stackExpanded: isKeeper,
            snapLockGroupId: stackGroupId, // Lock on first stack
          }
          if (isKeeper) meta.stackAnchor = true
          else delete meta.stackAnchor
          const { opacity: _o, ...restStyle } = (n.style || {}) as Record<string, unknown>
          const className = (n.className || '')
            .split(/\s+/)
            .filter((c) => c && c !== 'tt-stack-preview')
            .join(' ')
          return {
            ...n,
            hidden: !isKeeper,
            style: restStyle,
            className: className || undefined,
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
        for (const n of group) {
          const msgId = n.data?.promptMessage?.id as string | undefined
          if (!msgId) continue
          const { data: row } = await supabase
            .from('messages')
            .select('metadata')
            .eq('id', msgId)
            .maybeSingle()
          if (!row) continue
          const isKeeper = n.id === keeperId
          const meta: Record<string, unknown> = {
            ...((row.metadata as Record<string, unknown>) || {}),
            stackGroupId,
            stackSide: newSide,
            stackIndex: indexById.get(n.id) ?? 99,
            stackExpanded: isKeeper,
            snapLockGroupId: stackGroupId,
          }
          if (isKeeper) meta.stackAnchor = true
          else delete meta.stackAnchor
          await supabase.from('messages').update({ metadata: meta }).eq('id', msgId)
        }
      } catch (err) {
        console.error('Failed to stack frames:', err)
      }
    },
    [getNodes, nodeId, setNodes, stackGroupId, stackSide]
  )

  /** Hide all mates (preview cancel) — keep current host. */
  const hideMates = useCallback(() => {
    setNodes((nds) =>
      nds.map((n) => {
        const m = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
        if (m.stackGroupId !== stackGroupId || n.id === nodeId) return n
        const meta = { ...m, stackExpanded: false }
        const { opacity: _o, ...restStyle } = (n.style || {}) as Record<string, unknown>
        const className = (n.className || '')
          .split(/\s+/)
          .filter((c) => c && c !== 'tt-stack-preview')
          .join(' ')
        return {
          ...n,
          hidden: true,
          style: restStyle,
          className: className || undefined,
          data: {
            ...n.data,
            promptMessage: n.data?.promptMessage
              ? { ...n.data.promptMessage, metadata: meta }
              : n.data?.promptMessage,
          },
        }
      })
    )
  }, [nodeId, setNodes, stackGroupId])

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
        const m = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
        const meta = { ...m, stackExpanded: prev.expanded }
        const { opacity: _o, ...restStyle } = (n.style || {}) as Record<string, unknown>
        const className = (n.className || '')
          .split(/\s+/)
          .filter((c) => c && c !== 'tt-stack-preview')
          .join(' ')
        return {
          ...n,
          hidden: prev.hidden,
          style: prev.expanded ? { ...restStyle, opacity: 1 } : restStyle,
          className: className || undefined,
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
  }, [hideMates, setNodes])

  const persistMatePatch = useCallback(
    async (
      patchForMate: (order: number, pos: { x: number; y: number }) => Record<string, unknown>
    ) => {
      const live = getNodes()
      const host = live.find((n) => n.id === nodeId)
      if (!host) return
      const frontAbs = absFlowPosition(host, live)
      const frontSize = nodeFlowSize(host)
      const sortedMates = collectMates(getNodes, nodeId, stackGroupId)
      const sizes = sortedMates.map((n) => nodeFlowSize(n))
      const supabase = createClient()
      for (let order = 0; order < sortedMates.length; order++) {
        const mate = sortedMates[order]
        const msgId = mate.data?.promptMessage?.id as string | undefined
        if (!msgId) continue
        const pos = stackExpandLayout(
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
        const { data: row } = await supabase
          .from('messages')
          .select('metadata')
          .eq('id', msgId)
          .maybeSingle()
        if (!row) continue
        const next = {
          ...((row.metadata as Record<string, unknown>) || {}),
          ...patchForMate(order, pos),
        }
        await supabase.from('messages').update({ metadata: next }).eq('id', msgId)
        if (next.stackExpanded === true) {
          await persistBlockPlacement(supabase, { messageId: msgId, position: pos })
        }
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
      await persistMatePatch((_order, pos) => ({
        stackExpanded: true,
        position: pos,
      }))
    } catch (err) {
      console.error('Failed to show stacked frames:', err)
    }
  }, [persistMatePatch, showMatesOut])

  /** Lock — toggle snapLockGroupId on host + mates (drag moves together). */
  const actionLock = useCallback(async () => {
    setMenuOpen(false)
    const live = getNodes()
    const hostMeta = (live.find((n) => n.id === nodeId)?.data?.promptMessage?.metadata ||
      {}) as Record<string, unknown>
    const currentlyLocked = hostMeta.snapLockGroupId === stackGroupId
    const nextLock = currentlyLocked ? null : stackGroupId
    const supabase = createClient()
    try {
      setNodes((nds) =>
        nds.map((n) => {
          const m = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
          if (n.id !== nodeId && m.stackGroupId !== stackGroupId) return n
          const meta = { ...m }
          if (nextLock) meta.snapLockGroupId = nextLock
          else delete meta.snapLockGroupId
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
        const m = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
        if (n.id !== nodeId && m.stackGroupId !== stackGroupId) continue
        const msgId = n.data?.promptMessage?.id as string | undefined
        if (!msgId) continue
        const { data: row } = await supabase
          .from('messages')
          .select('metadata')
          .eq('id', msgId)
          .maybeSingle()
        if (!row) continue
        const meta = { ...((row.metadata as Record<string, unknown>) || {}) }
        if (nextLock) meta.snapLockGroupId = nextLock
        else delete meta.snapLockGroupId
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
        for (const mate of sorted) {
          const msgId = mate.data?.promptMessage?.id as string | undefined
          if (!msgId) continue
          const isTarget = mate.id === mateId
          const { data: row } = await supabase
            .from('messages')
            .select('metadata')
            .eq('id', msgId)
            .maybeSingle()
          if (!row) continue
          const meta: Record<string, unknown> = {
            ...((row.metadata as Record<string, unknown>) || {}),
            stackExpanded: isTarget,
            stackIndex: indexById.get(mate.id) ?? 99,
          }
          if (isTarget) {
            meta.position = adjacentPos
            await persistBlockPlacement(supabase, {
              messageId: msgId,
              position: adjacentPos,
            })
          }
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
      // Click previewed mate → fully open just that frame
      e.stopPropagation()
      e.preventDefault()
      clearEndPreview()
      prePreviewRef.current = null // Commit — don't restore on cancel paths
      void openOneMate(id)
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
    isPreviewZoneEl,
    nodeId,
    openOneMate,
    previewing,
    scheduleEndPreview,
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
  mateIdsRef.current = new Set(mates.map((n) => n.id))
  // Truly stacked (collapsed) — not counting in-progress hover preview
  const anyHidden = mates.some((n) => n.hidden === true)
  const allOpen =
    mates.length > 0 &&
    mates.every((n) => {
      const m = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
      return m.stackExpanded === true && !n.hidden
    })
  const hostNode = getNodes().find((n) => n.id === nodeId)
  const isLocked =
    ((hostNode?.data?.promptMessage?.metadata || {}) as Record<string, unknown>)
      .snapLockGroupId === stackGroupId ||
    mates.some((n) => {
      const m = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
      return m.snapLockGroupId === stackGroupId
    })

  const onEnter = () => {
    if (menuOpen) return
    clearEndPreview()
    if (previewingRef.current) return // Already showing preview — stay
    // Start preview only when at least one mate is stacked/hidden
    const live = collectMates(getNodes, nodeId, stackGroupId)
    const stacked = live.filter((n) => {
      if (n.hidden) return true
      const m = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
      return m.stackExpanded !== true
    })
    if (stacked.length === 0) return
    clearDwell()
    dwellRef.current = window.setTimeout(() => {
      // Snapshot so cancel restores which frames were open
      prePreviewRef.current = live.map((n) => {
        const m = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
        return {
          id: n.id,
          expanded: m.stackExpanded === true,
          hidden: n.hidden === true,
        }
      })
      setPreviewing(true)
      showMatesOut(false) // Faded preview of all stacked mates
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

  // Line sits in the gap between host and mate (mid-gap) so it isn’t covered
  const lineOutset = Math.max(4, STACK_LINE_GAP / 2)
  const lineStyle: React.CSSProperties =
    stackSide === 'top'
      ? {
          left: '8%',
          width: '84%',
          top: 0,
          height: LINE_THICKNESS,
          transform: `translateY(calc(-50% - ${lineOutset}px))`,
          transformOrigin: 'center',
        }
      : stackSide === 'bottom'
        ? {
            left: '8%',
            width: '84%',
            bottom: 0,
            height: LINE_THICKNESS,
            transform: `translateY(calc(50% + ${lineOutset}px))`,
            transformOrigin: 'center',
          }
        : stackSide === 'left'
          ? {
              top: '8%',
              height: '84%',
              left: 0,
              width: LINE_THICKNESS,
              transform: `translateX(calc(-50% - ${lineOutset}px))`,
              transformOrigin: 'center',
            }
          : {
              top: '8%',
              height: '84%',
              right: 0,
              width: LINE_THICKNESS,
              transform: `translateX(calc(50% + ${lineOutset}px))`,
              transformOrigin: 'center',
            }

  const isHorizontal = stackSide === 'top' || stackSide === 'bottom'
  // Hit band fills most of the snap gap so the line is easy to grab
  const hitPad = Math.max(STACK_LINE_GAP, 10 * frameUiScale)
  // This gap's "outward" count = mates further out than this frame
  const myIndex = (() => {
    const self = getNodes().find((n) => n.id === nodeId)
    return self ? stackIndexOf(self) : 0
  })()
  const outwardMates = mates
    .filter((n) => stackIndexOf(n) > myIndex)
    .sort((a, b) => stackIndexOf(a) - stackIndexOf(b))
  const nextOutId = outwardMates[0]?.id as string | undefined
  const markCount = stackMarkCount(Math.max(1, outwardMates.length))
  const isDotted = outwardMates.length > STACK_LINE_DASH_CAP
  const gapPct = isDotted ? undefined : markCount <= 1 ? 0 : `${100 / (markCount * 4)}%`

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
      <button
        ref={lineBtnRef}
        type="button"
        data-tt-stack-reveal
        className={cn(
          'nodrag nopan absolute z-[40] cursor-pointer border-0 p-0',
          'opacity-80 hover:opacity-100'
        )}
        style={{
          ...lineStyle,
          ...(isHorizontal
            ? { marginTop: -hitPad / 2, height: hitPad, paddingTop: hitPad / 2 - 1 }
            : { marginLeft: -hitPad / 2, width: hitPad, paddingLeft: hitPad / 2 - 1 }),
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
            height: isHorizontal ? LINE_THICKNESS : '100%',
            width: isHorizontal ? '100%' : LINE_THICKNESS,
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
                  ? { width: LINE_THICKNESS, height: LINE_THICKNESS }
                  : isHorizontal
                    ? { height: LINE_THICKNESS, minWidth: LINE_THICKNESS }
                    : { width: LINE_THICKNESS, minHeight: LINE_THICKNESS }),
                background: STACK_LINE_COLOR,
                borderRadius: 9999,
              }}
            />
          ))}
        </span>
      </button>

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
