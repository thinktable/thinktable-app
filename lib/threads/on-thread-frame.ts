// Frames anchored on a thread path (FigJam-style insert on connector).

import type { Edge, Node, XYPosition } from 'reactflow'
import type { SupabaseClient } from '@supabase/supabase-js'
import { migrateLegacyBlockFlags } from '@/lib/blocks'
import {
  geometryForEdge,
  positionForOnThreadFrame,
  type ThreadPathGeometry,
} from '@/lib/threads/thread-path-geometry'

/** Persisted on message.metadata — parametric position along a thread. */
export type OnThreadMeta = {
  sourceMessageId: string // panel_edges source_message_id
  targetMessageId: string // panel_edges target_message_id
  t: number // 0..1 along the thread from source → target
  /** Flow px from path point to frame center when offset beside the thread; 0/omit = inline on path. */
  offset?: number
  /** Unit normal (path → frame) when offset; stable side while sliding along t. */
  normalX?: number
  normalY?: number
}

export const ON_THREAD_DEFAULT_SIZE = { width: 72, height: 32 } // Empty locked frame hug
/** Perpendicular drag past this (flow px) snaps the frame beside the thread. */
export const ON_THREAD_PERP_THRESHOLD = 12
/** Gap between thread stroke and frame edge when offset. */
export const ON_THREAD_EDGE_GAP = 8
/** Dot radius on the thread when a frame is offset (flow px). */
export const ON_THREAD_DOT_R = 4

export function isOnThreadInline(anchor: OnThreadMeta): boolean {
  return (anchor.offset ?? 0) <= 0
}

/** Center offset from the path point for a frame sitting beside the thread. */
export function onThreadSnapOffset(size: { width: number; height: number }): number {
  return Math.max(size.width, size.height) / 2 + ON_THREAD_EDGE_GAP
}

/** Stable size for path projection — avoid nodeFlowSize 280×160 fallback oscillation. */
export function onThreadFrameSize(node: Node): { width: number; height: number } {
  const w =
    typeof node.width === 'number' && node.width > 0
      ? node.width
      : typeof node.style?.width === 'number' && node.style.width > 0
        ? node.style.width
        : ON_THREAD_DEFAULT_SIZE.width
  const h =
    typeof node.height === 'number' && node.height > 0
      ? node.height
      : typeof node.style?.height === 'number' && node.style.height > 0
        ? node.style.height
        : ON_THREAD_DEFAULT_SIZE.height
  return { width: w, height: h }
}

/** Hash endpoint geometry for edges that carry on-thread frames (not whole nodes array). */
export function onThreadPathSyncKey(edges: Edge[], nodes: Node[]): string {
  const parts: string[] = []
  for (const edge of edges) {
    if (edge.type === 'placeholder') continue
    const src = nodes.find((n) => n.id === edge.source)
    const tgt = nodes.find((n) => n.id === edge.target)
    if (!src || !tgt) continue
    const hasAttached = nodes.some((n) => {
      const a = readOnThread(n.data?.promptMessage?.metadata as Record<string, unknown>)
      return a && onThreadMatchesEdge(a, edge, nodes)
    })
    if (!hasAttached) continue
    const data = edge.data as { algorithm?: string; points?: unknown[] } | undefined
    parts.push(
      [
        edge.id,
        Math.round(src.position.x),
        Math.round(src.position.y),
        Math.round(tgt.position.x),
        Math.round(tgt.position.y),
        edge.sourceHandle ?? '',
        edge.targetHandle ?? '',
        data?.algorithm ?? '',
        JSON.stringify(data?.points ?? []),
      ].join(',')
    )
  }
  return parts.join(';')
}

/** Read on-thread anchor from frame metadata, if any. */
export function readOnThread(meta?: Record<string, unknown> | null): OnThreadMeta | null {
  if (!meta || typeof meta !== 'object') return null
  const raw = meta.onThread as Partial<OnThreadMeta> | undefined
  if (!raw) return null
  if (typeof raw.sourceMessageId !== 'string' || typeof raw.targetMessageId !== 'string') return null
  if (typeof raw.t !== 'number' || !Number.isFinite(raw.t)) return null
  const anchor: OnThreadMeta = {
    sourceMessageId: raw.sourceMessageId,
    targetMessageId: raw.targetMessageId,
    t: Math.min(1, Math.max(0, raw.t)),
  }
  if (typeof raw.offset === 'number' && raw.offset > 0) {
    anchor.offset = raw.offset
    if (typeof raw.normalX === 'number' && typeof raw.normalY === 'number') {
      anchor.normalX = raw.normalX
      anchor.normalY = raw.normalY
    }
  }
  return anchor
}

