'use client'

import { useStore } from 'reactflow' // Live connection drag position + node boxes

const NEAR_PAD_PX = 72 // Screen px outside the frame that still reveals connection indicators

/**
 * True when a thread is being dragged and this frame is a nearby snap candidate
 * (pointer near the frame box, or already snapped to one of its connection points).
 * Used to reveal connection simulators on approach without showing them on every frame.
 */
export function useIsNearThreadConnection(nodeId: string | undefined): boolean {
  return useStore((s) => {
    if (!nodeId || !s.connectionNodeId) return false // Idle — no thread drag
    if (s.connectionNodeId === nodeId) return false // Never highlight the drag's source frame
    if (s.connectionEndHandle?.nodeId === nodeId) return true // Actively snapped here

    const node = s.nodeInternals.get(nodeId)
    if (!node || node.hidden) return false

    const w = node.width ?? 0
    const h = node.height ?? 0
    if (w <= 0 || h <= 0) return false

    const abs = node.positionAbsolute ?? node.position // Flow-space top-left
    const [tx, ty, zoom] = s.transform
    const z = zoom || 1
    // Convert node box to pane-local px (same space as connectionPosition)
    const left = abs.x * z + tx
    const top = abs.y * z + ty
    const right = (abs.x + w) * z + tx
    const bottom = (abs.y + h) * z + ty
    // Screen pad only (connectionRadius is flow-units — don't mix). Match ConnectionIndicator.
    const pad = NEAR_PAD_PX
    const { x: cx, y: cy } = s.connectionPosition
    return cx >= left - pad && cx <= right + pad && cy >= top - pad && cy <= bottom + pad
  })
}
