'use client'

// Context for sharing React Flow instance with components outside ReactFlowProvider
import { createContext, useContext, useState, useRef, useCallback, useEffect, ReactNode } from 'react'
import { ReactFlowInstance } from 'reactflow'
import { createClient } from '@/lib/supabase/client'
import { usePathname } from 'next/navigation'

interface ReactFlowContextType {
  reactFlowInstance: ReactFlowInstance | null
  setReactFlowInstance: (instance: ReactFlowInstance | null) => void
  getSetNodes: () => ((nodes: any) => void) | undefined // Getter for setNodes function (stored in ref)
  registerSetNodes: (setNodes: ((nodes: any) => void) | undefined) => void // Function to register setNodes from useNodesState
  isLocked: boolean // Global lock state
  setIsLocked: (locked: boolean) => void // Function to set lock state
  layoutMode: 'auto' | 'tree' | 'cluster' | 'none' // Layout mode state
  setLayoutMode: (mode: 'auto' | 'tree' | 'cluster' | 'none') => void // Function to set layout mode
  isDeterministicMapping: boolean // Deterministic mapping state (enabled when layoutMode is 'none')
  setIsDeterministicMapping: (enabled: boolean) => void // Function to set deterministic mapping state
  panelWidth: number // Panel width (matches prompt box width when zoom is 100%)
  setPanelWidth: (width: number) => void // Function to set panel width
  isPromptBoxCentered: boolean // Whether prompt box is centered (vs left-aligned)
  setIsPromptBoxCentered: (centered: boolean) => void // Function to set prompt box centered state
  lineStyle: 'solid' | 'dotted' // Line style state (solid or dotted)
  setLineStyle: (style: 'solid' | 'dotted') => void // Function to set line style
  arrowDirection: 'down' | 'up' | 'left' | 'right' // Arrow direction state
  setArrowDirection: (direction: 'down' | 'up' | 'left' | 'right') => void // Function to set arrow direction
  editMenuPillMode: 'home' | 'insert' | 'draw' | 'view' // Edit menu pill mode state
  setEditMenuPillMode: (mode: 'home' | 'insert' | 'draw' | 'view') => void // Function to set edit menu pill mode
  viewMode: 'linear' | 'canvas' // View mode state (linear or canvas)
  boardRule: 'wide' | 'college' | 'narrow' // Board rule state (paper rule type)
  setBoardRule: (rule: 'wide' | 'college' | 'narrow') => void // Function to set board rule
  boardStyle: 'none' | 'dotted' | 'lined' | 'grid' // Board style state (background style)
  setBoardStyle: (style: 'none' | 'dotted' | 'lined' | 'grid') => void // Function to set board style
  fillColor: string // Fill color state (for shapes/components)
  setFillColor: (color: string) => void // Function to set fill color
  borderColor: string // Border color state (for shapes/components)
  setBorderColor: (color: string) => void // Function to set border color
  borderWeight: number // Border weight state (for shapes/components)
  setBorderWeight: (weight: number) => void // Function to set border weight
  borderStyle: 'solid' | 'dashed' | 'dotted' | 'none' // Border style state (for shapes/components)
  setBorderStyle: (style: 'solid' | 'dashed' | 'dotted' | 'none') => void // Function to set border style
  clickedEdge: { id: string; source: string; target: string } | null // Currently clicked edge (for panel color updates)
  setClickedEdge: (edge: { id: string; source: string; target: string } | null) => void // Function to set clicked edge
  flashcardMode: 'flashcard' | 'quiz' | null // Flashcard study mode (null = off, flashcard/quiz = active mode)
  setFlashcardMode: (mode: 'flashcard' | 'quiz' | null) => void // Function to set flashcard mode
  selectedTag: string | null // Selected flashcard tag (study set ID) for filtering navigation
  setSelectedTag: (tagId: string | null) => void // Function to set selected tag (toggles if same tag clicked)
  isDrawing: boolean // Drawing mode state (true = drawing enabled, false = selection mode)
  setIsDrawing: (drawing: boolean) => void // Function to set drawing mode
  drawTool: 'lasso' | 'pencil' | 'highlighter' | 'eraser' | null // Current drawing tool
  setDrawTool: (tool: 'lasso' | 'pencil' | 'highlighter' | 'eraser' | null) => void // Function to set drawing tool
  drawShape: 'rectangle' | 'circle' | 'line' | 'arrow' | 'round-rectangle' | 'hexagon' | 'diamond' | 'arrow-rectangle' | 'cylinder' | 'triangle' | 'parallelogram' | 'plus' // Current shape
  setDrawShape: (shape: 'rectangle' | 'circle' | 'line' | 'arrow' | 'round-rectangle' | 'hexagon' | 'diamond' | 'arrow-rectangle' | 'cylinder' | 'triangle' | 'parallelogram' | 'plus') => void // Function to set shape
  // Undo/Redo functions for React Flow map actions (registered from BoardFlow where useUndoRedo hook is used)
  mapUndo: () => void // Undo last map action (node drag, add, delete, edge change)
  mapRedo: () => void // Redo last undone map action
  canMapUndo: boolean // Whether map undo is available
  canMapRedo: boolean // Whether map redo is available
  registerMapUndoRedo: (fns: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean }) => void // Register undo/redo from BoardFlow
  getMapTakeSnapshot: () => (() => void) | undefined // Getter for takeSnapshot function
  registerMapTakeSnapshot: (fn: () => void) => void // Register takeSnapshot from BoardFlow
}

const ReactFlowContext = createContext<ReactFlowContextType | undefined>(undefined)

