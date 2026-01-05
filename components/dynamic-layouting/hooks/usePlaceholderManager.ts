import { useEffect, useCallback, useRef } from 'react';
// React Flow imports for graph manipulation
import { Node, Edge, useReactFlow, useUpdateNodeInternals } from 'reactflow';

// usePlaceholderManager: Hook that manages placeholder nodes showing where next chat panel will be added
// Shows placeholder below last added panel OR below selected panel
// Position is calculated based on actual panel height to prevent placeholders from appearing behind large panels
// Placeholders are draggable and maintain their relative position to the target panel
export function usePlaceholderManager(
  nodes: Node[],
  edges: Edge[],
  conversationId?: string,
  hidePlaceholders?: boolean // Flag to hide placeholders (e.g., when dragging selected nodes)
) {
  // React Flow instance methods for manipulating the graph
  const { setNodes, setEdges, getNodes, getEdges, getViewport } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  
  // Store relative offsets for each placeholder (preserved across target node changes)
  // Format: { placeholderId: { offsetX: number, offsetY: number, sourceHandle: string } }
  // The offset is relative to the handle the placeholder edge connects to, not the node's top-left corner
  // This offset is maintained when switching between different target nodes (selected or default)
  const placeholderOffsetsRef = useRef<Map<string, { offsetX: number; offsetY: number; sourceHandle: string }>>(new Map());
  
  // Track previous placeholder positions to detect when they're dragged (not just repositioned)
  const previousPlaceholderPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  
  // Track fade-out timeouts to clean up after animation completes
  const fadeOutTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  
  // Helper function to get actual node width (prioritize DOM measurement for accuracy)
  const getNodeWidth = useCallback((node: Node): number => {
    // Always try to measure DOM element first for accurate size (especially for fit-content nodes)
    const reactFlowElement = document.querySelector('.react-flow');
    if (reactFlowElement) {
      const nodeElement = reactFlowElement.querySelector(`[data-id="${node.id}"]`) as HTMLElement;
      if (nodeElement) {
        const viewport = getViewport();
        // Measure actual width and account for zoom
        const actualWidth = nodeElement.getBoundingClientRect().width / viewport.zoom;
        // Only use DOM measurement if it's valid (greater than 0)
        if (actualWidth > 0) {
          return actualWidth;
        }
      }
    }

    // Fallback: try to get width from node properties (React Flow v12+)
    if (node.width && typeof node.width === 'number') {
      return node.width;
    }

    // Default fallback width if measurement fails
    return 400;
  }, [getViewport]);

  // Helper function to get actual node height (prioritize DOM measurement for accuracy)
  const getNodeHeight = useCallback((node: Node): number => {
    // Always try to measure DOM element first for accurate size (especially for fit-content nodes)
    const reactFlowElement = document.querySelector('.react-flow');
    if (reactFlowElement) {
      const nodeElement = reactFlowElement.querySelector(`[data-id="${node.id}"]`) as HTMLElement;
      if (nodeElement) {
        const viewport = getViewport();
        // Measure actual height and account for zoom
        const actualHeight = nodeElement.getBoundingClientRect().height / viewport.zoom;
        // Only use DOM measurement if it's valid (greater than 0)
        if (actualHeight > 0) {
          return actualHeight;
        }
      }
    }

    // Fallback: try to get height from node properties (React Flow v12+)
    if (node.height && typeof node.height === 'number') {
      return node.height;
    }

    // Default fallback height if measurement fails
    return 400;
  }, [getViewport]);

  // Helper function to get handle position based on handle ID and node dimensions
  const getHandlePosition = useCallback((node: Node, handleId: string): { x: number; y: number } => {
    const width = getNodeWidth(node);
    const height = getNodeHeight(node);
    const pos = node.position;

    // Calculate handle positions based on handle ID
    // Handles are positioned at the center of their respective edges
    switch (handleId) {
      case 'left':
        return { x: pos.x, y: pos.y + height / 2 };
      case 'right':
        return { x: pos.x + width, y: pos.y + height / 2 };
      case 'top':
        return { x: pos.x + width / 2, y: pos.y };
      case 'bottom':
        return { x: pos.x + width / 2, y: pos.y + height };
      default:
        // Default to bottom handle if handle ID is not recognized
        return { x: pos.x + width / 2, y: pos.y + height };
    }
  }, [getNodeWidth, getNodeHeight]);

  // Helper function to find the closest handles between two nodes
  const findClosestHandles = useCallback((sourceNode: Node, targetNode: Node): { sourceHandle: string; targetHandle: string } => {
    // For placeholder nodes, use fixed dimensions if not set
    const sourceWidth = sourceNode.type === 'placeholder' 
      ? (sourceNode.width || 160) 
      : getNodeWidth(sourceNode);
    const sourceHeight = sourceNode.type === 'placeholder'
      ? (sourceNode.height || 40)
      : getNodeHeight(sourceNode);
    const targetWidth = targetNode.type === 'placeholder'
      ? (targetNode.width || 160)
      : getNodeWidth(targetNode);
    const targetHeight = targetNode.type === 'placeholder'
      ? (targetNode.height || 40)
      : getNodeHeight(targetNode);

    // Calculate all handle positions for source node
    const sourceHandles = {
      left: getHandlePosition(sourceNode, 'left'),
      right: getHandlePosition(sourceNode, 'right'),
      top: getHandlePosition(sourceNode, 'top'),
      bottom: getHandlePosition(sourceNode, 'bottom'),
    };

    // Calculate all handle positions for target node
    const targetHandles = {
      left: getHandlePosition(targetNode, 'left'),
      right: getHandlePosition(targetNode, 'right'),
      top: getHandlePosition(targetNode, 'top'),
      bottom: getHandlePosition(targetNode, 'bottom'),
    };

    // Find the closest pair of handles
    let minDistance = Infinity;
    let closestSourceHandle = 'bottom';
    let closestTargetHandle = 'top';

    Object.entries(sourceHandles).forEach(([sourceHandleId, sourceHandlePos]) => {
      Object.entries(targetHandles).forEach(([targetHandleId, targetHandlePos]) => {
        const distance = Math.sqrt(
          Math.pow(sourceHandlePos.x - targetHandlePos.x, 2) +
          Math.pow(sourceHandlePos.y - targetHandlePos.y, 2)
        );
        if (distance < minDistance) {
          minDistance = distance;
          closestSourceHandle = sourceHandleId;
          closestTargetHandle = targetHandleId;
        }
      });
    });

    return { sourceHandle: closestSourceHandle, targetHandle: closestTargetHandle };
  }, [getNodeWidth, getNodeHeight, getHandlePosition]);

  // Update placeholders based on current state
  const updatePlaceholders = useCallback(() => {
    // If hidePlaceholders flag is set, fade out and then remove placeholders
    if (hidePlaceholders) {
      const currentNodes = getNodes();
      const placeholderNodes = currentNodes.filter((n) => n.type === 'placeholder');
      
      // First, set opacity to 0 for fade-out animation
      placeholderNodes.forEach((placeholder) => {
        // Clear any existing timeout for this placeholder
        const existingTimeout = fadeOutTimeoutsRef.current.get(placeholder.id);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
        }
        
        // Update node with hidden flag for fade-out
        setNodes((nodes) =>
          nodes.map((node) =>
            node.id === placeholder.id
              ? { ...node, data: { ...node.data, hidden: true } }
              : node
          )
        );
        
        // Hide edge immediately (don't remove it to prevent flashing)
        setEdges((edges) =>
          edges.map((edge) =>
            edge.type === 'placeholder' && (edge.target === placeholder.id || edge.source === placeholder.id)
              ? { ...edge, data: { ...edge.data, hidden: true } }
              : edge
          )
        );
        
        // Remove after fade-out animation completes (200ms)
        const timeoutId = setTimeout(() => {
          const currentNodes = getNodes();
          const currentEdges = getEdges();
          const nodesWithoutPlaceholders = currentNodes.filter(
            (n) => n.type !== 'placeholder' || n.id !== placeholder.id
          );
          const edgesWithoutPlaceholders = currentEdges.filter(
            (e) => e.type !== 'placeholder' || (e.target !== placeholder.id && e.source !== placeholder.id)
          );
          setNodes(nodesWithoutPlaceholders);
          setEdges(edgesWithoutPlaceholders);
          fadeOutTimeoutsRef.current.delete(placeholder.id);
        }, 200); // Match transition duration
        
        fadeOutTimeoutsRef.current.set(placeholder.id, timeoutId);
      });
      
      // If no placeholders exist, we're done
      if (placeholderNodes.length === 0) {
        return;
      }
      return;
    }

    // Get current nodes and edges
    const currentNodes = getNodes();
    const currentEdges = getEdges();

    // Filter out existing placeholders
    const workflowNodes = currentNodes.filter((n) => n.type !== 'placeholder');
    const placeholderNodes = currentNodes.filter((n) => n.type === 'placeholder');
    const placeholderEdges = currentEdges.filter((e) => e.type === 'placeholder');

    // Find selected nodes
    const selectedNodes = workflowNodes.filter((n) => n.selected);

    // Determine where to show placeholder
    let targetNode: Node | null = null;

    if (selectedNodes.length > 0) {
      // If there are selected nodes, show placeholder below the first selected node
      targetNode = selectedNodes[0];
      console.log('🔄 PlaceholderManager: Using selected node as target', { targetId: targetNode.id });
    } else if (workflowNodes.length > 0) {
      // Otherwise, show placeholder below the last added node (highest Y position)
      // In linear mode, this would be the bottom-most node
      targetNode = workflowNodes.reduce((last, current) => {
        // Compare by Y position (higher Y = lower on screen)
        return current.position.y > last.position.y ? current : last;
      });
      console.log('🔄 PlaceholderManager: Using bottom-most node as target', { targetId: targetNode.id, workflowNodesCount: workflowNodes.length });
    } else {
      console.log('🔄 PlaceholderManager: No target node found', { workflowNodesCount: workflowNodes.length, currentNodesCount: currentNodes.length });
    }

    // Remove all existing placeholders
    const nodesWithoutPlaceholders = currentNodes.filter(
      (n) => n.type !== 'placeholder'
    );
    const edgesWithoutPlaceholders = currentEdges.filter(
      (e) => e.type !== 'placeholder'
    );

    // If we have a target node, add or update placeholder
    // Use a single placeholder ID that's not tied to a specific target node
    if (targetNode) {
      const placeholderId = 'placeholder-main'; // Single placeholder for all panels
      
      // Check if placeholder already exists
      const existingPlaceholder = placeholderNodes.find((n) => n.id === placeholderId);
      const storedOffset = placeholderOffsetsRef.current.get(placeholderId);
      
      // Find the existing placeholder edge to determine which handle it connects to
      // This will be reused later to preserve the edge if it exists
      const existingPlaceholderEdge = placeholderEdges.find((e) => e.target === placeholderId);
      
      let placeholderPosition: { x: number; y: number };
      let sourceHandle: string;
      let targetHandle: string;
      
      // If we have a stored offset, apply it to the current target node
      // This maintains the relative position when switching between different target nodes
      if (storedOffset) {
        // Get the latest target node from currentNodes to ensure we have the current position
        const latestTargetNode = currentNodes.find((n) => n.id === targetNode.id) || targetNode;
        
        // First, try to use the stored handle if it still makes sense
        // Calculate position using stored offset relative to stored handle
        const storedHandlePos = getHandlePosition(latestTargetNode, storedOffset.sourceHandle);
        const tempPositionFromStoredHandle = {
          x: storedHandlePos.x + storedOffset.offsetX,
          y: storedHandlePos.y + storedOffset.offsetY,
        };
        
        // Create temporary placeholder node to find closest handles
        const tempPlaceholderNode: Node = {
          id: placeholderId,
          position: tempPositionFromStoredHandle,
          type: 'placeholder',
          width: 160, // Placeholder width
          height: 40, // Placeholder height
        };
        
        // Find closest handles between target node and placeholder
        const closestHandles = findClosestHandles(latestTargetNode, tempPlaceholderNode);
        sourceHandle = closestHandles.sourceHandle;
        targetHandle = closestHandles.targetHandle;
        
        // Calculate final position using the closest handle with stored offset
        // This maintains the relative position even when handle changes
        const closestHandlePos = getHandlePosition(latestTargetNode, sourceHandle);
        placeholderPosition = {
          x: closestHandlePos.x + storedOffset.offsetX,
          y: closestHandlePos.y + storedOffset.offsetY,
        };
        
        // If the handle changed, update the stored offset to maintain visual position
        if (sourceHandle !== storedOffset.sourceHandle) {
          const newHandlePos = getHandlePosition(latestTargetNode, sourceHandle);
          // Recalculate offset to maintain the same visual position relative to new handle
          placeholderOffsetsRef.current.set(placeholderId, {
            offsetX: placeholderPosition.x - newHandlePos.x,
            offsetY: placeholderPosition.y - newHandlePos.y,
            sourceHandle: sourceHandle, // Update to new handle
          });
        }
      } else {
        // New placeholder or no stored offset - find closest handles
        // Get the latest target node from currentNodes to ensure we have the current position
        const latestTargetNode = currentNodes.find((n) => n.id === targetNode.id) || targetNode;
        
        // First, position placeholder below target node as default
        const defaultHandlePos = getHandlePosition(latestTargetNode, 'bottom');
        const spacing = 50; // Default spacing between panel and placeholder
        placeholderPosition = {
          x: defaultHandlePos.x,
          y: defaultHandlePos.y + spacing,
        };
        
        // Create temporary placeholder node to find closest handles
        // Use actual placeholder dimensions for accurate handle calculations
        const tempPlaceholderNode: Node = {
          id: placeholderId,
          position: placeholderPosition,
          type: 'placeholder',
          width: 160, // Placeholder width (matches PlaceholderNode component)
          height: 40, // Placeholder height (matches PlaceholderNode component)
        };
        
        // Find closest handles between target node and placeholder
        const closestHandles = findClosestHandles(latestTargetNode, tempPlaceholderNode);
        if (!closestHandles) {
          // Fallback to default handles if calculation fails
          sourceHandle = 'bottom';
          targetHandle = 'top';
        } else {
          sourceHandle = closestHandles.sourceHandle;
          targetHandle = closestHandles.targetHandle;
        }
        
        // Recalculate position relative to closest source handle
        const closestSourceHandlePos = getHandlePosition(latestTargetNode, sourceHandle);
        const closestTargetHandlePos = getHandlePosition(tempPlaceholderNode, targetHandle);
        
        // Adjust placeholder position so target handle aligns with source handle + spacing
        placeholderPosition = {
          x: closestSourceHandlePos.x - (closestTargetHandlePos.x - tempPlaceholderNode.position.x),
          y: closestSourceHandlePos.y - (closestTargetHandlePos.y - tempPlaceholderNode.position.y) + spacing,
        };
        
        // Store initial offset relative to handle position
        // This offset will be maintained when switching between different target nodes
        const finalHandlePos = getHandlePosition(latestTargetNode, sourceHandle);
        placeholderOffsetsRef.current.set(placeholderId, {
          offsetX: placeholderPosition.x - finalHandlePos.x,
          offsetY: placeholderPosition.y - finalHandlePos.y,
          sourceHandle: sourceHandle,
        });
      }

      // Clear any fade-out timeout if placeholder is being shown again
      const existingTimeout = fadeOutTimeoutsRef.current.get(placeholderId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        fadeOutTimeoutsRef.current.delete(placeholderId);
      }

      const placeholderNode: Node = {
        id: placeholderId,
        position: placeholderPosition,
        type: 'placeholder',
        width: 160, // Placeholder width (matches PlaceholderNode component)
        height: 40, // Placeholder height (matches PlaceholderNode component)
        data: { 
          label: '+',
          targetNodeId: targetNode.id, // Store current target node ID for reference
          hidden: false, // Ensure placeholder is visible
        },
        draggable: true, // Always make placeholder draggable (regardless of lock or view mode)
      };

      // Create or update edge with closest handles
      // ALWAYS create a new edge object with the current targetNode.id as source
      // This ensures the edge updates when selection changes
      const placeholderEdge: Edge = {
        id: `${targetNode.id}=>${placeholderId}`,
        source: targetNode.id,
        sourceHandle: sourceHandle, // Use closest handle
        target: placeholderId,
        targetHandle: targetHandle, // Use closest handle on placeholder
        type: 'placeholder',
        data: { hidden: false }, // Ensure edge is visible
      };

      // Update nodes and edges together in the same update cycle
      // This ensures both are created atomically
      setNodes((prevNodes) => {
        const existingPlaceholderInPrev = prevNodes.find((n) => n.id === placeholderId);
        if (existingPlaceholderInPrev && storedOffset) {
          // If we have a stored offset, we're restoring position after drag
          // Use the calculated position from stored offset to restore relative position
          return prevNodes.map((n) =>
            n.id === placeholderId 
              ? {
                  ...placeholderNode,
                  position: placeholderPosition, // Use calculated position from stored offset
                }
              : n
          );
        } else if (existingPlaceholderInPrev) {
          // No stored offset, just update other properties but keep current position
          return prevNodes.map((n) =>
            n.id === placeholderId 
              ? {
                  ...placeholderNode,
                  position: existingPlaceholderInPrev.position, // Preserve current position
                }
              : n
          );
        }
        // Placeholder doesn't exist yet, add it with calculated position
        return [...nodesWithoutPlaceholders, placeholderNode];
      });
      
      // Update or add the edge immediately after nodes update
      // ALWAYS remove old placeholder edges and add the new one with correct source
      // This ensures the edge updates correctly when selection changes
      setEdges((prevEdges) => {
        // Remove ALL placeholder edges (they might have old source)
        const edgesWithoutPlaceholders = prevEdges.filter((e) => e.type !== 'placeholder');
        
        // Add the new placeholder edge with correct source
        const newEdges = [...edgesWithoutPlaceholders, placeholderEdge];
        console.log('🔄 PlaceholderManager: Set placeholder edge', { 
          edgeId: placeholderEdge.id, 
          source: targetNode.id, 
          target: placeholderId, 
          totalEdges: newEdges.length,
          sourceHandle,
          targetHandle,
          edgeType: placeholderEdge.type
        });
        return newEdges;
      });
      
      // Force React Flow to update node internals (handles) for both source and placeholder
      // This ensures handles are properly initialized for edge rendering
      setTimeout(() => {
        updateNodeInternals(targetNode.id);
        updateNodeInternals(placeholderId);
      }, 50);
    } else {
      // No target node, remove all placeholders
      setNodes(nodesWithoutPlaceholders);
      setEdges(edgesWithoutPlaceholders);
    }
  }, [getEdges, getNodes, setEdges, setNodes, getNodeHeight, getNodeWidth, getHandlePosition, findClosestHandles, hidePlaceholders]);

  // Track placeholder positions and update offsets when they're dragged (not just repositioned)
  // This detects when the user manually drags a placeholder vs when it's repositioned due to selection change
  useEffect(() => {
    if (!conversationId) return;

    const currentNodes = getNodes();
    const placeholderNodes = currentNodes.filter((n) => n.type === 'placeholder');

    // Update offsets only if placeholder was actually dragged by user
    placeholderNodes.forEach((placeholder) => {
      const targetNodeId = placeholder.data?.targetNodeId;
      if (!targetNodeId) return;

      const targetNode = currentNodes.find((n) => n.id === targetNodeId);
      if (!targetNode) return;

      const previousPosition = previousPlaceholderPositionsRef.current.get(placeholder.id);
      const currentPosition = placeholder.position;
      const storedOffset = placeholderOffsetsRef.current.get(placeholder.id);
      
      // Calculate what the position should be based on stored offset (if it exists)
      // Position is relative to the handle, not the node's top-left corner
      const expectedPosition = storedOffset ? (() => {
        const handlePos = getHandlePosition(targetNode, storedOffset.sourceHandle);
        return {
          x: handlePos.x + storedOffset.offsetX,
          y: handlePos.y + storedOffset.offsetY,
        };
      })() : null;

      // Check if placeholder was dragged by user:
      // 1. Position changed significantly (more than 5px)
      // 2. Current position differs from expected position (if we have a stored offset)
      const positionChanged = previousPosition && (
        Math.abs(currentPosition.x - previousPosition.x) > 5 ||
        Math.abs(currentPosition.y - previousPosition.y) > 5
      );
      
      const differsFromExpected = expectedPosition && (
        Math.abs(currentPosition.x - expectedPosition.x) > 5 ||
        Math.abs(currentPosition.y - expectedPosition.y) > 5
      );

      // Only update offset if it was dragged by user (not programmatically repositioned)
      // When dragged, calculate offset relative to the handle the edge connects to
      if (positionChanged && (!expectedPosition || differsFromExpected)) {
        // Find the placeholder edge to determine which handle it connects to
        const currentEdges = getEdges();
        const placeholderEdge = currentEdges.find((e) => e.target === placeholder.id && e.source === targetNode.id);
        const sourceHandle = placeholderEdge?.sourceHandle || 'bottom'; // Default to bottom handle
        
        // Get handle position on target node
        const handlePos = getHandlePosition(targetNode, sourceHandle);
        
        // Calculate relative offset from handle position (not node top-left corner)
        const offsetX = placeholder.position.x - handlePos.x;
        const offsetY = placeholder.position.y - handlePos.y;

        // Store the offset relative to handle position
        // This offset will be maintained when switching between different target nodes
        placeholderOffsetsRef.current.set(placeholder.id, {
          offsetX,
          offsetY,
          sourceHandle, // Store which handle this offset is relative to
        });
      }

      // Update previous position for next comparison
      previousPlaceholderPositionsRef.current.set(placeholder.id, {
        x: placeholder.position.x,
        y: placeholder.position.y,
      });
    });
  }, [nodes, conversationId, getNodes, getNodeWidth, getNodeHeight, getEdges, getHandlePosition]);

  // Immediately update placeholders when hidePlaceholders flag changes (for drag detection)
  // This ensures placeholders are hidden/shown instantly during fast drags
  useEffect(() => {
    if (!conversationId) return;
    // Call immediately when hidePlaceholders changes (no delay for drag state changes)
    updatePlaceholders();
  }, [hidePlaceholders, conversationId, updatePlaceholders]);

  // Update placeholders when nodes or selection changes
  // Use a longer delay to ensure DOM is fully rendered and heights can be measured
  useEffect(() => {
    if (!conversationId) {
      console.log('🔄 PlaceholderManager: No conversationId, skipping');
      return;
    }

    // Skip if hidePlaceholders is set (handled by the immediate effect above)
    if (hidePlaceholders) {
      console.log('🔄 PlaceholderManager: hidePlaceholders is true, skipping');
      return;
    }

    // Filter out placeholder nodes to check if we have real nodes
    const realNodes = nodes?.filter((n) => n.type !== 'placeholder') || [];
    
    // Ensure we have real nodes before creating placeholders
    if (realNodes.length === 0) {
      console.log('🔄 PlaceholderManager: No real nodes yet, skipping', { totalNodes: nodes?.length || 0 });
      return;
    }

    console.log('🔄 PlaceholderManager: Scheduling placeholder update', { 
      realNodesCount: realNodes.length, 
      totalNodes: nodes?.length || 0,
      hidePlaceholders 
    });

    // Delay to ensure DOM is fully rendered so we can measure actual panel heights
    // Also ensure edges are loaded before creating placeholder edge
    const timeoutId = setTimeout(() => {
      console.log('🔄 PlaceholderManager: Running updatePlaceholders');
      updatePlaceholders();
      // Force a second update after a short delay to ensure edge is created
      // This handles cases where React Flow hasn't fully initialized
      setTimeout(() => {
        console.log('🔄 PlaceholderManager: Running second updatePlaceholders');
        updatePlaceholders();
      }, 100);
    }, 300); // Increased delay to allow DOM to render, edges to load, and heights to be measured

    return () => clearTimeout(timeoutId);
  }, [nodes, edges, conversationId, updatePlaceholders, hidePlaceholders]);

  return { updatePlaceholders };
}

export default usePlaceholderManager;

