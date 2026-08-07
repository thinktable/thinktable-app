import { useCallback } from 'react';
// React Flow imports for graph cleanup
import { useReactFlow, getOutgoers } from 'reactflow';

// useAddChildNode: Ghost placeholders are disabled.
// Kept for call-site compatibility; only strips leftover placeholder children.
export function useAddChildNode() {
  const { setEdges, setNodes, getNodes, getEdges, getNode } = useReactFlow();

  const addChildNode = useCallback((parentNodeId: string) => {
    const parentNode = getNode(parentNodeId); // Resolve parent for outgoer lookup
    if (!parentNode) return;

    // Collect any leftover ghost placeholder children of this parent
    const existingPlaceholders = getOutgoers(parentNode, getNodes(), getEdges())
      .filter((node) => node.type === 'placeholder')
      .map((node) => node.id);

    if (existingPlaceholders.length > 0) {
      setNodes((nodes) => nodes.filter((node) => !existingPlaceholders.includes(node.id)));
    }
    // Strip placeholder edges tied to those ghosts (and any orphan placeholder edges)
    setEdges((edges) =>
      edges.filter((edge) => edge.type !== 'placeholder' && !existingPlaceholders.includes(edge.target))
    );
  }, [getEdges, getNode, getNodes, setEdges, setNodes]);

  return addChildNode;
}

export default useAddChildNode;