/** True when this frame sits on the given thread edge (same message pair + direction). */
export function onThreadMatchesEdge(anchor: OnThreadMeta, edge: Edge, nodes: Node[]): boolean {
  const src = nodes.find((n) => n.id === edge.source)
  const tgt = nodes.find((n) => n.id === edge.target)
  const srcMsg = src?.data?.promptMessage?.id as string | undefined
  const tgtMsg = tgt?.data?.promptMessage?.id as string | undefined
  if (!srcMsg || !tgtMsg) return false
  return srcMsg === anchor.sourceMessageId && tgtMsg === anchor.targetMessageId
}

/** Find the RF edge for an on-thread anchor. */
export function findEdgeForOnThread(
  edges: Edge[],
  nodes: Node[],
  anchor: OnThreadMeta
): Edge | null {
  for (const edge of edges) {
    if (edge.type === 'placeholder') continue
    if (onThreadMatchesEdge(anchor, edge, nodes)) return edge
  }
  return null
}

/** Project drag onto the thread (slide inline) or snap beside it (perpendicular pull). */
export function projectFrameOntoThreadPath(
  edges: Edge[],
  nodes: Node[],
  node: Node,
  proposedTopLeft: XYPosition
): { position: XYPosition; anchor: OnThreadMeta } | null {
  const anchor = readOnThread(node.data?.promptMessage?.metadata as Record<string, unknown>)
  if (!anchor) return null
  const edge = findEdgeForOnThread(edges, nodes, anchor)
  if (!edge) return null
  const geom = geometryForEdge(edge, nodes)
  if (!geom) return null
  const size = onThreadFrameSize(node)
  const cx = proposedTopLeft.x + size.width / 2
  const cy = proposedTopLeft.y + size.height / 2
  const closest = geom.closestT(cx, cy)
  const tan = geom.tangentAt(closest.t)
  const vx = cx - closest.point.x
  const vy = cy - closest.point.y
  const perp = vx * -tan.y + vy * tan.x // Signed distance along left normal
  const perpAbs = Math.abs(perp)
  const wasOffset = (anchor.offset ?? 0) > 0

  // Drag back onto the thread — inline gap mode
  if (wasOffset && perpAbs < ON_THREAD_PERP_THRESHOLD * 0.65) {
    const nextAnchor: OnThreadMeta = {
      sourceMessageId: anchor.sourceMessageId,
      targetMessageId: anchor.targetMessageId,
      t: closest.t,
    }
    return {
      position: positionForOnThreadFrame(geom, nextAnchor, size),
      anchor: nextAnchor,
    }
  }

  // Beside the thread — dot on path, frame offset perpendicular
  if (wasOffset || perpAbs > ON_THREAD_PERP_THRESHOLD) {
    const side: 1 | -1 = perp >= 0 ? 1 : -1
    const normal =
      wasOffset && anchor.normalX != null && anchor.normalY != null
        ? { x: anchor.normalX, y: anchor.normalY }
        : geom.normalAt(closest.t, side)
    const offset = anchor.offset && anchor.offset > 0 ? anchor.offset : onThreadSnapOffset(size)
    const pathPt = geom.pointAt(closest.t)
    const nextAnchor: OnThreadMeta = {
      sourceMessageId: anchor.sourceMessageId,
      targetMessageId: anchor.targetMessageId,
      t: closest.t,
      offset,
      normalX: normal.x,
      normalY: normal.y,
    }
    return {
      position: {
        x: pathPt.x + normal.x * offset - size.width / 2,
        y: pathPt.y + normal.y * offset - size.height / 2,
      },
      anchor: nextAnchor,
    }
  }

  // Slide along the thread (inline)
  const nextAnchor: OnThreadMeta = {
    sourceMessageId: anchor.sourceMessageId,
    targetMessageId: anchor.targetMessageId,
    t: closest.t,
  }
  return {
    position: positionForOnThreadFrame(geom, nextAnchor, size),
    anchor: nextAnchor,
  }
}

