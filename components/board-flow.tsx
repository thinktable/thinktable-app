'use client'

// React Flow board component - displays chat panels behind input
import ReactFlow, {
  Node,
  Edge,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  ConnectionMode,
  BackgroundVariant,
  useReactFlow,
  ConnectionLineType,
} from 'reactflow'
import 'reactflow/dist/style.css'
import ELK from 'elkjs/lib/elk.bundled.js'
import { ChatPanelNode } from './chat-panel-node'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useEffect, useRef, useMemo, useState, useCallback } from 'react'
import { useTheme } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown, ArrowDown } from 'lucide-react'
import { useReactFlowContext } from './react-flow-context'
import { useSidebarContext } from './sidebar-context'

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
  isResponseCollapsed?: boolean // Track if response is collapsed for position updates
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

// Define nodeTypes outside component as a module-level constant
// This ensures it's stable and React Flow won't complain about recreation
// Using Object.freeze to ensure immutability
// Note: ChatPanelNode is a stable function component, so this reference won't change
const nodeTypes = Object.freeze({
  chatPanel: ChatPanelNode,
}) as const

// Return to bottom button - aligned to prompt box center with same gap as minimap when jumped
function ReturnToBottomButton({ onClick }: { onClick: () => void }) {
  const [position, setPosition] = useState({ left: '50%', bottom: '168px' })
  const rafRef = useRef<number | null>(null)
  
  useEffect(() => {
    const updatePosition = () => {
      // Find prompt box to align with its center
      const chatTextarea = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]') as HTMLElement
      const promptBox = chatTextarea?.closest('[class*="pointer-events-auto"]') as HTMLElement
      const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
      
      if (promptBox && reactFlowElement) {
        const promptBoxRect = promptBox.getBoundingClientRect()
        const reactFlowRect = reactFlowElement.getBoundingClientRect()
        
        // Calculate prompt box center relative to React Flow container
        const promptBoxCenterX = (promptBoxRect.left + promptBoxRect.right) / 2 - reactFlowRect.left
        
        // Button is 40px wide, so offset by 20px to center it
        const buttonLeft = promptBoxCenterX - 20
        
        // Position 16px above prompt box (same gap as minimap when jumped)
        const promptBoxTop = promptBoxRect.top - reactFlowRect.top
        const bottomFromReactFlow = reactFlowRect.height - promptBoxTop + 16
        
        setPosition({
          left: `${buttonLeft}px`,
          bottom: `${bottomFromReactFlow}px`
        })
      }
    }
    
    // Use requestAnimationFrame loop for smooth tracking
    const tick = () => {
      updatePosition()
      rafRef.current = requestAnimationFrame(tick)
    }
    
    rafRef.current = requestAnimationFrame(tick)
    
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [])
  
  return (
    <div 
      className="absolute z-20"
      style={{
        left: position.left,
        bottom: position.bottom,
        // No transition - immediate positioning for smooth tracking
      }}
    >
      <Button
        size="icon"
        onClick={onClick}
        className="h-10 w-10 rounded-full bg-white dark:bg-[#1f1f1f] border border-gray-300 dark:border-[#2f2f2f] shadow-lg hover:bg-gray-50 dark:hover:bg-[#2a2a2a] transition-colors"
        title="Scroll to bottom"
      >
        <ArrowDown className="h-5 w-5 text-gray-700" />
      </Button>
    </div>
  )
}

