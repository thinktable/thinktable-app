'use client'

// Client component wrapper — top edit overlays on the map column (chat lives in ChatSidebar)
import { useState, useEffect, useRef, useCallback } from 'react'
import { EditPanel } from './sticky-prompt-panel'
import { cn } from '@/lib/utils'
import { useReactFlowContext } from './react-flow-context'
import { PillSelect } from './pill-select'
import { useUserPreference } from '@/lib/hooks/use-user-preferences'
import { createClient } from '@/lib/supabase/client'

export function InputAreaWithStickyPrompt({ conversationId, projectId }: { conversationId?: string; projectId?: string }) {
  const [inputHeight, setInputHeight] = useState(52) // Default height
  const [maxWidth, setMaxWidth] = useState(768) // Default max-w-3xl (768px)
  const [isCentered, setIsCentered] = useState(false) // Whether input should be centered
  const [leftGap, setLeftGap] = useState(112) // Dynamic left gap calculated from sidebar to minimap gap
  const [isHidden, setIsHidden] = useState(false) // Track if prompt box is hidden
  const [isHovering, setIsHovering] = useState(false) // Track if mouse is hovering over prompt box area (deprecated, use isHoveringPromptBox/isHoveringPromptPill/isHoveringPromptHoverArea)
  const [isHoveringPromptBox, setIsHoveringPromptBox] = useState(false) // Track if mouse is hovering over prompt box
  const [isHoveringPromptPill, setIsHoveringPromptPill] = useState(false) // Track if mouse is hovering over prompt pill
  const [isHoveringPromptHoverArea, setIsHoveringPromptHoverArea] = useState(false) // Track if mouse is hovering over prompt hover area
  const [isPillSelectHidden, setIsPillSelectHidden] = useState(false) // Track if pill select is hidden
  const [isHoveringPillSelectArea, setIsHoveringPillSelectArea] = useState(false) // Track if mouse is hovering over space between top bar and pill select
  const [isHoveringPill, setIsHoveringPill] = useState(false) // Track if mouse is hovering over the hide pill itself
  const [isPillExpanded, setIsPillExpanded] = useState(false) // Pill grows only after a very short intentional hover
  const [isHoveringTopBar, setIsHoveringTopBar] = useState(false) // Track if mouse is hovering over top bar
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null) // Track hover timeout for showing menu
  const expandTimeoutRef = useRef<NodeJS.Timeout | null>(null) // Delay before pill width/height expand
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null) // Track hide timeout
  const wasShownViaHoverRef = useRef(false) // Track if menu was shown via hover (to re-hide on leave)
  const isPinnedRef = useRef(false) // Track if menu is pinned (permanently open) vs hover mode
  const [isPinned, setIsPinned] = useState(false) // State to track pinned status for re-renders
  // Edit menu visibility mode: 'shown' | 'hidden' | 'hover'
  // Use useUserPreference hook for Supabase persistence, default to 'shown'
  const supabaseForEditMenu = createClient() // Create Supabase client for useUserPreference
  const { mode: editMenuMode, setMode: setEditMenuMode, isLoading: isLoadingEditMenuMode } = useUserPreference(supabaseForEditMenu, 'editMenuMode', 'shown')
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  // Prompt box visibility mode: 'shown' | 'hidden' | 'hover'
  // Use useUserPreference hook for Supabase persistence, default to 'shown'
  const supabaseForPrompt = createClient() // Create Supabase client for useUserPreference
  const { mode: promptMode, setMode: setPromptMode, isLoading: isLoadingPromptMode } = useUserPreference(supabaseForPrompt, 'promptMode', 'shown')
  const [promptContextMenuPosition, setPromptContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  // Refs to track hover states for reliable checking in timeouts
  const isHoveringTopBarRef = useRef(false)
  const isHoveringPillSelectAreaRef = useRef(false)
  const isHoveringPillRef = useRef(false)
  const isPillSelectHiddenRef = useRef(false)
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

  // Center Actions/Layout/Draw/View menu + hide pill on the board / edit-bar column
  // (not the prompt box). Chat sidebar overlays and does not change column width.
  const [pillSelectLeft, setPillSelectLeft] = useState(0)
  const [pillSelectWidth, setPillSelectWidth] = useState(200) // Default width, will be measured
  const pillSelectRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    const getBoardColumn = (): HTMLElement | null => {
      // Map column wraps BoardFlow + overlays; react-flow fills it
      const rf = document.querySelector('.react-flow') as HTMLElement | null
      if (!rf) return null
      return (rf.parentElement as HTMLElement) || rf
    }

    const calculatePillSelectPosition = () => {
      const boardColumn = getBoardColumn()
      if (!boardColumn) return
      setPillSelectLeft(boardColumn.clientWidth / 2) // Center of board / edit-bar area
    }
    
    calculatePillSelectPosition()
    window.addEventListener('resize', calculatePillSelectPosition)

    const boardColumn = getBoardColumn()
    const resizeObserver = boardColumn
      ? new ResizeObserver(() => calculatePillSelectPosition())
      : null
    if (resizeObserver && boardColumn) resizeObserver.observe(boardColumn)
    
    return () => {
      window.removeEventListener('resize', calculatePillSelectPosition)
      if (resizeObserver) resizeObserver.disconnect()
    }
  }, [])
  
  // Keep refs in sync with state
  useEffect(() => {
    isPillSelectHiddenRef.current = isPillSelectHidden
  }, [isPillSelectHidden])

  // Sync edit menu visibility with mode (only after loading is complete)
  useEffect(() => {
    if (isLoadingEditMenuMode) return // Don't apply mode while loading
    
    // Apply mode
    if (editMenuMode === 'shown') {
      // Always show
      setIsPillSelectHidden(false)
      isPillSelectHiddenRef.current = false
      isPinnedRef.current = true
      setIsPinned(true)
      wasShownViaHoverRef.current = false
    } else if (editMenuMode === 'hidden') {
      // Always hide
      setIsPillSelectHidden(true)
      isPillSelectHiddenRef.current = true
      isPinnedRef.current = false
      setIsPinned(false)
      wasShownViaHoverRef.current = false
    } else {
      // Hover mode - reset to default hover behavior (menu hidden, shown on hover)
      setIsPillSelectHidden(true)
      isPillSelectHiddenRef.current = true
      isPinnedRef.current = false
      setIsPinned(false)
      wasShownViaHoverRef.current = false
    }
  }, [editMenuMode, isLoadingEditMenuMode])

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

  // Close context menu when clicking outside
  useEffect(() => {
    if (!contextMenuPosition) return

    const handleClick = () => {
      setContextMenuPosition(null)
    }

    const handleContextMenu = (e: MouseEvent) => {
      // Close if right-clicking elsewhere
      const target = e.target as HTMLElement
      if (!target.closest('[data-edit-menu-context]') && !target.closest('[data-edit-pill-context]')) {
        setContextMenuPosition(null)
      }
    }

    document.addEventListener('click', handleClick)
    document.addEventListener('contextmenu', handleContextMenu)
    
    return () => {
      document.removeEventListener('click', handleClick)
      document.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [contextMenuPosition])

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

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
      }
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
      }
    }
  }, [])

  // Measure pill select width
  useEffect(() => {
    if (!pillSelectRef.current || isPillSelectHidden) return
    
    const updateWidth = () => {
      if (pillSelectRef.current) {
        const width = pillSelectRef.current.offsetWidth
        setPillSelectWidth(width)
      }
    }
    
    // Initial measurement
    updateWidth()
    
    // Watch for size changes
    const resizeObserver = new ResizeObserver(() => {
      updateWidth()
    })
    
    resizeObserver.observe(pillSelectRef.current)
    
    return () => {
      resizeObserver.disconnect()
    }
  }, [isPillSelectHidden, pillSelectLeft])

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

  // Function to check if menu should be hidden (called when leaving any related area)
  const checkAndHideMenu = useCallback((relatedTarget?: HTMLElement | null) => {
    // Don't auto-hide when permanently shown; allow hide after temporary hover reveal in hidden/hover modes
    if (editMenuMode === 'shown') {
      return
    }
    // Clear any existing hide timeout
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
    
    // Check if relatedTarget is still in any related area
    if (relatedTarget && relatedTarget instanceof HTMLElement) {
      const topBarElement = relatedTarget.closest('[style*="top: \'0px\'"]')
      const menuElement = pillSelectRef.current && (relatedTarget === pillSelectRef.current || pillSelectRef.current.contains(relatedTarget))
      const hoverAreaElement = relatedTarget.closest('[style*="top: \'52px\'"]')
      const pillElement = relatedTarget.closest('[data-edit-pill-context]')
      
      // If moving to another related area, don't hide
      if (topBarElement || menuElement || hoverAreaElement || pillElement) {
        return
      }
    }
    
    // Small delay to allow transition between areas
    hideTimeoutRef.current = setTimeout(() => {
      // Don't hide if menu is pinned (permanently open)
      if (isPinnedRef.current) {
        return
      }
      
      // Re-check refs at timeout execution time
      const isInAnyArea = isHoveringTopBarRef.current || 
                          isHoveringPillSelectAreaRef.current || 
                          isHoveringPillRef.current
      
      // Also double-check by verifying menu is actually visible
      const menuIsVisible = !isPillSelectHiddenRef.current && pillSelectRef.current
      
      // If menu was shown via pill hover and we're not in any related area, hide it again
      if (wasShownViaHoverRef.current && 
          !isInAnyArea && 
          menuIsVisible &&
          editMenuMode !== 'shown') {
        setIsPillSelectHidden(true)
        isPillSelectHiddenRef.current = true
        wasShownViaHoverRef.current = false
        setIsPillExpanded(false) // Collapse open/close pill with the menu
      }
    }, 200) // Slightly longer delay to ensure state has settled
  }, [editMenuMode])

  return (
    <>
      {/* Edit panel - always visible at top */}
      <div
        onMouseEnter={() => {
          setIsHoveringTopBar(true)
          isHoveringTopBarRef.current = true
          // Cancel any pending hide timeout
          if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current)
            hideTimeoutRef.current = null
          }
          // Don't clear wasShownViaHoverRef - keep it so menu can hide when leaving all areas
        }}
        onMouseLeave={(e) => {
          setIsHoveringTopBar(false)
          isHoveringTopBarRef.current = false
          // Check if menu should hide after leaving topbar
          checkAndHideMenu(e.relatedTarget as HTMLElement)
        }}
      >
        <EditPanel conversationId={conversationId} projectId={projectId} />
      </div>
      
      {/* Hover zone covering full pill select area - triggers hide pill visibility and keeps menu open */}
      <div
        className="absolute pointer-events-auto flex items-center justify-center"
        style={{
          left: `${pillSelectLeft}px`,
          top: '52px', // Start right below top bar (52px height)
          width: `${Math.max(pillSelectWidth || 200, 200)}px`, // Match pill select width, minimum 200px
          height: '20px', // Reduced height - just enough to cover pill area for hover
          transform: 'translateX(-50%)', // Center on calculated position
          zIndex: 18, // Below pill (z-25) and pill select (z-20) but still captures hover in gap area
        }}
        onMouseEnter={() => {
          setIsHoveringPillSelectArea(true)
          isHoveringPillSelectAreaRef.current = true
          // Cancel any pending hide timeout
          if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current)
            hideTimeoutRef.current = null
          }
        }}
        onMouseLeave={(e) => {
          setIsHoveringPillSelectArea(false)
          isHoveringPillSelectAreaRef.current = false
          // Check if menu should hide after leaving hover area
          checkAndHideMenu(e.relatedTarget as HTMLElement)
        }}
      />
      
      {/* Hide pill — centered on board / edit-bar column width */}
        <div 
          data-edit-pill-context
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setContextMenuPosition({ x: e.clientX, y: e.clientY })
          }}
          onClick={() => {
            // Toggle between 'shown' and 'hidden' by default
            // If in 'hover' mode, clicking pill changes it to 'shown'
            if (editMenuMode === 'shown') {
              setEditMenuMode('hidden') // Toggle to hidden
            } else if (editMenuMode === 'hidden') {
              setEditMenuMode('shown') // Toggle to shown
            } else { // editMenuMode === 'hover'
              setEditMenuMode('shown') // If in hover mode, click makes it shown
              setIsPillSelectHidden(false)
              isPillSelectHiddenRef.current = false
            }
          }}
        onMouseEnter={() => {
          setIsHoveringPill(true)
          isHoveringPillRef.current = true
          setIsHoveringPillSelectArea(true) // Also mark hover area as active
          isHoveringPillSelectAreaRef.current = true
          // Cancel any pending hide timeout
          if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current)
            hideTimeoutRef.current = null
          }
          // Expand only after a very short intentional hover (not on momentary pass-over)
          if (expandTimeoutRef.current) {
            clearTimeout(expandTimeoutRef.current)
            expandTimeoutRef.current = null
          }
          expandTimeoutRef.current = setTimeout(() => {
            if (!isHoveringPillRef.current) return
            setIsPillExpanded(true)
          }, 80) // Very short delay before grow
          // After a short pill hover, reveal the mode toggle menu (Actions / Layout / Draw / View)
          if (isPillSelectHidden) {
            if (hoverTimeoutRef.current) {
              clearTimeout(hoverTimeoutRef.current)
              hoverTimeoutRef.current = null
            }
            hoverTimeoutRef.current = setTimeout(() => {
              // Still hovering the pill after the delay?
              if (!isHoveringPillRef.current) return
              setIsPillSelectHidden(false)
              isPillSelectHiddenRef.current = false
              wasShownViaHoverRef.current = true // Hide again when pointer leaves pill/menu
            }, 150) // Short intentional hover before opening
          }
        }}
        onMouseLeave={(e) => {
          setIsHoveringPill(false)
          isHoveringPillRef.current = false
          // Clear area hover unless moving into the menu or the pill hover zone
          const related = e.relatedTarget as HTMLElement | null
          const movingToMenu = !!(related && pillSelectRef.current && (related === pillSelectRef.current || pillSelectRef.current.contains(related)))
          const movingToHoverZone = !!(related && related.closest?.('[style*="top: \'52px\'"]'))
          if (!movingToMenu && !movingToHoverZone) {
            setIsHoveringPillSelectArea(false)
            isHoveringPillSelectAreaRef.current = false
            setIsPillExpanded(false) // Collapse when leaving the pill cluster
          }
          // Clear any pending expand / show timeouts
          if (expandTimeoutRef.current) {
            clearTimeout(expandTimeoutRef.current)
            expandTimeoutRef.current = null
          }
          if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current)
            hoverTimeoutRef.current = null
          }
          // Check if menu should hide after leaving pill
          checkAndHideMenu(e.relatedTarget as HTMLElement)
        }}
          className={cn(
          // Soft when menu open; medium when hidden; darker on direct pill hover.
          // Stays compact until hovered briefly, then expands.
          'absolute rounded-full cursor-pointer transition-all duration-200 z-30',
          isPillExpanded ? 'w-20 h-2' : 'w-12 h-1.5',
          isHoveringPill
            ? 'bg-gray-300 dark:bg-gray-600' // Direct hover: darker
            : isPillSelectHidden
              ? 'bg-gray-200 dark:bg-gray-500' // Hidden: medium strength (not as soft as menu, not as strong as hover)
              : 'bg-[#f7f8f9] dark:bg-[#1c1c24]', // Soft same as edit mode toggle container
          // Hide pill when menu is always shown (mode === 'shown'), show when hovering pill hover area or in hover/hidden mode
          (editMenuMode === 'shown' && !isHoveringPillSelectArea) ? 'opacity-0' : 'opacity-100'
        )}
        style={{
          left: `${pillSelectLeft}px`,
          // Keep centered on top bar bottom edge (52px) as height changes
          top: isPillExpanded ? '48px' : '49px',
          transform: 'translateX(-50%)', // Center on calculated position
        }}
        title={isPillSelectHidden ? 'Show mode selector' : 'Hide mode selector'}
      />
      
      {/* Floating pill select — centered on board / edit-bar column, below top bar */}
      <div 
        ref={pillSelectRef}
        data-edit-menu-context
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setContextMenuPosition({ x: e.clientX, y: e.clientY })
        }}
        className={cn(
          'absolute z-20 transition-opacity duration-200',
          isPillSelectHidden ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'
        )}
          style={{
            left: `${pillSelectLeft}px`,
            top: '64px', // Position below pill (pill ends at ~63px, so 64px gives 1px gap, no overlap)
            transform: 'translateX(-50%)', // Center on calculated position
          }}
        onMouseEnter={() => {
          // Keep menu open while interacting with it; treat as still in the hover cluster
          setIsHoveringPillSelectArea(true)
          isHoveringPillSelectAreaRef.current = true
          if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current)
            hideTimeoutRef.current = null
          }
        }}
        onMouseLeave={(e) => {
          setIsHoveringPillSelectArea(false)
          isHoveringPillSelectAreaRef.current = false
          // Check if menu should hide after leaving menu
          checkAndHideMenu(e.relatedTarget as HTMLElement)
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
        />      </div>
      
      {/* Context menu for edit menu control */}
      {contextMenuPosition && (
        <div
          className="fixed z-50 bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] py-1 min-w-[180px]"
          style={{
            left: `${contextMenuPosition.x}px`,
            top: `${contextMenuPosition.y}px`,
            transform: 'translate(0, 0)', // Position bottom-right of cursor
            marginTop: '4px', // Small gap from cursor
            marginLeft: '4px', // Small gap from cursor
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-[#2f2f2f]">
            Edit bar control
          </div>
          <div className="py-1">
            <button
              onClick={() => {
                setEditMenuMode('shown')
                setContextMenuPosition(null)
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2a2a3a] flex items-center gap-2"
            >
              {editMenuMode === 'shown' && (
                <span className="w-1.5 h-1.5 rounded-full bg-gray-700 dark:bg-gray-300" />
              )}
              {editMenuMode !== 'shown' && <span className="w-1.5 h-1.5" />}
              <span>Shown</span>
            </button>
            <button
              onClick={() => {
                setEditMenuMode('hidden')
                setContextMenuPosition(null)
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2a2a3a] flex items-center gap-2"
            >
              {editMenuMode === 'hidden' && (
                <span className="w-1.5 h-1.5 rounded-full bg-gray-700 dark:bg-gray-300" />
              )}
              {editMenuMode !== 'hidden' && <span className="w-1.5 h-1.5" />}
              <span>Hidden</span>
            </button>
            <button
              onClick={() => {
                setEditMenuMode('hover')
                setContextMenuPosition(null)
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2a2a3a] flex items-center gap-2"
            >
              {editMenuMode === 'hover' && (
                <span className="w-1.5 h-1.5 rounded-full bg-gray-700 dark:bg-gray-300" />
              )}
              {editMenuMode !== 'hover' && <span className="w-1.5 h-1.5" />}
              <span>Show on hover</span>
            </button>
          </div>
        </div>
      )}

    </>
  )
}

