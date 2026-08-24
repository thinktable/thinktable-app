// Frames anchored on a thread path (FigJam-style insert on connector).

import type { Edge, Node, XYPosition } from 'reactflow'
import type { SupabaseClient } from '@supabase/supabase-js'
import { migrateLegacyBlockFlags } from '@/lib/blocks'

/** Persisted on message.metadata — parametric position along a thread. */
export type OnThreadMeta = {
  sourceMessageId: string // panel_edges source_message_id
  targetMessageId: string // panel_edges target_message_id
  t: number // 0..1 along the thread from source → target
}

export const ON_THREAD_DEFAULT_SIZE = { width: 72, height: 32 } // Empty locked frame hug

/** Read on-thread anchor from frame metadata, if any. */
export function readOnThread(meta?: Record<string, unknown> | null): OnThreadMeta | null {
  if (!meta || typeof meta !== 'object') return null
  const raw = meta.onThread as Partial<OnThreadMeta> | undefined
  if (!raw) return null
  if (typeof raw.sourceMessageId !== 'string' || typeof raw.targetMessageId !== 'string') return null
  if (typeof raw.t !== 'number' || !Number.isFinite(raw.t)) return null
  return {
    sourceMessageId: raw.sourceMessageId,
    targetMessageId: raw.targetMessageId,
    t: Math.min(1, Math.max(0, raw.t)),
  }
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
        onThread: opts.onThread,
      },
    })
    .eq('id', opts.messageId)
}