function BoardFlowInner({ conversationId }: { conversationId?: string }) {
  const { resolvedTheme } = useTheme()
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesState] = useEdgesState([])
  const prevMessagesKeyRef = useRef<string>('')
  const prevCollapseStatesRef = useRef<Map<string, boolean>>(new Map()) // Track previous collapse states
  
  // Initialize from localStorage for instant access, then sync from Supabase
  const [isScrollMode, setIsScrollMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('thinkable-scroll-mode')
      return saved === 'true'
    }
    return false // false = Zoom, true = Scroll
  })
  
  const [viewMode, setViewMode] = useState<'linear' | 'canvas'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('thinkable-view-mode') as 'linear' | 'canvas' | null
      return saved === 'linear' || saved === 'canvas' ? saved : 'canvas'
    }
    return 'canvas' // Linear or Canvas view mode
  })
  
  const reactFlowInstance = useReactFlow()
  const { setReactFlowInstance, registerSetNodes, isLocked, layoutMode, setLayoutMode, panelWidth: contextPanelWidth, isPromptBoxCentered } = useReactFlowContext()
  const { setIsMobileMode } = useSidebarContext()
  const originalPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map()) // Store original positions for Linear mode
  const isLinearModeRef = useRef(false) // Track if we're currently in Linear mode
  const selectedNodeIdRef = useRef<string | null>(null) // Track selected node ID
  const supabase = createClient() // Create Supabase client for creating notes
  const queryClient = useQueryClient() // Query client for invalidating queries
  const prevViewportWidthRef = useRef<number>(0) // Track previous viewport width to detect changes
  const [isAtBottom, setIsAtBottom] = useState(true) // Track if scrolled to bottom in linear mode
  const [minimapBottom, setMinimapBottom] = useState<number>(17) // Default position 2px higher
  const [minimapRight, setMinimapRight] = useState<number>(15) // Dynamic right position to align with prompt box when jumped (default: 15px)
  const [isMinimapHidden, setIsMinimapHidden] = useState(false) // Track if minimap is hidden
  const [isMinimapManuallyHidden, setIsMinimapManuallyHidden] = useState(false) // Track if minimap was manually hidden (vs auto-hidden)
  const [isMinimapHovering, setIsMinimapHovering] = useState(false) // Track if mouse is hovering over minimap area
  const [isBottomGapHovering, setIsBottomGapHovering] = useState(false) // Track if hovering over bottom gap (shared with prompt pill)
  const wasAboveThresholdRef = useRef(true) // Track if we were above auto-hide threshold
  const wasAutoHiddenRef = useRef(false) // Track if minimap was auto-hidden (vs manually hidden while shrunken)
  const fitViewInProgressRef = useRef(false) // Track when fitView is in progress to prevent onMove interference
  const savedZoomRef = useRef<{ linear: number | null; canvas: number | null }>({ linear: null, canvas: null }) // Store zoom for each mode
  const selectionJustChangedRef = useRef(false) // Track if selection just changed to prevent viewport jumps
  const previousViewportYRef = useRef<number | null>(null) // Track previous viewport Y to detect jumps
  
  // Listen for bottom gap hover events (dispatched by prompt input hover zone)
  useEffect(() => {
    const handleBottomGapHover = (event: CustomEvent<{ hovering: boolean }>) => {
      setIsBottomGapHovering(event.detail.hovering)
    }
    
    window.addEventListener('bottom-gap-hover', handleBottomGapHover as EventListener)
    
    return () => {
      window.removeEventListener('bottom-gap-hover', handleBottomGapHover as EventListener)
    }
  }, [])

  // Share setNodes with context for toolbar access (lock button)
  // Note: setNodes from useNodesState is stable, so this should only run once on mount
  useEffect(() => {
    registerSetNodes(setNodes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount - setNodes and registerSetNodes are stable

  // Update all nodes when lock state changes (but not when nodes change from other sources)
  // This matches React Flow's Controls lock button behavior
  const prevIsLockedRef = useRef(isLocked)
  const prevViewModeRef = useRef(viewMode)
  useEffect(() => {
    // Only update if lock state or viewMode actually changed
    if (prevIsLockedRef.current === isLocked && prevViewModeRef.current === viewMode) {
      return
    }
    
    // Safety check: ensure nodes is defined and is an array
    if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
      prevIsLockedRef.current = isLocked
      prevViewModeRef.current = viewMode
      return
    }
    
    // Determine target draggable state based on lock and viewMode
    // Locked = nodes cannot be dragged or connected
    // Unlocked + Canvas mode = nodes can be dragged
    // Unlocked + Linear mode = nodes cannot be dragged (Linear mode uses scroll, not drag)
    const targetDraggable = isLocked ? false : (viewMode === 'canvas')
    const targetConnectable = isLocked ? false : true // Connectable in both modes
    
    // Check if nodes already have the correct state to avoid unnecessary updates
    // This prevents infinite loops and unnecessary re-renders
    const needsUpdate = nodes.some(
      (node) => node.draggable !== targetDraggable || node.connectable !== targetConnectable
    )
    
    // Only update if nodes need to change (prevents unnecessary re-renders and potential loops)
    if (needsUpdate) {
      // Update all nodes with new draggable/connectable state (same as React Flow Controls lock button)
      setNodes(
        nodes.map((node) => ({
          ...node,
          draggable: targetDraggable,
          connectable: targetConnectable,
        }))
      )
    }
    
    prevIsLockedRef.current = isLocked
    prevViewModeRef.current = viewMode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocked, viewMode]) // Only depend on lock state and viewMode (not nodes or setNodes to avoid infinite loops)
  const wasAtBottomRef = useRef(true) // Track if user was at bottom before new messages
  const prevMessagesLengthRef = useRef(0) // Track previous message count
  const prevZoomRef = useRef<number>(1) // Track previous zoom level to detect zoom changes
  const isSwitchingToLinearRef = useRef(false) // Track if we're currently switching to Linear mode
  const preferencesLoadedRef = useRef(false) // Track if preferences have been loaded from Supabase
  const nodeHeightsRef = useRef<Map<string, number>>(new Map()) // Store measured node heights
  const savePositionsTimeoutRef = useRef<NodeJS.Timeout | null>(null) // Debounce position saves
  const minimapDragStartRef = useRef<{ x: number; y: number; isDragging?: boolean } | null>(null) // Track minimap drag start position and drag state

  // Load user preferences from localStorage only (profiles.metadata column doesn't exist yet)
  // TODO: Add profiles.metadata column via migration if needed for cross-device sync
  useEffect(() => {
    // Preferences are already loaded from localStorage in useState initializers
    // This effect is kept for future Supabase sync if metadata column is added
    preferencesLoadedRef.current = true
  }, [])

  // Save preferences to localStorage (instant) and Supabase (sync) when they change
  useEffect(() => {
    if (!preferencesLoadedRef.current) return // Don't save before loading
    
    // Save to localStorage immediately (lightweight, instant)
    if (typeof window !== 'undefined') {
      localStorage.setItem('thinkable-view-mode', viewMode)
      localStorage.setItem('thinkable-scroll-mode', String(isScrollMode))
    }
    
    // Note: Supabase profiles.metadata column doesn't exist yet
    // TODO: Add profiles.metadata column via migration if cross-device sync is needed
    // For now, we only use localStorage
  }, [viewMode, isScrollMode])

  // Fetch messages if conversationId is provided
  const { data: messages = [], refetch: refetchMessages } = useQuery({
    queryKey: ['messages-for-panels', conversationId],
    queryFn: () => conversationId ? fetchMessagesForPanels(conversationId) : Promise.resolve([]),
    enabled: !!conversationId,
    refetchInterval: 500, // Refetch every 500ms to pick up new messages (more aggressive for deterministic mapping)
    refetchOnWindowFocus: true,
    refetchOnMount: true, // Refetch when component mounts
    refetchOnReconnect: true, // Refetch when reconnecting
  })

  // Handle responsive minimap positioning - move up when prompt box gets close (within 16px gap, same as top bar right margin)
  // This also affects toggle position even when minimap is hidden
  useEffect(() => {
    const checkMinimapPosition = () => {
      // Get React Flow container element
      const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
      
      // Get actual prompt box element - find the input container at the bottom
      // Look for the chat input textarea or its parent container
      const chatInputElement = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]') as HTMLElement
      
      if (!chatInputElement || !reactFlowElement) {
        // Fallback: use default position if elements not found
        setMinimapBottom(17) // Default position 2px higher
        setMinimapRight(15)
        return
      }
      
      // Get the prompt box container (parent of the input)
      const promptBoxContainer = chatInputElement.closest('[class*="pointer-events-auto"]') as HTMLElement
      if (!promptBoxContainer) {
        setMinimapBottom(17) // Default position 2px higher
        setMinimapRight(15)
        return
      }
      
      // Get actual positions
      const promptBoxRect = promptBoxContainer.getBoundingClientRect()
      const reactFlowRect = reactFlowElement.getBoundingClientRect()
      
      // Calculate prompt box right edge (relative to React Flow container)
      const promptBoxRightEdge = promptBoxRect.right - reactFlowRect.left
      
      // Calculate what the minimap's left edge would be in its default position
      // Default: 15px from right, minimap width is 179px
      const reactFlowWidth = reactFlowElement.clientWidth
      const defaultMinimapRight = 15
      const minimapWidth = 179
      const defaultMinimapLeftEdge = reactFlowWidth - defaultMinimapRight - minimapWidth
      
      // Calculate gap between prompt box and default minimap position
      const gap = defaultMinimapLeftEdge - promptBoxRightEdge
      
      // Top bar right margin is 16px - use same gap threshold
      const gapThreshold = 16
      
      // If gap is less than threshold, move minimap and toggle up and right-align with prompt box
      if (gap < gapThreshold) {
        setMinimapBottom(79) // 17px default + 62px up = 79px from bottom (2px higher than before)
        // Calculate right position to align minimap's right edge with prompt box's right edge
        const rightPosition = reactFlowWidth - promptBoxRightEdge
        setMinimapRight(rightPosition)
      } else {
        setMinimapBottom(17) // Default position at bottom (2px higher)
        setMinimapRight(15) // Reset to default right positioning (15px from React Flow)
      }
    }

    checkMinimapPosition()
    window.addEventListener('resize', checkMinimapPosition)
    
    // Also watch for prompt box position/size changes (it can move/change size)
    // This ensures minimap and toggle jump even when minimap is hidden
    const setupObservers = () => {
      const chatInputElement = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]') as HTMLElement
      if (chatInputElement) {
        const promptBoxContainer = chatInputElement.closest('[class*="pointer-events-auto"]') as HTMLElement
        if (promptBoxContainer) {
          const resizeObserver = new ResizeObserver(() => {
            checkMinimapPosition()
          })
          resizeObserver.observe(promptBoxContainer)
          
          return () => {
            resizeObserver.disconnect()
          }
        }
      }
      return () => {}
    }
    
    const cleanupObservers = setupObservers()
    
    return () => {
      window.removeEventListener('resize', checkMinimapPosition)
      cleanupObservers()
    }
  }, [isMinimapHidden]) // Re-run when minimap visibility changes to ensure toggle position updates

  // Auto-hide minimap when window shrinks below threshold, auto-show when expanded (if not manually closed while expanded)
  // Also triggers mobile mode for sidebar (sidebar hides, toggle moves to top bar)
  useEffect(() => {
    const MINIMAP_AUTO_HIDE_THRESHOLD = 900 // Window width threshold to auto-hide minimap
    
    const checkMinimapAutoHide = () => {
      const windowWidth = window.innerWidth
      const isAboveThreshold = windowWidth >= MINIMAP_AUTO_HIDE_THRESHOLD
      const wasAbove = wasAboveThresholdRef.current
      
      if (!isAboveThreshold && wasAbove) {
        // Window just crossed BELOW threshold - auto-hide minimap and enable mobile mode
        if (!isMinimapHidden) {
          setIsMinimapHidden(true)
          wasAutoHiddenRef.current = true // Mark as auto-hidden
        }
        setIsMobileMode(true) // Enable mobile mode - hides sidebar
      } else if (isAboveThreshold && !wasAbove) {
        // Window just crossed ABOVE threshold - auto-show if it was auto-hidden or not manually hidden
        if (isMinimapHidden && (wasAutoHiddenRef.current || !isMinimapManuallyHidden)) {
          setIsMinimapHidden(false)
          wasAutoHiddenRef.current = false
        }
        setIsMobileMode(false) // Disable mobile mode - shows sidebar normally
      }
      
      wasAboveThresholdRef.current = isAboveThreshold
    }
    
    // Initial check - set both ref and mobile mode state
    const initialAboveThreshold = window.innerWidth >= MINIMAP_AUTO_HIDE_THRESHOLD
    wasAboveThresholdRef.current = initialAboveThreshold
    setIsMobileMode(!initialAboveThreshold) // Set initial mobile mode state
    
    window.addEventListener('resize', checkMinimapAutoHide)
    
    return () => {
      window.removeEventListener('resize', checkMinimapAutoHide)
    }
  }, [isMinimapHidden, isMinimapManuallyHidden, setIsMobileMode])

  // Handle minimap click for fitView - clicking anywhere on minimap triggers fit view (same as Controls frame button)
  // Uses the same fitViewOptions as defined in ReactFlow props
  // We need to attach listeners directly to the minimap DOM element after React Flow renders it
  useEffect(() => {
    if (messages.length === 0 || !reactFlowInstance || isMinimapHidden) return

    let minimapElement: HTMLElement | null = null
    let cleanup: (() => void) | null = null

    // Function to attach listeners to minimap element
    const attachListeners = () => {
      // Find the minimap element - React Flow renders it with class 'react-flow__minimap'
      minimapElement = document.querySelector('.react-flow__minimap') as HTMLElement
      
      if (!minimapElement) {
        return false
      }

      let clickTimeoutId: NodeJS.Timeout | null = null

      const handleMouseDown = (e: MouseEvent) => {
        // Only process if the click is on the minimap element or its children
        const target = e.target as HTMLElement
        if (!minimapElement || !minimapElement.contains(target)) return
        
        // Clear any existing timeout
        if (clickTimeoutId) {
          clearTimeout(clickTimeoutId)
          clickTimeoutId = null
        }
        
        // Record the starting position for click vs drag detection
        minimapDragStartRef.current = { 
          x: e.clientX, 
          y: e.clientY,
          isDragging: false // Initialize as not dragging
        }
        
        // Fallback: If mouseup doesn't fire within 200ms, trigger centering anyway
        // This handles cases where React Flow prevents mouseup from reaching our handler
        clickTimeoutId = setTimeout(() => {
          if (minimapDragStartRef.current && !minimapDragStartRef.current.isDragging) {
            // Use the same centering logic as handleMouseUp
            // For fallback, we'll just do fitView since we don't have the exact click position
            if (reactFlowInstance) {
              fitViewInProgressRef.current = true
              
              const topBar = document.querySelector('[class*="bg-white"][class*="shadow-sm"][class*="border-b"]') as HTMLElement
              const inputBox = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]')?.closest('[class*="pointer-events-auto"]') as HTMLElement
              const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
              
              let topPadding = 0
              let bottomPadding = 0
              
              if (topBar && reactFlowElement) {
                const topBarHeight = topBar.offsetHeight
                const reactFlowHeight = reactFlowElement.offsetHeight
                if (topBarHeight > 0) {
                  topPadding = topBarHeight / reactFlowHeight
                }
              }
              
              if (inputBox && reactFlowElement) {
                const inputBoxRect = inputBox.getBoundingClientRect()
                const reactFlowRect = reactFlowElement.getBoundingClientRect()
                const inputBoxHeight = reactFlowRect.bottom - inputBoxRect.top + 16
                const reactFlowHeight = reactFlowElement.offsetHeight
                if (inputBoxHeight > 0 && inputBoxHeight < reactFlowHeight) {
                  bottomPadding = inputBoxHeight / reactFlowHeight
                }
              }
              
              const uiPadding = Math.max(topPadding, bottomPadding, 0.05)
              
              const fitViewOptions = viewMode === 'linear' 
                ? { padding: uiPadding, minZoom: 0.1, maxZoom: 1, duration: 300 }
                : { padding: Math.max(uiPadding, 0.1), minZoom: 0.3, maxZoom: 2, duration: 300 }
              reactFlowInstance.fitView(fitViewOptions)
              setTimeout(() => {
                fitViewInProgressRef.current = false
              }, 350)
            }
            minimapDragStartRef.current = null
          }
          clickTimeoutId = null
        }, 200)
        
        // Don't prevent default - allow React Flow's drag to work
      }

      const handleMouseMove = (e: MouseEvent) => {
        // Track if user is dragging (mouse moved significantly)
        // Only check if we have a valid drag start (from minimap mousedown)
        if (!minimapDragStartRef.current) return
        
        const deltaX = Math.abs(e.clientX - minimapDragStartRef.current.x)
        const deltaY = Math.abs(e.clientY - minimapDragStartRef.current.y)
        
        // Mark as drag if movement is significant (more than 15px)
        // This threshold distinguishes intentional drags from accidental movement during clicks
        if (deltaX > 15 || deltaY > 15) {
          minimapDragStartRef.current.isDragging = true
        }
      }

      const handleMouseUp = (e: MouseEvent) => {
        // Clear the fallback timeout since mouseup fired
        if (clickTimeoutId) {
          clearTimeout(clickTimeoutId)
          clickTimeoutId = null
        }
        
        if (!minimapDragStartRef.current) return
        
        // Check if it was actually a drag
        const wasDragging = minimapDragStartRef.current.isDragging
        
        // If it was a drag, don't trigger centering (allow React Flow's minimap drag to work)
        if (wasDragging) {
          minimapDragStartRef.current = null
          return
        }
        
        // It was a click (no significant drag) - center clicked node on prompt box
        requestAnimationFrame(() => {
          if (!reactFlowInstance || !nodes || !Array.isArray(nodes)) return
          
          // Find which node was clicked by checking click coordinates against minimap node positions
          const minimapSvg = minimapElement?.querySelector('svg')
          let clickedNode: Node | null = null
          
          if (minimapSvg && nodes && nodes.length > 0) {
            const minimapRect = minimapSvg.getBoundingClientRect()
            const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
            if (reactFlowElement) {
              const reactFlowRect = reactFlowElement.getBoundingClientRect()
              const viewport = reactFlowInstance.getViewport()
              
              // Convert click position to normalized minimap coordinates (0-1)
              const minimapX = (e.clientX - minimapRect.left) / minimapRect.width
              const minimapY = (e.clientY - minimapRect.top) / minimapRect.height
              
              // Find node closest to click position
              let closestNode = null
              let closestDistance = Infinity
              
              nodes.forEach((node) => {
                // Convert node world position to normalized screen coordinates
                const nodeScreenX = (node.position.x * viewport.zoom) + viewport.x
                const nodeScreenY = (node.position.y * viewport.zoom) + viewport.y
                const nodeNormalizedX = nodeScreenX / reactFlowRect.width
                const nodeNormalizedY = nodeScreenY / reactFlowRect.height
                
                const distance = Math.sqrt(
                  Math.pow(nodeNormalizedX - minimapX, 2) + 
                  Math.pow(nodeNormalizedY - minimapY, 2)
                )
                
                if (distance < closestDistance) {
                  closestDistance = distance
                  closestNode = node
                }
              })
              
              // If click is close to a node (within reasonable threshold), use it
              if (closestNode && closestDistance < 0.15) {
                clickedNode = closestNode
              }
            }
          }
          
          if (clickedNode) {
            // Center the clicked node - horizontally on prompt box, vertically based on mode
            fitViewInProgressRef.current = true
            
            const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
            const chatTextarea = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]') as HTMLElement
            const promptBox = chatTextarea?.closest('[class*="pointer-events-auto"]') as HTMLElement
            
            if (reactFlowElement && promptBox) {
              const promptBoxRect = promptBox.getBoundingClientRect()
              const reactFlowRect = reactFlowElement.getBoundingClientRect()
              const promptBoxCenterX = (promptBoxRect.left + promptBoxRect.right) / 2 - reactFlowRect.left
              const promptBoxTop = promptBoxRect.top - reactFlowRect.top
              
              const panelWidth = 768
              const panelHeight = nodeHeightsRef.current.get(clickedNode.id) || 400 // Use actual height or estimate
              const currentZoom = reactFlowInstance.getViewport().zoom
              
              // Always center horizontally on prompt box (both modes)
              // Formula: screenX = worldX * zoom + viewportX
              // We want: (clickedNode.position.x + panelWidth/2) * zoom + viewportX = promptBoxCenterX
              // So: viewportX = promptBoxCenterX - (clickedNode.position.x + panelWidth/2) * zoom
              const targetViewportX = promptBoxCenterX - (clickedNode.position.x + panelWidth / 2) * currentZoom
              
              let targetViewportY: number
              
              // Both modes: position panel above prompt box (centered over it)
              const gapAbovePrompt = 16 // Same gap as minimap jump
              // Position panel above prompt box: panel bottom = prompt box top - gap
              // Panel center Y in screen = promptBoxTop - gap - panelHeight/2
              // Panel center Y in world = clickedNode.position.y + panelHeight/2
              // Viewport Y = screenY - (worldY * zoom)
              const panelBottomScreenY = promptBoxTop - gapAbovePrompt
              const panelCenterScreenY = panelBottomScreenY - panelHeight / 2
              const panelCenterWorldY = clickedNode.position.y + panelHeight / 2
              targetViewportY = panelCenterScreenY - (panelCenterWorldY * currentZoom)
              
              reactFlowInstance.setViewport({ x: targetViewportX, y: targetViewportY, zoom: currentZoom }, { duration: 200 })
            }
            
            setTimeout(() => {
              fitViewInProgressRef.current = false
            }, 250)
          } else {
            // No specific node clicked - fall back to fitView
            fitViewInProgressRef.current = true
            
            // Check if top bar and input box are visible to adjust fitView padding
            const topBar = document.querySelector('[class*="bg-white"][class*="shadow-sm"][class*="border-b"]') as HTMLElement
            const inputBox = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]')?.closest('[class*="pointer-events-auto"]') as HTMLElement
            const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
            
            // Calculate padding based on visible UI elements
            let topPadding = 0
            let bottomPadding = 0
            
            if (topBar && reactFlowElement) {
              const topBarHeight = topBar.offsetHeight
              const reactFlowHeight = reactFlowElement.offsetHeight
              if (topBarHeight > 0) {
                topPadding = topBarHeight / reactFlowHeight
              }
            }
            
            if (inputBox && reactFlowElement) {
              const inputBoxRect = inputBox.getBoundingClientRect()
              const reactFlowRect = reactFlowElement.getBoundingClientRect()
              const inputBoxHeight = reactFlowRect.bottom - inputBoxRect.top + 16
              const reactFlowHeight = reactFlowElement.offsetHeight
              if (inputBoxHeight > 0 && inputBoxHeight < reactFlowHeight) {
                bottomPadding = inputBoxHeight / reactFlowHeight
              }
            }
            
            const uiPadding = Math.max(topPadding, bottomPadding, 0.05)
            
            // In linear mode, allow zooming out more to fit all panels vertically
            const fitViewOptions = viewMode === 'linear' 
              ? { padding: uiPadding, minZoom: 0.1, maxZoom: 1, duration: 300 }
              : { padding: Math.max(uiPadding, 0.1), minZoom: 0.3, maxZoom: 2, duration: 300 }
            reactFlowInstance.fitView(fitViewOptions)
            // Clear flag after fitView animation completes
            setTimeout(() => {
              fitViewInProgressRef.current = false
            }, 350)
          }
        })
        
        // Reset drag start position
        minimapDragStartRef.current = null
      }

      // Attach mousedown listener to minimap element (capture phase to catch before React Flow)
      // Attach mousemove and mouseup listeners to document to catch them even if React Flow prevents them on minimap
      minimapElement.addEventListener('mousedown', handleMouseDown, true)
      document.addEventListener('mousemove', handleMouseMove, true)
      document.addEventListener('mouseup', handleMouseUp, true)

      cleanup = () => {
        if (clickTimeoutId) {
          clearTimeout(clickTimeoutId)
          clickTimeoutId = null
        }
        minimapElement?.removeEventListener('mousedown', handleMouseDown, true)
        document.removeEventListener('mousemove', handleMouseMove, true)
        document.removeEventListener('mouseup', handleMouseUp, true)
      }

      return true
    }

    // Try to attach immediately
    if (!attachListeners()) {
      // If minimap not found, wait a bit and try again
      const timeoutId = setTimeout(() => {
        attachListeners()
      }, 500)

      return () => {
        clearTimeout(timeoutId)
        if (cleanup) cleanup()
      }
    }

    return () => {
      if (cleanup) cleanup()
    }
  }, [messages.length, reactFlowInstance, isMinimapHidden, viewMode]) // Re-attach when minimap visibility or view mode changes

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
          console.log('🔄 BoardFlow: Realtime - New message inserted:', payload.new?.id, 'role:', payload.new?.role)
          // Immediately refetch messages when a new one is inserted
          // For deterministic mapping, multiple messages might be inserted quickly
          refetchMessages().then((result) => {
            console.log('🔄 BoardFlow: Realtime refetch result:', result.data?.length, 'messages')
          }).catch((error) => {
            console.error('🔄 BoardFlow: Realtime refetch error:', error)
          })
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
      console.log('🔄 BoardFlow: message-updated event received, refetching messages')
      // Small delay to ensure database write is complete
      // For deterministic mapping, messages are created server-side, so we need a longer delay
      setTimeout(() => {
        refetchMessages().then((result) => {
          console.log('🔄 BoardFlow: Refetch result:', result.data?.length, 'messages')
          // If we got messages, trigger another refetch after a short delay to catch any late-arriving messages
          if (result.data && result.data.length > 0) {
            setTimeout(() => {
              console.log('🔄 BoardFlow: Second refetch attempt (for deterministic mapping)')
              refetchMessages().then((result2) => {
                console.log('🔄 BoardFlow: Second refetch result:', result2.data?.length, 'messages')
              })
            }, 500)
          }
        }).catch((error) => {
          console.error('🔄 BoardFlow: Refetch error:', error)
        })
      }, 200) // Increased delay for deterministic mapping
    }
    window.addEventListener('message-updated', handleMessageUpdate)
    return () => {
      window.removeEventListener('message-updated', handleMessageUpdate)
    }
  }, [refetchMessages])

  // Listen for edges-created event to create React Flow edges from AI-determined connections
  useEffect(() => {
    const handleEdgesCreated = (event: CustomEvent<{ edges: Array<{ sourcePanelMessageId: string; targetPanelMessageId: string }> }>) => {
      console.log('🔄 BoardFlow: edges-created event received, creating React Flow edges')
      const edgesData = event.detail.edges
      
      if (!edgesData || !Array.isArray(edgesData) || edgesData.length === 0) {
        console.log('🔄 BoardFlow: No edges to create')
        return
      }

      // Wait a bit for panels to be created from messages
      setTimeout(() => {
        // Get current nodes to find panel node IDs
        const currentNodes = reactFlowInstance?.getNodes() || nodes
        
        // Create edges by finding the corresponding panel nodes
        const newEdges: Edge[] = []
        
        for (const edgeData of edgesData) {
          // Convert message IDs to panel node IDs
          // Source panel: panel-{sourcePanelMessageId}
          // Target panel: panel-{targetPanelMessageId}
          const sourceNodeId = `panel-${edgeData.sourcePanelMessageId}`
          const targetNodeId = `panel-${edgeData.targetPanelMessageId}`
          
          // Find the nodes
          const sourceNode = currentNodes.find(n => n.id === sourceNodeId || n.id.startsWith(`${sourceNodeId}-`))
          const targetNode = currentNodes.find(n => n.id === targetNodeId || n.id.startsWith(`${targetNodeId}-`))
          
          if (sourceNode && targetNode) {
            // Use the actual node IDs (might have -0, -1 suffix for multiple panels from same prompt)
            const actualSourceId = sourceNode.id
            const actualTargetId = targetNode.id
            
            const newEdge: Edge = {
              id: `${actualSourceId}-${actualTargetId}`,
              source: actualSourceId,
              target: actualTargetId,
              sourceHandle: 'right', // Connect from right handle
              targetHandle: 'left', // Connect to left handle
              type: 'smoothstep', // Use smoothstep for ELK-style routing
            }
            newEdges.push(newEdge)
            console.log(`🔄 BoardFlow: Preparing edge: ${actualSourceId} -> ${actualTargetId}`)
          } else {
            console.warn(`🔄 BoardFlow: Could not find nodes for edge: ${sourceNodeId} -> ${targetNodeId}`, {
              sourceNode: sourceNode ? sourceNode.id : 'not found',
              targetNode: targetNode ? targetNode.id : 'not found',
              availableNodes: currentNodes.map(n => n.id)
            })
          }
        }
        
        if (newEdges.length > 0) {
          console.log(`🔄 BoardFlow: Adding ${newEdges.length} new edges to React Flow`)
          setEdges((eds) => {
            // Filter out any edges that already exist
            const edgesToAdd = newEdges.filter(newEdge => 
              !eds.some(existingEdge => 
                existingEdge.source === newEdge.source && existingEdge.target === newEdge.target
              )
            )
            if (edgesToAdd.length > 0) {
              console.log(`🔄 BoardFlow: Adding ${edgesToAdd.length} new edges (${newEdges.length - edgesToAdd.length} already exist)`)
              return [...eds, ...edgesToAdd]
            } else {
              console.log('🔄 BoardFlow: All edges already exist')
              return eds
            }
          })
        } else {
          console.log('🔄 BoardFlow: No new edges to add (nodes not found)')
        }
      }, 1000) // Wait 1 second for panels to be created from messages
    }
    
    window.addEventListener('edges-created', handleEdgesCreated as EventListener)
    return () => {
      window.removeEventListener('edges-created', handleEdgesCreated as EventListener)
    }
  }, [reactFlowInstance, nodes, setEdges]) // setEdges is stable, edges is accessed via closure
  
  // Also refetch when conversationId changes
  useEffect(() => {
    if (conversationId) {
      refetchMessages()
      // Reset message length tracking for new conversation
      prevMessagesLengthRef.current = 0
      wasAtBottomRef.current = true // New conversation should start at bottom
    }
  }, [conversationId, refetchMessages])

  // Listen for window resize to detect sidebar collapse/expand and reposition panels with push/center logic
  useEffect(() => {
    if (!nodes || !Array.isArray(nodes) || nodes.length === 0) return

    const handleResize = () => {
      // Apply push/center logic in both Linear and Canvas modes to keep panels aligned with prompt box
      
      const reactFlowElement = document.querySelector('.react-flow')
      if (!reactFlowElement) return

      const mapAreaWidth = reactFlowElement.clientWidth
      if (Math.abs(mapAreaWidth - prevViewportWidthRef.current) < 1) return // No significant change
      
      prevViewportWidthRef.current = mapAreaWidth

      // Use the EXACT same logic as prompt box to determine if panels should be centered
      // This must match input-area-with-sticky-prompt.tsx calculation exactly
      const currentZoom = reactFlowInstance.getViewport().zoom
      const promptBoxMaxWidth = 768 // Max width of prompt box
      
      // Calculate left gap same as prompt box (push/center mechanics)
      const expandedSidebarWidth = 256
      const collapsedSidebarWidth = 64
      const minimapWidth = 179
      const minimapMargin = 15
      
      const sidebarElement = document.querySelector('[class*="w-16"], [class*="w-64"]') as HTMLElement
      const isSidebarExpanded = sidebarElement?.classList.contains('w-64') ?? false
      const currentSidebarWidth = isSidebarExpanded ? expandedSidebarWidth : collapsedSidebarWidth
      
      // Calculate map area width with current sidebar state (full screen with current sidebar width)
      const fullWindowWidth = window.screen.width
      const fullMapAreaWidth = fullWindowWidth - currentSidebarWidth
      
      // Calculate gap from sidebar right edge (0px) to minimap left edge with current sidebar state
      const minimapLeftEdge = fullMapAreaWidth - minimapWidth - minimapMargin
      const gapFromSidebarToMinimap = minimapLeftEdge - 0
      
      // Calculate left gap: (1/2) * (gap from sidebar to minimap - prompt box width)
      const calculatedLeftGap = Math.max(0, (1/2) * (gapFromSidebarToMinimap - promptBoxMaxWidth))
      
      // Check if minimap has moved up - same logic as prompt box
      const minimapElement = document.querySelector('.react-flow__minimap') as HTMLElement
      let minimapBottom = 15 // Default minimap bottom position
      if (minimapElement) {
        const computedStyle = getComputedStyle(minimapElement)
        const bottomValue = computedStyle.bottom
        if (bottomValue && bottomValue !== 'auto') {
          minimapBottom = parseInt(bottomValue) || 15
        }
      }
      const minimapMovedUp = minimapBottom > 15 // Minimap moved up when bottom > 15px
      
      // When minimap is moved up, reduce right gap to allow input to expand into that space
      const baseRightGap = minimapMovedUp ? 0 : 16 // No right gap when minimap is up, normal 16px when in normal position
      
      // First calculate width with left-aligned positioning using calculated left gap
      const leftAlignedWidth = Math.min(promptBoxMaxWidth, mapAreaWidth - calculatedLeftGap - baseRightGap)
      
      // Calculate the right gap (distance from input box right edge to map area right edge) when left-aligned
      const rightGapWhenLeftAligned = mapAreaWidth - calculatedLeftGap - leftAlignedWidth
      
      // Use actual prompt box width from context (for 100% zoom) or default 768px
      // This is the width the panels should use for display
      const panelWidthToUse = (currentZoom <= 1.0 && 768 >= contextPanelWidth) ? contextPanelWidth : 768
      
      // Get current panel X
      const currentPanelX = nodes[0]?.position.x || 0
      
      let targetViewportX: number
      
      // Use the EXACT same centering logic as prompt box
      // The decision is based on leftAlignedWidth (which accounts for minimap position)
      // If right gap < left gap, center; otherwise use left-aligned (pushed)
      if (rightGapWhenLeftAligned < calculatedLeftGap) {
        // Center the panels (same as prompt box when centered)
        // When centered, prompt box uses: Math.min(promptBoxMaxWidth, mapAreaWidth - 32)
        // So panels should center with their actual width (panelWidthToUse)
        const screenCenterX = mapAreaWidth / 2
        targetViewportX = screenCenterX - (panelWidthToUse / 2) - (currentPanelX * currentZoom)
      } else {
        // Position panels with left gap (pushed, same as prompt box when left-aligned)
        // When left-aligned, prompt box uses leftAlignedWidth, but panels use panelWidthToUse
        // The viewport X should position the panel's left edge at calculatedLeftGap
        targetViewportX = calculatedLeftGap - (currentPanelX * currentZoom)
      }
      
      // Guard against NaN values
      if (!isFinite(targetViewportX)) return
      
      // Update viewport X to reposition panels
      const currentViewport = reactFlowInstance.getViewport()
      reactFlowInstance.setViewport({
        x: targetViewportX,
        y: currentViewport.y,
        zoom: currentViewport.zoom,
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
    
    // Also watch for sidebar state changes using MutationObserver (same as prompt box)
    const sidebarElement = document.querySelector('[class*="w-16"], [class*="w-64"]') as HTMLElement
    const sidebarObserver = sidebarElement ? new MutationObserver(() => {
      handleResize()
    }) : null
    
    if (sidebarObserver && sidebarElement) {
      sidebarObserver.observe(sidebarElement, {
        attributes: true,
        attributeFilter: ['class']
      })
    }
    
    // Watch for minimap position changes - when minimap moves up, recalculate
    const minimapElement = document.querySelector('.react-flow__minimap') as HTMLElement
    const minimapObserver = minimapElement ? new MutationObserver(() => {
      handleResize()
    }) : null
    
    if (minimapObserver && minimapElement) {
      minimapObserver.observe(minimapElement, {
        attributes: true,
        attributeFilter: ['style']
      })
    }
    
    // Also use ResizeObserver on minimap to catch position changes
    const minimapResizeObserver = minimapElement ? new ResizeObserver(() => {
      handleResize()
    }) : null
    
    if (minimapResizeObserver && minimapElement) {
      minimapResizeObserver.observe(minimapElement)
    }

    return () => {
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      if (sidebarObserver) sidebarObserver.disconnect()
      if (minimapObserver) minimapObserver.disconnect()
      if (minimapResizeObserver) minimapResizeObserver.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes?.length ?? 0, isPromptBoxCentered, contextPanelWidth]) // Re-run when nodes change, prompt box centering changes, or panel width changes

  // Create a stable key from message IDs
  const messagesKey = useMemo(() => {
    return messages.map(m => `${m.id}-${m.content.slice(0, 10)}`).join(',')
  }, [messages])

  // Calculate bottom scroll limit for linear mode (last panel + padding for input box)
  const getBottomScrollLimit = useCallback(() => {
    if (viewMode !== 'linear' || !nodes || !Array.isArray(nodes) || nodes.length === 0) return null
    
    const reactFlowElement = document.querySelector('.react-flow')
    if (!reactFlowElement) return null
    
    const viewport = reactFlowInstance.getViewport()
    const viewportHeight = reactFlowElement.clientHeight
    const inputPadding = 200 // Padding for input box at bottom
    const estimatedPanelHeight = 400 // Fallback estimate
    
    // Get last panel (highest Y position)
    const lastPanel = nodes.reduce((prev, current) => 
      (current.position.y > prev.position.y) ? current : prev
    )
    const lastPanelY = lastPanel.position.y
    
    // Use measured height if available, otherwise estimate
    const lastPanelHeight = nodeHeightsRef.current.get(lastPanel.id) || estimatedPanelHeight
    const lastPanelBottom = lastPanelY + lastPanelHeight
    
    // Calculate bottom limit in viewport coordinates
    // This is the viewport Y position where the last panel's bottom is just above the input area
    const bottomLimit = -(lastPanelBottom + inputPadding - viewportHeight / viewport.zoom) * viewport.zoom
    
    return bottomLimit
  }, [viewMode, nodes, reactFlowInstance])

  // Check if scrolled to bottom and if bottommost panel is fully visible above input
  const checkIfAtBottom = useCallback(() => {
    if (viewMode !== 'linear' || !nodes || !Array.isArray(nodes) || nodes.length === 0) {
      setIsAtBottom(true)
      return
    }
    
    const bottomLimit = getBottomScrollLimit()
    if (bottomLimit === null) {
      setIsAtBottom(true)
      return
    }
    
    const viewport = reactFlowInstance.getViewport()
    const threshold = 50 // Show arrow when within 50px of bottom limit
    
    // Check if viewport is at or near the bottom limit
    // Viewport Y is negative, bottomLimit is also negative
    // When at bottom, viewport.y should be close to bottomLimit
    // isAtBottom = true means we're at bottom (arrow should NOT show)
    // isAtBottom = false means we're above bottom (arrow SHOULD show)
    const distanceFromBottom = Math.abs(viewport.y - bottomLimit)
    const isAtBottom = distanceFromBottom <= threshold
    
    setIsAtBottom(isAtBottom)
    wasAtBottomRef.current = isAtBottom
  }, [viewMode, nodes, reactFlowInstance, getBottomScrollLimit])

  // Scroll to bottom (center on last panel)
  const scrollToBottom = useCallback(() => {
    if (viewMode !== 'linear' || !nodes || !Array.isArray(nodes) || nodes.length === 0) return
    
    const reactFlowElement = document.querySelector('.react-flow')
    if (!reactFlowElement) return
    
    const viewport = reactFlowInstance.getViewport()
    const viewportHeight = reactFlowElement.clientHeight
    const inputPadding = 200
    
    // Get last panel (highest Y position)
    const lastPanel = nodes.reduce((prev, current) => 
      (current.position.y > prev.position.y) ? current : prev
    )
    const lastPanelY = lastPanel.position.y
    
    // Use measured height if available, otherwise estimate
    const estimatedPanelHeight = 400
    const lastPanelHeight = nodeHeightsRef.current.get(lastPanel.id) || estimatedPanelHeight
    const lastPanelBottom = lastPanelY + lastPanelHeight
    
    // Calculate viewport Y to show the bottom of the last panel with padding
    // Viewport Y is negative, so we need to calculate the offset
    const bottomLimit = -(lastPanelBottom + inputPadding - viewportHeight / viewport.zoom) * viewport.zoom
    
    // Set viewport to show bottom
    reactFlowInstance.setViewport({
      x: viewport.x,
      y: bottomLimit,
      zoom: viewport.zoom,
    })
    
    setIsAtBottom(true)
      wasAtBottomRef.current = true
  }, [viewMode, nodes, reactFlowInstance])
  
  // Auto-scroll to bottom when conversation changes or first loads
  useEffect(() => {
    if (viewMode === 'linear' && nodes && Array.isArray(nodes) && nodes.length > 0 && conversationId) {
      // Small delay to ensure nodes are positioned and heights are measured
      const timeoutId = setTimeout(() => {
        scrollToBottom()
      }, 400) // Longer delay to allow height measurement
      return () => clearTimeout(timeoutId)
    }
  }, [conversationId, viewMode, scrollToBottom]) // Only trigger on conversation change, not on every node change

  // Track node position changes in Canvas mode to update stored positions
  const handleNodesChange = useCallback((changes: any[]) => {
    // Track selected node
    // In linear mode, prevent any viewport changes when selecting nodes
    const hasSelectionChange = changes.some(change => change.type === 'select')
    
    // Update selected node ref first
    changes.forEach((change) => {
      if (change.type === 'select' && change.selected) {
        selectedNodeIdRef.current = change.id
      } else if (change.type === 'select' && !change.selected) {
        // If this node was deselected, check if any other node is selected
        const selectedNode = nodes && Array.isArray(nodes) ? nodes.find((n) => n.id === change.id && n.selected) : null
        if (!selectedNode) {
          // Check if any other node is selected
          const anySelected = nodes && Array.isArray(nodes) ? nodes.some((n) => n.id !== change.id && n.selected) : false
          if (!anySelected) {
            selectedNodeIdRef.current = null
          }
        }
      }
    })
    
    // Call the original handler - this is necessary for React Flow to work
    onNodesChange(changes)
    
    // In linear mode, if there was a selection change, prevent any viewport adjustments
    // by setting a flag that onMove will check
    if (hasSelectionChange && viewMode === 'linear') {
      // Set a flag to prevent viewport adjustments in onMove for a short time
      selectionJustChangedRef.current = true
      setTimeout(() => {
        selectionJustChangedRef.current = false
      }, 500) // Clear flag after 500ms
      return
    }
  }, [onNodesChange, nodes, viewMode])
  
  // Track selected node from nodes array
  // Don't trigger viewport changes on selection in linear mode
  useEffect(() => {
    if (!nodes || !Array.isArray(nodes)) return
    const selectedNode = nodes.find((n) => n.selected)
    if (selectedNode) {
      selectedNodeIdRef.current = selectedNode.id
    } else {
      selectedNodeIdRef.current = null
    }
    // Don't trigger any viewport changes here - selection should not move the viewport in linear mode
  }, [nodes])

  // Load canvas positions from localStorage when conversation changes
  useEffect(() => {
    if (!conversationId || viewMode !== 'canvas') return
    
    try {
      const saved = localStorage.getItem(`thinkable-canvas-positions-${conversationId}`)
      if (saved) {
        const positions = JSON.parse(saved) as Record<string, { x: number; y: number }>
        Object.entries(positions).forEach(([nodeId, pos]) => {
          originalPositionsRef.current.set(nodeId, pos)
        })
      }
    } catch (error) {
      console.error('Failed to load canvas positions from localStorage:', error)
    }
  }, [conversationId, viewMode])

  // Save canvas positions to localStorage (debounced, lightweight)
  const saveCanvasPositions = useCallback(() => {
    if (!conversationId || viewMode !== 'canvas' || !nodes || !Array.isArray(nodes) || nodes.length === 0) return
    
    // Clear existing timeout
    if (savePositionsTimeoutRef.current) {
      clearTimeout(savePositionsTimeoutRef.current)
    }
    
    // Debounce saves (500ms delay)
    savePositionsTimeoutRef.current = setTimeout(() => {
      try {
        if (!nodes || !Array.isArray(nodes)) return
        const positions: Record<string, { x: number; y: number }> = {}
        nodes.forEach((node) => {
          positions[node.id] = {
            x: node.position.x,
            y: node.position.y,
          }
        })
        localStorage.setItem(`thinkable-canvas-positions-${conversationId}`, JSON.stringify(positions))
      } catch (error) {
        console.error('Failed to save canvas positions to localStorage:', error)
      }
    }, 500)
  }, [conversationId, viewMode, nodes])

  // Sync stored positions with current node positions when in Canvas mode
  // This ensures any moves are remembered
  useEffect(() => {
    if (viewMode === 'canvas' && !isLinearModeRef.current && nodes && Array.isArray(nodes) && nodes.length > 0) {
      // Update stored positions with current positions in Canvas mode
      nodes.forEach((node) => {
        originalPositionsRef.current.set(node.id, {
          x: node.position.x,
          y: node.position.y,
        })
      })
      
      // Save to localStorage (debounced)
      saveCanvasPositions()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, viewMode, saveCanvasPositions]) // Update when nodes change (including position changes) in Canvas mode

  // Create panels from messages (group into prompt+response pairs)
  useEffect(() => {
    console.log('🔄 BoardFlow: Creating panels from messages, count:', messages.length, 'messagesKey:', messagesKey, 'prevKey:', prevMessagesKeyRef.current)
    
    // Skip if messages haven't actually changed
    if (messagesKey === prevMessagesKeyRef.current) {
      console.log('🔄 BoardFlow: Messages key unchanged, skipping panel creation')
      return
    }

    console.log('🔄 BoardFlow: Messages changed, creating panels')
    prevMessagesKeyRef.current = messagesKey

    if (!conversationId || messages.length === 0) {
      console.log('🔄 BoardFlow: No conversationId or messages, clearing nodes')
      setNodes([])
      originalPositionsRef.current.clear()
      // Clear saved positions for this conversation
      if (typeof window !== 'undefined') {
        try {
          localStorage.removeItem(`thinkable-canvas-positions-${conversationId}`)
        } catch (error) {
          console.error('Failed to clear canvas positions from localStorage:', error)
        }
      }
      return
    }

    const newNodes: Node<ChatPanelNodeData>[] = []
    const panelSpacing = 250 // Equidistant spacing for both modes
    let panelIndex = 0 // Track panel index for consistent spacing

    // Calculate centered x position for new panels
    // Always center based on viewport for proper centering
    const reactFlowElement = document.querySelector('.react-flow')
    const viewportWidth = reactFlowElement ? reactFlowElement.clientWidth : 1200
    const viewportHeight = reactFlowElement ? reactFlowElement.clientHeight : 800
    const panelWidth = 500
    let centeredX = (viewportWidth / 2) - (panelWidth / 2) // Center horizontally    

    // If we have existing nodes, use their average to maintain alignment
    if (nodes && Array.isArray(nodes) && nodes.length > 0) {
      const existingXPositions = nodes.map(n => n.position.x)
      if (existingXPositions.length > 0) {
        const avgX = existingXPositions.reduce((sum, x) => sum + x, 0) / existingXPositions.length
        // Only use existing average if it's reasonably close to centered (within 200px)
        // Otherwise, use centered position to fix misalignment
        if (Math.abs(avgX - centeredX) < 200) {
          centeredX = avgX
        }
      }
    }

    // Calculate starting Y position from bottom (panels load bottom to top)
    // Start from bottom of viewport and work upwards
    const panelHeight = 400 // Estimated panel height
    const startYFromBottom = viewportHeight - panelHeight - 100 // Start 100px from bottom
    let currentY = startYFromBottom // Start at bottom, will decrease as we add panels

    // Group messages into prompt+response pairs
    // With deterministic mapping, multiple assistant messages can follow one user message
    // Process messages in reverse order so newest panels appear at bottom, oldest at top
    console.log('🔄 BoardFlow: Grouping messages into panels, total messages:', messages.length)
    
    // Process messages from end to start (newest first) to place newest panels at bottom
    let i = messages.length - 1
    while (i >= 0) {
      const message = messages[i]
      
      if (message.role === 'user') {
        // Find all consecutive assistant messages that follow this user message (in original order)
        // Since we're processing backwards, assistant messages are at higher indices (already passed)
        // So we need to look ahead in the original array
        const responseMessages: Message[] = []
        let j = i + 1
        while (j < messages.length && messages[j].role === 'assistant') {
          responseMessages.push(messages[j])
          j++
        }

        // Move backwards to the next user message
        // Since we're going backwards, just decrement i (we've already processed this user and its assistants)
        i--

        // Get node ID and position setup (shared for all panels from this user message)
        const baseNodeId = `panel-${message.id}`
        let storedPos = originalPositionsRef.current.get(baseNodeId)
        
        // If not in memory and in Canvas mode, try loading from localStorage
        if (!storedPos && viewMode === 'canvas' && conversationId && typeof window !== 'undefined') {
          try {
            const saved = localStorage.getItem(`thinkable-canvas-positions-${conversationId}`)
            if (saved) {
              const positions = JSON.parse(saved) as Record<string, { x: number; y: number }>
              const savedPos = positions[baseNodeId]
              if (savedPos) {
                storedPos = savedPos
                originalPositionsRef.current.set(baseNodeId, savedPos) // Cache in memory
              }
            }
          } catch (error) {
            console.error('Failed to load position from localStorage:', error)
          }
        }
        
        // Panels load bottom to top: start from bottom and decrease Y as we add panels
        // In Canvas mode: use stored Y if available (user moved it), otherwise use bottom-to-top spacing
        // In Linear mode: always use bottom-to-top spacing (Y is recalculated later)
        const bottomToTopY = currentY - (panelIndex * panelSpacing) // Decrease Y as we go: startY, startY-250, startY-500, etc.
        let currentPos = { 
          x: storedPos?.x || centeredX, // Use stored X or centered X
          y: (viewMode === 'canvas' && storedPos?.y !== undefined) ? storedPos.y : bottomToTopY // Use stored Y in Canvas mode if available, otherwise bottom-to-top spacing
        }

        // With deterministic mapping, create separate panels for each assistant message
        // This allows multiple panels to be created from one user prompt
        if (responseMessages.length > 0) {
          // Create a panel for each assistant message
          responseMessages.forEach((responseMessage, responseIndex) => {
            // Use the user message ID for the first panel, append index for subsequent ones
            const nodeId = responseIndex === 0 
              ? baseNodeId
              : `${baseNodeId}-${responseIndex}`
            
            console.log('🔄 BoardFlow: Creating panel for user message:', message.id, 'with response:', responseMessage.id, `(panel ${responseIndex + 1}/${responseMessages.length})`)

            // For subsequent panels, stack them vertically (going up from bottom)
            const panelPosition = responseIndex === 0 
              ? currentPos 
              : { 
                  x: currentPos.x, 
                  y: currentPos.y - (responseIndex * panelSpacing) // Space panels vertically going up (decrease Y)
                }

            const panelNode: Node<ChatPanelNodeData> = {
              id: nodeId,
              type: 'chatPanel',
              position: panelPosition,
            data: {
              promptMessage: message, // Same user message for all panels
              responseMessage: responseMessage, // Different response for each panel
              conversationId: conversationId || '',
              isResponseCollapsed: false, // Initialize collapse state
            },
              draggable: isLocked ? false : (viewMode === 'canvas'), // Lock takes precedence, then viewMode
            }
            
            // Store position
            originalPositionsRef.current.set(nodeId, panelPosition)
            
            newNodes.push(panelNode)
            panelIndex++ // Increment for next panel
          })
          
          if (responseMessages.length > 1) {
            console.log('🔄 BoardFlow: Created', responseMessages.length, 'separate panels from one user message (deterministic mapping)')
          }
        } else {
          // No assistant messages found - create panel with just the user message
          console.log('🔄 BoardFlow: Creating panel for user message:', message.id, 'with response: none')

          const panelNode: Node<ChatPanelNodeData> = {
            id: baseNodeId,
            type: 'chatPanel',
            position: currentPos,
            data: {
              promptMessage: message,
              responseMessage: undefined, // No response yet
              conversationId: conversationId || '',
              isResponseCollapsed: false, // Initialize collapse state
            },
            draggable: isLocked ? false : (viewMode === 'canvas'), // Lock takes precedence, then viewMode
          }
          
          // Store position
          originalPositionsRef.current.set(baseNodeId, currentPos)
          
          newNodes.push(panelNode)
          panelIndex++ // Increment for next panel
        }
      } else {
        // Skip assistant messages that aren't part of a user-assistant pair
        // (they should have been processed in the user message loop above)
        // Since we're going backwards, decrement i
        i--
      }
    }
    
    console.log('🔄 BoardFlow: Created', newNodes.length, 'panels from', messages.length, 'messages')
    console.log('🔄 BoardFlow: Messages order:', messages.map(m => ({ id: m.id, role: m.role, content: m.content.substring(0, 30) })))
    console.log('🔄 BoardFlow: Panel details:', newNodes.map(n => ({
      id: n.id,
      promptId: n.data.promptMessage.id,
      hasResponse: !!n.data.responseMessage,
      responseId: n.data.responseMessage?.id,
      position: n.position
    })))

    // If in Linear mode, transform positions immediately
    if (viewMode === 'linear') {
      // Use same centering approach as Canvas mode - let React Flow center naturally
      // Stack panels vertically with same equidistant spacing as Canvas mode
      const panelSpacing = 250 // Equidistant spacing (same as Canvas mode)
      const startY = 0 // Start at y=0 so we can position viewport to match visual gap between panels

      // Set default zoom for linear mode (1.0 = 100% zoom for readable panels)
      const linearZoom = 1.0
      
      // Calculate centered X position - start at 0, we'll center via viewport adjustment
      const panelWidth = 768 // Same width as prompt box
      const centeredX = 0 // Start at 0, we'll center via viewport X adjustment

      // Find existing nodes (those that already exist in current nodes array)
      const existingNodeIds = new Set(nodes && Array.isArray(nodes) ? nodes.map(n => n.id) : [])
      
      // Calculate the actual bottom of the bottommost panel using measured heights
      const estimatedPanelHeight = 400 // Fallback estimate
      const minSpacing = 50 // Minimum spacing between panels
      
      // Find the bottommost panel's bottom edge (Y + measured or estimated height)
      let bottommostBottom = 0
      if (nodes && Array.isArray(nodes) && nodes.length > 0) {
        // Get all existing nodes sorted by Y position (top to bottom)
        const sortedExistingNodes = [...nodes].sort((a, b) => a.position.y - b.position.y)
        
        // Calculate the bottom of each panel using measured heights if available
        sortedExistingNodes.forEach((node) => {
          const measuredHeight = nodeHeightsRef.current.get(node.id) || estimatedPanelHeight
          const panelBottom = node.position.y + measuredHeight
          bottommostBottom = Math.max(bottommostBottom, panelBottom)
        })
      } else {
        bottommostBottom = -panelSpacing // If no existing nodes, start at -panelSpacing so first panel is at 0
      }

      // Separate new nodes from existing nodes
      const trulyNewNodes = newNodes.filter(n => !existingNodeIds.has(n.id))

      // Apply positioning: existing panels keep their positions, new panels go below bottommost
      const linearNodes = newNodes.map((node) => {
        const isNewNode = !existingNodeIds.has(node.id)
        
        if (isNewNode) {
          // New node: find its index among new nodes and place below bottommost panel
          const newIndex = trulyNewNodes.findIndex(n => n.id === node.id)
          // Place new panel below the bottom of the bottommost panel, with spacing
          // For multiple new panels, stack them with estimated height + spacing
          const newY = bottommostBottom + minSpacing + (newIndex * (estimatedPanelHeight + minSpacing))
          return {
            ...node,
            position: {
              x: centeredX,
              y: newY,
            },
            draggable: isLocked ? false : false, // Lock takes precedence (always false here)
          }
        } else {
          // Existing node: keep its current position from the nodes array
          const existingNode = nodes && Array.isArray(nodes) ? nodes.find(n => n.id === node.id) : null
          return {
            ...node,
            position: {
              x: centeredX,
              y: existingNode?.position.y ?? node.position.y,
            },
            draggable: isLocked ? false : false, // Lock takes precedence (always false here)
          }
        }
      })

      setNodes(linearNodes)
      
      // Update stored positions with centered positions
      linearNodes.forEach((node) => {
        originalPositionsRef.current.set(node.id, {
          x: node.position.x,
          y: node.position.y,
        })
      })
      
      // Set viewport X and zoom using same push/center mechanics as prompt box
      // Use double requestAnimationFrame to ensure React Flow has fully updated nodes
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const reactFlowElementForViewport = document.querySelector('.react-flow')
          if (!reactFlowElementForViewport) return

          const mapAreaWidth = reactFlowElementForViewport.clientWidth
          
          // Get actual current nodes to ensure we have the latest positions
          const currentNodes = reactFlowInstance.getNodes()
          if (currentNodes.length === 0) return
          
          // Calculate left gap same as prompt box
          const expandedSidebarWidth = 256
          const collapsedSidebarWidth = 64
          const minimapWidth = 179
          const minimapMargin = 15
          
          // Detect current sidebar state
          const sidebarElement = document.querySelector('[class*="w-16"], [class*="w-64"]') as HTMLElement
          const isSidebarExpanded = sidebarElement?.classList.contains('w-64') ?? false
          const currentSidebarWidth = isSidebarExpanded ? expandedSidebarWidth : collapsedSidebarWidth
          
          // Calculate full map area width with current sidebar state
          const fullWindowWidth = window.screen.width
          const fullMapAreaWidth = fullWindowWidth - currentSidebarWidth
          
          // Calculate gap from sidebar to minimap
          const minimapLeftEdge = fullMapAreaWidth - minimapWidth - minimapMargin
          const gapFromSidebarToMinimap = minimapLeftEdge
          
          // Calculate left gap: (1/2) * (gap from sidebar to minimap - panel width)
          const calculatedLeftGap = Math.max(0, (1/2) * (gapFromSidebarToMinimap - panelWidth))
          
          // Calculate right gap when left-aligned
          const rightGapWhenLeftAligned = mapAreaWidth - calculatedLeftGap - panelWidth
          
          const currentPanelX = currentNodes[0]?.position.x || centeredX
          let targetViewportX: number
          
          // If right gap < left gap, center; otherwise use left-aligned (pushed)
          if (rightGapWhenLeftAligned < calculatedLeftGap) {
            // Center the panels
            const screenCenterX = mapAreaWidth / 2
            targetViewportX = screenCenterX - (panelWidth / 2) - (currentPanelX * linearZoom)
          } else {
            // Position panels with left gap (pushed)
            targetViewportX = calculatedLeftGap - (currentPanelX * linearZoom)
          }
          
          // Set viewport X and zoom to position panels correctly
          reactFlowInstance.setViewport({
            x: targetViewportX,
            y: reactFlowInstance.getViewport().y,
            zoom: linearZoom,
          })
          
          // Update zoom ref
          prevZoomRef.current = linearZoom
        })
      })
      
      // Position viewport Y - center on first panel
      setTimeout(() => {
        if (linearNodes.length > 0) {
          // Get actual current nodes to ensure we have the latest positions
          const currentNodes = reactFlowInstance.getNodes()
          if (currentNodes.length === 0) return
          
          // Center viewport on first panel
          const firstPanelY = Math.min(...currentNodes.map(n => n.position.y))
          const panelHeight = 300 // Approximate panel height
          const firstPanelCenterY = firstPanelY + panelHeight / 2
          
          // Center viewport vertically on the first panel
          const reactFlowElementForY = document.querySelector('.react-flow')
          if (reactFlowElementForY) {
            const viewportHeight = reactFlowElementForY.clientHeight
            const mapAreaWidth = reactFlowElementForY.clientWidth
            const screenCenterY = viewportHeight / 2
            
            // Calculate viewport Y to center first panel vertically
            // screenY = flowY * zoom + viewport.y
            // viewport.y = screenY - flowY * zoom
            const targetViewportY = screenCenterY - firstPanelCenterY * linearZoom
            
            // Calculate left gap same as prompt box (push/center mechanics)
            const expandedSidebarWidth = 256
            const collapsedSidebarWidth = 64
            const minimapWidth = 179
            const minimapMargin = 15
            
            const sidebarElement = document.querySelector('[class*="w-16"], [class*="w-64"]') as HTMLElement
            const isSidebarExpanded = sidebarElement?.classList.contains('w-64') ?? false
            const currentSidebarWidth = isSidebarExpanded ? expandedSidebarWidth : collapsedSidebarWidth
            
            const fullWindowWidth = window.screen.width
            const fullMapAreaWidth = fullWindowWidth - currentSidebarWidth
            const minimapLeftEdge = fullMapAreaWidth - minimapWidth - minimapMargin
            const gapFromSidebarToMinimap = minimapLeftEdge
            const calculatedLeftGap = Math.max(0, (1/2) * (gapFromSidebarToMinimap - panelWidth))
            const rightGapWhenLeftAligned = mapAreaWidth - calculatedLeftGap - panelWidth
            
            const currentPanelX = currentNodes[0]?.position.x || centeredX
            let targetViewportX: number
            
            // If right gap < left gap, center; otherwise use left-aligned (pushed)
            if (rightGapWhenLeftAligned < calculatedLeftGap) {
              const screenCenterX = mapAreaWidth / 2
              targetViewportX = screenCenterX - (panelWidth / 2) - (currentPanelX * linearZoom)
            } else {
              targetViewportX = calculatedLeftGap - (currentPanelX * linearZoom)
            }
          
            // Adjust viewport to position panels correctly
            reactFlowInstance.setViewport({
              x: targetViewportX,
              y: targetViewportY,
              zoom: linearZoom,
            })
          }
        }
      }, 150)
    } else {
      // Canvas mode - ensure panels are centered
      console.log('🔄 BoardFlow: Setting canvas nodes:', newNodes.length, 'nodes')
      setNodes(newNodes)
      
      // Center panels horizontally in Canvas mode
      setTimeout(() => {
        if (newNodes.length > 0) {
          const reactFlowElement = document.querySelector('.react-flow')
          if (!reactFlowElement) return
          
          const viewportWidth = reactFlowElement.clientWidth
          const viewport = reactFlowInstance.getViewport()
          const panelWidth = 768 // Same width as prompt box
          
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

  // Measure actual node heights after render and adjust positions in linear mode to prevent overlaps
  useEffect(() => {
    if (viewMode !== 'linear' || !nodes || !Array.isArray(nodes) || nodes.length === 0) return

    // Use setTimeout to ensure DOM is fully rendered
    const timeoutId = setTimeout(() => {
      const reactFlowElement = document.querySelector('.react-flow')
      if (!reactFlowElement) return

      const viewport = reactFlowInstance.getViewport()
      const minSpacing = 50
      
      // Measure all node heights and store them
      if (!nodes || !Array.isArray(nodes)) return
      nodes.forEach((node) => {
        // Find the React Flow node element by ID
        const nodeElement = reactFlowElement.querySelector(`[data-id="${node.id}"]`) as HTMLElement
        if (nodeElement) {
          // Measure actual height (accounting for zoom)
          const actualHeight = nodeElement.getBoundingClientRect().height / viewport.zoom
          nodeHeightsRef.current.set(node.id, actualHeight)
        }
      })

      // Sort all nodes by current Y position
      const sortedNodes = [...nodes].sort((a, b) => a.position.y - b.position.y)
      
      // Recalculate positions based on actual measured heights to prevent overlaps
      let currentY = sortedNodes[0]?.position.y ?? 0
      const repositionedNodes = sortedNodes.map((node, index) => {
        if (index === 0) {
          return node
        }
        
        const prevNode = sortedNodes[index - 1]
        const prevHeight = nodeHeightsRef.current.get(prevNode.id) || 400
        currentY = prevNode.position.y + prevHeight + minSpacing
        
        // Only update if position changed significantly (more than 10px)
        if (Math.abs(node.position.y - currentY) > 10) {
          return {
            ...node,
            position: {
              ...node.position,
              y: currentY,
            },
          }
        }
        
        return node
      })

      // Check if any positions changed
      const positionsChanged = repositionedNodes.some((node, i) => 
        node.position.y !== nodes[i].position.y
      )
      
      if (positionsChanged) {
        setNodes(repositionedNodes)
        
        // Update stored positions
        repositionedNodes.forEach((node) => {
          originalPositionsRef.current.set(node.id, {
            x: node.position.x,
            y: node.position.y,
          })
        })
      }
    }, 150) // Delay to ensure DOM is ready

    return () => clearTimeout(timeoutId)
  }, [nodes, viewMode, reactFlowInstance, setNodes])

  // Handle smooth slide-up animation when panels collapse
  useEffect(() => {
    if (!nodes || !Array.isArray(nodes) || nodes.length === 0 || !reactFlowInstance) return

    const reactFlowElement = document.querySelector('.react-flow')
    if (!reactFlowElement) return

    const viewport = reactFlowInstance.getViewport()
    
    // Helper function to animate panels below a collapsed/expanded panel
    const animatePanelsBelow = (
      collapsedNode: Node<ChatPanelNodeData>,
      heightDiff: number,
      allNodes: Node<ChatPanelNodeData>[],
      reactFlowInstance: any,
      reactFlowElement: HTMLElement,
      viewport: { zoom: number },
      isCollapsed: boolean
    ) => {
      // Find all nodes below this one (higher Y position)
      const nodesBelow: Node<ChatPanelNodeData>[] = allNodes.filter((n) => n.position.y > collapsedNode.position.y)
      
      if (nodesBelow.length === 0) return
      
      // Animate smoothly using requestAnimationFrame
      const startTime = performance.now()
      const duration = 300 // 300ms animation
      const startPositions = new Map(nodesBelow.map(n => [n.id, n.position.y]))
      
      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime
        const progress = Math.min(elapsed / duration, 1)
        // Ease-out easing function
        const eased = 1 - Math.pow(1 - progress, 3)
        
        setNodes((currentNodes) => {
          return currentNodes.map((n) => {
            if (nodesBelow.some(below => below.id === n.id)) {
              const startY = startPositions.get(n.id) || n.position.y
              // Move up when collapsing (positive heightDiff), down when expanding (negative heightDiff)
              const newY = startY - (heightDiff * eased)
              return {
                ...n,
                position: { ...n.position, y: newY }
              }
            }
            return n
          })
        })
        
        if (progress < 1) {
          requestAnimationFrame(animate)
        } else {
          // Animation complete - update stored heights and positions
          const finalNodes = reactFlowInstance.getNodes()
          finalNodes.forEach((n: Node<ChatPanelNodeData>) => {
            const el = reactFlowElement.querySelector(`[data-id="${n.id}"]`) as HTMLElement
            if (el) {
              const height = el.getBoundingClientRect().height / viewport.zoom
              nodeHeightsRef.current.set(n.id, height)
            }
            originalPositionsRef.current.set(n.id, {
              x: n.position.x,
              y: n.position.y,
            })
          })
        }
      }
      
      requestAnimationFrame(animate)
    }
    
    // Find nodes that have collapsed/expanded (compare with previous state)
    nodes.forEach((node) => {
      const nodeElement = reactFlowElement.querySelector(`[data-id="${node.id}"]`) as HTMLElement
      if (!nodeElement) return

      const isCollapsed = node.data.isResponseCollapsed || false
      const prevCollapsed = prevCollapseStatesRef.current.get(node.id) || false
      
      // Only animate if collapse state actually changed
      if (isCollapsed === prevCollapsed) {
        // Update stored height but don't animate
        const currentHeight = nodeElement.getBoundingClientRect().height / viewport.zoom
        nodeHeightsRef.current.set(node.id, currentHeight)
        return
      }
      
      // State changed - measure heights before and after
      const currentHeight = nodeElement.getBoundingClientRect().height / viewport.zoom
      const storedHeight = nodeHeightsRef.current.get(node.id) || currentHeight
      
      // Wait for CSS transition to complete, then measure the actual height difference
      // This ensures we get the accurate height change after the collapse/expand animation
      setTimeout(() => {
        const newHeight = nodeElement.getBoundingClientRect().height / viewport.zoom
        const heightDiff = storedHeight - newHeight
        
        if (Math.abs(heightDiff) >= 10) {
          // Find all nodes below this one (higher Y position)
          const nodesBelow = nodes.filter((n: Node<ChatPanelNodeData>) => n.position.y > node.position.y)
          
          if (nodesBelow.length > 0) {
            // Animate smoothly using requestAnimationFrame
            const startTime = performance.now()
            const duration = 300 // 300ms animation
            const startPositions = new Map(nodesBelow.map(n => [n.id, n.position.y]))
            
            const animate = (currentTime: number) => {
              const elapsed = currentTime - startTime
              const progress = Math.min(elapsed / duration, 1)
              // Ease-out easing function
              const eased = 1 - Math.pow(1 - progress, 3)
              
              setNodes((currentNodes) => {
                return currentNodes.map((n) => {
                  if (nodesBelow.some(below => below.id === n.id)) {
                    const startY = startPositions.get(n.id) || n.position.y
                    // Move up when collapsing (positive heightDiff), down when expanding (negative heightDiff)
                    const newY = startY - (heightDiff * eased)
                    return {
                      ...n,
                      position: { ...n.position, y: newY }
                    }
                  }
                  return n
                })
              })
              
              if (progress < 1) {
                requestAnimationFrame(animate)
              } else {
                // Animation complete - update stored heights and positions
                const finalNodes = reactFlowInstance.getNodes()
                finalNodes.forEach((n: Node<ChatPanelNodeData>) => {
                  const el = reactFlowElement.querySelector(`[data-id="${n.id}"]`) as HTMLElement
                  if (el) {
                    const height = el.getBoundingClientRect().height / viewport.zoom
                    nodeHeightsRef.current.set(n.id, height)
                  }
                  originalPositionsRef.current.set(n.id, {
                    x: n.position.x,
                    y: n.position.y,
                  })
                })
              }
            }
            
            requestAnimationFrame(animate)
          }
        }
        
        // Update stored state and height
        prevCollapseStatesRef.current.set(node.id, isCollapsed)
        nodeHeightsRef.current.set(node.id, newHeight)
      }, 250) // Wait for 200ms CSS transition + 50ms buffer
    })
  }, [nodes, reactFlowInstance, setNodes])

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

        // Handle zoom in linear mode - zoom around horizontal center but free vertically (around cursor)
        if (viewMode === 'linear' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          e.stopPropagation()

          const viewport = reactFlowInstance.getViewport()
          const reactFlowRect = reactFlowElement.getBoundingClientRect()
          
          // Calculate the horizontal center of the map area (for horizontal centering)
          const mapCenterX = reactFlowRect.width / 2
          
          // Get mouse cursor Y position (for free vertical zoom)
          const mouseY = e.clientY - reactFlowRect.top
          
          // Convert screen positions to flow coordinates at current zoom
          // screenX = flowX * zoom + viewport.x
          // flowX = (screenX - viewport.x) / zoom
          const flowCenterX = (mapCenterX - viewport.x) / viewport.zoom
          const flowMouseY = (mouseY - viewport.y) / viewport.zoom
          
          // Calculate zoom delta (React Flow uses exponential zoom)
          const zoomFactor = 1 + (e.deltaY > 0 ? -0.1 : 0.1)
          const newZoom = Math.max(0.1, Math.min(2, viewport.zoom * zoomFactor))
          
          // Calculate new viewport X to keep horizontal center fixed
          // We want: mapCenterX = flowCenterX * newZoom + newViewportX
          // Solving: newViewportX = mapCenterX - flowCenterX * newZoom
          const newViewportX = mapCenterX - flowCenterX * newZoom
          
          // Calculate new viewport Y to keep mouse cursor Y position fixed (free vertical zoom)
          // We want: mouseY = flowMouseY * newZoom + newViewportY
          // Solving: newViewportY = mouseY - flowMouseY * newZoom
          const newViewportY = mouseY - flowMouseY * newZoom
          
          // Apply zoom: centered horizontally, free vertically around cursor
          reactFlowInstance.setViewport({
            x: newViewportX,
            y: newViewportY,
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

  // Auto-scroll during text selection drag when mouse reaches viewport edges
  // Works in both linear and canvas modes with exponential scroll rate
  useEffect(() => {
    if (!reactFlowInstance) return

    let isSelecting = false // Track if text selection is active
    let scrollInterval: NodeJS.Timeout | null = null // Interval for continuous scrolling
    let lastMouseX = 0 // Track last mouse X position for continuous scrolling
    let lastMouseY = 0 // Track last mouse Y position for continuous scrolling
    const edgeThreshold = 50 // Distance from edge (in pixels) to trigger scrolling
    const maxScrollSpeed = 20 // Maximum scroll speed in pixels per frame
    const scrollFrameRate = 16 // ~60fps (16ms per frame)

    const handleMouseDown = (e: MouseEvent) => {
      // Check if clicking on a text-editable element (TipTap editor)
      const target = e.target as HTMLElement
      const isTextEditable = target.closest('.ProseMirror') || 
                             target.closest('[data-tiptap-editor]') ||
                             target.closest('[contenteditable="true"]')
      
      if (isTextEditable) {
        isSelecting = true
        lastMouseX = e.clientX // Store initial mouse position
        lastMouseY = e.clientY
      }
    }

    const calculateScrollRate = (mouseX: number, mouseY: number) => {
      // Get React Flow container bounds
      const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
      if (!reactFlowElement) return { scrollX: 0, scrollY: 0 }

      const reactFlowRect = reactFlowElement.getBoundingClientRect()
      
      // Calculate distance from each edge
      const distFromTop = mouseY - reactFlowRect.top
      const distFromBottom = reactFlowRect.bottom - mouseY
      const distFromLeft = mouseX - reactFlowRect.left
      const distFromRight = reactFlowRect.right - mouseX

      // Determine scroll direction and calculate exponential scroll rate
      let scrollX = 0
      let scrollY = 0

      // Vertical scrolling (up/down)
      if (distFromTop < edgeThreshold && distFromTop > 0) {
        // Near top edge - scroll down (positive Y) to reveal content above
        const normalizedDist = distFromTop / edgeThreshold // 0 to 1
        const exponentialRate = Math.pow(1 - normalizedDist, 2) // Exponential: faster as closer to edge
        scrollY = maxScrollSpeed * exponentialRate
      } else if (distFromBottom < edgeThreshold && distFromBottom > 0) {
        // Near bottom edge - scroll up (negative Y) to reveal content below
        const normalizedDist = distFromBottom / edgeThreshold // 0 to 1
        const exponentialRate = Math.pow(1 - normalizedDist, 2) // Exponential: faster as closer to edge
        scrollY = -maxScrollSpeed * exponentialRate
      }

      // Horizontal scrolling (left/right) - only in canvas mode
      if (viewMode === 'canvas') {
        if (distFromLeft < edgeThreshold && distFromLeft > 0) {
          // Near left edge - scroll right (positive X) to reveal content to the left
          const normalizedDist = distFromLeft / edgeThreshold // 0 to 1
          const exponentialRate = Math.pow(1 - normalizedDist, 2) // Exponential: faster as closer to edge
          scrollX = maxScrollSpeed * exponentialRate
        } else if (distFromRight < edgeThreshold && distFromRight > 0) {
          // Near right edge - scroll left (negative X) to reveal content to the right
          const normalizedDist = distFromRight / edgeThreshold // 0 to 1
          const exponentialRate = Math.pow(1 - normalizedDist, 2) // Exponential: faster as closer to edge
          scrollX = -maxScrollSpeed * exponentialRate
        }
      }

      return { scrollX, scrollY }
    }

    const handleMouseMove = (e: MouseEvent) => {
      // Only handle if text selection is active
      if (!isSelecting) return

      // Check if there's an active text selection
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0 || selection.toString().length === 0) {
        // No active selection - stop scrolling
        if (scrollInterval) {
          clearInterval(scrollInterval)
          scrollInterval = null
        }
        return
      }

      // Update last known mouse position
      lastMouseX = e.clientX
      lastMouseY = e.clientY

      // Calculate scroll rate based on current mouse position
      const { scrollX, scrollY } = calculateScrollRate(e.clientX, e.clientY)

      // Clear existing interval
      if (scrollInterval) {
        clearInterval(scrollInterval)
        scrollInterval = null
      }

      // Start scrolling if needed
      if (scrollX !== 0 || scrollY !== 0) {
        // Apply exponential scrolling continuously, recalculating on each frame
        scrollInterval = setInterval(() => {
          // Recalculate scroll rate based on last known mouse position (exponential)
          const { scrollX: currentScrollX, scrollY: currentScrollY } = calculateScrollRate(lastMouseX, lastMouseY)
          
          // If no scroll needed, stop interval
          if (currentScrollX === 0 && currentScrollY === 0) {
            if (scrollInterval) {
              clearInterval(scrollInterval)
              scrollInterval = null
            }
            return
          }

          const currentViewport = reactFlowInstance.getViewport()
          let newX = currentViewport.x + currentScrollX
          let newY = currentViewport.y + currentScrollY

          // In linear mode, clamp Y to bottom limit (when scrolling up with negative Y)
          if (viewMode === 'linear') {
            const bottomLimit = getBottomScrollLimit()
            if (bottomLimit !== null && newY < bottomLimit) {
              newY = bottomLimit
              // Stop scrolling if we hit the limit
              if (scrollInterval) {
                clearInterval(scrollInterval)
                scrollInterval = null
              }
            }
          }

          reactFlowInstance.setViewport({
            x: newX,
            y: newY,
            zoom: currentViewport.zoom,
          })
        }, scrollFrameRate)
      }
    }

    const handleMouseUp = () => {
      isSelecting = false
      // Stop scrolling when mouse is released
      if (scrollInterval) {
        clearInterval(scrollInterval)
        scrollInterval = null
      }
    }

    // Add event listeners
    document.addEventListener('mousedown', handleMouseDown, true)
    document.addEventListener('mousemove', handleMouseMove, true)
    document.addEventListener('mouseup', handleMouseUp, true)

    return () => {
      // Cleanup
      document.removeEventListener('mousedown', handleMouseDown, true)
      document.removeEventListener('mousemove', handleMouseMove, true)
      document.removeEventListener('mouseup', handleMouseUp, true)
      if (scrollInterval) {
        clearInterval(scrollInterval)
      }
    }
  }, [reactFlowInstance, viewMode, getBottomScrollLimit])

  // Check if at bottom when viewport changes in linear mode
  // Don't run when nodes change due to selection - only run when nodes are added/removed or viewMode changes
  const prevNodesLengthRef = useRef(nodes?.length ?? 0)
  useEffect(() => {
    // Only run if nodes length changed (nodes added/removed) or viewMode changed, not on selection changes
    const currentNodesLength = nodes?.length ?? 0
    if (prevNodesLengthRef.current !== currentNodesLength || prevViewModeRef.current !== viewMode) {
      prevNodesLengthRef.current = currentNodesLength
      if (viewMode === 'linear' && nodes && Array.isArray(nodes) && nodes.length > 0) {
        const timeoutId = setTimeout(() => {
          checkIfAtBottom()
        }, 100)
        return () => clearTimeout(timeoutId)
      }
    }
  }, [viewMode, nodes, reactFlowInstance, checkIfAtBottom])

  // Auto-scroll to bottom when new messages arrive (if user was at bottom)
  useEffect(() => {
    if (viewMode === 'linear' && nodes && Array.isArray(nodes) && nodes.length > 0) {
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
  }, [messages.length, nodes?.length ?? 0, viewMode, scrollToBottom])

  // Handle Linear mode: center and align panels vertically when switching modes
  // Use a ref to track previous viewMode to only run when viewMode actually changes
  const prevViewModeForLinearRef = useRef(viewMode)
  useEffect(() => {
    // Only run when viewMode actually changes, not when nodes change
    if (prevViewModeForLinearRef.current === viewMode) {
      return
    }
    prevViewModeForLinearRef.current = viewMode
    
    if (!nodes || !Array.isArray(nodes) || nodes.length === 0) return

    // Save current zoom before switching modes
    if (reactFlowInstance) {
      const currentZoom = reactFlowInstance.getViewport().zoom
      if (viewMode === 'linear') {
        savedZoomRef.current.canvas = currentZoom // Save canvas zoom before switching to linear
      } else {
        savedZoomRef.current.linear = currentZoom // Save linear zoom before switching to canvas
      }
    }

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

      // Restore saved zoom or use default (1.0 = 100% zoom for readable panels)
      const linearZoom = savedZoomRef.current.linear ?? 1.0

      // Sort nodes by their stored Y position to maintain order
      const sortedNodes = [...nodes].sort((a, b) => {
        const posA = originalPositionsRef.current.get(a.id)?.y || a.position.y
        const posB = originalPositionsRef.current.get(b.id)?.y || b.position.y
        return posA - posB
      })

      // Calculate centered X position BEFORE creating nodes, using target zoom (1.0) for linear mode
      // We'll set panels at X=0 initially, then center via viewport adjustment
      const panelWidth = 768 // Same width as prompt box
      const centeredX = 0 // Start at 0, we'll center via viewport X adjustment

      // Apply consistent equidistant spacing: first panel at startY, then startY + (index * spacing)
      const linearNodes = sortedNodes.map((node, index) => ({
        ...node,
        position: {
          x: centeredX, // Use calculated centered position from the start
          y: startY + (index * panelSpacing), // Consistent equidistant spacing starting from first panel
        },
        draggable: isLocked ? false : false, // Not draggable in Linear mode (or when locked)
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
      
      // Center viewport on panels - use setTimeout to ensure nodes are fully rendered
      setTimeout(() => {
        if (linearNodes.length > 0) {
          // Get actual current nodes to ensure we have the latest positions
          const currentNodes = reactFlowInstance.getNodes()
          if (currentNodes.length === 0) return
          
          const reactFlowElement = document.querySelector('.react-flow')
          if (!reactFlowElement) return
          
          const mapAreaWidth = reactFlowElement.clientWidth
          const viewportHeight = reactFlowElement.clientHeight
          const screenCenterY = viewportHeight / 2
          
          // Use the linear zoom level
          const currentZoom = linearZoom
          
          // Calculate left gap same as prompt box (push/center mechanics)
          const expandedSidebarWidth = 256
          const collapsedSidebarWidth = 64
          const minimapWidth = 179
          const minimapMargin = 15
          
          const sidebarElement = document.querySelector('[class*="w-16"], [class*="w-64"]') as HTMLElement
          const isSidebarExpanded = sidebarElement?.classList.contains('w-64') ?? false
          const currentSidebarWidth = isSidebarExpanded ? expandedSidebarWidth : collapsedSidebarWidth
          
          const fullWindowWidth = window.screen.width
          const fullMapAreaWidth = fullWindowWidth - currentSidebarWidth
          const minimapLeftEdge = fullMapAreaWidth - minimapWidth - minimapMargin
          const gapFromSidebarToMinimap = minimapLeftEdge
          const calculatedLeftGap = Math.max(0, (1/2) * (gapFromSidebarToMinimap - panelWidth))
          const rightGapWhenLeftAligned = mapAreaWidth - calculatedLeftGap - panelWidth
          
          // Helper function to calculate viewport X based on push/center logic
          const calculateViewportX = (panelX: number, zoom: number) => {
            if (rightGapWhenLeftAligned < calculatedLeftGap) {
              // Center the panels
              const screenCenterX = mapAreaWidth / 2
              return screenCenterX - (panelWidth / 2) - (panelX * zoom)
            } else {
              // Position panels with left gap (pushed)
              return calculatedLeftGap - (panelX * zoom)
            }
          }
          
          // Skip viewport adjustment when a node is selected - this prevents jumping to bottom
          // Only adjust viewport when switching to linear mode with no selection
          if (selectedNodeIndex < 0 || !selectedNodeId) {
            // No selected node - center viewport on first panel
            const firstPanelY = Math.min(...currentNodes.map(n => n.position.y))
            const panelHeight = 300 // Approximate panel height
            const firstPanelCenterY = firstPanelY + panelHeight / 2
            
            // Calculate viewport Y to center first panel vertically
            const targetViewportY = screenCenterY - firstPanelCenterY * currentZoom
            
            const currentPanelX = currentNodes[0]?.position.x || 0
            const targetViewportX = calculateViewportX(currentPanelX, currentZoom)
          
            // Adjust viewport to position panels correctly
            reactFlowInstance.setViewport({
              x: targetViewportX,
              y: targetViewportY,
              zoom: currentZoom,
            })
            
            // Update zoom ref
            prevZoomRef.current = currentZoom
          }
          // If there's a selected node, skip viewport adjustment entirely to prevent jumping
          
          // Clear the switching flag after centering is complete
          setTimeout(() => {
            isSwitchingToLinearRef.current = false
          }, 100)
        }
      }, 200)
    } else {
      isLinearModeRef.current = false
      
      // Restore stored positions when switching back to Canvas
      // Load from localStorage first, then use in-memory ref
      if (conversationId && typeof window !== 'undefined') {
        try {
          const saved = localStorage.getItem(`thinkable-canvas-positions-${conversationId}`)
          if (saved) {
            const positions = JSON.parse(saved) as Record<string, { x: number; y: number }>
            Object.entries(positions).forEach(([nodeId, pos]) => {
              originalPositionsRef.current.set(nodeId, pos)
            })
          }
        } catch (error) {
          console.error('Failed to load canvas positions from localStorage:', error)
        }
      }
      
      if (!nodes || !Array.isArray(nodes)) return
      const restoredNodes = nodes.map((node) => {
        const storedPos = originalPositionsRef.current.get(node.id)
        if (storedPos) {
          return {
            ...node,
            position: storedPos,
            draggable: isLocked ? false : true, // Lock takes precedence
          }
        }
        return {
          ...node,
          draggable: isLocked ? false : true, // Lock takes precedence
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
          const panelWidth = 768 // Same width as prompt box
          
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
          
          // Restore saved zoom for canvas mode
          const canvasZoom = savedZoomRef.current.canvas ?? 1.0
          
          // Center on selected node if one is selected
          if (selectedNodeIdRef.current) {
            const selectedNode = finalNodes.find((n) => n.id === selectedNodeIdRef.current)
            if (selectedNode) {
              const panelHeight = 300 // Approximate panel height
              const nodeX = selectedNode.position.x + panelWidth / 2
              const nodeY = selectedNode.position.y + panelHeight / 2
              const viewport = reactFlowInstance.getViewport()
              reactFlowInstance.setViewport({ x: viewport.x, y: viewport.y, zoom: canvasZoom }, { duration: 0 })
              reactFlowInstance.setCenter(nodeX, nodeY, { zoom: canvasZoom })
            } else {
              // No selection - just restore zoom
              const viewport = reactFlowInstance.getViewport()
              reactFlowInstance.setViewport({ x: viewport.x, y: viewport.y, zoom: canvasZoom }, { duration: 0 })
            }
          } else {
            // No selection - just restore zoom
            const viewport = reactFlowInstance.getViewport()
            reactFlowInstance.setViewport({ x: viewport.x, y: viewport.y, zoom: canvasZoom }, { duration: 0 })
          }
        }
      }, 100)
      
      // Don't clear originalPositionsRef - we need them for future mode switches
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]) // Only run when viewMode changes, ignore nodes dependency to avoid loops

  // Update edge types to use smoothstep (ELK-style routing)
  useEffect(() => {
    setEdges((eds) =>
      eds.map((edge) => ({
        ...edge,
        type: 'smoothstep', // Use smoothstep for ELK-style routing
      }))
    )
  }, [setEdges])

  return (
    <div className="w-full h-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesState}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionRadius={20}
        onConnect={(params) => {
          if (!isLocked && params.source && params.target) {
            const newEdge: Edge = {
              id: `${params.source}-${params.target}`,
              source: params.source,
              target: params.target,
              sourceHandle: params.sourceHandle,
              targetHandle: params.targetHandle,
              type: 'smoothstep', // Use smoothstep for ELK-style routing
            }
            setEdges((eds) => [...eds, newEdge])
          }
        }}
        defaultViewport={{ x: 0, y: 0, zoom: 0.6 }} // Lower default zoom (0.6 instead of 1.0)
        fitView={viewMode === 'canvas'} // Only use fitView in Canvas mode to prevent extra space above first panel in Linear mode
        fitViewOptions={{ padding: 0.2, minZoom: 0.3, maxZoom: 2 }} // Add padding and zoom limits for fitView
        className="bg-gray-50 dark:bg-[#0f0f0f]"
        onInit={(instance) => {
          // Ensure viewport values are always valid numbers to prevent NaN errors in Background component
          const currentViewport = instance.getViewport()
          if (!isFinite(currentViewport.x) || !isFinite(currentViewport.y) || !isFinite(currentViewport.zoom)) {
            instance.setViewport({ x: 0, y: 0, zoom: 0.6 })
          }
          // Share React Flow instance with context for toolbar access
          setReactFlowInstance(instance)
        }}
        panOnDrag={true} // Allow panning in both modes (horizontal locked in linear via onMove)
        zoomOnScroll={!isScrollMode} // Enable zoom on scroll (disabled in Scroll mode only)
        zoomOnPinch={true} // Always allow pinch zoom
        zoomOnDoubleClick={true} // Allow double-click zoom
        minZoom={0.1} // Allow zooming out more
        maxZoom={2} // Limit maximum zoom
        autoPanOnNodeDrag={false} // Disable auto-panning when nodes are dragged/selected
        selectNodesOnDrag={false} // Don't select nodes on drag
        onMove={(event, viewport) => {
          // Skip centering adjustments if we're currently switching to Linear mode
          if (isSwitchingToLinearRef.current) {
            return
          }
          
          // Skip adjustments during fitView/zoom reset transitions to allow smooth animation
          if (fitViewInProgressRef.current) {
            prevZoomRef.current = viewport.zoom
            return
          }
          
          // Skip adjustments if a node was just selected (prevent jump to bottom on selection)
          // Check if selection just changed - if so, don't adjust viewport in linear mode
          if (selectionJustChangedRef.current && viewMode === 'linear') {
            // Restore previous Y position if it changed significantly (jump detected)
            if (previousViewportYRef.current !== null && Math.abs(viewport.y - previousViewportYRef.current) > 10) {
              // Viewport Y jumped - restore it to prevent jump
              reactFlowInstance.setViewport({
                x: viewport.x,
                y: previousViewportYRef.current, // Keep previous Y position
                zoom: viewport.zoom,
              }, { duration: 0 })
            } else {
              // Update stored Y position
              previousViewportYRef.current = viewport.y
            }
            // Just update zoom ref, don't adjust viewport position
            prevZoomRef.current = viewport.zoom
            savedZoomRef.current.linear = viewport.zoom
            return
          }
          
          // Update stored Y position for future comparisons
          previousViewportYRef.current = viewport.y
          
          // In Linear mode, always lock horizontal position to prevent horizontal panning
          if (viewMode === 'linear' && nodes && Array.isArray(nodes) && nodes.length > 0) {
            const currentZoom = viewport.zoom
            
            // Find the prompt box and align panels to its horizontal center
            const reactFlowElement = document.querySelector('.react-flow')
            if (reactFlowElement) {
              const mapAreaWidth = reactFlowElement.clientWidth
              const panelWidth = 768 // Same width as prompt box
              
              // Guard against invalid values
              if (!isFinite(mapAreaWidth) || !isFinite(currentZoom) || !isFinite(viewport.x) || !isFinite(viewport.y)) {
                return
              }
              
              // Get current panel X position (all panels should have same X in linear mode)
              const currentPanelX = nodes[0]?.position.x || 0
              
              // Try to get the actual prompt box position for perfect alignment
              const promptBoxContainer = document.querySelector('[class*="pointer-events-auto"]') as HTMLElement
              const chatTextarea = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]') as HTMLElement
              const promptBox = chatTextarea?.closest('[class*="pointer-events-auto"]') as HTMLElement
              
              let targetViewportX: number
              
              if (promptBox) {
                // Get prompt box position relative to React Flow container
                const promptBoxRect = promptBox.getBoundingClientRect()
                const reactFlowRect = reactFlowElement.getBoundingClientRect()
                
                // Calculate prompt box center relative to React Flow container
                const promptBoxCenterX = (promptBoxRect.left + promptBoxRect.right) / 2 - reactFlowRect.left
                
                // Position panels so their center aligns with prompt box center
                // Formula: screenX = worldX * zoom + viewportX
                // Panel center in world coords: currentPanelX + panelWidth/2
                // We want: (currentPanelX + panelWidth/2) * zoom + viewportX = promptBoxCenterX
                // So: viewportX = promptBoxCenterX - (currentPanelX + panelWidth/2) * zoom
                targetViewportX = promptBoxCenterX - (currentPanelX + panelWidth / 2) * currentZoom
              } else {
                // Fallback: use same calculation as prompt box
                const expandedSidebarWidth = 256
                const collapsedSidebarWidth = 64
                const minimapWidth = 179
                const minimapMargin = 15
                
                const sidebarElement = document.querySelector('[class*="w-16"], [class*="w-64"]') as HTMLElement
                const isSidebarExpanded = sidebarElement?.classList.contains('w-64') ?? false
                const currentSidebarWidth = isSidebarExpanded ? expandedSidebarWidth : collapsedSidebarWidth
                
                const fullWindowWidth = window.screen.width
                const fullMapAreaWidth = fullWindowWidth - currentSidebarWidth
                const minimapLeftEdge = fullMapAreaWidth - minimapWidth - minimapMargin
                const gapFromSidebarToMinimap = minimapLeftEdge
                const calculatedLeftGap = Math.max(0, (1/2) * (gapFromSidebarToMinimap - panelWidth))
                
                // Calculate prompt box center based on its positioning logic
                const rightGapWhenLeftAligned = mapAreaWidth - calculatedLeftGap - panelWidth
                
                let promptBoxCenterX: number
                if (rightGapWhenLeftAligned < calculatedLeftGap) {
                  // Prompt box is centered
                  promptBoxCenterX = mapAreaWidth / 2
                } else {
                  // Prompt box is pushed left
                  promptBoxCenterX = calculatedLeftGap + (panelWidth / 2)
                }
                
                // Same formula: viewportX = promptBoxCenterX - (panelX + panelWidth/2) * zoom
                targetViewportX = promptBoxCenterX - (currentPanelX + panelWidth / 2) * currentZoom
              }
              
              // Guard against NaN values
              if (!isFinite(targetViewportX)) {
                return
              }
              
              // Only adjust if X position differs (allow vertical panning, lock horizontal to prompt box)
              if (Math.abs(viewport.x - targetViewportX) > 1) {
                reactFlowInstance.setViewport({
                  x: targetViewportX,
                  y: viewport.y, // Keep vertical position from panning/zoom
                  zoom: currentZoom,
                })
              }
            }
            
            prevZoomRef.current = currentZoom
            // Save zoom for linear mode
            savedZoomRef.current.linear = currentZoom
            
            // Check if at bottom
            checkIfAtBottom()
          } else {
            // Not in linear mode, just update zoom ref and save for canvas mode
            prevZoomRef.current = viewport.zoom
            savedZoomRef.current.canvas = viewport.zoom
          }
        }}
      >
        <Background variant={BackgroundVariant.Dots} />
        {messages.length > 0 && !isMinimapHidden && (
          <MiniMap 
            position="bottom-right"
            nodeColor={(node) => {
              // Light grey by default, dark grey when selected
              return node.selected ? '#9ca3af' : '#e5e7eb' // Dark grey if selected, light grey otherwise
            }}
            maskColor={resolvedTheme === 'dark'
              ? 'rgba(96, 165, 250, 0.25)' // Dark mode: lighter blue overlay (blue-400 with higher opacity for better visibility)
              : 'rgba(202, 216, 237, 0.3)'} // Light mode: light blue overlay matching selected board tab (blue-50 with transparency)
            pannable={true} // Allow panning (horizontal movement restricted via onMove in linear mode)
            zoomable={true}
            className="minimap-custom-size"
            style={{
              borderTopLeftRadius: '0px',
              borderTopRightRadius: '0px',
              borderBottomLeftRadius: '8px',
              borderBottomRightRadius: '8px',
              overflow: 'hidden',
              cursor: 'pointer', // Indicate clickability
              bottom: `${minimapBottom - 12}px`, // 5px from bottom when at default (1px lower)
              right: `${minimapRight}px`, // Right position - aligns with prompt box when jumped, defaults to 15px
            }}
          />
        )}
        
        {/* Minimap toggle pill - horizontal below minimap, like top bar and prompt box */}
        {messages.length > 0 && (
          <div
            onClick={() => {
              const newHiddenState = !isMinimapHidden
              setIsMinimapHidden(newHiddenState)
              // Track manual hide/show
              if (newHiddenState) {
                setIsMinimapManuallyHidden(true)
                wasAutoHiddenRef.current = false
              } else {
                setIsMinimapManuallyHidden(false)
                wasAutoHiddenRef.current = false
              }
            }}
            onMouseEnter={() => setIsMinimapHovering(true)}
            onMouseLeave={() => setIsMinimapHovering(false)}
            className={cn(
              'absolute z-10 w-12 h-1.5 rounded-full cursor-pointer transition-all duration-200 bg-gray-300 hover:bg-gray-400',
              (isMinimapHovering || isMinimapHidden || isBottomGapHovering) ? 'opacity-100' : 'opacity-0'
            )}
            style={{
              bottom: `${(minimapBottom - 12) - 4}px`, // Positioned just below minimap bottom edge (minimap bottom is at minimapBottom - 12, pill is 4px below that)
              right: `${minimapRight + (179 - 48) / 2}px`, // Center horizontally under minimap (179px minimap width, 48px pill width)
            }}
            title={isMinimapHidden ? 'Show minimap' : 'Hide minimap'}
          />
        )}
        
      </ReactFlow>
      
      {/* Linear/Canvas toggle with Nav dropdown above minimap - only show when there are messages */}
      {messages.length > 0 && (
        <div 
          className="absolute z-10"
          style={{
            // Position toggle above minimap
            // Both positions use minimapBottom which already accounts for the jump when prompt box gets close
            bottom: isMinimapHidden 
              ? `${minimapBottom - 12 + 8}px` // At minimap position when hidden + small offset
              : `${minimapBottom - 12 + 134 + 8}px`, // Above minimap (134px height + 8px gap)
            // Right-align with minimap (which aligns with prompt box when jumped), moved left 16px
            right: `${minimapRight + 16}px`, // Match minimap right position + 16px left offset (moved 1px left)
          }}
        >
        <div 
          className="bg-blue-50 dark:bg-[#2a2a3a] rounded-lg p-1 flex items-center gap-1 relative"
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (viewMode === 'linear' && reactFlowInstance) {
                // Already in linear mode - reset to default zoom (100%) and recenter
                // Set flag to prevent onMove from interfering during transition
                fitViewInProgressRef.current = true
                
                // Calculate correct X position for prompt box alignment at zoom 1
                const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
                const chatTextarea = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]') as HTMLElement
                const promptBox = chatTextarea?.closest('[class*="pointer-events-auto"]') as HTMLElement
                
                const panelWidth = 768
                const viewport = reactFlowInstance.getViewport()
                
                let targetViewportX = viewport.x
                let targetViewportY = viewport.y
                
                // Check if there are selected panels
                const selectedNodes = nodes?.filter(n => n.selected) || []
                
                if (selectedNodes.length > 0 && reactFlowElement) {
                  // Center selected panels vertically in map area
                  const reactFlowRect = reactFlowElement.getBoundingClientRect()
                  const mapAreaHeight = reactFlowRect.height
                  
                  // Calculate center Y of selected nodes
                  const minY = Math.min(...selectedNodes.map(n => n.position.y))
                  const maxY = Math.max(...selectedNodes.map(n => n.position.y + 400)) // estimate 400px height
                  const nodesCenterY = (minY + maxY) / 2
                  
                  // Center vertically: mapCenterY = nodesCenterY * zoom + viewportY
                  // So: viewportY = mapCenterY - nodesCenterY * zoom
                  const mapCenterY = mapAreaHeight / 2
                  targetViewportY = mapCenterY - nodesCenterY * 1 // zoom = 1
                  
                  // Use first selected node's X for horizontal alignment
                  const currentPanelX = selectedNodes[0]?.position.x || 0
                  
                  if (promptBox) {
                    const promptBoxRect = promptBox.getBoundingClientRect()
                    const promptBoxCenterX = (promptBoxRect.left + promptBoxRect.right) / 2 - reactFlowRect.left
                    targetViewportX = promptBoxCenterX - (currentPanelX + panelWidth / 2) * 1 // zoom = 1
                  }
                } else {
                  // No selection - just align horizontally with prompt box
                  const currentPanelX = nodes?.[0]?.position.x || 0
                  
                  if (promptBox && reactFlowElement) {
                    const promptBoxRect = promptBox.getBoundingClientRect()
                    const reactFlowRect = reactFlowElement.getBoundingClientRect()
                    const promptBoxCenterX = (promptBoxRect.left + promptBoxRect.right) / 2 - reactFlowRect.left
                    targetViewportX = promptBoxCenterX - (currentPanelX + panelWidth / 2) * 1 // zoom = 1
                  }
                }
                
                // Set viewport to zoom 1 with correct alignment
                reactFlowInstance.setViewport({ x: targetViewportX, y: targetViewportY, zoom: 1 }, { duration: 200 })
                
                // Clear flag after transition completes
                setTimeout(() => {
                  fitViewInProgressRef.current = false
                }, 250)
              } else {
                setViewMode('linear')
              }
            }}
            className={cn(
              'px-3 py-1 text-xs h-auto ml-[1px]',
              viewMode === 'linear' 
                ? 'bg-white text-gray-900 hover:bg-gray-50' 
                : 'bg-transparent text-gray-700 hover:bg-gray-100'
            )}
          >
            Linear
          </Button>
          {/* Canvas button with nested caret dropdown */}
          <div className={cn(
            'relative pl-3 pr-3 py-1 text-xs rounded-lg flex items-center gap-2 h-auto group mr-1.5',
            viewMode === 'canvas' 
              ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100' 
              : 'bg-transparent text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
          )}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (viewMode === 'canvas' && reactFlowInstance) {
                  // Already in canvas mode - reset to default zoom and center selected panel(s) over prompt box
                  const selectedNodes = nodes?.filter(n => n.selected) || []
                  const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
                  const chatTextarea = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]') as HTMLElement
                  const promptBox = chatTextarea?.closest('[class*="pointer-events-auto"]') as HTMLElement
                  
                  if (selectedNodes.length > 0 && promptBox && reactFlowElement) {
                    // Center selected panel(s) over prompt box at 100% zoom
                    const promptBoxRect = promptBox.getBoundingClientRect()
                    const reactFlowRect = reactFlowElement.getBoundingClientRect()
                    const promptBoxCenterX = (promptBoxRect.left + promptBoxRect.right) / 2 - reactFlowRect.left
                    
                    // Calculate center of selected nodes
                    const minX = Math.min(...selectedNodes.map(n => n.position.x))
                    const maxX = Math.max(...selectedNodes.map(n => n.position.x + 768)) // 768 = panel width
                    const minY = Math.min(...selectedNodes.map(n => n.position.y))
                    const maxY = Math.max(...selectedNodes.map(n => n.position.y + 400)) // estimate height
                    const nodesCenterX = (minX + maxX) / 2
                    const nodesCenterY = (minY + maxY) / 2
                    
                    // Calculate viewport to center nodes over prompt box horizontally
                    const targetViewportX = promptBoxCenterX - nodesCenterX * 1 // zoom = 1
                    const targetViewportY = (reactFlowRect.height / 2) - nodesCenterY * 1 // center vertically in map
                    
                    reactFlowInstance.setViewport({ x: targetViewportX, y: targetViewportY, zoom: 1 }, { duration: 200 })
                  } else {
                    // No selection - just reset to 100% zoom
                    const viewport = reactFlowInstance.getViewport()
                    reactFlowInstance.setViewport({ x: viewport.x, y: viewport.y, zoom: 1 }, { duration: 200 })
                  }
                } else {
                  setViewMode('canvas')
                }
              }}
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
                    'px-1.5 py-0.5 h-auto text-xs rounded focus-visible:ring-0 focus-visible:ring-offset-0',
                    viewMode === 'canvas' 
                      ? 'bg-white dark:bg-[#1f1f1f] text-gray-900 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-[#2a2a2a]' 
                      : 'bg-transparent text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 group-hover:bg-gray-100 dark:group-hover:bg-[#1f1f1f]'
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
      {/* Aligned to prompt box center with same gap as minimap when jumped (16px) */}
      {viewMode === 'linear' && messages.length > 0 && !isAtBottom && (
        <ReturnToBottomButton onClick={scrollToBottom} />
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

