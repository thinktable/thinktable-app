import {
  Box,
  InternalNode,
  Node,
  NodeDimensionChange,
  NodePositionChange,
} from 'reactflow';
import { ANCHORS, SNAP_RADIUS } from './config';
import {
  Anchor,
  AnchorMatch,
  CandidateLine,
  HelperLine,
  Orientation,
} from './types';

const isInViewport = (a: Box, b: Box) =>
  a.x < b.x2 && a.x2 > b.x && a.y < b.y2 && a.y2 > b.y;

// =============== Sorted Vector Index Implementation ===============

function overlapArea(a: Box, b: Box): number {
  const xOverlap = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y, b.y));
  return xOverlap * yOverlap;
}

function boxDistance(a: Box, b: Box): number {
  const dx = Math.max(0, Math.max(a.x - b.x2, b.x - a.x2));
  const dy = Math.max(0, Math.max(a.y - b.y2, b.y - a.y2));
  return Math.sqrt(dx * dx + dy * dy);
}

export class SpatialIndex {
  private xLines: HelperLine[] = [];
  private yLines: HelperLine[] = [];
  // Store the last used line for each orientation to help with stability.
  private lastHorizontalLine: HelperLine | undefined;
  private lastVerticalLine: HelperLine | undefined;

  initialize(helperLines: HelperLine[]): void {
    this.xLines = helperLines.filter((line) => line.orientation === 'vertical');
    this.yLines = helperLines.filter(
      (line) => line.orientation === 'horizontal',
    );
    // Sort lines in place by position
    this.xLines.sort((a, b) => a.position - b.position);
    this.yLines.sort((a, b) => a.position - b.position);
    // Reset last lines when rebuilding the index
    this.lastHorizontalLine = undefined;
    this.lastVerticalLine = undefined;
  }

  search(
    orientation: Orientation,
    pos: number,
    node: Node,
    viewportBox: Box,
  ): HelperLine | undefined {
    // Select lines of the correct orientation
    // assume that the lines are sorted by position
    const lines = orientation === 'horizontal' ? this.yLines : this.xLines;
    const [viewportMin, viewportMax] =
      orientation === 'horizontal'
        ? [viewportBox.y, viewportBox.y2]
        : [viewportBox.x, viewportBox.x2];

    // We collect all candidate lines that are within `SNAP_RADIUS`
    const candidates: CandidateLine[] = [];

    for (const line of lines) {
      if (line.position < viewportMin) continue;
      if (line.position > viewportMax) break;
      if (line.node.id === node.id || line.node.parentId === node.id) continue;
      if (!isInViewport(line.nodeBox, viewportBox)) continue;

      // If we found a line that is within the viewport and not related to the dragged node,
      // we calculate its distance from the current position and check if it is within the SNAP_RADIUS.

      const lineDist = Math.abs(line.position - pos);
      if (lineDist > SNAP_RADIUS) continue;

      // Compute box from node for comparison
      const nodeBox: Box = {
        x: node.position.x,
        y: node.position.y,
        x2: node.position.x + (node.width || node.measured?.width || 0),
        y2: node.position.y + (node.height || node.measured?.height || 0),
      };
      const overlap = overlapArea(line.nodeBox, nodeBox);
      const nodeDist = overlap > 0 ? 0 : boxDistance(line.nodeBox, nodeBox);
      candidates.push({ line, lineDist, nodeDist });
    }

    // Once we have collected all candidates,
    // we need to find the best one based on the distance to the anchor position.
    // We prioritize lineDist over nodeDist to prevent hysteresis jittering.
    // We add a small hysteresis buffer (1px) to prevent rapid switching between candidates.
    const HYSTERESIS_BUFFER = 0.5;
    const lastLine =
      orientation === 'horizontal'
        ? this.lastHorizontalLine
        : this.lastVerticalLine;

    candidates.sort((a, b) => {
      // Give preference to the last used line if it's still a valid candidate
      if (lastLine) {
        if (a.line === lastLine && b.line !== lastLine) return -1;
        if (b.line === lastLine && a.line !== lastLine) return 1;
      }

      // If line distances are very close (within hysteresis buffer), prefer the one with smaller node distance
      if (Math.abs(a.lineDist - b.lineDist) <= HYSTERESIS_BUFFER) {
        return a.nodeDist - b.nodeDist;
      }
      // Otherwise, prioritize line distance for more stable snapping
      return a.lineDist - b.lineDist;
    });

    const bestLine = candidates.length > 0 ? candidates[0].line : undefined;

    // Store the last used line for this orientation to help with stability
    if (bestLine) {
      if (orientation === 'horizontal') {
        this.lastHorizontalLine = bestLine;
      } else {
        this.lastVerticalLine = bestLine;
      }
    }

    return bestLine;
  }
}

