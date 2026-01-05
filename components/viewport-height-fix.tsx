'use client'

// Fix viewport height for mobile Safari/iPad
// Updates CSS variable --vh when viewport height changes (address bar show/hide)
import { useEffect } from 'react'

export function ViewportHeightFix() {
  useEffect(() => {
    function setViewportHeight() {
      // Calculate 1% of actual viewport height
      const vh = window.innerHeight * 0.01
      // Set CSS variable for use in calc(var(--vh) * 100)
      document.documentElement.style.setProperty('--vh', `${vh}px`)
    }

    // Set initial height
    setViewportHeight()

    // Update on window resize
    window.addEventListener('resize', setViewportHeight)
    
    // Update on orientation change
    window.addEventListener('orientationchange', setViewportHeight)
    
    // Update on visual viewport changes (mobile Safari address bar show/hide)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', setViewportHeight)
    }

    // Cleanup
    return () => {
      window.removeEventListener('resize', setViewportHeight)
      window.removeEventListener('orientationchange', setViewportHeight)
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', setViewportHeight)
      }
    }
  }, [])

  return null // This component doesn't render anything
}

