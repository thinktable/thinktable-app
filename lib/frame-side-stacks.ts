// Per-side stack trees on a frame’s upright adjust box (AABB).
// Each edge (top / right / bottom / left) can own an independent stack group.
// Legacy flat `stackGroupId` / `stackSide` / `stackIndex` migrate on read.

/** Side of the upright adjust box used for a stack tree. */
export type FrameStackSide = 'top' | 'right' | 'bottom' | 'left'

export type SideStackEntry = {
  groupId: string
  index: number
  anchor?: boolean
  expanded?: boolean
}

export type SideStacks = Partial<Record<FrameStackSide, SideStackEntry>>

export const FRAME_STACK_SIDES: FrameStackSide[] = ['top', 'right', 'bottom', 'left']

function isStackSide(v: unknown): v is FrameStackSide {
  return v === 'top' || v === 'right' || v === 'bottom' || v === 'left'
}

/** Read per-side stacks (migrates legacy single-stack fields). */
export function readSideStacks(meta?: Record<string, unknown> | null): SideStacks {
  if (!meta) return {}
  const raw = meta.sideStacks
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const out: SideStacks = {}
    for (const side of FRAME_STACK_SIDES) {
      const e = (raw as Record<string, unknown>)[side]
      if (!e || typeof e !== 'object') continue
      const rec = e as Record<string, unknown>
      if (typeof rec.groupId !== 'string') continue
      const index = typeof rec.index === 'number' ? rec.index : rec.anchor === true ? 0 : 99
      out[side] = {
        groupId: rec.groupId,
        index,
        ...(rec.anchor === true ? { anchor: true } : {}),
        ...(rec.expanded === true ? { expanded: true } : {}),
      }
    }
    if (Object.keys(out).length > 0) return out
  }
  // Legacy: one tree on one side
  if (typeof meta.stackGroupId === 'string' && isStackSide(meta.stackSide)) {
    const index =
      typeof meta.stackIndex === 'number'
        ? meta.stackIndex
        : meta.stackAnchor === true
          ? 0
          : 99
    return {
      [meta.stackSide]: {
        groupId: meta.stackGroupId,
        index,
        ...(meta.stackAnchor === true ? { anchor: true as const } : {}),
        ...(meta.stackExpanded === true ? { expanded: true as const } : {}),
      },
    }
  }
  return {}
}

/** Group ids currently locked for rigid drag (migrates legacy `snapLockGroupId`). */
export function readLockedGroupIds(meta?: Record<string, unknown> | null): string[] {
  if (!meta) return []
  if (Array.isArray(meta.snapLockedGroupIds)) {
    return meta.snapLockedGroupIds.filter((x): x is string => typeof x === 'string')
  }
  if (typeof meta.snapLockGroupId === 'string') return [meta.snapLockGroupId]
  return []
}

export function isGroupLocked(
  meta: Record<string, unknown> | null | undefined,
  groupId: string
): boolean {
  return readLockedGroupIds(meta).includes(groupId)
}

/** True when this frame participates in at least one locked stack tree. */
export function isSnapLockedMeta(meta?: Record<string, unknown> | null): boolean {
  if (!meta) return false
  const locked = readLockedGroupIds(meta)
  if (locked.length === 0) return false
  return Object.values(readSideStacks(meta)).some((e) => locked.includes(e.groupId))
}

/** Entry for `groupId` on whatever side key stores it. */
export function findStackEntry(
  meta: Record<string, unknown> | null | undefined,
  groupId: string
): { side: FrameStackSide; entry: SideStackEntry } | null {
  const stacks = readSideStacks(meta)
  for (const side of FRAME_STACK_SIDES) {
    const e = stacks[side]
    if (e?.groupId === groupId) return { side, entry: e }
  }
  return null
}

export function stackIndexInGroup(
  meta: Record<string, unknown> | null | undefined,
  groupId: string
): number {
  const found = findStackEntry(meta, groupId)
  if (!found) return 99
  if (found.entry.anchor) return 0
  return found.entry.index
}

