import type { XYPosition } from 'reactflow';

import type { ControlPointData } from '../ControlPoint';

export const isControlPoint = (
  point: ControlPointData | XYPosition,
): point is ControlPointData => 'id' in point;
