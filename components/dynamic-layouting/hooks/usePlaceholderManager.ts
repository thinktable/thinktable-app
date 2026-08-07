import { useEffect, useCallback } from 'react';
// React Flow imports for graph cleanup
import { Node, Edge, useReactFlow } from 'reactflow';

// usePlaceholderManager: Ghost “+” placeholders are disabled.
// This hook only strips any leftover placeholder nodes/edges from older sessions.
export function usePlaceholderManager(
  nodes: Node[],
  edges: Edge[],
  conversationId?: string,
  _hidePlaceholders?: boolean // Kept for call-site compatibility; unused
) {
  const { setNodes, setEdges, getNodes, getEdges } = useReactFlow();

  // Remove every placeholder node and edge so none remain on the board
  const clearPlaceholders = useCallback(() => {
    const currentNodes = getNodes(); // Latest nodes from React Flow
    const currentEdges = getEdges(); // Latest edges from React Flow
    const hasPlaceholderNodes = currentNodes.some((n) => n.type === 'placeholder');
    const hasPlaceholderEdges = currentEdges.some((e) => e.type === 'placeholder');
    if (!hasPlaceholderNodes && !hasPlaceholderEdges) return; // Nothing to clean
    setNodes(currentNodes.filter((n) => n.type !== 'placeholder')); // Drop ghost nodes
    setEdges(currentEdges.filter((e) => e.type !== 'placeholder')); // Drop ghost edges
  }, [getNodes, getEdges, setNodes, setEdges]);

  // Clear leftovers whenever the graph changes for this conversation
  useEffect(() => {
    if (!conversationId) return;
    clearPlaceholders();
  }, [nodes, edges, conversationId, clearPlaceholders]);

  return { updatePlaceholders: clearPlaceholders };
}

export default usePlaceholderManager;
