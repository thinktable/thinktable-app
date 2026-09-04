'use client'

// Client component wrapper — top edit overlays on the map column (chat lives in ChatSidebar)
import { useState, useEffect, useRef, useCallback } from 'react'
import { EditPanel } from './sticky-prompt-panel'
import { useReactFlowContext } from './react-flow-context'
import { PillSelect } from './pill-select'
import { BoardFilterSortBar } from './board-filter-sort-menu' // Criteria under the mode pill
import { PhoneModeMenuProvider } from './phone-mode-menu-context' // Phone: mode dropdown + tools in the pill
import { useSidebarContext } from './sidebar-context' // phoneDockTight: hide tools while landscape keyboard is up
import { useUserPreference } from '@/lib/hooks/use-user-preferences'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

export function InputAreaWithStickyPrompt({ conversationId, projectId }: { conversationId?: string; projectId?: string }) {
  const { phoneDockTight } = useSidebarContext() // Landscape + keyboard: hide top bar / pill so the Ask row can sit in the strip
  const [inputHeight, setInputHeight] = useState(52) // Default height
  const [maxWidth, setMaxWidth] = useState(768) // Default max-w-3xl (768px)
  const [isCentered, setIsCentered] = useState(false) // Whether input should be centered
  const [leftGap, setLeftGap] = useState(112) // Dynamic left gap calculated from sidebar to minimap gap
  const [isHidden, setIsHidden] = useState(false) // Track if prompt box is hidden
  const [isHovering, setIsHovering] = useState(false) // Track if mouse is hovering over prompt box area (deprecated, use isHoveringPromptBox/isHoveringPromptPill/isHoveringPromptHoverArea)
  const [isHoveringPromptBox, setIsHoveringPromptBox] = useState(false) // Track if mouse is hovering over prompt box
  const [isHoveringPromptPill, setIsHoveringPromptPill] = useState(false) // Track if mouse is hovering over prompt pill
  const [isHoveringPromptHoverArea, setIsHoveringPromptHoverArea] = useState(false) // Track if mouse is hovering over prompt hover area
  // Prompt box visibility mode: 'shown' | 'hidden' | 'hover'
  // Use useUserPreference hook for Supabase persistence, default to 'shown'
  const supabaseForPrompt = createClient() // Create Supabase client for useUserPreference
  const { mode: promptMode, setMode: setPromptMode, isLoading: isLoadingPromptMode } = useUserPreference(supabaseForPrompt, 'promptMode', 'shown')
  const [promptContextMenuPosition, setPromptContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const promptPillRef = useRef<HTMLDivElement | null>(null) // Ref to access prompt pill element
  // Refs to track prompt box hover states for reliable checking in timeouts
  const isHoveringPromptBoxRef = useRef(false)
  const isHoveringPromptPillRef = useRef(false)
  const isHoveringPromptHoverAreaRef = useRef(false)
  const promptHideTimeoutRef = useRef<NodeJS.Timeout | null>(null) // Track hide timeout for prompt box
  const isPromptHidingRef = useRef(false) // Track if prompt box is in the process of hiding (to keep pill visible during transition)
  const [isPromptFadingOut, setIsPromptFadingOut] = useState(false) // Track if prompt box is fading out (for smooth opacity transition)
  const [minimapRight, setMinimapRight] = useState(15) // Track minimap right position to align hover area
  const { setPanelWidth, setIsPromptBoxCentered, editMenuPillMode, setEditMenuPillMode } = useReactFlowContext() // Mode pill + prompt-box layout
  // Calculate available width for input - switches between left-aligned and centered based on right gap
  useEffect(() => {
    const calculateMaxWidth = () => {
      // Calculate width using actual map area width to maintain consistent gap
      // This prevents overlap with sidebar on window collapse and maintains same gap as top bar
      const reactFlowElement = document.querySelector('.react-flow')
      
      // Calculate the dynamic left gap: (1/2) * (gap from sidebar to minimap - prompt box width)
      // This ensures the prompt box is centered in the space between sidebar and minimap
      // The gap should be different for collapsed vs expanded sidebar
      const expandedSidebarWidth = 256 // w-64 when expanded
      const collapsedSidebarWidth = 64 // w-16 when collapsed
      const minimapWidth = 179 // Minimap width from CSS
      const minimapMargin = 15 // Margin from right edge
      const promptBoxMaxWidth = 768 // Max width of prompt box
      
      // Detect current sidebar state
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
      setLeftGap(calculatedLeftGap) // Store calculated left gap in state
      
      if (!reactFlowElement) {
        // Fallback: calculate based on expanded sidebar
        const windowWidth = window.innerWidth
        const mapAreaWidth = windowWidth - expandedSidebarWidth
        const availableWidth = Math.min(promptBoxMaxWidth, mapAreaWidth - calculatedLeftGap - 16) // Use calculated left gap, 16px right gap
        setMaxWidth(Math.max(0, availableWidth))
        setIsCentered(false) // Default to left-aligned in fallback
        return
      }
      
      const mapAreaWidth = reactFlowElement.clientWidth
      
      // Check if minimap has moved up - if so, reduce right gap to allow input to expand
      const minimapElement = document.querySelector('.react-flow__minimap') as HTMLElement
      let minimapBottom = 15 // Default minimap bottom position
      if (minimapElement) {
        const computedStyle = getComputedStyle(minimapElement)
        const bottomValue = computedStyle.bottom
        if (bottomValue && bottomValue !== 'auto') {
          minimapBottom = parseInt(bottomValue) || 15
        }
      }
      const minimapMovedUp = minimapBottom > 15 // Minimap moved up when bottom > 15px (default is 15px)
      
      // When minimap is moved up, reduce right gap to allow input to expand into that space
      // Minimap is ~179px wide + spacing, so we can reduce right gap significantly
      const baseRightGap = minimapMovedUp ? 0 : 16 // No right gap when minimap is up, normal 16px when in normal position
      
      // First calculate width with left-aligned positioning using calculated left gap
      const leftAlignedWidth = Math.min(promptBoxMaxWidth, mapAreaWidth - calculatedLeftGap - baseRightGap)
      
      // Calculate the right gap (distance from input box right edge to map area right edge) when left-aligned
      const rightGapWhenLeftAligned = mapAreaWidth - calculatedLeftGap - leftAlignedWidth
      
      // If right gap goes below the calculated left gap, switch to centered; otherwise use left-aligned
      if (rightGapWhenLeftAligned < calculatedLeftGap) {
        // Center the input box with same margins as top bar (16px on each side)
        setIsCentered(true)
        setIsPromptBoxCentered(true) // Update context so panels know prompt box is centered
        const centeredWidth = Math.min(promptBoxMaxWidth, mapAreaWidth - 32) // 16px gap on each side (32px total) - same as top bar
        setMaxWidth(Math.max(0, centeredWidth))
        // Update panel width to match prompt box width (for 100% zoom)
        setPanelWidth(centeredWidth)
      } else {
        // Use left-aligned with calculated left gap
        setIsCentered(false)
        setIsPromptBoxCentered(false) // Update context so panels know prompt box is left-aligned
        setMaxWidth(Math.max(0, leftAlignedWidth))
        // Update panel width to match prompt box width (for 100% zoom)
        setPanelWidth(leftAlignedWidth)
      }
    }

    calculateMaxWidth()
    window.addEventListener('resize', calculateMaxWidth)
    
    // Watch for sidebar state changes using MutationObserver
    const sidebarElement = document.querySelector('[class*="w-16"], [class*="w-64"]') as HTMLElement
    const sidebarObserver = sidebarElement ? new MutationObserver(() => {
      calculateMaxWidth()
    }) : null
    
    if (sidebarObserver && sidebarElement) {
      sidebarObserver.observe(sidebarElement, {
        attributes: true,
        attributeFilter: ['class']
      })
    }
    
    // Watch for minimap position changes - when minimap moves up, recalculate width
    const minimapElement = document.querySelector('.react-flow__minimap') as HTMLElement
    const minimapObserver = minimapElement ? new MutationObserver(() => {
      calculateMaxWidth()
    }) : null
    
    if (minimapObserver && minimapElement) {
      minimapObserver.observe(minimapElement, {
        attributes: true,
        attributeFilter: ['style']
      })
    }
    
    // Also use ResizeObserver on minimap to catch position changes
    const minimapResizeObserver = minimapElement ? new ResizeObserver(() => {
      calculateMaxWidth()
    }) : null
    
    if (minimapResizeObserver && minimapElement) {
      minimapResizeObserver.observe(minimapElement)
    }
    
    return () => {
      window.removeEventListener('resize', calculateMaxWidth)
      if (sidebarObserver) sidebarObserver.disconnect()
      if (minimapObserver) minimapObserver.disconnect()
      if (minimapResizeObserver) minimapResizeObserver.disconnect()
    }
  }, [])

  // Calculate minimap right position for hover area alignment
  useEffect(() => {
    const updateMinimapRight = () => {
      const minimapElement = document.querySelector('.react-flow__minimap') as HTMLElement
      const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
      
      if (minimapElement && reactFlowElement) {
        const minimapRect = minimapElement.getBoundingClientRect()
        const reactFlowRect = reactFlowElement.getBoundingClientRect()
        // Calculate right position relative to React Flow container
        const right = reactFlowRect.right - minimapRect.right
        setMinimapRight(right)
      } else {
        // Default position if minimap not found
        setMinimapRight(15)
      }
    }
    
    updateMinimapRight()
    window.addEventListener('resize', updateMinimapRight)
    
    // Watch for minimap position changes
    const minimapElement = document.querySelector('.react-flow__minimap') as HTMLElement
    const minimapObserver = minimapElement ? new MutationObserver(() => {
      updateMinimapRight()
    }) : null
    
    if (minimapObserver && minimapElement) {
      minimapObserver.observe(minimapElement, {
        attributes: true,
        attributeFilter: ['style']
      })
    }
    
    // Also use ResizeObserver on minimap to catch position changes
    const minimapResizeObserver = minimapElement ? new ResizeObserver(() => {
      updateMinimapRight()
    }) : null
    
    if (minimapResizeObserver && minimapElement) {
      minimapResizeObserver.observe(minimapElement)
    }
    
    return () => {
      window.removeEventListener('resize', updateMinimapRight)
      if (minimapObserver) minimapObserver.disconnect()
      if (minimapResizeObserver) minimapResizeObserver.disconnect()
    }
  }, [])

  // Overlay is full-width; PillSelect centers the segmented control, left-aligns when tools are in the pill.

  const pillSelectRef = useRef<HTMLDivElement>(null)

  // Sync prompt box visibility with mode (only after loading is complete)
  useEffect(() => {
    if (isLoadingPromptMode) return // Don't apply mode while loading
    
    // Apply mode
    if (promptMode === 'shown') {
      // Always show
      setIsHidden(false)
      setIsPromptFadingOut(false) // Reset fade-out state when showing
    } else if (promptMode === 'hidden') {
      // Always hide
      setIsHidden(true)
    } else {
      // Hover mode - reset to default hover behavior (prompt box hidden, shown on hover)
      setIsHidden(true)
    }
  }, [promptMode])

  // Close prompt context menu when clicking outside
  useEffect(() => {
    if (!promptContextMenuPosition) return

    const handleClick = () => {
      setPromptContextMenuPosition(null)
    }

    const handleContextMenu = (e: MouseEvent) => {
      // Close if right-clicking elsewhere
      const target = e.target as HTMLElement
      if (!target.closest('[data-prompt-pill-context]')) {
        setPromptContextMenuPosition(null)
      }
    }

    document.addEventListener('click', handleClick)
    document.addEventListener('contextmenu', handleContextMenu)
    
    return () => {
      document.removeEventListener('click', handleClick)
      document.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [promptContextMenuPosition])

  // Function to check and hide prompt box if cursor left all related areas
  const checkAndHidePromptBox = useCallback(() => {
    // Clear any existing timeout
    if (promptHideTimeoutRef.current) {
      clearTimeout(promptHideTimeoutRef.current)
      promptHideTimeoutRef.current = null
    }
    
    // Only hide in hover mode
    if (promptMode !== 'hover') {
      return
    }
    
    // Mark that we're in the process of hiding (to keep pill visible during transition)
    isPromptHidingRef.current = true
    
    // Small delay to allow transition between areas
    promptHideTimeoutRef.current = setTimeout(() => {
      // Re-check refs at timeout execution time
      const isInAnyArea = isHoveringPromptBoxRef.current || 
                          isHoveringPromptPillRef.current || 
                          isHoveringPromptHoverAreaRef.current
      
      // Only hide if not in any related area and prompt box is currently shown
      if (!isInAnyArea && !isHidden && promptMode === 'hover') {
        // Start fade-out by setting opacity to 0 first
        setIsPromptFadingOut(true)
        
        // After opacity transition completes (200ms), collapse height and set hidden
        setTimeout(() => {
          setIsHidden(true)
          setIsPromptFadingOut(false)
          // Clear the hiding flag after a brief delay to allow state to settle
          setTimeout(() => {
            isPromptHidingRef.current = false
          }, 50)
        }, 200) // Wait for opacity transition to complete
      } else {
        // If not hiding, clear the hiding flag
        isPromptHidingRef.current = false
      }
    }, 200) // 200ms delay to allow moving between areas
  }, [isHidden, promptMode])

  return (
    <PhoneModeMenuProvider>
    <>
      {/* Edit panel — hide while landscape keyboard leaves no room under the top bar */}
      <div
        className={phoneDockTight ? 'invisible pointer-events-none' : undefined}
        aria-hidden={phoneDockTight}
      >
        <EditPanel conversationId={conversationId} projectId={projectId} />
      </div>
      
      {/* Floating pill select — centered segmented control; left-aligned when tools are in the pill */}
      <div 
        ref={pillSelectRef}
        data-edit-menu-context
        className={cn(
          'absolute inset-x-0 z-20 pointer-events-none flex flex-col items-stretch',
          phoneDockTight ? 'invisible opacity-0' : 'opacity-100' // Same strip as the Ask row when the keyboard is up
        )}
        aria-hidden={phoneDockTight}
        style={{
          top: '56px', // Just below the 52px top bar
        }}
      >
        <PillSelect
          options={[
            { value: 'home', label: 'Actions' },
            { value: 'insert', label: 'Layout' },
            { value: 'draw', label: 'Draw' },
            { value: 'view', label: 'View' },
          ]}
          value={editMenuPillMode}
          onChange={(value) => {
            // Update mode when pill select changes - updates context shared with EditorToolbar
            setEditMenuPillMode(value as 'home' | 'insert' | 'draw' | 'view')
          }}
        />
        {/* Filter/Sort criteria — under the mode pill, no divider */}
        <BoardFilterSortBar />
      </div>
    </>
    </PhoneModeMenuProvider>
  )
}
