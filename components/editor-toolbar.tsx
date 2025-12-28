'use client'
// Force recompile to fix hydration mismatch

// TipTap editor toolbar component - matches the agent editor example
import { Editor } from '@tiptap/react'
import { Button } from './ui/button'
import { useReactFlowContext } from './react-flow-context'
import { useState, useEffect, useRef } from 'react'
import { Input } from './ui/input'
import { useRouter } from 'next/navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from './ui/dropdown-menu'
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Highlighter,
  Plus,
  Minus,
  ChevronDown,
  List,
  Lock,
  Unlock,
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  MoreVertical,
  Pencil,
  MessageSquare,
  Eye,
  Undo2,
  Redo2,
  Paintbrush,
  Share2,
  RotateCcw,
  PaintBucket,
  LassoSelect,
  Eraser,
  GripVertical,
  GripHorizontal,
  Circle,
  Shapes,
  Grid3x3,
  Table,
  File,
  Camera,
  Link as LinkIcon,
  Hash,
  Calendar,
  FileText,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'

interface EditorToolbarProps {
  editor: Editor | null
  conversationId?: string
}

export function EditorToolbar({ editor, conversationId }: EditorToolbarProps) {
  const { reactFlowInstance, isLocked, setIsLocked, layoutMode, setLayoutMode, lineStyle: verticalLineStyle, setLineStyle: setVerticalLineStyle, arrowDirection, setArrowDirection, editMenuPillMode, viewMode, boardRule, setBoardRule, boardStyle, setBoardStyle, fillColor, setFillColor, borderColor, setBorderColor, borderWeight, setBorderWeight, borderStyle, setBorderStyle, clickedEdge } = useReactFlowContext()
  const borderStyleButtonRef = useRef<HTMLButtonElement>(null)
  const borderStyleIconRef = useRef<HTMLImageElement>(null)
  const threadStyleButtonRef = useRef<HTMLButtonElement>(null)
  const threadStyleIconRef = useRef<HTMLImageElement>(null)
  const insertVerticalSpaceButtonRef = useRef<HTMLButtonElement>(null)
  const insertVerticalSpaceIconRef = useRef<HTMLImageElement>(null)
  const insertHorizontalSpaceButtonRef = useRef<HTMLButtonElement>(null)
  const insertHorizontalSpaceIconRef = useRef<HTMLImageElement>(null)
  
  // Track which dropdown is currently open - only one can be open at a time
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  
  // Handler to manage dropdown open state - closes other dropdowns when one opens
  const handleDropdownOpenChange = (dropdownId: string, isOpen: boolean) => {
    setOpenDropdown(isOpen ? dropdownId : null)
  }

  // Update border style icon color based on hover and selected state
  useEffect(() => {
    const button = borderStyleButtonRef.current
    const icon = borderStyleIconRef.current
    if (!button || !icon) return

    const handleMouseEnter = () => {
      // Dark color (matches text-gray-900 / black)
      icon.style.filter = 'brightness(0) saturate(100%) invert(0%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(0%) contrast(100%)'
      icon.style.opacity = '1'
    }

    const handleMouseLeave = () => {
      const isOpen = button.getAttribute('data-state') === 'open'
      if (!isOpen) {
        // Default gray color (matches text-gray-600)
        icon.style.filter = 'brightness(0) saturate(100%) invert(38%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(98%) contrast(100%)'
        icon.style.opacity = '0.8'
      }
    }

    const updateIconColor = () => {
      const isOpen = button.getAttribute('data-state') === 'open'
      if (isOpen) {
        // Dark color when dropdown is open
        icon.style.filter = 'brightness(0) saturate(100%) invert(0%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(0%) contrast(100%)'
        icon.style.opacity = '1'
      } else {
        // Default gray color when dropdown is closed
        icon.style.filter = 'brightness(0) saturate(100%) invert(38%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(98%) contrast(100%)'
        icon.style.opacity = '0.8'
      }
    }

    // Watch for data-state changes (dropdown open/close)
    const observer = new MutationObserver(updateIconColor)
    observer.observe(button, {
      attributes: true,
      attributeFilter: ['data-state']
    })

    // Watch for hover state
    button.addEventListener('mouseenter', handleMouseEnter)
    button.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      observer.disconnect()
      button.removeEventListener('mouseenter', handleMouseEnter)
      button.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [])

  // Update thread style icon color based on hover and selected state
  useEffect(() => {
    const button = threadStyleButtonRef.current
    const icon = threadStyleIconRef.current
    if (!button || !icon) return

    const handleMouseEnter = () => {
      // Dark color (matches text-gray-900 / black)
      icon.style.filter = 'brightness(0) saturate(100%) invert(0%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(0%) contrast(100%)'
      icon.style.opacity = '1'
    }

    const handleMouseLeave = () => {
      const isOpen = button.getAttribute('data-state') === 'open'
      if (!isOpen) {
        // Default gray color (matches text-gray-600)
        icon.style.filter = 'brightness(0) saturate(100%) invert(38%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(98%) contrast(100%)'
        icon.style.opacity = '0.8'
      }
    }

    const updateIconColor = () => {
      const isOpen = button.getAttribute('data-state') === 'open'
      if (isOpen) {
        // Dark color when dropdown is open
        icon.style.filter = 'brightness(0) saturate(100%) invert(0%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(0%) contrast(100%)'
        icon.style.opacity = '1'
      } else {
        // Default gray color when dropdown is closed
        icon.style.filter = 'brightness(0) saturate(100%) invert(38%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(98%) contrast(100%)'
        icon.style.opacity = '0.8'
      }
    }

    // Watch for data-state changes (dropdown open/close)
    const observer = new MutationObserver(updateIconColor)
    observer.observe(button, {
      attributes: true,
      attributeFilter: ['data-state']
    })

    // Watch for hover state
    button.addEventListener('mouseenter', handleMouseEnter)
    button.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      observer.disconnect()
      button.removeEventListener('mouseenter', handleMouseEnter)
      button.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [])

  // Handlers for insert space icon color changes
  const handleInsertVerticalSpaceMouseEnter = () => {
    const icon = insertVerticalSpaceIconRef.current
    if (icon) {
      icon.style.filter = 'brightness(0) saturate(100%) invert(0%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(0%) contrast(100%)'
      icon.style.opacity = '1'
    }
  }

  const handleInsertVerticalSpaceMouseLeave = () => {
    const icon = insertVerticalSpaceIconRef.current
    if (icon) {
      icon.style.filter = 'brightness(0) saturate(100%) invert(38%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(98%) contrast(100%)'
      icon.style.opacity = '0.8'
    }
  }

  const handleInsertHorizontalSpaceMouseEnter = () => {
    const icon = insertHorizontalSpaceIconRef.current
    if (icon) {
      icon.style.filter = 'brightness(0) saturate(100%) invert(0%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(0%) contrast(100%)'
      icon.style.opacity = '1'
    }
  }

  const handleInsertHorizontalSpaceMouseLeave = () => {
    const icon = insertHorizontalSpaceIconRef.current
    if (icon) {
      icon.style.filter = 'brightness(0) saturate(100%) invert(38%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(98%) contrast(100%)'
      icon.style.opacity = '0.8'
    }
  }

  // Default values for settings
  const DEFAULT_BOARD_RULE: 'wide' | 'college' | 'narrow' = 'college'
  const DEFAULT_BOARD_STYLE: 'none' | 'dotted' | 'lined' | 'grid' = 'none'
  const DEFAULT_FILL_COLOR = '#ffffff'
  const DEFAULT_BORDER_COLOR = '#000000'
  const DEFAULT_BORDER_WEIGHT = 1
  const DEFAULT_BORDER_STYLE: 'solid' | 'dashed' | 'dotted' | 'none' = 'solid'

  // Check if any settings differ from defaults
  const hasNonDefaultSettings = 
    boardRule !== DEFAULT_BOARD_RULE ||
    boardStyle !== DEFAULT_BOARD_STYLE ||
    fillColor !== DEFAULT_FILL_COLOR ||
    borderColor !== DEFAULT_BORDER_COLOR ||
    borderWeight !== DEFAULT_BORDER_WEIGHT ||
    borderStyle !== DEFAULT_BORDER_STYLE

  // Reset all settings to defaults
  const handleResetToDefault = () => {
    setBoardRule(DEFAULT_BOARD_RULE)
    setBoardStyle(DEFAULT_BOARD_STYLE)
    setFillColor(DEFAULT_FILL_COLOR)
    setBorderColor(DEFAULT_BORDER_COLOR)
    setBorderWeight(DEFAULT_BORDER_WEIGHT)
    setBorderStyle(DEFAULT_BORDER_STYLE)
  }

  // Hide formatting options (clear formatting to line options) when insert/draw/view mode is selected
  const shouldHideFormattingOptions = editMenuPillMode !== 'home' // Hide when not in 'home' mode

  const [zoom, setZoom] = useState(1)
  const [isEditingZoom, setIsEditingZoom] = useState(false)
  const [zoomEditValue, setZoomEditValue] = useState('100')
  const zoomInputRef = useRef<HTMLInputElement>(null)
  // Initialize with consistent defaults to avoid hydration mismatch, then load from Supabase
  const [lineStyle, setLineStyle] = useState<'curved' | 'boxed'>('curved')
  const [editMode, setEditMode] = useState<'editing' | 'suggesting' | 'viewing'>('editing')
  const [drawTool, setDrawTool] = useState<'lasso' | 'pencil' | 'highlighter' | 'eraser'>('pencil') // Current drawing tool
  const [drawColor, setDrawColor] = useState<'black' | 'blue' | 'green' | 'red'>('black') // Current drawing color
  const [drawShape, setDrawShape] = useState<'rectangle' | 'circle' | 'line' | 'arrow'>('rectangle') // Current shape
  const [hiddenItems, setHiddenItems] = useState<Set<string>>(new Set())
  const preferencesLoadedRef = useRef(false) // Track if preferences have been loaded
  const toolbarRef = useRef<HTMLDivElement>(null)
  const leftSectionRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()
  const queryClient = useQueryClient()
  const router = useRouter()

  // Handle creating a new note (component panel)
  const handleCreateNote = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      let currentConversationId = conversationId

      // If no conversation ID, create a new conversation first
      if (!currentConversationId) {
        // Set position to -1 to ensure it appears at the top of the sidebar list
        const { data: newConversation, error: convError } = await supabase
          .from('conversations')
          .insert({
            user_id: user.id,
            title: 'New Conversation',
            metadata: { position: -1 }, // Set position to -1 to appear at top
          })
          .select()
          .single()

        if (convError) {
          throw new Error('Failed to create conversation: ' + convError.message)
        }

        currentConversationId = newConversation.id

        // Update URL to include conversation ID (like ChatGPT)
        router.replace(`/board/${currentConversationId}`)
        // Dispatch event to notify board page of new conversation
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('conversation-created', { detail: { conversationId: currentConversationId } }))
        }
      }

      // Create a new message with role 'user' and empty content (will be editable)
      // Mark it as a note in metadata so it renders as a simple note node, not a full chat panel
      const { data: newMessage, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: currentConversationId,
          user_id: user.id,
          role: 'user',
          content: '', // Empty content to start
          metadata: { isNote: true }, // Mark as note to distinguish from regular chat panels
        })
        .select()
        .single()

      if (error) {
        throw new Error(error.message || 'Failed to create component')
      }

      // Invalidate queries to refresh the board
      await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', currentConversationId] })

      // Trigger refetch
      setTimeout(() => {
        queryClient.refetchQueries({ queryKey: ['messages-for-panels', currentConversationId] })
      }, 200)
    } catch (error) {
      console.error('Failed to create note:', error)
    }
  }

  // Handle creating a new flashcard (prompt + response panel)
  const handleCreateFlashcard = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      let currentConversationId = conversationId

      // If no conversation ID, create a new conversation first
      if (!currentConversationId) {
        // Set position to -1 to ensure it appears at the top of the sidebar list
        const { data: newConversation, error: convError } = await supabase
          .from('conversations')
          .insert({
            user_id: user.id,
            title: 'New Conversation',
            metadata: { position: -1 }, // Set position to -1 to appear at top
          })
          .select()
          .single()

        if (convError) {
          throw new Error('Failed to create conversation: ' + convError.message)
        }

        currentConversationId = newConversation.id

        // Update URL to include conversation ID (like ChatGPT)
        router.replace(`/board/${currentConversationId}`)
        // Dispatch event to notify board page of new conversation
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('conversation-created', { detail: { conversationId: currentConversationId } }))
        }
      }

      // Create user message (prompt) with flashcard metadata
      const { data: promptMessage, error: promptError } = await supabase
        .from('messages')
        .insert({
          conversation_id: currentConversationId,
          user_id: user.id,
          role: 'user',
          content: '', // Empty content
          metadata: { isFlashcard: true }, // Mark as flashcard
        })
        .select()
        .single()

      if (promptError) {
        throw new Error('Failed to create flashcard prompt: ' + promptError.message)
      }

      // Create assistant message (response) with empty content
      const { data: responseMessage, error: responseError } = await supabase
        .from('messages')
        .insert({
          conversation_id: currentConversationId,
          user_id: user.id,
          role: 'assistant',
          content: '', // Empty content
        })
        .select()
        .single()

      if (responseError) {
        throw new Error('Failed to create flashcard response: ' + responseError.message)
      }

      // Invalidate queries to refresh the board
      await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', currentConversationId] })

      // Trigger refetch
      setTimeout(() => {
        queryClient.refetchQueries({ queryKey: ['messages-for-panels', currentConversationId] })
      }, 200)
    } catch (error) {
      console.error('Failed to create flashcard:', error)
    }
  }

  // Load preferences from localStorage first (instant), then Supabase (sync)
  useEffect(() => {
    if (typeof window === 'undefined') return

    // STEP 1: Load from localStorage FIRST (synchronous, instant) - ensures UI shows saved prefs immediately
    const savedLineStyle = localStorage.getItem('thinkable-horizontal-line-style') as 'curved' | 'boxed' | null
    if (savedLineStyle && ['curved', 'boxed'].includes(savedLineStyle)) {
      setLineStyle(savedLineStyle)
    }

    const savedEditMode = localStorage.getItem('thinkable-edit-mode') as 'editing' | 'suggesting' | 'viewing' | null
    if (savedEditMode && ['editing', 'suggesting', 'viewing'].includes(savedEditMode)) {
      setEditMode(savedEditMode)
    }

    preferencesLoadedRef.current = true // Mark as loaded so we can save changes

    // STEP 2: Then load from Supabase (async) and update if different (for cross-device sync)
    const loadPreferences = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('metadata')
            .eq('id', user.id)
            .single()

          if (profile?.metadata) {
            const prefs = profile.metadata as {
              horizontalLineStyle?: 'curved' | 'boxed'
              editMode?: 'editing' | 'suggesting' | 'viewing'
            }

            // Update from Supabase if values exist (Supabase is source of truth for cross-device sync)
            if (prefs.horizontalLineStyle && ['curved', 'boxed'].includes(prefs.horizontalLineStyle)) {
              setLineStyle(prefs.horizontalLineStyle)
              localStorage.setItem('thinkable-horizontal-line-style', prefs.horizontalLineStyle)
            }

            if (prefs.editMode && ['editing', 'suggesting', 'viewing'].includes(prefs.editMode)) {
              setEditMode(prefs.editMode)
              localStorage.setItem('thinkable-edit-mode', prefs.editMode)
            }
          }
        }
      } catch (error) {
        console.error('Error loading preferences from Supabase:', error)
        // If Supabase fails, localStorage values already loaded above will be used
      }
    }

    loadPreferences()

    // Also reload when conversation is created (to maintain selections on new boards)
    const handleConversationCreated = async () => {
      // Load from localStorage first (instant)
      const savedLineStyle = localStorage.getItem('thinkable-horizontal-line-style') as 'curved' | 'boxed' | null
      if (savedLineStyle && ['curved', 'boxed'].includes(savedLineStyle)) {
        setLineStyle(savedLineStyle)
      }

      const savedEditMode = localStorage.getItem('thinkable-edit-mode') as 'editing' | 'suggesting' | 'viewing' | null
      if (savedEditMode && ['editing', 'suggesting', 'viewing'].includes(savedEditMode)) {
        setEditMode(savedEditMode)
      }

      // Then load from Supabase (async) and update if different - no delay needed, localStorage already loaded
      const loadFromSupabase = async () => {
        try {
          const { data: { user } } = await supabase.auth.getUser()
          if (user) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('metadata')
              .eq('id', user.id)
              .single()

            if (profile?.metadata) {
              const prefs = profile.metadata as {
                horizontalLineStyle?: 'curved' | 'boxed'
                editMode?: 'editing' | 'suggesting' | 'viewing'
              }

              // Update from Supabase if values exist
              if (prefs.horizontalLineStyle && ['curved', 'boxed'].includes(prefs.horizontalLineStyle)) {
                setLineStyle(prefs.horizontalLineStyle)
                localStorage.setItem('thinkable-horizontal-line-style', prefs.horizontalLineStyle)
              }

              if (prefs.editMode && ['editing', 'suggesting', 'viewing'].includes(prefs.editMode)) {
                setEditMode(prefs.editMode)
                localStorage.setItem('thinkable-edit-mode', prefs.editMode)
              }
            }
          }
        } catch (error) {
          console.error('Error loading preferences from Supabase:', error)
        }
      }

      loadFromSupabase()
    }

    window.addEventListener('conversation-created', handleConversationCreated)

    return () => {
      window.removeEventListener('conversation-created', handleConversationCreated)
    }
  }, [supabase])

  // Save horizontal line style to localStorage and Supabase when it changes
  useEffect(() => {
    if (!preferencesLoadedRef.current) return // Don't save before loading
    if (typeof window === 'undefined') return

    // Save to localStorage immediately (lightweight, instant)
    localStorage.setItem('thinkable-horizontal-line-style', lineStyle)

    // Save to Supabase in background (for cross-device sync)
    const saveToSupabase = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          // Get existing metadata to merge
          const { data: profile } = await supabase
            .from('profiles')
            .select('metadata')
            .eq('id', user.id)
            .single()

          const existingMetadata = profile?.metadata || {}

          // Update metadata with new horizontal line style
          await supabase
            .from('profiles')
            .update({
              metadata: { ...existingMetadata, horizontalLineStyle: lineStyle },
            })
            .eq('id', user.id)
        }
      } catch (error) {
        console.error('Error saving horizontal line style to Supabase:', error)
      }
    }

    saveToSupabase()
  }, [lineStyle, supabase])

  // Save edit mode to localStorage and Supabase when it changes
  useEffect(() => {
    if (!preferencesLoadedRef.current) return // Don't save before loading
    if (typeof window === 'undefined') return

    // Save to localStorage immediately (lightweight, instant)
    localStorage.setItem('thinkable-edit-mode', editMode)

    // Save to Supabase in background (for cross-device sync)
    const saveToSupabase = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          // Get existing metadata to merge
          const { data: profile } = await supabase
            .from('profiles')
            .select('metadata')
            .eq('id', user.id)
            .single()

          const existingMetadata = profile?.metadata || {}

          // Update metadata with new edit mode
          await supabase
            .from('profiles')
            .update({
              metadata: { ...existingMetadata, editMode },
            })
            .eq('id', user.id)
        }
      } catch (error) {
        console.error('Error saving edit mode to Supabase:', error)
      }
    }

    saveToSupabase()
  }, [editMode, supabase])

  // Update zoom display periodically and on mount
  // Also snap to 100% when zoom is close to 100%
  useEffect(() => {
    if (!reactFlowInstance) return

    const updateZoom = () => {
      if (!isEditingZoom) { // Don't update if user is editing
        const viewport = reactFlowInstance.getViewport()
        const currentZoom = viewport.zoom

        // Snap to 100% if zoom is within 2% of 100% (between 0.98 and 1.02)
        if (currentZoom >= 0.98 && currentZoom <= 1.02 && currentZoom !== 1) {
          reactFlowInstance.setViewport({
            x: viewport.x,
            y: viewport.y,
            zoom: 1,
          }, { duration: 150 }) // Smooth snap animation
          setZoom(1)
          setZoomEditValue('100')
        } else {
          setZoom(currentZoom)
          setZoomEditValue(Math.round(currentZoom * 100).toString())
        }
      }
    }

    // Initial zoom
    updateZoom()

    // Update zoom periodically to catch external changes
    const interval = setInterval(updateZoom, 100) // Check every 100ms

    return () => {
      clearInterval(interval)
    }
  }, [reactFlowInstance, isEditingZoom])

  const handleZoomInputFocus = () => {
    setIsEditingZoom(true)
    setZoomEditValue(Math.round(zoom * 100).toString())
    setTimeout(() => {
      zoomInputRef.current?.select()
    }, 0)
  }

  const handleZoomInputBlur = () => {
    setIsEditingZoom(false)
    const numericValue = parseFloat(zoomEditValue)
    if (!isNaN(numericValue) && reactFlowInstance) {
      const newZoom = Math.max(0.1, Math.min(2, numericValue / 100))
      const viewport = reactFlowInstance.getViewport()
      reactFlowInstance.setViewport({
        x: viewport.x,
        y: viewport.y,
        zoom: newZoom,
      })
      setZoom(newZoom)
      setZoomEditValue(Math.round(newZoom * 100).toString())
    } else {
      setZoomEditValue(Math.round(zoom * 100).toString())
    }
  }

  const handleZoomInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      zoomInputRef.current?.blur()
    } else if (e.key === 'Escape') {
      setZoomEditValue(Math.round(zoom * 100).toString())
      zoomInputRef.current?.blur()
    }
  }

  const handleZoomInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setZoomEditValue(e.target.value)
  }

  const handleZoomChange = (zoomValue: number | 'fit') => {
    if (!reactFlowInstance) return

    if (zoomValue === 'fit') {
      // Fit view - check if top bar and input box are visible to adjust fitView padding
      const topBar = document.querySelector('[class*="bg-white"][class*="shadow-sm"][class*="border-b"]') as HTMLElement
      const inputBox = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]')?.closest('[class*="pointer-events-auto"]') as HTMLElement
      const reactFlowElement = document.querySelector('.react-flow') as HTMLElement

      let topPadding = 0
      let bottomPadding = 0

      if (topBar && reactFlowElement) {
        const topBarHeight = topBar.offsetHeight
        const reactFlowHeight = reactFlowElement.offsetHeight
        if (topBarHeight > 0) {
          topPadding = topBarHeight / reactFlowHeight
        }
      }

      if (inputBox && reactFlowElement) {
        const inputBoxRect = inputBox.getBoundingClientRect()
        const reactFlowRect = reactFlowElement.getBoundingClientRect()
        const inputBoxHeight = reactFlowRect.bottom - inputBoxRect.top + 16
        const reactFlowHeight = reactFlowElement.offsetHeight
        if (inputBoxHeight > 0 && inputBoxHeight < reactFlowHeight) {
          bottomPadding = inputBoxHeight / reactFlowHeight
        }
      }

      const uiPadding = Math.max(topPadding, bottomPadding, 0.05)

      // Calculate prompt box center position first (before any viewport changes)
      let promptBoxCenterX: number | null = null
      if (inputBox && reactFlowElement) {
        const inputBoxRect = inputBox.getBoundingClientRect()
        const reactFlowRect = reactFlowElement.getBoundingClientRect()
        // Calculate prompt box center relative to React Flow container
        promptBoxCenterX = (inputBoxRect.left + inputBoxRect.right) / 2 - reactFlowRect.left
      }

      // Get all nodes to calculate content bounds
      const nodes = reactFlowInstance.getNodes()
      if (nodes.length === 0) {
        // No nodes, just do regular fitView
        reactFlowInstance.fitView({ padding: uiPadding, minZoom: 0.1, maxZoom: 1, duration: 300 })
        return
      }

      // Calculate bounds manually from nodes
      const panelWidth = 768 // Standard panel width
      const panelHeight = 400 // Estimated panel height

      // Find min/max positions
      const minX = Math.min(...nodes.map(n => n.position.x))
      const maxX = Math.max(...nodes.map(n => n.position.x + panelWidth))
      const minY = Math.min(...nodes.map(n => n.position.y))
      const maxY = Math.max(...nodes.map(n => n.position.y + panelHeight))

      // Calculate content dimensions from bounds
      const contentWidth = maxX - minX
      const contentHeight = maxY - minY
      const contentCenterX = minX + contentWidth / 2
      const contentCenterY = minY + contentHeight / 2

      // Get React Flow container dimensions (ensure we have valid dimensions)
      const reactFlowWidth = reactFlowElement?.clientWidth || 0
      const reactFlowHeight = reactFlowElement?.clientHeight || 0

      if (reactFlowWidth === 0 || reactFlowHeight === 0) {
        // Fallback if dimensions are invalid
        reactFlowInstance.fitView({ padding: uiPadding, minZoom: 0.1, maxZoom: 1, duration: 300 })
        return
      }

      // Calculate available space (accounting for padding)
      const availableWidth = reactFlowWidth * (1 - uiPadding * 2)
      const availableHeight = reactFlowHeight * (1 - uiPadding * 2)

      // Calculate zoom to fit content (same logic as fitView)
      const zoomX = availableWidth / contentWidth
      const zoomY = availableHeight / contentHeight
      let calculatedZoom = Math.min(zoomX, zoomY)

      // Apply min/max zoom constraints based on view mode
      const minZoom = viewMode === 'linear' ? 0.1 : 0.3
      calculatedZoom = Math.max(minZoom, Math.min(1, calculatedZoom)) // Cap at 100% (1.0)

      // Calculate viewport Y to center content vertically (same as fitView)
      // Formula: screenY = worldY * zoom + viewportY
      // We want content center Y to be at screen center Y
      // screenCenterY = reactFlowHeight / 2
      // contentCenterY * zoom + viewportY = screenCenterY
      // viewportY = screenCenterY - contentCenterY * zoom
      const screenCenterY = reactFlowHeight / 2
      const targetViewportY = screenCenterY - contentCenterY * calculatedZoom

      // Calculate viewport X to center content on prompt box (not screen center)
      // Formula: screenX = worldX * zoom + viewportX
      // We want: contentCenterX * zoom + viewportX = promptBoxCenterX
      // So: viewportX = promptBoxCenterX - contentCenterX * zoom
      // Recalculate prompt box center right before using it to ensure we have the latest position
      let finalPromptBoxCenterX: number | null = null
      if (inputBox && reactFlowElement) {
        const inputBoxRect = inputBox.getBoundingClientRect()
        const reactFlowRect = reactFlowElement.getBoundingClientRect()
        // Calculate prompt box center relative to React Flow container (screen coordinates)
        finalPromptBoxCenterX = (inputBoxRect.left + inputBoxRect.right) / 2 - reactFlowRect.left
      }

      // If we couldn't find the prompt box, fall back to screen center
      const targetViewportX = finalPromptBoxCenterX !== null
        ? finalPromptBoxCenterX - contentCenterX * calculatedZoom
        : (reactFlowWidth / 2) - contentCenterX * calculatedZoom

      // Dispatch custom event to signal fit view is starting (so board-flow.tsx can set fitViewInProgressRef)
      window.dispatchEvent(new CustomEvent('fit-view-start'))

      // Use requestAnimationFrame to ensure DOM is fully laid out, then set viewport
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!reactFlowInstance) {
            window.dispatchEvent(new CustomEvent('fit-view-end'))
            return
          }

          // Re-verify elements exist right before setting viewport
          const currentInputBox = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]')?.closest('[class*="pointer-events-auto"]') as HTMLElement
          const currentReactFlowElement = document.querySelector('.react-flow') as HTMLElement

          if (currentInputBox && currentReactFlowElement) {
            // Recalculate prompt box center one more time to ensure accuracy
            const inputBoxRect = currentInputBox.getBoundingClientRect()
            const reactFlowRect = currentReactFlowElement.getBoundingClientRect()
            const currentPromptBoxCenterX = (inputBoxRect.left + inputBoxRect.right) / 2 - reactFlowRect.left

            // Recalculate viewport X with the latest prompt box position
            // Formula: screenX = worldX * zoom + viewportX
            // We want: contentCenterX * zoom + viewportX = promptBoxCenterX
            // So: viewportX = promptBoxCenterX - contentCenterX * zoom
            const finalViewportX = currentPromptBoxCenterX - contentCenterX * calculatedZoom

            // Debug logging (remove in production)
            console.log('Fit View Debug:', {
              promptBoxCenterX: currentPromptBoxCenterX,
              contentCenterX,
              calculatedZoom,
              finalViewportX,
              reactFlowWidth: reactFlowRect.width,
              reactFlowHeight: reactFlowRect.height
            })

            // Set viewport with calculated zoom and position (centered on prompt box)
            reactFlowInstance.setViewport({
              x: finalViewportX,
              y: targetViewportY,
              zoom: calculatedZoom
            }, { duration: 300 }) // Smooth animation
          } else {
            // Fallback if elements not found - use calculated values
            console.warn('Fit View: Could not find input box or React Flow element')
            reactFlowInstance.setViewport({
              x: targetViewportX,
              y: targetViewportY,
              zoom: calculatedZoom
            }, { duration: 300 })
          }

          // Clear the fit view flag after animation completes
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('fit-view-end'))
          }, 350)
        })
      })
    } else {
      // Set specific zoom level - snap to 100% if close
      let finalZoom = zoomValue
      if (zoomValue >= 0.98 && zoomValue <= 1.02) {
        finalZoom = 1
      }

      const viewport = reactFlowInstance.getViewport()
      reactFlowInstance.setViewport({
        x: viewport.x,
        y: viewport.y,
        zoom: finalZoom,
      }, finalZoom !== zoomValue ? { duration: 150 } : undefined) // Smooth snap if snapping
    }

    // Update zoom display
    setTimeout(() => {
      const viewport = reactFlowInstance.getViewport()
      setZoom(viewport.zoom)
    }, 10)
  }

  const handleToggleLock = () => {
    if (!reactFlowInstance) return

    // Get current nodes to check for selected ones
    const nodes = reactFlowInstance.getNodes()
    const selectedNodes = nodes.filter(node => node.selected)

    if (selectedNodes.length > 0) {
      // Lock/unlock only selected nodes
      // Check if selected nodes are currently locked (both draggable and connectable are false)
      const selectedNodeIds = new Set(selectedNodes.map(n => n.id))
      const areSelectedLocked = selectedNodes.every(node => node.draggable === false && node.connectable === false)

      // Get viewMode from localStorage or default to 'canvas'
      const viewMode = (typeof window !== 'undefined')
        ? (localStorage.getItem('thinkable-view-mode') as 'linear' | 'canvas' | null) || 'canvas'
        : 'canvas'

      reactFlowInstance.setNodes((currentNodes) =>
        currentNodes.map((node) => {
          if (selectedNodeIds.has(node.id)) {
            // Toggle lock state for selected nodes
            return {
              ...node,
              draggable: areSelectedLocked ? (viewMode === 'canvas') : false,
              connectable: areSelectedLocked ? true : false,
            }
          }
          return node
        })
      )
    } else {
      // No selected nodes - toggle global lock state
      setIsLocked(!isLocked)
    }
  }

  // Update panel styling when fillColor, borderColor, borderStyle, or borderWeight changes
  // Apply to selected panels or panels connected to selected edge
  // Also save to database (message metadata)
  useEffect(() => {
    if (!reactFlowInstance) return

    const nodes = reactFlowInstance.getNodes()
    const edges = reactFlowInstance.getEdges()

    // Determine which panels to update
    const panelsToUpdate = new Set<string>()

    // First, check for selected panels
    const selectedNodes = nodes.filter(node => node.selected)
    selectedNodes.forEach(node => panelsToUpdate.add(node.id))

    // Second, check for panels connected to selected edge
    if (clickedEdge) {
      // Find panels directly connected to the edge (source and target)
      panelsToUpdate.add(clickedEdge.source)
      panelsToUpdate.add(clickedEdge.target)
    }

    // If no panels to update, don't do anything
    if (panelsToUpdate.size === 0) return

    // Update panels with new styling
    reactFlowInstance.setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (panelsToUpdate.has(node.id)) {
          return {
            ...node,
            data: {
              ...node.data,
              fillColor: fillColor, // Update fill color
              borderColor: borderColor, // Update border color
              borderStyle: borderStyle, // Update border style
              borderWeight: borderWeight ? `${borderWeight}px` : undefined, // Update border weight (convert number to string)
            },
          }
        }
        return node
      })
    )

    // Save panel styling to database (message metadata) for each updated panel
    const saveStylingToDatabase = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      for (const nodeId of panelsToUpdate) {
        const node = nodes.find(n => n.id === nodeId)
        if (!node || !('promptMessage' in node.data)) continue

        const panelData = node.data as { promptMessage?: { id: string; metadata?: Record<string, any> } }
        const messageId = panelData.promptMessage?.id
        if (!messageId) continue

        // Get existing metadata
        const { data: message, error: fetchError } = await supabase
          .from('messages')
          .select('metadata')
          .eq('id', messageId)
          .single()

        if (fetchError) {
          console.error('Error fetching message for styling save:', fetchError)
          continue
        }

        const existingMetadata = (message?.metadata as Record<string, any>) || {}

        // Update metadata with new styling (only include if value is set)
        const updatedMetadata: Record<string, any> = { ...existingMetadata }
        if (fillColor !== undefined) {
          updatedMetadata.fillColor = fillColor || null // Store null for empty string (transparent)
        }
        if (borderColor !== undefined) {
          updatedMetadata.borderColor = borderColor || null
        }
        if (borderStyle !== undefined) {
          updatedMetadata.borderStyle = borderStyle || null
        }
        if (borderWeight !== undefined) {
          updatedMetadata.borderWeight = borderWeight ? `${borderWeight}px` : null
        }

        // Save to database
        const { error: updateError } = await supabase
          .from('messages')
          .update({ metadata: updatedMetadata })
          .eq('id', messageId)

        if (updateError) {
          console.error('Error saving panel styling to database:', updateError)
        }
      }
    }

    // Save to database (debounced to avoid too many updates)
    const timeoutId = setTimeout(saveStylingToDatabase, 500)
    return () => clearTimeout(timeoutId)
  }, [fillColor, borderColor, borderStyle, borderWeight, clickedEdge, reactFlowInstance])

  // Track which items should be hidden based on available space (Google Docs style)
  useEffect(() => {
    if (!toolbarRef.current) return

    const checkVisibility = () => {
      const toolbar = toolbarRef.current
      if (!toolbar) return

      const toolbarRect = toolbar.getBoundingClientRect()
      const rightSection = toolbar.querySelector('[data-right-section]') as HTMLElement
      const moreMenuButton = toolbar.querySelector('[data-more-menu]') as HTMLElement
      const componentButton = toolbar.querySelector('[data-component-button]') as HTMLElement

      if (!rightSection) return

      const rightSectionRect = rightSection.getBoundingClientRect()

      // Calculate widths of fixed elements (More menu, Layout dropdown, Component, right section)
      // More menu appears when items are hidden, so we need to account for it in calculations
      // Layout dropdown is always visible and positioned just before Component button
      // We always reserve space for the more menu button (even when not visible) since it will appear when items are hidden
      const moreMenuWidth = 32 + 8 // More menu button width (h-7 w-7) + gap/separator - always reserve this space
      const layoutDropdownWidth = 70 + 8 // Layout dropdown approximate width + gap/separator
      const componentWidth = componentButton ? componentButton.getBoundingClientRect().width + 8 : 0 // +8 for gap/separator

      // Available width = space from toolbar start to right section start, minus More menu, Layout dropdown, and Component
      // This ensures More menu (when visible), Layout dropdown, and Component stay visible and get pushed right by the right section
      const availableWidth = rightSectionRect.left - toolbarRect.left - moreMenuWidth - layoutDropdownWidth - componentWidth - 16

      // Define item groups with their approximate widths (right to left priority for hiding)
      // Note: 'layout' is excluded from this list as it's positioned outside the left section and should never be hidden
      // Use different item groups based on edit menu mode
      const itemGroups = editMenuPillMode === 'insert'
        ? [
          // Insert mode buttons: grouped by divider sections
          // Each button: px-2 (8px each side = 16px) + gap-1.5 (6px) + icon (16px) + text width + gap-1 (4px between buttons)
          // Table: 16 + 6 + 16 + ~30 + 4 = ~72px
          // File: 16 + 6 + 16 + ~25 + 4 = ~67px
          // Camera: 16 + 6 + 16 + ~40 + 4 = ~82px
          // Link: 16 + 6 + 16 + ~30 + 4 = ~72px
          // Symbols: 16 + 6 + 16 + ~50 + 4 = ~92px
          // Date: 16 + 6 + 16 + ~30 + 4 = ~72px
          // Container padding: px-2 = 8px each side = 16px total
          // Group 2 (Link, Symbols, Date): 72 + 92 + 72 + 16 = 252px
          // Group 1 (Table, File, Camera): 72 + 67 + 82 + 16 = 237px
          // Divider after group 1: w-px (1px) + mx-1 (8px each side) = 17px
          { id: 'insertGroup2', width: 252 }, // Link, Symbols, Date (72 + 92 + 72 + container padding)
          { id: 'insertGroup1', width: 237 + 17 }, // Table, File, Camera (72 + 67 + 82 + container padding) + divider after
          { id: 'undoRedo', width: 70 },
          { id: 'zoom', width: 60 },
          { id: 'lock', width: 40 },
        ]
        : editMenuPillMode === 'view'
          ? [
            // View mode buttons: Board Style dropdown
            // Board Style: Grid icon (16px) + gap (6px) + text "Board Style" (~80px) + padding (16px) = ~118px
            { id: 'boardStyle', width: 118 },
            { id: 'undoRedo', width: 70 },
            { id: 'zoom', width: 60 },
            { id: 'lock', width: 40 },
          ]
          : editMenuPillMode === 'draw'
            ? [
              // Draw mode buttons: grouped by divider sections
              // Each button: w-7 = 28px, gap-1 = 4px between buttons, px-2 = 8px each side = 16px total container padding
              // Divider: w-px (1px) + mx-0.5 (2px each side = 4px total) = 5px
              // Group 5 (Shapes): 1 button (w-7 = 28px, no container padding since standalone)
              // Group 4 (Colors - Black, Blue, Green, Red): 4 buttons (28 + 4 + 28 + 4 + 28 + 4 + 28) + 16px padding = 156px
              // Divider after colors: 5px
              // Group 3 (Pencil, Highlighter): 2 buttons (28 + 4 + 28) + 16px padding = 76px
              // Divider after tools: 5px
              // Group 2 (Eraser): 1 button (28) + 16px padding = 44px
              // Divider after eraser: 5px
              // Group 1 (Lasso, Vertical, Horizontal): 3 buttons (28 + 4 + 28 + 4 + 28) + 16px padding = 108px
              // Divider after group 1: 5px
              { id: 'drawGroup5', width: 28 }, // Shapes (28px button)
              { id: 'drawGroup4', width: 156 + 5 }, // Colors (156px) + divider after (5px)
              { id: 'drawGroup3', width: 76 + 5 }, // Pencil, Highlighter (76px) + divider after (5px)
              { id: 'drawGroup2', width: 44 + 5 }, // Eraser (44px) + divider after (5px)
              { id: 'drawGroup1', width: 108 + 5 }, // Lasso, Vertical, Horizontal (108px) + divider after (5px)
              { id: 'undoRedo', width: 70 },
              { id: 'zoom', width: 60 },
              { id: 'lock', width: 40 },
            ]
            : [
              // Home mode buttons (formatting options)
              { id: 'arrows', width: 120 }, // Arrow + Line + Curved/Boxed dropdowns
              { id: 'panelControls', width: 120 }, // Fill Color + Border Color + Border Weight + Border Style (4 buttons * 28px + gaps)
              { id: 'alignment', width: 40 },
              { id: 'formatting', width: 180 }, // Bold, Italic, Underline, Strike, Highlight
              { id: 'list', width: 40 },
              { id: 'heading', width: 50 },
              { id: 'paint', width: 40 },
              { id: 'undoRedo', width: 70 },
              { id: 'zoom', width: 60 },
              { id: 'lock', width: 40 },
            ]

      // Calculate total width needed
      let totalWidth = 0
      const newHiddenItems = new Set<string>()

      // Start from leftmost (lock) and work right, hiding from right side first
      for (const item of itemGroups) {
        totalWidth += item.width + 8 // +8 for gap/separator
      }

      // Hide items from right to left if we don't have enough space
      let currentWidth = totalWidth
      for (const item of itemGroups) {
        if (currentWidth > availableWidth) {
          newHiddenItems.add(item.id)
          currentWidth -= item.width + 8
        }
      }

      setHiddenItems(newHiddenItems)
    }

    // Initial check with delay to ensure DOM is ready
    const initialTimeout = setTimeout(checkVisibility, 100)

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(checkVisibility)
    })
    resizeObserver.observe(toolbarRef.current)

    window.addEventListener('resize', checkVisibility)

    return () => {
      clearTimeout(initialTimeout)
      resizeObserver.disconnect()
      window.removeEventListener('resize', checkVisibility)
    }
  }, [editor, editMenuPillMode]) // Re-run when edit menu mode changes

  const isItemHidden = (item: string) => hiddenItems.has(item)

  return (
    <div ref={toolbarRef} className="flex items-center gap-1 h-full flex-1 overflow-hidden">
      {/* Left Section - collapsible items */}
      <div ref={leftSectionRef} className="flex items-center gap-1 flex-shrink min-w-0">
        {/* Lock Control Button - toggles node dragging/connecting */}
        {!isItemHidden('lock') && (
          <>
            <div className="flex items-center px-2 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleToggleLock}
                className={cn(
                  'h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] flex-shrink-0',
                  isLocked && 'bg-gray-100 dark:bg-[#1f1f1f] text-gray-900 dark:text-gray-100'
                )}
                disabled={!reactFlowInstance}
                title={isLocked ? 'Unlock nodes' : 'Lock nodes'}
              >
                {isLocked ? (
                  <Lock className="h-4 w-4" />
                ) : (
                  <Unlock className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="w-px h-6 bg-gray-300 dark:bg-gray-500 mx-1 flex-shrink-0" />
          </>
        )}

        {/* Zoom/Scale Dropdown */}
        {!isItemHidden('zoom') && (
          <>
            {isEditingZoom ? (
              <Input
                ref={zoomInputRef}
                type="text"
                value={`${zoomEditValue}%`}
                onChange={handleZoomInputChange}
                onBlur={handleZoomInputBlur}
                onKeyDown={handleZoomInputKeyDown}
                className="h-7 w-14 px-1 text-sm text-center text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-shrink-0"
                onFocus={(e) => {
                  e.target.select()
                }}
                style={{ fontSize: '0.875rem' }}
                autoFocus
              />
            ) : (
              <DropdownMenu modal={false} open={openDropdown === 'zoom'} onOpenChange={(open) => handleDropdownOpenChange('zoom', open)}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!reactFlowInstance}
                    className={cn(
                      'h-7 px-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0',
                      !reactFlowInstance && 'opacity-50 cursor-not-allowed'
                    )}
                    style={{ minWidth: '48px' }} // Fixed width to prevent jitter when zoom numbers change
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      handleZoomInputFocus()
                    }}
                  >
                    <span
                      className="text-sm cursor-text inline-block text-center"
                      style={{ width: '32px' }} // Fixed width for zoom number text
                    >
                      {Math.round(zoom * 100)}%
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-32"
                  onInteractOutside={(e) => {
                    // Prevent closing when clicking on input
                    if (e.target instanceof HTMLElement && e.target.closest('input')) {
                      e.preventDefault()
                    }
                  }}
                >
                  <DropdownMenuItem
                    onClick={() => handleZoomChange('fit')}
                    className="flex items-center"
                  >
                    Fit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => handleZoomChange(0.5)}
                    className={cn('flex items-center', zoom === 0.5 && 'bg-gray-100 dark:bg-[#1f1f1f]')}
                  >
                    50%
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleZoomChange(0.75)}
                    className={cn('flex items-center', zoom === 0.75 && 'bg-gray-100 dark:bg-gray-800')}
                  >
                    75%
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleZoomChange(0.9)}
                    className={cn('flex items-center', zoom === 0.9 && 'bg-gray-100 dark:bg-gray-800')}
                  >
                    90%
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleZoomChange(1)}
                    className={cn('flex items-center', zoom === 1 && 'bg-gray-100 dark:bg-gray-800')}
                  >
                    100%
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleZoomChange(1.25)}
                    className={cn('flex items-center', zoom === 1.25 && 'bg-gray-100 dark:bg-gray-800')}
                  >
                    125%
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleZoomChange(1.5)}
                    className={cn('flex items-center', zoom === 1.5 && 'bg-gray-100 dark:bg-gray-800')}
                  >
                    150%
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleZoomChange(2)}
                    className={cn('flex items-center', zoom === 2 && 'bg-gray-100 dark:bg-gray-800')}
                  >
                    200%
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <div className="w-px h-6 bg-gray-300 mx-1 flex-shrink-0" />
          </>
        )}

        {/* Undo/Redo Controls */}
        {!isItemHidden('undoRedo') && (
          <>
            <div className="flex items-center gap-1 px-2 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor?.chain().focus().undo().run()}
                disabled={!editor || !editor.can().undo()}
                className="h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                title="Undo"
              >
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor?.chain().focus().redo().run()}
                disabled={!editor || !editor.can().redo()}
                className="h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                title="Redo"
              >
                <Redo2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="w-px h-6 bg-gray-300 mx-1 flex-shrink-0" />
          </>
        )}

        {/* Insert Mode Buttons - Table, File, Camera, Link, Symbols, Date */}
        {editMenuPillMode === 'insert' && (
          <>
            {/* Group 1: Table, File, Camera */}
            {!isItemHidden('insertGroup1') && (
              <>
                <div className="flex items-center gap-1 px-2 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      // TODO: Implement table insertion
                    }}
                    className="h-7 px-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0 flex items-center gap-1.5"
                    title="Table"
                  >
                    <Table className="h-4 w-4" />
                    <span className="text-sm">Table</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      // TODO: Implement file insertion
                    }}
                    className="h-7 px-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0 flex items-center gap-1.5"
                    title="File"
                  >
                    <File className="h-4 w-4" />
                    <span className="text-sm">File</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      // TODO: Implement camera/image insertion
                    }}
                    className="h-7 px-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0 flex items-center gap-1.5"
                    title="Camera"
                  >
                    <Camera className="h-4 w-4" />
                    <span className="text-sm">Camera</span>
                  </Button>
                </div>
                <div className="w-px h-6 bg-gray-300 dark:bg-gray-500 mx-1 flex-shrink-0" />
              </>
            )}
            {/* Group 2: Link, Symbols, Date */}
            {!isItemHidden('insertGroup2') && (
              <div className="flex items-center gap-1 px-2 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    // TODO: Implement link insertion
                  }}
                  className="h-7 px-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0 flex items-center gap-1.5"
                  title="Link"
                >
                  <LinkIcon className="h-4 w-4" />
                  <span className="text-sm">Link</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    // TODO: Implement symbols insertion
                  }}
                  className="h-7 px-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0 flex items-center gap-1.5"
                  title="Symbols"
                >
                  <Hash className="h-4 w-4" />
                  <span className="text-sm">Symbols</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    // TODO: Implement date insertion
                  }}
                  className="h-7 px-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0 flex items-center gap-1.5"
                  title="Date"
                >
                  <Calendar className="h-4 w-4" />
                  <span className="text-sm">Date</span>
                </Button>
              </div>
            )}
          </>
        )}

        {/* Draw Mode Buttons - Lasso, Insert Spaces, Eraser, Pencil, Highlighter, Colors, Shapes */}
        {editMenuPillMode === 'draw' && (
          <>
            {/* Group 1: Lasso, Insert Vertical Space, Insert Horizontal Space */}
            {!isItemHidden('drawGroup1') && (
              <>
                <div className="flex items-center gap-1 px-2 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDrawTool('lasso')}
                    className={cn(
                      "h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0",
                      drawTool === 'lasso' && 'bg-gray-100 dark:bg-gray-800'
                    )}
                    title="Lasso Select"
                  >
                    <LassoSelect className="h-4 w-4" />
                  </Button>
                    <Button
                      ref={insertVerticalSpaceButtonRef}
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        // TODO: Implement insert vertical space
                      }}
                      onMouseEnter={handleInsertVerticalSpaceMouseEnter}
                      onMouseLeave={handleInsertVerticalSpaceMouseLeave}
                      className="h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0"
                      title="Insert Vertical Space"
                    >
                      <img 
                        ref={insertVerticalSpaceIconRef}
                        src="/insert%20space%20v%20icon%202.svg" 
                        alt="Insert Vertical Space" 
                        className="w-4 h-4 transition-all duration-200"
                        style={{ 
                          filter: 'brightness(0) saturate(100%) invert(38%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(98%) contrast(100%)',
                          opacity: 0.8
                        }}
                      />
                    </Button>
                    <Button
                      ref={insertHorizontalSpaceButtonRef}
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        // TODO: Implement insert horizontal space
                      }}
                      onMouseEnter={handleInsertHorizontalSpaceMouseEnter}
                      onMouseLeave={handleInsertHorizontalSpaceMouseLeave}
                      className="h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0"
                      title="Insert Horizontal Space"
                    >
                      <img 
                        ref={insertHorizontalSpaceIconRef}
                        src="/insert%20space%20h%20icon%201.svg" 
                        alt="Insert Horizontal Space" 
                        className="w-4 h-4 transition-all duration-200"
                        style={{ 
                          filter: 'brightness(0) saturate(100%) invert(38%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(98%) contrast(100%)',
                          opacity: 0.8
                        }}
                      />
                    </Button>
                </div>
                <div className="w-px h-6 bg-gray-300 dark:bg-gray-500 mx-0.5 flex-shrink-0" />
              </>
            )}
            {/* Group 2: Eraser */}
            {!isItemHidden('drawGroup2') && (
              <>
                <div className="flex items-center gap-1 px-2 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDrawTool('eraser')}
                    className={cn(
                      "h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0",
                      drawTool === 'eraser' && 'bg-gray-100 dark:bg-gray-800'
                    )}
                    title="Eraser"
                  >
                    <Eraser className="h-4 w-4" />
                  </Button>
                </div>
                <div className="w-px h-6 bg-gray-300 dark:bg-gray-500 mx-0.5 flex-shrink-0" />
              </>
            )}
            {/* Group 3: Pencil, Highlighter */}
            {!isItemHidden('drawGroup3') && (
              <>
                <div className="flex items-center gap-1 px-2 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDrawTool('pencil')}
                    className={cn(
                      "h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0",
                      drawTool === 'pencil' && 'bg-gray-100 dark:bg-gray-800'
                    )}
                    title="Pencil"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDrawTool('highlighter')}
                    className={cn(
                      "h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0",
                      drawTool === 'highlighter' && 'bg-gray-100 dark:bg-gray-800'
                    )}
                    title="Highlighter"
                  >
                    <Highlighter className="h-4 w-4" />
                  </Button>
                </div>
                <div className="w-px h-6 bg-gray-300 dark:bg-gray-500 mx-0.5 flex-shrink-0" />
              </>
            )}
            {/* Group 4: Colors - Black, Blue, Green, Red */}
            {!isItemHidden('drawGroup4') && (
              <>
                <div className="flex items-center gap-1 px-2 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDrawColor('black')}
                    className={cn(
                      "h-7 w-7 p-0 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0",
                      drawColor === 'black' && 'bg-gray-100 dark:bg-gray-800'
                    )}
                    title="Black"
                  >
                    <Circle className="h-4 w-4 fill-black text-black" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDrawColor('blue')}
                    className={cn(
                      "h-7 w-7 p-0 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0",
                      drawColor === 'blue' && 'bg-gray-100 dark:bg-gray-800'
                    )}
                    title="Blue"
                  >
                    <Circle className="h-4 w-4 fill-blue-600 text-blue-600" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDrawColor('green')}
                    className={cn(
                      "h-7 w-7 p-0 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0",
                      drawColor === 'green' && 'bg-gray-100 dark:bg-gray-800'
                    )}
                    title="Green"
                  >
                    <Circle className="h-4 w-4 fill-green-600 text-green-600" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDrawColor('red')}
                    className={cn(
                      "h-7 w-7 p-0 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0",
                      drawColor === 'red' && 'bg-gray-100 dark:bg-gray-800'
                    )}
                    title="Red"
                  >
                    <Circle className="h-4 w-4 fill-red-600 text-red-600" />
                  </Button>
                </div>
                <div className="w-px h-6 bg-gray-300 dark:bg-gray-500 mx-0.5 flex-shrink-0" />
              </>
            )}
            {/* Group 5: Shapes */}
            {!isItemHidden('drawGroup5') && (
              <DropdownMenu open={openDropdown === 'shapes'} onOpenChange={(open) => handleDropdownOpenChange('shapes', open)}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0"
                    title="Shapes"
                  >
                    <Shapes className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-32">
                  <DropdownMenuItem onClick={() => setDrawShape('rectangle')}>
                    Rectangle
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDrawShape('circle')}>
                    Circle
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDrawShape('line')}>
                    Line
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDrawShape('arrow')}>
                    Arrow
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        )}

        {/* Board Style Dropdown - View Mode Only */}
        {editMenuPillMode === 'view' && !isItemHidden('boardStyle') && (
          <>
            <DropdownMenu open={openDropdown === 'boardStyle'} onOpenChange={(open) => handleDropdownOpenChange('boardStyle', open)}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0 flex items-center gap-1.5"
                >
                  <Grid3x3 className="h-4 w-4" />
                  <span className="text-sm">Board</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                {/* Rule Header Section */}
                <DropdownMenuLabel className="px-2 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400">
                  Rule
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup value={boardRule} onValueChange={(value) => setBoardRule(value as 'wide' | 'college' | 'narrow')}>
                  <DropdownMenuRadioItem value="wide" className="pl-8">
                    Wide
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="college" className="pl-8">
                    College
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="narrow" className="pl-8">
                    Narrow
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator className="mx-2 my-1" />
                {/* Style Header Section */}
                <DropdownMenuLabel className="px-2 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400">
                  Style
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup value={boardStyle} onValueChange={(value) => setBoardStyle(value as 'none' | 'dotted' | 'lined' | 'grid')}>
                  <DropdownMenuRadioItem value="none" className="pl-8">
                    None
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dotted" className="pl-8">
                    Dotted
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="lined" className="pl-8">
                    Lined
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="grid" className="pl-8">
                    Grid
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        {/* Paint Format / Clear Formatting Button */}
        {!isItemHidden('paint') && !shouldHideFormattingOptions && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor?.chain().focus().clearNodes().unsetAllMarks().run()}
              disabled={!editor}
              className="h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Clear formatting"
            >
              <Paintbrush className="h-4 w-4" />
            </Button>
            <div className="w-px h-6 bg-gray-300 mx-1 flex-shrink-0" />
          </>
        )}

        {/* Editor controls - always visible, disabled when no editor */}
        <>
          {/* Heading Style Dropdown */}
          {!isItemHidden('heading') && !shouldHideFormattingOptions && (
            <>
              <DropdownMenu open={openDropdown === 'heading'} onOpenChange={(open) => handleDropdownOpenChange('heading', open)}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!editor}
                    className={cn(
                      'h-7 px-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed',
                      editor?.isActive('heading', { level: 2 }) && 'bg-gray-100'
                    )}
                  >
                    <span className="text-sm">H₂</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-32">
                  <DropdownMenuItem
                    onClick={() => editor?.chain().focus().setParagraph().run()}
                    disabled={!editor}
                    className={editor?.isActive('paragraph') ? 'bg-gray-100 dark:bg-[#1f1f1f]' : ''}
                  >
                    Paragraph
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
                    disabled={!editor}
                    className={editor?.isActive('heading', { level: 1 }) ? 'bg-gray-100 dark:bg-gray-800' : ''}
                  >
                    Heading 1
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
                    disabled={!editor}
                    className={editor?.isActive('heading', { level: 2 }) ? 'bg-gray-100 dark:bg-gray-800' : ''}
                  >
                    Heading 2
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
                    disabled={!editor}
                    className={editor?.isActive('heading', { level: 3 }) ? 'bg-gray-100 dark:bg-gray-800' : ''}
                  >
                    Heading 3
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="w-px h-6 bg-gray-300 dark:bg-gray-500 mx-1 flex-shrink-0" />
            </>
          )}

          {/* List Dropdown */}
          {!isItemHidden('list') && !shouldHideFormattingOptions && (
            <>
              <DropdownMenu open={openDropdown === 'list'} onOpenChange={(open) => handleDropdownOpenChange('list', open)}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!editor}
                    className={cn(
                      'h-7 px-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed',
                      (editor?.isActive('bulletList') || editor?.isActive('orderedList')) && 'bg-gray-100 dark:bg-[#1f1f1f]'
                    )}
                  >
                    <List className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40">
                  <DropdownMenuItem
                    onClick={() => editor?.chain().focus().toggleBulletList().run()}
                    disabled={!editor}
                    className={editor?.isActive('bulletList') ? 'bg-gray-100 dark:bg-gray-800' : ''}
                  >
                    Bullet List
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                    disabled={!editor}
                    className={editor?.isActive('orderedList') ? 'bg-gray-100' : ''}
                  >
                    Numbered List
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="w-px h-6 bg-gray-300 dark:bg-gray-500 mx-1 flex-shrink-0" />
            </>
          )}

          {/* Text Formatting Controls */}
          {!isItemHidden('formatting') && !shouldHideFormattingOptions && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor?.chain().focus().toggleBold().run()}
                disabled={!editor}
                className={cn(
                  'h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed',
                  editor?.isActive('bold') && 'bg-gray-100 text-gray-900'
                )}
                title="Bold"
              >
                <span className="text-sm font-bold">B</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor?.chain().focus().toggleItalic().run()}
                disabled={!editor}
                className={cn(
                  'h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed',
                  editor?.isActive('italic') && 'bg-gray-100 text-gray-900'
                )}
                title="Italic"
              >
                <span className="text-sm italic">I</span>
              </Button>
              {/* Underline - only show if underline extension is available */}
              {editor?.extensionManager.extensions.find(ext => ext.name === 'underline') && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => editor?.chain().focus().toggleUnderline().run()}
                  disabled={!editor}
                  className={cn(
                    'h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed',
                    editor?.isActive('underline') && 'bg-gray-100 text-gray-900'
                  )}
                  title="Underline"
                >
                  <span className="text-sm underline">U</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor?.chain().focus().toggleStrike().run()}
                disabled={!editor}
                className={cn(
                  'h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed',
                  editor?.isActive('strike') && 'bg-gray-100 text-gray-900'
                )}
                title="Strikethrough"
              >
                <span className="text-sm line-through">S</span>
              </Button>
              {/* Highlight Button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor?.chain().focus().toggleHighlight({ color: '#fef08a' }).run()}
                disabled={!editor}
                className={cn(
                  'h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed',
                  editor?.isActive('highlight') && 'bg-gray-100 text-gray-900'
                )}
                title="Highlight"
              >
                <Highlighter className="h-4 w-4" />
              </Button>
              <div className="w-px h-6 bg-gray-300 dark:bg-gray-500 mx-1 flex-shrink-0" />
            </div>
          )}

          {/* Text Alignment Dropdown */}
          {!isItemHidden('alignment') && !shouldHideFormattingOptions && (
            <>
              <DropdownMenu open={openDropdown === 'textAlign'} onOpenChange={(open) => handleDropdownOpenChange('textAlign', open)}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!editor}
                    className={cn(
                      'h-7 px-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed',
                      (editor?.isActive({ textAlign: 'center' }) || editor?.isActive({ textAlign: 'right' }) || editor?.isActive({ textAlign: 'justify' })) && 'bg-gray-100'
                    )}
                  >
                    {/* Show current alignment icon */}
                    {editor?.isActive({ textAlign: 'center' }) ? (
                      <AlignCenter className="h-4 w-4" />
                    ) : editor?.isActive({ textAlign: 'right' }) ? (
                      <AlignRight className="h-4 w-4" />
                    ) : editor?.isActive({ textAlign: 'justify' }) ? (
                      <AlignJustify className="h-4 w-4" />
                    ) : (
                      <AlignLeft className="h-4 w-4" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-36">
                  <DropdownMenuItem
                    onClick={() => editor?.chain().focus().setTextAlign('left').run()}
                    disabled={!editor}
                    className={cn('flex items-center gap-2', editor?.isActive({ textAlign: 'left' }) && 'bg-gray-100')}
                  >
                    <AlignLeft className="h-4 w-4" />
                    Left
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => editor?.chain().focus().setTextAlign('center').run()}
                    disabled={!editor}
                    className={cn('flex items-center gap-2', editor?.isActive({ textAlign: 'center' }) && 'bg-gray-100')}
                  >
                    <AlignCenter className="h-4 w-4" />
                    Center
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => editor?.chain().focus().setTextAlign('right').run()}
                    disabled={!editor}
                    className={cn('flex items-center gap-2', editor?.isActive({ textAlign: 'right' }) && 'bg-gray-100')}
                  >
                    <AlignRight className="h-4 w-4" />
                    Right
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => editor?.chain().focus().setTextAlign('justify').run()}
                    disabled={!editor}
                    className={cn('flex items-center gap-2', editor?.isActive({ textAlign: 'justify' }) && 'bg-gray-100')}
                  >
                    <AlignJustify className="h-4 w-4" />
                    Justify
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="w-px h-6 bg-gray-300 dark:bg-gray-500 mx-1 flex-shrink-0" />
            </>
          )}

          {/* Panel Styling Controls - Fill Color, Border Color, Border Weight, Border Style - Each as separate icon-only button */}
          {!isItemHidden('panelControls') && !shouldHideFormattingOptions && (
            <>
              {/* Fill Color Button */}
              <DropdownMenu open={openDropdown === 'fillColor'} onOpenChange={(open) => handleDropdownOpenChange('fillColor', open)}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0 flex flex-col items-center justify-center gap-0.5"
                    title="Fill Color"
                  >
                    <PaintBucket className="h-3.5 w-3.5" />
                    <div
                      className="w-5 rounded-full"
                      style={{ backgroundColor: fillColor || '#ffffff', height: '3px' }}
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  <div className="px-2 py-1.5">
                    <input
                      type="color"
                      value={fillColor || '#ffffff'}
                      onChange={(e) => setFillColor(e.target.value)}
                      className="w-full h-8 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
                      title="Fill Color"
                      aria-label="Fill Color"
                    />
                    {/* Transparent option */}
                    <Button
                      variant={!fillColor ? "default" : "outline"}
                      size="sm"
                      className="w-full mt-2 h-7 text-xs"
                      onClick={() => setFillColor('')}
                    >
                      Transparent
                    </Button>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Border Color Button */}
              <DropdownMenu open={openDropdown === 'borderColor'} onOpenChange={(open) => handleDropdownOpenChange('borderColor', open)}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0 flex flex-col items-center justify-center gap-0.5"
                    title="Border Color"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <div
                      className="w-5 rounded-full"
                      style={{ backgroundColor: borderColor || '#000000', height: '3px' }}
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  <div className="px-2 py-1.5">
                    <input
                      type="color"
                      value={borderColor}
                      onChange={(e) => setBorderColor(e.target.value)}
                      className="w-full h-8 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
                      title="Border Color"
                      aria-label="Border Color"
                    />
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Border Settings Combined Button */}
              <DropdownMenu open={openDropdown === 'borderStyle'} onOpenChange={(open) => handleDropdownOpenChange('borderStyle', open)}>
                <DropdownMenuTrigger asChild>
                  <Button
                    ref={borderStyleButtonRef}
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none"
                    title={`Border: ${borderWeight}px ${borderStyle}`}
                  >
                    <img 
                      ref={borderStyleIconRef}
                      src="/line%20style%20icon%201.svg" 
                      alt="Border style" 
                      className="w-4 h-4 transition-all duration-200"
                      style={{ 
                        filter: 'brightness(0) saturate(100%) invert(38%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(98%) contrast(100%)',
                        opacity: 0.8
                      }}
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40">
                  <DropdownMenuLabel className="text-xs font-normal text-gray-500 pl-2 py-1.5">Thickness</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={borderWeight.toString()} onValueChange={(value) => setBorderWeight(parseInt(value))}>
                    <DropdownMenuRadioItem value="1" className="pl-8 text-xs">1px</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="2" className="pl-8 text-xs">2px</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="3" className="pl-8 text-xs">3px</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="4" className="pl-8 text-xs">4px</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator className="mx-2" />
                  <DropdownMenuLabel className="text-xs font-normal text-gray-500 pl-2 py-1.5">Style</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={borderStyle} onValueChange={(value) => setBorderStyle(value as 'solid' | 'dashed' | 'dotted' | 'none')}>
                    <DropdownMenuRadioItem value="none" className="pl-8 text-xs">None</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="solid" className="pl-8 text-xs">Solid</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dashed" className="pl-8 text-xs">Dashed</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dotted" className="pl-8 text-xs">Dotted</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="w-px h-6 bg-gray-300 dark:bg-gray-500 mx-1 flex-shrink-0" />
            </>
          )}

          {/* Arrow Direction, Line Style, Curved/Boxed Dropdowns */}
          {!isItemHidden('arrows') && !shouldHideFormattingOptions && (
            <>
              {/* Edge Curve Dropdown (includes curve style and line style) */}
              <DropdownMenu open={openDropdown === 'edgeCurve'} onOpenChange={(open) => handleDropdownOpenChange('edgeCurve', open)}>
                <DropdownMenuTrigger asChild>
                  <Button
                    ref={threadStyleButtonRef}
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none"
                  >
                    <img 
                      ref={threadStyleIconRef}
                      src="/thread%20style%20icon%208.svg" 
                      alt="Thread style" 
                      className="w-3.5 h-3.5 transition-all duration-200"
                      style={{ 
                        filter: 'brightness(0) saturate(100%) invert(38%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(98%) contrast(100%)',
                        opacity: 0.8
                      }}
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40">
                  <DropdownMenuLabel className="text-xs font-normal text-gray-500 pl-2 py-1.5">Thread Style</DropdownMenuLabel>
                  {/* Line Style Options */}
                  <DropdownMenuRadioGroup 
                    value={verticalLineStyle === 'solid' ? 'solid' : 'dashed'}
                    onValueChange={(value) => {
                      setVerticalLineStyle(value === 'solid' ? 'solid' : 'dotted')
                    }}
                  >
                    <DropdownMenuRadioItem value="solid" className="pl-8 text-xs">Solid</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dashed" className="pl-8 text-xs">Dashed</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  
                  {/* Separator */}
                  <DropdownMenuSeparator className="mx-2" />
                  
                  {/* Curve Style Options */}
                  <DropdownMenuRadioGroup 
                    value={lineStyle === 'curved' ? 'smooth' : 'sharp'}
                    onValueChange={(value) => {
                      setLineStyle(value === 'smooth' ? 'curved' : 'boxed')
                    }}
                  >
                    <DropdownMenuRadioItem value="smooth" className="pl-8 text-xs">Smooth</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="sharp" className="pl-8 text-xs">Sharp</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu open={openDropdown === 'arrowDirection'} onOpenChange={(open) => handleDropdownOpenChange('arrowDirection', open)}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0"
                  >
                    {arrowDirection === 'down' && <ArrowDown className="h-4 w-4" />}
                    {arrowDirection === 'up' && <ArrowUp className="h-4 w-4" />}
                    {arrowDirection === 'left' && <ArrowLeft className="h-4 w-4" />}
                    {arrowDirection === 'right' && <ArrowRight className="h-4 w-4" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-0 w-fit p-1">
                  <DropdownMenuItem
                    onClick={() => setArrowDirection('down')}
                    className={cn('h-7 w-7 p-0 flex items-center justify-center rounded-sm', arrowDirection === 'down' && 'bg-gray-100')}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setArrowDirection('right')}
                    className={cn('h-7 w-7 p-0 flex items-center justify-center rounded-sm', arrowDirection === 'right' && 'bg-gray-100')}
                  >
                    <ArrowRight className="h-4 w-4" />
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setArrowDirection('left')}
                    className={cn('h-7 w-7 p-0 flex items-center justify-center rounded-sm', arrowDirection === 'left' && 'bg-gray-100')}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setArrowDirection('up')}
                    className={cn('h-7 w-7 p-0 flex items-center justify-center rounded-sm', arrowDirection === 'up' && 'bg-gray-100')}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </>
      </div>
      {/* End of left section */}

      {/* More menu button - contains hidden items, left-aligned after collapsible items */}
      {hiddenItems.size > 0 && (
        <DropdownMenu open={openDropdown === 'moreMenu'} onOpenChange={(open) => handleDropdownOpenChange('moreMenu', open)}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0"
              title="More options"
              data-more-menu
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {/* Show hidden items in more menu - different items based on edit menu mode */}
            {editMenuPillMode === 'insert' ? (
              <>
                {/* Insert mode items - grouped by toolbar dividers */}
                {/* First group: Table, File, Camera - all appear together when hidden */}
                {isItemHidden('insertGroup1') && editor && (
                  <>
                    <DropdownMenuItem
                      onClick={() => {
                        // TODO: Implement table insertion
                      }}
                    >
                      <Table className="h-4 w-4 mr-2" />
                      Table
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        // TODO: Implement file insertion
                      }}
                    >
                      <File className="h-4 w-4 mr-2" />
                      File
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        // TODO: Implement camera/image insertion
                      }}
                    >
                      <Camera className="h-4 w-4 mr-2" />
                      Camera
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {/* Second group: Link, Symbols, Date - all appear together when hidden */}
                {isItemHidden('insertGroup2') && editor && (
                  <>
                    <DropdownMenuItem
                      onClick={() => {
                        // TODO: Implement link insertion
                      }}
                    >
                      <LinkIcon className="h-4 w-4 mr-2" />
                      Link
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        // TODO: Implement symbols insertion
                      }}
                    >
                      <Hash className="h-4 w-4 mr-2" />
                      Symbols
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        // TODO: Implement date insertion
                      }}
                    >
                      <Calendar className="h-4 w-4 mr-2" />
                      Date
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {/* Common items (undo/redo, zoom, lock) */}
                {isItemHidden('undoRedo') && editor && (
                  <>
                    <DropdownMenuItem
                      onClick={() => editor.chain().focus().undo().run()}
                      disabled={!editor.can().undo()}
                    >
                      <Undo2 className="h-4 w-4 mr-2" />
                      Undo
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => editor.chain().focus().redo().run()}
                      disabled={!editor.can().redo()}
                    >
                      <Redo2 className="h-4 w-4 mr-2" />
                      Redo
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('zoom') && reactFlowInstance && (
                  <>
                    <DropdownMenuItem onClick={() => handleZoomChange('fit')}>
                      Fit to view
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleZoomChange(0.5)}>50%</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleZoomChange(0.75)}>75%</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleZoomChange(1)}>100%</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleZoomChange(1.5)}>150%</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleZoomChange(2)}>200%</DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('lock') && reactFlowInstance && (
                  <>
                    <DropdownMenuItem onClick={handleToggleLock}>
                      {isLocked ? <Lock className="h-4 w-4 mr-2" /> : <Unlock className="h-4 w-4 mr-2" />}
                      {isLocked ? 'Unlock nodes' : 'Lock nodes'}
                    </DropdownMenuItem>
                  </>
                )}
              </>
            ) : editMenuPillMode === 'view' ? (
              <>
                {/* View mode items */}
                {isItemHidden('boardStyle') && (
                  <>
                    <DropdownMenuItem
                      onClick={() => {
                        // Board style dropdown - no action needed, just show in menu
                      }}
                    >
                      <Grid3x3 className="h-4 w-4 mr-2" />
                      Board Style
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {/* Common items (undo/redo, zoom, lock) */}
                {isItemHidden('undoRedo') && editor && (
                  <>
                    <DropdownMenuItem
                      onClick={() => editor.chain().focus().undo().run()}
                      disabled={!editor.can().undo()}
                    >
                      <Undo2 className="h-4 w-4 mr-2" />
                      Undo
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => editor.chain().focus().redo().run()}
                      disabled={!editor.can().redo()}
                    >
                      <Redo2 className="h-4 w-4 mr-2" />
                      Redo
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('zoom') && reactFlowInstance && (
                  <>
                    <DropdownMenuItem onClick={() => handleZoomChange('fit')}>
                      Fit to view
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleZoomChange(0.5)}>50%</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleZoomChange(0.75)}>75%</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleZoomChange(1)}>100%</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleZoomChange(1.5)}>150%</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleZoomChange(2)}>200%</DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('lock') && reactFlowInstance && (
                  <>
                    <DropdownMenuItem onClick={handleToggleLock}>
                      {isLocked ? <Lock className="h-4 w-4 mr-2" /> : <Unlock className="h-4 w-4 mr-2" />}
                      {isLocked ? 'Unlock nodes' : 'Lock nodes'}
                    </DropdownMenuItem>
                  </>
                )}
              </>
            ) : editMenuPillMode === 'draw' ? (
              <>
                {/* Draw mode items - grouped by toolbar dividers */}
                {/* Group 5: Shapes */}
                {isItemHidden('drawGroup5') && (
                  <>
                    <DropdownMenuItem onClick={() => setDrawShape('rectangle')}>
                      <Shapes className="h-4 w-4 mr-2" />
                      Shapes
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {/* Group 4: Colors - Black, Blue, Green, Red */}
                {isItemHidden('drawGroup4') && (
                  <>
                    <DropdownMenuItem onClick={() => setDrawColor('black')}>
                      <Circle className="h-4 w-4 mr-2 fill-black text-black" />
                      Black
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDrawColor('blue')}>
                      <Circle className="h-4 w-4 mr-2 fill-blue-600 text-blue-600" />
                      Blue
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDrawColor('green')}>
                      <Circle className="h-4 w-4 mr-2 fill-green-600 text-green-600" />
                      Green
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDrawColor('red')}>
                      <Circle className="h-4 w-4 mr-2 fill-red-600 text-red-600" />
                      Red
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {/* Group 3: Pencil, Highlighter */}
                {isItemHidden('drawGroup3') && (
                  <>
                    <DropdownMenuItem onClick={() => setDrawTool('pencil')}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Pencil
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDrawTool('highlighter')}>
                      <Highlighter className="h-4 w-4 mr-2" />
                      Highlighter
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {/* Group 2: Eraser */}
                {isItemHidden('drawGroup2') && (
                  <>
                    <DropdownMenuItem onClick={() => setDrawTool('eraser')}>
                      <Eraser className="h-4 w-4 mr-2" />
                      Eraser
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {/* Group 1: Lasso, Insert Vertical Space, Insert Horizontal Space */}
                {isItemHidden('drawGroup1') && (
                  <>
                    <DropdownMenuItem onClick={() => setDrawTool('lasso')}>
                      <LassoSelect className="h-4 w-4 mr-2" />
                      Lasso Select
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        // TODO: Implement insert vertical space
                      }}
                    >
                      <img 
                        src="/insert%20space%20v%20icon%202.svg" 
                        alt="Insert Vertical Space" 
                        className="h-4 w-4 mr-2"
                      />
                      Insert Vertical Space
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        // TODO: Implement insert horizontal space
                      }}
                    >
                      <img 
                        src="/insert%20space%20h%20icon%201.svg" 
                        alt="Insert Horizontal Space" 
                        className="h-4 w-4 mr-2"
                      />
                      Insert Horizontal Space
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {/* Common items (undo/redo, zoom, lock) */}
                {isItemHidden('undoRedo') && editor && (
                  <>
                    <DropdownMenuItem
                      onClick={() => editor.chain().focus().undo().run()}
                      disabled={!editor.can().undo()}
                    >
                      <Undo2 className="h-4 w-4 mr-2" />
                      Undo
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => editor.chain().focus().redo().run()}
                      disabled={!editor.can().redo()}
                    >
                      <Redo2 className="h-4 w-4 mr-2" />
                      Redo
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('zoom') && reactFlowInstance && (
                  <>
                    <DropdownMenuItem onClick={() => handleZoomChange('fit')}>
                      Fit to view
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleZoomChange(0.5)}>50%</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleZoomChange(0.75)}>75%</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleZoomChange(1)}>100%</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleZoomChange(1.5)}>150%</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleZoomChange(2)}>200%</DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('lock') && reactFlowInstance && (
                  <>
                    <DropdownMenuItem onClick={handleToggleLock}>
                      {isLocked ? <Lock className="h-4 w-4 mr-2" /> : <Unlock className="h-4 w-4 mr-2" />}
                      {isLocked ? 'Unlock nodes' : 'Lock nodes'}
                    </DropdownMenuItem>
                  </>
                )}
              </>
            ) : (
              <>
                {/* Home mode items (formatting options) */}
                {isItemHidden('lock') && reactFlowInstance && (
                  <>
                    <DropdownMenuItem onClick={handleToggleLock}>
                      {isLocked ? <Lock className="h-4 w-4 mr-2" /> : <Unlock className="h-4 w-4 mr-2" />}
                      {isLocked ? 'Unlock nodes' : 'Lock nodes'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('zoom') && reactFlowInstance && (
                  <>
                    <DropdownMenuItem onClick={() => handleZoomChange('fit')}>
                      Fit to view
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleZoomChange(0.5)}>50%</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleZoomChange(0.75)}>75%</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleZoomChange(1)}>100%</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleZoomChange(1.5)}>150%</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleZoomChange(2)}>200%</DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('undoRedo') && editor && (
                  <>
                    <DropdownMenuItem
                      onClick={() => editor.chain().focus().undo().run()}
                      disabled={!editor.can().undo()}
                    >
                      <Undo2 className="h-4 w-4 mr-2" />
                      Undo
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => editor.chain().focus().redo().run()}
                      disabled={!editor.can().redo()}
                    >
                      <Redo2 className="h-4 w-4 mr-2" />
                      Redo
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('paint') && editor && (
                  <>
                    <DropdownMenuItem onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}>
                      <Paintbrush className="h-4 w-4 mr-2" />
                      Clear formatting
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('heading') && editor && (
                  <>
                    <DropdownMenuItem onClick={() => editor.chain().focus().setParagraph().run()}>
                      Paragraph
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
                      Heading 1
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
                      Heading 2
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
                      Heading 3
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('list') && editor && (
                  <>
                    <DropdownMenuItem onClick={() => editor.chain().focus().toggleBulletList().run()}>
                      <List className="h-4 w-4 mr-2" />
                      Bullet List
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => editor.chain().focus().toggleOrderedList().run()}>
                      Numbered List
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('formatting') && editor && (
                  <>
                    <DropdownMenuItem onClick={() => editor.chain().focus().toggleBold().run()}>
                      <span className="font-bold mr-2">B</span>
                      Bold
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => editor.chain().focus().toggleItalic().run()}>
                      <span className="italic mr-2">I</span>
                      Italic
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => editor.chain().focus().toggleStrike().run()}>
                      <span className="line-through mr-2">S</span>
                      Strikethrough
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run()}>
                      <Highlighter className="h-4 w-4 mr-2" />
                      Highlight
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('alignment') && editor && (
                  <>
                    <DropdownMenuItem onClick={() => editor.chain().focus().setTextAlign('left').run()}>
                      <AlignLeft className="h-4 w-4 mr-2" />
                      Align Left
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => editor.chain().focus().setTextAlign('center').run()}>
                      <AlignCenter className="h-4 w-4 mr-2" />
                      Align Center
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => editor.chain().focus().setTextAlign('right').run()}>
                      <AlignRight className="h-4 w-4 mr-2" />
                      Align Right
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('arrows') && (
                  <>
                    <DropdownMenuItem onClick={() => setArrowDirection('down')}>
                      <ArrowDown className="h-4 w-4 mr-2" />
                      Arrow Down
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setArrowDirection('right')}>
                      <ArrowRight className="h-4 w-4 mr-2" />
                      Arrow Right
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setArrowDirection('left')}>
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Arrow Left
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setArrowDirection('up')}>
                      <ArrowUp className="h-4 w-4 mr-2" />
                      Arrow Up
                    </DropdownMenuItem>
                  </>
                )}
                {isItemHidden('panelControls') && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="px-2 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400">
                      Panel
                    </DropdownMenuLabel>
                    {/* Fill Color */}
                    <div className="px-2 py-1.5">
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Fill Color</div>
                      <input
                        type="color"
                        value={fillColor || '#ffffff'}
                        onChange={(e) => setFillColor(e.target.value)}
                        className="w-full h-8 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
                        title="Fill Color"
                        aria-label="Fill Color"
                      />
                      {/* Transparent option */}
                      <Button
                        variant={!fillColor ? "default" : "outline"}
                        size="sm"
                        className="w-full mt-2 h-7 text-xs"
                        onClick={() => setFillColor('')}
                      >
                        Transparent
                      </Button>
                    </div>
                    {/* Border Color */}
                    <div className="px-2 py-1.5">
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Border Color</div>
                      <input
                        type="color"
                        value={borderColor}
                        onChange={(e) => setBorderColor(e.target.value)}
                        className="w-full h-8 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
                        title="Border Color"
                        aria-label="Border Color"
                      />
                    </div>
                    {/* Border Weight */}
                    {/* Border Settings */}
                    <div className="px-2 py-1.5">
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Thickness</div>
                      <DropdownMenuRadioGroup value={borderWeight.toString()} onValueChange={(value) => setBorderWeight(parseInt(value))}>
                        <DropdownMenuRadioItem value="1" className="pl-8">
                          1px
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="2" className="pl-8">
                          2px
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="3" className="pl-8">
                          3px
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="4" className="pl-8">
                          4px
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </div>

                    <div className="px-2 py-1.5 pt-0">
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Style</div>
                      <DropdownMenuRadioGroup value={borderStyle} onValueChange={(value) => setBorderStyle(value as 'solid' | 'dashed' | 'dotted' | 'none')}>
                        <DropdownMenuRadioItem value="none" className="pl-8">
                          None
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="solid" className="pl-8">
                          Solid
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="dashed" className="pl-8">
                          Dashed
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="dotted" className="pl-8">
                          Dotted
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </div>
                  </>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Divider between More menu and Layout dropdown - only show if More menu is visible */}
      {hiddenItems.size > 0 && <div className="w-px h-6 bg-gray-300 mx-1" />}

      {/* Divider between panel controls/arrows section and Layout dropdown - only show if panel controls or arrows section is visible and More menu is not visible */}
      {hiddenItems.size === 0 && ((!isItemHidden('panelControls') && !shouldHideFormattingOptions) || !isItemHidden('arrows')) && <div className="w-px h-6 bg-gray-300 mx-1" />}

      {/* Layout Dropdown - positioned just before Component button */}
      {!isItemHidden('layout') && (
        <DropdownMenu open={openDropdown === 'layoutMode'} onOpenChange={(open) => handleDropdownOpenChange('layoutMode', open)}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0"
            >
              <span className="text-sm capitalize">
                {layoutMode === 'none' ? 'None' : layoutMode === 'auto' ? 'Suggest' : layoutMode}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-auto min-w-fit">
            <DropdownMenuItem
              onClick={() => setLayoutMode('auto')}
              className={cn('flex items-center gap-2', layoutMode === 'auto' && 'bg-gray-100')}
            >
              Suggest <span>✨</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setLayoutMode('tree')}
              className={cn('flex items-center gap-2', layoutMode === 'tree' && 'bg-gray-100')}
            >
              Tree
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setLayoutMode('cluster')}
              className={cn('flex items-center gap-2', layoutMode === 'cluster' && 'bg-gray-100')}
            >
              Cluster
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setLayoutMode('none')}
              className={cn('flex items-center gap-2', layoutMode === 'none' && 'bg-gray-100')}
            >
              None
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Divider between Layout dropdown and Component button */}
      {!isItemHidden('layout') && <div className="w-px h-6 bg-gray-300 mx-1 flex-shrink-0" />}

      {/* Component button - dropdown with Note and Flashcard options */}
      <DropdownMenu open={openDropdown === 'component'} onOpenChange={(open) => handleDropdownOpenChange('component', open)}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0"
            data-component-button
            type="button"
            suppressHydrationWarning
          >
            <Plus className="h-4 w-4 flex-shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-0 w-fit p-1">
          <DropdownMenuItem onClick={handleCreateNote} className="rounded-sm">
            Note
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCreateFlashcard} className="rounded-sm">
            Flashcard
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Right Section - always visible, fixed position (Share and Edit Mode) */}
      <div className="flex items-center gap-1 flex-shrink-0 ml-auto mr-4" data-right-section>
        {/* Reset to Default Button - only show when settings differ from defaults */}
        {hasNonDefaultSettings && (
          <div className="flex items-center pl-2 pr-0 -mr-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0"
              title="Reset to default"
              onClick={handleResetToDefault}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Share Button */}
        <div className="flex items-center px-2 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0"
            title="Share"
          >
            <Share2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Edit Mode Dropdown */}
        <DropdownMenu open={openDropdown === 'editMode'} onOpenChange={(open) => handleDropdownOpenChange('editMode', open)}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 px-2 text-gray-700 dark:text-gray-200 bg-blue-50 dark:bg-[#2a2a3a] hover:bg-gray-100 dark:hover:bg-[#1f1f1f] data-[state=open]:bg-gray-300 dark:data-[state=open]:bg-[#2f2f2f] focus-visible:ring-0 focus-visible:ring-offset-0'
              )}
            >
              {editMode === 'editing' && <span className="text-base">💭</span>}
              {editMode === 'suggesting' && <span className="text-base">🎵</span>}
              {editMode === 'viewing' && <span className="text-base">🧠</span>}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-fit">
            <DropdownMenuItem
              onClick={() => setEditMode('editing')}
              className={cn(
                'flex items-center gap-3 p-3',
                editMode === 'editing' && 'bg-gray-200'
              )}
            >
              <span className="text-lg">💭</span>
              <div className="flex flex-col">
                <span className="text-sm font-semibold">Think</span>
                <span className="text-xs text-gray-500">Chat directly</span>
              </div>
              {editMode === 'editing' && (
                <div className="ml-auto">
                  <svg className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setEditMode('suggesting')}
              className={cn(
                'flex items-center gap-3 p-3',
                editMode === 'suggesting' && 'bg-gray-200'
              )}
            >
              <span className="text-lg">🎼</span>
              <div className="flex flex-col">
                <span className="text-sm font-semibold">Compose</span>
                <span className="text-xs text-gray-500">Gain autofill</span>
              </div>
              {editMode === 'suggesting' && (
                <div className="ml-auto">
                  <svg className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setEditMode('viewing')}
              className={cn(
                'flex items-center gap-3 p-3',
                editMode === 'viewing' && 'bg-gray-200'
              )}
            >
              <span className="text-lg">🧠</span>
              <div className="flex flex-col">
                <span className="text-sm font-semibold">Mind<sup>2</sup> ✨</span>
                <span className="text-xs text-gray-500">Workflow assistant</span>
              </div>
              {editMode === 'viewing' && (
                <div className="ml-auto">
                  <svg className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