export function ReactFlowContextProvider({ children, conversationId, projectId }: { children: ReactNode; conversationId?: string; projectId?: string }) {
  const pathname = usePathname() // Track route changes to reload preferences
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const setNodesRef = useRef<((nodes: any) => void) | undefined>(undefined) // Use ref to avoid setState during render
  const [isLocked, setIsLocked] = useState(false) // Global lock state
  // Initialize with consistent defaults to avoid hydration mismatch
  // Then update from localStorage in useEffect after hydration
  const [layoutMode, setLayoutMode] = useState<'auto' | 'tree' | 'cluster' | 'none'>('auto')
  const [isDeterministicMapping, setIsDeterministicMapping] = useState(true) // Default to true (auto mode)
  const [panelWidth, setPanelWidth] = useState(768) // Default panel width (matches prompt box max width)
  const [isPromptBoxCentered, setIsPromptBoxCentered] = useState(false) // Whether prompt box is centered
  // Initialize with consistent defaults to avoid hydration mismatch, then load from Supabase
  const [lineStyle, setLineStyle] = useState<'solid' | 'dotted'>('solid')
  const [arrowDirection, setArrowDirection] = useState<'down' | 'up' | 'left' | 'right'>('down')
  const [editMenuPillMode, setEditMenuPillMode] = useState<'home' | 'insert' | 'draw' | 'view'>('home') // Edit menu pill mode state
  const [viewMode, setViewMode] = useState<'linear' | 'canvas'>('canvas') // View mode state
  const [boardRule, setBoardRule] = useState<'wide' | 'college' | 'narrow'>('college') // Board rule state (default: college)
  const [boardStyle, setBoardStyle] = useState<'none' | 'dotted' | 'lined' | 'grid'>('none') // Board style state (default: none)
  const [fillColor, setFillColor] = useState<string>('#ffffff') // Fill color state (default: white)
  const [borderColor, setBorderColor] = useState<string>('#000000') // Border color state (default: black)
  const [borderWeight, setBorderWeight] = useState<number>(1) // Border weight state (default: 1px)
  const [borderStyle, setBorderStyle] = useState<'solid' | 'dashed' | 'dotted' | 'none'>('solid') // Border style state (default: solid)
  const [clickedEdge, setClickedEdge] = useState<{ id: string; source: string; target: string } | null>(null) // Currently clicked edge (for panel color updates)
  const [flashcardMode, setFlashcardMode] = useState<'flashcard' | 'quiz' | null>(null) // Flashcard study mode (null = off)
  const [selectedTag, setSelectedTag] = useState<string | null>(null) // Selected flashcard tag for filtering navigation
  const [isDrawing, setIsDrawing] = useState<boolean>(false) // Drawing mode state (default: selection mode)
  const [drawTool, setDrawTool] = useState<'lasso' | 'pencil' | 'highlighter' | 'eraser' | null>(null) // Current drawing tool (default: none)
  const [drawShape, setDrawShape] = useState<'rectangle' | 'circle' | 'line' | 'arrow' | 'round-rectangle' | 'hexagon' | 'diamond' | 'arrow-rectangle' | 'cylinder' | 'triangle' | 'parallelogram' | 'plus'>('rectangle') // Current shape (default: rectangle)
  
  // Undo/Redo state for map actions - stored in refs to avoid re-renders
  // Functions are registered from BoardFlow where the useUndoRedo hook runs inside ReactFlowProvider
  const mapUndoRedoRef = useRef<{ undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean }>({
    undo: () => {},
    redo: () => {},
    canUndo: false,
    canRedo: false,
  })
  const mapTakeSnapshotRef = useRef<(() => void) | undefined>(undefined)
  // State to trigger re-renders when undo/redo availability changes
  const [mapUndoRedoState, setMapUndoRedoState] = useState<{ canUndo: boolean; canRedo: boolean }>({ canUndo: false, canRedo: false })
  
  // Toggle selected tag - if same tag clicked, deselect it
  const toggleSelectedTag = useCallback((tagId: string | null) => {
    setSelectedTag((current) => current === tagId ? null : tagId)
  }, [])

  // Refs to track conversationId and loading state without triggering save effects
  // conversationIdRef: Tracks current board ID for saves (updated when conversationId changes, but doesn't trigger saves)
  // isLoadingRef: Prevents saves during navigation/loading to avoid race conditions
  const conversationIdRef = useRef<string | undefined>(conversationId)
  const isLoadingRef = useRef(false)

  // Shared function to load preferences from localStorage first (instant), then Supabase (sync)
  // If conversationId is undefined, loads from profiles.metadata (default board)
  // If conversationId exists, loads from conversations.metadata (specific board)
  const loadPreferencesFromSupabase = useCallback(async (currentConversationId?: string) => {
    if (typeof window === 'undefined') return

    // STEP 1: Load from localStorage FIRST (synchronous, instant) - ensures UI shows saved prefs immediately
    const storageKey = currentConversationId ? `thinktable-prefs-${currentConversationId}` : 'thinktable-prefs-default'
    const savedPrefs = localStorage.getItem(storageKey)
    if (savedPrefs) {
      try {
        const prefs = JSON.parse(savedPrefs)
        if (prefs.layoutMode && ['auto', 'tree', 'cluster', 'none'].includes(prefs.layoutMode)) {
          setLayoutMode(prefs.layoutMode)
          setIsDeterministicMapping(prefs.layoutMode !== 'none')
        }
        if (prefs.lineStyle && ['solid', 'dotted'].includes(prefs.lineStyle)) {
          setLineStyle(prefs.lineStyle)
        }
        if (prefs.arrowDirection && ['down', 'up', 'left', 'right'].includes(prefs.arrowDirection)) {
          setArrowDirection(prefs.arrowDirection)
        }
        if (prefs.boardRule && ['wide', 'college', 'narrow'].includes(prefs.boardRule)) {
          setBoardRule(prefs.boardRule)
        }
        if (prefs.boardStyle && ['none', 'dotted', 'lined', 'grid'].includes(prefs.boardStyle)) {
          setBoardStyle(prefs.boardStyle)
        }
      } catch (e) {
        // Fallback to old localStorage keys for backward compatibility
        const savedLayoutMode = localStorage.getItem('thinktable-layout-mode') as 'auto' | 'tree' | 'cluster' | 'none' | null
        if (savedLayoutMode && ['auto', 'tree', 'cluster', 'none'].includes(savedLayoutMode)) {
          setLayoutMode(savedLayoutMode)
          setIsDeterministicMapping(savedLayoutMode !== 'none')
        }
        const savedLineStyle = localStorage.getItem('thinktable-line-style') as 'solid' | 'dotted' | null
        if (savedLineStyle && ['solid', 'dotted'].includes(savedLineStyle)) {
          setLineStyle(savedLineStyle)
        }
        const savedArrowDirection = localStorage.getItem('thinktable-arrow-direction') as 'down' | 'up' | 'left' | 'right' | null
        if (savedArrowDirection && ['down', 'up', 'left', 'right'].includes(savedArrowDirection)) {
          setArrowDirection(savedArrowDirection)
        }
      }
    }

    // STEP 2: Then load from Supabase (async) and update if different
    const supabase = createClient()

    try {
      // Check if this is the homepage board (public access via API route)
      let homepageBoardPrefs: any = null
      try {
        const homepageResponse = await fetch('/api/homepage-board')
        if (homepageResponse.ok) {
          const homepageData = await homepageResponse.json()
          if (homepageData.conversation?.id === currentConversationId && homepageData.conversation?.metadata) {
            homepageBoardPrefs = homepageData.conversation.metadata
          }
        }
      } catch (e) {
        // Not homepage board or API failed, continue to normal fetch
      }

      // If we got homepage board prefs, use them (works even if unauthenticated)
      if (homepageBoardPrefs) {
        if (homepageBoardPrefs.boardRule && ['wide', 'college', 'narrow'].includes(homepageBoardPrefs.boardRule)) {
          setBoardRule(homepageBoardPrefs.boardRule)
          const storageKey = currentConversationId ? `thinktable-prefs-${currentConversationId}` : 'thinktable-prefs-default'
          const existingPrefs = JSON.parse(localStorage.getItem(storageKey) || '{}')
          localStorage.setItem(storageKey, JSON.stringify({ ...existingPrefs, boardRule: homepageBoardPrefs.boardRule }))
        }
        if (homepageBoardPrefs.boardStyle && ['none', 'dotted', 'lined', 'grid'].includes(homepageBoardPrefs.boardStyle)) {
          setBoardStyle(homepageBoardPrefs.boardStyle)
          const storageKey = currentConversationId ? `thinktable-prefs-${currentConversationId}` : 'thinktable-prefs-default'
          const existingPrefs = JSON.parse(localStorage.getItem(storageKey) || '{}')
          localStorage.setItem(storageKey, JSON.stringify({ ...existingPrefs, boardStyle: homepageBoardPrefs.boardStyle }))
        }
        // Also load other preferences from homepage board if they exist
        if (homepageBoardPrefs.layoutMode && ['auto', 'tree', 'cluster', 'none'].includes(homepageBoardPrefs.layoutMode)) {
          setLayoutMode(homepageBoardPrefs.layoutMode)
          setIsDeterministicMapping(homepageBoardPrefs.layoutMode !== 'none')
          const storageKey = currentConversationId ? `thinktable-prefs-${currentConversationId}` : 'thinktable-prefs-default'
          const existingPrefs = JSON.parse(localStorage.getItem(storageKey) || '{}')
          localStorage.setItem(storageKey, JSON.stringify({ ...existingPrefs, layoutMode: homepageBoardPrefs.layoutMode }))
        }
        if (homepageBoardPrefs.lineStyle && ['solid', 'dotted'].includes(homepageBoardPrefs.lineStyle)) {
          setLineStyle(homepageBoardPrefs.lineStyle)
          const storageKey = currentConversationId ? `thinktable-prefs-${currentConversationId}` : 'thinktable-prefs-default'
          const existingPrefs = JSON.parse(localStorage.getItem(storageKey) || '{}')
          localStorage.setItem(storageKey, JSON.stringify({ ...existingPrefs, lineStyle: homepageBoardPrefs.lineStyle }))
        }
        if (homepageBoardPrefs.arrowDirection && ['down', 'up', 'left', 'right'].includes(homepageBoardPrefs.arrowDirection)) {
          setArrowDirection(homepageBoardPrefs.arrowDirection)
          const storageKey = currentConversationId ? `thinktable-prefs-${currentConversationId}` : 'thinktable-prefs-default'
          const existingPrefs = JSON.parse(localStorage.getItem(storageKey) || '{}')
          localStorage.setItem(storageKey, JSON.stringify({ ...existingPrefs, arrowDirection: homepageBoardPrefs.arrowDirection }))
        }
        return // Homepage board loaded, skip authenticated fetch
      }

      // For non-homepage boards, require authentication
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        let prefs: any = null

        if (currentConversationId) {
          // Load from conversation metadata (specific board)
          const { data: conversation } = await supabase
            .from('conversations')
            .select('metadata')
            .eq('id', currentConversationId)
            .eq('user_id', user.id)
            .single()

          if (conversation?.metadata) {
            prefs = conversation.metadata as typeof prefs
          }
        } else {
          // Load from profile metadata (default board /board)
          const { data: profile } = await supabase
            .from('profiles')
            .select('metadata')
            .eq('id', user.id)
            .single()

          if (profile?.metadata) {
            prefs = profile.metadata as typeof prefs
          }
        }

        if (prefs) {
          // Update from Supabase if values exist
          if ((prefs as any).layoutMode && ['auto', 'tree', 'cluster', 'none'].includes((prefs as any).layoutMode)) {
            setLayoutMode(prefs.layoutMode)
            setIsDeterministicMapping(prefs.layoutMode !== 'none')
            // Save to localStorage for instant loading next time
            const storageKey = currentConversationId ? `thinktable-prefs-${currentConversationId}` : 'thinktable-prefs-default'
            const existingPrefs = JSON.parse(localStorage.getItem(storageKey) || '{}')
            localStorage.setItem(storageKey, JSON.stringify({ ...existingPrefs, layoutMode: prefs.layoutMode }))
          }

          if (prefs.lineStyle && ['solid', 'dotted'].includes(prefs.lineStyle)) {
            setLineStyle(prefs.lineStyle)
            const storageKey = currentConversationId ? `thinktable-prefs-${currentConversationId}` : 'thinktable-prefs-default'
            const existingPrefs = JSON.parse(localStorage.getItem(storageKey) || '{}')
            localStorage.setItem(storageKey, JSON.stringify({ ...existingPrefs, lineStyle: prefs.lineStyle }))
          }

          if (prefs.arrowDirection && ['down', 'up', 'left', 'right'].includes(prefs.arrowDirection)) {
            setArrowDirection(prefs.arrowDirection)
            const storageKey = currentConversationId ? `thinktable-prefs-${currentConversationId}` : 'thinktable-prefs-default'
            const existingPrefs = JSON.parse(localStorage.getItem(storageKey) || '{}')
            localStorage.setItem(storageKey, JSON.stringify({ ...existingPrefs, arrowDirection: prefs.arrowDirection }))
          }

          if (prefs.boardRule && ['wide', 'college', 'narrow'].includes(prefs.boardRule)) {
            setBoardRule(prefs.boardRule)
            const storageKey = currentConversationId ? `thinktable-prefs-${currentConversationId}` : 'thinktable-prefs-default'
            const existingPrefs = JSON.parse(localStorage.getItem(storageKey) || '{}')
            localStorage.setItem(storageKey, JSON.stringify({ ...existingPrefs, boardRule: prefs.boardRule }))
          }

          if (prefs.boardStyle && ['none', 'dotted', 'lined', 'grid'].includes(prefs.boardStyle)) {
            setBoardStyle(prefs.boardStyle)
            const storageKey = currentConversationId ? `thinktable-prefs-${currentConversationId}` : 'thinktable-prefs-default'
            const existingPrefs = JSON.parse(localStorage.getItem(storageKey) || '{}')
            localStorage.setItem(storageKey, JSON.stringify({ ...existingPrefs, boardStyle: prefs.boardStyle }))
          }
        }
      }
    } catch (error) {
      console.error('Error loading preferences from Supabase:', error)
      // If Supabase fails, localStorage values already loaded above will be used
    }
  }, []) // State setters are stable, no need to include them in dependencies

  // Update conversationIdRef when conversationId changes (doesn't trigger save effects)
  // This allows save effects to use the current conversationId without re-running when it changes
  useEffect(() => {
    conversationIdRef.current = conversationId
  }, [conversationId])

  // Load preferences from Supabase (with localStorage fallback) after hydration
  // This ensures consistent initial render on server and client, then updates after hydration
  // Also loads when conversationId changes (navigating between boards)
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Set loading flag to prevent saves during navigation/loading
    isLoadingRef.current = true

    // Load preferences for the current board
    loadPreferencesFromSupabase(conversationId).finally(() => {
      // Clear loading flag after load completes (allows saves to proceed)
      isLoadingRef.current = false
    })
  }, [loadPreferencesFromSupabase, conversationId])

  // Also reload from Supabase when window gains focus (to catch changes made in other tabs/windows)
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleFocus = () => {
      // Set loading flag to prevent saves during reload
      isLoadingRef.current = true
      // Reload from Supabase to get latest preferences
      loadPreferencesFromSupabase(conversationId).finally(() => {
        isLoadingRef.current = false
      })
    }

    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [loadPreferencesFromSupabase, conversationId])

  // Save layout mode to localStorage and Supabase when it changes
  // If conversationId is undefined, saves to profiles.metadata (default board)
  // If conversationId exists, saves to conversations.metadata (specific board)
  // NOTE: Only runs when layoutMode changes, NOT when conversationId changes
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (isLoadingRef.current) return // Skip saves during loading/navigation to prevent overwriting wrong board

    // Use ref to get current conversationId (doesn't trigger effect when it changes)
    const currentConversationId = conversationIdRef.current

    // Save to localStorage immediately (lightweight, instant)
    const storageKey = currentConversationId ? `thinktable-prefs-${currentConversationId}` : 'thinktable-prefs-default'
    const existingPrefs = JSON.parse(localStorage.getItem(storageKey) || '{}')
    localStorage.setItem(storageKey, JSON.stringify({ ...existingPrefs, layoutMode }))

    // Also save to old key for backward compatibility
    localStorage.setItem('thinktable-layout-mode', layoutMode)

    // Save to Supabase in background (for cross-device sync)
    const saveToSupabase = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          console.warn('Cannot save layout mode: user not authenticated')
          return
        }

        if (currentConversationId) {
          // Save to conversation metadata (specific board) - only this board's preferences
          const { data: conversation, error: fetchError } = await supabase
            .from('conversations')
            .select('metadata')
            .eq('id', currentConversationId)
            .eq('user_id', user.id)
            .single()

          if (fetchError) {
            console.error('Error fetching conversation for layout mode save:', fetchError)
            return
          }

          const existingMetadata = (conversation?.metadata as Record<string, any>) || {}

          const { error: updateError } = await supabase
            .from('conversations')
            .update({
              metadata: { ...existingMetadata, layoutMode },
            })
            .eq('id', currentConversationId)
            .eq('user_id', user.id)

          if (updateError) {
            console.error('Error updating conversation layout mode:', updateError)
          } else {
            console.log(`✅ Saved layout mode "${layoutMode}" to board ${currentConversationId}`)
          }
        } else {
          // Save to profile metadata (default board /board) - only default board preferences
          const { data: profile, error: fetchError } = await supabase
            .from('profiles')
            .select('metadata')
            .eq('id', user.id)
            .single()

          if (fetchError) {
            console.error('Error fetching profile for layout mode save:', fetchError)
            return
          }

          const existingMetadata = (profile?.metadata as Record<string, any>) || {}

          const { error: updateError } = await supabase
            .from('profiles')
            .update({
              metadata: { ...existingMetadata, layoutMode },
            })
            .eq('id', user.id)

          if (updateError) {
            console.error('Error updating profile layout mode:', updateError)
          } else {
            console.log(`✅ Saved layout mode "${layoutMode}" to default board (/board)`)
          }
        }
      } catch (error) {
        console.error('Error saving layout mode to Supabase:', error)
      }
    }

    saveToSupabase()
  }, [layoutMode]) // Only run when layoutMode changes, NOT when conversationId changes

  // Save line style to localStorage and Supabase when it changes
  // If conversationId is undefined, saves to profiles.metadata (default board)
  // If conversationId exists, saves to conversations.metadata (specific board)
  // NOTE: Only runs when lineStyle changes, NOT when conversationId changes
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (isLoadingRef.current) return // Skip saves during loading/navigation to prevent overwriting wrong board

    // Use ref to get current conversationId (doesn't trigger effect when it changes)
    const currentConversationId = conversationIdRef.current

    // Save to localStorage immediately (lightweight, instant)
    const storageKey = currentConversationId ? `thinktable-prefs-${currentConversationId}` : 'thinktable-prefs-default'
    const existingPrefs = JSON.parse(localStorage.getItem(storageKey) || '{}')
    localStorage.setItem(storageKey, JSON.stringify({ ...existingPrefs, lineStyle }))

    // Also save to old key for backward compatibility
    localStorage.setItem('thinktable-line-style', lineStyle)

    // Save to Supabase in background (for cross-device sync)
    const saveToSupabase = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          console.warn('Cannot save line style: user not authenticated')
          return
        }

        if (currentConversationId) {
          // Save to conversation metadata (specific board) - only this board's preferences
          const { data: conversation, error: fetchError } = await supabase
            .from('conversations')
            .select('metadata')
            .eq('id', currentConversationId)
            .eq('user_id', user.id)
            .single()

          if (fetchError) {
            console.error('Error fetching conversation for line style save:', fetchError)
            return
          }

          const existingMetadata = (conversation?.metadata as Record<string, any>) || {}

          const { error: updateError } = await supabase
            .from('conversations')
            .update({
              metadata: { ...existingMetadata, lineStyle },
            })
            .eq('id', currentConversationId)
            .eq('user_id', user.id)

          if (updateError) {
            console.error('Error updating conversation line style:', updateError)
          } else {
            console.log(`✅ Saved line style "${lineStyle}" to board ${currentConversationId}`)
          }
        } else {
          // Save to profile metadata (default board /board) - only default board preferences
          const { data: profile, error: fetchError } = await supabase
            .from('profiles')
            .select('metadata')
            .eq('id', user.id)
            .single()

          if (fetchError) {
            console.error('Error fetching profile for line style save:', fetchError)
            return
          }

          const existingMetadata = (profile?.metadata as Record<string, any>) || {}

          const { error: updateError } = await supabase
            .from('profiles')
            .update({
              metadata: { ...existingMetadata, lineStyle },
            })
            .eq('id', user.id)

          if (updateError) {
            console.error('Error updating profile line style:', updateError)
          } else {
            console.log(`✅ Saved line style "${lineStyle}" to default board (/board)`)
          }
        }
      } catch (error) {
        console.error('Error saving line style to Supabase:', error)
      }
    }

    saveToSupabase()
  }, [lineStyle]) // Only run when lineStyle changes, NOT when conversationId changes

  // Save board rule to localStorage and Supabase when it changes
  // If conversationId is undefined, saves to profiles.metadata (default board)
  // If conversationId exists, saves to conversations.metadata (specific board)
  // NOTE: Only runs when boardRule changes, NOT when conversationId changes
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (isLoadingRef.current) return // Skip saves during loading/navigation to prevent overwriting wrong board

    // Use ref to get current conversationId (doesn't trigger effect when it changes)
    const currentConversationId = conversationIdRef.current

    // Save to localStorage immediately (lightweight, instant)
    const storageKey = currentConversationId ? `thinktable-prefs-${currentConversationId}` : 'thinktable-prefs-default'
    const existingPrefs = JSON.parse(localStorage.getItem(storageKey) || '{}')
    localStorage.setItem(storageKey, JSON.stringify({ ...existingPrefs, boardRule }))

    // Save to Supabase in background (for cross-device sync)
    const saveToSupabase = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          console.warn('Cannot save board rule: user not authenticated')
          return
        }

        if (currentConversationId) {
          // Save to conversation metadata (specific board) - only this board's preferences
          const { data: conversation, error: fetchError } = await supabase
            .from('conversations')
            .select('metadata')
            .eq('id', currentConversationId)
            .eq('user_id', user.id)
            .single()

          if (fetchError) {
            console.error('Error fetching conversation for board rule save:', fetchError)
            return
          }

          const existingMetadata = (conversation?.metadata as Record<string, any>) || {}

          const { error: updateError } = await supabase
            .from('conversations')
            .update({
              metadata: { ...existingMetadata, boardRule },
            })
            .eq('id', currentConversationId)
            .eq('user_id', user.id)

          if (updateError) {
            console.error('Error updating conversation board rule:', updateError)
          } else {
            console.log(`✅ Saved board rule "${boardRule}" to board ${currentConversationId}`)
          }
        } else {
          // Save to profile metadata (default board /board) - only default board preferences
          const { data: profile, error: fetchError } = await supabase
            .from('profiles')
            .select('metadata')
            .eq('id', user.id)
            .single()

          if (fetchError) {
            console.error('Error fetching profile for board rule save:', fetchError)
            return
          }

          const existingMetadata = (profile?.metadata as Record<string, any>) || {}

          const { error: updateError } = await supabase
            .from('profiles')
            .update({
              metadata: { ...existingMetadata, boardRule },
            })
            .eq('id', user.id)

          if (updateError) {
            console.error('Error updating profile board rule:', updateError)
          } else {
            console.log(`✅ Saved board rule "${boardRule}" to default board (/board)`)
          }
        }
      } catch (error) {
        console.error('Error saving board rule to Supabase:', error)
      }
    }

    saveToSupabase()
  }, [boardRule]) // Only run when boardRule changes, NOT when conversationId changes

  // Save board style to localStorage and Supabase when it changes
  // If conversationId is undefined, saves to profiles.metadata (default board)
  // If conversationId exists, saves to conversations.metadata (specific board)
  // NOTE: Only runs when boardStyle changes, NOT when conversationId changes
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (isLoadingRef.current) return // Skip saves during loading/navigation to prevent overwriting wrong board

    // Use ref to get current conversationId (doesn't trigger effect when it changes)
    const currentConversationId = conversationIdRef.current

    // Save to localStorage immediately (lightweight, instant)
    const storageKey = currentConversationId ? `thinktable-prefs-${currentConversationId}` : 'thinktable-prefs-default'
    const existingPrefs = JSON.parse(localStorage.getItem(storageKey) || '{}')
    localStorage.setItem(storageKey, JSON.stringify({ ...existingPrefs, boardStyle }))

    // Save to Supabase in background (for cross-device sync)
    const saveToSupabase = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          console.warn('Cannot save board style: user not authenticated')
          return
        }

        if (currentConversationId) {
          // Save to conversation metadata (specific board) - only this board's preferences
          const { data: conversation, error: fetchError } = await supabase
            .from('conversations')
            .select('metadata')
            .eq('id', currentConversationId)
            .eq('user_id', user.id)
            .single()

          if (fetchError) {
            console.error('Error fetching conversation for board style save:', fetchError)
            return
          }

          const existingMetadata = (conversation?.metadata as Record<string, any>) || {}

          const { error: updateError } = await supabase
            .from('conversations')
            .update({
              metadata: { ...existingMetadata, boardStyle },
            })
            .eq('id', currentConversationId)
            .eq('user_id', user.id)

          if (updateError) {
            console.error('Error updating conversation board style:', updateError)
          } else {
            console.log(`✅ Saved board style "${boardStyle}" to board ${currentConversationId}`)
          }
        } else {
          // Save to profile metadata (default board /board) - only default board preferences
          const { data: profile, error: fetchError } = await supabase
            .from('profiles')
            .select('metadata')
            .eq('id', user.id)
            .single()

          if (fetchError) {
            console.error('Error fetching profile for board style save:', fetchError)
            return
          }

          const existingMetadata = (profile?.metadata as Record<string, any>) || {}

          const { error: updateError } = await supabase
            .from('profiles')
            .update({
              metadata: { ...existingMetadata, boardStyle },
            })
            .eq('id', user.id)

          if (updateError) {
            console.error('Error updating profile board style:', updateError)
          } else {
            console.log(`✅ Saved board style "${boardStyle}" to default board (/board)`)
          }
        }
      } catch (error) {
        console.error('Error saving board style to Supabase:', error)
      }
    }

    saveToSupabase()
  }, [boardStyle]) // Only run when boardStyle changes, NOT when conversationId changes

  // Save arrow direction to localStorage and Supabase when it changes
  // If conversationId is undefined, saves to profiles.metadata (default board)
  // If conversationId exists, saves to conversations.metadata (specific board)
  // NOTE: Only runs when arrowDirection changes, NOT when conversationId changes
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (isLoadingRef.current) return // Skip saves during loading/navigation to prevent overwriting wrong board

    // Use ref to get current conversationId (doesn't trigger effect when it changes)
    const currentConversationId = conversationIdRef.current

    // Save to localStorage immediately (lightweight, instant)
    const storageKey = currentConversationId ? `thinktable-prefs-${currentConversationId}` : 'thinktable-prefs-default'
    const existingPrefs = JSON.parse(localStorage.getItem(storageKey) || '{}')
    localStorage.setItem(storageKey, JSON.stringify({ ...existingPrefs, arrowDirection }))

    // Also save to old key for backward compatibility
    localStorage.setItem('thinktable-arrow-direction', arrowDirection)

    // Save to Supabase in background (for cross-device sync)
    const saveToSupabase = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          console.warn('Cannot save arrow direction: user not authenticated')
          return
        }

        if (currentConversationId) {
          // Save to conversation metadata (specific board) - only this board's preferences
          const { data: conversation, error: fetchError } = await supabase
            .from('conversations')
            .select('metadata')
            .eq('id', currentConversationId)
            .eq('user_id', user.id)
            .single()

          if (fetchError) {
            console.error('Error fetching conversation for arrow direction save:', fetchError)
            return
          }

          const existingMetadata = (conversation?.metadata as Record<string, any>) || {}

          const { error: updateError } = await supabase
            .from('conversations')
            .update({
              metadata: { ...existingMetadata, arrowDirection },
            })
            .eq('id', currentConversationId)
            .eq('user_id', user.id)

          if (updateError) {
            console.error('Error updating conversation arrow direction:', updateError)
          } else {
            console.log(`✅ Saved arrow direction "${arrowDirection}" to board ${currentConversationId}`)
          }
        } else {
          // Save to profile metadata (default board /board) - only default board preferences
          const { data: profile, error: fetchError } = await supabase
            .from('profiles')
            .select('metadata')
            .eq('id', user.id)
            .single()

          if (fetchError) {
            console.error('Error fetching profile for arrow direction save:', fetchError)
            return
          }

          const existingMetadata = (profile?.metadata as Record<string, any>) || {}

          const { error: updateError } = await supabase
            .from('profiles')
            .update({
              metadata: { ...existingMetadata, arrowDirection },
            })
            .eq('id', user.id)

          if (updateError) {
            console.error('Error updating profile arrow direction:', updateError)
          } else {
            console.log(`✅ Saved arrow direction "${arrowDirection}" to default board (/board)`)
          }
        }
      } catch (error) {
        console.error('Error saving arrow direction to Supabase:', error)
      }
    }

    saveToSupabase()
  }, [arrowDirection]) // Only run when arrowDirection changes, NOT when conversationId changes

  // Reload selections from Supabase when a new conversation/board is created
  // This ensures selections made before sending the first message are preserved
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleConversationCreated = (e: Event) => {
      const customEvent = e as CustomEvent<{ conversationId: string }>
      const newConversationId = customEvent.detail?.conversationId

      if (!newConversationId) return

      // Only copy preferences if we're on /board (conversationId is undefined)
      // This ensures new boards created from /board inherit /board preferences
      // Existing boards should not be affected by /board changes
      if (conversationId !== undefined) {
        // We're on a specific board, don't copy preferences
        // Just reload the new board's own preferences immediately
        loadPreferencesFromSupabase(newConversationId)
        return
      }

      // When a new board is created from /board, copy current /board preferences to the new board
      // This ensures the new board inherits the current selections, even if they haven't been saved yet
      const copyPrefsToNewBoard = async () => {
        try {
          const supabase = createClient()
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) {
            console.warn('Cannot copy preferences to new board: user not authenticated')
            return
          }

          // Use current state values (most up-to-date, even if not yet saved)
          // These are the preferences currently shown on /board
          const currentPrefs = {
            layoutMode,
            lineStyle,
            arrowDirection,
          }

          // Copy to new board's conversation metadata
          const { data: conversation, error: fetchError } = await supabase
            .from('conversations')
            .select('metadata')
            .eq('id', newConversationId)
            .eq('user_id', user.id)
            .single()

          if (fetchError) {
            console.error('Error fetching new conversation for preference copy:', fetchError)
            return
          }

          const existingMetadata = (conversation?.metadata as Record<string, any>) || {}

          const { error: updateError } = await supabase
            .from('conversations')
            .update({
              metadata: { ...existingMetadata, ...currentPrefs },
            })
            .eq('id', newConversationId)
            .eq('user_id', user.id)

          if (updateError) {
            console.error('Error copying preferences to new board:', updateError)
          } else {
            console.log(`✅ Copied /board preferences to new board ${newConversationId}:`, currentPrefs)
          }

          // Also copy to localStorage for instant loading
          const defaultStorageKey = 'thinktable-prefs-default'
          const defaultPrefsStr = localStorage.getItem(defaultStorageKey)
          if (defaultPrefsStr) {
            localStorage.setItem(`thinktable-prefs-${newConversationId}`, defaultPrefsStr)
          } else {
            // If no default prefs in localStorage, save current state
            localStorage.setItem(`thinktable-prefs-${newConversationId}`, JSON.stringify(currentPrefs))
          }
        } catch (error) {
          console.error('Error copying preferences to new board:', error)
        }
      }

      copyPrefsToNewBoard()

      // Load immediately - localStorage already has the copied preferences (instant)
      // Supabase sync happens in background, no delay needed
      loadPreferencesFromSupabase(newConversationId)
    }

    const handleReloadPreferences = () => {
      // Set loading flag to prevent saves during reload
      isLoadingRef.current = true
      // Reload preferences when explicitly requested (e.g., from BoardFlowInner)
      loadPreferencesFromSupabase(conversationId).finally(() => {
        isLoadingRef.current = false
      })
    }

    // Also reload when pathname changes (to catch navigation)
    const handlePathnameChange = () => {
      // Set loading flag to prevent saves during reload
      isLoadingRef.current = true
      // Load immediately - localStorage is instant, Supabase syncs in background
      loadPreferencesFromSupabase(conversationId).finally(() => {
        isLoadingRef.current = false
      })
    }

    // Listen for conversation-created event
    window.addEventListener('conversation-created', handleConversationCreated)

    // Listen for explicit reload request
    window.addEventListener('reload-preferences', handleReloadPreferences)

    // Listen for pathname changes (navigation)
    window.addEventListener('popstate', handlePathnameChange)

    // Override pushState and replaceState to catch programmatic navigation
    const originalPushState = window.history.pushState
    const originalReplaceState = window.history.replaceState

    window.history.pushState = function (...args) {
      originalPushState.apply(window.history, args)
      setTimeout(handlePathnameChange, 0)
    }

    window.history.replaceState = function (...args) {
      originalReplaceState.apply(window.history, args)
      setTimeout(handlePathnameChange, 0)
    }

    return () => {
      window.removeEventListener('conversation-created', handleConversationCreated)
      window.removeEventListener('reload-preferences', handleReloadPreferences)
      window.removeEventListener('popstate', handlePathnameChange)
      window.history.pushState = originalPushState
      window.history.replaceState = originalReplaceState
    }
  }, [loadPreferencesFromSupabase])

  // Reload preferences when pathname changes (new board created or navigation)
  // Note: conversationId changes are handled in the main load effect above
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Set loading flag to prevent saves during reload
    isLoadingRef.current = true

    // Load immediately - localStorage is instant, Supabase syncs in background
    // No need for multiple retries since localStorage loads synchronously
    loadPreferencesFromSupabase(conversationId).finally(() => {
      isLoadingRef.current = false
    })
  }, [pathname, conversationId, loadPreferencesFromSupabase])

  // Also reload preferences when the component mounts (in case it re-mounts on navigation)
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Set loading flag to prevent saves during reload
    isLoadingRef.current = true

    // Load immediately - localStorage is instant, Supabase syncs in background
    loadPreferencesFromSupabase(conversationId).finally(() => {
      isLoadingRef.current = false
    })
  }, [loadPreferencesFromSupabase, conversationId])

  // Sync deterministic mapping state with layoutMode
  // None = no branching (disabled), Auto/Tree/Cluster = branching (enabled)
  useEffect(() => {
    setIsDeterministicMapping(layoutMode !== 'none')
  }, [layoutMode])

  // Getter function to access the ref value
  const getSetNodes = useCallback(() => setNodesRef.current, [])

  // Registration function that updates the ref (doesn't trigger re-render)
  const registerSetNodes = useCallback((fn: ((nodes: any) => void) | undefined) => {
    setNodesRef.current = fn
  }, [])

  // Map undo function - calls the registered undo from BoardFlow
  const mapUndo = useCallback(() => {
    mapUndoRedoRef.current.undo()
  }, [])

  // Map redo function - calls the registered redo from BoardFlow
  const mapRedo = useCallback(() => {
    mapUndoRedoRef.current.redo()
  }, [])

  // Registration function for undo/redo from BoardFlow (updates ref and triggers state for button disabled states)
  const registerMapUndoRedo = useCallback((fns: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean }) => {
    mapUndoRedoRef.current = fns
    // Update state to trigger re-render for button disabled states
    setMapUndoRedoState({ canUndo: fns.canUndo, canRedo: fns.canRedo })
  }, [])

  // Getter for takeSnapshot function
  const getMapTakeSnapshot = useCallback(() => mapTakeSnapshotRef.current, [])

  // Registration function for takeSnapshot from BoardFlow
  const registerMapTakeSnapshot = useCallback((fn: () => void) => {
    mapTakeSnapshotRef.current = fn
  }, [])

  return (
    <ReactFlowContext.Provider value={{ reactFlowInstance, setReactFlowInstance, getSetNodes, registerSetNodes, isLocked, setIsLocked, layoutMode, setLayoutMode, isDeterministicMapping, setIsDeterministicMapping, panelWidth, setPanelWidth, isPromptBoxCentered, setIsPromptBoxCentered, lineStyle, setLineStyle, arrowDirection, setArrowDirection, editMenuPillMode, setEditMenuPillMode, viewMode, boardRule, setBoardRule, boardStyle, setBoardStyle, fillColor, setFillColor, borderColor, setBorderColor, borderWeight, setBorderWeight, borderStyle, setBorderStyle, clickedEdge, setClickedEdge, flashcardMode, setFlashcardMode, selectedTag, setSelectedTag: toggleSelectedTag, isDrawing, setIsDrawing, drawTool, setDrawTool, drawShape, setDrawShape, mapUndo, mapRedo, canMapUndo: mapUndoRedoState.canUndo, canMapRedo: mapUndoRedoState.canRedo, registerMapUndoRedo, getMapTakeSnapshot, registerMapTakeSnapshot }}>
      {children}
    </ReactFlowContext.Provider>
  )
}

