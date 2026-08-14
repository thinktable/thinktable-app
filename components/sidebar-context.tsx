'use client'

// Context for board nav popup + right chat sidebar chrome
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
  ReactNode,
} from 'react'
import { getStoredLogoDrawing, TT_LOGO_DRAWING_STORAGE_KEY } from './personalize-ai-modal'

/** Width of the right chat sidebar when open (keeps top bar / map shrunk left). Notion-like panel width. */
export const CHAT_SIDEBAR_WIDTH = 360

/** localStorage + cookie key — reopen chat column after reload when it was open. */
export const TT_CHAT_SIDEBAR_OPEN_KEY = 'thinktable-chat-sidebar-open'

/** Cookie twin of the localStorage flag so SSR can paint the column already open. */
export const TT_CHAT_SIDEBAR_COOKIE = 'thinktable-chat-sidebar-open'

/** Read whether chat was open last session (SSR-safe → false). */
function getStoredChatSidebarOpen(): boolean {
  if (typeof window === 'undefined') return false // SSR: stay closed until client
  return localStorage.getItem(TT_CHAT_SIDEBAR_OPEN_KEY) === 'true' // Persist open across reload
}

/** Persist chat open/closed so reload restores the column (localStorage + cookie for SSR). */
function persistChatSidebarOpen(open: boolean) {
  if (typeof window === 'undefined') return // No storage on server
  localStorage.setItem(TT_CHAT_SIDEBAR_OPEN_KEY, open ? 'true' : 'false') // Client restore
  document.cookie = `${TT_CHAT_SIDEBAR_COOKIE}=${open ? 'true' : 'false'}; Path=/; Max-Age=31536000; SameSite=Lax` // First HTML paint
}

/** localStorage key — restore the same AI thread after reload. */
export const TT_CHAT_THREAD_ID_KEY = 'thinktable-chat-thread-id'

interface SidebarContextType {
  isMobileMode: boolean // True when window is too small (minimap auto-hides)
  setIsMobileMode: (value: boolean) => void
  isSidebarOpen: boolean // True when left nav popup is visible
  isSidebarPinned: boolean // True when click-toggled open (survives leave + page switch)
  openSidebar: () => void // Show nav popup (logo hover / click)
  toggleSidebar: () => void // Click menu: pin open, or unpin + close
  closeSidebar: () => void // Hide nav popup immediately (also clears pin)
  scheduleCloseSidebar: () => void // Hide after short delay (bridge logo ↔ menu; no-op if pinned)
  cancelCloseSidebar: () => void // Cancel pending delayed close when re-entering
  isChatSidebarOpen: boolean // True when right chat sidebar is visible
  chatChromeReady: boolean // True after storage restore so the top bar can measure the final column
  toggleChatSidebar: () => void // Toggle right chat sidebar (logo by minimap)
  setChatSidebarOpen: (open: boolean) => void // Explicit open/close for chat sidebar
  logoDrawing: string | null // Custom logo PNG data URL (shared by chat + map open icon)
  setLogoDrawing: (url: string | null) => void // Persist + sync custom logo across chrome
  /** Phone: AiComposer registers focus so brand tap can open the soft keyboard in the same gesture. */
  registerAiComposerFocus: (fn: (() => void) | null) => void
  /** Phone/desktop: true when AI transcript (chat box) has messages — Free nav uses board fill then. */
  aiChatHasTranscript: boolean
  setAiChatHasTranscript: (value: boolean) => void
  /** Phone: px to lift Free nav / minimap chrome above the map-docked AI composer (+ keyboard). */
  aiMapDockLiftPx: number
  setAiMapDockLiftPx: (px: number) => void
  /** Phone: left inset so Free nav aligns with the AI dock’s left edge when jumped. */
  aiMapDockLeftPx: number | null
  setAiMapDockLeftPx: (px: number | null) => void
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined)

