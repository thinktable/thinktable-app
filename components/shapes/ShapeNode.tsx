'use client'

import { useCallback } from 'react';
import {
  NodeResizer,
  type NodeProps,
  Handle,
  Position,
  useKeyPress,
  useReactFlow,
} from 'reactflow';
import { useTheme } from '@/components/theme-provider';
import Shape from './Shape';
import { type ShapeNodeData } from './types';

const handlePositions = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
];

export function ShapeNode({
  id,
  selected,
  data,
  width,
  height,
}: NodeProps<ShapeNodeData>) {
  const { type, color, fillColor, borderColor, borderWeight } = data;
  const shiftKeyPressed = useKeyPress('Shift');
  const { resolvedTheme } = useTheme();

  // Use color if available, otherwise use fillColor, fallback to default
  const shapeColor = color || fillColor || '#3F8AE2';
  const strokeColor = borderColor || color || fillColor || '#3F8AE2';
  const strokeWidth = borderWeight || 2;

  // Calculate handle border color - similar to panel handles
  // Default border color based on theme (same as panel handles)
  const handleBorderColor = borderColor || (resolvedTheme === 'dark' ? '#2f2f2f' : '#e5e7eb');

  return (
    <>
      <NodeResizer
        keepAspectRatio={shiftKeyPressed}
        isVisible={selected}
        handleStyle={{
          width: '12px',
          height: '12px',
          minWidth: '12px',
          minHeight: '12px',
          backgroundColor: resolvedTheme === 'dark' ? '#1a1a1a' : '#ffffff', // Same fill as drawing handles - white in light mode
          border: '2px solid #3b82f6', // Blue border only (not fill)
          borderRadius: '2px',
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
          boxSizing: 'border-box',
        }}
        lineStyle={{
          stroke: '#3b82f6',
          strokeWidth: 1,
        }}
      />
      <Shape
        type={type}
        width={width || 100}
        height={height || 100}
        fill={shapeColor}
        strokeWidth={strokeWidth}
        stroke={strokeColor}
        fillOpacity={0.8}
      />
      <input type="text" className="node-label" placeholder={type} />
      {handlePositions.map((position) => (
        <Handle
          key={position}
          id={position}
          className="handle-dot"
          style={{ 
            backgroundColor: shapeColor,
            '--handle-border-color': handleBorderColor,
          } as React.CSSProperties}
          type="source"
          position={position}
        />
      ))}
    </>
  );
}

