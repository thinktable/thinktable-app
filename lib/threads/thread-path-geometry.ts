// Sample thread paths for on-thread frame placement + stroke gaps.

import type { Edge, Node, XYPosition, Position } from 'reactflow'
import type { ControlPointData } from '@/components/threads/ControlPoint'
import type { ThreadEdgeData } from '@/components/threads/EditableThread'
import { getPath, getControlPoints } from '@/components/threads/path'
import { getSmoothThreadBezier } from '@/components/threads/path/bezier'
import {
  DEFAULT_THREAD_ALGORITHM,
  ThreadAlgorithm,
} from '@/components/threads/constants'
import {
  connectionPointOnNode,
  sideFromHandleId,
} from '@/components/threads/connection-point-on-node'
import type { OnThreadMeta } from '@/lib/threads/on-thread-frame'

export type ThreadPathGeometry = {
  pathD: string // Full SVG path
  length: number // Total arc length (flow px)
  pointAt: (t: number) => XYPosition // t in 0..1
  closestT: (x: number, y: number) => { t: number; point: XYPosition; distance: number }
  slicePath: (startT: number, endT: number) => string // Subpath for stroke gaps
}

type BuildArgs = {
  edge: Edge
  sourceNode?: Node
  targetNode?: Node
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
  sourceHandleId?: string | null
  targetHandleId?: string | null
}

/** Same routing as EditableThread — shared for placement + gap rendering. */
export function buildThreadPathGeometry(args: BuildArgs): ThreadPathGeometry {
  const data = (args.edge.data as ThreadEdgeData | undefined) || {}
  const algorithm = data.algorithm ?? DEFAULT_THREAD_ALGORITHM
  const points = data.points ?? []
  const sourceSide = sideFromHandleId(args.sourceHandleId, args.sourcePosition)
  const targetSide = sideFromHandleId(args.targetHandleId, args.targetPosition)
  const sourceOrigin: XYPosition =
    connectionPointOnNode(args.sourceNode, sourceSide) ?? {
      x: args.sourceX,
      y: args.sourceY,
    }
  const targetOrigin: XYPosition =
    connectionPointOnNode(args.targetNode, targetSide) ?? {
      x: args.targetX,
      y: args.targetY,
    }
  const fromSide = sourceSide ?? args.sourcePosition
  const toSide = targetSide ?? args.targetPosition
  const sides = { fromSide, toSide }
  const routePoints = [sourceOrigin, ...points, targetOrigin]
  const unbentSmooth =
    points.length === 0 &&
    (algorithm === ThreadAlgorithm.BezierCatmullRom ||
      algorithm === ThreadAlgorithm.CatmullRom)
  const pathD = unbentSmooth
    ? getSmoothThreadBezier({
        sourceX: sourceOrigin.x,
        sourceY: sourceOrigin.y,
        sourcePosition: fromSide,
        targetX: targetOrigin.x,
        targetY: targetOrigin.y,
        targetPosition: toSide,
      }).path
    : getPath({ points: routePoints, algorithm, sides })

  return geometryFromPathD(pathD, sourceOrigin, targetOrigin)
}

/** Build geometry from an RF edge + live nodes (on-thread drag / insert). */
export function geometryForEdge(edge: Edge, nodes: Node[]): ThreadPathGeometry | null {
  const sourceNode = nodes.find((n) => n.id === edge.source)
  const targetNode = nodes.find((n) => n.id === edge.target)
  if (!sourceNode || !targetNode) return null
  return buildThreadPathGeometry({
    edge,
    sourceNode,
    targetNode,
    sourceX: sourceNode.position.x,
    sourceY: sourceNode.position.y,
    targetX: targetNode.position.x,
    targetY: targetNode.position.y,
    sourcePosition: (edge.sourceHandle as Position) || ('right' as Position),
    targetPosition: (edge.targetHandle as Position) || ('left' as Position),
    sourceHandleId: edge.sourceHandle,
    targetHandleId: edge.targetHandle,
  })
}

