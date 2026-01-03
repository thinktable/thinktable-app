'use client'

import { useCallback, useState, useEffect, useRef } from 'react';
import {
  NodeResizer,
  type NodeProps,
  Handle,
  Position,
  useKeyPress,
  useReactFlow,
  useStore,
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

// Helper function to calculate optimal font size for text to fit within shape bounds
// Text should expand to fill available space, shrink when more text is added
const calculateAutoFitFontSize = (
  text: string,
  containerWidth: number,
  containerHeight: number,
  minFontSize: number = 8,
  maxFontSize: number = 72
): number => {
  // If no text, return default font size
  if (!text || text.trim().length === 0) return 16;
  
  // Create temporary element to measure text dimensions
  const tempSpan = document.createElement('span');
  tempSpan.style.position = 'absolute';
  tempSpan.style.visibility = 'hidden';
  tempSpan.style.whiteSpace = 'nowrap';
  tempSpan.style.fontFamily = 'inherit';
  tempSpan.textContent = text;
  document.body.appendChild(tempSpan);
  
  // Binary search to find optimal font size that fits
  let low = minFontSize;
  let high = maxFontSize;
  let optimalSize = minFontSize;
  
  // Calculate available space (with padding margin of ~20% for shapes)
  const availableWidth = containerWidth * 0.8;
  const availableHeight = containerHeight * 0.6;
  
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    tempSpan.style.fontSize = `${mid}px`;
    
    const textWidth = tempSpan.offsetWidth;
    const textHeight = tempSpan.offsetHeight;
    
    // Check if text fits within available space
    if (textWidth <= availableWidth && textHeight <= availableHeight) {
      optimalSize = mid; // This size fits, try larger
      low = mid + 1;
    } else {
      high = mid - 1; // Too big, try smaller
    }
  }
  
  document.body.removeChild(tempSpan);
  return optimalSize;
};

export function ShapeNode({
  id,
  selected,
  data,
}: NodeProps<ShapeNodeData>) {
  const { type, color, fillColor, borderColor, borderWeight } = data;
  const shiftKeyPressed = useKeyPress('Shift');
  const { resolvedTheme } = useTheme();
  
  // Get node dimensions from the store - React Flow doesn't pass width/height as props
  const nodeRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dimensions, setDimensions] = useState({ width: 100, height: 100 });
  
  // State for text content and auto-calculated font size
  const [textContent, setTextContent] = useState('');
  const [autoFontSize, setAutoFontSize] = useState(16);
  
  // Watch for node size changes using ResizeObserver
  useEffect(() => {
    const element = nodeRef.current;
    if (!element) return;
    
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    });
    
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);
  
  // Recalculate font size when text content or dimensions change
  // Text expands to fill space, shrinks when more text is added
  useEffect(() => {
    const newFontSize = calculateAutoFitFontSize(
      textContent,
      dimensions.width,
      dimensions.height
    );
    setAutoFontSize(newFontSize);
  }, [textContent, dimensions.width, dimensions.height]);
  
  // Handle text input changes - triggers font size recalculation
  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTextContent(e.target.value);
  }, []);

  // Use color if available, otherwise use fillColor, fallback to default
  const shapeColor = color || fillColor || '#3F8AE2';
  const strokeColor = borderColor || color || fillColor || '#3F8AE2';
  const strokeWidth = borderWeight || 2;

  // Calculate handle border color - similar to panel handles
  // Default border color based on theme (same as panel handles)
  const handleBorderColor = borderColor || (resolvedTheme === 'dark' ? '#2f2f2f' : '#e5e7eb');

  return (
    <div ref={nodeRef} className="w-full h-full relative">
      {/* NodeResizer for free-form shape resizing (aspect ratio NOT locked by default) */}
      {/* Hold Shift to lock aspect ratio while resizing */}
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
        width={dimensions.width}
        height={dimensions.height}
        fill={shapeColor}
        strokeWidth={strokeWidth}
        stroke={strokeColor}
        fillOpacity={0.8}
      />
      {/* Auto-fitting text input - font size scales based on shape size and text content */}
      {/* Text expands to fill available space, shrinks when more text is added */}
      <input 
        ref={inputRef}
        type="text" 
        className="node-label" 
        placeholder={type}
        value={textContent}
        onChange={handleTextChange}
        style={{
          fontSize: `${autoFontSize}px`,
          // Ensure text stays centered and fits within shape
          maxWidth: '80%',
          textOverflow: 'ellipsis',
        }}
      />
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
    </div>
  );
}

