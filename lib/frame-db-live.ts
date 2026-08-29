// Focus-gated Notion DB tables on the board — only one live interactive table at a time.
// Zoom % is NOT used: frames can be expanded/shrunk so 40% zoom is meaningless for DBs.
// Idle / unfocused / pan-zoom → static preview; select / hover / edit → claim live slot.

import { useEffect, useSyncExternalStore } from 'react'
import {
  isBoardNavigating,
  subscribeBoardNavigating,
} from '@/lib/board-navigating'

/** At most one interactive Notion table on the board (canvas compositing tax). */
export const MAX_LIVE_DB_TABLES = 1

export type DbLiveRank = 'warm' | 'select' | 'edit'

const RANK: Record<DbLiveRank, number> = { warm: 1, select: 2, edit: 3 }

type Claim = { rank: number; at: number }

const claims = new Map<string, Claim>() // instanceId → highest claim
const listeners = new Set<() => void>()
const leaveTimers = new Map<string, ReturnType<typeof setTimeout>>()

let liveId: string | null = null

function notify(): void {
  listeners.forEach((l) => l())
}

function recomputeLive(): void {
  let bestId: string | null = null
  let bestRank = 0
  let bestAt = 0
  for (const [id, c] of claims) {
    if (c.rank > bestRank || (c.rank === bestRank && c.at >= bestAt)) {
      bestId = id
      bestRank = c.rank
      bestAt = c.at
    }
  }
  // Enforce single live table even if multiple claims exist at same rank
  if (MAX_LIVE_DB_TABLES < 1) bestId = null
  if (bestId === liveId) return
  liveId = bestId
  notify()
}

/** Claim the live table slot (select/edit beat warm; newer wins ties). */
export function claimDbLive(instanceId: string, rank: DbLiveRank): void {
  if (!instanceId) return
  const prev = leaveTimers.get(instanceId)
  if (prev) {
    clearTimeout(prev)
    leaveTimers.delete(instanceId)
  }
  const nextRank = RANK[rank]
  const cur = claims.get(instanceId)
  if (cur && cur.rank > nextRank) {
    cur.at = Date.now()
    recomputeLive()
    return
  }
  claims.set(instanceId, { rank: nextRank, at: Date.now() })
  recomputeLive()
}

/** Drop a claim; warm leave is delayed so pointer can cross chrome without flicker. */
export function releaseDbLive(
  instanceId: string,
  rank: DbLiveRank,
  opts?: { immediate?: boolean }
): void {
  if (!instanceId) return
  const cur = claims.get(instanceId)
  if (!cur) return
  if (RANK[rank] < cur.rank) return // Weaker release cannot clear select/edit

  const clear = () => {
    leaveTimers.delete(instanceId)
    const now = claims.get(instanceId)
    if (!now) return
    if (RANK[rank] < now.rank) return
    claims.delete(instanceId)
    recomputeLive()
  }

  if (opts?.immediate || rank !== 'warm') {
    const t = leaveTimers.get(instanceId)
    if (t) {
      clearTimeout(t)
      leaveTimers.delete(instanceId)
    }
    clear()
    return
  }

  const existing = leaveTimers.get(instanceId)
  if (existing) clearTimeout(existing)
  leaveTimers.set(instanceId, setTimeout(clear, 400))
}

export function getDbLiveId(): string | null {
  return liveId
}

export function subscribeDbLive(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * True when this DB instance should mount the interactive virtualized table.
 * False during board pan/zoom (static preview keeps size — no CSS hide pop).
 * Not gated on camera zoom %.
 */
export function useDbTableLive(instanceId: string | undefined): boolean {
  const live = useSyncExternalStore(subscribeDbLive, getDbLiveId, () => null)
  const navigating = useSyncExternalStore(
    subscribeBoardNavigating,
    isBoardNavigating,
    () => false
  )
  if (!instanceId || navigating) return false
  return live === instanceId
}

/** Bind select/warm claims for a databaseBlock NodeView. */
export function useDbLiveClaims(
  instanceId: string | undefined,
  frameSelected: boolean
): {
  onPointerEnter: () => void
  onPointerLeave: () => void
} {
  useEffect(() => {
    if (!instanceId) return
    if (frameSelected) claimDbLive(instanceId, 'select')
    else releaseDbLive(instanceId, 'select', { immediate: true })
    return () => releaseDbLive(instanceId, 'select', { immediate: true })
  }, [instanceId, frameSelected])

  useEffect(() => {
    return () => {
      if (!instanceId) return
      releaseDbLive(instanceId, 'warm', { immediate: true })
      releaseDbLive(instanceId, 'edit', { immediate: true })
    }
  }, [instanceId])

  return {
    onPointerEnter: () => {
      if (instanceId) claimDbLive(instanceId, 'warm')
    },
    onPointerLeave: () => {
      if (instanceId) releaseDbLive(instanceId, 'warm')
    },
  }
}
