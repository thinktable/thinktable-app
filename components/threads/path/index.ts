import { type XYPosition, Position } from 'reactflow' // RF positions for end-side bias

import type { ControlPointData } from '../ControlPoint' // Active + inactive control points
import { getLinearPath, getLinearControlPoints } from './linear' // Straight-segment fallback
import { getCatmullRomPath, getCatmullRomControlPoints } from './catmull-rom' // Smooth Miro-like curves
import { ThreadAlgorithm } from '../constants' // Which path math to use

/** Compute inactive (addable) + active control points along the thread. */
export function getControlPoints({
  points,
  algorithm = ThreadAlgorithm.BezierCatmullRom,
  sides = { fromSide: Position.Left, toSide: Position.Right },
}: {
  points: (ControlPointData | XYPosition)[]
  algorithm?: ThreadAlgorithm
  sides?: { fromSide: Position; toSide: Position }
}) {
  switch (algorithm) {
    case ThreadAlgorithm.Linear:
      return getLinearControlPoints(points)
    case ThreadAlgorithm.CatmullRom:
      return getCatmullRomControlPoints(points)
    case ThreadAlgorithm.BezierCatmullRom:
    default:
      return getCatmullRomControlPoints(points, true, sides) // Bias ends toward handle sides
  }
}

/** Build an SVG path `d` through the given points. */
export function getPath({
  points,
  algorithm = ThreadAlgorithm.BezierCatmullRom,
  sides = { fromSide: Position.Left, toSide: Position.Right },
}: {
  points: (ControlPointData | XYPosition)[]
  algorithm?: ThreadAlgorithm
  sides?: { fromSide: Position; toSide: Position }
}) {
  switch (algorithm) {
    case ThreadAlgorithm.Linear:
      return getLinearPath(points)
    case ThreadAlgorithm.CatmullRom:
      return getCatmullRomPath(points)
    case ThreadAlgorithm.BezierCatmullRom:
    default:
      return getCatmullRomPath(points, true, sides)
  }
}