/** Write `sideStacks` + lock list; clear legacy flat stack fields. */
export function writeSideStacks(
  meta: Record<string, unknown>,
  stacks: SideStacks,
  lockedGroupIds?: string[]
): Record<string, unknown> {
  const next = { ...meta }
  delete next.stackGroupId
  delete next.stackSide
  delete next.stackIndex
  delete next.stackExpanded
  delete next.stackAnchor
  delete next.snapLockGroupId
  const cleaned: SideStacks = {}
  for (const side of FRAME_STACK_SIDES) {
    const e = stacks[side]
    if (!e) continue
    cleaned[side] = { ...e }
  }
  if (Object.keys(cleaned).length === 0) delete next.sideStacks
  else next.sideStacks = cleaned
  const locks =
    lockedGroupIds ??
    readLockedGroupIds(meta).filter((id) =>
      Object.values(cleaned).some((e) => e.groupId === id)
    )
  if (locks.length === 0) delete next.snapLockedGroupIds
  else next.snapLockedGroupIds = locks
  return next
}

/** Set or clear one side’s stack entry (preserves other sides). */
export function setSideStackEntry(
  meta: Record<string, unknown>,
  side: FrameStackSide,
  entry: SideStackEntry | null,
  lockedGroupIds?: string[]
): Record<string, unknown> {
  const stacks = { ...readSideStacks(meta) }
  if (entry) stacks[side] = entry
  else delete stacks[side]
  return writeSideStacks(meta, stacks, lockedGroupIds)
}

/** Remove every side entry for `groupId`; drop that lock id. */
export function stripGroupFromMeta(
  meta: Record<string, unknown>,
  groupId: string
): Record<string, unknown> {
  const stacks = { ...readSideStacks(meta) }
  for (const side of FRAME_STACK_SIDES) {
    if (stacks[side]?.groupId === groupId) delete stacks[side]
  }
  const locks = readLockedGroupIds(meta).filter((id) => id !== groupId)
  return writeSideStacks(meta, stacks, locks)
}

/** Clear all stack trees and locks on this frame. */
export function stripAllStacks(meta: Record<string, unknown>): Record<string, unknown> {
  return writeSideStacks(meta, {}, [])
}

/** Patch one group’s entry fields (expanded / index / anchor) on the side that holds it. */
export function patchGroupEntry(
  meta: Record<string, unknown>,
  groupId: string,
  patch: Partial<SideStackEntry>
): Record<string, unknown> {
  const found = findStackEntry(meta, groupId)
  if (!found) return meta
  return setSideStackEntry(meta, found.side, { ...found.entry, ...patch })
}

/** Move a group’s membership from `fromSide` to `toSide` (directional Stack). */
export function rekeyGroupSide(
  meta: Record<string, unknown>,
  groupId: string,
  toSide: FrameStackSide,
  entry: SideStackEntry
): Record<string, unknown> {
  const stacks = { ...readSideStacks(meta) }
  for (const side of FRAME_STACK_SIDES) {
    if (stacks[side]?.groupId === groupId) delete stacks[side]
  }
  stacks[toSide] = entry
  return writeSideStacks(meta, stacks, readLockedGroupIds(meta))
}

/** Add / remove `groupId` from the lock list. */
export function setGroupLocked(
  meta: Record<string, unknown>,
  groupId: string,
  locked: boolean
): Record<string, unknown> {
  const locks = new Set(readLockedGroupIds(meta))
  if (locked) locks.add(groupId)
  else locks.delete(groupId)
  return writeSideStacks(meta, readSideStacks(meta), [...locks])
}

/** New group id for a host message on one adjust-box side. */
export function sideStackGroupId(hostMessageId: string, side: FrameStackSide): string {
  return `${hostMessageId}:${side}`
}

/** All group ids this frame belongs to. */
export function groupIdsOf(meta?: Record<string, unknown> | null): string[] {
  return Object.values(readSideStacks(meta)).map((e) => e.groupId)
}

/** Min stack index across sides (for z-order); null if not stacked. */
export function minStackIndex(meta?: Record<string, unknown> | null): number | null {
  const entries = Object.values(readSideStacks(meta))
  if (entries.length === 0) return null
  return Math.min(...entries.map((e) => (e.anchor ? 0 : e.index)))
}

