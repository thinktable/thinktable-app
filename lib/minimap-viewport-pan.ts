import { zoomIdentity } from 'd3-zoom'
import { getBoundsOfRects, getNodesBounds, type ReactFlowState } from '@reactflow/core'

/** Same viewScale math as @reactflow/minimap (minimap px → viewport transform). */
export function computeMinimapViewScale(
  state: ReactFlowState,
  elementWidth: number,
  elementHeight: number
): number {
  const nodes = state.getNodes()
  const zoom = state.transform[2]
  const viewBB = {
    x: -state.transform[0] / zoom,
    y: -state.transform[1] / zoom,
    width: state.width / zoom,
    height: state.height / zoom,
  }
  const boundingRect =
    nodes.length > 0 ? getBoundsOfRects(getNodesBounds(nodes, state.nodeOrigin), viewBB) : viewBB
  const scaledWidth = boundingRect.width / elementWidth
  const scaledHeight = boundingRect.height / elementHeight
  return Math.max(scaledWidth, scaledHeight)
}

/** Pan the main viewport from a minimap drag (RF built-in pan only handles mousemove). */
export function panViewportFromMinimapDrag(
  state: ReactFlowState,
  movementX: number,
  movementY: number,
  viewScale: number,
  inversePan = false
): void {
  const { transform, d3Selection, d3Zoom, translateExtent, width, height } = state
  if (!d3Selection || !d3Zoom) return

  const moveScale = viewScale * Math.max(1, transform[2]) * (inversePan ? -1 : 1)
  const position = {
    x: transform[0] - movementX * moveScale,
    y: transform[1] - movementY * moveScale,
  }
  const extent: [[number, number], [number, number]] = [
    [0, 0],
    [width, height],
  ]
  const nextTransform = zoomIdentity.translate(position.x, position.y).scale(transform[2])
  const constrainedTransform = d3Zoom.constrain()(nextTransform, extent, translateExtent)
  d3Zoom.transform(d3Selection, constrainedTransform)
}
