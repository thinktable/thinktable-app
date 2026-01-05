'use client'

// Client component wrapper for input area with edit panel
import { useState, useEffect, useRef, useCallback } from 'react'
import { ChatInput } from './chat-input'
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
  const [isHoveringTopBar, setIsHoveringTopBar] = useState(false) // Track if mouse is hovering over top bar
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null) // Track hover timeout for showing menu
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
  const { setPanelWidth, setIsPromptBoxCentered, editMenuPillMode, setEditMenuPillMode } = useReactFlowContext() // Get setPanelWidth, setIsPromptBoxCentered, and editMenuPillMode from context

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

  // Calculate prompt box center position for pill select alignment
  const [pillSelectLeft, setPillSelectLeft] = useState(0)
  const [pillSelectWidth, setPillSelectWidth] = useState(200) // Default width, will be measured
  const pillSelectRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    const calculatePillSelectPosition = () => {
      const reactFlowElement = document.querySelector('.react-flow')
      if (!reactFlowElement) return
      
      const mapAreaWidth = reactFlowElement.clientWidth
      
      if (isCentered) {
        // When centered, pill select should be at center of map area
        setPillSelectLeft(mapAreaWidth / 2)
      } else {
        // When left-aligned, pill select should be at center of prompt box
        // Prompt box center = leftGap + (maxWidth / 2)
        setPillSelectLeft(leftGap + (maxWidth / 2))
      }
    }
    
    calculatePillSelectPosition()
    window.addEventListener('resize', calculatePillSelectPosition)
    
    // Watch for sidebar state changes
    const sidebarElement = document.querySelector('[class*="w-16"], [class*="w-64"]') as HTMLElement
    const sidebarObserver = sidebarElement ? new MutationObserver(() => {
      calculatePillSelectPosition()
    }) : null
    
    if (sidebarObserver && sidebarElement) {
      sidebarObserver.observe(sidebarElement, {
        attributes: true,
        attributeFilter: ['class']
      })
    }
    
    return () => {
      window.removeEventListener('resize', calculatePillSelectPosition)
      if (sidebarObserver) sidebarObserver.disconnect()
    }
  }, [isCentered, leftGap, maxWidth])
  
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
    // Don't hide if mode is 'shown' or 'hidden' (only hide in 'hover' mode)
    if (editMenuMode !== 'hover') {
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
      
      // If moving to another related area, don't hide
      if (topBarElement || menuElement || hoverAreaElement) {
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
      
      // If menu was shown via hover and we're not in any related area, hide it (only in hover mode)
      if (wasShownViaHoverRef.current && 
          !isInAnyArea && 
          menuIsVisible &&
          editMenuMode === 'hover') {
        setIsPillSelectHidden(true)
        isPillSelectHiddenRef.current = true
        wasShownViaHoverRef.current = false
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
      
      {/* Hide pill - positioned outside hover zone to have its own stacking context, centered on edit menu top edge */}
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
          // If menu is hidden and mode is 'hover', show it after a short delay
          if (isPillSelectHidden && editMenuMode === 'hover') {
            hoverTimeoutRef.current = setTimeout(() => {
              setIsPillSelectHidden(false)
              isPillSelectHiddenRef.current = false
              wasShownViaHoverRef.current = true // Mark as shown via hover
            }, 100) // 100ms delay - quick response
          }
        }}
        onMouseLeave={(e) => {
          setIsHoveringPill(false)
          isHoveringPillRef.current = false
          // Clear any pending timeout
          if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current)
            hoverTimeoutRef.current = null
          }
          // Check if menu should hide after leaving pill
          checkAndHideMenu(e.relatedTarget as HTMLElement)
        }}
          className={cn(
          'absolute w-12 h-1.5 rounded-full cursor-pointer transition-all duration-200 bg-gray-300 dark:bg-gray-600 z-30',
          // Hide pill when menu is always shown (mode === 'shown'), show when hovering pill hover area or in hover/hidden mode
          (editMenuMode === 'shown' && !isHoveringPillSelectArea) ? 'opacity-0' : 'opacity-100'
        )}
        style={{
          left: `${pillSelectLeft}px`,
          top: '49px', // Center pill vertically on top bar bottom edge (top bar bottom at 52px, pill center at 52px = pill top at 49px, since pill is 6px tall)
          transform: 'translateX(-50%)', // Center on calculated position
        }}
        title={isPillSelectHidden ? 'Show mode selector' : 'Hide mode selector'}
      />
      
      {/* Floating pill select - centered to prompt box, below top bar - fades in/out */}
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
          // When entering pill select menu, don't mark hover area as active (so pill doesn't show)
          // But cancel any pending hide timeout to keep menu open
          if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current)
            hideTimeoutRef.current = null
          }
        }}
        onMouseLeave={(e) => {
          // Check if menu should hide after leaving menu
          checkAndHideMenu(e.relatedTarget as HTMLElement)
        }}
      >
        <PillSelect
          options={[
            { value: 'home', label: 'Home' },
            { value: 'insert', label: 'Insert' },
            { value: 'draw', label: 'Draw' },
            { value: 'view', label: 'View' },
          ]}
          value={editMenuPillMode}
          onChange={(value) => {
            // Update mode when pill select changes - updates context shared with EditorToolbar
            setEditMenuPillMode(value as 'home' | 'insert' | 'draw' | 'view')
          }}
        />
      </div>
      
      {/* Hover zone below prompt box in map area - triggers pill visibility, constrained to prompt box width */}
      {/* Split into two zones: one for hover detection, one that allows clicks through to pill */}
      <div
        className={`absolute pointer-events-auto ${isCentered ? 'left-1/2 -translate-x-1/2' : ''}`}
        style={{
          bottom: '0px',
          height: '20px', // Increased height for easier hovering
          zIndex: 15, // Below pill to allow clicks through
          cursor: 'default', // Default cursor - will be overridden to pointer when over pill
          // Position and width to match prompt box
          ...(isCentered ? {} : { left: `${leftGap}px` }), // Match prompt box left position when not centered
          width: maxWidth > 0 ? `${maxWidth}px` : (isCentered ? 'calc(100% - 32px)' : 'calc(100% - 128px)'), // Match prompt box width
        }}
        onMouseMove={(e) => {
          // Check if mouse is over the pill and set cursor accordingly
          const pill = document.querySelector('[title*="prompt"]') as HTMLElement
          if (pill) {
            const pillRect = pill.getBoundingClientRect()
            const mouseX = e.clientX
            const mouseY = e.clientY
            if (mouseX >= pillRect.left && mouseX <= pillRect.right && 
                mouseY >= pillRect.top && mouseY <= pillRect.bottom) {
              // Mouse is over pill - set pointer cursor
              e.currentTarget.style.cursor = 'pointer'
            } else {
              // Mouse is not over pill - set default cursor
              e.currentTarget.style.cursor = 'default'
            }
          }
        }}
        onContextMenu={(e) => {
          // Check if right-click is over the pill area (by coordinates, not target)
          const pill = promptPillRef.current
          if (pill) {
            const pillRect = pill.getBoundingClientRect()
            const clickX = e.clientX
            const clickY = e.clientY
            if (clickX >= pillRect.left && clickX <= pillRect.right && 
                clickY >= pillRect.top && clickY <= pillRect.bottom) {
              // Right-click is over pill - manually trigger the context menu
              e.preventDefault()
              e.stopPropagation()
              setPromptContextMenuPosition({ x: clickX, y: clickY })
              return
            }
          }
          
          // If not over pill, prevent default context menu
          e.preventDefault()
        }}
        onMouseEnter={(e) => {
          // Set hover state for hover area
          setIsHoveringPromptHoverArea(true)
          isHoveringPromptHoverAreaRef.current = true
          
          // Clear any pending hide timeout and reset hiding flag
          if (promptHideTimeoutRef.current) {
            clearTimeout(promptHideTimeoutRef.current)
            promptHideTimeoutRef.current = null
          }
          isPromptHidingRef.current = false
          setIsPromptFadingOut(false) // Cancel fade-out if in progress
          
          // If prompt box is hidden and mode is 'hover', show it after a short delay
          if (isHidden && promptMode === 'hover') {
            // Reset fade-out state to allow fade-in
            setIsPromptFadingOut(false)
            setTimeout(() => {
              if (isHidden && promptMode === 'hover') {
                setIsHidden(false)
      setIsPromptFadingOut(false) // Reset fade-out state when showing
              }
            }, 100) // 100ms delay - quick response
          }
        }}
        onMouseLeave={() => {
          // Clear hover state for hover area
          setIsHoveringPromptHoverArea(false)
          isHoveringPromptHoverAreaRef.current = false
          
          // Check if should hide prompt box
          checkAndHidePromptBox()
        }}
        onClick={(e) => {
          // If click is on the pill area, let it pass through
          const pill = document.querySelector('[title*="prompt"]') as HTMLElement
          if (pill) {
            const pillRect = pill.getBoundingClientRect()
            const clickX = e.clientX
            const clickY = e.clientY
            if (clickX >= pillRect.left && clickX <= pillRect.right && 
                clickY >= pillRect.top && clickY <= pillRect.bottom) {
              e.stopPropagation()
              pill.click()
            }
          }
        }}
      />
      
      {/* Input box overlay at bottom */}
      <div 
        className={`absolute bottom-0 pointer-events-none z-10 flex flex-col items-center ${isCentered ? 'left-1/2 -translate-x-1/2' : ''}`}
        style={{
          ...(isCentered ? {} : { left: `${leftGap}px` }), // Dynamic left gap calculated from sidebar to minimap gap
          bottom: '8px', // Reduced to make room for toggle pill
        }}
      >
        <div 
          className={cn(
            'pointer-events-auto transition-all duration-200 overflow-hidden shadow-sm rounded-[26px]',
            (isHidden || isPromptFadingOut) && 'opacity-0',
            isHidden && 'h-0'
          )}
          style={{
            width: maxWidth > 0 ? `${maxWidth}px` : (isCentered ? 'calc(100% - 32px)' : 'calc(100% - 128px)'), // Width calculated based on centered state - 16px margins when centered (same as top bar)
            height: isHidden ? '0px' : 'auto',
          }}
          onMouseEnter={() => {
            // Set hover state for prompt box
            setIsHoveringPromptBox(true)
            isHoveringPromptBoxRef.current = true
            
            // Clear any pending hide timeout and reset hiding flag
            if (promptHideTimeoutRef.current) {
              clearTimeout(promptHideTimeoutRef.current)
              promptHideTimeoutRef.current = null
            }
            isPromptHidingRef.current = false
          }}
          onMouseLeave={() => {
            // Clear hover state for prompt box
            setIsHoveringPromptBox(false)
            isHoveringPromptBoxRef.current = false
            
            // Check if should hide prompt box
            checkAndHidePromptBox()
          }}
        >
          <ChatInput conversationId={conversationId} onHeightChange={setInputHeight} />
        </div>
        
        {/* Thin pill toggle to show/hide prompt box - only visible on hover in map area below box, or when hidden */}
        <div 
          ref={promptPillRef}
          data-prompt-pill-context
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setPromptContextMenuPosition({ x: e.clientX, y: e.clientY })
          }}
          onClick={() => {
            // Toggle between 'shown' and 'hidden' by default
            // If in 'hover' mode, clicking pill changes it to 'shown'
            if (promptMode === 'shown') {
              setPromptMode('hidden') // Toggle to hidden
            } else if (promptMode === 'hidden') {
              setPromptMode('shown') // Toggle to shown
            } else { // promptMode === 'hover'
              setPromptMode('shown') // If in hover mode, click makes it shown
              setIsHidden(false)
              setIsPromptFadingOut(false)
            }
          }}
          onMouseEnter={() => {
            // Set hover state for pill
            setIsHoveringPromptPill(true)
            isHoveringPromptPillRef.current = true
            
            // Clear any pending hide timeout and reset hiding flag
            if (promptHideTimeoutRef.current) {
              clearTimeout(promptHideTimeoutRef.current)
              promptHideTimeoutRef.current = null
            }
            isPromptHidingRef.current = false
            
            // If prompt box is hidden and mode is 'hover', show it after a short delay
            if (isHidden && promptMode === 'hover') {
              setTimeout(() => {
                if (isHidden && promptMode === 'hover') {
                  setIsHidden(false)
      setIsPromptFadingOut(false) // Reset fade-out state when showing
                }
              }, 100) // 100ms delay - quick response
            }
          }}
          onMouseLeave={() => {
            // Clear hover state for pill
            setIsHoveringPromptPill(false)
            isHoveringPromptPillRef.current = false
            
            // Check if should hide prompt box
            checkAndHidePromptBox()
          }}
          className={cn(
            'w-12 h-1.5 rounded-full cursor-pointer transition-all duration-200 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500 pointer-events-auto relative',
            isHidden ? 'mt-0' : 'mt-1.5',
            // Show pill based on mode:
            // - In 'shown' mode: only show when hovering pill hover area (not prompt box) or when hidden
            // - In 'hover' mode: 
            //   * Always show when hidden (so user can restore it) - pill should not fade out when prompt box hides
            //   * Show when hovering any prompt-related area (box, pill, or hover area) when prompt box is visible
            //   * Show when in the process of hiding (to prevent flicker during transition)
            //   * Fade out when prompt box is visible and not hovering any area
            (promptMode === 'shown' 
              ? (isHoveringPromptHoverArea || isHidden)
              : (isHidden || isPromptHidingRef.current || isHoveringPromptBox || isHoveringPromptPill || isHoveringPromptHoverArea)
            ) ? 'opacity-100' : 'opacity-0'
          )}
          style={{
            zIndex: 30, // Higher than hover zone (z-15) to ensure clicks and hover work
          }}
          title={isHidden ? 'Show prompt' : 'Hide prompt'}
        />
      </div>

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

      {/* Context menu for prompt control */}
      {promptContextMenuPosition && (
        <div
          className="fixed z-50 bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] py-1 min-w-[180px]"
          style={{
            left: `${promptContextMenuPosition.x}px`,
            top: `${promptContextMenuPosition.y}px`,
            transform: 'translate(0, -100%)', // Position top-right of cursor
            marginTop: '-4px', // Small gap from cursor
            marginLeft: '4px', // Small gap from cursor
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-[#2f2f2f]">
            Prompt control
          </div>
          <div className="py-1">
            <button
              onClick={() => {
                setPromptMode('shown')
                setPromptContextMenuPosition(null)
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2a2a3a] flex items-center gap-2"
            >
              {promptMode === 'shown' && (
                <span className="w-1.5 h-1.5 rounded-full bg-gray-700 dark:bg-gray-300" />
              )}
              {promptMode !== 'shown' && <span className="w-1.5 h-1.5" />}
              <span>Shown</span>
            </button>
            <button
              onClick={() => {
                setPromptMode('hidden')
                // Immediately hide the prompt box
                setIsHidden(true)
                setPromptContextMenuPosition(null)
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2a2a3a] flex items-center gap-2"
            >
              {promptMode === 'hidden' && (
                <span className="w-1.5 h-1.5 rounded-full bg-gray-700 dark:bg-gray-300" />
              )}
              {promptMode !== 'hidden' && <span className="w-1.5 h-1.5" />}
              <span>Hidden</span>
            </button>
            <button
              onClick={() => {
                setPromptMode('hover')
                setPromptContextMenuPosition(null)
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2a2a3a] flex items-center gap-2"
            >
              {promptMode === 'hover' && (
                <span className="w-1.5 h-1.5 rounded-full bg-gray-700 dark:bg-gray-300" />
              )}
              {promptMode !== 'hover' && <span className="w-1.5 h-1.5" />}
              <span>Show on hover</span>
            </button>
          </div>
        </div>
      )}
    </>
  )
}

