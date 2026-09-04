'use client'

// When the right chat sidebar opens/closes, shrink/grow the map and scale zoom so the same relative content stays framed.
import { useEffect, useRef } from 'react'
import type { ReactFlowInstance, Viewport } from 'reactflow'
import { useSidebarContext } from '@/components/sidebar-context'

/** Apply width-ratio camera transform from a closed-state baseline (no drift). */
function viewportForOpenWidth(
  baseline: Viewport, // Camera while sidebar was closed
  closedWidth: number, // Map pane width while closed
  openWidth: number, // Map pane width while open
  height: number // Pane height (unchanged by sidebar)
): Viewport {
  const ratio = openWidth / closedWidth // Zoom out so the same horizontal span fits
  return {
    zoom: baseline.zoom * ratio, // Relative zoom for narrower pane
    x: baseline.x * ratio, // Keep horizontal framing fractions stable
    y: (height / 2) * (1 - ratio) + baseline.y * ratio, // Keep vertical center stable
  }
}

/**
 * Scales the React Flow viewport when the chat sidebar toggles.
 * Stores the closed-state camera and restores it on close so open/close cycles do not drift.
 */
export function useChatSidebarViewportAdjust(
  reactFlowInstance: ReactFlowInstance | null, // Active flow instance (null until mounted)
  isChatSidebarOpen: boolean // Right chat column visibility from sidebar context
) {
  const { chatSidebarWidth } = useSidebarContext() // Live column width (drag-resized)
  const prevOpenRef = useRef(isChatSidebarOpen) // Skip initial mount; only react to toggles
  const closedBaselineRef = useRef<Viewport | null>(null) // Exact camera to restore on close
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) // Delayed baseline clear after close
  const widthAtOpenRef = useRef(chatSidebarWidth) // Sidebar width used for the open camera math

  useEffect(() => {
    if (!reactFlowInstance) return // Flow not ready yet
    if (prevOpenRef.current === isChatSidebarOpen) return // No open/close change

    const wasOpen = prevOpenRef.current // Previous sidebar state before this toggle
    prevOpenRef.current = isChatSidebarOpen // Record new state for next comparison

    // Opening — lock closed camera now (layout width may already be shrunk; x/y/zoom are not)
    if (!wasOpen && isChatSidebarOpen) {
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current) // Re-open mid-close — keep same baseline
        clearTimerRef.current = null
      }
      if (!closedBaselineRef.current) {
        closedBaselineRef.current = reactFlowInstance.getViewport() // Source of truth for this cycle
      }
      widthAtOpenRef.current = chatSidebarWidth // Match the column that just opened
    }

    let cancelled = false // Abort if effect re-runs before frames fire
    let innerId = 0 // Nested rAF handle for cleanup

    // Double rAF — wait until flex layout has applied the ±chatSidebarWidth width change
    const outerId = requestAnimationFrame(() => {
      innerId = requestAnimationFrame(() => {
        if (cancelled) return
        const pane = document.querySelector('.react-flow') as HTMLElement | null // Current map pane
        if (!pane) return

        const width = pane.clientWidth // Width after sidebar toggle
        const height = pane.clientHeight // Height unchanged by sidebar
        if (width <= 0 || height <= 0) return

        if (!wasOpen && isChatSidebarOpen) {
          // Open — derive from closed baseline (never from a mid-animation getViewport)
          const baseline = closedBaselineRef.current
          if (!baseline) return
          // Pane is already shrunk; closed width is open width + sidebar (exact inverse of close)
          const closedWidth = width + widthAtOpenRef.current
          const next = viewportForOpenWidth(baseline, closedWidth, width, height)
          reactFlowInstance.setViewport(next, { duration: 200 })
          return
        }

        if (wasOpen && !isChatSidebarOpen) {
          // Close — restore exact closed camera (no inverse-ratio compounding)
          const baseline = closedBaselineRef.current
          if (!baseline) return
          reactFlowInstance.setViewport(baseline, { duration: 200 })
          // Clear after animation so a later open snapshots the real closed camera
          if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
          clearTimerRef.current = setTimeout(() => {
            closedBaselineRef.current = null
            clearTimerRef.current = null
          }, 220)
        }
      })
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(outerId)
      if (innerId) cancelAnimationFrame(innerId)
    }
  }, [isChatSidebarOpen, reactFlowInstance, chatSidebarWidth])

  // Clear pending timer on unmount
  useEffect(() => {
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
    }
  }, [])
}
