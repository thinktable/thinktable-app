// Freehand drawing overlay component for React Flow
// Handles pointer events to capture drawing strokes and create freehand nodes
import { useRef, useState, type PointerEvent } from 'react'; // React hooks for state and refs
import { useReactFlow, type Edge, type ReactFlowInstance } from 'reactflow'; // React Flow hooks and types
import { createClient } from '@/lib/supabase/client'; // Supabase client for database operations
import { generateUUID } from '@/lib/utils'; // UUID generation utility (compatible with all browsers)

import { pathOptions, pointsToPath } from './path'; // Path generation utilities
import type { Points } from './types'; // Points type definition
import type { FreehandNodeType } from './FreehandNode'; // Freehand node type

// Process drawing points from viewport coordinates to flow coordinates
// points: Array of [clientX, clientY, pressure] tuples from pointer events (viewport coordinates)
// screenToFlowPosition: Function to convert viewport coordinates to flow coordinates
// Returns: Node data with position, dimensions, and normalized points
function processPoints(
  points: [number, number, number][],
  screenToFlowPosition: ReactFlowInstance['screenToFlowPosition'],
) {
  // Initialize bounding box to find drawing bounds
  let x1 = Infinity; // Minimum x coordinate
  let y1 = Infinity; // Minimum y coordinate
  let x2 = -Infinity; // Maximum x coordinate
  let y2 = -Infinity; // Maximum y coordinate

  const flowPoints: Points = []; // Array to store converted flow coordinates

  // Convert all points from screen coordinates to flow coordinates
  for (const point of points) {
    const { x, y } = screenToFlowPosition({ x: point[0], y: point[1] }); // Convert screen to flow
    x1 = Math.min(x1, x); // Update min x
    y1 = Math.min(y1, y); // Update min y
    x2 = Math.max(x2, x); // Update max x
    y2 = Math.max(y2, y); // Update max y

    flowPoints.push([x, y, point[2]]); // Store converted point with pressure
  }

  // Adjust bounding box for stroke thickness (half stroke size on each side)
  const thickness = pathOptions.size * 0.5; // Half of stroke size
  x1 -= thickness; // Expand left
  y1 -= thickness; // Expand top
  x2 += thickness; // Expand right
  y2 += thickness; // Expand bottom

  // Normalize points to start at (0, 0) relative to bounding box
  // This makes the drawing position-independent and easier to scale
  for (const flowPoint of flowPoints) {
    flowPoint[0] -= x1; // Offset x to start at 0
    flowPoint[1] -= y1; // Offset y to start at 0
  }
  let width = x2 - x1; // Calculate final width
  let height = y2 - y1; // Calculate final height

  // Ensure minimum size (at least stroke thickness * 2)
  const minSize = pathOptions.size * 2
  if (width < minSize) {
    const centerX = (x1 + x2) / 2
    x1 = centerX - minSize / 2
    x2 = centerX + minSize / 2
    width = minSize
  }
  if (height < minSize) {
    const centerY = (y1 + y2) / 2
    y1 = centerY - minSize / 2
    y2 = centerY + minSize / 2
    height = minSize
  }

  return {
    position: { x: x1, y: y1 }, // Top-left position in flow coordinates
    width, // Drawing width
    height, // Drawing height
    data: { points: flowPoints, initialSize: { width, height } }, // Node data with normalized points
  };
}

// Store failed save in localStorage for retry later
// node: Freehand node that failed to save
// conversationId: Conversation/board ID
function storeFailedSave(node: FreehandNodeType, conversationId: string) {
  try {
    const key = `thinktable-failed-canvas-saves-${conversationId}`
    const failed = JSON.parse(localStorage.getItem(key) || '[]')
    failed.push({
      node,
      conversationId,
      timestamp: Date.now(),
    })
    // Keep only last 50 failed saves to avoid localStorage bloat
    const trimmed = failed.slice(-50)
    localStorage.setItem(key, JSON.stringify(trimmed))
    console.log('🎨 Stored failed save for retry:', node.id)
  } catch (error) {
    console.error('🎨 Error storing failed save:', error)
  }
}