// =============== Helper line rebuilding ===============

// Helper function to compute box from an InternalNode (reactflow v11 doesn't export nodeToBox)
function nodeToBox(internalNode: InternalNode): Box {
  // Try to get position from internals.positionAbsolute, internals.position, or position
  const positionAbsolute = internalNode.internals?.positionAbsolute;
  const positionInternal = internalNode.internals?.position;
  const positionDirect = internalNode.position;
  const position = positionAbsolute || positionInternal || positionDirect || { x: 0, y: 0 };
  
  const width = internalNode.width || internalNode.measured?.width || 0;
  const height = internalNode.height || internalNode.measured?.height || 0;
  return {
    x: position.x,
    y: position.y,
    x2: position.x + width,
    y2: position.y + height,
  };
}

// Helper function to compute box from a Node (when InternalNode is not available)
function nodeToBoxFromNode(node: Node): Box {
  const width = node.width || node.measured?.width || 0;
  const height = node.height || node.measured?.height || 0;
  const x = node.position.x;
  const y = node.position.y;
  return {
    x,
    y,
    x2: x + width,
    y2: y + height,
  };
}

// Builds helper lines for the given nodes based on their positions and dimensions.
export function buildHelperLines(
  nodes: Node[],
  anchors: Record<string, Anchor> = ANCHORS,
  getInternalNode: (id: string) => InternalNode | undefined,
): HelperLine[] {
  const helperLines: HelperLine[] = [];

  nodes.forEach((node) => {
    // Try to get internal node first, fall back to computing from node
    const internalNode = getInternalNode(node.id);
    let nodeBox: Box;
    
    if (internalNode) {
      nodeBox = nodeToBox(internalNode);
    } else {
      // Fallback: compute box from node directly
      nodeBox = nodeToBoxFromNode(node);
    }
    
    Object.entries(anchors).forEach(([anchorName, anchor]) => {
      helperLines.push({
        nodeBox,
        node,
        orientation: anchor.orientation,
        position: anchor.resolve(node, nodeBox),
        color: node.style?.backgroundColor,
        anchorName,
      });
    });
  });

  return helperLines;
}

// =============== Helper Line Searching ===============

export function getHelperLines(
  spatialIndex: SpatialIndex,
  viewportBox: Box,
  node: Node,
  nodeBox: Box,
  validAnchors: (keyof typeof ANCHORS)[] = Object.keys(
    ANCHORS,
  ) as (keyof typeof ANCHORS)[],
): { horizontal: AnchorMatch | undefined; vertical: AnchorMatch | undefined } {
  const candidateAnchors: AnchorMatch[] = [];

  // For each available anchor point.
  for (const anchorName of validAnchors) {
    const anchor = ANCHORS[anchorName];
    // Retrieve the absolute position of the anchor, when applied to the dragged node.
    const pos = anchor.resolve(node, nodeBox);

    const line = spatialIndex.search(
      anchor.orientation,
      pos,
      node,
      viewportBox,
    );
    // If we found a closest line. We can add it to the candidate anchors.
    if (line) {
      candidateAnchors.push({
        anchorName,
        sourcePosition: pos,
        anchor,
        line,
      });
    }
  }

  const result: {
    horizontal: AnchorMatch | undefined;
    vertical: AnchorMatch | undefined;
  } = {
    horizontal: undefined,
    vertical: undefined,
  };

  // Let's go through the candidate anchors and find the closest one for each orientation.
  // We prioritize edge-to-edge snapping (prevents overlap) over same-edge snapping.
  for (const anchorMatch of candidateAnchors) {
    const current = result[anchorMatch.anchor.orientation];
    // The distance we need to consider, is the absolute difference
    // between the anchor position (on the dragged node) and the line position.
    const dist = Math.abs(
      anchorMatch.sourcePosition - anchorMatch.line.position,
    );
    
    if (!current) {
      result[anchorMatch.anchor.orientation] = anchorMatch;
      continue;
    }
    
    const currentDist = Math.abs(current.sourcePosition - current.line.position);
    
    // Prefer edge-to-edge snapping to prevent overlap
    // For horizontal: prefer bottom-to-top or top-to-bottom over same-edge
    // For vertical: prefer right-to-left or left-to-right over same-edge
    const isEdgeToEdge = 
      (anchorMatch.anchor.orientation === 'horizontal' && 
       ((anchorMatch.anchorName === 'bottom' && anchorMatch.line.anchorName === 'top') ||
        (anchorMatch.anchorName === 'top' && anchorMatch.line.anchorName === 'bottom'))) ||
      (anchorMatch.anchor.orientation === 'vertical' && 
       ((anchorMatch.anchorName === 'right' && anchorMatch.line.anchorName === 'left') ||
        (anchorMatch.anchorName === 'left' && anchorMatch.line.anchorName === 'right')));
    
    const currentIsEdgeToEdge =
      (current.anchor.orientation === 'horizontal' && 
       ((current.anchorName === 'bottom' && current.line.anchorName === 'top') ||
        (current.anchorName === 'top' && current.line.anchorName === 'bottom'))) ||
      (current.anchor.orientation === 'vertical' && 
       ((current.anchorName === 'right' && current.line.anchorName === 'left') ||
        (current.anchorName === 'left' && current.line.anchorName === 'right')));
    
    // If distances are similar (within 2px), prefer edge-to-edge
    const distDiff = Math.abs(dist - currentDist);
    if (distDiff <= 2) {
      if (isEdgeToEdge && !currentIsEdgeToEdge) {
        result[anchorMatch.anchor.orientation] = anchorMatch;
        continue;
      }
      if (!isEdgeToEdge && currentIsEdgeToEdge) {
        continue; // Keep current edge-to-edge match
      }
    }
    
    // Otherwise, prefer the closer match
    if (dist < currentDist) {
      result[anchorMatch.anchor.orientation] = anchorMatch;
    }
  }

  return result;
}

