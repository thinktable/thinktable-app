import {
  Box,
  Node,
  useReactFlow,
  useStore,
  InternalNode,
} from 'reactflow';
import {
  NodeChange,
  NodeDimensionChange,
  NodePositionChange,
} from 'reactflow';
import { useCallback, useEffect, useRef, useState } from 'react';
import { shallow } from 'zustand/shallow';
import HelperLinesRenderer from './HelperLinesRenderer';
import { HelperLine } from './types';
import {
  buildHelperLines,
  getHelperLines,
  snapToHelperLines,
  SpatialIndex,
} from './utils';
import { ANCHORS } from './config';

// =============== Main Hook ===============

export function useHelperLines(enabled: boolean = true) {
  const [helperLineHorizontal, setHelperLineHorizontal] = useState<
    HelperLine | undefined
  >(undefined);
  const [helperLineVertical, setHelperLineVertical] = useState<
    HelperLine | undefined
  >(undefined);

  const { width, height } = useStore(
    (state) => ({ width: state.width, height: state.height }),
    shallow,
  );

  // Get internal nodes from store (reactflow v11 doesn't have getInternalNode in useReactFlow)
  // Try to access nodeLookup from store, but handle gracefully if it doesn't exist
  const nodeLookupRef = useRef<Map<string, InternalNode> | undefined>(undefined);
  
  // Subscribe to store and try to get nodeLookup
  // In reactflow v11, internal nodes might be stored differently or not directly accessible
  useStore((state: any) => {
    // Try common property names for internal node storage
    const lookup = state.nodeLookup || state.nodeInternals || state.nodesInternals || state.internalNodes;
    if (lookup && typeof lookup.get === 'function') {
      nodeLookupRef.current = lookup;
    }
    return lookup;
  });
  
  const getInternalNodeFromStore = useCallback(
    (id: string): InternalNode | undefined => {
      // Return undefined if nodeLookup is not available - buildHelperLines will fall back to computing from node
      if (!nodeLookupRef.current) {
        return undefined;
      }
      return nodeLookupRef.current.get(id);
    },
    []
  );

  const { getNodes, screenToFlowPosition } = useReactFlow();

  const spatialIndexRef = useRef<SpatialIndex>(new SpatialIndex());
  const nodesInitializedRef = useRef(false);

  const resetHelperLines = useCallback(() => {
    setHelperLineHorizontal(undefined);
    setHelperLineVertical(undefined);
  }, []);

  const rebuildIndex = useCallback(
    (nodes: Node[]) => {
      if (!enabled) return;
      resetHelperLines();
      const helperLines = buildHelperLines(nodes, ANCHORS, getInternalNodeFromStore);
      spatialIndexRef.current.initialize(helperLines);
    },
    [getInternalNodeFromStore, resetHelperLines, enabled],
  );

  // Rebuild the spatial index when nodes are initialized or change
  useEffect(() => {
    if (!enabled) return;
    const nodes = getNodes();
    if (nodes.length > 0) {
      nodesInitializedRef.current = true;
      rebuildIndex(nodes);
    }
  }, [enabled, rebuildIndex, getNodes]);

  const updateHelperLines = useCallback(
    (changes: NodeChange[], nodes: Node[]): NodeChange[] => {
      // If helper lines are disabled, return changes as-is
      if (!enabled || !spatialIndexRef.current) {
        return changes;
      }

      // We only want to consider three possible cases:
      // 1. A single node is being dragged (position change)
      // 2. A node is being resized from a bottom or right corner (dimensions change)
      // 3. A node is being resized from a top or left corner (position and dimensions change)
      if (changes.length === 0 || changes.length > 2) {
        return changes;
      }

      resetHelperLines();

      let positionChange: NodePositionChange | undefined;
      let dimensionChange: NodeDimensionChange | undefined;
      let anchors: (keyof typeof ANCHORS)[] = Object.keys(ANCHORS);

      if (changes.length === 1) {
        // If we have a single change, it can be either a position or dimensions change
        if (changes[0].type === 'position') {
          // The node is being dragged, thus we can use all anchors for the helper lines
          positionChange = changes[0] as NodePositionChange;
        } else if (changes[0].type === 'dimensions') {
          // The node is being resized from a bottom or right corner
          dimensionChange = changes[0] as NodeDimensionChange;
          anchors = ['right', 'bottom'];
        }
      } else {
        // If we have two changes, and we are resizing a node, one must be position and the other dimensions
        // This means the node is being resized from a top or left corner.

        if (
          changes[0].type === 'position' &&
          changes[1].type === 'dimensions' &&
          changes[1].dimensions
        ) {
          positionChange = changes[0] as NodePositionChange;
          dimensionChange = changes[1] as NodeDimensionChange;
          anchors = ['top', 'left'];
        }
      }

      const node = nodes.find(
        (node) => node.id === (changes[0] as NodePositionChange).id,
      );

      if (!node) {
        return changes;
      }

      const internalNode = getInternalNodeFromStore(node.id);

      if (!internalNode) {
        return changes;
      }

      const parentNode = internalNode.parentId ? getInternalNodeFromStore(internalNode.parentId) : undefined;

      // Compute box from internal node (handle different reactflow v11 structure)
      // Try to get position from internals.positionAbsolute, internals.position, or position
      const positionAbsolute = internalNode.internals?.positionAbsolute;
      const positionInternal = internalNode.internals?.position;
      const positionDirect = internalNode.position;
      const position = positionAbsolute || positionInternal || positionDirect || { x: 0, y: 0 };
      
      let nodeWidth = internalNode.width || node.measured?.width || 0;
      let nodeHeight = internalNode.height || node.measured?.height || 0;
      
      // Update dimensions if dimension change is in progress
      if (dimensionChange?.dimensions) {
        nodeWidth = dimensionChange.dimensions.width;
        nodeHeight = dimensionChange.dimensions.height;
      }
      
      const nodeBounds: Box = {
        x: position.x,
        y: position.y,
        x2: position.x + nodeWidth,
        y2: position.y + nodeHeight,
      };

      const { x, y } = screenToFlowPosition({
        x: 0,
        y: 0,
      });
      const { x: x2, y: y2 } = screenToFlowPosition({
        x: width,
        y: height,
      });

      const viewportBox: Box = { x, y, x2, y2 };

      // Compute the best two helper lines for the node
      const { horizontal: hMatch, vertical: vMatch } = getHelperLines(
        spatialIndexRef.current,
        viewportBox,
        node,
        nodeBounds,
        anchors,
      );

      // We need to copy the position change to avoid mutating the original change object
      // This is important to ensure that the original change object is not mutated, and
      // returned as is if no snapping occurs.
      // Get absolute position from internal node (handle different reactflow v11 structure)
      const absPosition = internalNode.internals?.positionAbsolute || 
                         internalNode.internals?.position || 
                         internalNode.position || 
                         { x: 0, y: 0 };
      
      const snapChange: NodePositionChange = {
        id: node.id,
        type: 'position',
        position: {
          x: absPosition.x,
          y: absPosition.y,
        },
        dragging: false,
      };

      if (positionChange?.position && snapChange.position) {
        // If we are dragging a node, we can snap the node to the helper line position
        // This is being done by manipulating the node position inside the change object
        // It is also important to ensure that, if the node is a child of another group node (Subflows),
        // the position change we consider to be adjusted (`snapChange`) is absolute,
        // while the original `positionChange` is relative to the node's position.
        if (parentNode) {
          snapChange.position.x =
            positionChange.position.x + (parentNode?.position?.x ?? 0);
          snapChange.position.y =
            positionChange.position.y + (parentNode?.position?.y ?? 0);
        } else {
          snapChange.position.x = positionChange.position.x;
          snapChange.position.y = positionChange.position.y;
        }
      }

      const { snappedX, snappedY } = snapToHelperLines(
        node,
        internalNode,
        snapChange,
        positionChange,
        dimensionChange,
        parentNode,
        hMatch,
        vMatch,
        nodeBounds,
      );

      if (snappedX || snappedY) {
        if (dimensionChange?.resizing || positionChange?.dragging) {
          if (snappedX) setHelperLineVertical(vMatch?.line);
          if (snappedY) setHelperLineHorizontal(hMatch?.line);
        }

        if (dimensionChange && positionChange) {
          return [snapChange, dimensionChange];
        }
        if (positionChange) {
          return [snapChange];
        }
        if (dimensionChange) {
          return [dimensionChange];
        }
      }

      return changes;
    },
    [
      enabled,
      screenToFlowPosition,
      getInternalNodeFromStore,
      width,
      height,
      setHelperLineHorizontal,
      setHelperLineVertical,
      resetHelperLines,
    ],
  );

  const HelperLines = useCallback(() => {
    if (!enabled) return null;
    return (
      <HelperLinesRenderer
        horizontal={helperLineHorizontal}
        vertical={helperLineVertical}
      />
    );
  }, [enabled, helperLineHorizontal, helperLineVertical]);

  return {
    rebuildIndex,
    updateHelperLines,
    helperLineHorizontal,
    helperLineVertical,
    HelperLines,
  };
}
