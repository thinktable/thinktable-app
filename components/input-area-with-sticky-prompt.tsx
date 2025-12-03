'use client'

// Client component wrapper for input area with edit panel
import { useState, useEffect } from 'react'
import { ChatInput } from './chat-input'
import { EditPanel } from './sticky-prompt-panel'
import { cn } from '@/lib/utils'
import { useReactFlowContext } from './react-flow-context'

export function InputAreaWithStickyPrompt({ conversationId }: { conversationId: string }) {
  const [inputHeight, setInputHeight] = useState(52) // Default height
  const [maxWidth, setMaxWidth] = useState(768) // Default max-w-3xl (768px)
  const [isCentered, setIsCentered] = useState(false) // Whether input should be centered
  const [leftGap, setLeftGap] = useState(112) // Dynamic left gap calculated from sidebar to minimap gap
  const [isHidden, setIsHidden] = useState(false) // Track if prompt box is hidden
  const [isHovering, setIsHovering] = useState(false) // Track if mouse is hovering over prompt box area
  const { setPanelWidth, setIsPromptBoxCentered } = useReactFlowContext() // Get setPanelWidth and setIsPromptBoxCentered to update panel width and centered state

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

  return (
    <>
      {/* Edit panel - always visible at top */}
      <EditPanel conversationId={conversationId} />
      
      {/* Hover zone below prompt box in map area - triggers pill visibility */}
      <div
        className="absolute left-0 right-0 pointer-events-auto"
        style={{
          bottom: '0px',
          height: '8px', // Just the gap between bottom edge and prompt box
          zIndex: 20, // Above the prompt box to capture hover
        }}
        onMouseEnter={() => {
          setIsHovering(true)
          // Dispatch event for minimap pill to also show
          window.dispatchEvent(new CustomEvent('bottom-gap-hover', { detail: { hovering: true } }))
        }}
        onMouseLeave={() => {
          setIsHovering(false)
          // Dispatch event for minimap pill to also hide
          window.dispatchEvent(new CustomEvent('bottom-gap-hover', { detail: { hovering: false } }))
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
            'pointer-events-auto transition-all duration-200 overflow-hidden',
            isHidden && 'opacity-0 h-0'
          )}
          style={{
            width: maxWidth > 0 ? `${maxWidth}px` : (isCentered ? 'calc(100% - 32px)' : 'calc(100% - 128px)'), // Width calculated based on centered state - 16px margins when centered (same as top bar)
            height: isHidden ? '0px' : 'auto',
          }}
        >
          <ChatInput conversationId={conversationId} onHeightChange={setInputHeight} />
        </div>
        
        {/* Thin pill toggle to show/hide prompt box - only visible on hover in map area below box, or when hidden */}
        <div 
          onClick={() => setIsHidden(!isHidden)}
          className={cn(
            'w-12 h-1.5 rounded-full cursor-pointer transition-all duration-200 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500 pointer-events-auto',
            isHidden ? 'mt-0' : 'mt-1.5',
            // Show pill when hovering in map area below box, or always show if box is hidden (so user can restore it)
            (isHovering || isHidden) ? 'opacity-100' : 'opacity-0'
          )}
          title={isHidden ? 'Show prompt' : 'Hide prompt'}
        />
      </div>
    </>
  )
}

