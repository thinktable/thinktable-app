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

/** Default / minimum width of the right chat sidebar when open (Notion-like). */
export const CHAT_SIDEBAR_WIDTH = 360

/** localStorage — preferred chat column width (half-window clamp is display-only). */
export const TT_CHAT_SIDEBAR_WIDTH_KEY = 'thinktable-chat-sidebar-width'

/** Max chat width = half the window; never below the min (small windows can’t shrink the panel). */
export function chatSidebarMaxWidth(windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1200) {
  return Math.max(CHAT_SIDEBAR_WIDTH, Math.floor(windowWidth / 2))
}

/** Clamp a preferred width into [min, half-window] for the live column. */
export function clampChatSidebarWidth(width: number, windowWidth?: number) {
  const max = chatSidebarMaxWidth(windowWidth)
  return Math.min(max, Math.max(CHAT_SIDEBAR_WIDTH, Math.round(width)))
}

/** Preferred width floor only — keep user’s wider choice across shrink/expand. */
function normalizePreferredChatWidth(width: number) {
  return Math.max(CHAT_SIDEBAR_WIDTH, Math.round(width))
}

function getStoredChatSidebarWidth(): number {
  if (typeof window === 'undefined') return CHAT_SIDEBAR_WIDTH
  const raw = localStorage.getItem(TT_CHAT_SIDEBAR_WIDTH_KEY)
  const n = raw ? Number(raw) : NaN
  if (!Number.isFinite(n)) return CHAT_SIDEBAR_WIDTH
  return normalizePreferredChatWidth(n) // Do not clamp to this window’s half — restore widens later
}

function persistChatSidebarWidth(width: number) {
  if (typeof window === 'undefined') return
  localStorage.setItem(TT_CHAT_SIDEBAR_WIDTH_KEY, String(normalizePreferredChatWidth(width)))
}

/** Viewport width below which chat uses the phone map dock (not the desktop column). */
export const PHONE_LAYOUT_MAX_WIDTH = 768

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

/** localStorage — click-pinned boards nav so reload keeps the menu open. */
export const TT_BOARDS_NAV_PINNED_KEY = 'thinktable-boards-nav-pinned'

/** Read whether the boards nav was click-pinned (SSR-safe → closed). */
function getStoredBoardsNavPinned(): boolean {
  if (typeof window === 'undefined') return false // Server: stay closed until client
  return localStorage.getItem(TT_BOARDS_NAV_PINNED_KEY) === 'true' // Persist pin across reload
}