/** Live gap center along the path — inline frames only (offset frames use anchor.t + dot). */
export function onThreadFrameGapT(geom: ThreadPathGeometry, node: Node): number | null {
  const anchor = readOnThread(node.data?.promptMessage?.metadata as Record<string, unknown>)
  if (!anchor || !isOnThreadInline(anchor)) return null
  const size = onThreadFrameSize(node)
  const cx = node.position.x + size.width / 2
  const cy = node.position.y + size.height / 2
  return geom.closestT(cx, cy).t
}

/** Patch promptMessage.metadata on an RF node (on-thread drag commit). */
export function patchNodeOnThreadMeta(
  node: Node,
  anchor: OnThreadMeta,
  abs: XYPosition
): Node {
  const pm = node.data?.promptMessage
  if (!pm) return node
  return {
    ...node,
    data: {
      ...node.data,
      promptMessage: {
        ...pm,
        metadata: {
          ...((pm.metadata as Record<string, unknown>) || {}),
          position: abs,
          onThread: {
            sourceMessageId: anchor.sourceMessageId,
            targetMessageId: anchor.targetMessageId,
            t: anchor.t,
            ...(anchor.offset && anchor.offset > 0
              ? { offset: anchor.offset, normalX: anchor.normalX, normalY: anchor.normalY }
              : {}),
          },
        },
      },
    },
  }
}

/** Center a frame box on a path point. */
export function frameTopLeftFromCenter(
  center: XYPosition,
  size: { width: number; height: number }
): XYPosition {
  return { x: center.x - size.width / 2, y: center.y - size.height / 2 }
}

/** List chatPanel nodes attached to a thread edge. */
export function onThreadFramesForEdge(edge: Edge, nodes: Node[]): Node[] {
  return nodes.filter((n) => {
    if (n.type !== 'chatPanel') return false
    const anchor = readOnThread(n.data?.promptMessage?.metadata as Record<string, unknown>)
    if (!anchor) return false
    return onThreadMatchesEdge(anchor, edge, nodes)
  })
}

/** Clear on-thread anchor but keep absolute position (thread deleted / frame dragged off). */
export async function detachOnThreadFrame(
  supabase: SupabaseClient,
  messageId: string,
  position: { x: number; y: number }
): Promise<void> {
  const { data: row } = await supabase
    .from('messages')
    .select('metadata')
    .eq('id', messageId)
    .maybeSingle()
  if (!row) return
  const { meta: migrated } = migrateLegacyBlockFlags((row.metadata as Record<string, unknown>) || {})
  // Widen to a record so `delete` on the optional anchor key type-checks.
  const next: Record<string, unknown> = { ...migrated, position }
  delete next.onThread
  await supabase.from('messages').update({ metadata: next }).eq('id', messageId)
}

/** Persist absolute position + on-thread param t. */
export async function persistOnThreadPlacement(
  supabase: SupabaseClient,
  opts: {
    messageId: string
    position: { x: number; y: number }
    onThread: OnThreadMeta
  }
): Promise<void> {
  const { data: row } = await supabase
    .from('messages')
    .select('metadata')
    .eq('id', opts.messageId)
    .maybeSingle()
  if (!row) return
  const { meta: migrated } = migrateLegacyBlockFlags((row.metadata as Record<string, unknown>) || {})
  await supabase
    .from('messages')
    .update({
      metadata: {
        ...migrated,
        isBlock: true,
        position: opts.position,
        onThread: {
          sourceMessageId: opts.onThread.sourceMessageId,
          targetMessageId: opts.onThread.targetMessageId,
          t: opts.onThread.t,
          ...(opts.onThread.offset && opts.onThread.offset > 0
            ? {
                offset: opts.onThread.offset,
                normalX: opts.onThread.normalX,
                normalY: opts.onThread.normalY,
              }
            : {}),
        },
      },
    })
    .eq('id', opts.messageId)
}