// Remove successful save from failed saves list
// nodeId: ID of the node that was successfully saved
function removeFailedSave(nodeId: string) {
  try {
    // Try to find and remove from any conversation's failed saves
    const keys = Object.keys(localStorage).filter(key => key.startsWith('thinktable-failed-canvas-saves-'))
    for (const key of keys) {
      const failed = JSON.parse(localStorage.getItem(key) || '[]')
      const filtered = failed.filter((item: any) => item.node.id !== nodeId)
      if (filtered.length !== failed.length) {
        localStorage.setItem(key, JSON.stringify(filtered))
        console.log('🎨 Removed successful save from failed list:', nodeId)
      }
    }
  } catch (error) {
    console.error('🎨 Error removing failed save:', error)
  }
}

// Retry failed saves for a conversation
// conversationId: Conversation/board ID to retry saves for
export async function retryFailedSaves(conversationId: string) {
  try {
    const key = `thinktable-failed-canvas-saves-${conversationId}`
    const failed = JSON.parse(localStorage.getItem(key) || '[]')
    if (failed.length === 0) return

    console.log(`🎨 Retrying ${failed.length} failed canvas saves for conversation:`, conversationId)
    
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      console.warn('🎨 Cannot retry saves: user not authenticated')
      return
    }

    const successful: string[] = []
    const stillFailed: any[] = []

    for (const item of failed) {
      try {
        const { error } = await supabase
          .from('canvas_nodes')
          .insert({
            id: item.node.id,
            conversation_id: item.conversationId,
            user_id: user.id,
            node_type: 'freehand',
            position_x: item.node.position.x,
            position_y: item.node.position.y,
            width: item.node.width,
            height: item.node.height,
            data: item.node.data,
          })

        if (error) {
          console.error('🎨 Still failed to save:', item.node.id, error)
          stillFailed.push(item)
        } else {
          console.log('🎨 ✅ Retry successful:', item.node.id)
          successful.push(item.node.id)
        }
      } catch (error) {
        console.error('🎨 Error retrying save:', item.node.id, error)
        stillFailed.push(item)
      }
    }

    // Update localStorage with remaining failed saves
    if (stillFailed.length > 0) {
      localStorage.setItem(key, JSON.stringify(stillFailed))
    } else {
      localStorage.removeItem(key)
    }

    // Remove successful saves from all failed lists
    successful.forEach(id => removeFailedSave(id))

    console.log(`🎨 Retry complete: ${successful.length} successful, ${stillFailed.length} still failed`)
  } catch (error) {
    console.error('🎨 Error retrying failed saves:', error)
  }
}

