'use client'

// Context: defer TipTap mount for off-screen frames; prefetch on pan / pointer warm.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { computeNearViewportFrameIds, FRAME_VIEWPORT_DEFER_MIN } from '@/lib/frame-viewport-mount'
import {
  buildSpatialIndex,
  flowViewportRect,
  mountPadFlowPx,
  querySpatialIndex,
  type SpatialEntry,
} from '@/lib/board-spatial-index'
import { readFrameLayoutCache } from '@/components/frame-content-shimmer'
import { isFrameDragging } from '@/lib/frame-dragging'
import { useStoreApi, type ReactFlowState } from 'reactflow'

// Frames mounted per animation frame. One frame costs ~40ms (TipTap mount plus applying its saved
// size / scale / shape), so 2 per commit measured 51–80ms tasks; 1 keeps each commit near a single
// dropped frame and still fills a screenful (~15 frames) in ~250ms.
const MOUNT_PROMOTE_BATCH = 1

/**
 * Why a frame would go live. Callers need the distinction because **proximity alone is no longer a
 * reason to mount**: a frame with a DOM snapshot renders cold pixel-identically (0.07ms vs ~20–40ms
 * for a TipTap mount), so only interaction — hover, pointer-down, selection — earns a live editor.
 */
export type FrameMountReason = 'always' | 'warm' | 'near' | false

type FrameViewportMountContextValue = {
  /** Subscribe to one frame's reason. Returns an unsubscribe. */
  subscribeReason: (nodeId: string | undefined, onChange: () => void) => () => void
  getReason: (nodeId: string | undefined) => FrameMountReason
  warmMount: (nodeId: string | undefined) => void
}

const FrameViewportMountContext = createContext<FrameViewportMountContextValue>({
  subscribeReason: () => () => {},
  getReason: () => 'always',
  warmMount: () => {},
})

/**
 * Deliberately no boolean `useFrameContentMount` wrapper: a caller that only asked "may I mount?"
 * would treat 'near' as yes and silently reintroduce proximity mounting. Callers must see the reason.
 *
 * This is a **per-frame** subscription, not context state, because the provider wraps the entire board.
 * It used to keep `nearVersion` / `liveVersion` / `warmIds` in `useState`, so every near-set change
 * during a pan re-rendered the whole subtree — a pan over 22 frames with **nothing selected** measured
 * 489ms of blocking across 3 long tasks, and the profile was full of components that have nothing to do
 * with mounting (`BoardTopBarShare`, `EditableThread`, `EditorToolbar`) plus `ChatPanelNodeInner` at
 * 178ms inclusive. The provider now mutates refs and notifies only the ids whose reason actually
 * changed, so promoting one frame re-renders one frame.
 */
export function useFrameContentMountReason(nodeId: string | undefined): FrameMountReason {
  const { subscribeReason, getReason } = useContext(FrameViewportMountContext)
  const subscribe = useCallback(
    (onChange: () => void) => subscribeReason(nodeId, onChange),
    [subscribeReason, nodeId]
  )
  const snapshot = useCallback(() => getReason(nodeId), [getReason, nodeId])
  return useSyncExternalStore(subscribe, snapshot, () => 'always')
}

export function useWarmFrameContentMount(): (nodeId: string | undefined) => void {
  return useContext(FrameViewportMountContext).warmMount
}

