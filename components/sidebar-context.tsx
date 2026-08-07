'use client'

// Context for board nav popup + right chat sidebar chrome
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  ReactNode,
} from 'react'
import { getStoredTopperId, TT_TOPPER_STORAGE_KEY } from './personalize-ai-modal'

/** Width of the right chat sidebar when open (keeps top bar / map shrunk left). Notion-like panel width. */
export const CHAT_SIDEBAR_WIDTH = 360

interface SidebarContextType {
  isMobileMode: boolean // True when window is too small (minimap auto-hides)
  setIsMobileMode: (value: boolean) => void
  isSidebarOpen: boolean // True when left nav popup is visible
  openSidebar: () => void // Show nav popup (logo hover / click)
  toggleSidebar: () => void // Toggle nav popup (mobile click)
  closeSidebar: () => void // Hide nav popup immediately
  scheduleCloseSidebar: () => void // Hide after short delay (bridge logo ↔ menu)
  cancelCloseSidebar: () => void // Cancel pending delayed close when re-entering
  isChatSidebarOpen: boolean // True when right chat sidebar is visible
  toggleChatSidebar: () => void // Toggle right chat sidebar (logo by minimap)
  setChatSidebarOpen: (open: boolean) => void // Explicit open/close for chat sidebar
  topperId: string | null // AI brand topper (shared by chat + map open icon)
  setTopperId: (id: string | null) => void // Persist + sync topper across chrome
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined)

export function SidebarContextProvider({ children }: { children: ReactNode }) {
  const [isMobileMode, setIsMobileMode] = useState(false) // Compact layout flag from board flows
  const [isSidebarOpen, setIsSidebarOpen] = useState(false) // Left nav popup visibility
  const [isChatSidebarOpen, setIsChatSidebarOpen] = useState(false) // Right chat sidebar — hidden by default
  const [topperId, setTopperIdState] = useState<string | null>(null) // Shared Thinktable AI topper
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) // Delayed-close handle for left nav

  // Hydrate topper from localStorage after mount
  useEffect(() => {
    setTopperIdState(getStoredTopperId())
  }, [])

  const setTopperId = useCallback((id: string | null) => {
    setTopperIdState(id) // Sync map open icon + chat brand mark
    if (typeof window === 'undefined') return
    if (id) localStorage.setItem(TT_TOPPER_STORAGE_KEY, id)
    else localStorage.removeItem(TT_TOPPER_STORAGE_KEY)
  }, [])

  const cancelCloseSidebar = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current) // Drop pending hide so hover can bridge
      closeTimerRef.current = null
    }
  }, [])

  const openSidebar = useCallback(() => {
    cancelCloseSidebar() // Stay open if a close was queued
    setIsSidebarOpen(true) // Show rounded nav popup
  }, [cancelCloseSidebar])

  const closeSidebar = useCallback(() => {
    cancelCloseSidebar() // Clear any queued delay
    setIsSidebarOpen(false) // Hide immediately
  }, [cancelCloseSidebar])

  const scheduleCloseSidebar = useCallback(() => {
    cancelCloseSidebar() // Reset previous timer
    closeTimerRef.current = setTimeout(() => {
      setIsSidebarOpen(false) // Hide after bridge grace period
      closeTimerRef.current = null
    }, 180) // ms — enough to move pointer from logo to popup
  }, [cancelCloseSidebar])

  const toggleSidebar = useCallback(() => {
    cancelCloseSidebar()
    setIsSidebarOpen((prev) => !prev) // Click toggle for touch / mobile
  }, [cancelCloseSidebar])

  const toggleChatSidebar = useCallback(() => {
    setIsChatSidebarOpen((prev) => !prev) // Logo by minimap toggles chat column
  }, [])

  const setChatSidebarOpen = useCallback((open: boolean) => {
    setIsChatSidebarOpen(open)
  }, [])

  return (
    <SidebarContext.Provider
      value={{
        isMobileMode,
        setIsMobileMode,
        isSidebarOpen,
        openSidebar,
        toggleSidebar,
        closeSidebar,
        scheduleCloseSidebar,
        cancelCloseSidebar,
        isChatSidebarOpen,
        toggleChatSidebar,
        setChatSidebarOpen,
        topperId,
        setTopperId,
      }}
    >
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebarContext() {
  const context = useContext(SidebarContext)
  if (context === undefined) {
    // Graceful defaults when provider is missing (e.g. isolated stories)
    return {
      isMobileMode: false,
      setIsMobileMode: () => {},
      isSidebarOpen: false,
      openSidebar: () => {},
      toggleSidebar: () => {},
      closeSidebar: () => {},
      scheduleCloseSidebar: () => {},
      cancelCloseSidebar: () => {},
      isChatSidebarOpen: false,
      toggleChatSidebar: () => {},
      setChatSidebarOpen: () => {},
      topperId: null as string | null,
      setTopperId: () => {},
    }
  }
  return context
}
