'use client'

// Left vertical menu - calendar and quiz buttons with collapse pill on sidebar right edge
import { useState, useEffect, useRef, useCallback } from 'react'
import { Calendar, HelpCircle, WalletCards, Shuffle } from 'lucide-react'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

interface LeftVerticalMenuProps {
  studySetId?: string
  conversationId?: string
}

export function LeftVerticalMenu({ studySetId, conversationId }: LeftVerticalMenuProps) {
  const [isMounted, setIsMounted] = useState(false) // Track if component has mounted (to prevent hydration mismatch)
  const [isHidden, setIsHidden] = useState(false) // Track if menu is hidden
  const [isHovering, setIsHovering] = useState(false) // Track if mouse is hovering over pill
  const [isHoveringMenu, setIsHoveringMenu] = useState(false) // Track if mouse is hovering over menu
  const [isHoveringPill, setIsHoveringPill] = useState(false) // Track if mouse is hovering over pill
  const [menuMode, setMenuMode] = useState<'shown' | 'hidden' | 'hover'>('hover') // Menu visibility mode
  const [selectedMode, setSelectedMode] = useState<'quiz' | 'flashcard'>('flashcard') // Track which mode is selected (defaults to flashcard)
  const [isCalendarOpen, setIsCalendarOpen] = useState(false) // Track if calendar dialog is open
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null) // Track hide timeout
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null) // Track hover timeout
  const isHoveringRef = useRef(false) // Ref to track hover state for reliable checking
  const menuRef = useRef<HTMLDivElement | null>(null) // Ref to menu element
  const pillRef = useRef<HTMLDivElement | null>(null) // Ref to pill element

  // Mark component as mounted after first render (client-side only)
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Load menu mode from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('thinkable-left-menu-mode')
      if (saved === 'shown' || saved === 'hidden' || saved === 'hover') {
        setMenuMode(saved)
        if (saved === 'hidden') {
          setIsHidden(true)
        } else if (saved === 'shown') {
          setIsHidden(false)
        }
      }
    }
  }, [])

  // Save menu mode to localStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('thinkable-left-menu-mode', menuMode)
    }
  }, [menuMode])

  // Sync menu visibility with mode
  useEffect(() => {
    if (menuMode === 'shown') {
      setIsHidden(false)
    } else if (menuMode === 'hidden') {
      setIsHidden(true)
    } else {
      // Hover mode - show on hover, hide otherwise
      if (!isHovering && !isHoveringMenu && !isHoveringPill) {
        setIsHidden(true)
      }
    }
  }, [menuMode, isHovering, isHoveringMenu, isHoveringPill])

  // Function to check if menu should be hidden
  const checkAndHideMenu = useCallback((relatedTarget?: HTMLElement | null) => {
    // Don't hide if mode is 'shown' or 'hidden' (only hide in 'hover' mode)
    if (menuMode !== 'hover') {
      return
    }

    // Clear any existing hide timeout
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }

    // Check if relatedTarget is still in menu or pill area
    if (relatedTarget && relatedTarget instanceof HTMLElement) {
      const menuElement = relatedTarget.closest('[data-left-menu-context]')
      const pillElement = relatedTarget.closest('[data-left-menu-pill-context]')

      // If moving to another related area, don't hide
      if (menuElement || pillElement) {
        return
      }
    }

    // Small delay to allow transition between areas
    hideTimeoutRef.current = setTimeout(() => {
      // Re-check ref at timeout execution time
      const isInAnyArea = isHoveringRef.current

      // If menu is shown and we're not in any related area, hide it
      if (!isHidden && !isInAnyArea && menuMode === 'hover') {
        setIsHidden(true)
      }
    }, 200) // Slight delay to allow moving between areas
  }, [menuMode, isHidden])

  // Keep ref in sync with state
  useEffect(() => {
    isHoveringRef.current = isHovering || isHoveringMenu || isHoveringPill
  }, [isHovering, isHoveringMenu, isHoveringPill])

  // Calculate sidebar width to position menu - get actual sidebar right edge position relative to viewport (for fixed positioning)
  const [sidebarRightEdge, setSidebarRightEdge] = useState(256) // Default expanded sidebar width (w-64 = 256px)

  useEffect(() => {
    // Only update after mount to prevent hydration mismatch
    if (!isMounted) return

    const updateSidebarRightEdge = () => {
      // Find the actual sidebar element and get its right edge position relative to viewport (for fixed positioning)
      const sidebarElement = document.querySelector('[class*="w-16"], [class*="w-64"]') as HTMLElement
      if (sidebarElement) {
        const rect = sidebarElement.getBoundingClientRect()
        // Use viewport-relative position (rect.right) for fixed positioning
        setSidebarRightEdge(rect.right)
      } else {
        // Fallback: use class-based calculation (assume expanded by default)
        setSidebarRightEdge(256)
      }
    }

    updateSidebarRightEdge()
    window.addEventListener('resize', updateSidebarRightEdge)

    // Watch for sidebar state changes
    const sidebarElement = document.querySelector('[class*="w-16"], [class*="w-64"]') as HTMLElement
    const sidebarObserver = sidebarElement ? new MutationObserver(() => {
      updateSidebarRightEdge()
    }) : null

    if (sidebarObserver && sidebarElement) {
      sidebarObserver.observe(sidebarElement, {
        attributes: true,
        attributeFilter: ['class']
      })
    }

    // Also use ResizeObserver for more accurate tracking
    const resizeObserver = sidebarElement ? new ResizeObserver(() => {
      updateSidebarRightEdge()
    }) : null

    if (resizeObserver && sidebarElement) {
      resizeObserver.observe(sidebarElement)
    }

    return () => {
      window.removeEventListener('resize', updateSidebarRightEdge)
      if (sidebarObserver) sidebarObserver.disconnect()
      if (resizeObserver) resizeObserver.disconnect()
    }
  }, [isMounted])

  // Handle calendar button click - open calendar dialog
  const handleCalendarClick = () => {
    setIsCalendarOpen(true)
  }

  // Handle quiz button click - switch to quiz mode (radio behavior)
  const handleQuizClick = () => {
    if (selectedMode !== 'quiz') {
      setSelectedMode('quiz')
    }
    // TODO: Implement quiz functionality
    console.log('Quiz mode selected')
  }

  // Handle flashcard button click - switch to flashcard mode (radio behavior)
  const handleFlashcardClick = () => {
    if (selectedMode !== 'flashcard') {
      setSelectedMode('flashcard')
    }
    // TODO: Implement flashcard functionality
    console.log('Flashcard mode selected')
  }

  // Handle shuffle button click - just a button, no toggle
  const handleShuffleClick = () => {
    // TODO: Implement shuffle functionality
    console.log('Shuffle clicked')
  }

  const menuItemSize = 32 // Size of each circular button (w-8 h-8 = 32px, smaller than edit menu buttons)
  const menuGap = 4 // Gap between items (same as edit menu gap: gap-0.5 = 4px, applies to all flex children)
  const dividerHeight = 1 // Height of divider line
  // Total height: 4 buttons + 2 dividers + 5 gaps (between 6 items: button, divider, button, button, divider, button)
  const menuTotalHeight = (menuItemSize * 4) + (dividerHeight * 2) + (menuGap * 5)
  const pillHeight = 48 // Pill height matches edit menu pill width (w-12 = 48px)

  // Calculate pill position to center it vertically in the window
  // Initialize with consistent value to prevent hydration mismatch
  const [windowHeight, setWindowHeight] = useState(800) // Default value, updated after mount

  useEffect(() => {
    // Only update after mount to prevent hydration mismatch
    if (!isMounted) return

    const updateWindowHeight = () => {
      setWindowHeight(window.innerHeight)
    }

    updateWindowHeight()
    window.addEventListener('resize', updateWindowHeight)

    return () => {
      window.removeEventListener('resize', updateWindowHeight)
    }
  }, [isMounted])

  // Center pill vertically in window: (window height / 2) - (pill height / 2)
  // Use consistent calculation that matches server-side initial render
  const pillTop = isMounted ? (windowHeight / 2) - (pillHeight / 2) : 376 // Default to match server-side initial value

  return (
    <>
      {/* Vertical menu - positioned on left side, aligned with sidebar right edge */}
      <div
        ref={menuRef}
        data-left-menu-context
        className={cn(
          'fixed z-[60] transition-opacity duration-200 flex flex-col gap-0.5 px-1 py-1 rounded-full bg-blue-50 dark:bg-[#2a2a3a] shadow-sm',
          isHidden ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'
        )}
        style={{
          left: `${sidebarRightEdge + 12}px`, // Position with 12px gap from sidebar right edge (viewport-relative for fixed positioning)
          top: `${pillTop + (pillHeight / 2) - (menuTotalHeight / 2)}px`, // Center menu vertically with pill (viewport-relative)
        }}
        onMouseEnter={() => {
          setIsHoveringMenu(true)
          isHoveringRef.current = true
          // Cancel any pending hide timeout
          if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current)
            hideTimeoutRef.current = null
          }
        }}
        onMouseLeave={(e) => {
          setIsHoveringMenu(false)
          // Check if menu should hide after leaving menu
          checkAndHideMenu(e.relatedTarget as HTMLElement)
        }}
      >
        {/* Calendar button - circular white like edit menu */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleCalendarClick}
          className={cn(
            'w-8 h-8 rounded-full bg-transparent text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-white transition-all duration-200',
            'flex items-center justify-center'
          )}
          title="Calendar"
        >
          <Calendar className="h-4 w-4" />
        </Button>

        {/* Divider above flashcard button */}
        <div className="h-px bg-gray-300 dark:bg-gray-600 mx-2" />

        {/* Flashcard button - toggle with quiz, shows white background only when selected */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleFlashcardClick}
          className={cn(
            'w-8 h-8 rounded-full text-gray-700 dark:text-gray-300 transition-all duration-200',
            'flex items-center justify-center',
            selectedMode === 'flashcard'
              ? 'bg-white dark:bg-white hover:bg-white dark:hover:bg-white' // White background when selected, stays white on hover
              : 'bg-transparent hover:bg-transparent dark:hover:bg-transparent' // Transparent normally and on hover when not selected
          )}
          title="Flashcard"
        >
          <WalletCards className="h-4 w-4" />
        </Button>

        {/* Quiz button - toggle with flashcard, shows white background only when selected */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleQuizClick}
          className={cn(
            'w-8 h-8 rounded-full text-gray-700 dark:text-gray-300 transition-all duration-200',
            'flex items-center justify-center',
            selectedMode === 'quiz'
              ? 'bg-white dark:bg-white hover:bg-white dark:hover:bg-white' // White background when selected, stays white on hover
              : 'bg-transparent hover:bg-transparent dark:hover:bg-transparent' // Transparent normally and on hover when not selected
          )}
          title="Quiz"
        >
          <HelpCircle className="h-4 w-4" />
        </Button>

        {/* Divider above shuffle button */}
        <div className="h-px bg-gray-300 dark:bg-gray-600 mx-2" />

        {/* Shuffle button - circular white like edit menu */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleShuffleClick}
          className={cn(
            'w-8 h-8 rounded-full bg-transparent text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-white transition-all duration-200',
            'flex items-center justify-center'
          )}
          title="Shuffle"
        >
          <Shuffle className="h-4 w-4" />
        </Button>
      </div>

      {/* Collapse pill on sidebar right edge - vertical pill, centered on edge */}
      <div
        ref={pillRef}
        data-left-menu-pill-context
        onClick={() => {
          // Toggle between 'shown' and 'hover' modes
          if (menuMode === 'shown') {
            setMenuMode('hover')
          } else if (menuMode === 'hover') {
            setMenuMode('shown')
          } else {
            // If mode is 'hidden', switch to 'shown' and immediately show menu
            setMenuMode('shown')
            setIsHidden(false)
          }
        }}
        onMouseEnter={() => {
          setIsHoveringPill(true)
          isHoveringRef.current = true
          // Cancel any pending hide timeout
          if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current)
            hideTimeoutRef.current = null
          }
          // If menu is hidden and mode is 'hover', show it after a short delay
          if (isHidden && menuMode === 'hover') {
            hoverTimeoutRef.current = setTimeout(() => {
              if (isHidden && menuMode === 'hover') {
                setIsHidden(false)
              }
            }, 100) // 100ms delay - quick response
          }
        }}
        onMouseLeave={(e) => {
          setIsHoveringPill(false)
          // Clear any pending timeout
          if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current)
            hoverTimeoutRef.current = null
          }
          // Check if menu should hide after leaving pill
          checkAndHideMenu(e.relatedTarget as HTMLElement)
        }}
        className={cn(
          'fixed z-[60] w-1.5 rounded-full cursor-pointer transition-all duration-200 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500',
          // Show pill when hovering on it, or always show if menu is hidden (so user can restore it)
          (isHoveringPill || isHidden) ? 'opacity-100' : 'opacity-0'
        )}
        style={{
          left: `${sidebarRightEdge}px`, // Position at sidebar right edge (viewport-relative for fixed positioning)
          top: `${pillTop}px`, // Center pill vertically in window (viewport-relative)
          height: `${pillHeight}px`, // Height to span both buttons + gap (matches menu height = 88px)
          transform: 'translateX(-50%)', // Center the pill horizontally on the sidebar edge (pill width is 1.5px, so this centers it perfectly on the edge)
        }}
        title={isHidden ? 'Show menu' : 'Hide menu'}
      />

      {/* Hover zone between sidebar and menu - triggers menu visibility, centered vertically with pill */}
      <div
        className="fixed pointer-events-auto"
        style={{
          left: `${sidebarRightEdge}px`, // Start at sidebar right edge (viewport-relative for fixed positioning)
          top: `${pillTop}px`, // Match pill vertical position (viewport-relative)
          width: `${12 + menuItemSize + 8}px`, // Hover zone width (extends from sidebar edge through gap to menu)
          height: `${pillHeight}px`, // Match pill height
          zIndex: 55, // Above sidebar (z-50) but below pill (z-60) to allow clicks through
        }}
        onMouseEnter={() => {
          setIsHovering(true)
          isHoveringRef.current = true
          // Clear any pending hide timeout
          if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current)
            hideTimeoutRef.current = null
          }
          // If menu is hidden and mode is 'hover', show it after a short delay
          if (isHidden && menuMode === 'hover') {
            hoverTimeoutRef.current = setTimeout(() => {
              if (isHidden && menuMode === 'hover') {
                setIsHidden(false)
              }
            }, 100) // 100ms delay - quick response
          }
        }}
        onMouseLeave={(e) => {
          setIsHovering(false)
          // Clear any pending timeout
          if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current)
            hoverTimeoutRef.current = null
          }
          // Check if menu should hide after leaving hover zone
          checkAndHideMenu(e.relatedTarget as HTMLElement)
        }}
      />

      {/* Calendar Dialog */}
      <Dialog open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Calendar</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            {/* TODO: Implement full calendar component */}
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Calendar view coming soon
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