export function SidebarContextProvider({
  children,
  initialChatOpen = false,
}: {
  children: ReactNode
  initialChatOpen?: boolean // Cookie from the server so the column exists in the first HTML
}) {
  const [isMobileMode, setIsMobileMode] = useState(false) // Compact layout flag from board flows
  const [isSidebarOpen, setIsSidebarOpen] = useState(false) // Left nav popup visibility
  const [isSidebarPinned, setIsSidebarPinned] = useState(false) // Click-pinned: stay open across leave/nav
  const [isChatSidebarOpen, setIsChatSidebarOpen] = useState(initialChatOpen) // Cookie/SSR: already open when it was last time
  const [chatChromeReady, setChatChromeReady] = useState(false) // False until this layout effect restores open/closed
  const [logoDrawing, setLogoDrawingState] = useState<string | null>(null) // Shared custom logo drawing
  const [aiMapDockLiftPx, setAiMapDockLiftPx] = useState(0) // Phone: lift Free nav above AI dock
  const [aiMapDockLeftPx, setAiMapDockLeftPx] = useState<number | null>(null) // Phone: align Free nav to dock left
  const [aiChatHasTranscript, setAiChatHasTranscript] = useState(false) // Chat box has messages (vs input-only)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) // Delayed-close handle for left nav
  const isSidebarPinnedRef = useRef(false) // Latest pin for scheduleClose without stale closure
  const isMobileModeRef = useRef(false) // Latest mobile flag for sync focus in toggle
  const isChatOpenRef = useRef(false) // Latest chat open for sync focus in toggle
  const aiComposerFocusRef = useRef<(() => void) | null>(null) // Phone composer.focus (same-tap keyboard)

  // Keep pin ref in sync for delayed-close guard
  useEffect(() => {
    isSidebarPinnedRef.current = isSidebarPinned
  }, [isSidebarPinned])

  useEffect(() => {
    isMobileModeRef.current = isMobileMode
  }, [isMobileMode])

  useEffect(() => {
    isChatOpenRef.current = isChatSidebarOpen
  }, [isChatSidebarOpen])

  const registerAiComposerFocus = useCallback((fn: (() => void) | null) => {
    aiComposerFocusRef.current = fn // Mounted phone AiComposer wires this
  }, [])

  // Restore chat open + logo before first paint; cookie already opened the column in SSR HTML
  useLayoutEffect(() => {
    const narrow = window.innerWidth < 900 // Same threshold as board-flow minimap mobile mode
    setIsMobileMode(narrow) // Ready before first brand tap (phone map-dock path)
    const storedOpen = getStoredChatSidebarOpen() // Last session flag
    const nextOpen = narrow ? false : storedOpen // Phone: don’t restore a desktop column
    isChatOpenRef.current = nextOpen // Sync before children measure on the next commit
    setIsChatSidebarOpen(nextOpen)
    if (!narrow) persistChatSidebarOpen(storedOpen) // Backfill cookie so the next SSR already has the column
    setLogoDrawingState(getStoredLogoDrawing()) // Custom logo PNG
    setChatChromeReady(true) // Next commit: column is final; top bar may measure
  }, [])

  const setLogoDrawing = useCallback((url: string | null) => {
    setLogoDrawingState(url) // Sync map open icon + chat brand mark
    if (typeof window === 'undefined') return
    if (url) localStorage.setItem(TT_LOGO_DRAWING_STORAGE_KEY, url)
    else localStorage.removeItem(TT_LOGO_DRAWING_STORAGE_KEY)
  }, [])

  const cancelCloseSidebar = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current) // Drop pending hide so hover can bridge
      closeTimerRef.current = null
    }
  }, [])

  const openSidebar = useCallback(() => {
    cancelCloseSidebar() // Stay open if a close was queued
    setIsSidebarOpen(true) // Show rounded nav popup (hover does not pin)
  }, [cancelCloseSidebar])

  const closeSidebar = useCallback(() => {
    cancelCloseSidebar() // Clear any queued delay
    setIsSidebarPinned(false) // Explicit close clears click-pin
    setIsSidebarOpen(false) // Hide immediately
  }, [cancelCloseSidebar])

  const scheduleCloseSidebar = useCallback(() => {
    if (isSidebarPinnedRef.current) return // Click-pinned stays open until menu clicked again
    cancelCloseSidebar() // Reset previous timer
    closeTimerRef.current = setTimeout(() => {
      if (isSidebarPinnedRef.current) return // Re-check in case pinned during grace
      setIsSidebarOpen(false) // Hide after bridge grace period
      closeTimerRef.current = null
    }, 180) // ms — enough to move pointer from logo to popup
  }, [cancelCloseSidebar])

  const toggleSidebar = useCallback(() => {
    cancelCloseSidebar()
    setIsSidebarPinned((pinned) => {
      if (pinned) {
        setIsSidebarOpen(false) // Second click: unpin and hide
        return false
      }
      setIsSidebarOpen(true) // First click: open and pin across leave/page switch
      return true
    })
  }, [cancelCloseSidebar])

  const toggleChatSidebar = useCallback(() => {
    const opening = !isChatOpenRef.current // About to open?
    // iOS: focus must run in this tap — phone dock keeps composer mounted while closed
    if (opening && isMobileModeRef.current) {
      aiComposerFocusRef.current?.()
    } else if (!opening && isMobileModeRef.current) {
      const ae = document.activeElement as HTMLElement | null
      if (ae?.closest?.('[data-chat-map-dock]')) ae.blur() // Dismiss soft keyboard
    }
    setIsChatSidebarOpen((prev) => {
      const next = !prev // Logo by minimap toggles chat column
      persistChatSidebarOpen(next) // Remember for reload
      return next
    })
  }, [])

  const setChatSidebarOpen = useCallback((open: boolean) => {
    if (open && isMobileModeRef.current && !isChatOpenRef.current) {
      aiComposerFocusRef.current?.() // Same-tap keyboard when opened explicitly
    } else if (!open && isMobileModeRef.current) {
      const ae = document.activeElement as HTMLElement | null
      if (ae?.closest?.('[data-chat-map-dock]')) ae.blur() // Dismiss soft keyboard
    }
    persistChatSidebarOpen(open) // Remember for reload
    setIsChatSidebarOpen(open)
  }, [])
  return (
    <SidebarContext.Provider
      value={{
        isMobileMode,
        setIsMobileMode,
        isSidebarOpen,
        isSidebarPinned,
        openSidebar,
        toggleSidebar,
        closeSidebar,
        scheduleCloseSidebar,
        cancelCloseSidebar,
        isChatSidebarOpen,
        chatChromeReady,
        toggleChatSidebar,
        setChatSidebarOpen,
        logoDrawing,
        setLogoDrawing,
        registerAiComposerFocus,
        aiChatHasTranscript,
        setAiChatHasTranscript,
        aiMapDockLiftPx,
        setAiMapDockLiftPx,
        aiMapDockLeftPx,
        setAiMapDockLeftPx,
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
      isSidebarPinned: false,
      openSidebar: () => {},
      toggleSidebar: () => {},
      closeSidebar: () => {},
      scheduleCloseSidebar: () => {},
      cancelCloseSidebar: () => {},
      isChatSidebarOpen: false,
      chatChromeReady: true, // No provider — nothing to restore; measure immediately
      toggleChatSidebar: () => {},
      setChatSidebarOpen: () => {},
      logoDrawing: null as string | null,
      setLogoDrawing: () => {},
      registerAiComposerFocus: () => {},
      aiChatHasTranscript: false,
      setAiChatHasTranscript: () => {},
      aiMapDockLiftPx: 0,
      setAiMapDockLiftPx: () => {},
      aiMapDockLeftPx: null as number | null,
      setAiMapDockLeftPx: () => {},
    }
  }
  return context
}