// =============== Snapping Nodes to Helper Lines ===============

export function snapToHelperLines(
  node: Node,
  internalNode: InternalNode,
  snapChange: NodePositionChange,
  positionChange?: NodePositionChange,
  dimensionChange?: NodeDimensionChange,
  parentNode?: InternalNode,
  hMatch?: AnchorMatch,
  vMatch?: AnchorMatch,
  nodeBox?: Box,
): { snappedX: boolean; snappedY: boolean } {
  if (!snapChange?.position) {
    return { snappedX: false, snappedY: false };
  }
  let snappedX = false;
  let snappedY = false;

  // Use nodeBox if provided (more accurate), otherwise fall back to measured dimensions
  const nodeWidth = nodeBox ? (nodeBox.x2 - nodeBox.x) : (node.width || node.measured?.width || 0);
  const nodeHeight = nodeBox ? (nodeBox.y2 - nodeBox.y) : (node.height || node.measured?.height || 0);
  
  const positionBounds = {
    x: snapChange.position.x,
    y: snapChange.position.y,
    x2: snapChange.position.x + nodeWidth,
    y2: snapChange.position.y + nodeHeight,
  };

  // Get absolute position from internal node (handle different reactflow v11 structure)
  const absPosition = internalNode.internals?.positionAbsolute || 
                     internalNode.internals?.position || 
                     internalNode.position || 
                     { x: 0, y: 0 };

  // Y axis (vertical snapping)
  if (hMatch) {
    const anchorPosY = hMatch.anchor.resolve(node, positionBounds);
    const deltaY = anchorPosY - hMatch.line.position;
    if (Math.abs(deltaY) <= SNAP_RADIUS) {
      // Snap position (drag or top-edge resize)
      snapChange.position.y -= deltaY;
      if (dimensionChange?.dimensions) {
        if (positionChange) {
          // Resizing from top edge
          const bottom =
            absPosition.y +
            nodeHeight;
          dimensionChange.dimensions.height = bottom - hMatch.line.position;
        } else {
          // Resizing from bottom edge
          dimensionChange.dimensions.height =
            hMatch.line.position - absPosition.y;
        }
      }
      snappedY = true;
    }
  }

  // --- X axis (horizontal snapping) ---
  if (vMatch) {
    const anchorPosX = vMatch.anchor.resolve(node, positionBounds);
    const deltaX = anchorPosX - vMatch.line.position;
    if (Math.abs(deltaX) <= SNAP_RADIUS) {
      snapChange.position.x -= deltaX;
      if (dimensionChange?.dimensions) {
        if (positionChange) {
          // Resizing from left edge
          const right =
            absPosition.x +
            nodeWidth;
          dimensionChange.dimensions.width = right - vMatch.line.position;
        } else {
          // Resizing from right edge
          dimensionChange.dimensions.width =
            vMatch.line.position - absPosition.x;
        }
      }
      snappedX = true;
    }
  }

  // If the node is a child of another group node (Subflows),
  // we need to adjust the snap position to be relative to the parent node, as we just
  // used absolute positions to compute helper lines and snap positions.
  if (parentNode && (snappedX || snappedY)) {
    snapChange.position.x -= parentNode.position.x;
    snapChange.position.y -= parentNode.position.y;
  }

  return { snappedX, snappedY };
}

