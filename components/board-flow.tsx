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
  BaseEdge,
  getSmoothStepPath,
  EdgeProps,
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
import { useRouter } from 'next/navigation'
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
import { ChevronDown, ArrowDown, ChevronUp, Trash2 } from 'lucide-react'
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

// Custom animated dotted edge component - flows like Supabase schema visualizer
// The dashes themselves flow along the path, not a dot
function AnimatedDottedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  return (
    <BaseEdge 
      id={id} 
      path={edgePath} 
      style={{ 
        ...style, 
        strokeDasharray: '5,5',
        strokeDashoffset: 0,
        animation: 'flow-dash 1.5s linear infinite',
      }} 
    />
  )
}

// Fetch edges (connections) for a conversation - lightweight query (just message IDs)
async function fetchEdgesForConversation(conversationId: string): Promise<Array<{ source_message_id: string; target_message_id: string }>> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('panel_edges')
    .select('source_message_id, target_message_id')
    .eq('conversation_id', conversationId)
  
  if (error) {
    console.error('Error fetching edges:', error)
    return []
  }
  
  return data || []
}

// Define nodeTypes outside component as a module-level constant
// This ensures it's stable and React Flow won't complain about recreation
// Using Object.freeze to ensure immutability
// Note: ChatPanelNode is a stable function component, so this reference won't change
const nodeTypes = {
  chatPanel: ChatPanelNode,
} as const