function geometryFromPathD(
  pathD: string,
  fallbackA: XYPosition,
  fallbackB: XYPosition
): ThreadPathGeometry {
  if (typeof document === 'undefined') {
    return linearFallback(fallbackA, fallbackB)
  }
  const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  pathEl.setAttribute('d', pathD)
  let length = 0
  try {
    length = pathEl.getTotalLength()
  } catch {
    return linearFallback(fallbackA, fallbackB)
  }
  if (!Number.isFinite(length) || length < 1) {
    return linearFallback(fallbackA, fallbackB)
  }

  const pointAt = (t: number): XYPosition => {
    const clamped = Math.min(1, Math.max(0, t))
    return pathEl.getPointAtLength(clamped * length)
  }

  const closestT = (x: number, y: number) => {
    const steps = 64
    let bestT = 0.5
    let bestDist = Infinity
    let bestPoint = pointAt(0.5)
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const p = pointAt(t)
      const d = (p.x - x) ** 2 + (p.y - y) ** 2
      if (d < bestDist) {
        bestDist = d
        bestT = t
        bestPoint = p
      }
    }
    // Refine around the best bin
    const refineSteps = 16
    const span = 1 / steps
    let lo = Math.max(0, bestT - span)
    let hi = Math.min(1, bestT + span)
    for (let i = 0; i <= refineSteps; i++) {
      const t = lo + ((hi - lo) * i) / refineSteps
      const p = pointAt(t)
      const d = (p.x - x) ** 2 + (p.y - y) ** 2
      if (d < bestDist) {
        bestDist = d
        bestT = t
        bestPoint = p
      }
    }
    return { t: bestT, point: bestPoint, distance: Math.sqrt(bestDist) }
  }

  const slicePath = (startT: number, endT: number): string => {
    const a = Math.min(startT, endT)
    const b = Math.max(startT, endT)
    if (b - a < 0.001) return ''
    const startLen = a * length
    const endLen = b * length
    const step = Math.max(2, length / 120)
    const parts: string[] = []
    let first = true
    for (let len = startLen; len <= endLen + 0.01; len += step) {
      const p = pathEl.getPointAtLength(Math.min(len, endLen))
      parts.push(first ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)
      first = false
    }
    return parts.join(' ')
  }

  return { pathD, length, pointAt, closestT, slicePath }
}

function linearFallback(a: XYPosition, b: XYPosition): ThreadPathGeometry {
  const pathD = `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const pointAt = (t: number) => ({
    x: a.x + dx * Math.min(1, Math.max(0, t)),
    y: a.y + dy * Math.min(1, Math.max(0, t)),
  })
  const closestT = (x: number, y: number) => {
    const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / (len * len)))
    const point = pointAt(t)
    return { t, point, distance: Math.hypot(point.x - x, point.y - y) }
  }
  const slicePath = (startT: number, endT: number) => {
    const p0 = pointAt(startT)
    const p1 = pointAt(endT)
    return `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y}`
  }
  return { pathD, length: len, pointAt, closestT, slicePath }
}

/** Gap sizes along the path for frames sitting on the thread (flow px). */
export function threadGapsForFrames(
  geom: ThreadPathGeometry,
  frames: Array<{ t: number; width: number; height: number }>,
  pad = 6
): Array<{ startT: number; endT: number }> {
  const gaps: Array<{ startT: number; endT: number }> = []
  for (const frame of frames) {
    const half = (Math.max(frame.width, frame.height) + pad) / 2 / Math.max(geom.length, 1)
    gaps.push({
      startT: Math.max(0, frame.t - half),
      endT: Math.min(1, frame.t + half),
    })
  }
  return gaps.sort((a, b) => a.startT - b.startT)
}

/** Build one or more stroke paths with gaps where on-thread frames sit. */
export function threadStrokePaths(
  geom: ThreadPathGeometry,
  gaps: Array<{ startT: number; endT: number }>
): string[] {
  if (gaps.length === 0) return [geom.pathD]
  const merged: Array<{ startT: number; endT: number }> = []
  for (const gap of gaps) {
    const last = merged[merged.length - 1]
    if (last && gap.startT <= last.endT) {
      last.endT = Math.max(last.endT, gap.endT)
    } else {
      merged.push({ ...gap })
    }
  }
  const segments: string[] = []
  let cursor = 0
  for (const gap of merged) {
    if (gap.startT > cursor + 0.001) {
      const seg = geom.slicePath(cursor, gap.startT)
      if (seg) segments.push(seg)
    }
    cursor = gap.endT
  }
  if (cursor < 0.999) {
    const seg = geom.slicePath(cursor, 1)
    if (seg) segments.push(seg)
  }
  return segments.length > 0 ? segments : [geom.pathD]
}

/** Resolve placement for an on-thread frame from its anchor. */
export function positionForOnThreadFrame(
  geom: ThreadPathGeometry,
  anchor: OnThreadMeta,
  size: { width: number; height: number }
): XYPosition {
  const center = geom.pointAt(anchor.t)
  return {
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
  }
}
