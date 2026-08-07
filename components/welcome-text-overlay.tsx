'use client'
// Force recompile

// Welcome text — centered on board column; disappears when first panel is placed
import { useReactFlowContext } from './react-flow-context'
import { useEffect, useState } from 'react'

export function WelcomeText() {
  const { reactFlowInstance } = useReactFlowContext()
  const [showWelcome, setShowWelcome] = useState(true)
  const [isMounted, setIsMounted] = useState(false)

  // Phrases to rotate through
  const phrases = [
    'Welcome to ThinkTable!',
    'Think outside the box.',
    'Organize your thoughts.',
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

  // Pick a random phrase index on mount/reload (client-only)
  useEffect(() => {
    if (!showWelcome) return
    setCurrentPhraseIndex(Math.floor(Math.random() * phrases.length))
    setIsMounted(true)
  }, []) // Only run on mount/reload

  if (!showWelcome) return null

  // Parent is the map column (`flex-1 relative`) — inset-0 + justify-center
  // keeps copy centered to board width, including when chat sidebar is open.
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[5]">
      <div className="text-center w-full max-w-3xl px-4">
        {isMounted ? (
          <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-4 animate-in fade-in duration-500">
            {phrases[currentPhraseIndex]}
          </h1>
        ) : (
          // Placeholder to prevent layout shift, but invisible
          <h1 className="text-4xl font-bold opacity-0 mb-4 select-none">
            {phrases[0]}
          </h1>
        )}
        <p className="text-xl text-gray-600 dark:text-gray-400">
          Start a conversation to create your first board
        </p>
      </div>
    </div>
  )
}
