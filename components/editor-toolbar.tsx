'use client'
// Force recompile to fix hydration mismatch

// TipTap editor toolbar component - matches the agent editor example
import { Editor } from '@tiptap/react'
import { Button } from './ui/button'
import { useReactFlowContext } from './react-flow-context'
import {
  threadAlgorithmFromStyle,
  type ThreadStylePref,
} from '@/components/threads' // Board default Smooth / Sharp / Linear + path algorithm
import { usePreviewFocus } from '@/lib/preview-focus-context' // Nested preview View-style targeting
import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom' // Phone: mode tools inside the pill; undo/redo to its right
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  Minus,
  ChevronDown,
  List,
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
  Lock,
  PaintBucket,
  LassoSelect,
  Eraser,
  GripVertical,
  GripHorizontal,
  Sparkles,
  Circle,
  Grid3x3,
  Boxes, // Layout Smart Align — multi-box glyph
  Presentation, // View presentation mode
  Scan, // View capture — 4 disconnected rounded corners
  Table,
  Anchor,
  ListFilter,
  ArrowUpDown,
  Zap,
  Search,
  RefreshCw, // Actions-bar Turn into (same glyph as ⋮⋮ block menu)
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'
import { useTheme } from './theme-provider'
import { ShareBoardMenu } from './share-board-menu' // Share dropdown: Notion people + role links
import { BoardTopBarShare } from './board-top-bar-share' // Copy link / favorite / More (board actions + Connections)
import {
  NotionConnectProvider,
  NotionTopBarPin,
} from './notion-connect-button' // Notion pin left of Share + More → Connections host
import { AutomationsMenu } from './automations-menu' // Actions-bar Automations list popover
import { CapturesMenu } from './captures-menu' // View-bar Capture list popover
import { ToolbarTitle } from './toolbar-title' // Animated icon-adjacent titles
import { LayoutAlignGlyph, LayoutForkMenuItems, type LayoutForkAlign } from './layout-fork-icon' // Layout dropdown: forked arrows + align
import {
  packSelectedFramesTogether,
  sharedStackGroupId,
  selectionIsStacked,
  unlinkSelectedStack,
  collapseSelectedStack,
  expandSelectedStack,
  type StackTogglePatch,
} from '@/components/use-frame-nest-stack-drag' // Magnet pack + stack/unstack
import { setSideStackEntry } from '@/lib/frame-side-stacks' // Stamp stack line link without lock
import { PresentationsMenu } from './presentations-menu' // View-bar Presentation list popover
import { useBoardAccess } from '@/lib/share/board-access-context' // Owner-only share menu
import { useSidebarContext } from './sidebar-context' // Wait for chat column restore before measuring titles
import { usePhoneModeMenu } from './phone-mode-menu-context' // Phone pill drill-in portal host
import { useAiEditSession } from '@/lib/ai/edit-session' // Top-bar AI content mask toggle
import { htmlHasAiOrigin } from '@/lib/ai/wrap-ai-html' // Detect AI-origin spans in frame HTML
import {
  getAiBlockSelection,
  subscribeAiSelection,
} from '@/lib/ai/selection-bridge' // Armed ⋮⋮ block → enable Turn into
import { LegoBrickIcon } from './lego-brick-icon' // Frame-group lock: two bricks, top one stud back
import { TOOLBAR_MENU_PLACEMENT } from '@/lib/menu-placement' // Actions-style: under the trigger, never over the board path
import {
  TurnIntoMenuItems,
  applyToolbarTurnInto,
  readToolbarBlockType,
} from '@/components/turn-into-menu' // Actions-bar Turn into (Format / Property)
import type { BlockTypeId, BoardInTarget } from '@/components/block-actions-menu'

interface EditorToolbarProps {
  editor: Editor | null
  conversationId?: string
}

type DrawInk = 'black' | 'blue' | 'green' | 'red' // Freehand / highlighter ink ids (same four swatches as the old color row)

const DRAW_INK: { id: DrawInk; label: string; swatch: string }[] = [ // Swatch class paints the Circle in each tool’s color dropdown
  { id: 'black', label: 'Black', swatch: 'fill-black text-black' },
  { id: 'blue', label: 'Blue', swatch: 'fill-blue-600 text-blue-600' },
  { id: 'green', label: 'Green', swatch: 'fill-green-600 text-green-600' },
  { id: 'red', label: 'Red', swatch: 'fill-red-600 text-red-600' },
]

/** Approx icon+title button width (text-sm) so overflow can hide titles before hiding tools. */
function titledToolWidth(label: string) {
  return 16 + 6 + Math.ceil(label.length * 7.5) + 16 // icon + gap-1.5 + glyph estimate + px-2
}

/** Slash-free cluster immediately right of undo/redo — never fold into More; phone pill instead. */
function leftmostGroupIds(mode: string): Set<string> {
  if (mode === 'insert') return new Set(['lock']) // Anchor + Lock frames, then slash, then Tidy up + Thread layout
  if (mode === 'view') return new Set(['boardStyle']) // Board, then slash, then Capture/Present
  if (mode === 'draw') return new Set(['drawGroup2', 'drawGroup3']) // Eraser + ink, then slash, then lasso/spaces
  return new Set() // Actions: Filter cluster may overflow; no protected left cluster
}

/** Icon-only width of each mode’s furthest-left slash-free cluster. Phone pill uses the widest. */
const LEFTMOST_ICON_WIDTH: Record<string, number> = {
  home: 0, // Actions has no protected left cluster after Anchor/Lock moved to Layout
  insert: 64, // Anchor + Lock frames
  draw: 28 + 4 + 76, // Eraser + pencil + highlighter
  view: 40, // Board
}

/** Phone: mount mode tools in the Actions/Layout/Draw/View pill; desktop: keep them in the top bar. */
function PhoneModeToolsPortal({
  enabled,
  host,
  children,
}: {
  enabled: boolean // phoneTools — leftmost cluster would overflow into More
  host: HTMLElement | null // Phone tools row right of the mode dropdown
  children: React.ReactNode // Mode tools (not undo/redo)
}) {
  if (enabled) {
    if (!host) return null // Host mounts with the phone pill — undo/redo sit beside it
    return createPortal(children, host) // Same buttons, right of the mode dropdown inside the pill
  }
  return <>{children}</>
}

/** Phone: mount undo/redo to the right of the mode pill, outside it; desktop: keep them in the top bar. */
function PhoneUndoRedoPortal({
  enabled,
  host,
  children,
}: {
  enabled: boolean // phoneTools — tools have left the bar for the pill
  host: HTMLElement | null // Sibling of the pill; null until that node mounts
  children: React.ReactNode // Undo/redo cluster
}) {
  if (enabled && host) return createPortal(children, host) // Outside the toggle chrome, to its right
  return <>{children}</> // Stay on the bar until the host exists (no flash) or until desktop
}

