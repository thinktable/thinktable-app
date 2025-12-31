'use client'

import { useRef, useState, PointerEvent } from 'react';
import { useReactFlow, type ReactFlowInstance } from 'reactflow';
import { type ShapeNodeData, type ShapeType } from './types';

interface ShapeDrawProps {
  conversationId?: string;
  onBeforeCreate?: () => void;
  shapeType: ShapeType;
  fillColor?: string;
  borderColor?: string;
  borderWeight?: number;
}

// Shape drawing component - creates shape nodes when user draws on canvas
export function ShapeDraw({ 
  conversationId, 
  onBeforeCreate,
  shapeType,
  fillColor = '#3F8AE2',
  borderColor,
  borderWeight = 2,
}: ShapeDrawProps) {
  const { screenToFlowPosition, setNodes } = useReactFlow();
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const [currentRect, setCurrentRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // Handle pointer down - start drawing a shape
  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
    
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    startPosRef.current = position;
    setCurrentRect({ x: position.x, y: position.y, width: 0, height: 0 });
  }

  // Handle pointer move - update shape preview
  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!startPosRef.current) return;
    
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const width = Math.abs(position.x - startPosRef.current.x);
    const height = Math.abs(position.y - startPosRef.current.y);
    const x = Math.min(startPosRef.current.x, position.x);
    const y = Math.min(startPosRef.current.y, position.y);
    
    setCurrentRect({ x, y, width, height });
  }

  // Handle pointer up - finish drawing and create shape node
  function handlePointerUp(e: PointerEvent) {
    (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);
    
    if (!startPosRef.current || !currentRect || currentRect.width < 10 || currentRect.height < 10) {
      startPosRef.current = null;
      setCurrentRect(null);
      return;
    }

    // Call onBeforeCreate if provided (for undo/redo snapshot)
    if (onBeforeCreate) {
      onBeforeCreate();
    }

    const newNodeId = `shape-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const newNode = {
      id: newNodeId,
      type: 'shape' as const,
      position: { x: currentRect.x, y: currentRect.y },
      style: { width: currentRect.width, height: currentRect.height },
      data: {
        type: shapeType,
        fillColor,
        borderColor: borderColor || fillColor,
        borderWeight,
      } as ShapeNodeData,
      selected: true,
    };

    setNodes((nds) => {
      // Deselect all other nodes
      const updatedNodes = nds.map((n) => ({ ...n, selected: false }));
      return [...updatedNodes, newNode];
    });

    startPosRef.current = null;
    setCurrentRect(null);
  }

  return (
    <div
      className="absolute inset-0 pointer-events-auto z-10"
      onPointerDown={handlePointerDown}
      onPointerMove={currentRect ? handlePointerMove : undefined}
      onPointerUp={handlePointerUp}
      style={{ cursor: 'crosshair' }}
    >
      {/* Preview rectangle - positioned in React Flow coordinate space */}
      {currentRect && currentRect.width > 0 && currentRect.height > 0 && (
        <div
          className="absolute border-2 border-dashed pointer-events-none"
          style={{
            left: `${currentRect.x}px`,
            top: `${currentRect.y}px`,
            width: `${currentRect.width}px`,
            height: `${currentRect.height}px`,
            borderColor: fillColor,
            borderStyle: 'dashed',
          }}
        />
      )}
    </div>
  );
}

