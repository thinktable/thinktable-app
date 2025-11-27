'use client'

// React Flow board component - displays chat panels behind input
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  ConnectionMode,
  BackgroundVariant,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { ChatPanelNode } from './chat-panel-node'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useEffect, useRef, useMemo, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown, Plus, ArrowDown } from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

interface ChatPanelNodeData {
  promptMessage: Message
  responseMessage?: Message
  conversationId: string
}

// Fetch messages for a conversation and create panels
async function fetchMessagesForPanels(conversationId: string): Promise<Message[]> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error fetching messages:', error)
    return []
  }
  return (data || []) as Message[]
}

const nodeTypes = {
  chatPanel: ChatPanelNode,
}

function BoardFlowInner({ conversationId }: { conversationId?: string }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesState] = useEdgesState([])
  const prevMessagesKeyRef = useRef<string>('')
  const [isScrollMode, setIsScrollMode] = useState(false) // false = Zoom, true = Scroll
  const [viewMode, setViewMode] = useState<'linear' | 'canvas'>('canvas') // Linear or Canvas view mode
  const reactFlowInstance = useReactFlow()
  const originalPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map()) // Store original positions for Linear mode
  const isLinearModeRef = useRef(false) // Track if we're currently in Linear mode
  const selectedNodeIdRef = useRef<string | null>(null) // Track selected node ID
  const supabase = createClient() // Create Supabase client for creating notes
  const queryClient = useQueryClient() // Query client for invalidating queries
  const prevViewportWidthRef = useRef<number>(0) // Track previous viewport width to detect changes
  const [isAtBottom, setIsAtBottom] = useState(true) // Track if scrolled to bottom in linear mode
  const wasAtBottomRef = useRef(true) // Track if user was at bottom before new messages
  const prevMessagesLengthRef = useRef(0) // Track previous message count
  const prevZoomRef = useRef<number>(1) // Track previous zoom level to detect zoom changes
  const isSwitchingToLinearRef = useRef(false) // Track if we're currently switching to Linear mode

  // Fetch messages if conversationId is provided
  const { data: messages = [], refetch: refetchMessages } = useQuery({
    queryKey: ['messages-for-panels', conversationId],
    queryFn: () => conversationId ? fetchMessagesForPanels(conversationId) : Promise.resolve([]),
    enabled: !!conversationId,
    refetchInterval: 1000, // Refetch every 1 second to pick up new messages (backup if Realtime fails)
    refetchOnWindowFocus: true,
    refetchOnMount: true, // Refetch when component mounts
    refetchOnReconnect: true, // Refetch when reconnecting
  })

  // Set up Supabase Realtime subscription for live message updates
  useEffect(() => {
    if (!conversationId) return

    const supabaseClient = createClient()
    const channel = supabaseClient
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          console.log('New message inserted:', payload.new)
          // Immediately refetch messages when a new one is inserted
          refetchMessages()
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          console.log('Message updated:', payload.new)
          // Refetch when messages are updated
          refetchMessages()
        }
      )
      .subscribe()

    return () => {
      supabaseClient.removeChannel(channel)
    }
  }, [conversationId, refetchMessages])

  // Listen for message updates to refetch immediately (fallback)
  useEffect(() => {
    const handleMessageUpdate = () => {
      // Small delay to ensure database write is complete
      setTimeout(() => {
        refetchMessages()
      }, 100)
    }
    window.addEventListener('message-updated', handleMessageUpdate)
    return () => {
      window.removeEventListener('message-updated', handleMessageUpdate)
    }
  }, [refetchMessages])
  
  // Also refetch when conversationId changes
  useEffect(() => {
    if (conversationId) {
      refetchMessages()
    }
  }, [conversationId, refetchMessages])

  // Listen for window resize to detect sidebar collapse/expand and re-center panels smoothly
  useEffect(() => {
    if (nodes.length === 0) return

    const handleResize = () => {
      const reactFlowElement = document.querySelector('.react-flow')
      if (!reactFlowElement) return

      const currentWidth = reactFlowElement.clientWidth
      if (Math.abs(currentWidth - prevViewportWidthRef.current) < 1) return // No significant change
      
      const previousWidth = prevViewportWidthRef.current
      prevViewportWidthRef.current = currentWidth

      // Only re-center if we had a previous width (not initial load)
      if (previousWidth === 0) return

      // Immediately calculate and apply the correct centered position
      // Calculate offset based on the width change
      const widthChange = currentWidth - previousWidth
      const offsetX = widthChange / 2 // Move panels by half the width change to stay centered

      setNodes((currentNodes) => {
        return currentNodes.map((node) => ({
          ...node,
          position: {
            x: node.position.x + offsetX,
            y: node.position.y,
          },
        }))
      })
    }

    // Initial measurement
    const reactFlowElement = document.querySelector('.react-flow')
    if (reactFlowElement) {
      prevViewportWidthRef.current = reactFlowElement.clientWidth
    }

    window.addEventListener('resize', handleResize)
    // Use ResizeObserver for more accurate detection of sidebar collapse/expand
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        handleResize()
      }
    })

    const reactFlowElementForObserver = document.querySelector('.react-flow')
    if (reactFlowElementForObserver) {
      resizeObserver.observe(reactFlowElementForObserver)
    }

    return () => {
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length]) // Only re-run when nodes are added/removed

  // Create a stable key from message IDs
  const messagesKey = useMemo(() => {
    return messages.map(m => `${m.id}-${m.content.slice(0, 10)}`).join(',')
  }, [messages])

  // Calculate bottom scroll limit for linear mode (last panel + padding for input box)
  const getBottomScrollLimit = useCallback(() => {
    if (viewMode !== 'linear' || nodes.length === 0) return null
    
    const reactFlowElement = document.querySelector('.react-flow')
    if (!reactFlowElement) return null
    
    const viewport = reactFlowInstance.getViewport()
    const viewportHeight = reactFlowElement.clientHeight
    const panelSpacing = 250
    const panelHeight = 300 // Approximate panel height
    const inputPadding = 200 // Padding for input box at bottom
    
    // Get last panel Y position
    const lastPanelY = Math.max(...nodes.map(n => n.position.y))
    const lastPanelBottom = lastPanelY + panelHeight
    
    // Calculate bottom limit in viewport coordinates
    const bottomLimit = -(lastPanelBottom + inputPadding - viewportHeight / viewport.zoom) * viewport.zoom
    
    return bottomLimit
  }, [viewMode, nodes, reactFlowInstance])

  // Check if scrolled to bottom
  const checkIfAtBottom = useCallback(() => {
    if (viewMode !== 'linear' || nodes.length === 0) {
      setIsAtBottom(true)
      return
    }
    
    const bottomLimit = getBottomScrollLimit()
    if (bottomLimit === null) {
      setIsAtBottom(true)
      return
    }
    
    const viewport = reactFlowInstance.getViewport()
    // Consider at bottom if within 10px of bottom limit
    const isAtBottomThreshold = Math.abs(viewport.y - bottomLimit) < 10
    setIsAtBottom(isAtBottomThreshold)
    wasAtBottomRef.current = isAtBottomThreshold
  }, [viewMode, nodes, reactFlowInstance, getBottomScrollLimit])

  // Scroll to bottom (center on last panel)
  const scrollToBottom = useCallback(() => {
    if (viewMode !== 'linear' || nodes.length === 0) return
    
    const reactFlowElement = document.querySelector('.react-flow')
    if (!reactFlowElement) return
    
    const viewport = reactFlowInstance.getViewport()
    const viewportHeight = reactFlowElement.clientHeight
    const panelSpacing = 250
    const panelHeight = 300
    const inputPadding = 200
    
    // Get last panel position
    const lastPanelY = Math.max(...nodes.map(n => n.position.y))
    const lastPanelCenterY = lastPanelY + panelHeight / 2
    
    // Center viewport on last panel
    reactFlowInstance.setCenter(0, lastPanelCenterY, { zoom: viewport.zoom })
    
    // Then adjust to show bottom with padding
    setTimeout(() => {
      const newViewport = reactFlowInstance.getViewport()
      const bottomLimit = -(lastPanelY + panelHeight + inputPadding - viewportHeight / newViewport.zoom) * newViewport.zoom
      reactFlowInstance.setViewport({
        x: newViewport.x,
        y: bottomLimit,
        zoom: newViewport.zoom,
      })
      setIsAtBottom(true)
      wasAtBottomRef.current = true
    }, 50)
  }, [viewMode, nodes, reactFlowInstance])

  // Track node position changes in Canvas mode to update stored positions
  const handleNodesChange = useCallback((changes: any[]) => {
    // Track selected node
    changes.forEach((change) => {
      if (change.type === 'select' && change.selected) {
        selectedNodeIdRef.current = change.id
      } else if (change.type === 'select' && !change.selected) {
        // If this node was deselected, check if any other node is selected
        const selectedNode = nodes.find((n) => n.id === change.id && n.selected)
        if (!selectedNode) {
          // Check if any other node is selected
          const anySelected = nodes.some((n) => n.id !== change.id && n.selected)
          if (!anySelected) {
            selectedNodeIdRef.current = null
          }
        }
      }
    })
    // Call the original handler first
    onNodesChange(changes)
  }, [onNodesChange, nodes])
  
  // Track selected node from nodes array
  useEffect(() => {
    const selectedNode = nodes.find((n) => n.selected)
    if (selectedNode) {
      selectedNodeIdRef.current = selectedNode.id
    } else {
      selectedNodeIdRef.current = null
    }
  }, [nodes])

  // Sync stored positions with current node positions when in Canvas mode
  // This ensures any moves are remembered
  useEffect(() => {
    if (viewMode === 'canvas' && !isLinearModeRef.current && nodes.length > 0) {
      // Update stored positions with current positions in Canvas mode
      nodes.forEach((node) => {
        originalPositionsRef.current.set(node.id, {
          x: node.position.x,
          y: node.position.y,
        })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, viewMode]) // Update when nodes change (including position changes) in Canvas mode

  // Create panels from messages (group into prompt+response pairs)
  useEffect(() => {
    // Skip if messages haven't actually changed
    if (messagesKey === prevMessagesKeyRef.current) {
      return
    }

    prevMessagesKeyRef.current = messagesKey

    if (!conversationId || messages.length === 0) {
      setNodes([])
      originalPositionsRef.current.clear()
      return
    }

    const newNodes: Node<ChatPanelNodeData>[] = []
    const panelSpacing = 250 // Equidistant spacing for both modes
    let panelIndex = 0 // Track panel index for consistent spacing

    // Calculate centered x position for new panels
    // Always center based on viewport for proper centering
    const reactFlowElement = document.querySelector('.react-flow')
    const viewportWidth = reactFlowElement ? reactFlowElement.clientWidth : 1200
    const panelWidth = 500
    let centeredX = (viewportWidth / 2) - (panelWidth / 2) // Center horizontally
    
    // If we have existing nodes, use their average to maintain alignment
    const existingXPositions = nodes.map(n => n.position.x)
    if (existingXPositions.length > 0) {
      const avgX = existingXPositions.reduce((sum, x) => sum + x, 0) / existingXPositions.length
      // Only use existing average if it's reasonably close to centered (within 200px)
      // Otherwise, use centered position to fix misalignment
      if (Math.abs(avgX - centeredX) < 200) {
        centeredX = avgX
      }
    }

    // Group messages into prompt+response pairs
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i]
      
      if (message.role === 'user') {
        // Find the next assistant message (if exists)
        const responseMessage = messages[i + 1]?.role === 'assistant' ? messages[i + 1] : undefined
        
        const nodeId = `panel-${message.id}`
        // Preserve original position if it exists, otherwise use default centered position
        const originalPos = originalPositionsRef.current.get(nodeId)
        // Use consistent spacing: first panel at 0, then 0 + (index * spacing) to match Linear mode
        // Center horizontally for Canvas mode
        const defaultPos = { x: centeredX, y: 0 + (panelIndex * panelSpacing) }
        
        const panelNode: Node<ChatPanelNodeData> = {
          id: nodeId,
          type: 'chatPanel',
          position: originalPos || defaultPos,
          data: {
            promptMessage: message,
            responseMessage,
            conversationId,
          },
          draggable: viewMode === 'canvas', // Only draggable in Canvas mode
          // Don't use dragHandle - allow dragging from anywhere except text content
        }
        
        // Store original position if not already stored
        if (!originalPos) {
          originalPositionsRef.current.set(nodeId, defaultPos)
        }
        
        newNodes.push(panelNode)
        panelIndex++ // Increment for next panel
      }
    }

    // If in Linear mode, transform positions immediately
    if (viewMode === 'linear') {
      // Use same centering approach as Canvas mode - let React Flow center naturally
      // Stack panels vertically with same equidistant spacing as Canvas mode
      const panelSpacing = 250 // Equidistant spacing (same as Canvas mode)
      const startY = 0 // Start at y=0 so we can position viewport to match visual gap between panels

      // Set default zoom for linear mode (1.0 = 100% zoom for readable panels)
      const linearZoom = 1.0
      
      // Calculate centered X position - start at 0, we'll center via viewport adjustment
      const panelWidth = 500
      const centeredX = 0 // Start at 0, we'll center via viewport X adjustment

      // Apply consistent equidistant spacing: first panel at startY (0), then startY + (index * spacing)
      const linearNodes = newNodes.map((node, index) => ({
        ...node,
        position: {
          x: centeredX, // Use calculated centered position from the start
          y: startY + (index * panelSpacing), // Consistent equidistant spacing starting from first panel
        },
        draggable: false, // Not draggable in Linear mode
      }))

      setNodes(linearNodes)
      
      // Update stored positions with centered positions
      linearNodes.forEach((node) => {
        originalPositionsRef.current.set(node.id, {
          x: node.position.x,
          y: node.position.y,
        })
      })
      
      // Set viewport X and zoom immediately to center panels (before setTimeout for Y positioning)
      // Use double requestAnimationFrame to ensure React Flow has fully updated nodes
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const reactFlowElementForViewport = document.querySelector('.react-flow')
          if (!reactFlowElementForViewport) return

          const viewportWidthForViewport = reactFlowElementForViewport.clientWidth
          
          // Get actual current nodes to ensure we have the latest positions
          const currentNodes = reactFlowInstance.getNodes()
          if (currentNodes.length === 0) return
          
          // Center should be relative to the React Flow container's clientWidth
          const screenCenterX = viewportWidthForViewport / 2
          
          const currentPanelX = currentNodes[0]?.position.x || centeredX
          // Calculate viewport X to center panels: viewportX = screenCenterX - panelWidth/2 - (panelX * zoom)
          const targetViewportX = screenCenterX - (panelWidth / 2) - (currentPanelX * linearZoom)
          
          // Set viewport X and zoom to center panels with correct zoom level
          reactFlowInstance.setViewport({
            x: targetViewportX,
            y: reactFlowInstance.getViewport().y,
            zoom: linearZoom,
          })
          
          // Update zoom ref
          prevZoomRef.current = linearZoom
        })
      })
      
      // Position viewport Y - center on selected node if one is selected
      setTimeout(() => {
        if (linearNodes.length > 0) {
          // Get actual current nodes to ensure we have the latest positions
          const currentNodes = reactFlowInstance.getNodes()
          if (currentNodes.length === 0) return
          
          // Get first panel Y position (should be 0 now)
          const firstPanelY = Math.min(...currentNodes.map(n => n.position.y))
          
          // Position viewport so first panel has the same gap above it as between consecutive panels
          // Use the same panelSpacing value (250px) for consistency - all gaps determined by same metric
          const topPadding = panelSpacing // Same spacing as between consecutive panels
          const targetY = -(firstPanelY - topPadding) * linearZoom
          
          // Recalculate viewport X to ensure panels stay centered using current nodes
          const reactFlowElementForY = document.querySelector('.react-flow')
          if (reactFlowElementForY) {
            const viewportWidthForY = reactFlowElementForY.clientWidth
            const screenCenterX = viewportWidthForY / 2
            const currentPanelX = currentNodes[0]?.position.x || centeredX
            // Use same formula: viewportX = screenCenterX - panelWidth/2 - (panelX * zoom)
            const targetViewportX = screenCenterX - (panelWidth / 2) - (currentPanelX * linearZoom)
          
            // Adjust viewport Y and ensure X stays centered with correct zoom
            reactFlowInstance.setViewport({
              x: targetViewportX,
              y: targetY,
              zoom: linearZoom,
            })
          }
        }
      }, 150)
    } else {
      // Canvas mode - ensure panels are centered
      setNodes(newNodes)
      
      // Center panels horizontally in Canvas mode
      setTimeout(() => {
        if (newNodes.length > 0) {
          const reactFlowElement = document.querySelector('.react-flow')
          if (!reactFlowElement) return
          
          const viewportWidth = reactFlowElement.clientWidth
          const viewport = reactFlowInstance.getViewport()
          const panelWidth = 500
          
          const minX = Math.min(...newNodes.map(n => n.position.x))
          const maxX = Math.max(...newNodes.map(n => n.position.x))
          const boundsWidth = maxX - minX + panelWidth
          const boundsCenterX = minX + boundsWidth / 2
          
          // Center horizontally
          const centerX = (viewportWidth / 2 - viewport.x) / viewport.zoom
          const offsetX = centerX - boundsCenterX
          
          // Only reposition if offset is significant (more than 10px)
          if (Math.abs(offsetX) > 10) {
            const repositionedNodes = newNodes.map((node) => ({
              ...node,
              position: {
                x: node.position.x + offsetX,
                y: node.position.y,
              },
            }))
            
            setNodes(repositionedNodes)
            
            // Update stored positions
            repositionedNodes.forEach((node) => {
              originalPositionsRef.current.set(node.id, {
                x: node.position.x,
                y: node.position.y,
              })
            })
          }
        }
      }, 100)
    }
  }, [messagesKey, conversationId, messages.length, viewMode, setNodes])

  // Handle wheel events for scroll mode (only vertical in Linear mode)
  useEffect(() => {
    // In Linear mode, always enable vertical scrolling
    // In Canvas mode, only enable if Scroll mode is active
    if (viewMode === 'linear' || isScrollMode) {
      const handleWheel = (e: WheelEvent) => {
        // Check if we're over the React Flow canvas
        const target = e.target as HTMLElement
        const reactFlowElement = target.closest('.react-flow')
        if (!reactFlowElement) {
          return
        }

        // Handle zoom in linear mode - zoom around horizontal center of map area
        if (viewMode === 'linear' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          e.stopPropagation()

          const viewport = reactFlowInstance.getViewport()
          const reactFlowRect = reactFlowElement.getBoundingClientRect()
          
          // Calculate the horizontal center of the map area (above prompt input)
          const mapCenterX = reactFlowRect.width / 2
          
          // Convert screen center to flow coordinates at current zoom
          // screenX = flowX * zoom + viewport.x
          // flowX = (screenX - viewport.x) / zoom
          const flowCenterX = (mapCenterX - viewport.x) / viewport.zoom
          
          // Calculate zoom delta (React Flow uses exponential zoom)
          const zoomFactor = 1 + (e.deltaY > 0 ? -0.1 : 0.1)
          const newZoom = Math.max(0.1, Math.min(2, viewport.zoom * zoomFactor))
          
          // Calculate new viewport X to keep the center point fixed
          // We want: mapCenterX = flowCenterX * newZoom + newViewportX
          // Solving: newViewportX = mapCenterX - flowCenterX * newZoom
          const newViewportX = mapCenterX - flowCenterX * newZoom
          
          // Apply zoom centered on horizontal center
          reactFlowInstance.setViewport({
            x: newViewportX,
            y: viewport.y,
            zoom: newZoom,
          })
          
          // Update zoom ref
          prevZoomRef.current = newZoom
          return
        }

        // Allow Ctrl/Cmd+scroll for zoom even in scroll mode (but not in linear mode, handled above)
        if (e.ctrlKey || e.metaKey) {
          return
        }

        e.preventDefault()
        e.stopPropagation()

        const viewport = reactFlowInstance.getViewport()
        const deltaX = viewMode === 'linear' ? 0 : e.deltaX // No horizontal scroll in Linear mode
        const deltaY = e.deltaY

        // In linear mode, prevent scrolling past bottom
        if (viewMode === 'linear') {
          const bottomLimit = getBottomScrollLimit()
          if (bottomLimit !== null) {
            const newY = viewport.y - deltaY
            // Clamp to bottom limit (can't scroll past bottom)
            const clampedY = Math.max(newY, bottomLimit)
            reactFlowInstance.setViewport({
              x: viewport.x - deltaX,
              y: clampedY,
              zoom: viewport.zoom,
            })
            // Check if at bottom after scroll
            setTimeout(() => checkIfAtBottom(), 10)
            return
          }
        }

        // Pan the viewport based on scroll delta
        reactFlowInstance.setViewport({
          x: viewport.x - deltaX,
          y: viewport.y - deltaY,
          zoom: viewport.zoom,
        })
      }

      // Add event listener with capture to intercept before React Flow
      document.addEventListener('wheel', handleWheel, { passive: false, capture: true })

      return () => {
        document.removeEventListener('wheel', handleWheel, { capture: true })
      }
    }
  }, [isScrollMode, viewMode, reactFlowInstance, getBottomScrollLimit, checkIfAtBottom])

  // Check if at bottom when viewport changes in linear mode
  useEffect(() => {
    if (viewMode === 'linear' && nodes.length > 0) {
      const timeoutId = setTimeout(() => {
        checkIfAtBottom()
      }, 100)
      return () => clearTimeout(timeoutId)
    }
  }, [viewMode, nodes, reactFlowInstance, checkIfAtBottom])

  // Auto-scroll to bottom when new messages arrive (if user was at bottom)
  useEffect(() => {
    if (viewMode === 'linear' && nodes.length > 0) {
      const currentMessagesLength = messages.length
      const prevLength = prevMessagesLengthRef.current
      
      // If new messages were added and user was at bottom, auto-scroll
      if (currentMessagesLength > prevLength && wasAtBottomRef.current) {
        setTimeout(() => {
          scrollToBottom()
        }, 200) // Wait for nodes to update
      }
      
      prevMessagesLengthRef.current = currentMessagesLength
    }
  }, [messages.length, nodes.length, viewMode, scrollToBottom])

  // Handle Linear mode: center and align panels vertically when switching modes
  useEffect(() => {
    if (nodes.length === 0) return

    if (viewMode === 'linear') {
      isLinearModeRef.current = true
      isSwitchingToLinearRef.current = true // Mark that we're switching to Linear mode
      
      // Store current positions before transforming (in case user moved panels in Canvas)
      nodes.forEach((node) => {
        // Always update stored position with current position when switching to Linear
        // This captures any moves the user made in Canvas mode
        originalPositionsRef.current.set(node.id, { x: node.position.x, y: node.position.y })
      })

      // Use same centering approach as Canvas mode - stack vertically, let React Flow center horizontally
      const panelSpacing = 250 // Equidistant spacing (same as Canvas mode)
      const startY = 0 // Start at y=0 so we can position viewport to match visual gap between panels

      // Set default zoom for linear mode (1.0 = 100% zoom for readable panels)
      const linearZoom = 1.0

      // Sort nodes by their stored Y position to maintain order
      const sortedNodes = [...nodes].sort((a, b) => {
        const posA = originalPositionsRef.current.get(a.id)?.y || a.position.y
        const posB = originalPositionsRef.current.get(b.id)?.y || b.position.y
        return posA - posB
      })

      // Calculate centered X position BEFORE creating nodes, using target zoom (1.0) for linear mode
      // We'll set panels at X=0 initially, then center via viewport adjustment
      const panelWidth = 500
      const centeredX = 0 // Start at 0, we'll center via viewport X adjustment

      // Apply consistent equidistant spacing: first panel at startY, then startY + (index * spacing)
      const linearNodes = sortedNodes.map((node, index) => ({
        ...node,
        position: {
          x: centeredX, // Use calculated centered position from the start
          y: startY + (index * panelSpacing), // Consistent equidistant spacing starting from first panel
        },
        draggable: false, // Not draggable in Linear mode
      }))

      // Find selected node index BEFORE transforming to linear (use sortedNodes, not linearNodes)
      const selectedNodeId = selectedNodeIdRef.current
      const selectedNodeIndex = selectedNodeId 
        ? sortedNodes.findIndex((n) => n.id === selectedNodeId)
        : -1
      
      // Update nodes with centered positions
      setNodes(linearNodes)
      
      // Update stored positions with centered positions
      linearNodes.forEach((node) => {
        originalPositionsRef.current.set(node.id, {
          x: node.position.x,
          y: node.position.y,
        })
      })
      
      // Set viewport X and zoom immediately to center panels (before setTimeout for Y positioning)
      // Use double requestAnimationFrame to ensure React Flow has fully updated nodes
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const reactFlowElementForViewport = document.querySelector('.react-flow')
          if (!reactFlowElementForViewport) return

          const viewportWidthForViewport = reactFlowElementForViewport.clientWidth
          
          // Get actual current nodes to ensure we have the latest positions
          const currentNodes = reactFlowInstance.getNodes()
          if (currentNodes.length === 0) return
          
          // Center should be relative to the React Flow container's clientWidth
          const screenCenterX = viewportWidthForViewport / 2
          
          const currentPanelX = currentNodes[0]?.position.x || centeredX
          // Calculate viewport X to center panels: viewportX = screenCenterX - panelWidth/2 - (panelX * zoom)
          const targetViewportX = screenCenterX - (panelWidth / 2) - (currentPanelX * linearZoom)
          
          // Set viewport X and zoom to center panels with correct zoom level
          reactFlowInstance.setViewport({
            x: targetViewportX,
            y: reactFlowInstance.getViewport().y,
            zoom: linearZoom,
          })
          
          // Update zoom ref
          prevZoomRef.current = linearZoom
        })
      })
      
      // Position viewport Y - center on selected node if one is selected
      setTimeout(() => {
        if (linearNodes.length > 0) {
          // Get actual current nodes to ensure we have the latest positions
          const currentNodes = reactFlowInstance.getNodes()
          if (currentNodes.length === 0) return
          
          // Use the linear zoom level we set earlier
          const currentZoom = linearZoom
          
          if (selectedNodeIndex >= 0 && selectedNodeId) {
            // Center on selected node
            const panelHeight = 300 // Approximate panel height
            
            // Find the selected node in current nodes
            const selectedNode = currentNodes.find((n) => n.id === selectedNodeId)
            if (selectedNode) {
                // Calculate viewport X to keep panels centered
                const reactFlowElementForSelected = document.querySelector('.react-flow')
                if (reactFlowElementForSelected) {
                  const viewportWidthForSelected = reactFlowElementForSelected.clientWidth
                  const screenCenterX = viewportWidthForSelected / 2
                  const currentPanelX = selectedNode.position.x
                  // Use same formula: viewportX = screenCenterX - panelWidth/2 - (panelX * zoom)
                  const targetViewportX = screenCenterX - (panelWidth / 2) - (currentPanelX * currentZoom)
                
                // Center the viewport on the selected node (center of the panel)
                const nodeCenterX = selectedNode.position.x + panelWidth / 2
                const nodeCenterY = selectedNode.position.y + panelHeight / 2
                
                // Use setCenter but then adjust X to ensure centering
                reactFlowInstance.setCenter(nodeCenterX, nodeCenterY, { zoom: currentZoom })
                
                // Immediately adjust X to keep centered
                setTimeout(() => {
                  reactFlowInstance.setViewport({
                    x: targetViewportX,
                    y: reactFlowInstance.getViewport().y,
                    zoom: currentZoom,
                  })
                }, 10)
              }
            }
          } else {
            // No selected node - position viewport so first panel has the same gap above it as between panels
            const firstPanelY = Math.min(...currentNodes.map(n => n.position.y))
            const topPadding = panelSpacing // Match the spacing between panels
            const targetY = -(firstPanelY - topPadding) * currentZoom
            
                // Recalculate viewport X to ensure panels stay centered using current nodes
                const reactFlowElementForY = document.querySelector('.react-flow')
                if (reactFlowElementForY) {
                  const viewportWidthForY = reactFlowElementForY.clientWidth
                  const screenCenterX = viewportWidthForY / 2
                  const currentPanelX = currentNodes[0]?.position.x || 0
                  // Use same formula: viewportX = screenCenterX - panelWidth/2 - (panelX * zoom)
                  const targetViewportX = screenCenterX - (panelWidth / 2) - (currentPanelX * currentZoom)
              
              // Adjust viewport Y and ensure X stays centered
              reactFlowInstance.setViewport({
                x: targetViewportX,
                y: targetY,
                zoom: currentZoom,
              })
            }
            
            // Clear the switching flag after a short delay
            setTimeout(() => {
              isSwitchingToLinearRef.current = false
            }, 200)
          }
        }
      }, 100)
    } else {
      isLinearModeRef.current = false
      
      // Restore stored positions when switching back to Canvas
      // These positions include any moves the user made before switching to Linear
      const restoredNodes = nodes.map((node) => {
        const storedPos = originalPositionsRef.current.get(node.id)
        if (storedPos) {
          return {
            ...node,
            position: storedPos,
            draggable: true, // Draggable in Canvas mode
          }
        }
        return {
          ...node,
          draggable: true,
        }
      })

      setNodes(restoredNodes)
      
      // Center panels horizontally and center on selected node if one is selected
      setTimeout(() => {
        if (restoredNodes.length > 0) {
          const reactFlowElement = document.querySelector('.react-flow')
          if (!reactFlowElement) return
          
          const viewportWidth = reactFlowElement.clientWidth
          const viewport = reactFlowInstance.getViewport()
          const panelWidth = 500
          
          const minX = Math.min(...restoredNodes.map(n => n.position.x))
          const maxX = Math.max(...restoredNodes.map(n => n.position.x))
          const boundsWidth = maxX - minX + panelWidth
          const boundsCenterX = minX + boundsWidth / 2
          
          // Center horizontally
          const centerX = (viewportWidth / 2 - viewport.x) / viewport.zoom
          const offsetX = centerX - boundsCenterX
          
          // Only reposition if offset is significant (more than 10px)
          let finalNodes = restoredNodes
          if (Math.abs(offsetX) > 10) {
            finalNodes = restoredNodes.map((node) => ({
              ...node,
              position: {
                x: node.position.x + offsetX,
                y: node.position.y,
              },
            }))
            
            setNodes(finalNodes)
            
            // Update stored positions
            finalNodes.forEach((node) => {
              originalPositionsRef.current.set(node.id, {
                x: node.position.x,
                y: node.position.y,
              })
            })
          }
          
          // Center on selected node if one is selected
          if (selectedNodeIdRef.current) {
            const selectedNode = finalNodes.find((n) => n.id === selectedNodeIdRef.current)
            if (selectedNode) {
              const panelHeight = 300 // Approximate panel height
              const nodeX = selectedNode.position.x + panelWidth / 2
              const nodeY = selectedNode.position.y + panelHeight / 2
              reactFlowInstance.setCenter(nodeX, nodeY)
            }
          }
        }
      }, 100)
      
      // Don't clear originalPositionsRef - we need them for future mode switches
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]) // Only run when viewMode changes, ignore nodes dependency to avoid loops

  // Handle creating a new note
  const handleCreateNote = async () => {
    if (!conversationId) return

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Create a new message with role 'user' and empty content (will be editable)
      const { data: newMessage, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          user_id: user.id,
          role: 'user',
          content: '', // Empty content - user will type it
        })
        .select()
        .single()

      if (error) {
        console.error('Error creating note:', error)
        return
      }

      // Invalidate queries to refresh the board
      await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
      
      // Trigger refetch
      setTimeout(() => {
        queryClient.refetchQueries({ queryKey: ['messages-for-panels', conversationId] })
      }, 200)
    } catch (error) {
      console.error('Failed to create note:', error)
    }
  }

  return (
    <div className="w-full h-full relative">
      {/* Add Note button - centered on left side */}
      {conversationId && (
        <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                className="h-10 w-10 rounded-full bg-white border border-gray-300 shadow-sm hover:bg-gray-50 hover:border-gray-400 transition-colors"
                title="Add note"
              >
                <Plus className="h-5 w-5 text-gray-700" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-32">
              <DropdownMenuItem onClick={handleCreateNote}>
                Note
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesState}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        defaultViewport={{ x: 0, y: 0, zoom: 0.6 }} // Lower default zoom (0.6 instead of 1.0)
        fitView={viewMode === 'canvas'} // Only use fitView in Canvas mode to prevent extra space above first panel in Linear mode
        fitViewOptions={{ padding: 0.2, minZoom: 0.3, maxZoom: 2 }} // Add padding and zoom limits for fitView
        className="bg-gray-50"
        panOnDrag={viewMode === 'canvas'} // Only allow panning in Canvas mode (Linear mode uses scroll)
        zoomOnScroll={!isScrollMode && viewMode !== 'linear'} // Disable zoom on scroll when in Scroll mode or Linear mode (we handle it ourselves)
        zoomOnPinch={true} // Always allow pinch zoom
        zoomOnDoubleClick={!isScrollMode || viewMode === 'linear'} // Disable double-click zoom when in Scroll mode
        minZoom={0.1} // Allow zooming out more
        maxZoom={2} // Limit maximum zoom
        onMove={(event, viewport) => {
          // Skip centering adjustments if we're currently switching to Linear mode
          if (isSwitchingToLinearRef.current) {
            return
          }
          
          // In Linear mode, keep panels centered when zooming
          if (viewMode === 'linear' && nodes.length > 0) {
            const currentZoom = viewport.zoom
            const prevZoom = prevZoomRef.current
            
            // Check if zoom changed (not just pan)
            if (Math.abs(currentZoom - prevZoom) > 0.001) {
              // Zoom changed - adjust viewport X to keep panels centered
              const reactFlowElement = document.querySelector('.react-flow')
              if (reactFlowElement) {
                const viewportWidth = reactFlowElement.clientWidth
                const panelWidth = 500
                
                // Calculate target center in screen coordinates
                const screenCenterX = viewportWidth / 2
                
                // Convert screen center to flow coordinates with new zoom
                // screenX = flowX * zoom + viewport.x
                // flowX = (screenX - viewport.x) / zoom
                const targetFlowCenterX = (screenCenterX - viewport.x) / currentZoom
                
                // We want the left edge of the panel to be centered
                const targetPanelLeftX = targetFlowCenterX - (panelWidth / 2)
                
                // Get current panel X position (all panels should have same X in linear mode)
                const currentPanelX = nodes[0]?.position.x || 0
                
                // Calculate the offset needed to center panels
                const offsetX = targetPanelLeftX - currentPanelX
                
                // Adjust viewport X to compensate for the offset
                // Use formula: viewportX = screenCenterX - panelWidth/2 - (panelX * zoom)
                const targetViewportX = screenCenterX - (panelWidth / 2) - (currentPanelX * currentZoom)
                
                // Only adjust if the difference is significant (more than 1px)
                if (Math.abs(viewport.x - targetViewportX) > 1) {
                  reactFlowInstance.setViewport({
                    x: targetViewportX,
                    y: viewport.y,
                    zoom: currentZoom,
                  })
                }
              }
              
              prevZoomRef.current = currentZoom
            } else {
              // Just panning, update zoom ref
              prevZoomRef.current = currentZoom
            }
            
            // Check if at bottom
            checkIfAtBottom()
          } else {
            // Not in linear mode, just update zoom ref
            prevZoomRef.current = viewport.zoom
          }
        }}
      >
        <Background variant={BackgroundVariant.Dots} />
        <Controls />
        {messages.length > 0 && (
          <MiniMap 
            position="bottom-right"
            nodeColor={(node) => {
              return '#cbd5e1' // Light grey color matching map dots
            }}
            maskColor="rgba(0, 0, 0, 0.1)"
            pannable={true}
            zoomable={true}
            style={{
              borderTopLeftRadius: '0px',
              borderTopRightRadius: '0px',
              borderBottomLeftRadius: '8px',
              borderBottomRightRadius: '8px',
              overflow: 'hidden',
            }}
          />
        )}
      </ReactFlow>
      
      {/* Linear/Canvas toggle with Nav dropdown above minimap - only show when there are messages */}
      {messages.length > 0 && (
        <div className="absolute bottom-[160px] right-[15px] z-10">
        <div className="bg-gray-200 rounded-t-lg p-1 flex items-center gap-1 w-[200px]">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setViewMode('linear')}
            className={cn(
              'px-3 py-1 text-xs h-auto',
              viewMode === 'linear' 
                ? 'bg-white text-gray-900 hover:bg-gray-50' 
                : 'bg-transparent text-gray-700 hover:bg-gray-100'
            )}
          >
            Linear
          </Button>
          {/* Canvas button with nested caret dropdown */}
          <div className={cn(
            'relative px-3 py-1 text-xs rounded-lg flex items-center gap-2 h-auto group',
            viewMode === 'canvas' 
              ? 'bg-white text-gray-900' 
              : 'bg-transparent text-gray-700 hover:bg-gray-100'
          )}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setViewMode('canvas')}
              className={cn(
                'px-0 py-0 h-auto text-xs',
                viewMode === 'canvas' 
                  ? 'text-gray-900 hover:bg-transparent' 
                  : 'text-gray-700 group-hover:text-gray-900'
              )}
            >
              Canvas
            </Button>
            {/* Nav dropdown - smaller button nested inside Canvas button */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'px-1.5 py-0.5 h-auto text-xs rounded',
                    viewMode === 'canvas' 
                      ? 'bg-white text-gray-900 hover:bg-gray-200' 
                      : 'bg-transparent text-gray-700 group-hover:text-gray-900 group-hover:bg-gray-100'
                  )}
                >
                  <ChevronDown className={cn(
                    'h-3 w-3',
                    viewMode === 'canvas' ? 'text-gray-900' : 'text-gray-700 group-hover:text-gray-900'
                  )} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-32">
                <DropdownMenuLabel>Navigation</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={isScrollMode ? 'scroll' : 'zoom'} onValueChange={(value) => setIsScrollMode(value === 'scroll')}>
                  <DropdownMenuRadioItem value="scroll">Scroll</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="zoom">Zoom</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
      )}

      {/* Return to bottom button - only show in linear mode when not at bottom */}
      {viewMode === 'linear' && messages.length > 0 && !isAtBottom && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10">
          <Button
            size="icon"
            onClick={scrollToBottom}
            className="h-10 w-10 rounded-full bg-white border border-gray-300 shadow-lg hover:bg-gray-50 transition-colors"
            title="Scroll to bottom"
          >
            <ArrowDown className="h-5 w-5 text-gray-700" />
          </Button>
        </div>
      )}
    </div>
  )
}

export function BoardFlow({ conversationId }: { conversationId?: string }) {
  return (
    <ReactFlowProvider>
      <BoardFlowInner conversationId={conversationId} />
    </ReactFlowProvider>
  )
}

