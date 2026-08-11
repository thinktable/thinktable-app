'use client'
// Force recompile to fix hydration mismatch

// TipTap editor toolbar component - matches the agent editor example
import { Editor } from '@tiptap/react'
import { Button } from './ui/button'
import { useReactFlowContext } from './react-flow-context'
import { threadAlgorithmFromStyle, type ThreadStylePref } from '@/components/threads' // Smooth/Sharp/Linear
import { usePreviewFocus } from '@/lib/preview-focus-context' // Nested preview View-style targeting
import { useState, useEffect, useRef } from 'react'
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
  Sparkles,
  Circle,
  Square,
  Shapes,
  Grid3x3,
  Table,
  File,
  Camera,
  Link as LinkIcon,
  Hash,
  Calendar,
  FileText,
  Move,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'
import { ShapeGridItem } from './shapes/ShapeGridItem'
import { useTheme } from './theme-provider'
import { NotionConnectButton } from './notion-connect-button'
import { ShareBoardMenu } from './share-board-menu' // Share dropdown: Notion people + role links
import { useBoardAccess } from '@/lib/share/board-access-context' // Owner-only share menu
import { useAiEditSession } from '@/lib/ai/edit-session' // Top-bar AI content mask toggle
import { htmlHasAiOrigin } from '@/lib/ai/wrap-ai-html' // Detect AI-origin spans in frame HTML
import { newBlockMetadata } from '@/lib/blocks' // Canonical isBlock + isInlineBlock metadata

/** Lock/Unlock with a tiny board or frame glyph so the two top-bar locks stay distinct. */
function LockSubIcon({
  locked,
  SubIcon,
}: {
  locked: boolean
  SubIcon: LucideIcon
}) {
  const Main = locked ? Lock : Unlock // Closed when locked, open when free
  return (
    <span className="relative inline-flex h-4 w-4 items-center justify-center">
      <Main className="h-4 w-4" />
      <SubIcon
        className="absolute -bottom-0.5 -right-0.5 h-2 w-2 text-current"
        strokeWidth={2.5}
        aria-hidden
      />
    </span>
  )
}

interface EditorToolbarProps {
  editor: Editor | null
  conversationId?: string
}

