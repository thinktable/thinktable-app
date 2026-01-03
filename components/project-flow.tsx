'use client'

// React Flow project component - displays board panels in a project map
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

interface Board {
  id: string
  title: string
  created_at: string
  updated_at: string
}

interface ProjectBoardPanelNodeData {
  boardId: string
  boardTitle: string  // Used as "prompt"
  recentUserMessage?: Message  // Most recent user message as "response"
  projectId: string
  isResponseCollapsed?: boolean
}

// Fetch boards in a project
async function fetchProjectBoards(projectId: string): Promise<Board[]> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('conversations')
    .select('id, title, created_at, updated_at, metadata')
    .eq('user_id', user.id)
    .contains('metadata', { project_id: projectId })

  if (error) {
    console.error('Error fetching project boards:', error)
    return []
  }

  // Map data and extract position from metadata
  const boards = (data || []).map((conv: any) => ({
    id: conv.id,
    title: conv.title,
    created_at: conv.created_at,
    updated_at: conv.updated_at,
    position: conv.metadata?.position ?? undefined,
  })) as Board[]

  // Sort by position if available (ascending, so -1 comes first), otherwise by created_at (descending, newest first)
  return boards.sort((a: any, b: any) => {
    if (a.position !== undefined && b.position !== undefined) {
      return a.position - b.position
    }
    if (a.position !== undefined) return -1 // Items with position come first
    if (b.position !== undefined) return 1
    // If no position, sort by created_at descending (newest first)
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

// Fetch most recent user message from a board
async function fetchRecentUserMessage(boardId: string): Promise<Message | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', boardId)
    .eq('role', 'user')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle() // Use maybeSingle() instead of single() to handle no results gracefully

  if (error || !data) {
    return null
  }
  return data as Message
}

// Custom animated dotted edge component - same as BoardFlow
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
      style={style}
      markerEnd={undefined}
    />
  )
}

// Define nodeTypes outside component as a module-level constant
// Use same node type as BoardFlow - ChatPanelNode handles both data types
// Using Object.freeze to ensure immutability and prevent React Flow warnings
const nodeTypes = Object.freeze({
  chatPanel: ChatPanelNode, // ChatPanelNode handles both ChatPanelNodeData and ProjectBoardPanelNodeData
  projectBoardPanel: ChatPanelNode, // Alias for consistency
})

