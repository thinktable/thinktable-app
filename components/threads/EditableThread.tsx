import { useCallback, useEffect, useRef } from 'react' // Stable setters + sanitize indicator handle ids
import {
  BaseEdge,
  EdgeProps,
  Edge,
  useReactFlow,
  useStore,
  Position,
  type XYPosition,
} from 'reactflow' // Custom edge primitives + selection store

import { ControlPoint, type ControlPointData } from './ControlPoint' // Miro-style path knobs
import { getPath, getControlPoints } from './path' // Path math when user has bent the thread
import { getSmoothThreadBezier } from './path/bezier' // Same-side bow for unbent Smooth (snapped frames)
import {
  DEFAULT_THREAD_ALGORITHM,
  THREAD_DEFAULT_COLOR,
  THREAD_DEFAULT_STROKE_WIDTH,
  THREAD_SELECTED_COLOR,
  ThreadAlgorithm,
  threadComfortScale,
} from './constants' // Stroke + algorithm defaults + zoom comfort
import { navigationZoom } from '@/lib/board-navigating' // Freeze stroke mid-pinch
import { normalizeHandleId } from './handle-ids' // Strip -indicator from stored handle ids
import {
  connectionPointOnNode,
  sideFromHandleId,
} from './connection-point-on-node' // Frame-edge attach from node box

/** Persistable thread payload stored in panel_edges.metadata + edge.data. */
export type ThreadEdgeData = {
  algorithm?: ThreadAlgorithm // Path math (default BezierCatmullRom)
  points?: ControlPointData[] // Active control points between source and target
  dotted?: boolean // Optional dashed stroke (View toolbar)
  strokeWidth?: number // Thickness in flow px (1–4 from thread menu; default 2)
}

export type ThreadEdge = Edge<ThreadEdgeData>

/** Assign stable ids to inactive mid-points so React keys survive rerenders. */
const useIdsForInactiveControlPoints = (points: ControlPointData[]) => {
  const ids = useRef<string[]>([]) // Cached ids for the current inactive count

  if (ids.current.length === points.length) {
    return points.map((point, i) =>
      point.id ? point : { ...point, id: ids.current[i] }
    )
  }

  ids.current = []
  return points.map((point, i) => {
    if (!point.id) {
      const id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `cp-${i}-${Math.random().toString(36).slice(2)}`
      ids.current[i] = id
      return { ...point, id }
    }
    ids.current[i] = point.id
    return point
  })
}

type EditableThreadProps = EdgeProps<ThreadEdgeData>

/**
 * Miro-style editable thread.
 * Endpoints always come from the node frame edge (connection point) — never from outer indicators.
 */