export function useReactFlowContext() {
  const context = useContext(ReactFlowContext)
  if (context === undefined) {
    // Return null values if context is not available (graceful degradation)
    return { reactFlowInstance: null, setReactFlowInstance: () => { }, getSetNodes: () => undefined, registerSetNodes: () => { }, isLocked: false, setIsLocked: () => { }, layoutMode: 'auto' as const, setLayoutMode: () => { }, isDeterministicMapping: false, setIsDeterministicMapping: () => { }, panelWidth: 768, setPanelWidth: () => { }, isPromptBoxCentered: false, setIsPromptBoxCentered: () => { }, lineStyle: 'solid' as const, setLineStyle: () => { }, arrowDirection: 'down' as const, setArrowDirection: () => { }, editMenuPillMode: 'home' as const, setEditMenuPillMode: () => { }, viewMode: 'canvas' as const, boardRule: 'college' as const, setBoardRule: () => { }, boardStyle: 'none' as const, setBoardStyle: () => { }, fillColor: '#ffffff', setFillColor: () => { }, borderColor: '#000000', setBorderColor: () => { }, borderWeight: 1, setBorderWeight: () => { }, borderStyle: 'solid' as const, setBorderStyle: () => { }, clickedEdge: null, setClickedEdge: () => { }, flashcardMode: null, setFlashcardMode: () => { }, selectedTag: null, setSelectedTag: () => { }, isDrawing: false, setIsDrawing: () => { }, drawTool: null, setDrawTool: () => { }, drawShape: 'rectangle' as const, setDrawShape: () => { }, mapUndo: () => { }, mapRedo: () => { }, canMapUndo: false, canMapRedo: false, registerMapUndoRedo: () => { }, getMapTakeSnapshot: () => undefined, registerMapTakeSnapshot: () => { } }
  }
  return context
}