// Define edgeTypes outside component as a module-level constant
const edgeTypes = {
  animatedDotted: AnimatedDottedEdge,
} as const

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
  
  // Initialize with consistent defaults to avoid hydration mismatch
  // Then update from localStorage in useEffect after hydration
  const [isScrollMode, setIsScrollMode] = useState(false) // false = Zoom, true = Scroll
  const [viewMode, setViewMode] = useState<'linear' | 'canvas'>('canvas')
  
  // Load preferences from localStorage first (instant), then Supabase (sync)
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    // STEP 1: Load from localStorage FIRST (synchronous, instant) - ensures UI shows saved prefs immediately
    const savedViewMode = localStorage.getItem('thinkable-view-mode') as 'linear' | 'canvas' | null
    if (savedViewMode && ['linear', 'canvas'].includes(savedViewMode)) {
      setViewMode(savedViewMode)
    }
    
      const savedScrollMode = localStorage.getItem('thinkable-scroll-mode')
      if (savedScrollMode === 'true') {
        setIsScrollMode(true)
    } else if (savedScrollMode === 'false') {
        setIsScrollMode(false)
      }
      
    const savedMinimapHidden = localStorage.getItem('thinkable-minimap-hidden')
    if (savedMinimapHidden === 'true') {
      setIsMinimapHidden(true)
      setIsMinimapManuallyHidden(true)
    }
    
    preferencesLoadedRef.current = true // Mark as loaded so we can save changes
    
    // STEP 2: Then load from Supabase (async) and update if different (for cross-device sync)
    const loadPreferences = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('metadata')
            .eq('id', user.id)
            .single()
          
          if (profile?.metadata) {
            const prefs = profile.metadata as {
              viewMode?: 'linear' | 'canvas'
              isScrollMode?: boolean
              isMinimapHidden?: boolean
            }
            
            // Update from Supabase if values exist (Supabase is source of truth for cross-device sync)
            if (prefs.viewMode && ['linear', 'canvas'].includes(prefs.viewMode)) {
              setViewMode(prefs.viewMode)
              localStorage.setItem('thinkable-view-mode', prefs.viewMode)
            }
            
            if (typeof prefs.isScrollMode === 'boolean') {
              setIsScrollMode(prefs.isScrollMode)
              localStorage.setItem('thinkable-scroll-mode', String(prefs.isScrollMode))
            }
            
            if (typeof prefs.isMinimapHidden === 'boolean') {
              setIsMinimapHidden(prefs.isMinimapHidden)
              setIsMinimapManuallyHidden(prefs.isMinimapHidden)
              localStorage.setItem('thinkable-minimap-hidden', String(prefs.isMinimapHidden))
            }
          }
        }
      } catch (error) {
        console.error('Error loading preferences from Supabase:', error)
        // If Supabase fails, localStorage values already loaded above will be used
      }
    }
    
    loadPreferences()
  }, [])
  
  // Reload preferences from Supabase when conversationId changes (to ensure selections persist when board ID is created)
  useEffect(() => {
    if (typeof window === 'undefined' || !conversationId) return
    
    const reloadPreferences = async () => {
      const supabase = createClient()
      
      try {
        // Try to load from Supabase first
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('metadata')
            .eq('id', user.id)
            .single()
          
          if (profile?.metadata) {
            const prefs = profile.metadata as {
              viewMode?: 'linear' | 'canvas'
              isScrollMode?: boolean
              isMinimapHidden?: boolean
            }
            
            // Load view mode
            if (prefs.viewMode && ['linear', 'canvas'].includes(prefs.viewMode)) {
              setViewMode(prefs.viewMode)
            }
            
            // Load scroll mode
            if (typeof prefs.isScrollMode === 'boolean') {
              setIsScrollMode(prefs.isScrollMode)
            }
            
            // Load minimap visibility
            if (typeof prefs.isMinimapHidden === 'boolean') {
              setIsMinimapHidden(prefs.isMinimapHidden)
              setIsMinimapManuallyHidden(prefs.isMinimapHidden)
            }
            
            // Update from Supabase if values exist
            if (prefs.viewMode && ['linear', 'canvas'].includes(prefs.viewMode)) {
              setViewMode(prefs.viewMode)
              localStorage.setItem('thinkable-view-mode', prefs.viewMode)
            }
            
            if (typeof prefs.isScrollMode === 'boolean') {
              setIsScrollMode(prefs.isScrollMode)
              localStorage.setItem('thinkable-scroll-mode', String(prefs.isScrollMode))
            }
            
            if (typeof prefs.isMinimapHidden === 'boolean') {
              setIsMinimapHidden(prefs.isMinimapHidden)
              setIsMinimapManuallyHidden(prefs.isMinimapHidden)
              localStorage.setItem('thinkable-minimap-hidden', String(prefs.isMinimapHidden))
            }
          }
        }
      } catch (error) {
        console.error('Error loading preferences from Supabase:', error)
      }
    }
    
    // Load from localStorage first (instant)
      const savedViewMode = localStorage.getItem('thinkable-view-mode') as 'linear' | 'canvas' | null
    if (savedViewMode && ['linear', 'canvas'].includes(savedViewMode)) {
        setViewMode(savedViewMode)
      }
    
    const savedScrollMode = localStorage.getItem('thinkable-scroll-mode')
    if (savedScrollMode === 'true') {
      setIsScrollMode(true)
    } else if (savedScrollMode === 'false') {
      setIsScrollMode(false)
    }
    
    const savedMinimapHidden = localStorage.getItem('thinkable-minimap-hidden')
    if (savedMinimapHidden === 'true') {
      setIsMinimapHidden(true)
      setIsMinimapManuallyHidden(true)
    }
    
    // Then load from Supabase (async) and update if different
    reloadPreferences()
  }, [conversationId])
  
  // Reload preferences from Supabase when conversation-created event fires (to catch selections made before first message)
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    const reloadSelections = async () => {
      const supabase = createClient()
      
      try {
        // Try to load from Supabase first
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('metadata')
            .eq('id', user.id)
            .single()
          
          if (profile?.metadata) {
            const prefs = profile.metadata as {
              viewMode?: 'linear' | 'canvas'
              isScrollMode?: boolean
              isMinimapHidden?: boolean
            }
            
            // Load view mode
            if (prefs.viewMode && ['linear', 'canvas'].includes(prefs.viewMode)) {
              setViewMode(prefs.viewMode)
            }
            
            // Load scroll mode
            if (typeof prefs.isScrollMode === 'boolean') {
              setIsScrollMode(prefs.isScrollMode)
            }
            
            // Load minimap visibility
            if (typeof prefs.isMinimapHidden === 'boolean') {
              setIsMinimapHidden(prefs.isMinimapHidden)
              setIsMinimapManuallyHidden(prefs.isMinimapHidden)
            }
            
            // Also update localStorage to keep them in sync
            if (prefs.viewMode) localStorage.setItem('thinkable-view-mode', prefs.viewMode)
            if (typeof prefs.isScrollMode === 'boolean') localStorage.setItem('thinkable-scroll-mode', String(prefs.isScrollMode))
            if (typeof prefs.isMinimapHidden === 'boolean') localStorage.setItem('thinkable-minimap-hidden', String(prefs.isMinimapHidden))
            
            return // Successfully loaded from Supabase, skip localStorage fallback
          }
        }
      } catch (error) {
        console.error('Error loading preferences from Supabase:', error)
      }
      
      // Fallback to localStorage
      const savedScrollMode = localStorage.getItem('thinkable-scroll-mode')
      if (savedScrollMode === 'true') {
        setIsScrollMode(true)
      } else {
        setIsScrollMode(false)
      }
      
      const savedViewMode = localStorage.getItem('thinkable-view-mode') as 'linear' | 'canvas' | null
      if (savedViewMode && ['linear', 'canvas'].includes(savedViewMode)) {
        setViewMode(savedViewMode)
      }
      
      const savedMinimapHidden = localStorage.getItem('thinkable-minimap-hidden')
      if (savedMinimapHidden === 'true') {
        setIsMinimapHidden(true)
        setIsMinimapManuallyHidden(true)
      }
    }
    
    const handleConversationCreated = () => {
      // Reload immediately - localStorage is instant
      reloadSelections()
    }
    
    // Also reload immediately on mount and when pathname changes (to catch navigation)
    const handlePathnameChange = () => {
      reloadSelections()
    }
    
    // Reload on initial mount
    reloadSelections()
    
    // Listen for conversation-created event
    window.addEventListener('conversation-created', handleConversationCreated)
    
    // Listen for pathname changes (navigation)
    window.addEventListener('popstate', handlePathnameChange)
    
    // Override pushState and replaceState to catch programmatic navigation
    const originalPushState = window.history.pushState
    const originalReplaceState = window.history.replaceState
    
    window.history.pushState = function(...args) {
      originalPushState.apply(window.history, args)
      setTimeout(handlePathnameChange, 0)
    }
    
    window.history.replaceState = function(...args) {
      originalReplaceState.apply(window.history, args)
      setTimeout(handlePathnameChange, 0)
    }
    
    return () => {
      window.removeEventListener('conversation-created', handleConversationCreated)
      window.removeEventListener('popstate', handlePathnameChange)
      window.history.pushState = originalPushState
      window.history.replaceState = originalReplaceState
    }
  }, [setIsScrollMode, setViewMode])
  
  const reactFlowInstance = useReactFlow()
  const { setReactFlowInstance, registerSetNodes, isLocked, layoutMode, setLayoutMode, setIsDeterministicMapping, panelWidth: contextPanelWidth, isPromptBoxCentered, lineStyle, setLineStyle, arrowDirection, setArrowDirection } = useReactFlowContext()
  const { setIsMobileMode } = useSidebarContext()
  const originalPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map()) // Store original positions for Linear mode
  const isLinearModeRef = useRef(false) // Track if we're currently in Linear mode
  
  // Reload top bar preferences when conversationId changes (new board created)
  // Load from localStorage first (instant), then Supabase (sync)
  useEffect(() => {
    if (!conversationId || typeof window === 'undefined') return
    
    // Load from localStorage first (instant) - ensures UI shows saved prefs immediately
    const savedLayoutMode = localStorage.getItem('thinkable-layout-mode') as 'auto' | 'tree' | 'cluster' | 'none' | null
    if (savedLayoutMode && ['auto', 'tree', 'cluster', 'none'].includes(savedLayoutMode)) {
      setLayoutMode(savedLayoutMode)
      setIsDeterministicMapping(savedLayoutMode !== 'none')
    }
    
    const savedLineStyle = localStorage.getItem('thinkable-line-style') as 'solid' | 'dotted' | null
    if (savedLineStyle && ['solid', 'dotted'].includes(savedLineStyle)) {
      setLineStyle(savedLineStyle)
    }
    
    const savedArrowDirection = localStorage.getItem('thinkable-arrow-direction') as 'down' | 'up' | 'left' | 'right' | null
    if (savedArrowDirection && ['down', 'up', 'left', 'right'].includes(savedArrowDirection)) {
      setArrowDirection(savedArrowDirection)
    }
    
    // Then load from Supabase (async) and update if different
    const reloadTopBarPrefs = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('metadata')
            .eq('id', user.id)
            .single()
          
          if (profile?.metadata) {
            const prefs = profile.metadata as {
              layoutMode?: 'auto' | 'tree' | 'cluster' | 'none'
              lineStyle?: 'solid' | 'dotted'
              arrowDirection?: 'down' | 'up' | 'left' | 'right'
            }
            
            // Update from Supabase if values exist
            if (prefs.layoutMode && ['auto', 'tree', 'cluster', 'none'].includes(prefs.layoutMode)) {
              setLayoutMode(prefs.layoutMode)
              setIsDeterministicMapping(prefs.layoutMode !== 'none')
              localStorage.setItem('thinkable-layout-mode', prefs.layoutMode)
            }
            
            if (prefs.lineStyle && ['solid', 'dotted'].includes(prefs.lineStyle)) {
              setLineStyle(prefs.lineStyle)
              localStorage.setItem('thinkable-line-style', prefs.lineStyle)
            }
            
            if (prefs.arrowDirection && ['down', 'up', 'left', 'right'].includes(prefs.arrowDirection)) {
              setArrowDirection(prefs.arrowDirection)
              localStorage.setItem('thinkable-arrow-direction', prefs.arrowDirection)
            }
          }
        }
      } catch (error) {
        console.error('Error reloading top bar preferences:', error)
      }
    }
    
    // Reload from Supabase immediately - localStorage already loaded (instant)
    reloadTopBarPrefs()
  }, [conversationId, setLayoutMode, setIsDeterministicMapping, setLineStyle, setArrowDirection])
  const selectedNodeIdRef = useRef<string | null>(null) // Track selected node ID
  const prevArrowDirectionRef = useRef<'down' | 'up' | 'left' | 'right'>('down') // Track previous arrow direction
  const supabase = createClient() // Create Supabase client for creating notes
  const queryClient = useQueryClient() // Query client for invalidating queries
  const router = useRouter()
  const prevViewportWidthRef = useRef<number>(0) // Track previous viewport width to detect changes
  const [isAtBottom, setIsAtBottom] = useState(true) // Track if scrolled to bottom in linear mode
  const [minimapBottom, setMinimapBottom] = useState<number>(17) // Default position 2px higher
  const [minimapRight, setMinimapRight] = useState<number>(15) // Dynamic right position to align with prompt box when jumped (default: 15px)
  const [minimapHoverLeft, setMinimapHoverLeft] = useState<number>(0) // Left position for hover zone to align with minimap left edge
  const [minimapPillCenter, setMinimapPillCenter] = useState<number>(0) // Center position for pill to center on minimap
  const [minimapPillBottom, setMinimapPillBottom] = useState<number>(8) // Bottom position for pill to center on minimap bottom edge
  const [minimapHoverBottom, setMinimapHoverBottom] = useState<number>(0) // Bottom position for hover area when jumped
  const [minimapHoverHeight, setMinimapHoverHeight] = useState<number>(28) // Height for hover area
  const [isMinimapHidden, setIsMinimapHidden] = useState(false) // Track if minimap is hidden
  const [clickedEdge, setClickedEdge] = useState<Edge | null>(null) // Track clicked edge for popup
  const [edgePopupPosition, setEdgePopupPosition] = useState({ x: 0, y: 0 }) // Position for edge popup
  const [rightClickedNode, setRightClickedNode] = useState<Node<ChatPanelNodeData> | null>(null) // Track right-clicked node for popup
  const [nodePopupPosition, setNodePopupPosition] = useState({ x: 0, y: 0 }) // Position for node popup
  const [isMinimapManuallyHidden, setIsMinimapManuallyHidden] = useState(false) // Track if minimap was manually hidden (vs auto-hidden)
  const [isMinimapHovering, setIsMinimapHovering] = useState(false) // Track if mouse is hovering over minimap area
  const [isPillHoverAreaHovering, setIsPillHoverAreaHovering] = useState(false) // Track if mouse is hovering over pill hover area specifically
  // Minimap visibility mode: 'shown' | 'hidden' | 'hover'
  // Initialize with default to avoid hydration mismatch, then load from localStorage in useEffect
  const [minimapMode, setMinimapMode] = useState<'shown' | 'hidden' | 'hover'>('hover')
  const [minimapContextMenuPosition, setMinimapContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [isBottomGapHovering, setIsBottomGapHovering] = useState(false) // Track if hovering over bottom gap (shared with prompt pill)
  const isMinimapHoveringRef = useRef(false) // Ref to track hover state for reliable checking in timeouts
  const minimapHideTimeoutRef = useRef<NodeJS.Timeout | null>(null) // Track hide timeout for minimap
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
  const edgePopupZoomRef = useRef<number | null>(null) // Track zoom when popup was opened
  const edgeClickPositionRef = useRef<{ x: number; y: number } | null>(null) // Store click position in flow coordinates
  const nodePopupZoomRef = useRef<number | null>(null) // Track zoom when node popup was opened
  const nodeClickPositionRef = useRef<{ x: number; y: number } | null>(null) // Store click position in flow coordinates

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
    if (typeof window === 'undefined') return
    
    // Save to localStorage immediately (lightweight, instant)
      localStorage.setItem('thinkable-view-mode', viewMode)
      localStorage.setItem('thinkable-scroll-mode', String(isScrollMode))
    
    // Save to Supabase in background (for cross-device sync)
    const saveToSupabase = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          // Get existing metadata to merge
          const { data: profile } = await supabase
            .from('profiles')
            .select('metadata')
            .eq('id', user.id)
            .single()
          
          const existingMetadata = profile?.metadata || {}
          
          // Update metadata with new preferences
          await supabase
            .from('profiles')
            .update({
              metadata: { ...existingMetadata, viewMode, isScrollMode },
            })
            .eq('id', user.id)
        }
      } catch (error) {
        console.error('Error saving preferences to Supabase:', error)
      }
    }
    
    saveToSupabase()
  }, [viewMode, isScrollMode])
  
  // Save minimap visibility to localStorage and Supabase when it changes
  useEffect(() => {
    if (!preferencesLoadedRef.current) return // Don't save before loading
    if (typeof window === 'undefined') return
    
    // Save to localStorage immediately
    localStorage.setItem('thinkable-minimap-hidden', String(isMinimapHidden))
  }, [isMinimapHidden])
  
  // Sync minimap visibility with mode
  useEffect(() => {
    // Save mode to localStorage
    localStorage.setItem('thinkable-minimap-mode', minimapMode)
    
    // Apply mode
    if (minimapMode === 'shown') {
      // Always show
      setIsMinimapHidden(false)
      setIsMinimapManuallyHidden(false)
      wasAutoHiddenRef.current = false
    } else if (minimapMode === 'hidden') {
      // Always hide
      setIsMinimapHidden(true)
      setIsMinimapManuallyHidden(true)
      wasAutoHiddenRef.current = false
    } else {
      // Hover mode - reset to default hover behavior (minimap hidden, shown on hover)
      setIsMinimapHidden(true)
      setIsMinimapManuallyHidden(false)
      wasAutoHiddenRef.current = false
    }
  }, [minimapMode])

  // Load minimap mode from localStorage on mount (after hydration)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('thinkable-minimap-mode')
      if (saved === 'shown' || saved === 'hidden' || saved === 'hover') {
        setMinimapMode(saved)
      }
    }
  }, [])

  // Keep ref in sync with state
  useEffect(() => {
    isMinimapHoveringRef.current = isMinimapHovering
  }, [isMinimapHovering])

  // Function to check if minimap should be hidden (called when leaving any related area)
  const checkAndHideMinimap = useCallback((relatedTarget?: HTMLElement | null) => {
    // Don't hide if mode is 'shown' or 'hidden' (only hide in 'hover' mode)
    if (minimapMode !== 'hover') {
      return
    }

    // Clear any existing hide timeout
    if (minimapHideTimeoutRef.current) {
      clearTimeout(minimapHideTimeoutRef.current)
      minimapHideTimeoutRef.current = null
    }
    
    // Check if relatedTarget is still in any related area
    if (relatedTarget && relatedTarget instanceof HTMLElement) {
      const minimapElement = relatedTarget.closest('[data-minimap-context]')
      const toggleElement = relatedTarget.closest('[data-minimap-toggle-context]')
      const pillElement = relatedTarget.closest('[data-minimap-pill-context]')
      const hoverZoneElement = relatedTarget.closest('[style*="zIndex: 9"]') // Hover zones have z-index 9
      
      // If moving to another related area, don't hide
      if (minimapElement || toggleElement || pillElement || hoverZoneElement) {
        return
      }
    }
    
    // Small delay to allow transition between areas
    minimapHideTimeoutRef.current = setTimeout(() => {
      // Re-check ref at timeout execution time
      const isInAnyArea = isMinimapHoveringRef.current
      
      // If minimap is shown and we're not in any related area, hide it
      if (!isMinimapHidden && !isInAnyArea && minimapMode === 'hover') {
        setIsMinimapHidden(true)
        setIsMinimapManuallyHidden(false)
        wasAutoHiddenRef.current = false
      }
    }, 200) // Slight delay to allow moving between areas
  }, [minimapMode, isMinimapHidden])

  // Close context menu when clicking outside
  useEffect(() => {
    if (!minimapContextMenuPosition) return

    const handleClick = () => {
      setMinimapContextMenuPosition(null)
    }

    const handleContextMenu = (e: MouseEvent) => {
      // Close if right-clicking elsewhere
      const target = e.target as HTMLElement
      if (!target.closest('[data-minimap-context]') && !target.closest('[data-minimap-pill-context]') && !target.closest('[data-minimap-toggle-context]')) {
        setMinimapContextMenuPosition(null)
      }
    }

    document.addEventListener('click', handleClick)
    document.addEventListener('contextmenu', handleContextMenu)
    
    return () => {
      document.removeEventListener('click', handleClick)
      document.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [minimapContextMenuPosition])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (minimapHideTimeoutRef.current) {
        clearTimeout(minimapHideTimeoutRef.current)
      }
    }
  }, [])

  // Fetch messages if conversationId is provided
  const { data: messages = [], refetch: refetchMessages } = useQuery({
    queryKey: ['messages-for-panels', conversationId],
    queryFn: () => conversationId ? fetchMessagesForPanels(conversationId) : Promise.resolve([]),
    enabled: !!conversationId,
    refetchInterval: 500, // Refetch every 500ms to pick up new messages (more aggressive for deterministic mapping)
    refetchOnWindowFocus: true,
    refetchOnMount: true, // Refetch when component mounts
    refetchOnReconnect: true, // Refetch when reconnecting
    // Read from cache even when query is initially disabled (for optimistic updates)
    placeholderData: (previousData) => {
      // If we have cached data for this conversationId, use it
      if (conversationId) {
        const cached = queryClient.getQueryData(['messages-for-panels', conversationId])
        if (cached) return cached as Message[]
      }
      return previousData
    },
  })

  // Fetch edges (connections) for the conversation - lightweight query
  const { data: savedEdges = [], refetch: refetchEdges } = useQuery({
    queryKey: ['panel-edges', conversationId],
    queryFn: () => conversationId ? fetchEdgesForConversation(conversationId) : Promise.resolve([]),
    enabled: !!conversationId,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchOnReconnect: true,
    staleTime: 0, // Always consider data stale to ensure fresh edges on load
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

  // Calculate hover zone left position to align with minimap left edge
  useEffect(() => {
    const calculateHoverLeft = () => {
      const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
      // Try both selectors to find minimap
      const minimapElement = document.querySelector('.minimap-custom-size') as HTMLElement || 
                             document.querySelector('.react-flow__minimap') as HTMLElement
      
      if (!reactFlowElement) return
      
      // Get React Flow rect first (needed for all calculations)
      const reactFlowRect = reactFlowElement.getBoundingClientRect()
      
      // Calculate center position relative to board flow inner (React Flow container)
      // Toggle is positioned at: right: minimapRight + 16px
      // Toggle is same width as minimap (179px)
      // Account for any padding on React Flow container
      const reactFlowWidth = reactFlowElement.clientWidth
      const reactFlowPaddingLeft = parseFloat(getComputedStyle(reactFlowElement).paddingLeft) || 0
      const reactFlowPaddingRight = parseFloat(getComputedStyle(reactFlowElement).paddingRight) || 0
      const minimapWidth = 179
      const toggleRightOffset = 16 // Toggle has 16px offset from minimap right position
      // Toggle right edge is: reactFlowWidth - (minimapRight + 16) - paddingRight
      // Toggle left edge is: toggle right - 179
      // Toggle center is: toggle left + 179/2
      const toggleRight = reactFlowWidth - minimapRight - toggleRightOffset - reactFlowPaddingRight
      const toggleLeft = toggleRight - minimapWidth
      const centerPosition = toggleLeft + minimapWidth / 2 + reactFlowPaddingLeft
      setMinimapPillCenter(centerPosition)
      
      // Get actual minimap position if available, otherwise calculate
      if (minimapElement) {
        const minimapRect = minimapElement.getBoundingClientRect()
        // Calculate left position relative to React Flow container
        // Use the actual minimap's left edge position - move much farther left
        // Check for SVG or content element inside minimap for more accurate position
        const minimapSvg = minimapElement.querySelector('svg') as HTMLElement
        const contentRect = minimapSvg ? minimapSvg.getBoundingClientRect() : minimapRect
        const leftPosition = contentRect.left - reactFlowRect.left
        setMinimapHoverLeft(leftPosition)
        // Calculate center position for pill using actual minimap SVG/content center
        // Use the SVG element inside the minimap for the true visual center
        // (Note: centerPosition already calculated above, but update with actual position when minimap is visible)
        if (minimapSvg) {
          const svgRect = minimapSvg.getBoundingClientRect()
          const svgCenterX = svgRect.left + svgRect.width / 2
          const centerPosition = svgCenterX - reactFlowRect.left
          setMinimapPillCenter(centerPosition)
          // Calculate bottom position - center of pill height on prompt box top edge when jumped, otherwise use default
          // Check if minimap has jumped (minimapBottom state is 79 when jumped, 17 when default)
          const reactFlowBottom = reactFlowRect.bottom
          if (minimapBottom === 79) {
            // Minimap has jumped - center pill on prompt box top edge instead of minimap bottom edge
            const chatInputElement = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]') as HTMLElement
            const promptBoxContainer = chatInputElement?.closest('[class*="pointer-events-auto"]') as HTMLElement
            if (promptBoxContainer) {
              const promptBoxRect = promptBoxContainer.getBoundingClientRect()
              const promptBoxTop = promptBoxRect.top
              // Pill is 6px tall, so center is 3px from bottom - position so center aligns with prompt box top edge
              // bottom = distance from reactFlow bottom to (prompt box top - 3px) = reactFlowBottom - promptBoxTop - 3
              const pillBottom = reactFlowBottom - promptBoxTop - 3
              setMinimapPillBottom(pillBottom)
              // Calculate hover area position - starts at minimap bottom, extends downward
              const minimapBottomEdge = minimapRect.bottom
              // Position hover area starting at minimap bottom - top edge at minimap bottom
              // bottom CSS value: distance from ReactFlow bottom to minimap bottom
              const hoverAreaBottomFromReactFlow = reactFlowBottom - minimapBottomEdge
              // Height: distance from minimap bottom to just above prompt box
              const hoverAreaHeight = minimapBottomEdge - promptBoxTop
              setMinimapHoverBottom(hoverAreaBottomFromReactFlow)
              setMinimapHoverHeight(hoverAreaHeight)
            } else {
              // Fallback to minimap bottom edge if prompt box not found
              const minimapBottomEdge = minimapRect.bottom
              const pillBottom = reactFlowBottom - minimapBottomEdge - 3
              setMinimapPillBottom(pillBottom)
              setMinimapHoverBottom(0)
              setMinimapHoverHeight(28)
            }
          } else {
            // Default position when not jumped
            setMinimapPillBottom(8)
            setMinimapHoverBottom(0)
            setMinimapHoverHeight(28)
          }
        } else {
          // Fallback to container center if SVG not found
          // (Note: centerPosition already calculated above, but update with actual position when minimap is visible)
          const minimapCenterX = minimapRect.left + minimapRect.width / 2
          const centerPosition = minimapCenterX - reactFlowRect.left
          setMinimapPillCenter(centerPosition)
          // Calculate bottom position - center of pill height on prompt box top edge when jumped, otherwise use default
          const reactFlowBottom = reactFlowRect.bottom
          if (minimapBottom === 79) {
            // Minimap has jumped - center pill on prompt box top edge instead of minimap bottom edge
            const chatInputElement = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]') as HTMLElement
            const promptBoxContainer = chatInputElement?.closest('[class*="pointer-events-auto"]') as HTMLElement
            if (promptBoxContainer) {
              const promptBoxRect = promptBoxContainer.getBoundingClientRect()
              const promptBoxTop = promptBoxRect.top
              // Pill is 6px tall, so center is 3px from bottom - position so center aligns with prompt box top edge
              // bottom = distance from reactFlow bottom to (prompt box top - 3px) = reactFlowBottom - promptBoxTop - 3
              const pillBottom = reactFlowBottom - promptBoxTop - 3
              setMinimapPillBottom(pillBottom)
            } else {
              // Fallback to minimap bottom edge if prompt box not found
              const minimapBottomEdge = minimapRect.bottom
              const pillBottom = reactFlowBottom - minimapBottomEdge - 3
              setMinimapPillBottom(pillBottom)
            }
          } else {
            // Default position when not jumped
            setMinimapPillBottom(8)
          }
        }
      } else {
        // Fallback calculation - calculate from container width
        // (Note: centerPosition already calculated above, stays the same)
        const reactFlowWidth = reactFlowElement.clientWidth
        const minimapWidth = 179
        // Calculate left position: container width - right offset - minimap width
        const leftPosition = reactFlowWidth - minimapRight - minimapWidth
        setMinimapHoverLeft(leftPosition)
        // When minimap is hidden, calculate bottom position
        // If minimap was jumped (minimapBottom === 79), center pill on prompt box top edge
        const reactFlowBottom = reactFlowRect.bottom
        if (minimapBottom === 79) {
          // Minimap was jumped - center pill on prompt box top edge
          const chatInputElement = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]') as HTMLElement
          const promptBoxContainer = chatInputElement?.closest('[class*="pointer-events-auto"]') as HTMLElement
          if (promptBoxContainer) {
            const promptBoxRect = promptBoxContainer.getBoundingClientRect()
            const promptBoxTop = promptBoxRect.top
            // Pill is 6px tall, so center is 3px from bottom - position so center aligns with prompt box top edge
            // bottom = distance from reactFlow bottom to (prompt box top - 3px) = reactFlowBottom - promptBoxTop - 3
            const pillBottom = reactFlowBottom - promptBoxTop - 3
            setMinimapPillBottom(pillBottom)
            // Calculate hover area position - between minimap bottom and prompt box top
            // When minimap is hidden, use toggle position (minimapBottom - 12 + 15 from reactFlow bottom)
            const toggleBottomFromReactFlowBottom = minimapBottom - 12 + 15
            const toggleBottom = reactFlowBottom - toggleBottomFromReactFlowBottom
            const hoverAreaTop = promptBoxTop // Hover area top is at prompt box top
            const hoverAreaBottom = toggleBottom // Hover area bottom is at toggle bottom
            const hoverAreaHeight = hoverAreaTop - hoverAreaBottom
            const hoverAreaBottomFromReactFlow = reactFlowBottom - hoverAreaBottom
            setMinimapHoverBottom(hoverAreaBottomFromReactFlow)
            setMinimapHoverHeight(hoverAreaHeight)
          } else {
            // Fallback: calculate where toggle bottom edge would be
            const toggleBottomFromReactFlowBottom = minimapBottom - 12 + 15
            const toggleBottom = reactFlowBottom - toggleBottomFromReactFlowBottom
            const pillBottom = reactFlowBottom - toggleBottom - 3
            setMinimapPillBottom(pillBottom)
            setMinimapHoverBottom(0)
            setMinimapHoverHeight(28)
          }
        } else {
          // Default position when not jumped
          setMinimapPillBottom(8)
          setMinimapHoverBottom(0)
          setMinimapHoverHeight(28)
        }
      }
    }

    calculateHoverLeft()
    window.addEventListener('resize', calculateHoverLeft)
    
    // Also check periodically to catch minimap position changes
    const interval = setInterval(calculateHoverLeft, 100)
    
    return () => {
      window.removeEventListener('resize', calculateHoverLeft)
      clearInterval(interval)
    }
  }, [minimapRight, isMinimapHidden, minimapBottom])

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
        
        // Don't process right-clicks (button 2) - allow context menu to work
        if (e.button === 2) {
          return
        }
        
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
        // Don't process right-clicks (button 2) - allow context menu to work
        if (e.button === 2) {
          minimapDragStartRef.current = null
          return
        }
        
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
            
            if (reactFlowElement && promptBox && clickedNode) {
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

  // Load saved edges from database when nodes are available
  useEffect(() => {
    if (!savedEdges || savedEdges.length === 0) {
      console.log('🔄 BoardFlow: No saved edges to load', { savedEdgesLength: savedEdges?.length || 0 })
      return
    }
    
    if (!nodes || nodes.length === 0) {
      console.log('🔄 BoardFlow: Nodes not ready yet, waiting...', { nodesLength: nodes?.length || 0 })
      return
    }
    
    console.log(`🔄 BoardFlow: Loading ${savedEdges.length} saved edges from database, ${nodes.length} nodes available`)
    
    // Convert saved edges (message IDs) to React Flow edges (node IDs)
    const reactFlowEdges: Edge[] = []
    
    for (const savedEdge of savedEdges) {
      // Find nodes by message ID
      const sourceNodes = nodes.filter(n => n.data.promptMessage.id === savedEdge.source_message_id)
      const targetNodes = nodes.filter(n => n.data.promptMessage.id === savedEdge.target_message_id)
      
      if (sourceNodes.length === 0) {
        console.warn(`🔄 BoardFlow: Source node not found for message ID: ${savedEdge.source_message_id}`)
      }
      if (targetNodes.length === 0) {
        console.warn(`🔄 BoardFlow: Target node not found for message ID: ${savedEdge.target_message_id}`)
      }
      
      // Create edges between all matching source and target nodes
      for (const sourceNode of sourceNodes) {
        for (const targetNode of targetNodes) {
          const edgeId = `${sourceNode.id}-${targetNode.id}`
          
          // Check if edge already exists in current edges
          const existingEdge = edges.find(e => e.id === edgeId || (e.source === sourceNode.id && e.target === targetNode.id))
          if (!existingEdge) {
            reactFlowEdges.push({
              id: edgeId,
              source: sourceNode.id,
              target: targetNode.id,
              sourceHandle: 'right',
              targetHandle: 'left',
              type: lineStyle === 'dotted' ? 'animatedDotted' : 'smoothstep', // Use animated dotted edge if selected, otherwise smoothstep
            })
            console.log(`🔄 BoardFlow: Prepared edge: ${sourceNode.id} -> ${targetNode.id}`)
          } else {
            console.log(`🔄 BoardFlow: Edge already exists in React Flow: ${edgeId}`)
          }
        }
      }
    }
    
    if (reactFlowEdges.length > 0) {
      console.log(`🔄 BoardFlow: Adding ${reactFlowEdges.length} saved edges to React Flow`)
      setEdges((eds) => {
        // Filter out duplicates
        const edgesToAdd = reactFlowEdges.filter(newEdge => 
          !eds.some(existingEdge => 
            existingEdge.source === newEdge.source && existingEdge.target === newEdge.target
          )
        )
        if (edgesToAdd.length > 0) {
          console.log(`🔄 BoardFlow: Adding ${edgesToAdd.length} new edges (${reactFlowEdges.length - edgesToAdd.length} already exist)`)
          return [...eds, ...edgesToAdd]
        }
        console.log('🔄 BoardFlow: All edges already exist in React Flow')
        return eds
      })
    } else {
      console.log('🔄 BoardFlow: No new edges to add (all already exist or nodes not found)')
    }
  }, [savedEdges, nodes, edges, setEdges])

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
              type: lineStyle === 'dotted' ? 'animatedDotted' : 'smoothstep', // Use animated dotted edge if selected, otherwise smoothstep
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
        // Dispatch event when node is selected so input can refocus
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('node-selected'))
        }
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
    // Check cache for optimistic updates even if query isn't enabled yet
    let messagesToUse = messages
    if (conversationId && messages.length === 0) {
      const cached = queryClient.getQueryData(['messages-for-panels', conversationId]) as Message[] | undefined
      if (cached && cached.length > 0) {
        console.log('🔄 BoardFlow: Using cached messages for immediate panel creation:', cached.length)
        messagesToUse = cached
      }
    }
    
    // If we have conversationId but no messages (neither from query nor cache), wait
    if (conversationId && messagesToUse.length === 0) {
      console.log('🔄 BoardFlow: Waiting for messages to load for conversation:', conversationId)
      return
    }
    
    const messagesKeyToUse = messagesToUse.map(m => `${m.id}-${m.content.slice(0, 10)}`).join(',')
    console.log('🔄 BoardFlow: Creating panels from messages, count:', messagesToUse.length, 'messagesKey:', messagesKeyToUse, 'prevKey:', prevMessagesKeyRef.current)
    
    // Skip if messages haven't actually changed
    if (messagesKeyToUse === prevMessagesKeyRef.current) {
      console.log('🔄 BoardFlow: Messages key unchanged, skipping panel creation')
      return
    }

    console.log('🔄 BoardFlow: Messages changed, creating panels')
    prevMessagesKeyRef.current = messagesKeyToUse

    if (!conversationId || messagesToUse.length === 0) {
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
    const gapBetweenPanels = 50 // Fixed gap between panels (size-aware spacing)
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

    // Calculate starting Y position - use same spacing as linear mode for consistency
    // Linear mode uses: startY = 0, then y = startY + (index * panelSpacing)
    // Canvas mode should use the same default spacing when no stored position exists
    const startY = 0 // Same as linear mode - start at y=0
    let currentY = startY // Start at 0, will increase as we add panels (top to bottom)

    // Group messages into prompt+response pairs
    // With deterministic mapping, multiple assistant messages can follow one user message
    // Process messages in reverse order so newest panels appear at bottom, oldest at top
    console.log('🔄 BoardFlow: Grouping messages into panels, total messages:', messagesToUse.length)
    
    // Process messages from end to start (newest first) to place newest panels at bottom
    let i = messagesToUse.length - 1
    while (i >= 0) {
      const message = messagesToUse[i]
      
      if (message.role === 'user') {
        // Find all consecutive assistant messages that follow this user message (in original order)
        // Since we're processing backwards, assistant messages are at higher indices (already passed)
        // So we need to look ahead in the original array
        const responseMessages: Message[] = []
        let j = i + 1
        while (j < messagesToUse.length && messagesToUse[j].role === 'assistant') {
          responseMessages.push(messagesToUse[j])
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
        
        // Calculate position based on arrow direction relative to most recent panel
        // Default: vertical top-to-bottom (down arrow)
        let currentPos: { x: number; y: number }
        
        if (viewMode === 'canvas' && storedPos?.x !== undefined && storedPos?.y !== undefined) {
          // Use stored position if available (user moved it)
          currentPos = { x: storedPos.x, y: storedPos.y }
        } else {
          // Find reference panel: use selected panel if one is selected, otherwise use most recent panel
          const existingNodes = nodes && Array.isArray(nodes) ? nodes : []
          let referenceNode: Node<ChatPanelNodeData> | null = null
          
          if (existingNodes.length > 0) {
            // First, check if there's a selected panel (this overrides most recent)
            const selectedNode = existingNodes.find(n => n.selected)
            
            if (selectedNode) {
              // Use selected panel as reference
              referenceNode = selectedNode
            } else {
              // No selected panel - find node with the newest message (highest message ID or latest created_at)
              referenceNode = existingNodes.reduce((newest, node) => {
                const newestMessageId = newest.data.promptMessage.id
                const nodeMessageId = node.data.promptMessage.id
                // Compare message IDs (they're UUIDs, but newer ones should be lexicographically greater)
                // Or compare created_at if available
                const newestCreated = new Date(newest.data.promptMessage.created_at || 0).getTime()
                const nodeCreated = new Date(node.data.promptMessage.created_at || 0).getTime()
                return nodeCreated > newestCreated ? node : newest
              }, existingNodes[0])
            }
          }
          
          if (referenceNode) {
            // Position relative to reference panel (selected or most recent) based on arrow direction
            // Use actual panel height for size-aware spacing
            const referenceHeight = nodeHeightsRef.current.get(referenceNode.id) || 400
            const baseX = referenceNode.position.x
            const baseY = referenceNode.position.y
            
            // In canvas mode, use arrow direction for positioning
            // In linear mode, always use down (vertical stacking)
            const directionToUse = viewMode === 'canvas' ? arrowDirection : 'down'
            
            switch (directionToUse) {
              case 'down':
                // Place below (increase Y): baseY + panel height + gap
                currentPos = { x: baseX, y: baseY + referenceHeight + gapBetweenPanels }
                break
              case 'up':
                // Place above (decrease Y): baseY - gap (we'll use estimated height for new panel)
                const estimatedNewHeight = 400
                currentPos = { x: baseX, y: baseY - estimatedNewHeight - gapBetweenPanels }
                break
              case 'right':
                // Place to the right (increase X): use panel width + gap for size-aware spacing
                const panelWidthForSpacing = contextPanelWidth || 768
                currentPos = { x: baseX + panelWidthForSpacing + gapBetweenPanels, y: baseY }
                break
              case 'left':
                // Place to the left (decrease X): use panel width + gap for size-aware spacing
                const panelWidthForSpacingLeft = contextPanelWidth || 768
                currentPos = { x: baseX - panelWidthForSpacingLeft - gapBetweenPanels, y: baseY }
                break
              default:
                // Default to down (below)
                currentPos = { x: baseX, y: baseY + referenceHeight + gapBetweenPanels }
            }
          } else {
            // No existing panels or in linear mode: use size-aware vertical spacing
            // Calculate cumulative height of previous panels
            let cumulativeY = startY
            for (let i = 0; i < panelIndex; i++) {
              // Find the previous panel's height (if we had access to previous nodes)
              // For now, use estimated height for new panels
              const estimatedHeight = 400
              cumulativeY += estimatedHeight + gapBetweenPanels
            }
            currentPos = { 
              x: centeredX, 
              y: cumulativeY
            }
          }
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

            // For subsequent panels from the same user message, stack them in the arrow direction
            let panelPosition: { x: number; y: number }
            if (responseIndex === 0) {
              panelPosition = currentPos
            } else {
              // Stack subsequent panels in the arrow direction with size-aware spacing
              const estimatedPanelHeight = 400
              switch (arrowDirection) {
                case 'down':
                  // Stack below: current position + (previous panel height + gap) * index
                  panelPosition = { 
                  x: currentPos.x, 
                    y: currentPos.y + (responseIndex * (estimatedPanelHeight + gapBetweenPanels)) 
                  }
                  break
                case 'up':
                  // Stack above: current position - (panel height + gap) * index
                  panelPosition = { 
                    x: currentPos.x, 
                    y: currentPos.y - (responseIndex * (estimatedPanelHeight + gapBetweenPanels)) 
                  }
                  break
                case 'right':
                  // Stack to the right: use panel width + gap for size-aware spacing
                  const panelWidthForStackRight = contextPanelWidth || 768
                  panelPosition = { 
                    x: currentPos.x + (responseIndex * (panelWidthForStackRight + gapBetweenPanels)), 
                    y: currentPos.y 
                  }
                  break
                case 'left':
                  // Stack to the left: use panel width + gap for size-aware spacing
                  const panelWidthForStackLeft = contextPanelWidth || 768
                  panelPosition = { 
                    x: currentPos.x - (responseIndex * (panelWidthForStackLeft + gapBetweenPanels)), 
                    y: currentPos.y 
                  }
                  break
                default:
                  panelPosition = { 
                    x: currentPos.x, 
                    y: currentPos.y + (responseIndex * (estimatedPanelHeight + gapBetweenPanels)) 
                  }
              }
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
            // Don't increment panelIndex here - all response panels from one user message should be at the same base Y
          })
          
          // Increment panelIndex after all response panels for this user message are created
          // This ensures the next user message is spaced below
          panelIndex++
          
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
    
    console.log('🔄 BoardFlow: Created', newNodes.length, 'panels from', messagesToUse.length, 'messages')
    console.log('🔄 BoardFlow: Messages order:', messagesToUse.map(m => ({ id: m.id, role: m.role, content: m.content.substring(0, 30) })))
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

      // Separate nodes into: truly new, updates to existing, and unchanged existing
      const trulyNewNodes = newNodes.filter(n => !existingNodeIds.has(n.id))
      const nodesToUpdate = newNodes.filter(n => {
        if (!existingNodeIds.has(n.id)) return false // Not an existing node
        const existingNode = nodes.find(existing => existing.id === n.id)
        if (!existingNode) return false
        // Update if response changed (e.g., response was added or updated)
        const existingResponseId = existingNode.data.responseMessage?.id
        const newResponseId = n.data.responseMessage?.id
        return existingResponseId !== newResponseId
      })
      const unchangedNodes = nodes.filter(n => {
        const needsUpdate = nodesToUpdate.some(update => update.id === n.id)
        return !needsUpdate
      })

      // Only position truly new nodes, keep existing nodes completely unchanged
      // Preserve the position that was calculated based on reference node and arrow direction
      const positionedNewNodes = trulyNewNodes.map((node, newIndex) => {
        // Use the position that was already calculated in the panel creation loop
        // (based on reference node and arrow direction), don't recalculate
          return {
            ...node,
          position: node.position, // Keep the position that was set during panel creation
            draggable: isLocked ? false : false, // Lock takes precedence (always false here)
          }
      })

      // Update existing nodes that need updates (e.g., response was added) - keep their positions
      const updatedExistingNodes = nodesToUpdate.map(node => {
        const existingNode = nodes.find(n => n.id === node.id)
          return {
            ...node,
          position: existingNode?.position ?? node.position, // Keep existing position
          draggable: existingNode?.draggable ?? node.draggable, // Keep existing draggable state
        }
      })

      // Merge: unchanged nodes + updated nodes + new nodes
      const updatedNodes = [...unchangedNodes, ...updatedExistingNodes, ...positionedNewNodes]
      setNodes(updatedNodes)
      
      // Update stored positions only for new nodes
      positionedNewNodes.forEach((node) => {
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
        if (updatedNodes.length > 0) {
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
      // Canvas mode - add new nodes and update existing nodes that need updates (e.g., response added)
      // Find existing nodes (those that already exist in current nodes array)
      const existingNodeIds = new Set(nodes && Array.isArray(nodes) ? nodes.map(n => n.id) : [])
      const trulyNewNodesCanvas = newNodes.filter(n => !existingNodeIds.has(n.id))
      const nodesToUpdateCanvas = newNodes.filter(n => {
        if (!existingNodeIds.has(n.id)) return false // Not an existing node
        const existingNode = nodes.find(existing => existing.id === n.id)
        if (!existingNode) return false
        // Update if response changed (e.g., response was added or updated)
        const existingResponseId = existingNode.data.responseMessage?.id
        const newResponseId = n.data.responseMessage?.id
        return existingResponseId !== newResponseId
      })
      const unchangedNodesCanvas = nodes.filter(n => {
        const needsUpdate = nodesToUpdateCanvas.some(update => update.id === n.id)
        return !needsUpdate
      })

      console.log('🔄 BoardFlow: Adding', trulyNewNodesCanvas.length, 'new canvas nodes, updating', nodesToUpdateCanvas.length, 'existing nodes, keeping', unchangedNodesCanvas.length, 'unchanged')
      
      // Update existing nodes that need updates (e.g., response was added) - keep their positions
      const updatedExistingNodesCanvas = nodesToUpdateCanvas.map(node => {
        const existingNode = nodes.find(n => n.id === node.id)
        return {
          ...node,
          position: existingNode?.position ?? node.position, // Keep existing position
          draggable: existingNode?.draggable ?? node.draggable, // Keep existing draggable state
        }
      })

      // Merge: unchanged nodes + updated nodes + new nodes
      const updatedCanvasNodes = [...unchangedNodesCanvas, ...updatedExistingNodesCanvas, ...trulyNewNodesCanvas]
      setNodes(updatedCanvasNodes)
      
      // Only center new panels horizontally in Canvas mode if they weren't positioned relative to a reference node
      // Check if new nodes were positioned relative to a reference node (they would have been positioned based on arrowDirection)
      const hasReferenceNode = nodes && Array.isArray(nodes) && nodes.length > 0
      const shouldCenter = !hasReferenceNode // Only center if this is the first panel (no reference node)
      
      if (trulyNewNodesCanvas.length > 0 && shouldCenter) {
      setTimeout(() => {
          const reactFlowElement = document.querySelector('.react-flow')
          if (!reactFlowElement) return
          
          const viewportWidth = reactFlowElement.clientWidth
          const viewport = reactFlowInstance.getViewport()
          const panelWidth = 768 // Same width as prompt box
          
          // Only calculate bounds for new nodes
          const minX = Math.min(...trulyNewNodesCanvas.map(n => n.position.x))
          const maxX = Math.max(...trulyNewNodesCanvas.map(n => n.position.x))
          const boundsWidth = maxX - minX + panelWidth
          const boundsCenterX = minX + boundsWidth / 2
          
          // Center horizontally
          const centerX = (viewportWidth / 2 - viewport.x) / viewport.zoom
          const offsetX = centerX - boundsCenterX
          
          // Only reposition if offset is significant (more than 10px)
          if (Math.abs(offsetX) > 10) {
            // Only reposition new nodes, keep existing nodes unchanged
            setNodes((currentNodes) => {
              return currentNodes.map((node) => {
                const isNewNode = trulyNewNodesCanvas.some(n => n.id === node.id)
                if (isNewNode) {
                  return {
              ...node,
              position: {
                x: node.position.x + offsetX,
                y: node.position.y,
              },
                  }
                }
                return node // Keep existing nodes exactly as they are
              })
            })
            
            // Update stored positions only for new nodes
            trulyNewNodesCanvas.forEach((node) => {
              const updatedNode = updatedCanvasNodes.find(n => n.id === node.id)
              if (updatedNode) {
                originalPositionsRef.current.set(node.id, {
                  x: updatedNode.position.x + offsetX,
                  y: updatedNode.position.y,
                })
              }
            })
          }
        }, 100)
      } else if (trulyNewNodesCanvas.length > 0) {
        // New nodes were positioned relative to a reference node - save their positions to localStorage
        trulyNewNodesCanvas.forEach((node) => {
              originalPositionsRef.current.set(node.id, {
                x: node.position.x,
                y: node.position.y,
              })
          
          // Save to localStorage
          if (conversationId && typeof window !== 'undefined') {
            try {
              const saved = localStorage.getItem(`thinkable-canvas-positions-${conversationId}`)
              const positions = saved ? JSON.parse(saved) : {}
              positions[node.id] = node.position
              localStorage.setItem(`thinkable-canvas-positions-${conversationId}`, JSON.stringify(positions))
            } catch (error) {
              console.error('Failed to save position to localStorage:', error)
            }
          }
        })
      }
    }
    // Update prevArrowDirectionRef after panel creation
    prevArrowDirectionRef.current = arrowDirection
  }, [messagesKey, conversationId, messages.length, viewMode, setNodes, arrowDirection, nodes])

  // Handle arrow direction change when panels are selected
  // Format selected panels relative to each other based on arrow direction
  useEffect(() => {
    // Only run if arrow direction changed and at least one node is selected
    if (prevArrowDirectionRef.current === arrowDirection) return
    if (viewMode !== 'canvas') return // Only in canvas mode
    
    // Find all selected nodes
    const selectedNodes = nodes.filter(n => n.selected)
    if (selectedNodes.length === 0) return // No panels selected
    
    const selectedNodeIds = new Set(selectedNodes.map(n => n.id))
    const gapBetweenPanels = 50 // Fixed gap between panels
    
    // Find the most recent selected panel (anchor point)
    const anchorNode = selectedNodes.reduce((newest, node) => {
      const newestCreated = new Date(newest.data.promptMessage.created_at || 0).getTime()
      const nodeCreated = new Date(node.data.promptMessage.created_at || 0).getTime()
      return nodeCreated > newestCreated ? node : newest
    }, selectedNodes[0])
    
    // Use anchor node's current position as the base
    const baseX = anchorNode.position.x
    const baseY = anchorNode.position.y
    const anchorHeight = nodeHeightsRef.current.get(anchorNode.id) || 400
    
    // Sort selected nodes by their current position to determine stacking order
    // For vertical directions (up/down), sort by Y; for horizontal (left/right), sort by X
    const sortedSelectedNodes = [...selectedNodes].sort((a, b) => {
      if (arrowDirection === 'down' || arrowDirection === 'up') {
        return a.position.y - b.position.y // Sort by Y for vertical stacking
      } else {
        return a.position.x - b.position.x // Sort by X for horizontal stacking
      }
    })
    
    // Update all selected nodes' positions
    // Stack them in the arrow direction relative to the anchor panel with size-aware spacing
    setNodes((nds) =>
      nds.map((n) => {
        if (!selectedNodeIds.has(n.id)) return n
        
        // Find the index of this node in the sorted selected nodes
        const selectedIndex = sortedSelectedNodes.findIndex(sn => sn.id === n.id)
        
        // If this is the anchor node, keep it at base position
        if (n.id === anchorNode.id) {
          const newPosition = { x: baseX, y: baseY }
          
          // Update stored position
          originalPositionsRef.current.set(n.id, newPosition)
          
          // Save to localStorage
          if (conversationId && typeof window !== 'undefined') {
            try {
              const saved = localStorage.getItem(`thinkable-canvas-positions-${conversationId}`)
              const positions = saved ? JSON.parse(saved) : {}
              positions[n.id] = newPosition
              localStorage.setItem(`thinkable-canvas-positions-${conversationId}`, JSON.stringify(positions))
            } catch (error) {
              console.error('Failed to save position to localStorage:', error)
            }
          }
          
          return { ...n, position: newPosition }
        }
        
        // For other selected nodes, position them relative to anchor in arrow direction
        // Use uniform spacing (fixed gap) regardless of panel sizes for even formatting
        // Both horizontal and vertical use the same gap between panels (50px visual gap)
        const panelWidthForFormat = contextPanelWidth || 768
        const gapBetweenPanels = 50 // Visual gap between panels (same for both directions)
        const estimatedPanelHeight = 400
        // For vertical: use a smaller spacing that still provides the gap (panel height is accounted for by panel itself)
        // Use panel height + gap for proper spacing, but this might be too much, so let's try a middle value
        const verticalSpacing = 250 // Middle value between 50px (too small) and 450px (too big)
        let offsetX = 0
        let offsetY = 0
        
        if (selectedIndex > 0) {
          // Use uniform spacing based on index (not cumulative sizes)
          // Horizontal: panel width + gap, Vertical: fixed spacing that provides visual gap
          switch (arrowDirection) {
            case 'down':
              offsetY = selectedIndex * verticalSpacing
              break
            case 'up':
              offsetY = -(selectedIndex * verticalSpacing)
              break
            case 'right':
              offsetX = selectedIndex * (panelWidthForFormat + gapBetweenPanels)
              break
            case 'left':
              offsetX = -(selectedIndex * (panelWidthForFormat + gapBetweenPanels))
              break
          }
        }
        
        const newPosition = {
          x: baseX + offsetX,
          y: baseY + offsetY
        }
        
        // Update stored position
        originalPositionsRef.current.set(n.id, newPosition)
        
        // Save to localStorage
        if (conversationId && typeof window !== 'undefined') {
          try {
            const saved = localStorage.getItem(`thinkable-canvas-positions-${conversationId}`)
            const positions = saved ? JSON.parse(saved) : {}
            positions[n.id] = newPosition
            localStorage.setItem(`thinkable-canvas-positions-${conversationId}`, JSON.stringify(positions))
          } catch (error) {
            console.error('Failed to save position to localStorage:', error)
          }
        }
        
        return { ...n, position: newPosition }
      })
    )
    
    // Update prevArrowDirectionRef
    prevArrowDirectionRef.current = arrowDirection
  }, [arrowDirection, nodes, setNodes, viewMode, conversationId])

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

      // Apply size-aware spacing: accumulate panel heights + gaps
      const gapBetweenPanels = 50 // Fixed gap between panels
      let cumulativeY = startY
      const linearNodes = sortedNodes.map((node, index) => {
        // Calculate Y position based on previous panels' heights
        if (index > 0) {
          const prevNode = sortedNodes[index - 1]
          const prevHeight = nodeHeightsRef.current.get(prevNode.id) || 400
          cumulativeY += prevHeight + gapBetweenPanels
        }
        
        return {
        ...node,
        position: {
          x: centeredX, // Use calculated centered position from the start
            y: cumulativeY, // Size-aware spacing: previous panels' heights + gaps
        },
        draggable: isLocked ? false : false, // Not draggable in Linear mode (or when locked)
        }
      })

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

  // Handle node right-click to show popup (select node if not selected, then show popup)
  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: Node<ChatPanelNodeData>) => {
    event.preventDefault() // Prevent default browser context menu
    event.stopPropagation() // Prevent other handlers
    
    // If node is not selected, select it first
    if (!node.selected) {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === node.id
            ? { ...n, selected: true }
            : n
        )
      )
    }
    
    // Get click position and convert to flow coordinates
    const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
    if (reactFlowInstance && reactFlowElement) {
      const rect = reactFlowElement.getBoundingClientRect()
      const screenX = event.clientX - rect.left
      const screenY = event.clientY - rect.top
      
      // Convert screen coordinates to flow coordinates
      const viewport = reactFlowInstance.getViewport()
      const flowX = screenX / viewport.zoom - viewport.x
      const flowY = screenY / viewport.zoom - viewport.y
      
      // Store click position in flow coordinates
      nodeClickPositionRef.current = { x: flowX, y: flowY }
      
      // Set initial screen position
      setNodePopupPosition({ x: screenX, y: screenY })
      
      // Store zoom when popup opens
      nodePopupZoomRef.current = viewport.zoom
    }
    
    // Show popup for the right-clicked node (actions will affect all selected nodes)
    // If a different node was right-clicked, close the previous popup and open a new one
    setRightClickedNode(node)
  }, [reactFlowInstance, setNodes])

  // Close popup when right-clicking on background or different node
  useEffect(() => {
    if (!rightClickedNode) return

    const handleContextMenuOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      // Check if right-click is on the popup
      const isOnPopup = target.closest('.node-popup')
      // Check if right-click is on the same node that has the popup
      const isOnSameNode = target.closest(`[data-id="${rightClickedNode.id}"]`)
      // Check if right-click is on any React Flow node (including different nodes)
      const isOnAnyNode = target.closest('.react-flow__node')
      
      // Close popup if:
      // 1. Right-clicking on background (not on popup or any node)
      // 2. Right-clicking on a different node (not the same node that has the popup)
      // Note: handleNodeContextMenu will then open a new popup for the different node
      if (!isOnPopup && (!isOnAnyNode || !isOnSameNode)) {
        setRightClickedNode(null)
        nodeClickPositionRef.current = null
        nodePopupZoomRef.current = null
      }
    }

    // Listen for contextmenu events on the document (capture phase to catch before React Flow)
    document.addEventListener('contextmenu', handleContextMenuOutside, true)
    
    return () => {
      document.removeEventListener('contextmenu', handleContextMenuOutside, true)
    }
  }, [rightClickedNode])

  // Handle delete node/panel - delete ALL selected panels
  const handleDeleteNode = useCallback(async () => {
    if (!rightClickedNode || !conversationId) return

    // Get all selected nodes (not just the right-clicked one)
    const selectedNodes = nodes.filter((n) => n.selected)
    if (selectedNodes.length === 0) return

    // Collect all message IDs to delete
    const messageIdsToDelete: string[] = []
    selectedNodes.forEach((node) => {
      messageIdsToDelete.push(node.data.promptMessage.id)
      if (node.data.responseMessage?.id) {
        messageIdsToDelete.push(node.data.responseMessage.id)
      }
    })

    // Delete from React Flow state immediately (optimistic update)
    const selectedNodeIds = new Set(selectedNodes.map((n) => n.id))
    setNodes((nds) => nds.filter((n) => !selectedNodeIds.has(n.id)))

    // Close popup
    setRightClickedNode(null)
    nodeClickPositionRef.current = null
    nodePopupZoomRef.current = null

    try {
      const supabase = createClient()

      const { error } = await supabase
        .from('messages')
        .delete()
        .in('id', messageIdsToDelete)

      if (error) {
        console.error('Error deleting messages from database:', error)
        // Re-add nodes to React Flow state if database deletion failed
        setNodes((nds) => [...nds, ...selectedNodes])
        setRightClickedNode(rightClickedNode) // Re-open popup
      } else {
        console.log('✅ Deleted messages from database')
        // Invalidate queries to refresh the UI
        queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
      }
    } catch (error) {
      console.error('Error deleting nodes:', error)
      // Re-add nodes to React Flow state if deletion failed
      setNodes((nds) => [...nds, ...selectedNodes])
      setRightClickedNode(rightClickedNode) // Re-open popup
    }
  }, [rightClickedNode, conversationId, nodes, setNodes, queryClient])

  // Handle condense node/panel (collapse response) - condense ALL selected panels
  const handleCondenseNode = useCallback(() => {
    if (!rightClickedNode) return

    // Get all selected nodes (not just the right-clicked one)
    const selectedNodes = nodes.filter((n) => n.selected)
    if (selectedNodes.length === 0) return

    // Determine if we should collapse or expand based on the right-clicked node's state
    // If the right-clicked node is collapsed, we'll expand all selected; otherwise collapse all
    const rightClickedNodeState = rightClickedNode.data.isResponseCollapsed || false
    const shouldCollapse = !rightClickedNodeState // Toggle: if expanded, collapse; if collapsed, expand

    // Update all selected nodes
    const selectedNodeIds = new Set(selectedNodes.map((n) => n.id))
    setNodes((nds) =>
      nds.map((n) =>
        selectedNodeIds.has(n.id)
          ? {
              ...n,
              data: {
                ...n.data,
                isResponseCollapsed: shouldCollapse,
              },
            }
          : n
      )
    )

    // Update rightClickedNode to reflect the change
    setRightClickedNode({
      ...rightClickedNode,
      data: {
        ...rightClickedNode.data,
        isResponseCollapsed: shouldCollapse,
      },
    })

    // Don't close popup - allow user to toggle again if needed
  }, [rightClickedNode, nodes, setNodes])

  // Update node popup position when node, nodes, or viewport changes
  // Position follows the click position on the node as viewport changes
  useEffect(() => {
    if (!rightClickedNode || !reactFlowInstance || !nodeClickPositionRef.current) return

    const updatePosition = () => {
      // Convert stored flow coordinates to screen coordinates using current viewport
      const viewport = reactFlowInstance.getViewport()
      const screenX = (nodeClickPositionRef.current!.x + viewport.x) * viewport.zoom
      const screenY = (nodeClickPositionRef.current!.y + viewport.y) * viewport.zoom

      setNodePopupPosition({ x: screenX, y: screenY })
    }

    // Initial position update
    updatePosition()

    // Update position continuously using requestAnimationFrame to catch viewport changes
    let animationFrameId: number
    const animate = () => {
      updatePosition()
      animationFrameId = requestAnimationFrame(animate)
    }
    animationFrameId = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animationFrameId)
    }
  }, [rightClickedNode, reactFlowInstance])

  // Close node popup on zoom (viewport change)
  useEffect(() => {
    if (!rightClickedNode || !reactFlowInstance) return

    const checkZoomChange = () => {
      const currentViewport = reactFlowInstance.getViewport()
      if (nodePopupZoomRef.current !== null && Math.abs(currentViewport.zoom - nodePopupZoomRef.current) > 0.01) {
        // Zoom changed - close popup
        setRightClickedNode(null)
        nodeClickPositionRef.current = null
        nodePopupZoomRef.current = null
      }
    }

    // Check for zoom changes periodically
    const intervalId = setInterval(checkZoomChange, 100)

    return () => {
      clearInterval(intervalId)
    }
  }, [rightClickedNode, reactFlowInstance])

  // Close node popup when clicking outside (left or right click)
  useEffect(() => {
    if (!rightClickedNode) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      // Check if click is on the popup
      const isOnPopup = target.closest('.node-popup')
      
      // Check if click is on any React Flow node
      const isOnAnyNode = target.closest('.react-flow__node')
      
      // Also check if click is on a button inside the popup (to allow delete/condense buttons to work)
      const isOnButton = target.closest('button') && target.closest('.node-popup')
      
      // Close popup if:
      // 1. Clicking on background (not on popup or any node)
      // 2. Clicking on any node (including the selected panel) - but not on the popup itself
      // Allow button clicks inside popup to work
      if (!isOnPopup && !isOnButton) {
        setRightClickedNode(null)
        nodeClickPositionRef.current = null
        nodePopupZoomRef.current = null
      }
    }

    // Handle right-click outside to close popup
    const handleContextMenuOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      // Check if right-click is on the popup
      const isOnPopup = target.closest('.node-popup')
      // Check if right-click is on the same node that has the popup
      const isOnSameNode = target.closest(`[data-id="${rightClickedNode.id}"]`)
      // Check if right-click is on any React Flow node (including different nodes)
      const isOnAnyNode = target.closest('.react-flow__node')
      
      // Close popup if:
      // 1. Right-clicking on background (not on popup or any node)
      // 2. Right-clicking on a different node (not the same node that has the popup)
      // Note: handleNodeContextMenu will then open a new popup for the different node
      if (!isOnPopup && (!isOnAnyNode || !isOnSameNode)) {
        setRightClickedNode(null)
        nodeClickPositionRef.current = null
        nodePopupZoomRef.current = null
      }
    }

    // Use capture phase to catch events before React Flow handles them
    // Use a small delay to allow button clicks to process first
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside, true)
      document.addEventListener('contextmenu', handleContextMenuOutside, true)
    }, 0)
    
    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('mousedown', handleClickOutside, true)
      document.removeEventListener('contextmenu', handleContextMenuOutside, true)
    }
  }, [rightClickedNode])

  // Handle edge click to show popup
  const handleEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.stopPropagation() // Prevent other click handlers
    
    // Toggle popup - if same edge is clicked, close it; otherwise open it
    if (clickedEdge?.id === edge.id) {
      setClickedEdge(null)
      edgeClickPositionRef.current = null
      edgePopupZoomRef.current = null
      return
    }
    
    // Get click position and convert to flow coordinates
    const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
    if (reactFlowInstance && reactFlowElement) {
      const rect = reactFlowElement.getBoundingClientRect()
      const screenX = event.clientX - rect.left
      const screenY = event.clientY - rect.top
      
      // Convert screen coordinates to flow coordinates
      const viewport = reactFlowInstance.getViewport()
      const flowX = screenX / viewport.zoom - viewport.x
      const flowY = screenY / viewport.zoom - viewport.y
      
      // Store click position in flow coordinates
      edgeClickPositionRef.current = { x: flowX, y: flowY }
      
      // Set initial screen position
      setEdgePopupPosition({ x: screenX, y: screenY })
      
      // Store zoom when popup opens
      edgePopupZoomRef.current = viewport.zoom
    }
    
    setClickedEdge(edge)
  }, [clickedEdge, reactFlowInstance])

  // Handle collapse/expand all panels connected to the edge
  const handleCollapseTarget = useCallback(() => {
    if (!clickedEdge) return
    
    // Find all nodes in the connected component (all nodes reachable from source and target)
    const connectedNodeIds = new Set<string>()
    const visited = new Set<string>()
    
    // Start with source and target nodes of the clicked edge
    const startNodes = [clickedEdge.source, clickedEdge.target]
    const queue = [...startNodes]
    
    // BFS to find all connected nodes
    while (queue.length > 0) {
      const currentNodeId = queue.shift()!
      if (visited.has(currentNodeId)) continue
      
      visited.add(currentNodeId)
      connectedNodeIds.add(currentNodeId)
      
      // Find all edges connected to this node
      edges.forEach(edge => {
        if (edge.source === currentNodeId && !visited.has(edge.target)) {
          queue.push(edge.target)
        }
        if (edge.target === currentNodeId && !visited.has(edge.source)) {
          queue.push(edge.source)
        }
      })
    }
    
    // Get all connected nodes
    const connectedNodes = nodes.filter(n => connectedNodeIds.has(n.id))
    if (connectedNodes.length === 0) return
    
    // Check collapse states
    const allCollapsed = connectedNodes.every(n => n.data.isResponseCollapsed || false)
    const allExpanded = connectedNodes.every(n => !(n.data.isResponseCollapsed || false))
    const someCollapsed = connectedNodes.some(n => n.data.isResponseCollapsed || false)
    
    // Determine action:
    // - If all are collapsed: expand all
    // - If all are expanded: collapse all
    // - If some are collapsed and some expanded: only expand the collapsed ones (don't collapse expanded ones)
    const shouldCollapse = allExpanded // Only collapse if all are expanded
    const shouldExpand = allCollapsed || someCollapsed // Expand if all are collapsed OR if some are collapsed
    
    // Update nodes: expand collapsed ones, or collapse all if all are expanded
    setNodes((nds) =>
      nds.map((n) => {
        if (connectedNodeIds.has(n.id)) {
          const isCurrentlyCollapsed = n.data.isResponseCollapsed || false
          
          if (shouldCollapse && allExpanded) {
            // All are expanded, so collapse all
            return {
              ...n,
              data: {
                ...n.data,
                isResponseCollapsed: true,
              },
            }
          } else if (shouldExpand && isCurrentlyCollapsed) {
            // Some are collapsed, so expand only the collapsed ones
            return {
              ...n,
              data: {
                ...n.data,
                isResponseCollapsed: false,
              },
            }
          }
          // Otherwise, keep current state
          return n
        }
        return n
      })
    )
    setClickedEdge(null) // Close popup
  }, [clickedEdge, nodes, edges, setNodes])

  // Handle delete edge - delete from both React Flow state and database
  const handleDeleteEdge = useCallback(async () => {
    console.log('🗑️ handleDeleteEdge called', { clickedEdge, conversationId, nodesLength: nodes?.length })
    
    if (!clickedEdge) {
      console.warn('Cannot delete edge: no clicked edge')
      return
    }
    
    if (!conversationId) {
      console.warn('Cannot delete edge: no conversation ID')
      return
    }
    
    console.log('🗑️ Deleting edge:', clickedEdge.id, 'from', clickedEdge.source, 'to', clickedEdge.target)
    
    // Store the edge to restore if deletion fails (store all needed data before setting clickedEdge to null)
    const edgeToDelete = clickedEdge
    const sourceNodeId = clickedEdge.source
    const targetNodeId = clickedEdge.target
    
    // Delete from React Flow state immediately (optimistic update)
    setEdges((eds) => {
      const filtered = eds.filter((e) => e.id !== clickedEdge.id)
      console.log(`🗑️ Removed edge from React Flow state. Had ${eds.length} edges, now have ${filtered.length}`)
      return filtered
    })
    setClickedEdge(null) // Close popup
    
    // Delete from database (lightweight - just message IDs)
    try {
      const supabase = createClient()
      
      // Find the source and target message IDs from the edge (use stored IDs since clickedEdge is now null)
      const sourceNode = nodes.find(n => n.id === sourceNodeId)
      const targetNode = nodes.find(n => n.id === targetNodeId)
      
      if (!sourceNode) {
        console.error('Cannot delete edge: source node not found', sourceNodeId, 'Available nodes:', nodes.map(n => n.id))
        // Re-add edge to React Flow state
        setEdges((eds) => [...eds, edgeToDelete])
        return
      }
      
      if (!targetNode) {
        console.error('Cannot delete edge: target node not found', targetNodeId, 'Available nodes:', nodes.map(n => n.id))
        // Re-add edge to React Flow state
        setEdges((eds) => [...eds, edgeToDelete])
        return
      }
      
      // Extract base message IDs
      const sourceMessageId = sourceNode.data.promptMessage.id
      const targetMessageId = targetNode.data.promptMessage.id
      
      console.log('🗑️ Deleting edge from database:', {
        conversationId,
        sourceMessageId,
        targetMessageId,
      })
      
      const { error, data } = await supabase
        .from('panel_edges')
        .delete()
        .eq('conversation_id', conversationId)
        .eq('source_message_id', sourceMessageId)
        .eq('target_message_id', targetMessageId)
        .select()
      
      if (error) {
        console.error('Error deleting edge from database:', error)
        // Re-add edge to React Flow state if database deletion failed
        setEdges((eds) => [...eds, edgeToDelete])
        setClickedEdge(edgeToDelete) // Re-open popup
      } else {
        console.log('✅ Deleted edge from database', data)
        // Refetch edges to update savedEdges and prevent edge loading useEffect from re-adding it
        refetchEdges()
      }
    } catch (error) {
      console.error('Error deleting edge:', error)
      // Re-add edge to React Flow state if deletion failed
      setEdges((eds) => [...eds, edgeToDelete])
      setClickedEdge(edgeToDelete) // Re-open popup
    }
  }, [clickedEdge, conversationId, nodes, setEdges, refetchEdges])

  // Handle toggle edge style (dotted/solid) for selected edge
  const handleToggleEdgeStyle = useCallback(() => {
    if (!clickedEdge) return
    
    const isCurrentlyDotted = clickedEdge.type === 'animatedDotted'
    const newType = isCurrentlyDotted ? 'smoothstep' : 'animatedDotted'
    
    setEdges((eds) =>
      eds.map((e) =>
        e.id === clickedEdge.id
          ? { ...e, type: newType }
          : e
      )
    )
    
    // Update clickedEdge to reflect the change
    setClickedEdge({ ...clickedEdge, type: newType })
  }, [clickedEdge, setEdges])

  // Update edge popup position when edge, nodes, or viewport changes
  // Position follows the click position on the edge as viewport changes
  useEffect(() => {
    if (!clickedEdge || !reactFlowInstance || !edgeClickPositionRef.current) return

    const updatePosition = () => {
      // Convert stored flow coordinates to screen coordinates using current viewport
      const viewport = reactFlowInstance.getViewport()
      const screenX = (edgeClickPositionRef.current!.x + viewport.x) * viewport.zoom
      const screenY = (edgeClickPositionRef.current!.y + viewport.y) * viewport.zoom

      setEdgePopupPosition({ x: screenX, y: screenY })
    }

    // Initial position update
    updatePosition()

    // Update position continuously using requestAnimationFrame to catch viewport changes
    let animationFrameId: number
    const animate = () => {
      updatePosition()
      animationFrameId = requestAnimationFrame(animate)
    }
    animationFrameId = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animationFrameId)
    }
  }, [clickedEdge, reactFlowInstance])

  // Close popup on zoom (viewport change)
  useEffect(() => {
    if (!clickedEdge || !reactFlowInstance) return

    const checkZoomChange = () => {
      const currentViewport = reactFlowInstance.getViewport()
      if (edgePopupZoomRef.current !== null && Math.abs(currentViewport.zoom - edgePopupZoomRef.current) > 0.01) {
        // Zoom changed - close popup
        setClickedEdge(null)
        edgeClickPositionRef.current = null
        edgePopupZoomRef.current = null
      }
    }

    // Check for zoom changes periodically
    const intervalId = setInterval(checkZoomChange, 100)

    return () => {
      clearInterval(intervalId)
    }
  }, [clickedEdge, reactFlowInstance])

  // Close popup when clicking outside
  useEffect(() => {
    if (!clickedEdge) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      // Check if click is on the popup or edge
      const isOnPopup = target.closest('.edge-popup')
      const isOnEdge = target.closest('.react-flow__edge')
      
      // Also check if click is on a button inside the popup (to allow delete/collapse buttons to work)
      const isOnButton = target.closest('button') && target.closest('.edge-popup')
      
      if (!isOnPopup && !isOnEdge && !isOnButton) {
        setClickedEdge(null)
      }
    }

    // Use a small delay to allow button clicks to process first
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)
    
    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [clickedEdge])

  return (
    <div className="w-full h-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesState}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionRadius={20}
        onConnect={async (params) => {
          if (!isLocked && params.source && params.target) {
            const newEdge: Edge = {
              id: `${params.source}-${params.target}`,
              source: params.source,
              target: params.target,
              sourceHandle: params.sourceHandle,
              targetHandle: params.targetHandle,
              type: lineStyle === 'dotted' ? 'animatedDotted' : 'smoothstep', // Use animated dotted edge if selected, otherwise smoothstep
            }
            
            // Add to React Flow state immediately (optimistic update)
            setEdges((eds) => [...eds, newEdge])
            
            // Save to database
            try {
              const supabase = createClient()
              const { data: { user } } = await supabase.auth.getUser()
              
              if (!user) {
                console.warn('Cannot save edge: user not authenticated')
                return
              }
              
              let currentConversationId = conversationId
              
              // If no conversation ID, create a new conversation first
              if (!currentConversationId) {
                // Set position to -1 to ensure it appears at the top of the sidebar list
                const { data: newConversation, error: convError } = await supabase
                  .from('conversations')
                  .insert({
                    user_id: user.id,
                    title: 'New Conversation',
                    metadata: { position: -1 }, // Set position to -1 to appear at top
                  })
                  .select()
                  .single()
                
                if (convError) {
                  console.error('Error creating conversation:', convError)
                  // Remove edge from React Flow state if conversation creation failed
                  setEdges((eds) => eds.filter(e => e.id !== newEdge.id))
                  return
                }
                
                currentConversationId = newConversation.id
                
                // Update URL to include conversation ID (like ChatGPT)
                router.replace(`/board/${currentConversationId}`)
                // Dispatch event to notify board page of new conversation
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('conversation-created', { detail: { conversationId: currentConversationId } }))
                }
              }
              
              // Find source and target nodes to get message IDs
              const sourceNode = nodes.find(n => n.id === params.source)
              const targetNode = nodes.find(n => n.id === params.target)
              
              if (sourceNode && targetNode) {
                const sourceMessageId = sourceNode.data.promptMessage.id
                const targetMessageId = targetNode.data.promptMessage.id
                
                const { error } = await supabase
                  .from('panel_edges')
                  .insert({
                    conversation_id: currentConversationId,
                    user_id: user.id,
                    source_message_id: sourceMessageId,
                    target_message_id: targetMessageId,
                  })
                
                if (error) {
                  console.error('Error saving edge to database:', error)
                  // Check if it's a duplicate edge error (unique constraint violation)
                  if (error.code === '23505') {
                    console.log('Edge already exists in database (duplicate), keeping in React Flow')
                    // Don't remove from React Flow - edge already exists
                  } else {
                    // Remove edge from React Flow state if database save failed
                    setEdges((eds) => eds.filter(e => e.id !== newEdge.id))
                  }
                } else {
                  console.log('✅ Saved edge to database')
                  // Refetch edges to ensure consistency
                  refetchEdges()
                }
              } else {
                console.warn('Cannot save edge: source or target node not found')
              }
            } catch (error) {
              console.error('Error saving edge:', error)
              // Remove edge from React Flow state if save failed
              setEdges((eds) => eds.filter(e => e.id !== newEdge.id))
            }
          }
        }}
        onEdgeClick={handleEdgeClick}
        onNodeContextMenu={handleNodeContextMenu}
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
        multiSelectionKeyCode={['Shift']} // Enable multi-select with Shift key
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
        {!isMinimapHidden && (
          <div
            data-minimap-context
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setMinimapContextMenuPosition({ x: e.clientX, y: e.clientY })
            }}
            onMouseEnter={() => {
              // Keep minimap visible when hovering over it in hover mode
              setIsMinimapHovering(true)
              isMinimapHoveringRef.current = true
              // Cancel any pending hide timeout
              if (minimapHideTimeoutRef.current) {
                clearTimeout(minimapHideTimeoutRef.current)
                minimapHideTimeoutRef.current = null
              }
            }}
            onMouseLeave={(e) => {
              // Check if minimap should hide after leaving minimap
              setIsMinimapHovering(false)
              isMinimapHoveringRef.current = false
              checkAndHideMinimap(e.relatedTarget as HTMLElement)
            }}
          >
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
              className="minimap-custom-size shadow-sm"
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
          </div>
        )}
        
        {/* Hover zone for minimap collapse pill - limited to minimap width (179px) */}
        {/* Show hover zone even when minimap is hidden, so pill can be shown on hover */}
        {!isMinimapHidden && (
          <div
            className="absolute pointer-events-auto"
            style={{
              bottom: minimapBottom === 79 ? `${minimapHoverBottom}px` : '0px', // Between minimap and prompt box when jumped, otherwise at bottom
              left: `${minimapHoverLeft}px`, // Align with minimap left edge
              width: '179px', // Minimap width
              height: minimapBottom === 79 ? `${minimapHoverHeight}px` : '28px', // Space between minimap and prompt box when jumped, otherwise default height
              zIndex: 9, // Below pill but above other elements
            }}
            onMouseEnter={() => {
              // Track pill hover area specifically
              setIsPillHoverAreaHovering(true)
              setIsMinimapHovering(true)
              isMinimapHoveringRef.current = true
              // Cancel any pending hide timeout
              if (minimapHideTimeoutRef.current) {
                clearTimeout(minimapHideTimeoutRef.current)
                minimapHideTimeoutRef.current = null
              }
            }}
            onMouseLeave={(e) => {
              setIsPillHoverAreaHovering(false)
              setIsMinimapHovering(false)
              isMinimapHoveringRef.current = false
              // Check if minimap should hide after leaving hover area
              checkAndHideMinimap(e.relatedTarget as HTMLElement)
            }}
          />
        )}
        {/* Hover zone when minimap is hidden - same area as when minimap is shown */}
        {isMinimapHidden && (
          <div
            className="absolute pointer-events-auto"
            style={{
              bottom: '0px', // Extended lower for easier hovering
              left: `${minimapHoverLeft}px`, // Align with minimap/toggle left edge
              width: '179px', // Minimap/toggle width
              height: `${minimapPillBottom + 20}px`, // Height extends from bottom to above pill
              zIndex: 9, // Below pill but above other elements
            }}
            onMouseEnter={() => {
              // Track pill hover area specifically
              setIsPillHoverAreaHovering(true)
              setIsMinimapHovering(true)
              isMinimapHoveringRef.current = true
              // Cancel any pending hide timeout
              if (minimapHideTimeoutRef.current) {
                clearTimeout(minimapHideTimeoutRef.current)
                minimapHideTimeoutRef.current = null
              }
            }}
            onMouseLeave={(e) => {
              setIsPillHoverAreaHovering(false)
              setIsMinimapHovering(false)
              isMinimapHoveringRef.current = false
              // Check if minimap should hide after leaving hover area
              checkAndHideMinimap(e.relatedTarget as HTMLElement)
            }}
          />
        )}
        
      </ReactFlow>
      
      {/* Minimap toggle pill - horizontal below minimap, like top bar and prompt box */}
      {/* Moved outside ReactFlow to ensure proper z-index stacking above toggle */}
      <div
        data-minimap-pill-context
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setMinimapContextMenuPosition({ x: e.clientX, y: e.clientY })
        }}
        onClick={() => {
          // Toggle between 'shown' and 'hover' modes
          if (minimapMode === 'shown') {
            setMinimapMode('hover')
          } else if (minimapMode === 'hover') {
            setMinimapMode('shown')
          } else {
            // If mode is 'hidden', switch to 'shown' and immediately show minimap
            setMinimapMode('shown')
            setIsMinimapHidden(false)
            setIsMinimapManuallyHidden(false)
            wasAutoHiddenRef.current = false
          }
        }}
            onMouseEnter={() => {
              // Track pill hover area specifically
              setIsPillHoverAreaHovering(true)
              setIsMinimapHovering(true)
              isMinimapHoveringRef.current = true
              // Cancel any pending hide timeout
              if (minimapHideTimeoutRef.current) {
                clearTimeout(minimapHideTimeoutRef.current)
                minimapHideTimeoutRef.current = null
              }
              // Only pill hover shows the minimap in hover mode
              if (isMinimapHidden && minimapMode === 'hover') {
                setTimeout(() => {
                  if (isMinimapHidden && minimapMode === 'hover') {
                    setIsMinimapHidden(false)
                    setIsMinimapManuallyHidden(false)
                    wasAutoHiddenRef.current = false
                  }
                }, 100) // 100ms delay - quick response
              }
            }}
            onMouseLeave={(e) => {
              setIsPillHoverAreaHovering(false)
              setIsMinimapHovering(false)
              isMinimapHoveringRef.current = false
              // Check if minimap should hide after leaving pill
              checkAndHideMinimap(e.relatedTarget as HTMLElement)
            }}
        className={cn(
          'absolute w-12 h-1.5 rounded-full cursor-pointer transition-all duration-200 bg-gray-300',
          // Show pill only when hovering over pill hover area (not minimap or toggle)
          isPillHoverAreaHovering ? 'opacity-100' : 'opacity-0'
        )}
        style={{
          // Center pill vertically on minimap bottom edge (dynamically calculated)
          bottom: `${minimapPillBottom}px`,
          // Center pill horizontally on minimap
          left: `${minimapPillCenter}px`,
          transform: 'translateX(-50%)', // Center the pill on the calculated center position
          zIndex: 50, // Higher than toggle's z-10 to ensure pill appears above
        }}
        title={isMinimapHidden ? 'Show minimap' : 'Hide minimap'}
      />
      
        {/* Node popup - shows delete and condense options */}
        {rightClickedNode && reactFlowInstance && (
          <div
            className="node-popup absolute z-[1000] bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-2"
            style={{
              left: `${nodePopupPosition.x}px`,
              top: `${nodePopupPosition.y}px`,
              transform: `translate(-50%, -100%) scale(${reactFlowInstance.getViewport().zoom})`, // Scale with zoom, center above node
              transformOrigin: 'center bottom', // Scale from bottom center
              marginTop: '-8px', // Small gap above node
            }}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
            }}
            onMouseDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
            }}
          >
            <div className="flex flex-col gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.preventDefault() // Prevent default behavior
                  e.stopPropagation() // Prevent event bubbling
                  handleCondenseNode()
                }}
                className="justify-start text-sm"
              >
                {(() => {
                  // Check the state of the right-clicked node to determine button label
                  const isCollapsed = rightClickedNode.data.isResponseCollapsed || false
                  return isCollapsed ? (
                    <>
                      <ChevronDown className="h-4 w-4 mr-2" />
                      Condense ✨
                    </>
                  ) : (
                    <>
                      <ChevronUp className="h-4 w-4 mr-2" />
                      Condense ✨
                    </>
                  )
                })()}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.preventDefault() // Prevent default behavior
                  e.stopPropagation() // Prevent event bubbling
                  console.log('🗑️ Delete button clicked, calling handleDeleteNode')
                  handleDeleteNode()
                }}
                className="justify-start text-sm text-red-600 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </div>
          </div>
        )}

        {/* Edge popup - shows collapse and delete options */}
        {clickedEdge && reactFlowInstance && (
          <div
            className="edge-popup absolute z-[1000] bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-2"
            style={{
              left: `${edgePopupPosition.x}px`,
              top: `${edgePopupPosition.y}px`,
              transform: `translate(-50%, -100%) scale(${reactFlowInstance.getViewport().zoom})`, // Scale with zoom, center above edge
              transformOrigin: 'center bottom', // Scale from bottom center
              marginTop: '-8px', // Small gap above edge
            }}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
            }}
            onMouseDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
            }}
          >
            <div className="flex flex-col gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCollapseTarget}
                className="justify-start text-sm"
              >
                {(() => {
                  // Find all connected nodes to determine button label
                  const connectedNodeIds = new Set<string>()
                  const visited = new Set<string>()
                  const startNodes = [clickedEdge.source, clickedEdge.target]
                  const queue = [...startNodes]
                  
                  while (queue.length > 0) {
                    const currentNodeId = queue.shift()!
                    if (visited.has(currentNodeId)) continue
                    visited.add(currentNodeId)
                    connectedNodeIds.add(currentNodeId)
                    
                    edges.forEach(edge => {
                      if (edge.source === currentNodeId && !visited.has(edge.target)) {
                        queue.push(edge.target)
                      }
                      if (edge.target === currentNodeId && !visited.has(edge.source)) {
                        queue.push(edge.source)
                      }
                    })
                  }
                  
                  const connectedNodes = nodes.filter(n => connectedNodeIds.has(n.id))
                  const allExpanded = connectedNodes.length > 0 && connectedNodes.every(n => !(n.data.isResponseCollapsed || false))
                  const someCollapsed = connectedNodes.some(n => n.data.isResponseCollapsed || false)
                  
                  // Show "Collapse" only if all are expanded, otherwise show "Expand"
                  if (allExpanded) {
                    return (
                      <>
                        <ChevronUp className="h-4 w-4 mr-2" />
                        Collapse
                      </>
                    )
                  } else {
                    return (
                      <>
                        <ChevronDown className="h-4 w-4 mr-2" />
                        Expand
                      </>
                    )
                  }
                })()}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.preventDefault() // Prevent default behavior
                  e.stopPropagation() // Prevent event bubbling
                  handleToggleEdgeStyle()
                }}
                className="justify-start text-sm"
                title={clickedEdge.type === 'animatedDotted' ? 'Make solid' : 'Make dotted'}
              >
                {clickedEdge.type === 'animatedDotted' ? (
                  <div className="w-[2px] h-4 bg-gray-600 mr-2" />
                ) : (
                  <div className="flex flex-col gap-0.5 h-4 items-center mr-2">
                    <div className="w-0.5 h-1 bg-gray-600" />
                    <div className="w-0.5 h-1 bg-gray-600" />
                    <div className="w-0.5 h-1 bg-gray-600" />
                  </div>
                )}
                {clickedEdge.type === 'animatedDotted' ? 'Solid' : 'Dotted'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.preventDefault() // Prevent default behavior
                  e.stopPropagation() // Prevent event bubbling
                  console.log('🗑️ Delete button clicked, calling handleDeleteEdge')
                  handleDeleteEdge()
                }}
                className="justify-start text-sm text-red-600 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </div>
          </div>
        )}
      
      {/* Linear/Canvas toggle with Nav dropdown above minimap */}
        <div 
          data-minimap-toggle-context
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setMinimapContextMenuPosition({ x: e.clientX, y: e.clientY })
          }}
          onMouseEnter={() => {
            // Only track hover, don't show minimap (only pill hover shows it)
            setIsMinimapHovering(true)
            isMinimapHoveringRef.current = true
            // Cancel any pending hide timeout
            if (minimapHideTimeoutRef.current) {
              clearTimeout(minimapHideTimeoutRef.current)
              minimapHideTimeoutRef.current = null
            }
          }}
          onMouseLeave={(e) => {
            // Check if minimap should hide after leaving toggle
            setIsMinimapHovering(false)
            isMinimapHoveringRef.current = false
            checkAndHideMinimap(e.relatedTarget as HTMLElement)
          }}
          className="absolute z-10"
          style={{
            // Position toggle above minimap
            // Both positions use minimapBottom which already accounts for the jump when prompt box gets close
            bottom: isMinimapHidden 
              ? `${minimapBottom - 12 + 15}px` // At minimap position when hidden + small offset (3px higher when collapsed)
              : `${minimapBottom - 12 + 134 + 8}px`, // Above minimap (134px height + 8px gap)
            // Right-align with minimap (which aligns with prompt box when jumped), moved left 16px
            right: `${minimapRight + 16}px`, // Match minimap right position + 16px left offset (moved 1px left)
          }}
        >
        <div 
          className={cn(
            "bg-blue-50 dark:bg-[#2a2a3a] rounded-lg p-1 flex items-center gap-1 relative",
            isMinimapHidden && "shadow-sm"
          )}
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

      {/* Context menu for minimap control */}
      {minimapContextMenuPosition && (
        <div
          className="fixed z-50 bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] py-1 min-w-[180px]"
          style={{
            left: `${minimapContextMenuPosition.x}px`,
            top: `${minimapContextMenuPosition.y}px`,
            transform: 'translate(-100%, -100%)', // Position top-left of cursor
            marginTop: '-4px', // Small gap from cursor
            marginLeft: '-4px', // Small gap from cursor
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-[#2f2f2f]">
            Minimap control
          </div>
          <div className="py-1">
            <button
              onClick={() => {
                setMinimapMode('shown')
                setMinimapContextMenuPosition(null)
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2a2a3a] flex items-center gap-2"
            >
              {minimapMode === 'shown' && (
                <span className="w-1.5 h-1.5 rounded-full bg-gray-700 dark:bg-gray-300" />
              )}
              {minimapMode !== 'shown' && <span className="w-1.5 h-1.5" />}
              <span>Shown</span>
            </button>
            <button
              onClick={() => {
                setMinimapMode('hidden')
                // Immediately hide the minimap (mode sync will handle this, but ensure it's hidden)
                setIsMinimapHidden(true)
                setIsMinimapManuallyHidden(true)
                wasAutoHiddenRef.current = false
                setMinimapContextMenuPosition(null)
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2a2a3a] flex items-center gap-2"
            >
              {minimapMode === 'hidden' && (
                <span className="w-1.5 h-1.5 rounded-full bg-gray-700 dark:bg-gray-300" />
              )}
              {minimapMode !== 'hidden' && <span className="w-1.5 h-1.5" />}
              <span>Hidden</span>
            </button>
            <button
              onClick={() => {
                setMinimapMode('hover')
                setMinimapContextMenuPosition(null)
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2a2a3a] flex items-center gap-2"
            >
              {minimapMode === 'hover' && (
                <span className="w-1.5 h-1.5 rounded-full bg-gray-700 dark:bg-gray-300" />
              )}
              {minimapMode !== 'hover' && <span className="w-1.5 h-1.5" />}
              <span>Show on hover</span>
            </button>
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