export function EditableThread({
  id,
  selected,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  targetHandleId,
  markerEnd,
  markerStart,
  style,
  data,
}: EditableThreadProps) {
  const algorithm = data?.algorithm ?? DEFAULT_THREAD_ALGORITHM
  const points = data?.points ?? []
  const dotted = data?.dotted === true
  const strokeWidth = data?.strokeWidth ?? THREAD_DEFAULT_STROKE_WIDTH // Menu thickness (1–4px)
  const { setEdges } = useReactFlow()

  // Live node boxes — path attaches here even if RF's handle coords are still on an indicator
  const sourceNode = useStore((s) => s.nodeInternals.get(source))
  const targetNode = useStore((s) => s.nodeInternals.get(target))

  const sourceSide = sideFromHandleId(sourceHandleId, sourcePosition)
  const targetSide = sideFromHandleId(targetHandleId, targetPosition)

  const sourceOrigin: XYPosition =
    connectionPointOnNode(sourceNode, sourceSide) ?? { x: sourceX, y: sourceY }
  const targetOrigin: XYPosition =
    connectionPointOnNode(targetNode, targetSide) ?? { x: targetX, y: targetY }

  // Persist edge-anchor handle ids (strip *-indicator) so RF also prefers edge handles
  useEffect(() => {
    const nextSource = normalizeHandleId(sourceHandleId)
    const nextTarget = normalizeHandleId(targetHandleId)
    if (nextSource === sourceHandleId && nextTarget === targetHandleId) return
    setEdges((edges) =>
      edges.map((e) =>
        e.id !== id
          ? e
          : {
              ...e,
              sourceHandle: normalizeHandleId(e.sourceHandle) ?? e.sourceHandle,
              targetHandle: normalizeHandleId(e.targetHandle) ?? e.targetHandle,
            }
      )
    )
  }, [id, sourceHandleId, targetHandleId, setEdges])

  const shouldShowPoints = useStore((store) => {
    const src = store.nodeInternals.get(source)
    const tgt = store.nodeInternals.get(target)
    return Boolean(selected || src?.selected || tgt?.selected)
  })

  const isConnecting = useStore((s) => !!s.connectionNodeId)
  const zoom = useStore((s) =>
    navigationZoom(Math.round((s.transform[2] || 1) * 8) / 8)
  ) // Freeze mid-pinch — avoid edge re-renders every tick
  const comfort = threadComfortScale(zoom) // Thins on zoom-out; soft counter-scale on zoom-in
  const invZoom = 1 / Math.max(0.01, zoom) // Hit band stays ~screen-constant so thin threads remain clickable

  const setControlPoints = useCallback(
    (update: (pts: ControlPointData[]) => ControlPointData[]) => {
      setEdges((edges) =>
        edges.map((e) => {
          if (e.id !== id) return e
          const prev = (e.data as ThreadEdgeData | undefined)?.points ?? []
          return {
            ...e,
            data: {
              ...(e.data as ThreadEdgeData | undefined),
              algorithm,
              points: update(prev),
            },
          }
        })
      )
    },
    [setEdges, id, algorithm]
  )

  const fromSide = sourceSide ?? Position.Right
  const toSide = targetSide ?? Position.Left
  const sides = { fromSide, toSide }

  // Route for editable knobs (user bends). Unbent Smooth uses getSmoothThreadBezier below —
  // Catmull stubs added S-curves; RF getBezierPath went flat on same-side snapped frames.
  const routePoints = [sourceOrigin, ...points, targetOrigin]
  const unbentSmooth =
    points.length === 0 &&
    (algorithm === ThreadAlgorithm.BezierCatmullRom ||
      algorithm === ThreadAlgorithm.CatmullRom)
  const smoothBezier = unbentSmooth
    ? getSmoothThreadBezier({
        sourceX: sourceOrigin.x, // Frame-edge attach, not the outer indicator
        sourceY: sourceOrigin.y,
        sourcePosition: fromSide, // Snapped side (top↔top when frames sit left/right)
        targetX: targetOrigin.x,
        targetY: targetOrigin.y,
        targetPosition: toSide,
      })
    : null
  const controlPoints = unbentSmooth
    ? [{ id: '', active: false, x: smoothBezier!.mid.x, y: smoothBezier!.mid.y }] // Hollow knob on the arch, not the chord
    : getControlPoints({
        points: routePoints,
        algorithm,
        sides,
      })
  const controlPointsWithIds = useIdsForInactiveControlPoints(controlPoints)

  // Unbent Smooth → bowed cubic (same-side) / RF bezier (opposite). Bent / Sharp / Linear → waypoints.
  const path = smoothBezier
    ? smoothBezier.path
    : getPath({ points: routePoints, algorithm, sides })

  const stroke = selected ? THREAD_SELECTED_COLOR : (style?.stroke as string) || THREAD_DEFAULT_COLOR
  const baseWidth = selected ? Math.max(strokeWidth, strokeWidth + 0.5) : strokeWidth // Selected reads slightly heavier
  const dash = 5 * comfort // Dash/gap tracks stroke comfort (thins when zoomed out)

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={20 * invZoom} // Hit band stays ~20px on screen at any zoom
        style={{
          ...style,
          strokeWidth: baseWidth * comfort, // Comfort curve — not full 1/zoom (that looked fat zoomed out)
          stroke,
          strokeDasharray: dotted ? `${dash},${dash}` : undefined,
        }}
      />

      {shouldShowPoints &&
        !isConnecting &&
        controlPointsWithIds.map((point, index) => (
          <ControlPoint
            key={point.id}
            index={index}
            setControlPoints={setControlPoints}
            color={THREAD_SELECTED_COLOR}
            {...point}
          />
        ))}
    </>
  )
}

/** Type guard for thread edges that carry editable path data. */
export const isThreadEdge = (edge: Edge): edge is ThreadEdge =>
  edge.type === 'editable' || edge.type === 'animatedDotted'