// Freehand component - overlay that captures drawing strokes
// Creates freehand nodes when user draws on the canvas
// onBeforeCreate: Optional callback to trigger before creating a node (for undo/redo snapshot)
export function Freehand({ conversationId, onBeforeCreate }: { conversationId?: string; onBeforeCreate?: () => void }) {
  // Get React Flow instance functions for coordinate conversion and node management
  const { screenToFlowPosition, getViewport, setNodes } = useReactFlow<
    FreehandNodeType,
    Edge
  >();

  const pointRef = useRef<Points>([]); // Ref to store current drawing points (for move handler) - stores page coordinates
  const [points, setPoints] = useState<Points>([]); // State for current drawing points (for rendering) - stores container-relative coordinates for preview

  // Handle pointer down - start a new drawing stroke
  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    (e.target as HTMLDivElement).setPointerCapture(e.pointerId); // Capture pointer for this element
    
    // Get React Flow container for coordinate conversion
    const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
    if (!reactFlowElement) return
    
    const reactFlowRect = reactFlowElement.getBoundingClientRect()
    
    // Store viewport coordinates for final node creation (screenToFlowPosition expects clientX/clientY)
    const viewportPoints = [
      [e.clientX, e.clientY, e.pressure], // Viewport coordinates for screenToFlowPosition
    ] satisfies Points;
    pointRef.current = viewportPoints; // Store viewport coordinates for final conversion
    
    // Convert to container-relative coordinates for preview display
    const containerX = e.clientX - reactFlowRect.left // Container-relative X
    const containerY = e.clientY - reactFlowRect.top // Container-relative Y
    const previewPoints = [
      [containerX, containerY, e.pressure], // Container-relative coordinates for preview
    ] satisfies Points;
    setPoints(previewPoints); // Update state for preview rendering
  }

  // Handle pointer move - add points to current stroke while drawing
  function handlePointerMove(e: PointerEvent) {
    if (e.buttons !== 1) return; // Only process if left mouse button is pressed
    const viewportPoints = pointRef.current; // Get current viewport coordinates from ref
    if (viewportPoints.length === 0) return // Don't add points if stroke hasn't started
    
    // Get React Flow container for coordinate conversion
    const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
    if (!reactFlowElement) return
    
    const reactFlowRect = reactFlowElement.getBoundingClientRect()
    
    // Store viewport coordinates for final node creation (screenToFlowPosition expects clientX/clientY)
    const nextViewportPoints = [
      ...viewportPoints, // Include existing viewport coordinates
      [e.clientX, e.clientY, e.pressure], // Add new point with pressure (viewport coordinates)
    ] satisfies Points;
    pointRef.current = nextViewportPoints; // Store viewport coordinates for final conversion
    
    // Convert to container-relative coordinates for preview display
    const containerX = e.clientX - reactFlowRect.left // Container-relative X
    const containerY = e.clientY - reactFlowRect.top // Container-relative Y
    const currentPreviewPoints = points // Get current preview points from state
    const nextPreviewPoints = [
      ...currentPreviewPoints, // Include existing preview points
      [containerX, containerY, e.pressure], // Add new point with pressure (container-relative coordinates)
    ] satisfies Points;
    setPoints(nextPreviewPoints); // Update state for preview rendering
  }

  // Handle pointer up - finish stroke and create freehand node
  function handlePointerUp(e: PointerEvent) {
    (e.target as HTMLDivElement).releasePointerCapture(e.pointerId); // Release pointer capture

    // Get points from ref (not state, as state might be stale)
    const finalPoints = pointRef.current
    if (finalPoints.length === 0) {
      // No points collected, clear and return
      setPoints([])
      pointRef.current = []
      return
    }

    // Process points to get node data
    const nodeData = processPoints(finalPoints, screenToFlowPosition)
    
    // Generate unique node ID (compatible with all browsers including older Safari)
    const nodeId = generateUUID()
    
    // Debug: Log node creation
    console.log('🎨 Creating freehand node:', {
      id: nodeId,
      pointCount: finalPoints.length,
      nodeData: {
        position: nodeData.position,
        width: nodeData.width,
        height: nodeData.height,
        pointsCount: nodeData.data.points.length,
      }
    })

    // Take snapshot before creating node for undo/redo support
    if (onBeforeCreate) onBeforeCreate()

    // Create new freehand node from collected points
    // Note: reactflow v11 requires width/height in style, not as direct properties
    // v12+ (@xyflow/react) uses direct properties but we're on v11
    const newNode: FreehandNodeType = {
      id: nodeId, // Generate unique node ID (compatible with all browsers)
      type: 'freehand', // Set node type
      position: nodeData.position, // Node position in flow coordinates
      width: nodeData.width, // Node width (for v12+ compatibility)
      height: nodeData.height, // Node height (for v12+ compatibility)
      style: { // Style object for v11 - required for node dimensions
        width: nodeData.width,
        height: nodeData.height,
      },
      data: nodeData.data, // Node data (points and initialSize)
        // resizable: true, // Removed - not a valid Node property // Enable resizing for this node
      selectable: true, // Enable selection
      draggable: true, // Enable dragging
    };
    
    console.log('🎨 Created freehand node:', {
      id: newNode.id,
      position: newNode.position,
      width: newNode.width,
      height: newNode.height,
      pointsCount: newNode.data.points.length,
      initialSize: newNode.data.initialSize,
    })

    setNodes((nodes: any[]) => {
      const updatedNodes = [...nodes, newNode]
      console.log('🎨 Added freehand node, total nodes:', updatedNodes.length)
      return updatedNodes
    }); // Add new node to React Flow
    
    // Save freehand node to database if conversationId is available
    if (conversationId) {
      const saveNodeToDatabase = async (retryCount = 0, maxRetries = 3) => {
        try {
          const supabase = createClient() // Create Supabase client
          const { data: { user }, error: authError } = await supabase.auth.getUser() // Get current user
          
          if (authError) {
            console.error('🎨 Auth error when saving freehand node:', authError)
            // Store failed save for retry later
            storeFailedSave(newNode, conversationId)
            return
          }
          
          if (!user) {
            console.warn('🎨 Cannot save freehand node: user not authenticated')
            // Store failed save for retry later
            storeFailedSave(newNode, conversationId)
            return
          }

          // Save node to canvas_nodes table
          const { error, data } = await supabase
            .from('canvas_nodes')
            .insert({
              id: newNode.id, // Use same ID as React Flow node
              conversation_id: conversationId, // Board/conversation ID
              user_id: user.id, // User ID
              node_type: 'freehand', // Node type
              position_x: newNode.position.x, // X position in flow coordinates
              position_y: newNode.position.y, // Y position in flow coordinates
              width: newNode.width, // Node width
              height: newNode.height, // Node height
              data: newNode.data, // Node data (points array, initialSize, etc.)
            })
            .select()
            .single()

          if (error) {
            console.error('🎨 Error saving freehand node to database:', error, {
              code: error.code,
              message: error.message,
              details: error.details,
              hint: error.hint,
            })
            
            // Retry on network errors or temporary failures
            if (retryCount < maxRetries && (
              error.code === 'PGRST116' || // Network error
              error.message?.includes('fetch') || // Network fetch error
              error.message?.includes('network') || // Network error
              error.message?.includes('timeout') || // Timeout error
              !navigator.onLine // Offline
            )) {
              const delay = Math.min(1000 * Math.pow(2, retryCount), 5000) // Exponential backoff, max 5s
              console.log(`🎨 Retrying save in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`)
              setTimeout(() => saveNodeToDatabase(retryCount + 1, maxRetries), delay)
            } else {
              // Store failed save for retry later
              storeFailedSave(newNode, conversationId)
            }
          } else {
            console.log('🎨 ✅ Saved freehand node to database:', newNode.id, data)
            // Remove from failed saves if it was there
            removeFailedSave(newNode.id)
          }
        } catch (error: any) {
          console.error('🎨 Error saving freehand node:', error)
          
          // Retry on network errors
          if (retryCount < maxRetries && (
            error?.message?.includes('fetch') ||
            error?.message?.includes('network') ||
            error?.message?.includes('timeout') ||
            !navigator.onLine
          )) {
            const delay = Math.min(1000 * Math.pow(2, retryCount), 5000)
            console.log(`🎨 Retrying save in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`)
            setTimeout(() => saveNodeToDatabase(retryCount + 1, maxRetries), delay)
          } else {
            // Store failed save for retry later
            storeFailedSave(newNode, conversationId)
          }
        }
      }
      
      // Save asynchronously (don't block UI)
      saveNodeToDatabase()
    }
    
    setPoints([]); // Clear points for next stroke
    pointRef.current = []; // Clear ref for next stroke
  }

  return (
    <div
      className="freehand-overlay" // CSS class for overlay styling
      onPointerDown={handlePointerDown} // Start drawing on pointer down
      onPointerMove={points.length > 0 ? handlePointerMove : undefined} // Continue drawing on move (only if started)
      onPointerUp={handlePointerUp} // Finish drawing on pointer up
    >
      {/* SVG overlay for previewing current stroke */}
      <svg>
        {points.length > 0 && (
          <path 
            d={pointsToPath(points, getViewport().zoom)} 
            className="freehand-path"
          />
        )}
      </svg>
    </div>
  );
}

