'use client'

// Context: defer TipTap mount for off-screen frames; prefetch on pan / pointer warm.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
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

type FrameViewportMountContextValue = {
  deferEnabled: boolean
  shouldMountContent: (nodeId: string | undefined) => boolean
  warmMount: (nodeId: string | undefined) => void
}

const FrameViewportMountContext = createContext<FrameViewportMountContextValue>({
  deferEnabled: false,
  shouldMountContent: () => true,
  warmMount: () => {},
})

export function useFrameContentMount(nodeId: string | undefined): boolean {
  const { deferEnabled, shouldMountContent } = useContext(FrameViewportMountContext)
  if (!deferEnabled || !nodeId) return true
  return shouldMountContent(nodeId)
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
  const [nearVersion, setNearVersion] = useState(0)
  const [warmIds, setWarmIds] = useState<Set<string>>(() => new Set())
  const restoringRef = useRef(false) // True while full editors return in small batches after semantic zoom
  const restoredIdsRef = useRef<Set<string>>(new Set())
  const restoreRafRef = useRef<number | null>(null)
  const [restoreVersion, setRestoreVersion] = useState(0)
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const getViewportRef = useRef(getViewport)
  getViewportRef.current = getViewport
  const nodeCountKey = nodes.length

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
      nearRef.current = next
      setNearVersion((v) => v + 1)
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
    nearRef.current = next
    setNearVersion((v) => v + 1)
  }, [deferEnabled, paneSize.width, paneSize.height, boardRotation, layout])

  useEffect(() => {
    syncNearViewport()
  }, [syncNearViewport, recomputeKey, nodeCountKey])

  // Low zoom keeps frames visible as cached lightweight previews. When zooming back in, mounting
  // every TipTap/database editor in one commit causes the same FPS cliff as live RF culling, so
  // restore a few per animation frame.
  useEffect(() => {
    if (restoreRafRef.current !== null) {
      cancelAnimationFrame(restoreRafRef.current)
      restoreRafRef.current = null
    }
    if (simplifyContent) {
      restoringRef.current = true
      restoredIdsRef.current = new Set()
      setRestoreVersion((v) => v + 1)
      return
    }
    if (!restoringRef.current) return
    const pending = [...nearRef.current]
    const restoreBatch = () => {
      const next = new Set(restoredIdsRef.current)
      pending.splice(0, 4).forEach((id) => next.add(id))
      restoredIdsRef.current = next
      if (pending.length === 0) restoringRef.current = false
      setRestoreVersion((v) => v + 1)
      if (pending.length > 0) restoreRafRef.current = requestAnimationFrame(restoreBatch)
      else restoreRafRef.current = null
    }
    restoreRafRef.current = requestAnimationFrame(restoreBatch)
    return () => {
      if (restoreRafRef.current !== null) cancelAnimationFrame(restoreRafRef.current)
      restoreRafRef.current = null
    }
  }, [simplifyContent])

  const warmMount = useCallback(
    (nodeId: string | undefined) => {
      if (!deferEnabled || !nodeId || alwaysMountIds.has(nodeId)) return
      setWarmIds((prev) => {
        if (prev.has(nodeId)) return prev
        const next = new Set(prev)
        next.add(nodeId)
        return next
      })
    },
    [deferEnabled, alwaysMountIds]
  )

  const shouldMountContent = useCallback(
    (nodeId: string | undefined) => {
      if (!deferEnabled || !nodeId) return true
      if (alwaysMountIds.has(nodeId)) return true
      if (warmIds.has(nodeId)) return true
      if (simplifyContent) return false
      if (restoringRef.current && !restoredIdsRef.current.has(nodeId)) return false
      void nearVersion // Subscribe to near-viewport updates
      void restoreVersion // Subscribe to progressive full-content restoration
      return nearRef.current.has(nodeId)
    },
    [deferEnabled, alwaysMountIds, warmIds, simplifyContent, nearVersion, restoreVersion]
  )

  const value = useMemo(
    () => ({ deferEnabled, shouldMountContent, warmMount }),
    [deferEnabled, shouldMountContent, warmMount]
  )

  return (
    <FrameViewportMountContext.Provider value={value}>{children}</FrameViewportMountContext.Provider>
  )
}

export { FRAME_VIEWPORT_DEFER_MIN }
