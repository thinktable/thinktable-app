'use client'

// Context for managing sidebar visibility in mobile/compact mode
import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

interface SidebarContextType {
  isMobileMode: boolean // True when window is too small (minimap auto-hides)
  setIsMobileMode: (value: boolean) => void
  isSidebarOpen: boolean // True when sidebar is manually opened in mobile mode (overlay)
  toggleSidebar: () => void
  closeSidebar: () => void
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined)

export function SidebarContextProvider({ children }: { children: ReactNode }) {
  const [isMobileMode, setIsMobileMode] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen(prev => !prev)
  }, [])

  const closeSidebar = useCallback(() => {
    setIsSidebarOpen(false)
  }, [])

  return (
    <SidebarContext.Provider value={{ 
      isMobileMode, 
      setIsMobileMode, 
      isSidebarOpen, 
      toggleSidebar, 
      closeSidebar 
    }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebarContext() {
  const context = useContext(SidebarContext)
  if (context === undefined) {
    // Return default values if context is not available (graceful degradation)
    return { 
      isMobileMode: false, 
      setIsMobileMode: () => {}, 
      isSidebarOpen: false, 
      toggleSidebar: () => {}, 
      closeSidebar: () => {} 
    }
  }
  return context
}

