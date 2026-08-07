'use client'

// Flashcard study menu — centered at bottom of map with open/close pill
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
import { useUserPreference } from '@/lib/hooks/use-user-preferences'
import { createClient } from '@/lib/supabase/client'

interface LeftVerticalMenuProps {
  studySetId?: string
  conversationId?: string
}

export function LeftVerticalMenu({ studySetId, conversationId }: LeftVerticalMenuProps) {
  const [isMounted, setIsMounted] = useState(false) // Track if component has mounted (to prevent hydration mismatch)
  const [isHidden, setIsHidden] = useState(false) // Track if menu is hidden
  const [isHovering, setIsHovering] = useState(false) // Track if mouse is hovering over hover zone
  const [isHoveringMenu, setIsHoveringMenu] = useState(false) // Track if mouse is hovering over menu
  const [isHoveringPill, setIsHoveringPill] = useState(false) // Track if mouse is hovering over pill
  // Menu visibility mode: 'shown' | 'hidden' | 'hover'
  const supabaseForMenu = createClient() // Create Supabase client for useUserPreference
  const { mode: menuMode, setMode: setMenuMode, isLoading: isLoadingMenuMode } = useUserPreference(supabaseForMenu, 'menuMode', 'shown')
  const [selectedMode, setSelectedMode] = useState<'quiz' | 'flashcard'>('flashcard') // Radio toggle - one always selected
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

  // Sync menu visibility with mode (only after loading is complete)
  useEffect(() => {
    if (isLoadingMenuMode) return // Don't apply mode while loading

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
  }, [menuMode, isHovering, isHoveringMenu, isHoveringPill, isLoadingMenuMode])

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
      const isInAnyArea = isHoveringRef.current
      if (!isHidden && !isInAnyArea && menuMode === 'hover') {
        setIsHidden(true)
      }
    }, 200)
  }, [menuMode, isHidden])

  // Keep ref in sync with state
  useEffect(() => {
    isHoveringRef.current = isHovering || isHoveringMenu || isHoveringPill
  }, [isHovering, isHoveringMenu, isHoveringPill])

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

  // Handle shuffle button click
  const handleShuffleClick = () => {
    // TODO: Implement shuffle functionality
    console.log('Shuffle clicked')
  }

  const pillBottom = 10 // px from bottom of map — open/close pill
  const menuBottom = 22 // px — menu sits above the pill (mirrors top-bar layout)

  // Avoid SSR/client flash before mount
  if (!isMounted) return null

  return (
    <>
      {/* Horizontal flashcard menu — centered at bottom of map */}
      <div
        ref={menuRef}
        data-left-menu-context
        className={cn(
          'absolute z-[60] left-1/2 -translate-x-1/2 transition-opacity duration-200 flex flex-row items-center gap-0.5 px-1 py-1 rounded-full bg-blue-50 dark:bg-[#2a2a3a] shadow-sm',
          isHidden ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'
        )}
        style={{ bottom: `${menuBottom}px` }}
        onMouseEnter={() => {
          setIsHoveringMenu(true)
          isHoveringRef.current = true
          if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current)
            hideTimeoutRef.current = null
          }
        }}
        onMouseLeave={(e) => {
          setIsHoveringMenu(false)
          checkAndHideMenu(e.relatedTarget as HTMLElement)
        }}
      >
        {/* Calendar button */}
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

        {/* Divider */}
        <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-0.5" />

        {/* Flashcard button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleFlashcardClick}
          className={cn(
            'w-8 h-8 rounded-full text-gray-700 dark:text-gray-300 transition-all duration-200',
            'flex items-center justify-center',
            selectedMode === 'flashcard'
              ? 'bg-white dark:bg-white hover:bg-white dark:hover:bg-white'
              : 'bg-transparent hover:bg-transparent dark:hover:bg-transparent'
          )}
          title="Flashcard"
        >
          <WalletCards className="h-4 w-4" />
        </Button>

        {/* Quiz button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleQuizClick}
          className={cn(
            'w-8 h-8 rounded-full text-gray-700 dark:text-gray-300 transition-all duration-200',
            'flex items-center justify-center',
            selectedMode === 'quiz'
              ? 'bg-white dark:bg-white hover:bg-white dark:hover:bg-white'
              : 'bg-transparent hover:bg-transparent dark:hover:bg-transparent'
          )}
          title="Quiz"
        >
          <HelpCircle className="h-4 w-4" />
        </Button>

        {/* Divider */}
        <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-0.5" />

        {/* Shuffle button */}
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

      {/* Open/close pill — centered under menu at bottom edge */}
      <div
        ref={pillRef}
        data-left-menu-pill-context
        onClick={() => {
          if (menuMode === 'shown') {
            setMenuMode('hidden')
          } else if (menuMode === 'hidden') {
            setMenuMode('shown')
          } else {
            setMenuMode('shown')
            setIsHidden(false)
          }
        }}
        onMouseEnter={() => {
          setIsHoveringPill(true)
          isHoveringRef.current = true
          if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current)
            hideTimeoutRef.current = null
          }
          if (isHidden && menuMode === 'hover') {
            hoverTimeoutRef.current = setTimeout(() => {
              if (isHidden && menuMode === 'hover') {
                setIsHidden(false)
              }
            }, 100)
          }
        }}
        onMouseLeave={(e) => {
          setIsHoveringPill(false)
          if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current)
            hoverTimeoutRef.current = null
          }
          checkAndHideMenu(e.relatedTarget as HTMLElement)
        }}
        className={cn(
          'absolute z-[60] left-1/2 -translate-x-1/2 w-12 h-1.5 rounded-full cursor-pointer transition-all duration-200 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500',
          (isHoveringPill || isHidden) ? 'opacity-100' : 'opacity-0'
        )}
        style={{ bottom: `${pillBottom}px` }}
        title={isHidden ? 'Show menu' : 'Hide menu'}
      />

      {/* Hover zone above the pill — reveals menu in hover mode */}
      <div
        className="absolute left-1/2 -translate-x-1/2 pointer-events-auto"
        style={{
          bottom: `${pillBottom}px`,
          width: '160px',
          height: `${menuBottom - pillBottom + 40}px`, // Covers pill + gap + menu band
          zIndex: 55,
        }}
        onMouseEnter={() => {
          setIsHovering(true)
          isHoveringRef.current = true
          if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current)
            hideTimeoutRef.current = null
          }
          if (isHidden && menuMode === 'hover') {
            hoverTimeoutRef.current = setTimeout(() => {
              if (isHidden && menuMode === 'hover') {
                setIsHidden(false)
              }
            }, 100)
          }
        }}
        onMouseLeave={(e) => {
          setIsHovering(false)
          if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current)
            hoverTimeoutRef.current = null
          }
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