/**
 * While a parent stack tree is collapsed, nested side-tree frames (e.g. C on A’s bottom
 * when A is stacked under B) store the parent group id here so they stay hidden on reload.
 */
export function setParentStackHidden(
  meta: Record<string, unknown>,
  parentGroupId: string | null
): Record<string, unknown> {
  const next = { ...meta }
  if (parentGroupId) next.parentStackHidden = parentGroupId
  else delete next.parentStackHidden
  return next
}

export function parentStackHiddenOf(meta?: Record<string, unknown> | null): string | null {
  if (!meta || typeof meta.parentStackHidden !== 'string') return null
  return meta.parentStackHidden
}

type StackGraphNode = { id: string; type?: string; data?: unknown }

function metaFromGraphNode(n: StackGraphNode): Record<string, unknown> {
  const data = n.data as { promptMessage?: { metadata?: unknown } } | undefined
  return (data?.promptMessage?.metadata || {}) as Record<string, unknown>
}

/**
 * Frames reachable from `seedIds` through other side-stack trees, excluding
 * `excludeGroupIds` (usually the parent stack being collapsed/opened).
 * Example: A attached right of B, C on A’s bottom → seeds [A], exclude [B:right] → [C].
 */
export function collectNestedSatelliteIds(
  nodes: StackGraphNode[],
  seedIds: Iterable<string>,
  excludeGroupIds: Iterable<string>
): string[] {
  const seedSet = new Set(seedIds)
  const exclude = new Set(excludeGroupIds)
  const metaById = new Map<string, Record<string, unknown>>()
  const byGroup = new Map<string, string[]>()
  for (const n of nodes) {
    if (n.type && n.type !== 'chatPanel') continue
    const meta = metaFromGraphNode(n)
    metaById.set(n.id, meta)
    for (const gid of groupIdsOf(meta)) {
      const list = byGroup.get(gid) || []
      list.push(n.id)
      byGroup.set(gid, list)
    }
  }
  const out = new Set<string>()
  const queue = [...seedSet]
  const visitedGroups = new Set<string>(exclude)
  while (queue.length > 0) {
    const id = queue.shift() as string
    const meta = metaById.get(id)
    if (!meta) continue
    for (const gid of groupIdsOf(meta)) {
      if (visitedGroups.has(gid)) continue
      visitedGroups.add(gid)
      for (const memberId of byGroup.get(gid) || []) {
        if (seedSet.has(memberId) || out.has(memberId)) continue
        out.add(memberId)
        queue.push(memberId)
      }
    }
  }
  return [...out]
}

/**
 * Which direct mate (in `mateIds`) owns `nodeId` via nested side trees?
 * Used so clicking a nested preview frame opens its owning mate.
 */
export function findOwningMateId(
  nodes: StackGraphNode[],
  nodeId: string,
  mateIds: Iterable<string>,
  excludeGroupIds: Iterable<string>
): string | null {
  const mateSet = new Set(mateIds)
  if (mateSet.has(nodeId)) return nodeId
  const exclude = new Set(excludeGroupIds)
  const metaById = new Map<string, Record<string, unknown>>()
  const byGroup = new Map<string, string[]>()
  for (const n of nodes) {
    if (n.type && n.type !== 'chatPanel') continue
    const meta = metaFromGraphNode(n)
    metaById.set(n.id, meta)
    for (const gid of groupIdsOf(meta)) {
      const list = byGroup.get(gid) || []
      list.push(n.id)
      byGroup.set(gid, list)
    }
  }
  const seen = new Set<string>([nodeId])
  const queue = [nodeId]
  const visitedGroups = new Set<string>(exclude)
  while (queue.length > 0) {
    const id = queue.shift() as string
    const meta = metaById.get(id)
    if (!meta) continue
    for (const gid of groupIdsOf(meta)) {
      if (visitedGroups.has(gid)) continue
      visitedGroups.add(gid)
      for (const memberId of byGroup.get(gid) || []) {
        if (mateSet.has(memberId)) return memberId
        if (seen.has(memberId)) continue
        seen.add(memberId)
        queue.push(memberId)
      }
    }
  }
  return null
}