/** Remember boards-nav pin so reload restores the popup. */
function persistBoardsNavPinned(pinned: boolean) {
  if (typeof window === 'undefined') return // No storage on server
  localStorage.setItem(TT_BOARDS_NAV_PINNED_KEY, pinned ? 'true' : 'false') // Client restore
}

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
  chatSidebarWidth: number // Live column width (preferred clamped to this window)
  setChatSidebarWidth: (width: number) => void // Drag-resize; preferred persisted, display clamped
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
  /** Phone landscape + keyboard: visual viewport is too short for top bar + composer — hide tools while typing. */
  phoneDockTight: boolean
  setPhoneDockTight: (value: boolean) => void
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
  const [chatSidebarWidth, setChatSidebarWidthState] = useState(CHAT_SIDEBAR_WIDTH) // SSR default; restore from storage before paint
  const [chatChromeReady, setChatChromeReady] = useState(false) // False until this layout effect restores open/closed
  const [logoDrawing, setLogoDrawingState] = useState<string | null>(null) // Shared custom logo drawing
  const [aiMapDockLiftPx, setAiMapDockLiftPx] = useState(0) // Phone: lift Free nav above AI dock
  const [aiMapDockLeftPx, setAiMapDockLeftPx] = useState<number | null>(null) // Phone: align Free nav to dock left
  const [aiChatHasTranscript, setAiChatHasTranscript] = useState(false) // Chat box has messages (vs input-only)
  const [phoneDockTight, setPhoneDockTight] = useState(false) // Hide top bar / mode pill when landscape keyboard leaves no strip
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) // Delayed-close handle for left nav
  const isSidebarPinnedRef = useRef(false) // Latest pin for scheduleClose without stale closure
  const isMobileModeRef = useRef(false) // Latest mobile flag for sync focus in toggle
  const isChatOpenRef = useRef(false) // Latest chat open for sync focus in toggle
  const aiComposerFocusRef = useRef<(() => void) | null>(null) // Phone composer.focus (same-tap keyboard)
  const closedAtRef = useRef(0) // Timestamp of last close — ignore ghost click reopen on the hamburger
  const preferredChatWidthRef = useRef(CHAT_SIDEBAR_WIDTH) // User’s width across shrink/expand (not half-clamped)

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
    const narrow = window.innerWidth < PHONE_LAYOUT_MAX_WIDTH // Same threshold as board-flow phone layout
    setIsMobileMode(narrow) // Ready before first brand tap (phone map-dock path)
    const preferred = getStoredChatSidebarWidth() // Last drag preference (may exceed this window’s half)
    preferredChatWidthRef.current = preferred
    setChatSidebarWidthState(clampChatSidebarWidth(preferred)) // Live column only — keep preference for expand
    const storedOpen = getStoredChatSidebarOpen() // Last session flag
    const nextOpen = narrow ? false : storedOpen // Phone: don’t restore a desktop column
    isChatOpenRef.current = nextOpen // Sync before children measure on the next commit
    setIsChatSidebarOpen(nextOpen)
    if (!narrow) persistChatSidebarOpen(storedOpen) // Backfill cookie so the next SSR already has the column
    const storedPinned = getStoredBoardsNavPinned() // Last click-pin on the boards menu
    if (storedPinned) {
      isSidebarPinnedRef.current = true // scheduleClose must see pin before paint
      setIsSidebarPinned(true) // Menu button stays pressed
      setIsSidebarOpen(true) // Popup visible on first paint
    }
    setLogoDrawingState(getStoredLogoDrawing()) // Custom logo PNG
    setChatChromeReady(true) // Next commit: column is final; top bar may measure
  }, [])

  // Re-clamp the live column on viewport change — never overwrite the stored preference
  useEffect(() => {
    const onResize = () => {
      setChatSidebarWidthState(clampChatSidebarWidth(preferredChatWidthRef.current))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const setChatSidebarWidth = useCallback((width: number) => {
    const display = clampChatSidebarWidth(width) // Live column for this window
    preferredChatWidthRef.current = display // Last intentional width — restore after shrink/expand
    persistChatSidebarWidth(display) // Floor only in storage; do not half-clamp on write
    setChatSidebarWidthState(display)
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
    persistBoardsNavPinned(false) // Reload should not reopen after an explicit close
    setIsSidebarPinned(false) // Explicit close clears click-pin
    setIsSidebarOpen(false) // Hide immediately
    closedAtRef.current = Date.now() // Block ghost click that would reopen via toggle
  }, [cancelCloseSidebar])

  const scheduleCloseSidebar = useCallback(() => {
    if (isSidebarPinnedRef.current) return // Click-pinned stays open on leave (board click still closes)
    cancelCloseSidebar() // Reset previous timer
    closeTimerRef.current = setTimeout(() => {
      if (isSidebarPinnedRef.current) return // Re-check in case pinned during grace
      setIsSidebarOpen(false) // Hide after bridge grace period
      closeTimerRef.current = null
    }, 350) // ms — linger so the pointer can leave the icon and enter the popup
  }, [cancelCloseSidebar])

  const toggleSidebar = useCallback(() => {
    cancelCloseSidebar()
    setIsSidebarPinned((pinned) => {
      if (pinned) {
        persistBoardsNavPinned(false) // Unpin: next reload stays closed
        setIsSidebarOpen(false) // Second click: unpin and hide
        closedAtRef.current = Date.now() // Same ghost-click guard as closeSidebar
        return false
      }
      // Scrim used to cover the hamburger — close unmounted it and the same tap’s click reopened
      if (Date.now() - closedAtRef.current < 400) {
        return false // Stay closed; ignore click-through reopen
      }
      persistBoardsNavPinned(true) // Pin: next reload reopens the menu
      setIsSidebarOpen(true) // First click: open and pin across leave/page switch
      return true
    })
  }, [cancelCloseSidebar])

  // Board (or other chrome) click dismisses like a dropdown — pin only survives leave / board switch
  useEffect(() => {
    if (!isSidebarOpen) return // Closed — no dismiss listener
    const onPointerDown = (event: PointerEvent) => {
      const node = event.target as Node | null // May be a text node inside a frame
      const target = node instanceof Element ? node : node?.parentElement // closest() needs an Element
      if (!target) return
      // Hamburger toggles; popup + portaled menus/dialogs stay interactive
      if (
        target.closest(
          '[data-nav-menu-popup], [data-nav-logo-trigger], [data-radix-popper-content-wrapper], [role="menu"], [role="dialog"], [data-radix-dialog-content]'
        )
      ) {
        return
      }
      closeSidebar() // Unpin and hide immediately (don't wait for hover grace)
    }
    document.addEventListener('pointerdown', onPointerDown, true) // Capture: RF pane may stop bubble
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [isSidebarOpen, closeSidebar])

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

  // Notion-style ⌘/; — toggle chat (Close on the seam tip when open)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== ';') return
      e.preventDefault()
      toggleChatSidebar()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleChatSidebar])

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
        chatSidebarWidth,
        setChatSidebarWidth,
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
        phoneDockTight,
        setPhoneDockTight,
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
      chatSidebarWidth: CHAT_SIDEBAR_WIDTH,
      setChatSidebarWidth: () => {},
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
      phoneDockTight: false,
      setPhoneDockTight: () => {},
    }
  }
  return context
}