export function EditorToolbar({ editor, conversationId }: EditorToolbarProps) {
  const { canShare, canEdit, role } = useBoardAccess() // Gate share + show view-only chrome
  const { isChatSidebarOpen, chatChromeReady } = useSidebarContext() // Measure only after chat column is restored
  const { toolsHost, undoHost, phoneTools, setPhoneTools } = usePhoneModeMenu() // Pill portal + undo sibling + overflow→phone flag
  const { reactFlowInstance, isLocked, lineStyle: verticalLineStyle, setLineStyle: setVerticalLineStyle, arrowDirection, setArrowDirection, editMenuPillMode, boardRule: hostBoardRule, setBoardRule: setHostBoardRule, boardStyle: hostBoardStyle, setBoardStyle: setHostBoardStyle, fillColor, setFillColor, borderColor, setBorderColor, borderWeight, setBorderWeight, borderStyle, setBorderStyle, clickedEdge, isDrawing, setIsDrawing, drawTool: contextDrawTool, setDrawTool: setContextDrawTool, mapUndo, mapRedo, canMapUndo, canMapRedo, getMapTakeSnapshot, getSetNodes } = useReactFlowContext()
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
  const [layoutForkAlign, setLayoutForkAlign] = useState<LayoutForkAlign>('center') // Single arrow, or left / center / right fork
  const [layoutLinkUi, setLayoutLinkUi] = useState({ linked: false, stacked: false }) // Magnet / stack toggles (independent of align/direction)
  useEffect(() => {
    const saved = localStorage.getItem('thinktable-layout-fork-align') // Sticky across reload; UI-only until layout is wired
    if (saved === 'single' || saved === 'left' || saved === 'center' || saved === 'right') setLayoutForkAlign(saved)
    // Legacy 'snap' was an align pick — magnet is now a separate toggle; keep default center
  }, [])
  const pickLayoutForkAlign = (next: LayoutForkAlign) => {
    setLayoutForkAlign(next) // Update the open menu + trigger icon
    localStorage.setItem('thinktable-layout-fork-align', next) // Remember without waiting on board prefs
  }
  
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

  // Hide formatting options (clear formatting to line options) when insert/draw/view mode is selected
  const shouldHideFormattingOptions = true // Text / frame / thread menus own these now

  // Initialize with consistent defaults to avoid hydration mismatch, then load from Supabase
  const [lineStyle, setLineStyle] = useState<ThreadStylePref>('curved') // Board default Smooth / Sharp / Linear
  const [editMode, setEditMode] = useState<'editing' | 'suggesting' | 'viewing'>('editing')
  // Use context values for drawTool, with local state as fallback
  const drawTool = contextDrawTool ?? null
  const setDrawTool = setContextDrawTool
  const [pencilColor, setPencilColor] = useState<DrawInk>('black') // Freehand ink — remembered per tool, not shared with highlighter
  const [highlighterColor, setHighlighterColor] = useState<DrawInk>('black') // Highlighter ink — independent of freehand so each dropdown keeps its last pick
  const [hiddenItems, setHiddenItems] = useState<Set<string>>(new Set())
  const [hideUndoMoreSlash, setHideUndoMoreSlash] = useState(false) // Folded + truncated path: drop undo|/|More
  const [compactEarlyLabels, setCompactEarlyLabels] = useState(false) // Filter/sort/automations/eraser cluster — collapses first
  const compactEarlyLabelsRef = useRef(false) // Hysteresis for the first title-collapse stage
  const [compactLabels, setCompactLabels] = useState(false) // Remaining titles after the early cluster
  const compactLabelsRef = useRef(false) // Hysteresis so the title animation does not thrash at the threshold
  const [toolbarLayoutReady, setToolbarLayoutReady] = useState(false) // Hide tools until first measure so names don’t paint then collapse
  const toolbarLayoutReadyRef = useRef(false) // Same flag for checkVisibility without a stale closure
  const measuredModeRef = useRef<string | null>(null) // Last fitted pill mode — switch is a first-pass like Actions load
  const phoneToolsRef = useRef(false) // Hysteresis for overflow→pill so it doesn’t thrash at the threshold
  const hiddenItemsRef = useRef<Set<string>>(new Set()) // Last overflow set — restored cluster when items move
  const [toolbarAnimate, setToolbarAnimate] = useState(false) // Enable title transitions only after the first correct layout
  const [boardSearch, setBoardSearch] = useState('') // Actions-bar live search over frame title + body
  const [boardSearchOpen, setBoardSearchOpen] = useState(false) // Icon-only until click; then the field slides out
  const boardSearchInputRef = useRef<HTMLInputElement>(null) // Place the I-bar in the sliding field
  const boardSearchButtonRef = useRef<HTMLButtonElement>(null) // Ignore blur when the icon itself was clicked
  const didBoardSearchRef = useRef(false) // Skip setNodes on mount until the user actually searches
  const [boardLockUi, setBoardLockUi] = useState<{ hasSelection: boolean; locked: boolean }>({
    hasSelection: false,
    locked: false,
  })
  const [frameLockUi, setFrameLockUi] = useState<{ hasMulti: boolean; locked: boolean }>({
    hasMulti: false,
    locked: false,
  })
  const [hasArmedBlock, setHasArmedBlock] = useState(false) // ⋮⋮ blue-wash block — gates Turn into
  const canTurnInto = hasArmedBlock // Turn into needs an armed TipTap block (not frame-only)
  const preferencesLoadedRef = useRef(false) // Track if preferences have been loaded
  const toolbarRef = useRef<HTMLDivElement>(null)
  const leftSectionRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

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

  // Checkmark for Actions-bar Turn into Format pane
  const [turnIntoBlockType, setTurnIntoBlockType] = useState<BlockTypeId>('text')

  // Re-read caret block type when opening Turn into
  const syncTurnIntoFromEditor = () => {
    setTurnIntoBlockType(readToolbarBlockType(editor))
  }

  // Boards available for Turn into → Board in (same list as ⋮⋮ menu)
  const boardInTargetsForToolbar = (): BoardInTarget[] => {
    const convs =
      (queryClientForAi.getQueryData(['conversations']) as
        | Array<{ id: string; title?: string | null }>
        | undefined) || []
    return [
      { id: conversationId || '', title: 'Current board' },
      ...convs
        .filter((c) => c.id !== conversationId)
        .slice(0, 40)
        .map((c) => ({ id: c.id, title: c.title?.trim() || 'Untitled' })),
    ]
  }

  // Persist metadata patches for selected frames (board pin / frame-group lock)
  const persistFrameMetaPatches = async (
    nodes: ReturnType<typeof getSelectedFrames>,
    patch: (meta: Record<string, unknown>) => Record<string, unknown>
  ) => {
    const supabaseClient = createClient()
    for (const n of nodes) {
      const msgId = n.data?.promptMessage?.id as string | undefined
      if (!msgId) continue
      const { data: row } = await supabaseClient
        .from('messages')
        .select('metadata')
        .eq('id', msgId)
        .maybeSingle()
      if (!row) continue
      const next = patch({ ...((row.metadata as Record<string, unknown>) || {}) })
      await supabaseClient.from('messages').update({ metadata: next }).eq('id', msgId)
    }
  }

  // Re-read board pin + frame-group lock from RF selection metadata
  const refreshLockUi = () => {
    if (!reactFlowInstance) {
      setBoardLockUi({ hasSelection: false, locked: false })
      setFrameLockUi({ hasMulti: false, locked: false })
      setLayoutLinkUi({ linked: false, stacked: false })
      return
    }
    const selected = getSelectedFrames()
    if (selected.length === 0) {
      setBoardLockUi({ hasSelection: false, locked: false })
      setFrameLockUi({ hasMulti: false, locked: false })
      setLayoutLinkUi({ linked: false, stacked: false })
      return
    }
    const allBoardLocked = selected.every((n) => {
      const meta = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
      return meta.boardLocked === true
    })
    setBoardLockUi({ hasSelection: true, locked: allBoardLocked })
    const live = reactFlowInstance.getNodes()
    setLayoutLinkUi({
      linked: sharedStackGroupId(selected) != null, // Magnet stays on for a stacked host even if mates are hidden
      stacked: selectionIsStacked(selected, live),
    })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh closes over reactFlowInstance + clickedEdge
  }, [reactFlowInstance, clickedEdge])

  // Armed ⋮⋮ block selection (AI bridge) — Turn into stays grey until a block is armed
  useEffect(() => {
    const sync = () => {
      const sel = getAiBlockSelection()
      setHasArmedBlock(Boolean(sel && sel.count > 0))
    }
    sync()
    return subscribeAiSelection(sync)
  }, [])

  // Close gated menus if their selection disappears while open
  useEffect(() => {
    if (!canTurnInto && openDropdown === 'turnInto') setOpenDropdown(null)
  }, [canTurnInto, openDropdown])

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
          draggable: nextLocked ? false : !isLocked,
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
    if (selected.length < 2) return
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

  // Apply magnet / stack patches to RF + persist metadata
  const applyStackPatches = (patches: StackTogglePatch[]) => {
    if (!reactFlowInstance || patches.length === 0) return
    const byId = new Map(patches.map((p) => [p.id, p]))
    reactFlowInstance.setNodes((nds) =>
      nds.map((n) => {
        const p = byId.get(n.id)
        if (!p) return n
        const pm = n.data?.promptMessage
        return {
          ...n,
          ...(p.position ? { position: p.position } : {}),
          hidden: p.hidden,
          data: pm ? { ...n.data, promptMessage: { ...pm, metadata: p.metadata } } : n.data,
        }
      })
    )
    void (async () => {
      const supabaseClient = createClient()
      for (const p of patches) {
        if (!p.messageId) continue
        const { data: row } = await supabaseClient
          .from('messages')
          .select('metadata')
          .eq('id', p.messageId)
          .maybeSingle()
        if (!row) continue
        const next: Record<string, unknown> = {
          ...((row.metadata as Record<string, unknown>) || {}),
          ...p.metadata,
          isBlock: true,
        }
        if (p.abs) next.position = p.abs // Expand/pack writes absolute flow coords
        await supabaseClient.from('messages').update({ metadata: next }).eq('id', p.messageId)
      }
    })().catch((err) => console.error('Failed to persist stack toggle:', err))
    refreshLockUi()
  }

  // Thread layout magnet: toggle pack/unlink (does not change alignment)
  const handleSnapFramesTogether = () => {
    if (!reactFlowInstance) return
    const selected = getSelectedFrames()
    if (selected.length === 0) return
    if (selected.length < 2 && !sharedStackGroupId(selected)) return // Unlink is allowed from a lone stacked host
    getMapTakeSnapshot()?.()
    const live = reactFlowInstance.getNodes()
    if (sharedStackGroupId(selected)) {
      applyStackPatches(unlinkSelectedStack(selected, live)) // Magnet off: drop the link
      return
    }
    const packed = packSelectedFramesTogether(selected, live, arrowDirection, layoutForkAlign)
    if (packed.length === 0) return
    const byId = new Map(packed.map((p) => [p.id, p]))
    reactFlowInstance.setNodes((nds) =>
      nds.map((n) => {
        const p = byId.get(n.id)
        if (!p) return n
        const pm = n.data?.promptMessage
        if (!pm) return { ...n, position: p.position } // RF only
        let metadata = { ...(pm.metadata || {}), position: p.abs } as Record<string, unknown>
        if (p.stack) {
          metadata = setSideStackEntry(metadata, p.stack.side, {
            groupId: p.stack.groupId,
            index: p.stack.index,
            ...(p.stack.anchor ? { anchor: true } : {}),
            expanded: true, // Stay visible — stack line only, no collapse / lock
          })
        }
        return {
          ...n,
          position: p.position,
          hidden: false,
          data: { ...n.data, promptMessage: { ...pm, metadata } },
        }
      })
    )
    void (async () => {
      const supabaseClient = createClient()
      for (const p of packed) {
        if (!p.messageId) continue
        const { data: row } = await supabaseClient
          .from('messages')
          .select('metadata')
          .eq('id', p.messageId)
          .maybeSingle()
        if (!row) continue
        let next: Record<string, unknown> = {
          ...((row.metadata as Record<string, unknown>) || {}),
          isBlock: true,
          position: p.abs,
        }
        if (p.stack) {
          next = setSideStackEntry(next, p.stack.side, {
            groupId: p.stack.groupId,
            index: p.stack.index,
            ...(p.stack.anchor ? { anchor: true } : {}),
            expanded: true, // Persist the line link; do not lock
          })
        }
        await supabaseClient.from('messages').update({ metadata: next }).eq('id', p.messageId)
      }
    })().catch((err) => console.error('Failed to persist snap-together:', err))
    refreshLockUi()
  }

  // Thread layout collapse: stack / unstack selected frames (does not change direction)
  const handleStackFramesTogether = () => {
    if (!reactFlowInstance) return
    const selected = getSelectedFrames()
    if (selected.length === 0) return
    if (selected.length < 2 && !selectionIsStacked(selected, reactFlowInstance.getNodes())) return // Unstack is allowed from a lone stacked host
    getMapTakeSnapshot()?.()
    const live = reactFlowInstance.getNodes()
    if (selectionIsStacked(selected, live)) {
      applyStackPatches(expandSelectedStack(selected, live, arrowDirection)) // Unstack → pre-stack arrangement
      return
    }
    applyStackPatches(collapseSelectedStack(selected, live, arrowDirection, live)) // Collapse in place — magnet is the pack
  }

  // Dim frames that do not match the Actions-bar search query
  useEffect(() => {
    if (!reactFlowInstance) return
    const q = boardSearch.trim().toLowerCase()
    const searching = editMenuPillMode === 'home' && q.length > 0
    if (!searching && !didBoardSearchRef.current) return // Nothing to clear yet
    didBoardSearchRef.current = searching
    reactFlowInstance.setNodes((nds) =>
      nds.map((n) => {
        if (n.type !== 'chatPanel') {
          return searching ? { ...n, style: { ...n.style, opacity: 0.18 } } : n
        }
        if (!searching) {
          if (n.style?.opacity === undefined) return n
          const nextStyle = { ...n.style }
          delete nextStyle.opacity
          return { ...n, style: nextStyle }
        }
        const meta = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
        const title = String(meta.blockTitle || '')
        const html = String(n.data?.promptMessage?.content || '')
        const text = `${title} ${html.replace(/<[^>]+>/g, ' ')}`.toLowerCase()
        const hit = text.includes(q)
        return { ...n, style: { ...n.style, opacity: hit ? 1 : 0.18 } }
      })
    )
  }, [boardSearch, editMenuPillMode, reactFlowInstance])

  // Put the I-bar in the field as soon as it slides open
  useEffect(() => {
    if (!boardSearchOpen) return
    const id = requestAnimationFrame(() => boardSearchInputRef.current?.focus()) // Wait one frame so the input is visible/focusable
    return () => cancelAnimationFrame(id)
  }, [boardSearchOpen])

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

  // Close leftover Filter/Capture/… menus when switching Actions / Layout / Draw / View
  useEffect(() => {
    setOpenDropdown(null) // Don’t leave a previous mode’s panel parked over the path
  }, [editMenuPillMode])

  // Track which items should be hidden based on available space (Google Docs style)
  useLayoutEffect(() => {
    if (!toolbarRef.current) return

    const checkVisibility = () => {
      const toolbar = toolbarRef.current
      if (!toolbar) return
      if (!chatChromeReady) return // Chat column not restored yet — measuring now would fit titles then collapse

      const bar = toolbar.closest('[data-edit-top-bar]') as HTMLElement | null // Full map-column bar
      const leftChrome = bar?.querySelector('[data-top-bar-left]') as HTMLElement | null
      const toolbarRect = (bar ?? toolbar).getBoundingClientRect()
      const rightSection = toolbar.querySelector('[data-right-section]') as HTMLElement

      const pathReady = !leftChrome || leftChrome.getAttribute('data-path-ready') === 'true' // Wait for board path (not shimmer)
      if (!pathReady) return // Path still a placeholder — left inset will grow

      if (!rightSection) {
        toolbarLayoutReadyRef.current = true
        setToolbarLayoutReady(true) // Nothing to collapse; still reveal
        return
      }

      const rightSectionRect = rightSection.getBoundingClientRect()
      const rightW = rightSectionRect.width // Share / copy / favorite / more / AI
      const moreMenuWidth = 32 + 8 // Overflow More button (h-7 w-7 + gap) — always reserved so hide/show doesn’t thrash
      const PATH_GAP = 8 // Air between path glyphs and the centered undo cluster
      const hamEl = leftChrome?.querySelector('[data-nav-logo-trigger]') as HTMLElement | null // Menu icon; path starts after it
      const hamRight = hamEl?.getBoundingClientRect().right ?? toolbarRect.left + 40 // Path origin in viewport px
      const hamW = hamEl?.getBoundingClientRect().width ?? 40 // Menu icon only — leftover left chrome is the path
      const pathBox = leftChrome?.querySelector('[data-board-path]') as HTMLElement | null // Live crumbs + hidden full/min rows
      const pathFull = pathBox?.querySelector('[data-path-full]') as HTMLElement | null // Hidden full-title row
      const pathMin = pathBox?.querySelector('[data-path-min]') as HTMLElement | null // Hidden icon-minimum row (current icon whole)
      const naturalPath = pathFull?.scrollWidth || pathBox?.scrollWidth || 0 // Uncapped crumbs; simple titles use the live box
      const minPathW = Math.max(64, pathMin?.scrollWidth || 64) // Cutoff-able path: ancestor icons + current icon, never mid-icon clip
      const barCenter = toolbarRect.left + toolbarRect.width / 2 // True board center
      const barW = toolbarRect.width // Map-column width this pass
      const leftW = hamW + minPathW // Reserve cutoff path on shrink and expand — live crush delayed More; live extend delayed return
      const sideInset = Math.max(leftW, rightW) // Symmetric inset so the cluster can sit on the board center
      const availableWidth = barW - 2 * sideInset - moreMenuWidth - 16 // Max cluster width on the true board center

      // Icon-only widths (after all titles have condensed)
      const iconGroups = editMenuPillMode === 'insert'
        ? [
          { id: 'insertGroup1', width: 40 }, // Table icon — hides first
          { id: 'arrows', width: 40 }, // Thread layout
          { id: 'smartAlign', width: 40 }, // Tidy up
          { id: 'lock', width: 64 }, // Anchor + Lock frames — Layout leftmost
          { id: 'undoRedo', width: 70 },
        ]
        : editMenuPillMode === 'view'
          ? [
            { id: 'presentation', width: 40 }, // Present icon (hides first — rightmost)
            { id: 'capture', width: 40 }, // Capture icon
            { id: 'boardStyle', width: 40 }, // Board icon
            { id: 'undoRedo', width: 70 },
          ]
          : editMenuPillMode === 'draw'
            ? [
              { id: 'drawGroup1', width: 108 }, // Lasso + insert-space — rightmost, hide first
              { id: 'drawGroup3', width: 76 }, // Pencil, Highlighter icons
              { id: 'drawGroup2', width: 28 + 4 + 5 }, // Eraser icon + slash after ink cluster
              { id: 'undoRedo', width: 70 },
            ]
            : [
              { id: 'search', width: boardSearchOpen ? 180 : 40 }, // Icon + field when open; icon when early-collapsed
              { id: 'actions', width: 120 }, // Filter / Sort / Automations icons
              { id: 'turnInto', width: 40 }, // Turn into — own section left of Filter
              { id: 'undoRedo', width: 70 },
            ]

      // Early cluster icon-only; remaining titles still shown (Filter/ink collapse first)
      const midGroups = editMenuPillMode === 'insert'
        ? [
          { id: 'insertGroup1', width: titledToolWidth('Table') + 16 },
          { id: 'arrows', width: titledToolWidth('Threads') },
          { id: 'smartAlign', width: titledToolWidth('Tidy up') },
          { id: 'lock', width: titledToolWidth('Anchor') + 2 + titledToolWidth('Lock frames') + 12 },
          { id: 'undoRedo', width: 70 },
        ]
        : editMenuPillMode === 'view'
          ? [
            { id: 'presentation', width: titledToolWidth('Present') },
            { id: 'capture', width: titledToolWidth('Capture') },
            { id: 'boardStyle', width: titledToolWidth('Board') },
            { id: 'undoRedo', width: 70 },
          ]
          : editMenuPillMode === 'draw'
            ? [
              { id: 'drawGroup1', width: titledToolWidth('Lasso') + 4 + titledToolWidth('Vertical space') + 4 + titledToolWidth('Horizontal space') + 16 }, // Rightmost
              { id: 'drawGroup3', width: 76 }, // Ink titles already collapsed
              { id: 'drawGroup2', width: 28 + 4 + 5 }, // Eraser + slash after ink cluster
              { id: 'undoRedo', width: 70 },
            ]
            : [
              { id: 'search', width: boardSearchOpen ? 180 : 40 }, // Search title already collapsed
              { id: 'actions', width: 120 }, // Filter cluster already collapsed
              { id: 'turnInto', width: titledToolWidth('Turn into') }, // Title stays until rest-collapse
              { id: 'undoRedo', width: 70 },
            ]

      // All titles shown
      const fullGroups = editMenuPillMode === 'insert'
        ? midGroups // Layout has no early cluster
        : editMenuPillMode === 'view'
          ? midGroups // View has no early cluster
          : editMenuPillMode === 'draw'
            ? [
              { id: 'drawGroup1', width: titledToolWidth('Lasso') + 4 + titledToolWidth('Vertical space') + 4 + titledToolWidth('Horizontal space') + 16 }, // Rightmost
              { id: 'drawGroup3', width: titledToolWidth('Pencil') + 4 + titledToolWidth('Highlighter') + 16 }, // Ink titles
              { id: 'drawGroup2', width: titledToolWidth('Eraser') + 4 + 5 }, // Eraser + slash after ink cluster
              { id: 'undoRedo', width: 70 },
            ]
            : [
              { id: 'search', width: boardSearchOpen ? 180 : titledToolWidth('Search') }, // Title hides when the field slides out
              { id: 'actions', width: titledToolWidth('Filter') + 2 + titledToolWidth('Sort') + 2 + titledToolWidth('Automations') },
              { id: 'turnInto', width: titledToolWidth('Turn into') }, // Own section left of Filter
              { id: 'undoRedo', width: 70 },
            ]

      const sumGroups = (groups: { width: number }[]) => groups.reduce((sum, item) => sum + item.width + 8, 0) // +8 gap/slash
      const fullTotal = sumGroups(fullGroups) // Filter/ink + remaining titles
      const midTotal = sumGroups(midGroups) // Filter/ink icons; remaining titles
      const modeSwitch = measuredModeRef.current !== null && measuredModeRef.current !== editMenuPillMode // Layout/Draw/View must fit like Actions, not inherit Actions’ titles
      const firstPass = !toolbarLayoutReadyRef.current || modeSwitch // Mode change: no hysteresis from the previous bar
      if (modeSwitch) setToolbarAnimate(false) // Skip 0fr↔1fr tween so new titles don’t paint expanded then collapse
      const expandSlop = firstPass ? 0 : 24 // Extra room before titles expand again — keeps later animation from flickering
      const wasEarly = firstPass ? false : compactEarlyLabelsRef.current // Last early-collapse decision
      const wasRest = firstPass ? false : compactLabelsRef.current // Last remaining-title collapse
      let nextEarly = wasEarly
      let nextRest = wasRest
      if (fullTotal <= availableWidth - ((wasEarly || wasRest) ? expandSlop : 0)) { // Room for every title
        nextEarly = false
        nextRest = false
      } else if (midTotal <= availableWidth - (wasRest ? expandSlop : 0)) { // Collapse Filter/ink first
        nextEarly = true
        nextRest = false
      } else { // Then collapse remaining titles
        nextEarly = true
        nextRest = true
      }
      compactEarlyLabelsRef.current = nextEarly // Keep hysteresis in sync
      compactLabelsRef.current = nextRest
      const itemGroups = nextRest ? iconGroups : nextEarly ? midGroups : fullGroups // Measure the chrome we will actually render

      const leftIds = leftmostGroupIds(editMenuPillMode) // Slash-free cluster right of undo/redo
      const widestLeftmost = Math.max( // Hungriest left cluster across modes so the pill doesn’t flip on mode change
        LEFTMOST_ICON_WIDTH.home,
        LEFTMOST_ICON_WIDTH.insert,
        LEFTMOST_ICON_WIDTH.style,
        LEFTMOST_ICON_WIDTH.draw,
        LEFTMOST_ICON_WIDTH.view
      )
      const keepW = 70 + 8 + widestLeftmost + 8 // Undo/redo + widest left cluster + gaps — below this, phone pill
      const wasPhone = firstPass ? false : phoneToolsRef.current // Last overflow→pill decision
      const nextPhone = keepW > availableWidth - (wasPhone ? expandSlop : 0) // Titles already collapsed; left cluster would fold
      phoneToolsRef.current = nextPhone
      if (wasPhone !== nextPhone) setPhoneTools(nextPhone) // Skip when unchanged so the pill doesn’t reset

      const newHiddenItems = new Set<string>()
      if (!nextPhone) {
        let currentWidth = sumGroups(itemGroups)
        for (const item of itemGroups) { // Array is right-to-left; hide rightmost first
      if (item.id === 'undoRedo') continue // Undo/redo never overflow into More; they leave the bar for the pill sibling
          if (leftIds.has(item.id)) break // Left cluster stays; phone pill takes over instead of More
          if (currentWidth > availableWidth) {
            newHiddenItems.add(item.id)
            currentWidth -= item.width + 8
          }
        }
      }

      setCompactEarlyLabels((prev) => { // Phone pill uses icon+title from the tools themselves; skip bar collapse
        const next = nextPhone ? true : nextEarly
        return prev === next ? prev : next
      })
      setCompactLabels((prev) => {
        const next = nextPhone ? true : nextRest
        return prev === next ? prev : next
      })
      setHiddenItems((prev) => { // Skip render if the hidden set is unchanged
        if (prev.size === newHiddenItems.size && [...newHiddenItems].every((id) => prev.has(id))) return prev
        return newHiddenItems
      })
      hiddenItemsRef.current = newHiddenItems // Keep overflow set in sync for the next pass

      const shareLeft = rightSectionRect.left // Share cluster; phone path runs to here
      const centerEl = toolbar.querySelector('[data-toolbar-center]') as HTMLElement | null // Board-centered undo/tools
      if (centerEl) centerEl.style.transform = '' // Clear any leftover slide from before tools stayed centered
      const liveClusterW = centerEl?.getBoundingClientRect().width ?? 70 // DOM cluster — still the pre-setState size this pass
      const centeredLeft = barCenter - liveClusterW / 2 // Undo’s left while centered
      if (bar) bar.style.setProperty('--tt-path-min', `${minPathW}px`) // Path box never shrinks through the current icon
      if (nextPhone) { // Tools + undo have left the bar — path can run to Share
        const pathMax = Math.max(minPathW, Math.floor(shareLeft - PATH_GAP - hamRight)) // Title uses the empty bar; icon stays whole
        if (bar) bar.style.setProperty('--tt-path-max', `${pathMax}px`)
        setHideUndoMoreSlash((prev) => (prev === true ? prev : true)) // Nothing after undo on the bar
        measuredModeRef.current = editMenuPillMode // This mode is fitted — next switch is a fresh first-pass
        toolbarLayoutReadyRef.current = true
        setToolbarLayoutReady(true)
        return
      }
      const CLUSTER_PAD = 24 // Glyph/padding slack — titledToolWidth undershoots “Tidy up”/etc. and lets the path run under tools
      const restoredClusterW =
        sumGroups(itemGroups.filter((item) => !newHiddenItems.has(item.id))) +
        (newHiddenItems.size > 0 ? moreMenuWidth : 0) +
        CLUSTER_PAD // Prefer over-truncate vs overlapping the centered cluster
      const restoredLeft = barCenter - restoredClusterW / 2 // Cap against tools that will paint, not the still-stale live cluster
      // Further-left of live vs planned: chat close unhides/expands titles while liveClusterW is still narrow (path would run under Tidy up)
      const capLeft = Math.min(centeredLeft, restoredLeft)
      const pathMax = Math.max(minPathW, Math.floor(capLeft - PATH_GAP - hamRight)) // Floor so overflow-hidden never clips the current icon
      if (bar) bar.style.setProperty('--tt-path-max', `${pathMax}px`)
      const truncated = naturalPath > pathMax + 1 // Full titles need more than the centered lane
      const hideable = itemGroups.filter((item) => item.id !== 'undoRedo') // Undo/redo never fold
      const allFolded = hideable.length > 0 && hideable.every((item) => newHiddenItems.has(item.id)) // Only undo/redo + More remain
      const nextHideSlash = allFolded && truncated // Desktop: slash goes when colliding
      setHideUndoMoreSlash((prev) => (prev === nextHideSlash ? prev : nextHideSlash))

      measuredModeRef.current = editMenuPillMode // This mode is fitted — next switch is a fresh first-pass
      toolbarLayoutReadyRef.current = true
      setToolbarLayoutReady(true) // Reveal only after compact/hidden match this column width
    }

    checkVisibility() // After chat restore + path ready; still before paint on that commit

    // Chat column open/close: flex width + 200ms title tween settle after the first layout pass
    let settleTimer = 0
    let raf2 = 0
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        checkVisibility() // Map column width after chat unmount/mount
        settleTimer = window.setTimeout(checkVisibility, 220) // After ToolbarTitle 0fr↔1fr
      })
    })

    const resizeObserver = new ResizeObserver(() => {
      checkVisibility() // Sync — rAF would paint expanded titles for a frame then collapse
    })
    resizeObserver.observe(toolbarRef.current)
    const barEl = toolbarRef.current.closest('[data-edit-top-bar]') // Re-measure when the map column resizes
    if (barEl) resizeObserver.observe(barEl)
    const leftEl = barEl?.querySelector('[data-top-bar-left]') // Title path width changes the center inset
    if (leftEl) resizeObserver.observe(leftEl)
    const attrObserver = leftEl
      ? new MutationObserver(() => checkVisibility()) // Path shimmer → real title may not change width
      : null
    if (attrObserver && leftEl) attrObserver.observe(leftEl, { attributes: true, attributeFilter: ['data-path-ready'] })

    window.addEventListener('resize', checkVisibility)

    return () => {
      window.cancelAnimationFrame(raf1)
      window.cancelAnimationFrame(raf2)
      window.clearTimeout(settleTimer)
      resizeObserver.disconnect()
      attrObserver?.disconnect()
      window.removeEventListener('resize', checkVisibility)
    }
  }, [editor, editMenuPillMode, boardSearchOpen, chatChromeReady, isChatSidebarOpen, setPhoneTools]) // Re-run when the map column’s final width is known

  useLayoutEffect(() => {
    if (toolbarLayoutReady && !toolbarAnimate) setToolbarAnimate(true) // After first reveal, allow later collapse/expand animation
  }, [toolbarLayoutReady, toolbarAnimate])

  const isItemHidden = (item: string) => hiddenItems.has(item)

  return (
    <div
      ref={toolbarRef}
      data-preview-style-chrome // Clicks here keep nested preview style-focus alive
      className="absolute inset-0 pointer-events-none" // Fill the map-column bar so tools can board-center
    >
      {/* Tools — true center of the board bar, independent of title / Share cluster */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          data-toolbar-center
          data-toolbar-ready={toolbarLayoutReady ? 'true' : undefined} // Mode pill waits for this so it doesn’t paint before tools
          data-toolbar-animate={toolbarAnimate ? 'true' : undefined}
          className={cn(
            'relative z-10 flex items-center gap-1 h-full overflow-hidden transition-opacity duration-200 ease-out',
            toolbarLayoutReady ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none' // Fade in with the mode pill once compact/hidden is correct
          )}
        >
      {/* Left Section - collapsible items */}
      <div ref={leftSectionRef} className="flex items-center gap-1 flex-shrink min-w-0">
        {/* Undo/redo — first in the board-centered cluster; on phone, portal to the right of the mode pill */}
        <PhoneUndoRedoPortal enabled={phoneTools} host={undoHost}>
        <div className="flex items-center gap-1 px-2 flex-shrink-0" data-undo-redo>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const activeElement = document.activeElement
                  const isInEditor = activeElement?.closest('.ProseMirror') !== null ||
                    activeElement?.closest('[contenteditable="true"]') !== null ||
                    activeElement?.tagName === 'INPUT' ||
                    activeElement?.tagName === 'TEXTAREA'
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
                  const activeElement = document.activeElement
                  const isInEditor = activeElement?.closest('.ProseMirror') !== null ||
                    activeElement?.closest('[contenteditable="true"]') !== null ||
                    activeElement?.tagName === 'INPUT' ||
                    activeElement?.tagName === 'TEXTAREA'
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
        </PhoneUndoRedoPortal>
            {/* Slash before mode tools — hide when only More remains and path is truncated */}
            {!hideUndoMoreSlash && (
              <span className="flex h-7 items-center text-2xl font-thin text-gray-300 dark:text-gray-500 mx-1 flex-shrink-0 select-none leading-none" aria-hidden>/</span>
            )}

        <PhoneModeToolsPortal enabled={phoneTools} host={toolsHost}>
        {/* Turn into — Actions bar, own section left of Filter (same Format/Property as ⋮⋮) */}
        {editMenuPillMode === 'home' && !isItemHidden('turnInto') && (
          <>
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <DropdownMenu
                open={openDropdown === 'turnInto'}
                onOpenChange={(open) => {
                  if (open && !canTurnInto) return // Greyed: no armed block
                  handleDropdownOpenChange('turnInto', open)
                  if (open) syncTurnIntoFromEditor()
                }}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-7 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] flex-shrink-0 flex items-center',
                      'transition-[padding,gap] duration-200 ease-out', compactLabels ? 'px-1.5 gap-0' : 'px-2 gap-1.5'
                    )}
                    disabled={!canTurnInto}
                    title={!canTurnInto ? 'Select a block to turn into' : 'Turn into'}
                    aria-label="Turn into"
                  >
                    <RefreshCw className="h-4 w-4 flex-shrink-0" />
                    <ToolbarTitle show={!compactLabels}>Turn into</ToolbarTitle>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  {...TOOLBAR_MENU_PLACEMENT}
                  className="p-0 overflow-visible"
                  onCloseAutoFocus={(e) => e.preventDefault()}
                >
                  <TurnIntoMenuItems
                    editor={editor}
                    currentBlockType={turnIntoBlockType}
                    boardInTargets={boardInTargetsForToolbar()}
                    onPick={(pick) => {
                      void applyToolbarTurnInto({
                        editor,
                        conversationId,
                        pick,
                        getSetNodes,
                        reactFlowInstance,
                        onDone: () => {
                          handleDropdownOpenChange('turnInto', false)
                          syncTurnIntoFromEditor()
                          if (pick.kind === 'format' && (pick.blockType === 'board' || pick.blockType === 'boardIn')) {
                            void queryClientForAi.invalidateQueries({ queryKey: ['conversations'] })
                          }
                        },
                      })
                    }}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {/* Slash before Filter / Sort / Automations */}
            {!isItemHidden('actions') && (
              <span className="flex h-7 items-center text-2xl font-thin text-gray-300 dark:text-gray-500 mx-1 flex-shrink-0 select-none leading-none" aria-hidden>/</span>
            )}
          </>
        )}

        {/* Filter / Sort / Automations — Actions bar (Notion-style view chrome) */}
        {editMenuPillMode === 'home' && !isItemHidden('actions') && (
          <>
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <DropdownMenu open={openDropdown === 'boardFilter'} onOpenChange={(open) => handleDropdownOpenChange('boardFilter', open)}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-7 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] flex-shrink-0 flex items-center',
                      'transition-[padding,gap] duration-200 ease-out', compactEarlyLabels ? 'px-1.5 gap-0' : 'px-2 gap-1.5' // Filter cluster collapses first
                    )}
                    title="Filter"
                  >
                    <ListFilter className="h-4 w-4 flex-shrink-0" />
                    <ToolbarTitle show={!compactEarlyLabels}>Filter</ToolbarTitle>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent {...TOOLBAR_MENU_PLACEMENT} className="w-48">
                  <DropdownMenuLabel className="text-xs font-normal text-gray-500">Filter</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-2 text-xs text-gray-400">No filters yet</div>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu open={openDropdown === 'boardSort'} onOpenChange={(open) => handleDropdownOpenChange('boardSort', open)}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-7 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] flex-shrink-0 flex items-center',
                      'transition-[padding,gap] duration-200 ease-out', compactEarlyLabels ? 'px-1.5 gap-0' : 'px-2 gap-1.5' // Filter cluster collapses first
                    )}
                    title="Sort"
                  >
                    <ArrowUpDown className="h-4 w-4 flex-shrink-0" />
                    <ToolbarTitle show={!compactEarlyLabels}>Sort</ToolbarTitle>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent {...TOOLBAR_MENU_PLACEMENT} className="w-48">
                  <DropdownMenuLabel className="text-xs font-normal text-gray-500">Sort</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-2 text-xs text-gray-400">No sorts yet</div>
                </DropdownMenuContent>
              </DropdownMenu>
              <AutomationsMenu
                open={openDropdown === 'boardAutomations'}
                onOpenChange={(open) => handleDropdownOpenChange('boardAutomations', open)}
                conversationId={conversationId}
                showLabel={!compactEarlyLabels} // Filter cluster titles collapse first
              />
            </div>
            {/* If search is hidden, slash before More menu */}
            {isItemHidden('search') && hiddenItems.size > 0 && (
              <span className="flex h-7 items-center text-2xl font-thin text-gray-300 dark:text-gray-500 mx-1 flex-shrink-0 select-none leading-none" aria-hidden>/</span>
            )}
          </>
        )}

        {/* Board search — icon until click, then Type to search slides out with I-bar */}
        {editMenuPillMode === 'home' && !isItemHidden('search') && (
          <>
            <div className="flex items-center h-7 flex-shrink-0">
              <Button
                ref={boardSearchButtonRef}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] flex-shrink-0 flex items-center',
                  'transition-[padding,gap] duration-200 ease-out', // Title collapses as the field slides out
                  compactEarlyLabels || boardSearchOpen ? 'px-1.5 gap-0' : 'px-2 gap-1.5', // Hide title on shrink or when searching
                  boardSearchOpen && 'bg-gray-100 dark:bg-[#1f1f1f] text-gray-900 dark:text-gray-100' // Stay pressed while the field is out
                )}
                title="Search"
                aria-label="Search board"
                aria-expanded={boardSearchOpen}
                onMouseDown={(e) => e.preventDefault()} // Don't steal I-bar from the field before toggle
                onClick={() => {
                  setBoardSearchOpen((open) => {
                    if (open && !boardSearch.trim()) return false // Second click on an empty field collapses it
                    return true // Closed → slide out; already open with a query → keep it
                  })
                }}
              >
                <Search className="h-4 w-4 flex-shrink-0" />
                <ToolbarTitle show={!compactEarlyLabels && !boardSearchOpen}>Search</ToolbarTitle>
              </Button>
              <div
                className={cn(
                  'overflow-hidden transition-[width,opacity] duration-200 ease-out', // Width slide + fade
                  boardSearchOpen ? 'w-36 opacity-100' : 'w-0 opacity-0 pointer-events-none' // Collapsed: no hit target
                )}
              >
                <input
                  ref={boardSearchInputRef}
                  type="search"
                  value={boardSearch}
                  tabIndex={boardSearchOpen ? 0 : -1} // Skip tab stop while collapsed
                  onChange={(e) => setBoardSearch(e.target.value)}
                  onBlur={(e) => {
                    if (e.relatedTarget === boardSearchButtonRef.current) return // Icon click is not a dismiss
                    if (!boardSearch.trim()) setBoardSearchOpen(false) // Empty + click away → icon only
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Escape') return
                    setBoardSearch('') // Clear dimming
                    setBoardSearchOpen(false) // Slide back to the icon
                  }}
                  placeholder="Type to search..."
                  aria-label="Search board"
                  className="h-7 w-36 bg-transparent border-0 outline-none text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-400"
                />
              </div>
            </div>
            {/* Slash before More menu when items overflow */}
            {hiddenItems.size > 0 && (
              <span className="flex h-7 items-center text-2xl font-thin text-gray-300 dark:text-gray-500 mx-1 flex-shrink-0 select-none leading-none" aria-hidden>/</span>
            )}
          </>
        )}

        {/* Anchor + Lock frames — Layout bar leftmost; slash before Tidy up */}
        {editMenuPillMode === 'insert' && !isItemHidden('lock') && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleBoardLock}
              className={cn(
                'h-7 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] flex-shrink-0 flex items-center',
                'transition-[padding,gap] duration-200 ease-out', compactLabels ? 'px-1.5 gap-0' : 'px-2 gap-1.5', // Title condenses to icon on shrink
                boardLockUi.hasSelection &&
                  boardLockUi.locked &&
                  'bg-gray-100 dark:bg-[#1f1f1f] text-gray-900 dark:text-gray-100'
              )}
              disabled={!reactFlowInstance || !boardLockUi.hasSelection}
              title={
                !boardLockUi.hasSelection
                  ? 'Select a frame to anchor to the board'
                  : boardLockUi.locked
                    ? 'Unanchor from board'
                    : 'Anchor'
              }
              aria-label={boardLockUi.locked ? 'Unanchor from board' : 'Anchor'}
            >
              <Anchor className="h-4 w-4 flex-shrink-0" /> {/* Board lock: pin selected frames */}
              <ToolbarTitle show={!compactLabels}>Anchor</ToolbarTitle>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleFrameLock}
              className={cn(
                'h-7 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] flex-shrink-0 flex items-center',
                'transition-[padding,gap] duration-200 ease-out', compactLabels ? 'px-1.5 gap-0' : 'px-2 gap-1.5', // Title condenses to icon on shrink
                frameLockUi.hasMulti &&
                  frameLockUi.locked &&
                  'bg-gray-100 dark:bg-[#1f1f1f] text-gray-900 dark:text-gray-100'
              )}
              disabled={!reactFlowInstance || !frameLockUi.hasMulti}
              title={
                !frameLockUi.hasMulti
                  ? 'Select 2+ frames to lock together'
                  : frameLockUi.locked
                    ? 'Unlock frames'
                    : 'Lock frames'
              }
              aria-label={
                frameLockUi.locked ? 'Unlock frames' : 'Lock frames'
              }
            >
              <LegoBrickIcon className="h-4 w-4 flex-shrink-0" /> {/* Frame-group lock: stacked bricks */}
              <ToolbarTitle show={!compactLabels}>Lock frames</ToolbarTitle>
            </Button>
          </div>
        )}
        {/* Slash between Anchor/Lock frames and Tidy up */}
        {editMenuPillMode === 'insert' && !isItemHidden('lock') && (!isItemHidden('smartAlign') || !isItemHidden('arrows')) && (
          <span className="flex h-7 items-center text-2xl font-thin text-gray-300 dark:text-gray-500 mx-1 flex-shrink-0 select-none leading-none" aria-hidden>/</span>
        )}
        {/* Tidy up + Thread layout — Layout bar (pill still `insert`) */}
        {editMenuPillMode === 'insert' && (!isItemHidden('smartAlign') || !isItemHidden('arrows')) && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {!isItemHidden('smartAlign') && (
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] flex-shrink-0 flex items-center',
                  'transition-[padding,gap] duration-200 ease-out', compactLabels ? 'px-1.5 gap-0' : 'px-2 gap-1.5' // Title condenses to icon on shrink
                )}
                title="Tidy up"
                aria-label="Tidy up"
              >
                <Boxes className="h-4 w-4 flex-shrink-0" /> {/* Multi-box: Tidy up (UI until wired) */}
                <ToolbarTitle show={!compactLabels}>Tidy up</ToolbarTitle>
              </Button>
            )}
            {!isItemHidden('arrows') && (
              <DropdownMenu open={openDropdown === 'arrowDirection'} onOpenChange={(open) => handleDropdownOpenChange('arrowDirection', open)}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-7 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] flex-shrink-0 flex items-center',
                      'transition-[padding,gap] duration-200 ease-out', compactLabels ? 'px-1.5 gap-0' : 'px-2 gap-1.5' // Title condenses to icon on shrink
                    )}
                    title="Threads"
                    aria-label="Threads"
                  >
                    <LayoutAlignGlyph direction={arrowDirection} align={layoutForkAlign} className="h-4 w-4 flex-shrink-0" />
                    <ToolbarTitle show={!compactLabels}>Threads</ToolbarTitle>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent {...TOOLBAR_MENU_PLACEMENT} className="min-w-0 w-fit p-1">
                  <LayoutForkMenuItems
                    direction={arrowDirection}
                    align={layoutForkAlign}
                    onDirectionChange={setArrowDirection}
                    onAlignChange={pickLayoutForkAlign}
                    canSnap={frameLockUi.hasMulti || layoutLinkUi.linked}
                    snapActive={layoutLinkUi.linked}
                    onSnapFrames={handleSnapFramesTogether}
                    canStack={frameLockUi.hasMulti || layoutLinkUi.stacked}
                    stackActive={layoutLinkUi.stacked}
                    onStackFrames={handleStackFramesTogether}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
        {/* Slash between Thread layout cluster and Table */}
        {editMenuPillMode === 'insert' && (!isItemHidden('lock') || !isItemHidden('smartAlign') || !isItemHidden('arrows')) && !isItemHidden('insertGroup1') && (
          <span className="flex h-7 items-center text-2xl font-thin text-gray-300 dark:text-gray-500 mx-1 flex-shrink-0 select-none leading-none" aria-hidden>/</span>
        )}

        {/* Table — right of Thread layout */}
        {editMenuPillMode === 'insert' && !isItemHidden('insertGroup1') && (
          <div className="flex items-center gap-1 px-2 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                // TODO: Implement table insertion
              }}
              className={cn(
                'h-7 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0 flex items-center',
                'transition-[padding,gap] duration-200 ease-out', compactLabels ? 'px-1.5 gap-0' : 'px-2 gap-1.5' // Title condenses to icon on shrink
              )}
              title="Table"
            >
              <Table className="h-4 w-4 flex-shrink-0" />
              <ToolbarTitle show={!compactLabels}>Table</ToolbarTitle>
            </Button>
          </div>
        )}
        {/* Slash before More menu when Layout tools overflow */}
        {editMenuPillMode === 'insert' && (!isItemHidden('lock') || !isItemHidden('smartAlign') || !isItemHidden('arrows') || !isItemHidden('insertGroup1')) && hiddenItems.size > 0 && (
          <span className="flex h-7 items-center text-2xl font-thin text-gray-300 dark:text-gray-500 mx-1 flex-shrink-0 select-none leading-none" aria-hidden>/</span>
        )}

        {/* Draw Mode Buttons - Eraser, Pencil, Highlighter, Lasso, Insert Spaces (ink dropdowns on the tools) */}
        {editMenuPillMode === 'draw' && (
          <>
            {/* Eraser + Pencil + Highlighter — one cluster, no slash between eraser and pencil */}
            {(!isItemHidden('drawGroup2') || !isItemHidden('drawGroup3')) && (
              <>
                <div className="flex items-center gap-1 px-2 flex-shrink-0">
                  {!isItemHidden('drawGroup2') && (
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
                        'h-7 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 flex-shrink-0 flex items-center',
                        'transition-[padding,gap] duration-200 ease-out', compactEarlyLabels ? 'px-1.5 gap-0' : 'px-2 gap-1.5', // Ink cluster collapses first
                        drawTool === 'eraser'
                          ? 'bg-gray-100 dark:bg-gray-800'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                      )}
                      title={drawTool === 'eraser' ? 'Eraser Active (Click to deselect)' : 'Eraser (Not yet implemented)'}
                    >
                      <Eraser className="h-4 w-4 flex-shrink-0" />
                      <ToolbarTitle show={!compactEarlyLabels}>Eraser</ToolbarTitle>
                    </Button>
                  )}
                  {!isItemHidden('drawGroup3') && (
                    <>
                      {/* Freehand: first click toggles on; click again while active opens ink dropdown */}
                      <DropdownMenu
                        open={openDropdown === 'pencilColor'}
                        onOpenChange={(open) => {
                          if (open && drawTool !== 'pencil') { // Inactive → arm freehand, keep the menu closed
                            setDrawTool('pencil')
                            setIsDrawing(true) // Pencil is the drawing tool
                            return
                          }
                          handleDropdownOpenChange('pencilColor', open) // Active → color dropdown; outside click closes
                        }}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                              'h-7 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 flex-shrink-0 flex items-center',
                              'transition-[padding,gap] duration-200 ease-out', compactEarlyLabels ? 'px-1.5 gap-0' : 'px-2 gap-1.5', // Ink cluster collapses first
                              drawTool === 'pencil'
                                ? 'bg-gray-100 dark:bg-gray-800'
                                : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                            )}
                            title={drawTool === 'pencil' ? 'Freehand color' : 'Freehand Drawing'}
                          >
                            <Pencil className="h-4 w-4 flex-shrink-0" />
                            <ToolbarTitle show={!compactEarlyLabels}>Pencil</ToolbarTitle>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent {...TOOLBAR_MENU_PLACEMENT} className="min-w-0 w-fit p-1">
                          {DRAW_INK.map((ink) => (
                            <DropdownMenuItem
                              key={ink.id}
                              onClick={() => setPencilColor(ink.id)} // Pick this tool’s ink; menu closes via Radix
                              className={pencilColor === ink.id ? 'bg-gray-100 dark:bg-gray-800' : ''}
                            >
                              <Circle className={cn('h-4 w-4', ink.swatch)} />
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      {/* Highlighter: same toggle-then-dropdown pattern as freehand */}
                      <DropdownMenu
                        open={openDropdown === 'highlighterColor'}
                        onOpenChange={(open) => {
                          if (open && drawTool !== 'highlighter') { // Inactive → arm highlighter, keep the menu closed
                            setDrawTool('highlighter')
                            setIsDrawing(false) // Highlighter is not freehand drawing (not yet implemented)
                            return
                          }
                          handleDropdownOpenChange('highlighterColor', open) // Active → color dropdown
                        }}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                              'h-7 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 flex-shrink-0 flex items-center',
                              'transition-[padding,gap] duration-200 ease-out', compactEarlyLabels ? 'px-1.5 gap-0' : 'px-2 gap-1.5', // Ink cluster collapses first
                              drawTool === 'highlighter'
                                ? 'bg-gray-100 dark:bg-gray-800'
                                : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                            )}
                            title={drawTool === 'highlighter' ? 'Highlighter color' : 'Highlighter'}
                          >
                            <Highlighter className="h-4 w-4 flex-shrink-0" />
                            <ToolbarTitle show={!compactEarlyLabels}>Highlighter</ToolbarTitle>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent {...TOOLBAR_MENU_PLACEMENT} className="min-w-0 w-fit p-1">
                          {DRAW_INK.map((ink) => (
                            <DropdownMenuItem
                              key={ink.id}
                              onClick={() => setHighlighterColor(ink.id)} // Pick highlighter ink independently of freehand
                              className={highlighterColor === ink.id ? 'bg-gray-100 dark:bg-gray-800' : ''}
                            >
                              <Circle className={cn('h-4 w-4', ink.swatch)} />
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </div>
                <span className="flex h-7 items-center text-2xl font-thin text-gray-300 dark:text-gray-500 mx-1 flex-shrink-0 select-none leading-none" aria-hidden>/</span>
              </>
            )}
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
                      'h-7 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 flex-shrink-0 flex items-center',
                      'transition-[padding,gap] duration-200 ease-out', compactLabels ? 'px-1.5 gap-0' : 'px-2 gap-1.5', // Title condenses to icon on shrink
                      drawTool === 'lasso'
                        ? 'bg-gray-100 dark:bg-gray-800'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                    )}
                    title={drawTool === 'lasso' ? 'Selection Mode Active (Click to deselect)' : 'Selection Mode (Click to enable)'}
                  >
                    <LassoSelect className="h-4 w-4 flex-shrink-0" />
                    <ToolbarTitle show={!compactLabels}>Lasso</ToolbarTitle>
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
                      className={cn(
                        'h-7 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0 flex items-center',
                        'transition-[padding,gap] duration-200 ease-out', compactLabels ? 'px-1.5 gap-0' : 'px-2 gap-1.5' // Title condenses to icon on shrink
                      )}
                      title="Insert Vertical Space"
                    >
                      <img 
                        ref={insertVerticalSpaceIconRef}
                        src="/insert%20space%20v%20icon%202.svg" 
                        alt="Insert Vertical Space" 
                        className="w-4 h-4 flex-shrink-0 transition-all duration-200"
                        style={{ 
                          filter: 'brightness(0) saturate(100%) invert(38%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(98%) contrast(100%)',
                          opacity: 0.8
                        }}
                      />
                      <ToolbarTitle show={!compactLabels}>Vertical space</ToolbarTitle>
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
                      className={cn(
                        'h-7 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0 flex items-center',
                        'transition-[padding,gap] duration-200 ease-out', compactLabels ? 'px-1.5 gap-0' : 'px-2 gap-1.5' // Title condenses to icon on shrink
                      )}
                      title="Insert Horizontal Space"
                    >
                      <img 
                        ref={insertHorizontalSpaceIconRef}
                        src="/insert%20space%20h%20icon%201.svg" 
                        alt="Insert Horizontal Space" 
                        className="w-4 h-4 flex-shrink-0 transition-all duration-200"
                        style={{ 
                          filter: 'brightness(0) saturate(100%) invert(38%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(98%) contrast(100%)',
                          opacity: 0.8
                        }}
                      />
                      <ToolbarTitle show={!compactLabels}>Horizontal space</ToolbarTitle>
                    </Button>
                </div>
              </>
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
                  className={cn(
                    'h-7 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0 flex items-center',
                    'transition-[padding,gap] duration-200 ease-out', compactLabels ? 'px-1.5 gap-0' : 'px-2 gap-1.5' // Title condenses to icon on shrink
                  )}
                  title="Board"
                >
                  <Grid3x3 className="h-4 w-4 flex-shrink-0" />
                  <ToolbarTitle show={!compactLabels}>Board</ToolbarTitle>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent {...TOOLBAR_MENU_PLACEMENT} className="w-40">
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
            {/* Slash before capture/presentation cluster or More menu */}
            {(!isItemHidden('presentation') || !isItemHidden('capture') || hiddenItems.size > 0) && (
              <span className="flex h-7 items-center text-2xl font-thin text-gray-300 dark:text-gray-500 mx-1 flex-shrink-0 select-none leading-none" aria-hidden>/</span>
            )}
          </>
        )}

        {/* Capture + Presentation — View bar cluster, no slash between */}
        {editMenuPillMode === 'view' && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <CapturesMenu
              open={openDropdown === 'capture'}
              onOpenChange={(open) => handleDropdownOpenChange('capture', open)}
              conversationId={conversationId}
              triggerVisible={!isItemHidden('capture')}
              showLabel={!compactLabels} // Title condenses to icon on shrink
            />
            <PresentationsMenu
              open={openDropdown === 'presentation'}
              onOpenChange={(open) => handleDropdownOpenChange('presentation', open)}
              triggerVisible={!isItemHidden('presentation')}
              showLabel={!compactLabels} // Title condenses to icon on shrink
            />
          </div>
        )}
        {/* Slash before More menu when capture/presentation stay visible but other View tools overflow */}
        {editMenuPillMode === 'view' && (!isItemHidden('presentation') || !isItemHidden('capture')) && hiddenItems.size > 0 && (
          <span className="flex h-7 items-center text-2xl font-thin text-gray-300 dark:text-gray-500 mx-1 flex-shrink-0 select-none leading-none" aria-hidden>/</span>
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
                <DropdownMenuContent {...TOOLBAR_MENU_PLACEMENT} className="w-32">
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
                <DropdownMenuContent {...TOOLBAR_MENU_PLACEMENT} className="w-40">
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
                    <DropdownMenuContent {...TOOLBAR_MENU_PLACEMENT} className="w-48">
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
                <DropdownMenuContent {...TOOLBAR_MENU_PLACEMENT} className="w-36">
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
                <DropdownMenuContent {...TOOLBAR_MENU_PLACEMENT} className="w-48">
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
                <DropdownMenuContent {...TOOLBAR_MENU_PLACEMENT} className="w-48">
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
                <DropdownMenuContent {...TOOLBAR_MENU_PLACEMENT} className="w-40">
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
                      alt="Thread" 
                      className="w-3.5 h-3.5 transition-all duration-200"
                      style={{ 
                        filter: 'brightness(0) saturate(100%) invert(38%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(98%) contrast(100%)',
                        opacity: 0.8
                      }}
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent {...TOOLBAR_MENU_PLACEMENT} className="w-40">
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
                <DropdownMenuContent {...TOOLBAR_MENU_PLACEMENT} className="min-w-0 w-fit p-1">
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
      </PhoneModeToolsPortal>
      </div>
      {/* End of left section */}

      {/* More menu button - contains hidden items, left-aligned after collapsible items */}
      {!phoneTools && hiddenItems.size > 0 && (
        <DropdownMenu open={openDropdown === 'moreMenu'} onOpenChange={(open) => {
          handleDropdownOpenChange('moreMenu', open)
          if (open) syncTurnIntoFromEditor() // Overflow Turn into needs the caret type
        }}>
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
          <DropdownMenuContent {...TOOLBAR_MENU_PLACEMENT} className="w-56">
            {/* Show hidden items in more menu - different items based on edit menu mode */}
            {editMenuPillMode === 'insert' ? (
              <>
                {/* Layout overflow — visual order: Anchor, Lock frames, Tidy up, Thread layout, Table */}
                {isItemHidden('lock') && reactFlowInstance && (
                  <>
                    <DropdownMenuItem
                      onClick={handleToggleBoardLock}
                      disabled={!boardLockUi.hasSelection}
                    >
                      <Anchor className="h-4 w-4 mr-2" /> {/* Overflow: same anchor as Layout bar */}
                      Anchor
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleToggleFrameLock}
                      disabled={!frameLockUi.hasMulti}
                    >
                      <LegoBrickIcon className="h-4 w-4 mr-2" /> {/* Overflow: same brick as Layout bar */}
                      Lock frames
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('smartAlign') && (
                  <>
                    <DropdownMenuItem>
                      <Boxes className="h-4 w-4 mr-2" />
                      Tidy up
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('arrows') && (
                  <>
                    <LayoutForkMenuItems
                      direction={arrowDirection}
                      align={layoutForkAlign}
                      onDirectionChange={setArrowDirection}
                      onAlignChange={pickLayoutForkAlign}
                      canSnap={frameLockUi.hasMulti || layoutLinkUi.linked}
                      snapActive={layoutLinkUi.linked}
                      onSnapFrames={handleSnapFramesTogether}
                      canStack={frameLockUi.hasMulti || layoutLinkUi.stacked}
                      stackActive={layoutLinkUi.stacked}
                      onStackFrames={handleStackFramesTogether}
                    />
                    <DropdownMenuSeparator />
                  </>
                )}
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
                    <DropdownMenuSeparator />
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
                {(isItemHidden('presentation') || isItemHidden('capture')) && (
                  <>
                    {isItemHidden('capture') && (
                      <DropdownMenuItem onClick={() => handleDropdownOpenChange('capture', true)}>
                        <Scan className="h-4 w-4 mr-2" />
                        Capture
                      </DropdownMenuItem>
                    )}
                    {isItemHidden('presentation') && (
                      <DropdownMenuItem onClick={() => handleDropdownOpenChange('presentation', true)}>
                        <Presentation className="h-4 w-4 mr-2" />
                        Present
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                  </>
                )}
              </>
            ) : editMenuPillMode === 'draw' ? (
              <>
                {/* Draw mode items — same left-to-right order as the bar */}
                {/* Group 2: Eraser — same cluster as pencil (no separator) */}
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
                  </>
                )}
                {/* Group 3: Pencil, Highlighter — overflow keeps toggle + ink submenu */}
                {isItemHidden('drawGroup3') && (
                  <>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Pencil className="h-4 w-4 mr-2" />
                        Pencil
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="min-w-0 w-fit p-1">
                        <DropdownMenuItem onClick={() => { // Overflow click still toggles freehand on/off
                          if (drawTool === 'pencil') {
                            setDrawTool(null)
                            setIsDrawing(false)
                          } else {
                            setDrawTool('pencil')
                            setIsDrawing(true)
                          }
                        }}>
                          {drawTool === 'pencil' ? 'Deselect' : 'Select'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {DRAW_INK.map((ink) => (
                          <DropdownMenuItem
                            key={ink.id}
                            onClick={() => { // Picking ink also arms freehand
                              setPencilColor(ink.id)
                              setDrawTool('pencil')
                              setIsDrawing(true)
                            }}
                            className={pencilColor === ink.id ? 'bg-gray-100 dark:bg-gray-800' : ''}
                          >
                            <Circle className={cn('h-4 w-4 mr-2', ink.swatch)} />
                            {ink.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Highlighter className="h-4 w-4 mr-2" />
                        Highlighter
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="min-w-0 w-fit p-1">
                        <DropdownMenuItem onClick={() => { // Overflow click still toggles highlighter on/off
                          if (drawTool === 'highlighter') {
                            setDrawTool(null)
                            setIsDrawing(false)
                          } else {
                            setDrawTool('highlighter')
                            setIsDrawing(false)
                          }
                        }}>
                          {drawTool === 'highlighter' ? 'Deselect' : 'Select'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {DRAW_INK.map((ink) => (
                          <DropdownMenuItem
                            key={ink.id}
                            onClick={() => { // Picking ink also arms highlighter
                              setHighlighterColor(ink.id)
                              setDrawTool('highlighter')
                              setIsDrawing(false)
                            }}
                            className={highlighterColor === ink.id ? 'bg-gray-100 dark:bg-gray-800' : ''}
                          >
                            <Circle className={cn('h-4 w-4 mr-2', ink.swatch)} />
                            {ink.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
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
              </>
            ) : (
              <>
                {/* Actions mode overflow */}
                {isItemHidden('turnInto') && (
                  <>
                    <DropdownMenuLabel className="text-xs font-normal text-gray-500">Turn into</DropdownMenuLabel>
                    {canTurnInto ? (
                    <TurnIntoMenuItems
                      editor={editor}
                      currentBlockType={turnIntoBlockType}
                      boardInTargets={boardInTargetsForToolbar()}
                      onPick={(pick) => {
                        void applyToolbarTurnInto({
                          editor,
                          conversationId,
                          pick,
                          getSetNodes,
                          reactFlowInstance,
                          onDone: () => {
                            handleDropdownOpenChange('moreMenu', false)
                            syncTurnIntoFromEditor()
                            if (pick.kind === 'format' && (pick.blockType === 'board' || pick.blockType === 'boardIn')) {
                              void queryClientForAi.invalidateQueries({ queryKey: ['conversations'] })
                            }
                          },
                        })
                      }}
                    />
                    ) : (
                      <DropdownMenuItem disabled>Select a block to turn into</DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('actions') && (
                  <>
                    <DropdownMenuItem onClick={() => handleDropdownOpenChange('boardFilter', true)}>
                      <ListFilter className="h-4 w-4 mr-2" />
                      Filter
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDropdownOpenChange('boardSort', true)}>
                      <ArrowUpDown className="h-4 w-4 mr-2" />
                      Sort
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDropdownOpenChange('boardAutomations', true)}>
                      <Zap className="h-4 w-4 mr-2" />
                      Automations
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isItemHidden('search') && (
                  <>
                    <div className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-700 px-2">
                        <Search className="h-3.5 w-3.5 text-gray-400" />
                        <input
                          type="search"
                          value={boardSearch}
                          onChange={(e) => setBoardSearch(e.target.value)}
                          placeholder="Type to search..."
                          className="h-7 w-full bg-transparent border-0 outline-none text-sm"
                        />
                      </div>
                    </div>
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

        </div>
      </div>

      {/* Right Section — AI origin + Share + copy/favorite/more (pinned to the bar’s right, not in the centered cluster) */}
      <div className="absolute right-2 inset-y-0 z-20 flex items-center gap-1 pointer-events-auto" data-right-section>
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

        {/* Notion pin (when connected) left of Share; then copy / favorite / More */}
        <NotionConnectProvider>
          <div className="flex items-center px-2 flex-shrink-0 gap-1">
            {!canEdit && (
              <span className="hidden sm:inline text-[11px] text-gray-500 px-1.5 py-0.5 rounded bg-gray-100">
                {role === 'comment' ? 'Can comment' : 'View only'}
              </span>
            )}
            <NotionTopBarPin />
            {canShare && conversationId ? (
              <ShareBoardMenu boardId={conversationId} />
            ) : canShare ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1.5 text-gray-400 flex-shrink-0"
                title="Save the board to share"
                type="button"
                disabled
              >
                <Lock className="h-4 w-4" />
                <span className="text-sm font-medium">Share</span>
              </Button>
            ) : null}
            <BoardTopBarShare conversationId={conversationId} />
          </div>
        </NotionConnectProvider>
      </div>
    </div>
  )
}