function ProjectFlowInner({ projectId }: { projectId?: string }) {
  const { resolvedTheme } = useTheme()
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  
  // Track selected node IDs for restoring selection after pane click (when zoom !== 100%)
  const selectedNodeIdsRef = useRef<string[]>([])
  const [edges, setEdges, onEdgesState] = useEdgesState([])
  const prevBoardsKeyRef = useRef<string>('')
  const prevCollapseStatesRef = useRef<Map<string, boolean>>(new Map())
  const isCreatingNodesRef = useRef(false) // Prevent concurrent node creation
  const boardsDataRef = useRef<Board[]>([]) // Store boards data in ref
  const recentMessagesDataRef = useRef<Record<string, Message | null>>({}) // Store messages data in ref

  // Initialize with consistent defaults
  const [isScrollMode, setIsScrollMode] = useState(false)
  const [viewMode, setViewMode] = useState<'linear' | 'canvas'>('canvas')
  const [isMinimapHidden, setIsMinimapHidden] = useState(false)
  const [isMinimapManuallyHidden, setIsMinimapManuallyHidden] = useState(false)
  const [minimapBottom, setMinimapBottom] = useState<number>(17) // Default position 2px higher
  const [minimapRight, setMinimapRight] = useState<number>(15) // Dynamic right position to align with prompt box when jumped (default: 15px)
  const [isMinimapHovering, setIsMinimapHovering] = useState(false) // Track if mouse is hovering over minimap area
  const [isBottomGapHovering, setIsBottomGapHovering] = useState(false) // Track if hovering over bottom gap (shared with prompt pill)
  const wasAutoHiddenRef = useRef(false) // Track if minimap was auto-hidden (vs manually hidden while shrunken)

  // Load preferences from localStorage first, then Supabase
  const preferencesLoadedRef = useRef(false)
  useEffect(() => {
    if (typeof window === 'undefined') return

    const savedViewMode = localStorage.getItem('thinktable-view-mode') as 'linear' | 'canvas' | null
    if (savedViewMode && ['linear', 'canvas'].includes(savedViewMode)) {
      setViewMode(savedViewMode)
    }

    const savedScrollMode = localStorage.getItem('thinktable-scroll-mode')
    if (savedScrollMode === 'true') {
      setIsScrollMode(true)
    } else if (savedScrollMode === 'false') {
      setIsScrollMode(false)
    }

    preferencesLoadedRef.current = true

    // Load from Supabase (async)
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
            }

            if (prefs.viewMode && ['linear', 'canvas'].includes(prefs.viewMode)) {
              setViewMode(prefs.viewMode)
            }

            if (typeof prefs.isScrollMode === 'boolean') {
              setIsScrollMode(prefs.isScrollMode)
            }
          }
        }
      } catch (error) {
        console.error('Error loading preferences from Supabase:', error)
      }
    }

    loadPreferences()
  }, [])

  const reactFlowInstance = useReactFlow()
  const { setReactFlowInstance, registerSetNodes, isLocked, layoutMode, setLayoutMode, setIsDeterministicMapping, panelWidth: contextPanelWidth, isPromptBoxCentered, lineStyle, setLineStyle, arrowDirection, setArrowDirection } = useReactFlowContext()
  const { setIsMobileMode } = useSidebarContext()
  const originalPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const isLinearModeRef = useRef(false)
  const isSwitchingToLinearRef = useRef(false) // Track when switching to Linear mode
  const nodeHeightsRef = useRef<Map<string, number>>(new Map())
  const savedZoomRef = useRef<{ linear: number | null; canvas: number | null }>({ linear: null, canvas: null })
  const prevViewModeForLinearRef = useRef(viewMode) // Track previous viewMode for mode switching
  const router = useRouter()
  const queryClient = useQueryClient()
  const supabase = createClient()

  // Register setNodes function with context
  useEffect(() => {
    if (registerSetNodes) {
      registerSetNodes(setNodes)
    }
  }, [registerSetNodes, setNodes])

  // Track selected node IDs for restoring selection after pane click (when zoom !== 100%)
  useEffect(() => {
    const selectedIds = nodes.filter(n => n.selected).map(n => n.id)
    if (selectedIds.length > 0) {
      selectedNodeIdsRef.current = selectedIds
    }
  }, [nodes])

  // Store reactFlowInstance in context
  useEffect(() => {
    if (setReactFlowInstance && reactFlowInstance) {
      setReactFlowInstance(reactFlowInstance)
    }
  }, [setReactFlowInstance, reactFlowInstance])

  // Fetch boards in project
  const { data: boardsData = [], refetch: refetchBoards } = useQuery({
    queryKey: ['project-boards', projectId],
    queryFn: () => projectId ? fetchProjectBoards(projectId) : Promise.resolve([]),
    enabled: !!projectId,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchOnReconnect: true,
  })

  // Create stable boards key for comparison
  const boardsKey = useMemo(() => {
    if (!boardsData || boardsData.length === 0) return ''
    return boardsData.map(b => `${b.id}:${b.title}`).sort().join('|')
  }, [boardsData])

  // Memoize boards array itself to prevent reference changes
  const boards = useMemo(() => {
    if (!boardsData || boardsData.length === 0) return []
    return [...boardsData] // Create new array to ensure stability
  }, [boardsKey]) // Use boardsKey instead of boardsData to prevent unnecessary recalculations

  // Fetch recent user message for each board
  const boardIds = useMemo(() => boards.map(b => b.id), [boards])
  const { data: recentMessagesData = {} } = useQuery({
    queryKey: ['board-recent-messages', boardIds],
    queryFn: async () => {
      if (!projectId || boardIds.length === 0) return {}

      const messages: Record<string, Message | null> = {}
      await Promise.all(
        boardIds.map(async (boardId) => {
          const message = await fetchRecentUserMessage(boardId)
          messages[boardId] = message
        })
      )
      return messages
    },
    enabled: !!projectId && boardIds.length > 0,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  })

  // Create a stable key from recent messages to detect actual changes
  const recentMessagesKey = useMemo(() => {
    if (!recentMessagesData || Object.keys(recentMessagesData).length === 0) return ''
    return Object.entries(recentMessagesData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([boardId, msg]) => {
        if (!msg) return `${boardId}:none`
        return `${boardId}:${msg.id}:${msg.content?.substring(0, 50) || ''}`
      })
      .join('|')
  }, [recentMessagesData])

  // Update refs when data changes (after recentMessagesKey is defined)
  useEffect(() => {
    boardsDataRef.current = boardsData || []
  }, [boardsKey])

  useEffect(() => {
    recentMessagesDataRef.current = recentMessagesData || {}
  }, [recentMessagesKey])

  // Set up Realtime subscriptions for boards and messages
  useEffect(() => {
    if (!projectId) return

    let cleanup: (() => void) | null = null

    const setupSubscriptions = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Subscribe to conversations (boards) - filter by user_id, then check project_id in callback
      const boardsChannel = supabase
        .channel(`project-boards-updates-${projectId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'conversations',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            // Filter in callback - check if this conversation belongs to our project
            const conversation = payload.new as any
            const oldConversation = payload.old as any
            const belongsToProject = conversation?.metadata?.project_id === projectId
            const belongedToProject = oldConversation?.metadata?.project_id === projectId

            if (belongsToProject || belongedToProject) {
              console.log('🔄 ProjectFlow: Board update via Realtime:', payload)
              queryClient.invalidateQueries({ queryKey: ['project-boards', projectId] })
              refetchBoards()
            }
          }
        )
        .subscribe()

      // Subscribe to messages in project boards - subscribe per board for efficiency
      const messageChannels: any[] = []

      if (boardIds.length > 0) {
        boardIds.forEach((boardId) => {
          const messageChannel = supabase
            .channel(`project-messages-${boardId}`)
            .on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: 'messages',
                filter: `conversation_id=eq.${boardId}`,
              },
              (payload) => {
                console.log('🔄 ProjectFlow: Message update via Realtime:', payload)
                // Only invalidate if it's a user message (we only show user messages)
                if (payload.new && (payload.new as any).role === 'user') {
                  queryClient.invalidateQueries({ queryKey: ['board-recent-messages', boardIds] })
                }
              }
            )
            .subscribe()
          messageChannels.push(messageChannel)
        })

        cleanup = () => {
          supabase.removeChannel(boardsChannel)
          messageChannels.forEach(ch => supabase.removeChannel(ch))
        }
      } else {
        cleanup = () => {
          supabase.removeChannel(boardsChannel)
        }
      }
    }

    setupSubscriptions()

    return () => {
      if (cleanup) cleanup()
    }
  }, [projectId, boardIds, queryClient, refetchBoards, supabase])

  // Handle responsive minimap positioning - move up when prompt box gets close
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
        // Calculate minimap bottom position based on prompt box height to maintain 16px gap
        // Prompt box top edge in screen coordinates: promptBoxRect.top
        // React Flow bottom in screen coordinates: reactFlowRect.bottom
        // We want minimap bottom edge to be 16px above prompt box top
        // CSS bottom value = distance from React Flow bottom to minimap bottom edge
        // Minimap bottom edge should be at: promptBoxRect.top - gapAbovePrompt (in screen coordinates)
        // So: CSS bottom = reactFlowRect.bottom - (promptBoxRect.top - gapAbovePrompt)
        // Note: The minimap style uses minimapBottom - 12, so minimapBottom = CSS bottom + 12
        const gapAbovePrompt = 0 // Gap between minimap bottom and prompt box top
        const cssBottom = reactFlowRect.bottom - promptBoxRect.top + gapAbovePrompt
        const calculatedBottom = cssBottom + 12 // Add 12 because style subtracts it
        // Ensure minimum bottom position (don't go below default of 17, which gives CSS bottom of 5px)
        // Also ensure it's not too high (max reasonable value would be around 200px to keep minimap visible)
        const minimapHeight = 134 // Minimap height for bounds checking
        const maxReasonableBottom = reactFlowRect.height - minimapHeight + 12 // Keep minimap within viewport
        setMinimapBottom(Math.max(17, Math.min(calculatedBottom, maxReasonableBottom)))
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

    // Also check periodically to catch prompt box position changes
    const interval = setInterval(checkMinimapPosition, 100)

    return () => {
      window.removeEventListener('resize', checkMinimapPosition)
      clearInterval(interval)
    }
  }, [])

  // Create nodes from boards
  // Use functional update to access current nodes without including in dependency array
  useEffect(() => {
    // Prevent concurrent execution
    if (isCreatingNodesRef.current) {
      return
    }

    // Use boardsKey to check if we have boards (empty string means no boards)
    if (!projectId || boardsKey === '') {
      setNodes([])
      setEdges([])
      prevBoardsKeyRef.current = ''
      return
    }

    // Create a stable key from boards key and recent messages key to detect changes
    const combinedKey = `${boardsKey}:${recentMessagesKey}`

    // Early return if nothing changed
    if (combinedKey === prevBoardsKeyRef.current) {
      return // No changes
    }

    // Update the ref immediately to prevent duplicate runs
    prevBoardsKeyRef.current = combinedKey
    isCreatingNodesRef.current = true

    // Capture values from refs to avoid dependency on changing references
    const currentRecentMessages = recentMessagesDataRef.current
    const currentBoards = boardsDataRef.current
    const currentViewMode = viewMode
    const currentArrowDirection = arrowDirection
    const currentContextPanelWidth = contextPanelWidth
    const currentIsLocked = isLocked

    // Use functional update to access current nodes without including in dependency array
    setNodes((currentNodes) => {
      const newNodes: Node<ProjectBoardPanelNodeData>[] = []
      const gapBetweenPanels = 50 // Same spacing as board-flow (50px gap between panels)

      // Calculate centered x position
      const reactFlowElement = document.querySelector('.react-flow')
      const viewportWidth = reactFlowElement ? reactFlowElement.clientWidth : 1200
      const panelWidth = contextPanelWidth || 500
      let centeredX = (viewportWidth / 2) - (panelWidth / 2)

      // If we have existing nodes, try to preserve their X positions
      if (currentNodes && Array.isArray(currentNodes) && currentNodes.length > 0) {
        const existingXPositions = currentNodes.map(n => n.position.x)
        if (existingXPositions.length > 0) {
          const avgX = existingXPositions.reduce((sum, x) => sum + x, 0) / existingXPositions.length
          if (Math.abs(avgX - centeredX) < 200) {
            centeredX = avgX
          }
        }
      }

      const startY = 0
      let panelIndex = 0

      // Process boards in order (oldest first, so newest appear at bottom)
      currentBoards.forEach((board) => {
        const recentMessage = currentRecentMessages[board.id] || null

        // Create panel node where:
        // - Prompt = board title
        // - Response = most recent user message (if exists)
        const nodeId = `board-panel-${board.id}`

        let storedPos = originalPositionsRef.current.get(nodeId)
        if (!storedPos && currentViewMode === 'canvas' && typeof window !== 'undefined') {
          try {
            const saved = localStorage.getItem(`thinktable-canvas-positions-project-${projectId}`)
            if (saved) {
              const positions = JSON.parse(saved) as Record<string, { x: number; y: number }>
              const savedPos = positions[nodeId]
              if (savedPos) {
                storedPos = savedPos
                originalPositionsRef.current.set(nodeId, savedPos)
              }
            }
          } catch (error) {
            console.error('Failed to load position from localStorage:', error)
          }
        }

        let currentPos: { x: number; y: number }

        if (currentViewMode === 'canvas' && storedPos?.x !== undefined && storedPos?.y !== undefined) {
          currentPos = { x: storedPos.x, y: storedPos.y }
        } else {
          // Use currentNodes from functional update
          let referenceNode: Node<ProjectBoardPanelNodeData> | null = null

          if (currentNodes && Array.isArray(currentNodes) && currentNodes.length > 0) {
            const selectedNode = currentNodes.find(n => n.selected)
            if (selectedNode) {
              referenceNode = selectedNode
            } else {
              referenceNode = currentNodes.reduce((newest, node) => {
                const newestCreated = new Date(newest.data.boardTitle || 0).getTime()
                const nodeCreated = new Date(node.data.boardTitle || 0).getTime()
                return nodeCreated > newestCreated ? node : newest
              }, currentNodes[0])
            }
          }

          if (referenceNode) {
            const referenceHeight = nodeHeightsRef.current.get(referenceNode.id) || 400
            const baseX = referenceNode.position.x
            const baseY = referenceNode.position.y

            const directionToUse = currentViewMode === 'canvas' ? currentArrowDirection : 'down'

            switch (directionToUse) {
              case 'down':
                currentPos = { x: baseX, y: baseY + referenceHeight + gapBetweenPanels }
                break
              case 'up':
                const estimatedNewHeight = 400
                currentPos = { x: baseX, y: baseY - estimatedNewHeight - gapBetweenPanels }
                break
              case 'right':
                const panelWidthForSpacing = currentContextPanelWidth || 768
                currentPos = { x: baseX + panelWidthForSpacing + gapBetweenPanels, y: baseY }
                break
              case 'left':
                const panelWidthForSpacingLeft = currentContextPanelWidth || 768
                currentPos = { x: baseX - panelWidthForSpacingLeft - gapBetweenPanels, y: baseY }
                break
              default:
                currentPos = { x: baseX, y: baseY + referenceHeight + gapBetweenPanels }
            }
          } else {
            let cumulativeY = startY
            for (let i = 0; i < panelIndex; i++) {
              const estimatedHeight = 400
              cumulativeY += estimatedHeight + gapBetweenPanels
            }
            currentPos = {
              x: centeredX,
              y: cumulativeY
            }
          }
        }

        // Create panel node - ChatPanelNode handles ProjectBoardPanelNodeData
        const panelNode: Node<ProjectBoardPanelNodeData> = {
          id: nodeId,
          type: 'chatPanel', // Use same type as BoardFlow - ChatPanelNode handles both
          position: currentPos,
          data: {
            boardId: board.id,
            boardTitle: board.title,
            recentUserMessage: recentMessage || undefined,
            projectId: projectId,
            isResponseCollapsed: false,
          },
          draggable: currentIsLocked ? false : (currentViewMode === 'canvas'),
        }

        originalPositionsRef.current.set(nodeId, currentPos)
        newNodes.push(panelNode)
        panelIndex++
      })

      return newNodes
    })

    // Create edges between panels (optional - can be added later)
    setEdges([])

    // Reset flag after a short delay to allow state to settle
    setTimeout(() => {
      isCreatingNodesRef.current = false
    }, 0)

  }, [boardsKey, recentMessagesKey, projectId, viewMode, arrowDirection, contextPanelWidth, isLocked])

  // Center viewport in linear mode when nodes are first created or updated (same as board-flow)
  useEffect(() => {
    if (viewMode !== 'linear' || !nodes || !Array.isArray(nodes) || nodes.length === 0 || !reactFlowInstance) return

    // Use double requestAnimationFrame to ensure nodes are fully rendered (same as board-flow)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const reactFlowElement = document.querySelector('.react-flow')
        if (!reactFlowElement) return

        const mapAreaWidth = reactFlowElement.clientWidth
        const viewportHeight = reactFlowElement.clientHeight
        const screenCenterY = viewportHeight / 2

        // Get actual current nodes
        const currentNodes = reactFlowInstance.getNodes()
        if (currentNodes.length === 0) return

        const linearZoom = savedZoomRef.current.linear ?? 1.0
        const panelWidth = contextPanelWidth || 768

        // Calculate left gap same as prompt box (same logic as board-flow)
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
        const calculatedLeftGap = Math.max(0, (1 / 2) * (gapFromSidebarToMinimap - panelWidth))
        const rightGapWhenLeftAligned = mapAreaWidth - calculatedLeftGap - panelWidth

        const currentPanelX = currentNodes[0]?.position.x || 0
        let targetViewportX: number

        // If right gap < left gap, center; otherwise use left-aligned (pushed) - same as board-flow
        if (rightGapWhenLeftAligned < calculatedLeftGap) {
          // Center the panels
          const screenCenterX = mapAreaWidth / 2
          targetViewportX = screenCenterX - (panelWidth / 2) - (currentPanelX * linearZoom)
        } else {
          // Position panels with left gap (pushed)
          targetViewportX = calculatedLeftGap - (currentPanelX * linearZoom)
        }

        // Center viewport on first panel vertically
        const firstPanelY = Math.min(...currentNodes.map(n => n.position.y))
        const panelHeight = 300 // Approximate panel height
        const firstPanelCenterY = firstPanelY + panelHeight / 2
        const targetViewportY = screenCenterY - firstPanelCenterY * linearZoom

        // Always center on initial load - check if viewport is at default (0,0) or significantly off
        const currentViewport = reactFlowInstance.getViewport()
        const isAtDefault = Math.abs(currentViewport.x) < 1 && Math.abs(currentViewport.y) < 1
        const isSignificantlyOff = Math.abs(currentViewport.x - targetViewportX) > 10 || Math.abs(currentViewport.y - targetViewportY) > 10

        if (isAtDefault || isSignificantlyOff) {
          reactFlowInstance.setViewport({
            x: targetViewportX,
            y: targetViewportY,
            zoom: linearZoom,
          })
        }
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, viewMode, reactFlowInstance, contextPanelWidth]) // Use nodes.length to avoid re-running on every node change

  // Handle Linear mode: center and align panels vertically when switching modes
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
        originalPositionsRef.current.set(node.id, { x: node.position.x, y: node.position.y })
      })

      // Use same centering approach as Canvas mode - stack vertically
      const gapBetweenPanels = 50 // Fixed gap between panels
      const startY = 0

      // Restore saved zoom or use default (1.0 = 100% zoom for readable panels)
      const linearZoom = savedZoomRef.current.linear ?? 1.0

      // Sort nodes by their stored Y position to maintain order
      const sortedNodes = [...nodes].sort((a, b) => {
        const posA = originalPositionsRef.current.get(a.id)?.y || a.position.y
        const posB = originalPositionsRef.current.get(b.id)?.y || b.position.y
        return posA - posB
      })

      const panelWidth = 768 // Same width as prompt box
      const centeredX = 0 // Start at 0, we'll center via viewport X adjustment

      // Apply size-aware spacing: accumulate panel heights + gaps (same as board-flow)
      let cumulativeY = startY
      const linearNodes = sortedNodes.map((node, index) => {
        // Calculate Y position based on previous panels' heights
        if (index > 0) {
          const prevNode = sortedNodes[index - 1]
          const prevHeight = nodeHeightsRef.current.get(prevNode.id) || 400
          cumulativeY += prevHeight + gapBetweenPanels // Same spacing as board-flow (50px gap)
        }

        return {
          ...node,
          position: {
            x: centeredX,
            y: cumulativeY,
          },
          draggable: isLocked ? false : false, // Not draggable in Linear mode
        }
      })

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
          const currentNodes = reactFlowInstance.getNodes()
          if (currentNodes.length === 0) return

          const reactFlowElement = document.querySelector('.react-flow')
          if (!reactFlowElement) return

          const mapAreaWidth = reactFlowElement.clientWidth
          const viewportHeight = reactFlowElement.clientHeight
          const screenCenterY = viewportHeight / 2

          const currentZoom = linearZoom

          // Calculate left gap same as prompt box
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
          const calculatedLeftGap = Math.max(0, (1 / 2) * (gapFromSidebarToMinimap - panelWidth))
          const rightGapWhenLeftAligned = mapAreaWidth - calculatedLeftGap - panelWidth

          // Helper function to calculate viewport X
          const calculateViewportX = (panelX: number, zoom: number) => {
            if (rightGapWhenLeftAligned < calculatedLeftGap) {
              const screenCenterX = mapAreaWidth / 2
              return screenCenterX - (panelWidth / 2) - (panelX * zoom)
            } else {
              return calculatedLeftGap - (panelX * zoom)
            }
          }

          // Center viewport on first panel
          const firstPanelY = Math.min(...currentNodes.map(n => n.position.y))
          const panelHeight = 300
          const firstPanelCenterY = firstPanelY + panelHeight / 2

          const targetViewportY = screenCenterY - firstPanelCenterY * currentZoom
          const currentPanelX = currentNodes[0]?.position.x || 0
          const targetViewportX = calculateViewportX(currentPanelX, currentZoom)

          reactFlowInstance.setViewport({
            x: targetViewportX,
            y: targetViewportY,
            zoom: currentZoom,
          })

          // Clear the switching flag after centering is complete
          setTimeout(() => {
            isSwitchingToLinearRef.current = false
          }, 100)
        }
      }, 200)
    } else {
      isLinearModeRef.current = false

      // Restore stored positions when switching back to Canvas
      if (projectId && typeof window !== 'undefined') {
        try {
          const saved = localStorage.getItem(`thinktable-canvas-positions-project-${projectId}`)
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
            draggable: isLocked ? false : true, // Draggable in Canvas mode (unless locked)
          }
        }
        return {
          ...node,
          draggable: isLocked ? false : true, // Draggable in Canvas mode (unless locked)
        }
      })

      setNodes(restoredNodes)
    }
  }, [viewMode, nodes, reactFlowInstance, setNodes, isLocked, projectId])

  // Measure actual node heights after render and adjust positions in linear mode
  useEffect(() => {
    if (viewMode !== 'linear' || !nodes || !Array.isArray(nodes) || nodes.length === 0) return

    const timeoutId = setTimeout(() => {
      const reactFlowElement = document.querySelector('.react-flow')
      if (!reactFlowElement) return

      const viewport = reactFlowInstance.getViewport()
      const minSpacing = 50

      nodes.forEach((node) => {
        const nodeElement = reactFlowElement.querySelector(`[data-id="${node.id}"]`) as HTMLElement
        if (nodeElement) {
          const actualHeight = nodeElement.getBoundingClientRect().height / viewport.zoom
          nodeHeightsRef.current.set(node.id, actualHeight)
        }
      })

      // Sort all nodes by current Y position
      const sortedNodes = [...nodes].sort((a, b) => a.position.y - b.position.y)

      // Recalculate positions based on actual measured heights
      let currentY = sortedNodes[0]?.position.y ?? 0
      const repositionedNodes = sortedNodes.map((node, index) => {
        if (index === 0) {
          return node
        }

        const prevNode = sortedNodes[index - 1]
        const prevHeight = nodeHeightsRef.current.get(prevNode.id) || 400
        currentY = prevNode.position.y + prevHeight + minSpacing

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

      const positionsChanged = repositionedNodes.some((node, i) =>
        node.position.y !== nodes[i].position.y
      )

      if (positionsChanged) {
        setNodes(repositionedNodes)

        repositionedNodes.forEach((node) => {
          originalPositionsRef.current.set(node.id, {
            x: node.position.x,
            y: node.position.y,
          })
        })
      }
    }, 150)

    return () => clearTimeout(timeoutId)
  }, [nodes, viewMode, reactFlowInstance, setNodes])

  // Handle wheel events for scroll mode (only vertical in Linear mode)
  useEffect(() => {
    if (viewMode === 'linear' || isScrollMode) {
      const handleWheel = (e: WheelEvent) => {
        const target = e.target as HTMLElement
        const reactFlowElement = target.closest('.react-flow')
        if (!reactFlowElement) {
          return
        }

        // Handle zoom in linear mode
        if (viewMode === 'linear' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          e.stopPropagation()

          const viewport = reactFlowInstance.getViewport()
          const reactFlowRect = reactFlowElement.getBoundingClientRect()

          const mapCenterX = reactFlowRect.width / 2
          const mouseY = e.clientY - reactFlowRect.top

          const flowCenterX = (mapCenterX - viewport.x) / viewport.zoom
          const flowMouseY = (mouseY - viewport.y) / viewport.zoom

          const zoomFactor = 1 + (e.deltaY > 0 ? -0.1 : 0.1)
          const newZoom = Math.max(0.1, Math.min(2, viewport.zoom * zoomFactor))

          const newViewportX = mapCenterX - flowCenterX * newZoom
          const newViewportY = mouseY - flowMouseY * newZoom

          reactFlowInstance.setViewport({
            x: newViewportX,
            y: newViewportY,
            zoom: newZoom,
          })
          return
        }

        if (e.ctrlKey || e.metaKey) {
          return
        }

        e.preventDefault()
        e.stopPropagation()

        const viewport = reactFlowInstance.getViewport()
        const deltaX = viewMode === 'linear' ? 0 : e.deltaX // No horizontal scroll in Linear mode
        const deltaY = e.deltaY

        reactFlowInstance.setViewport({
          x: viewport.x - deltaX,
          y: viewport.y - deltaY,
          zoom: viewport.zoom,
        })
      }

      document.addEventListener('wheel', handleWheel, { passive: false, capture: true })

      return () => {
        document.removeEventListener('wheel', handleWheel, { capture: true })
      }
    }
  }, [isScrollMode, viewMode, reactFlowInstance])

  // Handle node position changes - save to localStorage for canvas mode
  const handleNodesChange = useCallback((changes: any[]) => {
    // Check if any node is being dragged - if so, move it to the end of the array to bring it to front layer
    const draggedNodeIds = new Set<string>()
    changes.forEach((change) => {
      if (change.type === 'position' && change.dragging === true) {
        draggedNodeIds.add(change.id)
      }
    })

    // If any nodes are being dragged, reorder nodes array to move dragged nodes to the end (front layer)
    if (draggedNodeIds.size > 0 && nodes && Array.isArray(nodes)) {
      const draggedNodes: Node[] = []
      const otherNodes: Node[] = []

      nodes.forEach((node) => {
        if (draggedNodeIds.has(node.id)) {
          draggedNodes.push(node)
        } else {
          otherNodes.push(node)
        }
      })

      // Move dragged nodes to the end of the array (front layer)
      if (draggedNodes.length > 0) {
        setNodes([...otherNodes, ...draggedNodes])
      }
    }

    onNodesChange(changes)

    // Save positions to localStorage when nodes are dragged in canvas mode
    if (viewMode === 'canvas' && projectId && typeof window !== 'undefined') {
      changes.forEach((change) => {
        if (change.type === 'position' && change.position) {
          try {
            const saved = localStorage.getItem(`thinktable-canvas-positions-project-${projectId}`)
            const positions = saved ? JSON.parse(saved) : {}
            positions[change.id] = change.position
            localStorage.setItem(`thinktable-canvas-positions-project-${projectId}`, JSON.stringify(positions))

            // Update stored position
            originalPositionsRef.current.set(change.id, change.position)
          } catch (error) {
            console.error('Failed to save position to localStorage:', error)
          }
        }
      })
    }
  }, [onNodesChange, viewMode, projectId, nodes, setNodes])

  return (
    <div className="h-full w-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesState}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        connectionLineType={ConnectionLineType.SmoothStep}
        defaultViewport={{ x: 0, y: 0, zoom: 0.6 }}
        fitView={viewMode === 'canvas'} // Only use fitView in Canvas mode
        fitViewOptions={{ padding: 0.2, minZoom: 0.3, maxZoom: 2 }}
        className="bg-gray-50 dark:bg-[#0f0f0f]"
        onInit={(instance) => {
          const currentViewport = instance.getViewport()
          if (!isFinite(currentViewport.x) || !isFinite(currentViewport.y) || !isFinite(currentViewport.zoom)) {
            instance.setViewport({ x: 0, y: 0, zoom: 0.6 })
          }
          setReactFlowInstance(instance)
        }}
        panOnDrag={true}
        zoomOnScroll={!isScrollMode}
        zoomOnPinch={true}
        zoomOnDoubleClick={true}
        minZoom={0.1}
        maxZoom={2}
        autoPanOnNodeDrag={false}
        selectNodesOnDrag={false}
        multiSelectionKeyCode={['Shift']}
        onPaneClick={(event) => {
          // Map click: allow normal deselection (React Flow handles it)
          // No zoom to 100% functionality in project flow
          // Selection will be deselected normally on map click
        }}
        onMove={(event, viewport) => {
          // Skip centering adjustments if we're currently switching to Linear mode
          if (isSwitchingToLinearRef.current) {
            return
          }

          // In Linear mode, lock horizontal position to prevent horizontal panning
          if (viewMode === 'linear' && nodes && Array.isArray(nodes) && nodes.length > 0) {
            const currentZoom = viewport.zoom

            const reactFlowElement = document.querySelector('.react-flow')
            if (reactFlowElement) {
              const mapAreaWidth = reactFlowElement.clientWidth
              const panelWidth = 768

              if (!isFinite(mapAreaWidth) || !isFinite(currentZoom) || !isFinite(viewport.x) || !isFinite(viewport.y)) {
                return
              }

              const currentPanelX = nodes[0]?.position.x || 0

              const promptBoxContainer = document.querySelector('[class*="pointer-events-auto"]') as HTMLElement
              const chatTextarea = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]') as HTMLElement
              const promptBox = chatTextarea?.closest('[class*="pointer-events-auto"]') as HTMLElement

              let targetViewportX: number

              if (promptBox) {
                const promptBoxRect = promptBox.getBoundingClientRect()
                const reactFlowRect = reactFlowElement.getBoundingClientRect()
                const promptBoxCenterX = (promptBoxRect.left + promptBoxRect.right) / 2 - reactFlowRect.left
                targetViewportX = promptBoxCenterX - (currentPanelX + panelWidth / 2) * currentZoom
              } else {
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
                const calculatedLeftGap = Math.max(0, (1 / 2) * (gapFromSidebarToMinimap - panelWidth))
                const rightGapWhenLeftAligned = mapAreaWidth - calculatedLeftGap - panelWidth

                let promptBoxCenterX: number
                if (rightGapWhenLeftAligned < calculatedLeftGap) {
                  promptBoxCenterX = mapAreaWidth / 2
                } else {
                  promptBoxCenterX = calculatedLeftGap + (panelWidth / 2)
                }

                targetViewportX = promptBoxCenterX - (currentPanelX + panelWidth / 2) * currentZoom
              }

              if (!isFinite(targetViewportX)) {
                return
              }

              if (Math.abs(viewport.x - targetViewportX) > 1) {
                reactFlowInstance.setViewport({
                  x: targetViewportX,
                  y: viewport.y,
                  zoom: currentZoom,
                })
              }
            }
          }
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
        {!isMinimapHidden && (
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
        )}

        {/* Minimap toggle pill - horizontal below minimap, like top bar and prompt box */}
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
            bottom: `${(minimapBottom - 12) - 4}px`, // Positioned just below minimap bottom edge
            right: `${minimapRight + (179 - 48) / 2}px`, // Center horizontally under minimap (179px minimap width, 48px pill width)
          }}
          title={isMinimapHidden ? 'Show minimap' : 'Hide minimap'}
        />
      </ReactFlow>

      {/* Linear/Canvas toggle with Nav dropdown above minimap */}
      <div
        className="absolute z-10"
        style={{
          // Position toggle above minimap
          // Both positions use minimapBottom which already accounts for the jump when prompt box gets close
          bottom: isMinimapHidden
            ? `${minimapBottom - 12 + 8}px` // At minimap position when hidden + small offset
            : `${minimapBottom - 12 + 160 + 4}px`, // Above minimap (160px height + 4px gap, reduced from 8px)
          // Right-align with minimap (which aligns with prompt box when jumped), moved left 16px
          right: `${minimapRight + 16}px`, // Match minimap right position + 16px left offset (moved 1px left)
        }}
      >
        <div
          className={cn(
            "bg-blue-50 dark:bg-[#2a2a3a] rounded-lg px-1 py-0.5 flex items-center gap-1 relative",
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
                isSwitchingToLinearRef.current = true

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
                  isSwitchingToLinearRef.current = false
                }, 250)
              } else {
                setViewMode('linear')
                localStorage.setItem('thinktable-view-mode', 'linear')
                // Save to Supabase
                const saveToSupabase = async () => {
                  try {
                    const supabase = createClient()
                    const { data: { user } } = await supabase.auth.getUser()
                    if (user) {
                      const { data: profile } = await supabase
                        .from('profiles')
                        .select('metadata')
                        .eq('id', user.id)
                        .single()

                      const existingMetadata = (profile?.metadata as Record<string, any>) || {}
                      const updatedMetadata = { ...existingMetadata, viewMode: 'linear' }

                      await supabase
                        .from('profiles')
                        .update({ metadata: updatedMetadata })
                        .eq('id', user.id)
                    }
                  } catch (error) {
                    console.error('Error saving view mode to Supabase:', error)
                  }
                }
                saveToSupabase()
              }
            }}
            className={cn(
              'px-3 py-1 text-xs h-auto ml-[1px]',
              viewMode === 'linear'
                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700'
                : 'bg-transparent text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
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
                  localStorage.setItem('thinktable-view-mode', 'canvas')
                  // Save to Supabase
                  const saveToSupabase = async () => {
                    try {
                      const supabase = createClient()
                      const { data: { user } } = await supabase.auth.getUser()
                      if (user) {
                        const { data: profile } = await supabase
                          .from('profiles')
                          .select('metadata')
                          .eq('id', user.id)
                          .single()

                        const existingMetadata = (profile?.metadata as Record<string, any>) || {}
                        const updatedMetadata = { ...existingMetadata, viewMode: 'canvas' }

                        await supabase
                          .from('profiles')
                          .update({ metadata: updatedMetadata })
                          .eq('id', user.id)
                      }
                    } catch (error) {
                      console.error('Error saving view mode to Supabase:', error)
                    }
                  }
                  saveToSupabase()
                }
              }}
              className={cn(
                'px-0 py-0 h-auto text-xs',
                viewMode === 'canvas'
                  ? 'text-gray-900 dark:text-gray-100 hover:bg-transparent'
                  : 'text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100'
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
                <DropdownMenuRadioGroup value={isScrollMode ? 'scroll' : 'zoom'} onValueChange={(value) => {
                  setIsScrollMode(value === 'scroll')
                  localStorage.setItem('thinktable-scroll-mode', value === 'scroll' ? 'true' : 'false')
                  // Save to Supabase
                  const saveToSupabase = async () => {
                    try {
                      const supabase = createClient()
                      const { data: { user } } = await supabase.auth.getUser()
                      if (user) {
                        const { data: profile } = await supabase
                          .from('profiles')
                          .select('metadata')
                          .eq('id', user.id)
                          .single()

                        const existingMetadata = (profile?.metadata as Record<string, any>) || {}
                        const updatedMetadata = { ...existingMetadata, isScrollMode: value === 'scroll' }

                        await supabase
                          .from('profiles')
                          .update({ metadata: updatedMetadata })
                          .eq('id', user.id)
                      }
                    } catch (error) {
                      console.error('Error saving scroll mode to Supabase:', error)
                    }
                  }
                  saveToSupabase()
                }}>
                  <DropdownMenuRadioItem value="scroll">Scroll</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="zoom">Zoom</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ProjectFlow({ projectId }: { projectId?: string }) {
  return (
    <ReactFlowProvider>
      <ProjectFlowInner projectId={projectId} />
    </ReactFlowProvider>
  )
}