export function FrameViewportMountProvider({
  children,
  deferEnabled,
  nodes,
  getViewport,
  paneSize,
  boardRotation,
  conversationId,
  alwaysMountIds,
  simplifyContent = false,
  recomputeKey = 0,
}: {
  children: ReactNode
  deferEnabled: boolean
  nodes: Array<{
    id: string
    type?: string
    position: { x: number; y: number }
    positionAbsolute?: { x: number; y: number }
    width?: number
    height?: number
    style?: { width?: number | string; height?: number | string }
  }>
  getViewport: () => { x: number; y: number; zoom: number }
  paneSize: { width: number; height: number }
  boardRotation: number
  conversationId?: string
  alwaysMountIds: Set<string>
  simplifyContent?: boolean
  recomputeKey?: number
}) {
  const nearRef = useRef<Set<string>>(new Set())
  const warmRef = useRef<Set<string>>(new Set())
  // Live set trails the near set, and is the *only* mount throttle — a pan revealing frames and a
  // return from low zoom both drain through it. Mounting everything a gesture revealed in one commit
  // was the whole hitch: a TipTap mount costs ~40ms, so 15 frames blocked 66/149/67/58ms (two
  // throttles used to stack, hence the 149). Staged, each commit is one frame's worth of work.
  const liveRef = useRef<Set<string>>(new Set())
  const pendingRef = useRef<string[]>([]) // Near, awaiting promotion
  const promoteRafRef = useRef<number | null>(null)

  // Props feeding the reason are mirrored into refs so `reasonFor` can be identity-stable: a changing
  // `getSnapshot` would make `useSyncExternalStore` re-subscribe every frame in the board.
  const deferEnabledRef = useRef(deferEnabled)
  deferEnabledRef.current = deferEnabled
  const alwaysMountRef = useRef(alwaysMountIds)
  alwaysMountRef.current = alwaysMountIds
  const simplifyRef = useRef(simplifyContent)
  simplifyRef.current = simplifyContent

  const listenersRef = useRef(new Map<string, Set<() => void>>())
  const lastReasonRef = useRef(new Map<string, FrameMountReason>())

  const reasonFor = useCallback((nodeId: string | undefined): FrameMountReason => {
    if (!deferEnabledRef.current || !nodeId) return 'always'
    if (alwaysMountRef.current.has(nodeId)) return 'always'
    if (warmRef.current.has(nodeId)) return 'warm'
    if (simplifyRef.current) return false
    return liveRef.current.has(nodeId) ? 'near' : false
  }, [])

  /** Wake only the frames whose reason moved. Set lookups, so this stays cheap per mutation. */
  const notifyReasonChanges = useCallback(() => {
    for (const [nodeId, listeners] of listenersRef.current) {
      const next = reasonFor(nodeId)
      if (lastReasonRef.current.get(nodeId) === next) continue
      lastReasonRef.current.set(nodeId, next)
      for (const listener of listeners) listener()
    }
  }, [reasonFor])

  const subscribeReason = useCallback(
    (nodeId: string | undefined, onChange: () => void) => {
      if (!nodeId) return () => {}
      let listeners = listenersRef.current.get(nodeId)
      if (!listeners) {
        listeners = new Set()
        listenersRef.current.set(nodeId, listeners)
      }
      listeners.add(onChange)
      lastReasonRef.current.set(nodeId, reasonFor(nodeId))
      return () => {
        const set = listenersRef.current.get(nodeId)
        if (!set) return
        set.delete(onChange)
        if (set.size > 0) return
        listenersRef.current.delete(nodeId)
        lastReasonRef.current.delete(nodeId)
      }
    },
    [reasonFor]
  )

  // Props are not part of the store, so a change in them has to be announced explicitly.
  useEffect(() => {
    notifyReasonChanges()
  }, [deferEnabled, alwaysMountIds, simplifyContent, notifyReasonChanges])
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const getViewportRef = useRef(getViewport)
  getViewportRef.current = getViewport
  const nodeCountKey = nodes.length

  const promoteBatch = useCallback(() => {
    promoteRafRef.current = null
    const queue = pendingRef.current
    if (queue.length === 0) return
    const batch = queue.splice(0, MOUNT_PROMOTE_BATCH)
    const next = new Set(liveRef.current)
    let added = false
    for (const id of batch) {
      if (!nearRef.current.has(id)) continue // Panned back out while queued — skip the mount entirely
      next.add(id)
      added = true
    }
    if (added) {
      liveRef.current = next
      notifyReasonChanges()
    }
    if (queue.length > 0) promoteRafRef.current = requestAnimationFrame(promoteBatch)
  }, [notifyReasonChanges])

  /** Adopt a fresh near set: unmount departures at once, queue arrivals for staged promotion. */
  const commitNear = useCallback(
    (next: Set<string>) => {
      nearRef.current = next
      const keep = new Set<string>()
      let dropped = false
      for (const id of liveRef.current) {
        if (next.has(id)) keep.add(id)
        else dropped = true // Leaving the pane frees its editor immediately — no reason to stage that
      }
      if (dropped) liveRef.current = keep
      const queue: string[] = []
      for (const id of next) if (!keep.has(id)) queue.push(id)
      pendingRef.current = queue
      if (queue.length > 0) {
        if (typeof document !== 'undefined' && document.hidden) {
          // rAF never runs in a hidden tab, and there is no gesture to keep smooth — promote now so
          // the board is not a wall of shells when the tab comes back.
          for (const id of queue) keep.add(id)
          liveRef.current = keep
          pendingRef.current = []
        } else if (promoteRafRef.current === null) {
          promoteRafRef.current = requestAnimationFrame(promoteBatch)
        }
      }
      notifyReasonChanges()
    },
    [promoteBatch, notifyReasonChanges]
  )

  useEffect(
    () => () => {
      if (promoteRafRef.current !== null) cancelAnimationFrame(promoteRafRef.current)
      promoteRafRef.current = null
    },
    []
  )

  const layout = useMemo(
    () => (conversationId ? readFrameLayoutCache(conversationId) : {}),
    [conversationId, recomputeKey]
  )

  const syncNearViewport = useCallback(() => {
    if (!deferEnabled) return
    // Skip mid-drag only. Do NOT gate on isBoardNavigating(): onMoveEnd bumps recomputeKey
    // while navigating stays true for ~80ms (chrome freeze), which left nearRef empty until
    // hover warmMount — Notion boardLink mindmaps looked blank until pointerenter.
    if (isFrameDragging()) return
    const vp = getViewportRef.current()
    // Prefer spatial index + flow-space pad (scales with zoom) for large boards; fall back to
    // the older pane-buffer scan when the catalog is small.
    const catalog = nodesRef.current
    if (catalog.length >= 24) {
      const entries: SpatialEntry[] = []
      for (const node of catalog) {
        if (node.type !== 'chatPanel') continue
        const cached = layout[node.id]
        const rawW = node.width ?? node.style?.width ?? cached?.width ?? 220
        const rawH = node.height ?? node.style?.height ?? cached?.height ?? 72
        const width = typeof rawW === 'number' ? rawW : parseFloat(String(rawW)) || 220
        const height = typeof rawH === 'number' ? rawH : parseFloat(String(rawH)) || 72
        const pos = node.positionAbsolute ?? node.position
        entries.push({
          id: node.id,
          minX: pos.x,
          minY: pos.y,
          maxX: pos.x + width,
          maxY: pos.y + height,
        })
      }
      const index = buildSpatialIndex(entries)
      const rect = flowViewportRect(vp, paneSize.width, paneSize.height)
      const next = querySpatialIndex(index, rect, mountPadFlowPx(vp.zoom))
      const prev = nearRef.current
      if (prev.size === next.size && [...next].every((id) => prev.has(id))) return
      commitNear(next)
      return
    }
    const next = computeNearViewportFrameIds(
      catalog,
      nearRef.current,
      vp,
      paneSize.width,
      paneSize.height,
      boardRotation,
      layout
    )
    const prev = nearRef.current
    if (prev.size === next.size && [...next].every((id) => prev.has(id))) return
    commitNear(next)
  }, [deferEnabled, paneSize.width, paneSize.height, boardRotation, layout, commitNear])

  useEffect(() => {
    syncNearViewport()
  }, [syncNearViewport, recomputeKey, nodeCountKey])

  // The near set has to follow the viewport *during* a gesture, not just at its end. `recomputeKey` is
  // bumped by RF's `onMoveEnd` and the wheel settle, so a frame that scrolled into view mid-zoom was
  // absent from the near set until the gesture stopped: measured on board 56faeee0, mid-zoom-out gave
  // 9 frames in view with 3 rendering *nothing*, and all 9 only went live at release — which is what
  // "frames out of view don't render until I let go of the zoom" was. Subscribing to the store's
  // transform covers every source (wheel, d3, setViewport, minimap, Fit) without a provider re-render;
  // one rAF coalesces a burst, and `commitNear` still stages the actual mounts one frame at a time.
  const storeApi = useStoreApi()
  useEffect(() => {
    if (!deferEnabled) return
    let raf = 0
    let last = ''
    const unsubscribe = storeApi.subscribe((state: ReactFlowState) => {
      const [x, y, zoom] = state.transform
      const key = `${Math.round(x)}:${Math.round(y)}:${zoom.toFixed(3)}`
      if (key === last) return // Store updates for many reasons — only the viewport matters here
      last = key
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        syncNearViewport()
      })
    })
    return () => {
      unsubscribe()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [deferEnabled, storeApi, syncNearViewport])

  // Low zoom keeps frames as cached lightweight previews. Entering it drops the live set so that
  // zooming back in re-promotes through the same staged throttle a pan uses — restoring in one
  // commit caused the same FPS cliff as live RF culling.
  useEffect(() => {
    if (simplifyContent) {
      if (promoteRafRef.current !== null) {
        cancelAnimationFrame(promoteRafRef.current)
        promoteRafRef.current = null
      }
      liveRef.current = new Set()
      pendingRef.current = []
      notifyReasonChanges()
      return
    }
    commitNear(new Set(nearRef.current)) // Live set is empty here, so every near frame queues
  }, [simplifyContent, commitNear, notifyReasonChanges])

  const warmMount = useCallback(
    (nodeId: string | undefined) => {
      if (!deferEnabledRef.current || !nodeId || alwaysMountRef.current.has(nodeId)) return
      if (warmRef.current.has(nodeId)) return
      warmRef.current = new Set(warmRef.current).add(nodeId)
      notifyReasonChanges()
    },
    [notifyReasonChanges]
  )

  // Stable for the life of the provider: every callback closes over refs, so the board subtree never
  // re-renders because of this context — only the individual frames whose reason changed do.
  const value = useMemo(
    () => ({ subscribeReason, getReason: reasonFor, warmMount }),
    [subscribeReason, reasonFor, warmMount]
  )

  return (
    <FrameViewportMountContext.Provider value={value}>{children}</FrameViewportMountContext.Provider>
  )
}

export { FRAME_VIEWPORT_DEFER_MIN }