export function EditorToolbar({ editor, conversationId }: EditorToolbarProps) {
  const { canShare, canEdit, role } = useBoardAccess() // Gate share + show view-only chrome
  const { reactFlowInstance, isLocked, layoutMode, setLayoutMode, lineStyle: verticalLineStyle, setLineStyle: setVerticalLineStyle, arrowDirection, setArrowDirection, editMenuPillMode, boardRule: hostBoardRule, setBoardRule: setHostBoardRule, boardStyle: hostBoardStyle, setBoardStyle: setHostBoardStyle, fillColor, setFillColor, borderColor, setBorderColor, borderWeight, setBorderWeight, borderStyle, setBorderStyle, clickedEdge, isDrawing, setIsDrawing, drawTool: contextDrawTool, setDrawTool: setContextDrawTool, drawShape: contextDrawShape, setDrawShape: setContextDrawShape, mapUndo, mapRedo, canMapUndo, canMapRedo, snapEnabled, setSnapEnabled, getMapTakeSnapshot } = useReactFlowContext()
  const { showAiOrigin, setShowAiOrigin } = useAiEditSession() // Reddish AI content overlay toggle
  const queryClientForAi = useQueryClient() // Scan page frames for AI-origin content
  const [hasAiContent, setHasAiContent] = useState(false)
  useEffect(() => {
    if (!conversationId) {
      setHasAiContent(false)
      return
    }
    const scan = () => {
      const msgs =
        (queryClientForAi.getQueryData([
          'messages-for-panels',
          conversationId,
          'full',
        ]) as Array<{ content?: string; metadata?: Record<string, unknown> }> | undefined) ||
        (queryClientForAi.getQueryData([
          'messages-for-panels',
          conversationId,
        ]) as Array<{ content?: string; metadata?: Record<string, unknown> }> | undefined) ||
        []
      setHasAiContent(
        msgs.some((m) => {
          const meta = (m.metadata || {}) as Record<string, unknown>
          if (meta.hasAiOrigin === true) return true
          return htmlHasAiOrigin(m.content)
        })
      )
    }
    scan()
    const unsub = queryClientForAi.getQueryCache().subscribe((event) => {
      const key = event?.query?.queryKey
      if (Array.isArray(key) && key[0] === 'messages-for-panels' && key[1] === conversationId) {
        scan()
      }
    })
    window.addEventListener('ai-edits-mutated', scan)
    return () => {
      unsub()
      window.removeEventListener('ai-edits-mutated', scan)
    }
  }, [conversationId, queryClientForAi])
  // Turn off the mask when the last AI-origin content is gone
  useEffect(() => {
    if (!hasAiContent && showAiOrigin) setShowAiOrigin(false)
  }, [hasAiContent, showAiOrigin, setShowAiOrigin])
  const previewFocus = usePreviewFocus() // When a nested preview chrome is selected, View styles target that page
  // Route Board Style controls to the focused preview page (else the host map)
  const boardRule = previewFocus?.focusedBoardId ? previewFocus.boardRule : hostBoardRule
  const setBoardRule = previewFocus?.focusedBoardId ? previewFocus.setBoardRule : setHostBoardRule
  const boardStyle = previewFocus?.focusedBoardId ? previewFocus.boardStyle : hostBoardStyle
  const setBoardStyle = previewFocus?.focusedBoardId ? previewFocus.setBoardStyle : setHostBoardStyle
  const { resolvedTheme } = useTheme() // Get theme for panel-matching opacity values
  const borderStyleButtonRef = useRef<HTMLButtonElement>(null)
  const borderStyleIconRef = useRef<HTMLImageElement>(null)
  const threadStyleButtonRef = useRef<HTMLButtonElement>(null)
  const threadStyleIconRef = useRef<HTMLImageElement>(null)
  const insertVerticalSpaceButtonRef = useRef<HTMLButtonElement>(null)
  const insertVerticalSpaceIconRef = useRef<HTMLImageElement>(null)
  const insertHorizontalSpaceButtonRef = useRef<HTMLButtonElement>(null)
  const insertHorizontalSpaceIconRef = useRef<HTMLImageElement>(null)
  
  // Helper function to convert hex to rgba with specified opacity
  const hexToRgba = (hex: string, opacity: number): string => {
    const cleanHex = hex.replace('#', '')
    const r = parseInt(cleanHex.substring(0, 2), 16)
    const g = parseInt(cleanHex.substring(2, 4), 16)
    const b = parseInt(cleanHex.substring(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${opacity})`
  }

  // Helper function to ensure solid hex color without transparency (for borders)
  // Converts rgba/rgb to hex, strips alpha channel, ensures solid color
  const getSolidColor = (color: string | undefined | null): string | undefined => {
    if (!color || color.trim() === '') return undefined
    
    // If already hex format (#RRGGBB or #RRGGBBAA), extract RGB and return solid hex
    if (color.startsWith('#')) {
      const hex = color.replace('#', '')
      // If 8 characters (includes alpha), take first 6
      if (hex.length === 8) {
        return `#${hex.substring(0, 6)}`
      }
      // If 6 characters, return as is
      if (hex.length === 6) {
        return color
      }
      // If 4 characters (short hex), expand to 6
      if (hex.length === 4) {
        return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
      }
      // If 3 characters (short hex), expand to 6
      if (hex.length === 3) {
        return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
      }
    }
    
    // If rgba/rgb format, convert to hex
    const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/)
    if (rgbaMatch) {
      const r = parseInt(rgbaMatch[1], 10)
      const g = parseInt(rgbaMatch[2], 10)
      const b = parseInt(rgbaMatch[3], 10)
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
    }
    
    // Return as is if format not recognized (fallback)
    return color
  }
  
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
  const DEFAULT_BOARD_STYLE: 'none' | 'dotted' | 'lined' | 'grid' = 'dotted'
  const DEFAULT_FILL_COLOR = '' // Transparent fill — matches default frame chrome
  const DEFAULT_BORDER_COLOR = '' // Transparent border — matches default frame chrome
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

  // Initialize with consistent defaults to avoid hydration mismatch, then load from Supabase
  const [lineStyle, setLineStyle] = useState<ThreadStylePref>('curved')
  const [editMode, setEditMode] = useState<'editing' | 'suggesting' | 'viewing'>('editing')
  // Use context values for drawTool and drawShape, with local state as fallback
  const drawTool = contextDrawTool ?? null
  const setDrawTool = setContextDrawTool
  const drawShape = contextDrawShape ?? 'rectangle'
  const setDrawShape = setContextDrawShape
  const [drawColor, setDrawColor] = useState<'black' | 'blue' | 'green' | 'red'>('black') // Current drawing color
  const [hiddenItems, setHiddenItems] = useState<Set<string>>(new Set())
  const preferencesLoadedRef = useRef(false) // Track if preferences have been loaded
  const toolbarRef = useRef<HTMLDivElement>(null)
  const leftSectionRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()
  const queryClient = useQueryClient()
  const router = useRouter()

  // Handle creating a new block (component panel)
  const handleCreateBlock = async () => {
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

      // Create an empty block card (untitled until titled → linked page)
      const { data: newMessage, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: currentConversationId,
          user_id: user.id,
          role: 'user',
          content: '', // Empty content to start
          metadata: newBlockMetadata(), // Map block card
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
    const savedLineStyle = localStorage.getItem('thinktable-horizontal-line-style') as ThreadStylePref | null
    if (savedLineStyle && ['curved', 'boxed', 'linear'].includes(savedLineStyle)) {
      setLineStyle(savedLineStyle)
    }

    const savedEditMode = localStorage.getItem('thinktable-edit-mode') as 'editing' | 'suggesting' | 'viewing' | null
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
              horizontalLineStyle?: ThreadStylePref
              editMode?: 'editing' | 'suggesting' | 'viewing'
            }

            // Update from Supabase if values exist (Supabase is source of truth for cross-device sync)
            if (prefs.horizontalLineStyle && ['curved', 'boxed', 'linear'].includes(prefs.horizontalLineStyle)) {
              setLineStyle(prefs.horizontalLineStyle)
              localStorage.setItem('thinktable-horizontal-line-style', prefs.horizontalLineStyle)
            }

            if (prefs.editMode && ['editing', 'suggesting', 'viewing'].includes(prefs.editMode)) {
              setEditMode(prefs.editMode)
              localStorage.setItem('thinktable-edit-mode', prefs.editMode)
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
      const savedLineStyle = localStorage.getItem('thinktable-horizontal-line-style') as ThreadStylePref | null
      if (savedLineStyle && ['curved', 'boxed', 'linear'].includes(savedLineStyle)) {
        setLineStyle(savedLineStyle)
      }

      const savedEditMode = localStorage.getItem('thinktable-edit-mode') as 'editing' | 'suggesting' | 'viewing' | null
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
                horizontalLineStyle?: ThreadStylePref
                editMode?: 'editing' | 'suggesting' | 'viewing'
              }

              // Update from Supabase if values exist
              if (prefs.horizontalLineStyle && ['curved', 'boxed', 'linear'].includes(prefs.horizontalLineStyle)) {
                setLineStyle(prefs.horizontalLineStyle)
                localStorage.setItem('thinktable-horizontal-line-style', prefs.horizontalLineStyle)
              }

              if (prefs.editMode && ['editing', 'suggesting', 'viewing'].includes(prefs.editMode)) {
                setEditMode(prefs.editMode)
                localStorage.setItem('thinktable-edit-mode', prefs.editMode)
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
    localStorage.setItem('thinktable-horizontal-line-style', lineStyle)

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
    localStorage.setItem('thinktable-edit-mode', editMode)

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

  // Selected isBlock frames on the board (chatPanel with promptMessage)
  const getSelectedFrames = () => {
    if (!reactFlowInstance) return []
    return reactFlowInstance.getNodes().filter((n) => {
      if (!n.selected) return false
      const meta = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
      return meta.isBlock === true
    })
  }

  // Persist metadata patches for selected frames (board pin / frame-group lock)
  const persistFrameMetaPatches = async (
    nodes: ReturnType<typeof getSelectedFrames>,
    patch: (meta: Record<string, unknown>) => Record<string, unknown>
  ) => {
    const supabase = createClient()
    for (const n of nodes) {
      const msgId = n.data?.promptMessage?.id as string | undefined
      if (!msgId) continue
      const { data: row } = await supabase
        .from('messages')
        .select('metadata')
        .eq('id', msgId)
        .maybeSingle()
      if (!row) continue
      const next = patch({ ...((row.metadata as Record<string, unknown>) || {}) })
      await supabase.from('messages').update({ metadata: next }).eq('id', msgId)
    }
  }

  // Board lock UI: pin selected frames in place on the board
  const [boardLockUi, setBoardLockUi] = useState<{ hasSelection: boolean; locked: boolean }>({
    hasSelection: false,
    locked: false,
  })

  // Frame lock UI: lock ≥2 selected frames so they drag as one group
  const [frameLockUi, setFrameLockUi] = useState<{
    hasMulti: boolean
    locked: boolean
  }>({
    hasMulti: false,
    locked: false,
  })

  // Re-read board pin + frame-group lock from RF selection metadata
  const refreshLockUi = () => {
    if (!reactFlowInstance) {
      setBoardLockUi({ hasSelection: false, locked: false })
      setFrameLockUi({ hasMulti: false, locked: false })
      return
    }
    const selected = getSelectedFrames()
    if (selected.length === 0) {
      setBoardLockUi({ hasSelection: false, locked: false })
      setFrameLockUi({ hasMulti: false, locked: false })
      return
    }
    const allBoardLocked = selected.every((n) => {
      const meta = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
      return meta.boardLocked === true
    })
    setBoardLockUi({ hasSelection: true, locked: allBoardLocked })
    if (selected.length < 2) {
      setFrameLockUi({ hasMulti: false, locked: false })
      return
    }
    const groupIds = selected.map((n) => {
      const meta = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
      return typeof meta.frameLockGroupId === 'string' ? meta.frameLockGroupId : null
    })
    const locked =
      groupIds.every((id) => typeof id === 'string') && new Set(groupIds).size === 1
    setFrameLockUi({ hasMulti: true, locked })
  }

  useEffect(() => {
    refreshLockUi()
    const onSel = () => refreshLockUi()
    window.addEventListener('node-selected', onSel)
    window.addEventListener('tt-selection-changed', onSel)
    window.addEventListener('tt-frame-lock-changed', onSel)
    return () => {
      window.removeEventListener('node-selected', onSel)
      window.removeEventListener('tt-selection-changed', onSel)
      window.removeEventListener('tt-frame-lock-changed', onSel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh closes over reactFlowInstance
  }, [reactFlowInstance])

  // Lock selected frames to the board (pin: not draggable)
  const handleToggleBoardLock = () => {
    if (!reactFlowInstance) return
    const selected = getSelectedFrames()
    if (selected.length === 0) return
    getMapTakeSnapshot()?.()
    const nextLocked = !selected.every((n) => {
      const meta = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
      return meta.boardLocked === true
    })
    const ids = new Set(selected.map((n) => n.id))
    reactFlowInstance.setNodes((nds) =>
      nds.map((n) => {
        if (!ids.has(n.id)) return n
        const pm = n.data?.promptMessage
        if (!pm) return n
        const meta = { ...(pm.metadata || {}), boardLocked: nextLocked }
        if (!nextLocked) delete (meta as Record<string, unknown>).boardLocked
        return {
          ...n,
          draggable: nextLocked ? false : !isLocked, // Stay undraggable if global board freeze is on
          data: {
            ...n.data,
            promptMessage: { ...pm, metadata: meta },
          },
        }
      })
    )
    setBoardLockUi({ hasSelection: true, locked: nextLocked })
    window.dispatchEvent(new Event('tt-frame-lock-changed'))
    void persistFrameMetaPatches(selected, (meta) => {
      const next = { ...meta }
      if (nextLocked) next.boardLocked = true
      else delete next.boardLocked
      return next
    }).catch((err) => console.error('Failed to persist board lock:', err))
  }

  // Lock selected frames to each other (shared frameLockGroupId → rigid drag)
  const handleToggleFrameLock = () => {
    if (!reactFlowInstance) return
    const selected = getSelectedFrames()
    if (selected.length < 2) return // Need at least two frames
    getMapTakeSnapshot()?.()
    const groupIds = selected.map((n) => {
      const meta = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
      return typeof meta.frameLockGroupId === 'string' ? meta.frameLockGroupId : null
    })
    const alreadyLocked =
      groupIds.every((id) => typeof id === 'string') && new Set(groupIds).size === 1
    const nextGroupId = alreadyLocked ? null : crypto.randomUUID()
    const ids = new Set(selected.map((n) => n.id))
    reactFlowInstance.setNodes((nds) =>
      nds.map((n) => {
        if (!ids.has(n.id)) return n
        const pm = n.data?.promptMessage
        if (!pm) return n
        const meta = { ...(pm.metadata || {}) } as Record<string, unknown>
        if (nextGroupId) meta.frameLockGroupId = nextGroupId
        else delete meta.frameLockGroupId
        return {
          ...n,
          data: {
            ...n.data,
            promptMessage: { ...pm, metadata: meta },
          },
        }
      })
    )
    setFrameLockUi({ hasMulti: true, locked: !alreadyLocked })
    window.dispatchEvent(new Event('tt-frame-lock-changed'))
    void persistFrameMetaPatches(selected, (meta) => {
      const next = { ...meta }
      if (nextGroupId) next.frameLockGroupId = nextGroupId
      else delete next.frameLockGroupId
      return next
    }).catch((err) => console.error('Failed to persist frame-group lock:', err))
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
          { id: 'lock', width: 40 },
        ]
        : editMenuPillMode === 'view'
          ? [
            // View mode buttons: Board Style dropdown
            // Board Style: Grid icon (16px) + gap (6px) + text "Board Style" (~80px) + padding (16px) = ~118px
            { id: 'boardStyle', width: 118 },
            { id: 'snap', width: 40 },
            { id: 'undoRedo', width: 70 },
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
                  { id: 'lock', width: 88 }, // Board lock + / + frame lock
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
                  { id: 'lock', width: 88 }, // Board lock + / + frame lock
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
    <div
      ref={toolbarRef}
      data-preview-style-chrome // Clicks here keep nested preview style-focus alive
      className="flex items-center gap-1 h-full flex-1 overflow-hidden"
    >
      {/* Left Section - collapsible items */}
      <div ref={leftSectionRef} className="flex items-center gap-1 flex-shrink min-w-0">
        {/* Board lock / frame lock — pin to board vs lock selected frames together */}
        {!isItemHidden('lock') && (
          <>
            <div className="flex items-center px-1.5 flex-shrink-0 gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleToggleBoardLock}
                className={cn(
                  'h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] flex-shrink-0',
                  boardLockUi.hasSelection &&
                    boardLockUi.locked &&
                    'bg-gray-100 dark:bg-[#1f1f1f] text-gray-900 dark:text-gray-100'
                )}
                disabled={!reactFlowInstance || !boardLockUi.hasSelection}
                title={
                  !boardLockUi.hasSelection
                    ? 'Select a frame to lock to the board'
                    : boardLockUi.locked
                      ? 'Unlock from board'
                      : 'Lock to board'
                }
                aria-label={boardLockUi.locked ? 'Unlock from board' : 'Lock to board'}
              >
                <LockSubIcon
                  locked={boardLockUi.hasSelection && boardLockUi.locked}
                  SubIcon={FileText}
                />
              </Button>
              <span
                className="text-gray-400 dark:text-gray-500 text-sm font-medium select-none px-0.5"
                aria-hidden
              >
                /
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleToggleFrameLock}
                className={cn(
                  'h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] flex-shrink-0',
                  frameLockUi.hasMulti &&
                    frameLockUi.locked &&
                    'bg-gray-100 dark:bg-[#1f1f1f] text-gray-900 dark:text-gray-100'
                )}
                disabled={!reactFlowInstance || !frameLockUi.hasMulti}
                title={
                  !frameLockUi.hasMulti
                    ? 'Select 2+ frames to lock together'
                    : frameLockUi.locked
                      ? 'Unlock frames from each other'
                      : 'Lock frames to each other'
                }
                aria-label={
                  frameLockUi.locked ? 'Unlock frames from each other' : 'Lock frames to each other'
                }
              >
                <LockSubIcon
                  locked={frameLockUi.hasMulti && frameLockUi.locked}
                  SubIcon={Square}
                />
              </Button>
            </div>
            <div className="w-px h-6 bg-gray-300 dark:bg-gray-500 mx-1 flex-shrink-0" />
          </>
        )}

        {/* Undo/Redo Controls */}
        {!isItemHidden('undoRedo') && (
          <>
            <div className="flex items-center gap-1 px-2 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  // Check if focus is in an editor (TipTap, contenteditable, input, textarea)
                  const activeElement = document.activeElement
                  const isInEditor = activeElement?.closest('.ProseMirror') !== null ||
                    activeElement?.closest('[contenteditable="true"]') !== null ||
                    activeElement?.tagName === 'INPUT' ||
                    activeElement?.tagName === 'TEXTAREA'
                  
                  // If in editor with undo history, use editor undo; otherwise use map undo
                  if (isInEditor && editor?.can().undo()) {
                    editor.chain().focus().undo().run()
                  } else if (canMapUndo) {
                    mapUndo()
                  } else if (editor?.can().undo()) {
                    editor.chain().focus().undo().run()
                  }
                }}
                disabled={!canMapUndo && (!editor || !editor.can().undo())}
                className="h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  // Check if focus is in an editor (TipTap, contenteditable, input, textarea)
                  const activeElement = document.activeElement
                  const isInEditor = activeElement?.closest('.ProseMirror') !== null ||
                    activeElement?.closest('[contenteditable="true"]') !== null ||
                    activeElement?.tagName === 'INPUT' ||
                    activeElement?.tagName === 'TEXTAREA'
                  
                  // If in editor with redo history, use editor redo; otherwise use map redo
                  if (isInEditor && editor?.can().redo()) {
                    editor.chain().focus().redo().run()
                  } else if (canMapRedo) {
                    mapRedo()
                  } else if (editor?.can().redo()) {
                    editor.chain().focus().redo().run()
                  }
                }}
                disabled={!canMapRedo && (!editor || !editor.can().redo())}
                className="h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                title="Redo (Ctrl+Shift+Z)"
              >
                <Redo2 className="h-4 w-4" />
              </Button>
            </div>
            {/* Slash separator after undo/redo through thread styling */}
            <span className="flex h-7 items-center text-2xl font-thin text-gray-300 dark:text-gray-500 mx-1 flex-shrink-0 select-none leading-none" aria-hidden>/</span>
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
            {/* Group 1: Selection Mode Toggle (Lasso), Insert Vertical Space, Insert Horizontal Space */}
            {!isItemHidden('drawGroup1') && (
              <>
                <div className="flex items-center gap-1 px-2 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      // Toggle lasso tool - if already selected, deselect it
                      if (drawTool === 'lasso') {
                        setDrawTool(null)
                        setIsDrawing(false) // Disable drawing mode
                      } else {
                        setDrawTool('lasso')
                        setIsDrawing(false) // Disable drawing mode when using selection
                      }
                      // Blur the button to remove focus state
                      e.currentTarget.blur()
                    }}
                    className={cn(
                      "h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 flex-shrink-0",
                      drawTool === 'lasso' 
                        ? 'bg-gray-100 dark:bg-gray-800' 
                        : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                    )}
                    title={drawTool === 'lasso' ? 'Selection Mode Active (Click to deselect)' : 'Selection Mode (Click to enable)'}
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
            {/* Group 2: Eraser (Not yet implemented) */}
            {!isItemHidden('drawGroup2') && (
              <>
                <div className="flex items-center gap-1 px-2 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      // Toggle eraser tool - if already selected, deselect it
                      if (drawTool === 'eraser') {
                        setDrawTool(null)
                        setIsDrawing(false) // Disable drawing mode
                      } else {
                        setDrawTool('eraser')
                        setIsDrawing(false) // Disable drawing mode when using eraser (if implemented)
                      }
                      // Blur the button to remove focus state
                      e.currentTarget.blur()
                    }}
                    className={cn(
                      "h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 flex-shrink-0",
                      drawTool === 'eraser' 
                        ? 'bg-gray-100 dark:bg-gray-800' 
                        : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                    )}
                    title={drawTool === 'eraser' ? 'Eraser Active (Click to deselect)' : 'Eraser (Not yet implemented)'}
                  >
                    <Eraser className="h-4 w-4" />
                  </Button>
                </div>
                <div className="w-px h-6 bg-gray-300 dark:bg-gray-500 mx-0.5 flex-shrink-0" />
              </>
            )}
            {/* Group 3: Freehand Drawing Toggle (Pencil), Highlighter */}
            {!isItemHidden('drawGroup3') && (
              <>
                <div className="flex items-center gap-1 px-2 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      // Toggle pencil tool - if already selected, deselect it
                      if (drawTool === 'pencil') {
                        setDrawTool(null)
                        setIsDrawing(false) // Disable drawing mode
                      } else {
                        setDrawTool('pencil')
                        setIsDrawing(true) // Enable drawing mode when selecting pencil
                      }
                      // Blur the button to remove focus state
                      e.currentTarget.blur()
                    }}
                    className={cn(
                      "h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 flex-shrink-0",
                      drawTool === 'pencil' 
                        ? 'bg-gray-100 dark:bg-gray-800' 
                        : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                    )}
                    title={drawTool === 'pencil' ? 'Drawing Mode Active (Click to deselect)' : 'Freehand Drawing (Click to enable drawing mode)'}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      // Toggle highlighter tool - if already selected, deselect it
                      if (drawTool === 'highlighter') {
                        setDrawTool(null)
                        setIsDrawing(false) // Disable drawing mode
                      } else {
                        setDrawTool('highlighter')
                        setIsDrawing(false) // Disable drawing mode when using highlighter (if implemented)
                      }
                      // Blur the button to remove focus state
                      e.currentTarget.blur()
                    }}
                    className={cn(
                      "h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 flex-shrink-0",
                      drawTool === 'highlighter' 
                        ? 'bg-gray-100 dark:bg-gray-800' 
                        : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                    )}
                    title={drawTool === 'highlighter' ? 'Highlighter Active (Click to deselect)' : 'Highlighter (Not yet implemented)'}
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
              <DropdownMenu modal={false} open={openDropdown === 'shapes'} onOpenChange={(open) => handleDropdownOpenChange('shapes', open)}>
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
                <DropdownMenuContent 
                  align="start" 
                  className="w-64 p-3"
                  onInteractOutside={(e) => {
                    // Prevent closing when dragging shapes
                    if (e.target instanceof HTMLElement && e.target.closest('[draggable="true"]')) {
                      e.preventDefault();
                    }
                  }}
                >
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 px-2">
                    Drag shapes to the canvas
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {(['rectangle', 'round-rectangle', 'circle', 'hexagon', 'diamond', 'arrow-rectangle', 'cylinder', 'triangle', 'parallelogram', 'plus'] as const).map((shapeType) => (
                      <ShapeGridItem
                        key={shapeType}
                        shapeType={shapeType}
                        isSelected={drawShape === shapeType}
                        onSelect={() => {
                          setDrawShape(shapeType)
                          setDrawTool(null)
                          setIsDrawing(true)
                        }}
                      />
                    ))}
                  </div>
                  <DropdownMenuSeparator className="my-2" />
                  <div className="flex gap-1">
                    <DropdownMenuItem 
                      onClick={() => {
                        setDrawShape('line')
                        setDrawTool(null)
                        setIsDrawing(true)
                      }}
                      className="flex-1"
                    >
                      Line
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={() => {
                        setDrawShape('arrow')
                        setDrawTool(null)
                        setIsDrawing(true)
                      }}
                      className="flex-1"
                    >
                      Arrow
                    </DropdownMenuItem>
                  </div>
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

        {/* Snap Toggle Button - View Mode Only */}
        {editMenuPillMode === 'view' && !isItemHidden('snap') && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSnapEnabled(!snapEnabled)}
              className={cn(
                'h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0',
                snapEnabled && 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              )}
              title={snapEnabled ? 'Disable snap to grid' : 'Enable snap to grid'}
            >
              <Move className="h-4 w-4" />
            </Button>
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
            <span className="flex h-7 items-center text-2xl font-thin text-gray-300 dark:text-gray-500 mx-1 flex-shrink-0 select-none leading-none" aria-hidden>/</span>
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
              <span className="flex h-7 items-center text-2xl font-thin text-gray-300 dark:text-gray-500 mx-1 flex-shrink-0 select-none leading-none" aria-hidden>/</span>
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
              <span className="flex h-7 items-center text-2xl font-thin text-gray-300 dark:text-gray-500 mx-1 flex-shrink-0 select-none leading-none" aria-hidden>/</span>
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
              {/* Text Color Dropdown - only show if color extension is available */}
              {editor?.extensionManager.extensions.find(ext => ext.name === 'textStyle') && (() => {
                const textColor = editor?.getAttributes('textStyle').color
                // Convert hex to rgba with 0.15 opacity (same as response panel)
                const hexToRgba = (hex: string, opacity: number): string => {
                  const cleanHex = hex.replace('#', '')
                  const r = parseInt(cleanHex.substring(0, 2), 16)
                  const g = parseInt(cleanHex.substring(2, 4), 16)
                  const b = parseInt(cleanHex.substring(4, 6), 16)
                  return `rgba(${r}, ${g}, ${b}, ${opacity})`
                }
                const buttonBgColor = textColor ? hexToRgba(textColor, 0.15) : 'transparent'
                
                return (
                  <DropdownMenu open={openDropdown === 'textColor'} onOpenChange={(open) => handleDropdownOpenChange('textColor', open)}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!editor}
                        className={cn(
                          'h-7 w-7 p-0 text-gray-600 hover:text-gray-900 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed'
                        )}
                        style={{
                          backgroundColor: buttonBgColor
                        }}
                        onMouseEnter={(e) => {
                          if (buttonBgColor !== 'transparent') {
                            // Slightly increase opacity on hover
                            const hoverColor = textColor ? hexToRgba(textColor, 0.25) : 'transparent'
                            e.currentTarget.style.backgroundColor = hoverColor
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = buttonBgColor
                        }}
                        title="Text Color"
                      >
                        <span className="text-xs font-semibold">A</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-48">
                    <DropdownMenuLabel>Text Color</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <div className="grid grid-cols-4 gap-2 p-2">
                      {/* Default/Black */}
                      <button
                        onClick={() => {
                          editor?.chain().focus().setColor('#000000').run()
                          handleDropdownOpenChange('textColor', false)
                        }}
                        className={cn(
                          'w-8 h-8 rounded border-2 flex items-center justify-center text-xs font-medium transition-all',
                          !editor?.getAttributes('textStyle').color || editor?.getAttributes('textStyle').color === '#000000'
                            ? 'border-gray-900 dark:border-gray-100 ring-2 ring-offset-1 ring-gray-400'
                            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                        )}
                        style={{ backgroundColor: '#000000' }}
                        title="Black"
                      >
                        {(!editor?.getAttributes('textStyle').color || editor?.getAttributes('textStyle').color === '#000000') && (
                          <span className="text-white text-xs">✓</span>
                        )}
                      </button>
                      {/* Red */}
                      <button
                        onClick={() => {
                          editor?.chain().focus().setColor('#ef4444').run()
                          handleDropdownOpenChange('textColor', false)
                        }}
                        className={cn(
                          'w-8 h-8 rounded border-2 flex items-center justify-center text-xs font-medium transition-all',
                          editor?.getAttributes('textStyle').color === '#ef4444'
                            ? 'border-gray-900 dark:border-gray-100 ring-2 ring-offset-1 ring-gray-400'
                            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                        )}
                        style={{ backgroundColor: '#ef4444' }}
                        title="Red"
                      >
                        {editor?.getAttributes('textStyle').color === '#ef4444' && (
                          <span className="text-white text-xs">✓</span>
                        )}
                      </button>
                      {/* Orange */}
                      <button
                        onClick={() => {
                          editor?.chain().focus().setColor('#f97316').run()
                          handleDropdownOpenChange('textColor', false)
                        }}
                        className={cn(
                          'w-8 h-8 rounded border-2 flex items-center justify-center text-xs font-medium transition-all',
                          editor?.getAttributes('textStyle').color === '#f97316'
                            ? 'border-gray-900 dark:border-gray-100 ring-2 ring-offset-1 ring-gray-400'
                            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                        )}
                        style={{ backgroundColor: '#f97316' }}
                        title="Orange"
                      >
                        {editor?.getAttributes('textStyle').color === '#f97316' && (
                          <span className="text-white text-xs">✓</span>
                        )}
                      </button>
                      {/* Yellow */}
                      <button
                        onClick={() => {
                          editor?.chain().focus().setColor('#eab308').run()
                          handleDropdownOpenChange('textColor', false)
                        }}
                        className={cn(
                          'w-8 h-8 rounded border-2 flex items-center justify-center text-xs font-medium transition-all',
                          editor?.getAttributes('textStyle').color === '#eab308'
                            ? 'border-gray-900 dark:border-gray-100 ring-2 ring-offset-1 ring-gray-400'
                            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                        )}
                        style={{ backgroundColor: '#eab308' }}
                        title="Yellow"
                      >
                        {editor?.getAttributes('textStyle').color === '#eab308' && (
                          <span className="text-gray-900 text-xs">✓</span>
                        )}
                      </button>
                      {/* Green */}
                      <button
                        onClick={() => {
                          editor?.chain().focus().setColor('#22c55e').run()
                          handleDropdownOpenChange('textColor', false)
                        }}
                        className={cn(
                          'w-8 h-8 rounded border-2 flex items-center justify-center text-xs font-medium transition-all',
                          editor?.getAttributes('textStyle').color === '#22c55e'
                            ? 'border-gray-900 dark:border-gray-100 ring-2 ring-offset-1 ring-gray-400'
                            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                        )}
                        style={{ backgroundColor: '#22c55e' }}
                        title="Green"
                      >
                        {editor?.getAttributes('textStyle').color === '#22c55e' && (
                          <span className="text-white text-xs">✓</span>
                        )}
                      </button>
                      {/* Blue */}
                      <button
                        onClick={() => {
                          editor?.chain().focus().setColor('#3b82f6').run()
                          handleDropdownOpenChange('textColor', false)
                        }}
                        className={cn(
                          'w-8 h-8 rounded border-2 flex items-center justify-center text-xs font-medium transition-all',
                          editor?.getAttributes('textStyle').color === '#3b82f6'
                            ? 'border-gray-900 dark:border-gray-100 ring-2 ring-offset-1 ring-gray-400'
                            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                        )}
                        style={{ backgroundColor: '#3b82f6' }}
                        title="Blue"
                      >
                        {editor?.getAttributes('textStyle').color === '#3b82f6' && (
                          <span className="text-white text-xs">✓</span>
                        )}
                      </button>
                      {/* Purple */}
                      <button
                        onClick={() => {
                          editor?.chain().focus().setColor('#a855f7').run()
                          handleDropdownOpenChange('textColor', false)
                        }}
                        className={cn(
                          'w-8 h-8 rounded border-2 flex items-center justify-center text-xs font-medium transition-all',
                          editor?.getAttributes('textStyle').color === '#a855f7'
                            ? 'border-gray-900 dark:border-gray-100 ring-2 ring-offset-1 ring-gray-400'
                            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                        )}
                        style={{ backgroundColor: '#a855f7' }}
                        title="Purple"
                      >
                        {editor?.getAttributes('textStyle').color === '#a855f7' && (
                          <span className="text-white text-xs">✓</span>
                        )}
                      </button>
                      {/* Pink */}
                      <button
                        onClick={() => {
                          editor?.chain().focus().setColor('#ec4899').run()
                          handleDropdownOpenChange('textColor', false)
                        }}
                        className={cn(
                          'w-8 h-8 rounded border-2 flex items-center justify-center text-xs font-medium transition-all',
                          editor?.getAttributes('textStyle').color === '#ec4899'
                            ? 'border-gray-900 dark:border-gray-100 ring-2 ring-offset-1 ring-gray-400'
                            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                        )}
                        style={{ backgroundColor: '#ec4899' }}
                        title="Pink"
                      >
                        {editor?.getAttributes('textStyle').color === '#ec4899' && (
                          <span className="text-white text-xs">✓</span>
                        )}
                      </button>
                      {/* Gray */}
                      <button
                        onClick={() => {
                          editor?.chain().focus().setColor('#6b7280').run()
                          handleDropdownOpenChange('textColor', false)
                        }}
                        className={cn(
                          'w-8 h-8 rounded border-2 flex items-center justify-center text-xs font-medium transition-all',
                          editor?.getAttributes('textStyle').color === '#6b7280'
                            ? 'border-gray-900 dark:border-gray-100 ring-2 ring-offset-1 ring-gray-400'
                            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                        )}
                        style={{ backgroundColor: '#6b7280' }}
                        title="Gray"
                      >
                        {editor?.getAttributes('textStyle').color === '#6b7280' && (
                          <span className="text-white text-xs">✓</span>
                        )}
                      </button>
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        editor?.chain().focus().unsetColor().run()
                        handleDropdownOpenChange('textColor', false)
                      }}
                    >
                      Remove Color
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                  </DropdownMenu>
                )
              })()}
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
              <span className="flex h-7 items-center text-2xl font-thin text-gray-300 dark:text-gray-500 mx-1 flex-shrink-0 select-none leading-none" aria-hidden>/</span>
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
              <span className="flex h-7 items-center text-2xl font-thin text-gray-300 dark:text-gray-500 mx-1 flex-shrink-0 select-none leading-none" aria-hidden>/</span>
            </>
          )}

          {/* Panel Styling Controls - Fill Color, Border Color, Border Weight, Border Style - Each as separate icon-only button */}
          {!isItemHidden('panelControls') && !shouldHideFormattingOptions && (
            <>
              {/* Fill Color Button */}
              <DropdownMenu open={openDropdown === 'fillColor'} onOpenChange={(open) => handleDropdownOpenChange('fillColor', open)}>
                <DropdownMenuTrigger asChild>
                  {(() => {
                    // Match response panel opacity adjusted for top bar vs canvas brightness difference
                    // Top bar is ~2% brighter in light mode, ~3.1% brighter in dark mode
                    // Light mode: 10% + 2% = 12%, Dark mode: 15% + 3.1% = 18.1%
                    const opacity = resolvedTheme === 'dark' ? 0.181 : 0.12
                    const hasFill = Boolean(fillColor && fillColor.trim() !== '') // Colored fill vs transparent default
                    const buttonBgColor = hasFill ? hexToRgba(fillColor, opacity) : 'transparent' // Match frame fill preview
                    const borderColorWithOpacity = hasFill ? hexToRgba(fillColor, opacity) : 'transparent' // No outline when transparent
                    
                    return (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 flex-shrink-0 flex items-center justify-center border border-solid border-transparent"
                        style={{
                          backgroundColor: buttonBgColor, // Preview fill on the button
                          borderColor: borderColorWithOpacity, // Colored when set; transparent when clear
                        }}
                        onMouseEnter={(e) => {
                          if (buttonBgColor !== 'transparent' && fillColor) {
                            // Slightly increase opacity on hover
                            const hoverColor = hexToRgba(fillColor, 0.25)
                            e.currentTarget.style.backgroundColor = hoverColor
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = buttonBgColor
                        }}
                        title="Fill Color"
                      >
                        <PaintBucket className="h-3.5 w-3.5" />
                      </Button>
                    )
                  })()}
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
                  {(() => {
                    // Match response panel opacity adjusted for top bar vs canvas brightness difference
                    // Top bar is ~2% brighter in light mode, ~3.1% brighter in dark mode
                    // Light mode: 10% + 2% = 12%, Dark mode: 15% + 3.1% = 18.1%
                    const opacity = resolvedTheme === 'dark' ? 0.181 : 0.12
                    const hasBorder = Boolean(borderColor && borderColor.trim() !== '') // Colored border vs transparent default
                    const buttonBgColor = hasBorder ? hexToRgba(borderColor, opacity) : 'transparent' // Match frame border preview
                    const borderColorWithOpacity = hasBorder ? hexToRgba(borderColor, opacity) : 'transparent' // No outline when transparent
                    
                    return (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 flex-shrink-0 flex items-center justify-center border border-solid border-transparent"
                        style={{
                          backgroundColor: buttonBgColor, // Preview border tint on the button
                          borderColor: borderColorWithOpacity, // Colored when set; transparent when clear
                        }}
                        onMouseEnter={(e) => {
                          if (buttonBgColor !== 'transparent' && borderColor) {
                            // Slightly increase opacity on hover
                            const hoverColor = hexToRgba(borderColor, 0.25)
                            e.currentTarget.style.backgroundColor = hoverColor
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = buttonBgColor
                        }}
                        title="Border Color"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )
                  })()}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  <div className="px-2 py-1.5">
                    <input
                      type="color"
                      value={borderColor || '#ffffff'}
                      onChange={(e) => setBorderColor(e.target.value)}
                      className="w-full h-8 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
                      title="Border Color"
                      aria-label="Border Color"
                    />
                    {/* Transparent option — same as fill: empty string clears the frame border */}
                    <Button
                      variant={!borderColor ? "default" : "outline"}
                      size="sm"
                      className="w-full mt-2 h-7 text-xs"
                      onClick={() => setBorderColor('')}
                    >
                      Transparent
                    </Button>
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
                    <DropdownMenuRadioItem value="dashed" className="pl-8 text-xs">Directional</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  
                  {/* Separator */}
                  <DropdownMenuSeparator className="mx-2" />
                  
                  {/* Curve Style Options — Smooth · Sharp (90°) · Linear (straight) */}
                  <DropdownMenuRadioGroup 
                    value={
                      lineStyle === 'boxed'
                        ? 'sharp'
                        : lineStyle === 'linear'
                          ? 'linear'
                          : 'smooth'
                    }
                    onValueChange={(value) => {
                      const next: ThreadStylePref =
                        value === 'sharp'
                          ? 'boxed'
                          : value === 'linear'
                            ? 'linear'
                            : 'curved'
                      setLineStyle(next)
                      // Apply to selected threads immediately
                      const algorithm = threadAlgorithmFromStyle(next)
                      reactFlowInstance?.setEdges((eds) =>
                        eds.map((e) => {
                          if (!e.selected && e.id !== clickedEdge?.id) return e
                          if (e.type !== 'editable' && e.type !== 'animatedDotted')
                            return e
                          return {
                            ...e,
                            data: {
                              ...(e.data as object),
                              algorithm,
                            },
                          }
                        })
                      )
                    }}
                  >
                    <DropdownMenuRadioItem value="smooth" className="pl-8 text-xs">Smooth</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="sharp" className="pl-8 text-xs">Sharp</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="linear" className="pl-8 text-xs">Linear</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Divider left of edge direction — groups direction with layout type */}
              <div className="w-px h-6 bg-gray-300 dark:bg-gray-500 mx-1 flex-shrink-0" />

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
                {/* Common items (undo/redo, lock) */}
                {isItemHidden('undoRedo') && editor && (
                  <>
                    <DropdownMenuItem
                      onClick={() => {
                      if (canMapUndo) mapUndo()
                      else editor.chain().focus().undo().run()
                    }}
                      disabled={!canMapUndo && !editor.can().undo()}
                    >
                      <Undo2 className="h-4 w-4 mr-2" />
                      Undo
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                      if (canMapRedo) mapRedo()
                      else editor.chain().focus().redo().run()
                    }}
                      disabled={!canMapRedo && !editor.can().redo()}
                    >
                      <Redo2 className="h-4 w-4 mr-2" />
                      Redo
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('lock') && reactFlowInstance && (
                  <>
                    <DropdownMenuItem
                      onClick={handleToggleBoardLock}
                      disabled={!boardLockUi.hasSelection}
                    >
                      <span className="mr-2 inline-flex">
                        <LockSubIcon
                          locked={boardLockUi.hasSelection && boardLockUi.locked}
                          SubIcon={FileText}
                        />
                      </span>
                      {boardLockUi.locked ? 'Unlock from board' : 'Lock to board'}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleToggleFrameLock}
                      disabled={!frameLockUi.hasMulti}
                    >
                      <span className="mr-2 inline-flex">
                        <LockSubIcon
                          locked={frameLockUi.hasMulti && frameLockUi.locked}
                          SubIcon={Square}
                        />
                      </span>
                      {frameLockUi.locked
                        ? 'Unlock frames from each other'
                        : 'Lock frames to each other'}
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
                {/* Common items (undo/redo, lock) */}
                {isItemHidden('undoRedo') && editor && (
                  <>
                    <DropdownMenuItem
                      onClick={() => {
                      if (canMapUndo) mapUndo()
                      else editor.chain().focus().undo().run()
                    }}
                      disabled={!canMapUndo && !editor.can().undo()}
                    >
                      <Undo2 className="h-4 w-4 mr-2" />
                      Undo
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                      if (canMapRedo) mapRedo()
                      else editor.chain().focus().redo().run()
                    }}
                      disabled={!canMapRedo && !editor.can().redo()}
                    >
                      <Redo2 className="h-4 w-4 mr-2" />
                      Redo
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('lock') && reactFlowInstance && (
                  <>
                    <DropdownMenuItem
                      onClick={handleToggleBoardLock}
                      disabled={!boardLockUi.hasSelection}
                    >
                      <span className="mr-2 inline-flex">
                        <LockSubIcon
                          locked={boardLockUi.hasSelection && boardLockUi.locked}
                          SubIcon={FileText}
                        />
                      </span>
                      {boardLockUi.locked ? 'Unlock from board' : 'Lock to board'}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleToggleFrameLock}
                      disabled={!frameLockUi.hasMulti}
                    >
                      <span className="mr-2 inline-flex">
                        <LockSubIcon
                          locked={frameLockUi.hasMulti && frameLockUi.locked}
                          SubIcon={Square}
                        />
                      </span>
                      {frameLockUi.locked
                        ? 'Unlock frames from each other'
                        : 'Lock frames to each other'}
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
                    <DropdownMenuItem onClick={() => {
                      if (drawTool === 'pencil') {
                        setDrawTool(null)
                        setIsDrawing(false)
                      } else {
                        setDrawTool('pencil')
                        setIsDrawing(true)
                      }
                    }}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Pencil
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => {
                      if (drawTool === 'highlighter') {
                        setDrawTool(null)
                        setIsDrawing(false)
                      } else {
                        setDrawTool('highlighter')
                        setIsDrawing(false)
                      }
                    }}>
                      <Highlighter className="h-4 w-4 mr-2" />
                      Highlighter
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {/* Group 2: Eraser */}
                {isItemHidden('drawGroup2') && (
                  <>
                    <DropdownMenuItem onClick={() => {
                      if (drawTool === 'eraser') {
                        setDrawTool(null)
                        setIsDrawing(false)
                      } else {
                        setDrawTool('eraser')
                        setIsDrawing(false)
                      }
                    }}>
                      <Eraser className="h-4 w-4 mr-2" />
                      Eraser
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {/* Group 1: Lasso, Insert Vertical Space, Insert Horizontal Space */}
                {isItemHidden('drawGroup1') && (
                  <>
                    <DropdownMenuItem onClick={() => {
                      if (drawTool === 'lasso') {
                        setDrawTool(null)
                        setIsDrawing(false)
                      } else {
                        setDrawTool('lasso')
                        setIsDrawing(false)
                      }
                    }}>
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
                {/* Common items (undo/redo, lock) */}
                {isItemHidden('undoRedo') && editor && (
                  <>
                    <DropdownMenuItem
                      onClick={() => {
                      if (canMapUndo) mapUndo()
                      else editor.chain().focus().undo().run()
                    }}
                      disabled={!canMapUndo && !editor.can().undo()}
                    >
                      <Undo2 className="h-4 w-4 mr-2" />
                      Undo
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                      if (canMapRedo) mapRedo()
                      else editor.chain().focus().redo().run()
                    }}
                      disabled={!canMapRedo && !editor.can().redo()}
                    >
                      <Redo2 className="h-4 w-4 mr-2" />
                      Redo
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('lock') && reactFlowInstance && (
                  <>
                    <DropdownMenuItem
                      onClick={handleToggleBoardLock}
                      disabled={!boardLockUi.hasSelection}
                    >
                      <span className="mr-2 inline-flex">
                        <LockSubIcon
                          locked={boardLockUi.hasSelection && boardLockUi.locked}
                          SubIcon={FileText}
                        />
                      </span>
                      {boardLockUi.locked ? 'Unlock from board' : 'Lock to board'}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleToggleFrameLock}
                      disabled={!frameLockUi.hasMulti}
                    >
                      <span className="mr-2 inline-flex">
                        <LockSubIcon
                          locked={frameLockUi.hasMulti && frameLockUi.locked}
                          SubIcon={Square}
                        />
                      </span>
                      {frameLockUi.locked
                        ? 'Unlock frames from each other'
                        : 'Lock frames to each other'}
                    </DropdownMenuItem>
                  </>
                )}
              </>
            ) : (
              <>
                {/* Home mode items (formatting options) */}
                {isItemHidden('lock') && reactFlowInstance && (
                  <>
                    <DropdownMenuItem
                      onClick={handleToggleBoardLock}
                      disabled={!boardLockUi.hasSelection}
                    >
                      <span className="mr-2 inline-flex">
                        <LockSubIcon
                          locked={boardLockUi.hasSelection && boardLockUi.locked}
                          SubIcon={FileText}
                        />
                      </span>
                      {boardLockUi.locked ? 'Unlock from board' : 'Lock to board'}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleToggleFrameLock}
                      disabled={!frameLockUi.hasMulti}
                    >
                      <span className="mr-2 inline-flex">
                        <LockSubIcon
                          locked={frameLockUi.hasMulti && frameLockUi.locked}
                          SubIcon={Square}
                        />
                      </span>
                      {frameLockUi.locked
                        ? 'Unlock frames from each other'
                        : 'Lock frames to each other'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('undoRedo') && editor && (
                  <>
                    <DropdownMenuItem
                      onClick={() => {
                      if (canMapUndo) mapUndo()
                      else editor.chain().focus().undo().run()
                    }}
                      disabled={!canMapUndo && !editor.can().undo()}
                    >
                      <Undo2 className="h-4 w-4 mr-2" />
                      Undo
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                      if (canMapRedo) mapRedo()
                      else editor.chain().focus().redo().run()
                    }}
                      disabled={!canMapRedo && !editor.can().redo()}
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
                      <div
                        className={`w-full h-8 rounded border overflow-hidden ${
                          fillColor && fillColor.trim() !== '' 
                            ? '' 
                            : 'border-gray-300 dark:border-gray-600'
                        }`}
                        style={{
                          ...(fillColor && fillColor.trim() !== '' 
                            ? { 
                                // Match response panel opacity adjusted for top bar vs canvas brightness difference
                                // Top bar is ~2% brighter in light mode, ~3.1% brighter in dark mode
                                // Light mode: 10% + 2% = 12%, Dark mode: 15% + 3.1% = 18.1%
                                borderColor: hexToRgba(fillColor, resolvedTheme === 'dark' ? 0.181 : 0.12),
                                borderWidth: '1.5px',
                                borderStyle: 'solid'
                              } 
                            : {}
                          ),
                        }}
                      >
                        <input
                          type="color"
                          value={fillColor || '#ffffff'}
                          onChange={(e) => setFillColor(e.target.value)}
                          className="w-full h-full cursor-pointer border-0"
                          style={{
                            border: 'none',
                            outline: 'none',
                          }}
                          title="Fill Color"
                          aria-label="Fill Color"
                        />
                      </div>
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
                      <div
                        className={`w-full h-8 rounded border overflow-hidden ${
                          borderColor && borderColor.trim() !== '' 
                            ? '' 
                            : 'border-gray-300 dark:border-gray-600'
                        }`}
                        style={{
                          ...(borderColor && borderColor.trim() !== '' 
                            ? { 
                                // Match response panel opacity adjusted for top bar vs canvas brightness difference
                                // Top bar is ~2% brighter in light mode, ~3.1% brighter in dark mode
                                // Light mode: 10% + 2% = 12%, Dark mode: 15% + 3.1% = 18.1%
                                borderColor: hexToRgba(borderColor, resolvedTheme === 'dark' ? 0.181 : 0.12),
                                borderWidth: '1.5px',
                                borderStyle: 'solid'
                              } 
                            : {}
                          ),
                        }}
                      >
                        <input
                          type="color"
                          value={borderColor || '#ffffff'}
                          onChange={(e) => setBorderColor(e.target.value)}
                          className="w-full h-full cursor-pointer border-0"
                          style={{
                            border: 'none',
                            outline: 'none',
                          }}
                          title="Border Color"
                          aria-label="Border Color"
                        />
                      </div>
                      {/* Transparent option — same as fill */}
                      <Button
                        variant={!borderColor ? "default" : "outline"}
                        size="sm"
                        className="w-full mt-2 h-7 text-xs"
                        onClick={() => setBorderColor('')}
                      >
                        Transparent
                      </Button>
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

      {/* Divider before Layout when arrows are hidden (direction↔layout | already sits left of direction when arrows show) */}
      {hiddenItems.size === 0 && isItemHidden('arrows') && !isItemHidden('panelControls') && !shouldHideFormattingOptions && <div className="w-px h-6 bg-gray-300 mx-1" />}

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
          <DropdownMenuItem onClick={handleCreateBlock} className="rounded-sm">
            Block
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCreateFlashcard} className="rounded-sm">
            Flashcard
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Right Section — AI origin + Notion + Share */}
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

        {/* Show AI-written content (reddish mask) — only when page has AI-origin spans */}
        {hasAiContent && (
          <div className="flex items-center px-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 w-7 p-0 flex-shrink-0',
                showAiOrigin
                  ? 'text-red-600 bg-red-50 hover:bg-red-100 hover:text-red-700'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              )}
              title={showAiOrigin ? 'Hide AI content highlight' : 'Show AI-written content'}
              aria-pressed={showAiOrigin}
              onClick={() => setShowAiOrigin(!showAiOrigin)}
            >
              <Sparkles className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Notion connect — Mindmap.so-style OAuth (workspace → permissions → select pages) */}
        <div className="flex items-center px-1 flex-shrink-0">
          <NotionConnectButton />
        </div>

        {/* Share — owner only; viewers see a read-only role chip */}
        <div className="flex items-center px-2 flex-shrink-0 gap-1">
          {!canEdit && (
            <span className="hidden sm:inline text-[11px] text-gray-500 px-1.5 py-0.5 rounded bg-gray-100">
              {role === 'comment' ? 'Can comment' : 'View only'}
            </span>
          )}
          {canShare && conversationId ? (
            <ShareBoardMenu boardId={conversationId} />
          ) : canShare ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-gray-400 flex-shrink-0"
              title="Save the board to share"
              type="button"
              disabled
            >
              <Share2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

