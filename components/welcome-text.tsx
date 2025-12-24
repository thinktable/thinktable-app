'use client'

// Welcome text component that disappears when first panel is placed
import { useReactFlowContext } from './react-flow-context'
import { useEffect, useState } from 'react'

export function WelcomeText() {
  const { reactFlowInstance, isPromptBoxCentered, panelWidth } = useReactFlowContext()
  const [showWelcome, setShowWelcome] = useState(true)
  const [leftGap, setLeftGap] = useState(112) // Dynamic left gap calculated from sidebar to minimap gap
  
  // Phrases to rotate through
  const phrases = [
    'Welcome to Thinkable!',
    'Think outside the box.',
    'Do the unthinkable!',
    'Think for yourself.',
  ]
  const [currentPhraseIndex, setCurrentPhraseIndex] = useState(0)

  useEffect(() => {
    if (!reactFlowInstance) return

    // Check if there are any nodes (panels)
    const checkForPanels = () => {
      try {
        const nodes = reactFlowInstance.getNodes()
        const hasPanels = nodes && nodes.length > 0
        setShowWelcome(!hasPanels)
      } catch (error) {
        // If getNodes fails, assume no panels yet
        setShowWelcome(true)
      }
    }

    // Check initially
    checkForPanels()

    // Listen for node changes by polling (React Flow doesn't expose node change events easily)
    // Poll every 200ms to detect when panels are added
    const intervalId = setInterval(checkForPanels, 200)

    return () => {
      clearInterval(intervalId)
    }
  }, [reactFlowInstance])

  // Set a random phrase index on mount/reload (only rotates on reload)
  useEffect(() => {
    if (!showWelcome) return
    // Pick a random phrase index on mount
    setCurrentPhraseIndex(Math.floor(Math.random() * phrases.length))
  }, []) // Only run on mount/reload

  // Calculate left gap same as prompt box (for left-aligned positioning)
  useEffect(() => {
    const calculateLeftGap = () => {
      const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
      if (!reactFlowElement) return

      const expandedSidebarWidth = 256 // w-64 when expanded
      const collapsedSidebarWidth = 64 // w-16 when collapsed
      const minimapWidth = 179 // Minimap width from CSS
      const minimapMargin = 15 // Margin from right edge
      const promptBoxMaxWidth = 768 // Max width of prompt box

      // Detect current sidebar state
      const sidebarElement = document.querySelector('[class*="w-16"], [class*="w-64"]') as HTMLElement
      const isSidebarExpanded = sidebarElement?.classList.contains('w-64') ?? false
      const currentSidebarWidth = isSidebarExpanded ? expandedSidebarWidth : collapsedSidebarWidth

      // Calculate map area width with current sidebar state
      const fullWindowWidth = window.screen.width
      const fullMapAreaWidth = fullWindowWidth - currentSidebarWidth

      // Calculate gap from sidebar right edge (0px) to minimap left edge
      const minimapLeftEdge = fullMapAreaWidth - minimapWidth - minimapMargin
      const gapFromSidebarToMinimap = minimapLeftEdge - 0

      // Calculate left gap: (1/2) * (gap from sidebar to minimap - prompt box width)
      const calculatedLeftGap = Math.max(0, (1/2) * (gapFromSidebarToMinimap - promptBoxMaxWidth))
      setLeftGap(calculatedLeftGap)
    }

    calculateLeftGap()
    window.addEventListener('resize', calculateLeftGap)

    // Watch for sidebar state changes
    const sidebarElement = document.querySelector('[class*="w-16"], [class*="w-64"]') as HTMLElement
    const sidebarObserver = sidebarElement ? new MutationObserver(() => {
      calculateLeftGap()
    }) : null

    if (sidebarObserver && sidebarElement) {
      sidebarObserver.observe(sidebarElement, {
        attributes: true,
        attributeFilter: ['class']
      })
    }

    return () => {
      window.removeEventListener('resize', calculateLeftGap)
      if (sidebarObserver) sidebarObserver.disconnect()
    }
  }, [])

  if (!showWelcome) return null

  // Use same width as prompt box
  const welcomeWidth = panelWidth > 0 ? panelWidth : 768

  return (
    <div 
      className="absolute inset-0 flex items-center pointer-events-none z-[5]"
      style={{
        ...(isPromptBoxCentered 
          ? { 
              left: '50%', 
              transform: 'translateX(-50%)',
              width: `${welcomeWidth}px`,
              maxWidth: 'calc(100% - 32px)', // 16px margin on each side
            }
          : { 
              left: `${leftGap}px`,
              width: `${welcomeWidth}px`,
              maxWidth: `calc(100% - ${leftGap + 16}px)`, // 16px right margin
            }
        ),
      }}
    >
      <div className="text-center w-full">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-4">
          {phrases[currentPhraseIndex]}
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-400">
          Start a conversation to create your first board
        </p>
      </div>
    </div>
  )
}

