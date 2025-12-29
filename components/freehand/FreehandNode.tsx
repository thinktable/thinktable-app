// Freehand drawing node component for React Flow
// Renders a freehand-drawn path as a resizable node
import { useMemo, useEffect } from 'react'; // useMemo for memoizing scaled points calculation, useEffect for debugging
import { NodeResizer, type Node, type NodeProps } from 'reactflow'; // React Flow node components and types
import { useTheme } from '@/components/theme-provider'; // Theme provider for dark mode detection

import { pointsToPath } from './path'; // Path generation utility
import type { Points } from './types'; // Points type definition

// Type definition for freehand node data
// Extends React Flow Node type with custom data structure
export type FreehandNodeType = Node<
  {
    points: Points; // Array of [x, y, pressure] points defining the drawing
    initialSize: { width: number; height: number }; // Original size when node was created (for scaling)
  },
  'freehand' // Node type identifier
>;

// FreehandNode component - renders a freehand drawing as a resizable React Flow node
// data: Node data containing points and initial size
// width: Current node width (from React Flow v12+, may be undefined in v11)
// height: Current node height (from React Flow v12+, may be undefined in v11)
// selected: Whether node is currently selected
// dragging: Whether node is currently being dragged
export function FreehandNode({
  data,
  width,
  height,
  selected,
  dragging,
}: NodeProps<FreehandNodeType>) {
  const { resolvedTheme } = useTheme(); // Get current theme for dark mode support
  
  // Debug: Log node data on mount/update
  useEffect(() => {
    console.log('🎨 FreehandNode render:', {
      hasData: !!data,
      hasPoints: !!(data?.points),
      pointsCount: data?.points?.length || 0,
      initialSize: data?.initialSize,
      width,
      height,
    })
  }, [data, width, height])

  // Use initialSize as fallback if width/height are undefined
  // In reactflow v11, width/height props may not be passed - use initialSize from data
  const nodeWidth = width ?? data?.initialSize?.width ?? 100; // Use width prop, fallback to initialSize, then 100
  const nodeHeight = height ?? data?.initialSize?.height ?? 100; // Use height prop, fallback to initialSize, then 100
  
  // Calculate scale factors based on current size vs initial size
  // This allows the drawing to scale proportionally when node is resized
  const scaleX = data.initialSize.width > 0 ? nodeWidth / data.initialSize.width : 1; // Horizontal scale factor
  const scaleY = data.initialSize.height > 0 ? nodeHeight / data.initialSize.height : 1; // Vertical scale factor

  // Memoize scaled points calculation to avoid recalculating on every render
  // Scales each point by the scale factors to maintain drawing proportions
  const points = useMemo(
    () => {
      if (!data.points || data.points.length === 0) {
        console.warn('🎨 FreehandNode: No points in data', { data, hasData: !!data, hasPoints: !!data?.points })
        return []
      }
      const scaled = data.points.map((point) => [
        point[0] * scaleX, // Scale x coordinate
        point[1] * scaleY, // Scale y coordinate
        point[2] || 0.5, // Keep pressure unchanged (default to 0.5 if missing)
      ]) satisfies Points
      console.log('🎨 FreehandNode: Scaled points', { originalCount: data.points.length, scaledCount: scaled.length, scaleX, scaleY })
      return scaled
    },
    [data.points, scaleX, scaleY], // Recalculate when points or scale changes
  );

  // Generate path from points
  const pathData = useMemo(() => {
    if (points.length === 0) {
      console.warn('🎨 FreehandNode: No points to generate path')
      return ''
    }
    try {
      const path = pointsToPath(points)
      console.log('🎨 FreehandNode: Generated path', { pointsCount: points.length, pathLength: path?.length || 0, pathPreview: path?.substring(0, 50) })
      if (!path) {
        console.warn('🎨 FreehandNode: Empty path generated from points', points.length)
      }
      return path
    } catch (error) {
      console.error('🎨 FreehandNode: Error generating path', error, { pointsCount: points.length })
      return ''
    }
  }, [points])

  return (
    <>
      {/* Node resizer - shows resize handles when node is selected and not dragging */}
      <NodeResizer 
        isVisible={selected && !dragging}
        handleStyle={{
          width: '12px',
          height: '12px',
          minWidth: '12px',
          minHeight: '12px',
          backgroundColor: resolvedTheme === 'dark' ? '#1a1a1a' : '#ffffff', // Dark mode support
          border: '2px solid #9e86ed',
          borderRadius: '2px',
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
        }}
      />
      {/* SVG container for the drawing path */}
      {/* Use calculated nodeWidth/nodeHeight which fallback to initialSize if width/height props are undefined */}
      <svg
        width={nodeWidth} // Set SVG width to match node width
        height={nodeHeight} // Set SVG height to match node height
        viewBox={`0 0 ${nodeWidth} ${nodeHeight}`} // Set viewBox to match dimensions
        style={{
          pointerEvents: selected ? 'auto' : 'none', // Allow pointer events only when selected
          display: 'block', // Ensure SVG is displayed
          position: 'absolute', // Position absolutely within node
          top: 0,
          left: 0,
          width: '100%', // Fill node width
          height: '100%', // Fill node height
        }}
      >
        {/* Path element rendering the freehand drawing */}
        {pathData ? (
          <path
            className="freehand-path" // CSS class for theming (light/dark mode)
            style={{
              pointerEvents: 'visiblePainted', // Allow pointer events on visible painted areas
              cursor: 'pointer', // Show pointer cursor on hover
              stroke: 'none', // No stroke, only fill
            }}
            d={pathData} // SVG path data from scaled points
          />
        ) : (
          // Fallback: Show a small dot if path generation fails (for debugging)
          <circle cx={nodeWidth / 2} cy={nodeHeight / 2} r={5} fill="#ff0000" />
        )}
      </svg>
    </>
  );
}

