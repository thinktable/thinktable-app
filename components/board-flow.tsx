'use client'
// Force recompile to fix hydration mismatch

// React Flow board component - displays chat panels behind input
import ReactFlow, {
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  ConnectionMode,
  BackgroundVariant,
  useReactFlow,
  useStoreApi,
  useUpdateNodeInternals,
  ConnectionLineType,
  BaseEdge,
  getSmoothStepPath,
} from 'reactflow'
import type { Node, Edge, EdgeProps } from 'reactflow' // Types only — value `Node` is undefined and shadows DOM Node
import 'reactflow/dist/style.css'
import { ChatPanelNode } from './chat-panel-node' // Eager: next/dynamic breaks RF nodeTypes + left frames blank forever
import { BlockGroupNode } from './block-group-node' // Legacy dashed wrapper around frames
import {
  EditableThread,
  ThreadConnectionLine,
  DEFAULT_THREAD_ALGORITHM,
  ThreadAlgorithm,
  threadAlgorithmFromStyle,
  threadStyleFromAlgorithm,
  THREAD_DEFAULT_STROKE_WIDTH,
  normalizeHandleId,
  type ThreadEdgeData,
} from '@/components/threads' // Miro-style editable threads + connection preview
import { threadComfortScale } from '@/components/threads/constants' // Same ⋮⋮ comfort curve for pre-frame I-bar grip
import { useIsThreadConnecting } from '@/components/threads/use-is-thread-connecting' // Pane class while connecting
import {
  BlockActionsMenu,
  type BlockActionId,
  type BlockActionPayload,
  type BlockTypeId,
} from './block-actions-menu' // Notion-style block actions + Turn into baseline
import {
  FRAME_SHAPE_DEFAULT_SIZE,
  FRAME_SHAPE_MIN_SIZE,
  FRAME_SHAPE_NONE,
  parseFrameShape,
  type FrameShapeChoice,
} from '@/lib/frame-shape' // Frame-as-shape silhouette helpers
import {
  ThreadActionsMenu,
  type ThreadActionId,
} from './thread-actions-menu' // Thread click menu (same chrome as handle menu)
import {
  BoardActionsMenu,
  type BoardActionId,
} from './board-actions-menu' // Empty-board right-click menu
import { createLongPressController } from '@/lib/long-press' // Phone long-press → context menus
import { attachPhoneSelectMarquee } from '@/lib/phone-select-marquee' // Touch select-tool marquee (RF Pane is mouse-only)
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useEffect, useRef, useMemo, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTheme } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import { cn, generateUUID } from '@/lib/utils'
import { replaceBoardUrl } from '@/lib/replace-board-url' // history.replaceState — router.replace remounts the frame
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ArrowDown, GripVertical, MousePointer2, Hand, Plus, Minus } from 'lucide-react'
import { useReactFlowContext } from './react-flow-context'
import { useSidebarContext } from './sidebar-context'
import { useChatSidebarViewportAdjust } from '@/lib/hooks/use-chat-sidebar-viewport'
import { setAiSelectedFrames, setAiViewportCenter } from '@/lib/ai/selection-bridge' // Bridge RF selection + viewport → AI context
import { takeBoardCapture } from '@/lib/captures' // Board-menu Capture view
import { htmlToPlain } from '@/lib/ai/context-pack' // Frame hover previews from content
import { AI_CHAT_BLOCK_MIME, type AiChatBlockDragPayload } from '@/lib/ai/types' // Drag chat turn onto page
import { markHtmlWithAiOrigin } from '@/lib/ai/wrap-ai-html' // Persist AI provenance on chat-drop
import { markdownToTipTapHtml } from '@/lib/ai/markdown-to-tiptap' // Chat drop → TipTap blocks (lists as listItems)
import { AiEditReviewBar } from '@/components/ai/ai-edit-review-bar' // Pending edit review chrome
import { useAiEditSession } from '@/lib/ai/edit-session' // Frame pending glow / focus
import {
  BLOCK_GROUP_PADDING,
  blockGroupNodeId,
  createBlockGroup,
  deleteLinkedBoardForBlock,
  duplicateBlockMetadata,
  isBlockGroupMeta,
  migrateMessagesToBlockFlag,
  newBlockMetadata,
  persistBlockPlacement,
  readNotionConnection,
  ungroupBlocks,
} from '@/lib/blocks' // blocks, groups (page-body ensure is promote-only — not cold load)
import { transformHtmlToBlockType } from '@/lib/blocks/turn-into' // Seed empty-frame HTML for I-bar Turn into
import { PROPERTY_GROUP_H } from '@/lib/blocks/property' // Top property strip height — I-bar spawn offset
import { propertyBlockHtml } from '@/lib/tiptap/property-block' // I-bar Turn into → Property seeds icon + Empty cell
import { absFlowPosition, nodeFlowSize, useBlockGroupDrag } from './use-block-group-drag' // Drag attach/detach between groups / page
import { useFrameNestStackDrag, isStackCollapsedMeta } from './use-frame-nest-stack-drag' // Edge-snap → stack reveal
import { minStackIndex } from '@/lib/frame-side-stacks' // Per-side stack z-order
import { FrameNestStackOverlay } from './frame-nest-stack-overlay' // Snap preview line on host edge
import {
  armMarqueeFrameSelect,
  clearMarqueeFrameSelect,
  isMarqueeFrameSelectArmed,
} from '@/lib/frame-drag-transient' // Frame select = click release; marquee still allowed
import {
  PREVIEW_READY_MESSAGE,
  PREVIEW_RESIZE_MESSAGE,
  PREVIEW_STYLE_MESSAGE,
  usePreviewFocus,
} from '@/lib/preview-focus-context' // Style sync + ready/resize handshake for iframe previews
import { BoardEmbedProvider } from '@/lib/board-embed-context' // Hide nested preview controls inside embed
import { useBoardAccess } from '@/lib/share/board-access-context' // Shared view/comment → read-only map
import { ThinktableBrandMark } from './personalize-ai-modal'
import { NavZoomControl } from './nav-zoom-control' // Zoom % lives in bottom nav (not top bar)
import { NavRotateControl } from './nav-rotate-control' // Board rotate icon — right of zoom %
import { BoardRotationProvider, useBoardRotation } from './board-rotation-context' // Two-finger twist + nav camera heading
import { applyBoardRotationToPositionChanges, flowToPane, paneToFlow, viewportKeepingPanePoint } from '@/lib/board-rotation' // Camera-aware pane ↔ flow
import { LeftVerticalMenu } from './left-vertical-menu'
import { FreehandNode } from './freehand/FreehandNode' // Freehand drawing node component
import { Freehand, retryFailedSaves } from './freehand/Freehand' // Freehand drawing overlay component and retry function
import { ShapeNode } from './shapes/ShapeNode' // Shape node component
import { useUndoRedo } from './use-undo-redo' // Undo/redo hook for map actions
import { useHelperLines } from './helper-lines/useHelperLines' // Helper lines hook for snap-to-grid functionality
import { useUserPreference } from '@/lib/hooks/use-user-preferences'
// Dynamic layouting hooks for adding child nodes and inserting nodes
import { useAddChildNode } from './dynamic-layouting/hooks/useAddChildNode'
import { useInsertNodeBetween } from './dynamic-layouting/hooks/useInsertNodeBetween'
import { usePlaceholderManager } from './dynamic-layouting/hooks/usePlaceholderManager'
// Placeholder node and edge components
import PlaceholderNode from './dynamic-layouting/PlaceholderNode'
import PlaceholderEdge from './dynamic-layouting/PlaceholderEdge'
import { FrameShimmerNode } from './frame-shimmer-node' // Layout-cached shells while messages fetch
import {
  type FrameLayoutCache,
  frameHasVisibleText,
  shimmerBarCountFromHtml,
  readFrameLayoutCache,
  writeFrameLayoutCache,
  patchFrameLayoutEntry,
  frameShimmerNodeId,
  BOARD_LOAD_FADE_MS,
} from '@/components/frame-content-shimmer' // Shared shimmer + layout cache helpers

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  metadata?: Record<string, any> // Optional metadata field (e.g., isFlashcard)
}

/** Public homepage board id from env — only that board may use /api/homepage-board. */
const HOMEPAGE_BOARD_ID = process.env.NEXT_PUBLIC_HOMEPAGE_BOARD_ID || ''

/** True when this conversation is the configured public homepage map. */
function isHomepageBoardId(conversationId: string): boolean {
  return Boolean(HOMEPAGE_BOARD_ID && conversationId === HOMEPAGE_BOARD_ID)
}

interface ChatPanelNodeData {
  promptMessage: Message
  responseMessage?: Message
  conversationId: string
  isResponseCollapsed?: boolean // Track if response is collapsed for position updates
  fillColor?: string // Panel fill color (optional, defaults to transparent)
  borderColor?: string // Panel border color (optional, defaults to theme-based)
  borderStyle?: string // Panel border style (solid, dashed, dotted)
  borderWeight?: string // Panel border thickness (1px, 2px, 4px)
  frameShape?: string | null // Silhouette when frames act as shapes
}

const MINIMAP_HEIGHT = 120 // Keep in sync with .minimap-custom-size height in globals.css
const MINIMAP_WIDTH = 179 // Keep in sync with .minimap-custom-size width in globals.css
const MINIMAP_BOTTOM = 8 // Inset from map column bottom edge
const MINIMAP_LEFT = 8 // Match top-bar menu button (sticky-prompt-panel paddingLeft 0.5rem)
const MINIMAP_NAV_GAP = 6 // Air between Free nav and minimap in the column stack
const MINIMAP_EXPAND_MS = 220 // Shared open/close/load height tween (expand-up)
const FREE_NAV_WIDTH = MINIMAP_WIDTH // Same width as the minimap so the column stack lines up
const BRAND_RIGHT = 12 // Inset from map column right edge
/** Flow → frame top-left so the caret/⋮⋮ land on the I-bar (block chrome only). */
const BLOCK_CREATE_OFFSET_X = 6 // contentFit BLOCK_FRAME_PAD_X (⋮⋮ lives outside the fill)
const BLOCK_CREATE_OFFSET_Y = 4 // contentFit paddingTop only (legacy 20 assumed chat p-1 + extra)
// Stable key-code arrays — new array literals each render make RF's useKeyPress loop (Max update depth).
const MULTI_SELECT_KEYS = ['Shift', 'Meta', 'Control'] // Shift/Cmd/Ctrl+click adds to selection
const SELECTION_BOX_KEYS = ['Shift'] // Shift+drag draws a selection box
const DELETE_KEYS = ['Backspace', 'Delete'] // Stable — inline arrays loop RF useKeyPress

/** Right-click over text often targets a Text node, which has no `.closest`. */
function eventElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target // Already an element
  if (target instanceof globalThis.Node) return target.parentElement // DOM Text → parent (not RF Node type)
  return null
}

// Fetch messages for a conversation and create panels
// For homepage boards, uses API route (public access via service role)
// For regular boards, requires authentication and ownership
async function fetchMessagesForPanels(
  conversationId: string,
  options?: { embed?: boolean } // Embed previews skip homepage probe for speed
): Promise<Message[]> {
  const supabase = createClient()
  const isEmbed = options?.embed === true

  // Only hit the public homepage API when this id is the configured homepage board
  if (!isEmbed && isHomepageBoardId(conversationId)) {
    try {
      const response = await fetch('/api/homepage-board')
      if (response.ok) {
        const data = await response.json()
        if (data.conversation?.id === conversationId) {
          const homepageMessages = (data.messages || []) as Message[]
          await migrateMessagesToBlockFlag(supabase, homepageMessages) // In-memory fast; DB persist async
          return homepageMessages
        }
      }
    } catch (error) {
      console.error('Error fetching homepage messages from API:', error)
    }
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return []
  }

  const { data, error } = await supabase
    .from('messages')
    .select('id, role, content, created_at, metadata')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error fetching messages:', error)
    return []
  }
  const messages = (data || []) as Message[]
  // Legacy flag migrate: apply in memory now; do not await serial UPDATEs on first paint
  await migrateMessagesToBlockFlag(supabase, messages)
  // Page-body creation needs explicit bodyHtml (Turn into / promote) — never on cold load
  return messages
}

// Custom animated dotted edge component - flows like Supabase schema visualizer
// The dashes themselves flow along the path, not a dot
function AnimatedDottedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{
        ...style,
        strokeDasharray: '5,5',
        strokeDashoffset: 0,
        animation: 'flow-dash 1.5s linear infinite',
      }}
    />
  )
}

// Fetch edges (connections) for a conversation - lightweight query (just message IDs)
// For homepage boards, uses API route (public access via service role)
// For regular boards, requires authentication and ownership
async function fetchEdgesForConversation(conversationId: string): Promise<
  Array<{ source_message_id: string; target_message_id: string; metadata?: ThreadEdgeData | null }>
> {
  const supabase = createClient()
  
  // Public homepage edges only when id matches env — skip probe on every normal board
  if (isHomepageBoardId(conversationId)) {
    try {
      const response = await fetch('/api/homepage-board')
      if (response.ok) {
        const data = await response.json()
        if (data.conversation?.id === conversationId) {
          return (data.edges || []) as Array<{
            source_message_id: string
            target_message_id: string
            metadata?: ThreadEdgeData | null
          }>
        }
      }
    } catch (error) {
      console.error('Error fetching homepage edges from API:', error)
    }
  }

  // For non-homepage boards, require authentication
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return [] // Not homepage and not authenticated - no access
  }

  // Authenticated user - fetch their own boards (RLS will enforce ownership)
  // Prefer metadata (control points); fall back if column not migrated yet
  let { data, error } = await supabase
    .from('panel_edges')
    .select('source_message_id, target_message_id, metadata')
    .eq('conversation_id', conversationId)

  if (error && String(error.message || '').includes('metadata')) {
    const fallback = await supabase
      .from('panel_edges')
      .select('source_message_id, target_message_id')
      .eq('conversation_id', conversationId)
    data = fallback.data as typeof data
    error = fallback.error
  }

  if (error) {
    console.error('Error fetching edges:', error)
    return []
  }

  return data || []
}

// Fetch canvas nodes (freehand drawings, etc.) for a conversation
// For homepage boards, uses API route (public access via service role)
// For regular boards, requires authentication and ownership
async function fetchCanvasNodesForConversation(conversationId: string): Promise<Array<{
  id: string
  node_type: string
  position_x: number
  position_y: number
  width: number
  height: number
  data: any
}>> {
  const supabase = createClient()
  
  // Public homepage canvas only when id matches env — skip probe on every normal board
  if (isHomepageBoardId(conversationId)) {
    try {
      const response = await fetch('/api/homepage-board')
      if (response.ok) {
        const data = await response.json()
        if (data.conversation?.id === conversationId) {
          return (data.canvasNodes || []) as Array<{
            id: string
            node_type: string
            position_x: number
            position_y: number
            width: number
            height: number
            data: any
          }>
        }
      }
    } catch (error) {
      console.error('Error fetching homepage canvas nodes from API:', error)
    }
  }

  // For non-homepage boards, require authentication
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return [] // Not homepage and not authenticated - no access
  }

  // Authenticated user - fetch their own canvas nodes (RLS will enforce ownership)
  const { data, error } = await supabase
    .from('canvas_nodes')
    .select('id, node_type, position_x, position_y, width, height, data')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error fetching canvas nodes:', error)
    return []
  }

  return (data || []) as Array<{
    id: string
    node_type: string
    position_x: number
    position_y: number
    width: number
    height: number
    data: any
  }>
}

// Define nodeTypes outside component as a module-level constant
// This ensures it's stable and React Flow won't complain about recreation
// Using Object.freeze to ensure immutability
// Note: ChatPanelNode is a stable function component, so this reference won't change
const nodeTypes = Object.freeze({
  chatPanel: ChatPanelNode,
  blockGroup: BlockGroupNode, // Visual group of map blocks
  freehand: FreehandNode, // Freehand drawing node type
  shape: ShapeNode, // Shape node type
  placeholder: PlaceholderNode, // Placeholder node for dynamic layouting
  frameShimmer: FrameShimmerNode, // Layout-cached shell while messages fetch
})

// Define edgeTypes outside component as a module-level constant
const edgeTypes = Object.freeze({
  editable: EditableThread, // Miro-style adjustable thread (default)
  animatedDotted: EditableThread, // Same path editor; dashed via data.dotted
  placeholder: PlaceholderEdge, // Placeholder edge for dynamic layouting
})

/** @deprecated Prefer ThreadConnectionLine — kept so older imports keep working. */
function PointerConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
}: {
  fromX: number
  fromY: number
  toX: number
  toY: number
}) {
  return <ThreadConnectionLine fromX={fromX} fromY={fromY} toX={toX} toY={toY} />
}

// Return to bottom — portals into the right chat sidebar above the prompt
function ReturnToBottomButton({ onClick, isVisible }: { onClick: () => void; isVisible: boolean }) {
  const { isChatSidebarOpen, aiChatHasTranscript } = useSidebarContext()
  const [slot, setSlot] = useState<Element | null>(null)

  useEffect(() => {
    // AI chat owns return-to-bottom when a transcript is open; empty New AI chat stays clear
    if (!isChatSidebarOpen || aiChatHasTranscript) {
      setSlot(null)
      return
    }
    const find = () => setSlot(document.querySelector('[data-chat-return-slot]'))
    find()
    const id = window.setInterval(find, 200) // Slot mounts with chat sidebar
    return () => window.clearInterval(id)
  }, [isChatSidebarOpen, aiChatHasTranscript])

  if (!isChatSidebarOpen || aiChatHasTranscript || !slot) return null // Lives inside chat column only

  return createPortal(
    <div
      style={{
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.3s ease-in-out',
        pointerEvents: isVisible ? 'auto' : 'none',
      }}
    >
      <Button
        size="icon"
        onClick={onClick}
        className="group h-9 w-9 rounded-full bg-white dark:bg-[#1f1f1f] border border-gray-300 dark:border-[#2f2f2f] shadow-lg hover:bg-gray-50 dark:hover:bg-[#2a2a2a] transition-colors"
        title="Focus most recent panel"
      >
        <ArrowDown className="h-4 w-4 text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors" />
      </Button>
    </div>,
    slot
  )
}

function BoardFlowInner({
  conversationId,
  searchParams,
  embedded = false,
  hideMapChrome = false, // Public / landing: no Free nav or minimap
}: {
  conversationId?: string
  searchParams: ReturnType<typeof useSearchParams> | null
  embedded?: boolean // True when rendered as page-within-page preview
  hideMapChrome?: boolean // Hide Free nav + minimap (pre-login homepage)
}) {
  const { canEdit } = useBoardAccess() // RLS is authority; UI mirrors for viewers
  const { resolvedTheme } = useTheme()
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesState] = useEdgesState([])
  
  // Memoize nodeTypes and edgeTypes to prevent React Flow warnings
  // Even though they're defined outside, useMemo ensures stable reference
  const memoizedNodeTypes = useMemo(() => nodeTypes, [])
  const memoizedEdgeTypes = useMemo(() => edgeTypes, [])

  // Dynamic layouting hooks
  const addChildNode = useAddChildNode() // Hook for adding child nodes via context menu
  const insertNodeBetween = useInsertNodeBetween() // Hook for inserting nodes between edges
  
  // Track when a selected node is being dragged to hide placeholders
  const [isSelectedNodeDragging, setIsSelectedNodeDragging] = useState(false)
  const isThreadConnecting = useIsThreadConnecting() // Miro: hide frame adjust chrome; reveal snap targets

  // Placeholder manager - shows placeholders where next chat panel will be added
  // Hide placeholders when a selected node is being dragged
  const { updatePlaceholders } = usePlaceholderManager(nodes, edges, conversationId, isSelectedNodeDragging)
  const prevMessagesKeyRef = useRef<string>('')
  const prevCollapseStatesRef = useRef<Map<string, boolean>>(new Map()) // Track previous collapse states
  const dragSnapshotTakenRef = useRef<Set<string>>(new Set()) // Track if snapshot taken for current drag session per node
  const unparentedGroupsRef = useRef<string | null>(null) // One-shot unparent per conversation (avoid double abs offset)

  // Initialize with consistent defaults to avoid hydration mismatch
  // Then update from localStorage in useEffect after hydration
  const [isScrollMode, setIsScrollMode] = useState(true) // true = Scroll (wheel pans); false = Zoom
  const [mapPointerTool, setMapPointerTool] = useState<'select' | 'pan'>('pan') // Pan default; select via nav toggle
  const [viewMode, setViewModeState] = useState<'linear' | 'canvas'>('canvas')
  
  // Linear mode navigation state
  const [linearNavMode, setLinearNavMode] = useState<'chat' | 'all'>('chat') // Filter mode for linear navigation
  const [focusedPanelIndex, setFocusedPanelIndex] = useState<number | null>(null) // Currently focused panel index in linear mode
  const [viewportKey, setViewportKey] = useState(0) // Force re-render when viewport changes to update button visibility

  // [TEMP DIAG] Render-storm detector: names which RF value flips each render when a loop occurs. REMOVE AFTER.
  const __renderTimesRef = useRef<number[]>([]) // Sliding window of recent render timestamps (ms)
  const __lastTrackedRef = useRef<{ n: unknown; nl: number; e: unknown; el: number; vk: number; vm: string } | null>(null) // Previous render's tracked values
  const __lastWarnRef = useRef(0) // Throttle warnings so we log once per storm, not 1000x
  useEffect(() => {
    const now = Date.now() // Timestamp this render
    const w = __renderTimesRef.current // Window of render times
    w.push(now) // Record this render
    while (w.length && now - w[0] > 1000) w.shift() // Keep only the last 1s of renders
    // Snapshot the RF-related values React points at (<ReactFlow>): array identities, lengths, viewport/view keys
    const cur = { n: nodes, nl: nodes.length, e: edges, el: edges.length, vk: viewportKey, vm: viewMode }
    const prev = __lastTrackedRef.current // What they were last render
    __lastTrackedRef.current = cur // Advance for next comparison
    // A storm = >40 renders within 1s (well past normal); warn at most every 2s with the changed keys
    if (w.length > 40 && now - __lastWarnRef.current > 2000 && prev) {
      __lastWarnRef.current = now // Throttle
      const changed: string[] = [] // Which tracked values differ from last render
      if (prev.n !== cur.n) changed.push(`nodes(ref) len ${prev.nl}->${cur.nl}`) // New nodes array each render = setNodes loop
      if (prev.e !== cur.e) changed.push(`edges(ref) len ${prev.el}->${cur.el}`) // New edges array each render = setEdges loop
      if (prev.vk !== cur.vk) changed.push(`viewportKey ${prev.vk}->${cur.vk}`) // Viewport bump loop (onMove)
      if (prev.vm !== cur.vm) changed.push(`viewMode ${prev.vm}->${cur.vm}`) // View mode thrash
      // Emit a single high-signal line naming the culprit (or telling us it's an untracked state)
      console.error('[LOOP-DIAG] render storm', w.length, '/1s; changed since last render:', changed.length ? changed.join(', ') : 'NONE of {nodes,edges,viewportKey,viewMode} — culprit is another state')
    }
  }) // No dep array on purpose: runs after every render to measure render frequency

  // Free-only nav UI — Linear toggle removed; coerce any 'linear' preference to canvas
  const setViewMode = (mode: 'linear' | 'canvas') => {
    const next = mode === 'linear' ? 'canvas' : mode
    setViewModeState(next)
    if (typeof window !== 'undefined') {
      localStorage.setItem('thinktable-view-mode', next)
    }
  }
  
  // Load linear navigation mode preference from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('thinktable-linear-nav-mode')
      if (saved === 'chat' || saved === 'all') {
        setLinearNavMode(saved)
      }
    }
  }, [])
  
  // Save linear navigation mode preference
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('thinktable-linear-nav-mode', linearNavMode)
    }
  }, [linearNavMode])
  
  // I-bar cursor state - stores position {x, y} in flow coordinates when double-clicking on map
  // null = no I-bar shown, {x, y} = I-bar position for inline note creation
  const [iBarPosition, setIBarPosition] = useState<{ x: number; y: number } | null>(null)
  
  // Viewport state for I-bar rendering - triggers re-render when viewport changes
  const [iBarViewport, setIBarViewport] = useState<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 })
  // Screen/flow anchor for the hidden capture field — kept through first-keystroke spawn so iOS doesn’t drop the keyboard when the visual I-bar clears
  const [iBarInputAnchor, setIBarInputAnchor] = useState<{
    x: number
    y: number
    vx: number
    vy: number
    zoom: number
  } | null>(null)
  
  // Track if we're creating an inline note (to prevent double-creation)
  const [isCreatingInlineNote, setIsCreatingInlineNote] = useState(false)
  // Keystrokes typed at the map I-bar while the frame is still spawning (continuous typing)
  const iBarTypeBufferRef = useRef('')
  // Flow position captured at create-start (iBarPosition is cleared immediately)
  const iBarCreatePosRef = useRef<{ x: number; y: number } | null>(null)
  // Message id of the in-flight I-bar frame — seed events target this panel
  const iBarPendingMessageIdRef = useRef<string | null>(null)
  // True while insert is in flight — ref so rapid keydowns don’t double-create
  const iBarCreatingRef = useRef(false)
  // Hidden textarea that receives focus on board tap so iPhone/iPad soft keyboard can open (keydown-only I-bar cannot)
  const iBarInputRef = useRef<HTMLTextAreaElement>(null)
  // Latest buffer applier from the I-bar capture effect — textarea onInput calls this without stale closures
  const iBarApplyTextRef = useRef<(text: string) => void>(() => {})
  // Armed when I-bar is shown or mid-create — set synchronously on tap so the first soft-key `input` isn’t dropped before React re-renders
  const iBarArmedRef = useRef(false)
  // Mirror of iBarPosition for the always-on capture effect (avoids remounting listeners every place/clear)
  const iBarPositionRef = useRef<{ x: number; y: number } | null>(null)
  iBarPositionRef.current = iBarPosition
  // Pre-frame ⋮⋮ menu (opens before a frame exists); screen coords for position:fixed
  const [iBarBlockMenu, setIBarBlockMenu] = useState<{
    x: number
    y: number
    openLeft: boolean
  } | null>(null)
  const iBarBlockMenuOpenRef = useRef(false) // Capture-phase keys skip while the menu owns typing
  iBarBlockMenuOpenRef.current = !!iBarBlockMenu
  // Board id for I-bar persist without rebinding keydown (conversationId in effect deps dropped keys on first create)
  const conversationIdRef = useRef(conversationId)
  conversationIdRef.current = conversationId

  // Load preferences from localStorage first (instant), then Supabase (sync)
  useEffect(() => {
    if (typeof window === 'undefined') return

    // STEP 1: Load from localStorage FIRST (synchronous, instant) - ensures UI shows saved prefs immediately
    const savedViewMode = localStorage.getItem('thinktable-view-mode') as 'linear' | 'canvas' | null
    if (savedViewMode === 'linear' || savedViewMode === 'canvas') {
      setViewMode(savedViewMode)
    }

    const savedScrollMode = localStorage.getItem('thinktable-scroll-mode')
    if (savedScrollMode === 'true') {
      setIsScrollMode(true)
    } else if (savedScrollMode === 'false') {
      setIsScrollMode(false)
    }

    const savedMinimapHidden = localStorage.getItem('thinktable-minimap-hidden')
    if (savedMinimapHidden === 'true') {
      setIsMinimapHidden(true)
      setIsMinimapManuallyHidden(true)
    }

    // STEP 2: Then load from Supabase (async) and update if different (for cross-device sync)
    const loadPreferences = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('metadata')
            .eq('id', user.id)
            .single()

          if (profile?.metadata) {
            const prefs = profile.metadata as {
              viewMode?: 'linear' | 'canvas'
              isScrollMode?: boolean
              isMinimapHidden?: boolean
            }

            // Update from Supabase if values exist (Supabase is source of truth for cross-device sync)
            // Load view mode from Supabase if available
            // Only update if preferences haven't been loaded yet (to prevent conflicts)
            if (!preferencesLoadedRef.current && prefs.viewMode && ['linear', 'canvas'].includes(prefs.viewMode)) {
              setViewMode(prefs.viewMode)
              localStorage.setItem('thinktable-view-mode', prefs.viewMode)
            }

            if (typeof prefs.isScrollMode === 'boolean') {
              setIsScrollMode(prefs.isScrollMode)
              localStorage.setItem('thinktable-scroll-mode', String(prefs.isScrollMode))
            }

            if (typeof prefs.isMinimapHidden === 'boolean') {
              setIsMinimapHidden(prefs.isMinimapHidden)
              setIsMinimapManuallyHidden(prefs.isMinimapHidden)
              localStorage.setItem('thinktable-minimap-hidden', String(prefs.isMinimapHidden))
            }
          }
        }
      } catch (error) {
        console.error('Error loading preferences from Supabase:', error)
        // If Supabase fails, localStorage values already loaded above will be used
      } finally {
        // Mark as loaded AFTER Supabase load completes (or fails) to prevent other effects from interfering
        preferencesLoadedRef.current = true
      }
    }

    loadPreferences()
  }, [])

  // Reload preferences from Supabase when conversationId changes (to ensure selections persist when board ID is created)
  useEffect(() => {
    if (typeof window === 'undefined' || !conversationId) return
    // Don't reload if preferences have already been loaded (to prevent conflicts)
    if (preferencesLoadedRef.current) return

    const reloadPreferences = async () => {
      const supabase = createClient()

      try {
        // Try to load from Supabase first
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('metadata')
            .eq('id', user.id)
            .single()

          if (profile?.metadata) {
            const prefs = profile.metadata as {
              viewMode?: 'linear' | 'canvas'
              isScrollMode?: boolean
              isMinimapHidden?: boolean
            }

            // Update from Supabase if values exist
            // Load view mode from Supabase if available
            if (prefs.viewMode && ['linear', 'canvas'].includes(prefs.viewMode)) {
              setViewMode(prefs.viewMode)
              localStorage.setItem('thinktable-view-mode', prefs.viewMode)
            }

            if (typeof prefs.isScrollMode === 'boolean') {
              setIsScrollMode(prefs.isScrollMode)
              localStorage.setItem('thinktable-scroll-mode', String(prefs.isScrollMode))
            }

            if (typeof prefs.isMinimapHidden === 'boolean') {
              setIsMinimapHidden(prefs.isMinimapHidden)
              setIsMinimapManuallyHidden(prefs.isMinimapHidden)
              localStorage.setItem('thinktable-minimap-hidden', String(prefs.isMinimapHidden))
            }
          }
        }
      } catch (error) {
        console.error('Error loading preferences from Supabase:', error)
      }
    }

    // Load from localStorage first (instant) - only if preferences haven't been loaded yet
    if (!preferencesLoadedRef.current) {
      const savedViewMode = localStorage.getItem('thinktable-view-mode') as 'linear' | 'canvas' | null
      if (savedViewMode && ['linear', 'canvas'].includes(savedViewMode)) {
        setViewMode(savedViewMode)
      }
    }

    const savedScrollMode = localStorage.getItem('thinktable-scroll-mode')
    if (savedScrollMode === 'true') {
      setIsScrollMode(true)
    } else if (savedScrollMode === 'false') {
      setIsScrollMode(false)
    }

    const savedMinimapHidden = localStorage.getItem('thinktable-minimap-hidden')
    if (savedMinimapHidden === 'true') {
      setIsMinimapHidden(true)
      setIsMinimapManuallyHidden(true)
    }

    // Then load from Supabase (async) and update if different
    reloadPreferences()
  }, [conversationId])

  // Reload preferences from Supabase when conversation-created event fires (to catch selections made before first message)
  useEffect(() => {
    if (typeof window === 'undefined') return

    const reloadSelections = async () => {
      // Don't reload if preferences have already been loaded (to prevent conflicts)
      // Only reload on explicit events (conversation-created, pathname change)
      if (preferencesLoadedRef.current) return

      const supabase = createClient()

      try {
        // Try to load from Supabase first
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('metadata')
            .eq('id', user.id)
            .single()

          if (profile?.metadata) {
            const prefs = profile.metadata as {
              viewMode?: 'linear' | 'canvas'
              isScrollMode?: boolean
              isMinimapHidden?: boolean
            }

            // Load view mode - only if preferences haven't been loaded yet
            if (prefs.viewMode && ['linear', 'canvas'].includes(prefs.viewMode)) {
              setViewMode(prefs.viewMode)
              localStorage.setItem('thinktable-view-mode', prefs.viewMode)
            }

            // Load scroll mode
            if (typeof prefs.isScrollMode === 'boolean') {
              setIsScrollMode(prefs.isScrollMode)
              localStorage.setItem('thinktable-scroll-mode', String(prefs.isScrollMode))
            }

            // Load minimap visibility
            if (typeof prefs.isMinimapHidden === 'boolean') {
              setIsMinimapHidden(prefs.isMinimapHidden)
              setIsMinimapManuallyHidden(prefs.isMinimapHidden)
              localStorage.setItem('thinktable-minimap-hidden', String(prefs.isMinimapHidden))
            }

            return // Successfully loaded from Supabase, skip localStorage fallback
          }
        }
      } catch (error) {
        console.error('Error loading preferences from Supabase:', error)
      }

      // Fallback to localStorage - only if preferences haven't been loaded yet
      if (!preferencesLoadedRef.current) {
        const savedScrollMode = localStorage.getItem('thinktable-scroll-mode')
        if (savedScrollMode === 'true') {
          setIsScrollMode(true)
        } else {
          setIsScrollMode(false)
        }

        const savedViewMode = localStorage.getItem('thinktable-view-mode') as 'linear' | 'canvas' | null
        if (savedViewMode && ['linear', 'canvas'].includes(savedViewMode)) {
          setViewMode(savedViewMode)
        }

        const savedMinimapHidden = localStorage.getItem('thinktable-minimap-hidden')
        if (savedMinimapHidden === 'true') {
          setIsMinimapHidden(true)
          setIsMinimapManuallyHidden(true)
        }
      }
    }

    const handleConversationCreated = () => {
      // Don't reload on conversation-created if preferences already loaded
      // This event should not override user's current viewMode
      // reloadSelections()
    }

    // Also reload immediately on mount and when pathname changes (to catch navigation)
    const handlePathnameChange = () => {
      // Don't reload on pathname change if preferences already loaded
      // This prevents random mode switches during navigation
      // reloadSelections()
    }

    // Reload on initial mount - only if preferences haven't been loaded yet
    if (!preferencesLoadedRef.current) {
      reloadSelections()
    }

    // Listen for conversation-created event
    window.addEventListener('conversation-created', handleConversationCreated)

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
      window.removeEventListener('popstate', handlePathnameChange)
      window.history.pushState = originalPushState
      window.history.replaceState = originalReplaceState
    }
  }, [setIsScrollMode, setViewMode])

  const reactFlowInstance = useReactFlow()
  const rfStore = useStoreApi() // Embed: force pane width/height when CSS % height collapses
  const updateNodeInternals = useUpdateNodeInternals() // Remeasure Handles after connect so paths attach
  const { setReactFlowInstance, registerSetNodes, isLocked, layoutMode, setLayoutMode, setIsDeterministicMapping, panelWidth: contextPanelWidth, isPromptBoxCentered, lineStyle, setLineStyle, arrowDirection, setArrowDirection, boardRule: contextBoardRule, boardStyle: contextBoardStyle, clickedEdge: contextClickedEdge, setClickedEdge: setContextClickedEdge, fillColor, borderColor, borderWeight, borderStyle, flashcardMode, setFlashcardMode, selectedTag, setSelectedTag, isDrawing, drawTool, drawShape, registerMapUndoRedo, registerMapTakeSnapshot, snapEnabled } = useReactFlowContext()
  const { rotation: boardRotation, setScrollMode } = useBoardRotation() // Subscribe so I-bar / overlays re-place when the camera twists
  const { onNodeDrag: onBlockGroupNodeDrag, onNodeDragStop: onBlockGroupNodeDragStop } = useBlockGroupDrag({
    conversationId, // Persist attach/detach to this map
    getNodes: () => reactFlowInstance.getNodes(), // Live RF nodes during drag (not a stale closure)
    setNodes, // Reparent + clear drop-target class
    isLocked, // Locked board: move only, no group change
  })

  // Arm marquee so frame select:true from the selection rect is not treated as mousedown-select
  useEffect(() => {
    return rfStore.subscribe((state) => {
      if (state.userSelectionActive) armMarqueeFrameSelect()
    })
  }, [rfStore])

  // One-shot: existing boards still have RF-parented cards + zIndex:-1 groups (messagesKey doesn’t rebuild).
  // Unparent immediately and restore a visible dashed sibling frame.
  useEffect(() => {
    const key = `${conversationId || 'none'}:v2` // v2: also stamp draggable:false (v1 one-shot skipped that)
    if (unparentedGroupsRef.current === key) return // Already converted this board
    if (!nodes.length) return // Wait until panels exist
    const hasParented = nodes.some((n) => Boolean(n.parentId || (n as { parentNode?: string }).parentNode))
    const hasHiddenGroup = nodes.some(
      (n) =>
        n.type === 'blockGroup' &&
        ((n.zIndex ?? 0) < 0 || Boolean(n.dragHandle) || (n.style as { pointerEvents?: string } | undefined)?.pointerEvents === 'none')
    )
    if (!hasParented && !hasHiddenGroup) {
      unparentedGroupsRef.current = key // Clean already
      return
    }
    unparentedGroupsRef.current = key
    setNodes((nds) => {
      const groupPos = new Map(
        nds.filter((n) => n.type === 'blockGroup').map((g) => [g.id, g.position])
      )
      return nds.map((n) => {
        if (n.type === 'blockGroup') {
          const { dragHandle: _dh, parentId: _pid, parentNode: _pn, ...rest } = n as Node & {
            dragHandle?: string
            parentNode?: string
          }
          return {
            ...rest,
            draggable: false, // Ring-only move; RF dragItems must never include the group
            selectable: true,
            zIndex: 0, // Visible above the canvas, behind cards
            style: { width: n.style?.width, height: n.style?.height }, // Drop pointerEvents:none
          }
        }
        const pid = n.parentId || (n as { parentNode?: string }).parentNode
        const { parentId: _pid, parentNode: _pn, extent: _ex, ...rest } = n as Node & {
          parentNode?: string
        }
        if (!pid) return { ...rest, zIndex: 1 } // Cards above the dashed frame
        const gp = groupPos.get(pid)
        return {
          ...rest,
          position: { x: n.position.x + (gp?.x ?? 0), y: n.position.y + (gp?.y ?? 0) }, // Rel → abs
          zIndex: 1,
        }
      })
    })
  }, [conversationId, nodes, setNodes])

  // Always keep group frames out of RF dragItems (one-shot above may have already run on an older build)
  useEffect(() => {
    const needs = nodes.some((n) => n.type === 'blockGroup' && n.draggable !== false)
    if (!needs) return
    setNodes((nds) =>
      nds.map((n) => (n.type === 'blockGroup' && n.draggable !== false ? { ...n, draggable: false } : n))
    )
  }, [nodes, setNodes])
  const previewFocus = usePreviewFocus() // Host map: View bar may target a focused preview page
  // Iframe embed: styles arrive via postMessage (no shared React context across frames)
  const [embedStyleOverride, setEmbedStyleOverride] = useState<{
    boardRule: 'wide' | 'college' | 'narrow'
    boardStyle: 'none' | 'dotted' | 'lined' | 'grid'
  } | null>(null)

  useEffect(() => {
    if (!embedded) return
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as {
        type?: string
        boardRule?: string
        boardStyle?: string
      } | null
      if (!data || data.type !== PREVIEW_STYLE_MESSAGE) return
      const rule = data.boardRule
      const style = data.boardStyle
      if (
        (rule === 'wide' || rule === 'college' || rule === 'narrow') &&
        (style === 'none' || style === 'dotted' || style === 'lined' || style === 'grid')
      ) {
        setEmbedStyleOverride({ boardRule: rule, boardStyle: style })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [embedded])

  const boardRule = embedStyleOverride?.boardRule ?? contextBoardRule
  const boardStyle = embedStyleOverride?.boardStyle ?? contextBoardStyle
  const [embedFlowReady, setEmbedFlowReady] = useState(false) // RF onInit fired inside iframe

  // Helper lines hook for snap-to-grid functionality
  const { rebuildIndex, updateHelperLines, HelperLines } = useHelperLines(snapEnabled)
  
  // Helper function to check if a panel is a chat panel (has AI response and is not a flashcard)
  const isChatPanel = useCallback((node: Node<ChatPanelNodeData>): boolean => {
    const hasResponse = !!node.data.responseMessage
    const isFlashcard = node.data.promptMessage?.metadata?.isFlashcard === true
    return hasResponse && !isFlashcard
  }, [])
  
  // Get chronological panels filtered by mode
  const getChronologicalPanels = useCallback((filter: 'chat' | 'all'): Node<ChatPanelNodeData>[] => {
    if (!nodes || !Array.isArray(nodes)) return []
    
    // Filter panels based on mode
    let filteredNodes = nodes.filter(n => n.data.promptMessage?.id) // Only panels with promptMessage (skip freehand)
    
    if (filter === 'chat') {
      filteredNodes = filteredNodes.filter(n => isChatPanel(n as Node<ChatPanelNodeData>))
    }
    
    // Sort by created_at timestamp (most recent last)
    return filteredNodes.sort((a, b) => {
      const aTime = new Date(a.data.promptMessage?.created_at || 0).getTime()
      const bTime = new Date(b.data.promptMessage?.created_at || 0).getTime()
      return aTime - bTime // Oldest first, newest last
    }) as Node<ChatPanelNodeData>[]
  }, [nodes, isChatPanel])
  
  // Get most recent panel based on filter
  const getMostRecentPanel = useCallback((filter: 'chat' | 'all'): Node<ChatPanelNodeData> | null => {
    const panels = getChronologicalPanels(filter)
    return panels.length > 0 ? panels[panels.length - 1] : null
  }, [getChronologicalPanels])

  // Check if a panel is centered above the prompt box
  const isPanelCentered = useCallback((nodeId: string): boolean => {
    if (!reactFlowInstance) return false
    
    const node = nodes?.find(n => n.id === nodeId)
    if (!node) return false
    
    // Find prompt box element
    const chatTextarea = document.querySelector('textarea[placeholder*="Ask"], textarea[placeholder*="Type"], textarea[placeholder*="message"]') as HTMLElement
    const promptBox = chatTextarea?.closest('[class*="pointer-events-auto"]') as HTMLElement
    const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
    
    if (!promptBox || !reactFlowElement) return false
    
    const promptBoxRect = promptBox.getBoundingClientRect()
    const reactFlowRect = reactFlowElement.getBoundingClientRect()
    
    // Calculate prompt box center X position relative to React Flow container
    const promptBoxCenterX = (promptBoxRect.left + promptBoxRect.right) / 2 - reactFlowRect.left
    
    // Get panel position and dimensions
    const panelWidth = node.width || 768 // Default panel width
    const panelX = node.position.x
    const panelCenterX = panelX + panelWidth / 2
    
    // Get current viewport
    const viewport = reactFlowInstance.getViewport()
    
    // Calculate expected viewport X if panel is centered
    // We want: promptBoxCenterX = panelCenterX * viewport.zoom + viewport.x
    // So expected viewport.x = promptBoxCenterX - panelCenterX * viewport.zoom
    const expectedViewportX = promptBoxCenterX - panelCenterX * viewport.zoom
    
    // Calculate expected viewport Y if panel is centered
    const promptBoxTop = promptBoxRect.top - reactFlowRect.top
    const availableHeight = promptBoxTop - 16 // 16px margin from top
    const panelHeight = nodeHeightsRef.current.get(nodeId) || 400 // Default estimate
    const targetPanelTop = 16 + (availableHeight - panelHeight) / 2
    const panelY = node.position.y
    const expectedViewportY = targetPanelTop - panelY * viewport.zoom
    
    // Check if current viewport is close to expected (within 50px threshold)
    const threshold = 50
    const isXCentered = Math.abs(viewport.x - expectedViewportX) < threshold
    const isYCentered = Math.abs(viewport.y - expectedViewportY) < threshold
    const isZoomAt100 = Math.abs(viewport.zoom - 1) < 0.05 // Within 5% of 100% zoom
    
    return isXCentered && isYCentered && isZoomAt100
  }, [reactFlowInstance, nodes])
  
  // Memoized chronological panels list for current filter
  const chronologicalPanels = useMemo(() => {
    return getChronologicalPanels(linearNavMode)
  }, [getChronologicalPanels, linearNavMode])
  
  // Center a panel above the prompt box
  const centerPanelAbovePrompt = useCallback((nodeId: string, resetZoom: boolean = false) => {
    if (!reactFlowInstance) return
    
    // Get fresh node data directly from React Flow instance to avoid stale closure issues
    const currentNodes = reactFlowInstance.getNodes()
    const node = currentNodes.find(n => n.id === nodeId)
    if (!node) {
      console.warn('centerPanelAbovePrompt: Node not found:', nodeId)
      return
    }
    
    // Clear any previous centering flag and set new one
    isCenteringPanelRef.current = false
    requestAnimationFrame(() => {
    isCenteringPanelRef.current = true
    
      // Use multiple requestAnimationFrame calls to ensure DOM is fully ready
      requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // Find prompt box element
      const chatTextarea = document.querySelector('textarea[placeholder*="Ask"], textarea[placeholder*="Type"], textarea[placeholder*="message"]') as HTMLElement
      const promptBox = chatTextarea?.closest('[class*="pointer-events-auto"]') as HTMLElement
      const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
      
      if (!promptBox || !reactFlowElement) {
        isCenteringPanelRef.current = false
        return
      }
      
        // Verify prompt box is visible and has dimensions
      const promptBoxRect = promptBox.getBoundingClientRect()
        if (promptBoxRect.width === 0 || promptBoxRect.height === 0) {
          // Prompt box not ready yet, try again
          setTimeout(() => {
            centerPanelAbovePrompt(nodeId, resetZoom)
          }, 100)
          return
        }
        
      const reactFlowRect = reactFlowElement.getBoundingClientRect()
      
        // Get current viewport
      const viewport = reactFlowInstance.getViewport()
      
      // Use zoom 1 (100%) if resetZoom is true, otherwise preserve current zoom
      const targetZoom = resetZoom ? 1 : viewport.zoom
      const isAt100Percent = Math.abs(targetZoom - 1) < 0.01
      
      const currentPanelX = node.position.x
      const panelWidth = 768
      const panelCenterX = currentPanelX + panelWidth / 2
      let newViewportX: number
      
      if (isAt100Percent) {
        // At 100% zoom: use the push/center logic (same as centerNewPanel/first panel load)
        const mapAreaWidth = reactFlowElement.clientWidth
        const promptBoxMaxWidth = 768
        
        // Calculate left gap same as prompt box (push/center mechanics)
        const expandedSidebarWidth = 256
        const collapsedSidebarWidth = 64
        const minimapWidth = 179
        const minimapMargin = 15
        
        const sidebarElement = document.querySelector('[class*="w-16"], [class*="w-64"]') as HTMLElement
        const isSidebarExpanded = sidebarElement?.classList.contains('w-64') ?? false
        const currentSidebarWidth = isSidebarExpanded ? expandedSidebarWidth : collapsedSidebarWidth
        
        const fullWindowWidth = window.screen.width
        const fullMapAreaWidth = fullWindowWidth - currentSidebarWidth
        const minimapLeftEdge = fullMapAreaWidth - minimapWidth - minimapMargin
        const gapFromSidebarToMinimap = minimapLeftEdge - 0
        const calculatedLeftGap = Math.max(0, (1 / 2) * (gapFromSidebarToMinimap - promptBoxMaxWidth))
        
        // Check if minimap has moved up
        const minimapElement = document.querySelector('.react-flow__minimap') as HTMLElement
        let minimapBottom = 15
        if (minimapElement) {
          const computedStyle = getComputedStyle(minimapElement)
          const bottomValue = computedStyle.bottom
          if (bottomValue && bottomValue !== 'auto') {
            minimapBottom = parseInt(bottomValue) || 15
          }
        }
        const minimapMovedUp = minimapBottom > 15
        const baseRightGap = minimapMovedUp ? 0 : 16
        
        const leftAlignedWidth = Math.min(promptBoxMaxWidth, mapAreaWidth - calculatedLeftGap - baseRightGap)
        const rightGapWhenLeftAligned = mapAreaWidth - calculatedLeftGap - leftAlignedWidth
        
        // Use actual prompt box width from context or default 768px
        const panelWidthToUse = (768 >= contextPanelWidth) ? contextPanelWidth : 768
        
        // Use the EXACT same centering logic as prompt box
        if (rightGapWhenLeftAligned < calculatedLeftGap) {
          // Center the panels
          const screenCenterX = mapAreaWidth / 2
          newViewportX = screenCenterX - (panelWidthToUse / 2) - (currentPanelX * targetZoom)
        } else {
          // Position panels with left gap (pushed)
          newViewportX = calculatedLeftGap - (currentPanelX * targetZoom)
        }
      } else {
        // At other zoom levels: use simple prompt box center approach (works better with animation)
        const promptBoxCenterX = (promptBoxRect.left + promptBoxRect.right) / 2 - reactFlowRect.left
        newViewportX = promptBoxCenterX - panelCenterX * targetZoom
      }
      
      // Calculate Y position to place panel above prompt box
      // Get prompt box top position relative to React Flow container
      const promptBoxTop = promptBoxRect.top - reactFlowRect.top
      // Get available vertical space above prompt box
      const availableHeight = promptBoxTop - 16 // 16px margin from top
      // Get panel height from ref if available, otherwise estimate
      const panelHeight = nodeHeightsRef.current.get(nodeId) || 400 // Default estimate
      // Center panel vertically in available space
      const targetPanelTop = 16 + (availableHeight - panelHeight) / 2
      
      // Calculate new viewport Y to position panel at target
      // Formula: screenY = worldY * zoom + viewportY
      // We want: targetPanelTop = panelY * targetZoom + newViewportY
      // Solving: newViewportY = targetPanelTop - panelY * targetZoom
      const panelY = node.position.y
      const newViewportY = targetPanelTop - panelY * targetZoom
      
      // Validate values before setting viewport
      if (!isFinite(newViewportX) || !isFinite(newViewportY) || !isFinite(targetZoom)) {
        console.error('Invalid viewport values:', { newViewportX, newViewportY, targetZoom })
        isCenteringPanelRef.current = false
        return
      }
      
      // At 100% zoom, React Flow may skip viewport updates if values appear similar
      // Use a tiny imperceptible offset to force update, then animate smoothly to target
      // This ensures the update happens while maintaining smooth animation
      if (isAt100Percent) {
        // Use tiny offset (0.1px) to force React Flow to recognize the change
        // Then immediately animate to target - the offset is so small it's imperceptible
        reactFlowInstance.setViewport({
          x: newViewportX + 0.1,
          y: newViewportY + 0.1,
          zoom: targetZoom,
        }, { duration: 0 })
        
        // Immediately animate to the correct position with smooth animation
        requestAnimationFrame(() => {
          reactFlowInstance.setViewport({
            x: newViewportX,
            y: newViewportY,
            zoom: targetZoom,
          }, { duration: 300 })
        })
      } else {
        // At other zoom levels, simple animated update works well
        reactFlowInstance.setViewport({
          x: newViewportX,
          y: newViewportY,
          zoom: targetZoom,
        }, { duration: 300 })
      }
      
      // Clear flag after animation completes
      setTimeout(() => {
        isCenteringPanelRef.current = false
      }, 350) // Slightly longer than animation duration to ensure it completes
    })
      })
    })
  }, [reactFlowInstance, contextPanelWidth]) // Depends on reactFlowInstance and contextPanelWidth - gets fresh nodes via getNodes()

  // Initialize undo/redo hook for map actions (node drag, add, delete, edge changes)
  // takeSnapshot should be called BEFORE any action that modifies the map
  const { undo: mapUndo, redo: mapRedo, takeSnapshot, canUndo: canMapUndo, canRedo: canMapRedo } = useUndoRedo({
    maxHistorySize: 100, // Keep last 100 snapshots
    enableShortcuts: false, // Disable shortcuts - TipTap handles Ctrl+Z for editor
  })

  // Register undo/redo functions with context so EditorToolbar can access them
  // Updates whenever canUndo/canRedo changes (button disabled states)
  useEffect(() => {
    registerMapUndoRedo({ undo: mapUndo, redo: mapRedo, canUndo: canMapUndo, canRedo: canMapRedo })
  }, [registerMapUndoRedo, mapUndo, mapRedo, canMapUndo, canMapRedo])

  // Register takeSnapshot function with context so other components can trigger snapshots
  useEffect(() => {
    registerMapTakeSnapshot(takeSnapshot)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount - takeSnapshot is stable

  // Update selected nodes when style context changes (toolbar interactions)
  useEffect(() => {
    if (!nodes || nodes.length === 0) return

    setNodes((nds) =>
      nds.map((node) => {
        if (!node.selected) return node
        return {
          ...node,
          data: {
            ...node.data,
            fillColor: fillColor
          },
        }
      })
    )
  }, [fillColor, setNodes]) // Dep on nodes omitted to avoid loop, but using functional update form of setNodes

  // Separate effects for each property to avoid unnecessary updates? 
  // actually, if we use functional setNodes, we don't depend on 'nodes'.

  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => {
        if (!node.selected) return node
        return {
          ...node,
          data: {
            ...node.data,
            borderColor: borderColor
          },
        }
      })
    )
  }, [borderColor, setNodes])

  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => {
        if (!node.selected) return node
        return {
          ...node,
          data: {
            ...node.data,
            borderWeight: borderWeight
          },
        }
      })
    )
  }, [borderWeight, setNodes])

  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => {
        if (!node.selected) return node
        return {
          ...node,
          data: {
            ...node.data,
            borderStyle: borderStyle
          },
        }
      })
    )
  }, [borderStyle, setNodes])


  // Calculate background gap based on rule (at 100% zoom, 1 inch = 96 pixels)
  // Wide: 11/32" = 0.34375" = 33px, College: 9/32" = 0.28125" = 27px, Narrow: 1/4" = 0.25" = 24px
  const backgroundGap = useMemo(() => {
    const ruleGaps = {
      wide: 33,    // 11/32" at 96 DPI
      college: 27, // 9/32" at 96 DPI
      narrow: 24,  // 1/4" at 96 DPI
    }
    return ruleGaps[boardRule]
  }, [boardRule])

  // Determine background variant based on style
  // React Flow: Lines = grid (both horizontal and vertical), Cross = X shapes at intersections
  const backgroundVariant = useMemo(() => {
    if (boardStyle === 'none') return null // No background
    if (boardStyle === 'dotted') return BackgroundVariant.Dots
    if (boardStyle === 'lined') return BackgroundVariant.Lines // Lines variant (shows both horizontal and vertical - grid pattern)
    if (boardStyle === 'grid') return BackgroundVariant.Lines // Grid pattern (both horizontal and vertical lines)
    return null // Default to none
  }, [boardStyle])
  const { setIsMobileMode, isMobileMode, isChatSidebarOpen, toggleChatSidebar, logoDrawing, aiMapDockLiftPx, aiMapDockLeftPx, aiChatHasTranscript } =
    useSidebarContext()
  useChatSidebarViewportAdjust(reactFlowInstance, isChatSidebarOpen && !isMobileMode) // No column shrink on phone dock
  // Phone AI dock lift — Free nav / brand jump above the composer
  const mapChromeBottomPad = isMobileMode && isChatSidebarOpen ? aiMapDockLiftPx : 0
  // Phone AI open: align Free nav (+ minimap chrome) to the chat card’s left edge
  const mapChromeLeft =
    isMobileMode && isChatSidebarOpen && aiMapDockLeftPx != null ? aiMapDockLeftPx : MINIMAP_LEFT
  // Desktop: always board fill (incl. chat open). Phone: white only for input-only chat.
  const freeNavBoardFill =
    isMobileMode && isChatSidebarOpen && !aiChatHasTranscript
      ? 'bg-white dark:bg-[#0f0f0f]'
      : 'bg-gray-50 dark:bg-[#0f0f0f]'
  const originalPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map()) // Store original positions for Linear mode
  const isLinearModeRef = useRef(false) // Track if we're currently in Linear mode

  // Reload top bar preferences when conversationId changes (new board created)
  // Load from localStorage first (instant), then Supabase (sync)
  useEffect(() => {
    if (!conversationId || typeof window === 'undefined') return

    // Load from localStorage first (instant) - ensures UI shows saved prefs immediately
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

    // Then load from Supabase (async) and update if different
    const reloadTopBarPrefs = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('metadata')
            .eq('id', user.id)
            .single()

          if (profile?.metadata) {
            const prefs = profile.metadata as {
              layoutMode?: 'auto' | 'tree' | 'cluster' | 'none'
              lineStyle?: 'solid' | 'dotted'
              arrowDirection?: 'down' | 'up' | 'left' | 'right'
            }

            // Update from Supabase if values exist
            if (prefs.layoutMode && ['auto', 'tree', 'cluster', 'none'].includes(prefs.layoutMode)) {
              setLayoutMode(prefs.layoutMode)
              setIsDeterministicMapping(prefs.layoutMode !== 'none')
              localStorage.setItem('thinktable-layout-mode', prefs.layoutMode)
            }

            if (prefs.lineStyle && ['solid', 'dotted'].includes(prefs.lineStyle)) {
              setLineStyle(prefs.lineStyle)
              localStorage.setItem('thinktable-line-style', prefs.lineStyle)
            }

            if (prefs.arrowDirection && ['down', 'up', 'left', 'right'].includes(prefs.arrowDirection)) {
              setArrowDirection(prefs.arrowDirection)
              localStorage.setItem('thinktable-arrow-direction', prefs.arrowDirection)
            }
          }
        }
      } catch (error) {
        console.error('Error reloading top bar preferences:', error)
      }
    }

    // Reload from Supabase immediately - localStorage already loaded (instant)
    reloadTopBarPrefs()
  }, [conversationId, setLayoutMode, setIsDeterministicMapping, setLineStyle, setArrowDirection])
  const selectedNodeIdRef = useRef<string | null>(null) // Track selected node ID
  // Frame ids that just finished a real move — ignore onNodeClick so drag never selects
  const justDraggedFrameRef = useRef<Set<string>>(new Set())
  // Position at drag-start — distinguish tap (RF fires drag start at threshold 0) from a real move
  const frameDragOriginRef = useRef<{ id: string; x: number; y: number } | null>(null)
  // Track selected node IDs for restoring selection after pane click (when zoom !== 100%)
  const selectedNodeIdsRef = useRef<string[]>([])
  // Track when we're restoring selection from map click (to prevent nav mode exit)
  const isRestoringSelectionRef = useRef(false)
  const prevArrowDirectionRef = useRef<'down' | 'up' | 'left' | 'right'>('down') // Track previous arrow direction
  const supabase = createClient() // Create Supabase client for creating notes
  const queryClient = useQueryClient() // Query client for invalidating queries
  const router = useRouter()
  
  // Handle placeholder click events - create note or flashcard at placeholder position
  useEffect(() => {
    const handleCreateBlockAtPlaceholder = async (event: CustomEvent<{ placeholderId: string }>) => {
      const placeholderId = event.detail.placeholderId
      const placeholderNode = nodes.find(n => n.id === placeholderId)
      if (!placeholderNode || !conversationId) return
      
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        
        // Create note at placeholder position
        const { data: newMessage, error } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversationId,
            user_id: user.id,
            role: 'user',
            content: '',
            metadata: newBlockMetadata({
              position: { x: placeholderNode.position.x, y: placeholderNode.position.y },
            }),
          })
          .select()
          .single()
        
        if (error) {
          console.error('Failed to create note at placeholder:', error)
          return
        }
        
        // Invalidate queries to refresh the board
        await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
        setTimeout(() => {
          queryClient.refetchQueries({ queryKey: ['messages-for-panels', conversationId] })
        }, 200)
      } catch (error) {
        console.error('Error creating note at placeholder:', error)
      }
    }
    
    const handleCreateFlashcardAtPlaceholder = async (event: CustomEvent<{ placeholderId: string }>) => {
      const placeholderId = event.detail.placeholderId
      const placeholderNode = nodes.find(n => n.id === placeholderId)
      if (!placeholderNode || !conversationId) return
      
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        
        // Create flashcard prompt at placeholder position
        const { data: promptMessage, error: promptError } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversationId,
            user_id: user.id,
            role: 'user',
            content: '',
            metadata: { 
              isFlashcard: true,
              position: { x: placeholderNode.position.x, y: placeholderNode.position.y }
            },
          })
          .select()
          .single()
        
        if (promptError) {
          console.error('Failed to create flashcard prompt at placeholder:', promptError)
          return
        }
        
        // Create flashcard response
        const { data: responseMessage, error: responseError } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversationId,
            user_id: user.id,
            role: 'assistant',
            content: '',
          })
          .select()
          .single()
        
        if (responseError) {
          console.error('Failed to create flashcard response at placeholder:', responseError)
          return
        }
        
        // Invalidate queries to refresh the board
        await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
        setTimeout(() => {
          queryClient.refetchQueries({ queryKey: ['messages-for-panels', conversationId] })
        }, 200)
      } catch (error) {
        console.error('Error creating flashcard at placeholder:', error)
      }
    }
    
    // Add event listeners
    window.addEventListener('create-block-at-placeholder', handleCreateBlockAtPlaceholder as EventListener)
    window.addEventListener('create-flashcard-at-placeholder', handleCreateFlashcardAtPlaceholder as EventListener)
    
    // Cleanup
    return () => {
      window.removeEventListener('create-block-at-placeholder', handleCreateBlockAtPlaceholder as EventListener)
      window.removeEventListener('create-flashcard-at-placeholder', handleCreateFlashcardAtPlaceholder as EventListener)
    }
  }, [nodes, conversationId, supabase, queryClient])

  // Track selected node IDs for restoring selection after pane click (when zoom !== 100%)
  useEffect(() => {
    const selectedIds = nodes.filter(n => n.selected).map(n => n.id)
    if (selectedIds.length > 0) {
      selectedNodeIdsRef.current = selectedIds
    } else {
      // Clear ref when no nodes are selected (but only if not restoring)
      if (!isRestoringSelectionRef.current) {
        selectedNodeIdsRef.current = []
      }
    }
  }, [nodes])

  const prevViewportWidthRef = useRef<number>(0) // Track previous viewport width to detect changes
  const [isAtBottom, setIsAtBottom] = useState(true) // Track if scrolled to bottom in linear mode
  const [minimapBottom, setMinimapBottom] = useState<number>(MINIMAP_BOTTOM) // Legacy hover-zone jump checks
  const [minimapLeft, setMinimapLeft] = useState<number>(MINIMAP_LEFT)
  const [navBottomTransition, setNavBottomTransition] = useState(false) // Gate bottom animation until after load settle
  const boardRootRef = useRef<HTMLDivElement>(null) // Map column box — chrome is absolute on this (outside RF)
  // Sync from localStorage on first client render so nav bottom isn't wrong before effects run
  const [isMinimapHidden, setIsMinimapHidden] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('thinktable-minimap-hidden') === 'true'
  })
  // Phone AI dock open (= Free nav "jumped"): minimap auto-closes but can still be peeked / pinned
  const phoneAiOpen = isMobileMode && isChatSidebarOpen
  const [aiDockMinimapOpen, setAiDockMinimapOpen] = useState(false) // Visible while jumped
  const [aiDockMinimapPinned, setAiDockMinimapPinned] = useState(false) // Click-to-keep-open (no auto-close)
  const aiDockMinimapPinnedRef = useRef(false) // Latest pin for leave-timeout (avoid stale close)
  // Collapse = preference hidden, OR jumped without an active peek/pin
  const minimapCollapsed = phoneAiOpen ? !aiDockMinimapOpen : isMinimapHidden
  const [isScrollingToBottom, setIsScrollingToBottom] = useState(false) // Track if we're currently scrolling to bottom (for minimap flash prevention)
  const [minimapLoadReady, setMinimapLoadReady] = useState(false) // Stay clipped until frames + prefs have landed
  const [boardLoadPhase, setBoardLoadPhase] = useState<'cold' | 'reveal' | 'done'>('cold') // Crossfade shells → contents once
  const boardLoadPhaseRef = useRef(boardLoadPhase) // Panel merge reads phase without adding it to effect deps
  boardLoadPhaseRef.current = boardLoadPhase
  const minimapExpanded = minimapLoadReady && !minimapCollapsed && !isScrollingToBottom // One flag for +/- and the height tween
  const [clickedEdge, setClickedEdge] = useState<Edge | null>(null) // Track clicked edge for popup (local state for popup logic)

  // Sync clickedEdge to context so toolbar can access it
  useEffect(() => {
    if (clickedEdge) {
      // Update context with minimal edge info (id, source, target)
      setContextClickedEdge({ id: clickedEdge.id, source: clickedEdge.source, target: clickedEdge.target })
    } else {
      setContextClickedEdge(null)
    }
  }, [clickedEdge, setContextClickedEdge])
  const [edgePopupPosition, setEdgePopupPosition] = useState({ x: 0, y: 0 }) // Position for edge popup
  const [rightClickedNode, setRightClickedNode] = useState<Node<ChatPanelNodeData> | null>(null) // Track right-clicked node for popup
  const [nodePopupPosition, setNodePopupPosition] = useState({ x: 0, y: 0 }) // Position for node popup
  const [boardMenuPosition, setBoardMenuPosition] = useState<{ x: number; y: number } | null>(null) // Empty-board right-click menu
  const boardClickFlowRef = useRef<{ x: number; y: number } | null>(null) // Flow coords for Add frame / zoom-to-100%
  const nodesRef = useRef(nodes) // Long-press lookups without stale closures
  nodesRef.current = nodes
  const longPressRef = useRef<ReturnType<typeof createLongPressController> | null>(null) // Phone long-press controller

  // Keep the target block highlighted while its actions menu is open
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('block-actions-highlight', {
        detail: { nodeId: rightClickedNode?.id ?? null },
      })
    )
  }, [rightClickedNode])
  // (Empty-page click places an I-bar + grip; typing / grip creates the block — no Item/Flashcard menu)
  const [isMinimapManuallyHidden, setIsMinimapManuallyHidden] = useState(false) // Track if minimap was manually hidden (vs auto-hidden)
  const [isMinimapHovering, setIsMinimapHovering] = useState(false) // Track if mouse is hovering over minimap area
  // Minimap visibility mode: 'shown' | 'hidden' | 'hover'
  // Use useUserPreference hook for Supabase persistence, default to 'shown'
  const supabaseForMinimap = createClient() // Create Supabase client for useUserPreference
  const { mode: minimapMode, setMode: setMinimapMode, isLoading: isLoadingMinimapMode } = useUserPreference(supabaseForMinimap, 'minimapMode', 'shown')
  const [minimapContextMenuPosition, setMinimapContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [isBottomGapHovering, setIsBottomGapHovering] = useState(false) // Track if hovering over bottom gap (shared with prompt pill)
  const isMinimapHoveringRef = useRef(false) // Ref to track hover state for reliable checking in timeouts
  const minimapHideTimeoutRef = useRef<NodeJS.Timeout | null>(null) // Track hide timeout for minimap
  const wasAboveThresholdRef = useRef(true) // Track if we were above auto-hide threshold
  const wasAutoHiddenRef = useRef(false) // Track if minimap was auto-hidden (vs manually hidden while shrunken)
  const fitViewInProgressRef = useRef(false) // Track when fitView is in progress to prevent onMove interference
  const savedZoomRef = useRef<{ linear: number | null; canvas: number | null }>({ linear: null, canvas: null }) // Store zoom for each mode
  const selectionJustChangedRef = useRef(false) // Track if selection just changed to prevent viewport jumps
  const previousViewportYRef = useRef<number | null>(null) // Track previous viewport Y to detect jumps
  const viewportUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null) // Throttle viewport updates for button visibility

  // Listen for bottom gap hover events (dispatched by prompt input hover zone)
  useEffect(() => {
    const handleBottomGapHover = (event: CustomEvent<{ hovering: boolean }>) => {
      setIsBottomGapHovering(event.detail.hovering)
    }

    window.addEventListener('bottom-gap-hover', handleBottomGapHover as EventListener)

    return () => {
      window.removeEventListener('bottom-gap-hover', handleBottomGapHover as EventListener)
    }
  }, [])

  // Listen for fit view events from toolbar to set fitViewInProgressRef flag
  useEffect(() => {
    const handleFitViewStart = () => {
      fitViewInProgressRef.current = true
    }

    const handleFitViewEnd = () => {
      fitViewInProgressRef.current = false
    }

    window.addEventListener('fit-view-start', handleFitViewStart)
    window.addEventListener('fit-view-end', handleFitViewEnd)

    return () => {
      window.removeEventListener('fit-view-start', handleFitViewStart)
      window.removeEventListener('fit-view-end', handleFitViewEnd)
    }
  }, [])

  // Share setNodes with context for toolbar access (lock button)
  // Note: setNodes from useNodesState is stable, so this should only run once on mount
  useEffect(() => {
    registerSetNodes(setNodes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount - setNodes and registerSetNodes are stable

  // Update all nodes when lock state changes (but not when nodes change from other sources)
  // This matches React Flow's Controls lock button behavior
  const prevIsLockedRef = useRef(isLocked)
  const prevViewModeRef = useRef(viewMode)
  useEffect(() => {
    // Only update if lock state or viewMode actually changed
    if (prevIsLockedRef.current === isLocked && prevViewModeRef.current === viewMode) {
      return
    }

    // Safety check: ensure nodes is defined and is an array
    if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
      prevIsLockedRef.current = isLocked
      prevViewModeRef.current = viewMode
      return
    }

    // Determine target draggable state based on lock
    // Global isLocked freezes everything; else honor per-frame boardLocked pin
    const needsUpdate = nodes.some((node) => {
      if (node.type === 'blockGroup') return false // Groups stay ring-only
      const meta = (node.data?.promptMessage?.metadata || {}) as Record<string, unknown>
      const pinned = meta.boardLocked === true
      const wantDrag = isLocked ? false : !pinned
      const wantConnect = isLocked ? false : true
      return node.draggable !== wantDrag || node.connectable !== wantConnect
    })

    // Only update if nodes need to change (prevents unnecessary re-renders and potential loops)
    if (needsUpdate) {
      setNodes(
        nodes.map((node) => {
          if (node.type === 'blockGroup') {
            return { ...node, draggable: false, connectable: false }
          }
          const meta = (node.data?.promptMessage?.metadata || {}) as Record<string, unknown>
          const pinned = meta.boardLocked === true
          return {
            ...node,
            draggable: isLocked ? false : !pinned,
            connectable: isLocked ? false : true,
          }
        })
      )
    }

    prevIsLockedRef.current = isLocked
    prevViewModeRef.current = viewMode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocked, viewMode]) // Only depend on lock state and viewMode (not nodes or setNodes to avoid infinite loops)
  const wasAtBottomRef = useRef(true) // Track if user was at bottom before new messages
  const prevMessagesLengthRef = useRef(0) // Track previous message count
  const prevZoomRef = useRef<number>(1) // Track previous zoom level to detect zoom changes
  const isSwitchingToLinearRef = useRef(false) // Track if we're currently switching to Linear mode
  const isZoomingTo100Ref = useRef(false) // Track if we're currently zooming to 100% on click
  const isScrollingToBottomRef = useRef(false) // Track if we're currently scrolling to bottom
  const isCenteringPanelRef = useRef(false) // Track if we're currently centering a panel to prevent onMove interference
  const preferencesLoadedRef = useRef(false) // Track if preferences have been loaded from Supabase
  const nodeHeightsRef = useRef<Map<string, number>>(new Map()) // Store measured node heights
  const savePositionsTimeoutRef = useRef<NodeJS.Timeout | null>(null) // Debounce position saves
  const minimapDragStartRef = useRef<{ x: number; y: number; isDragging?: boolean } | null>(null) // Track minimap drag start position and drag state
  const edgePopupZoomRef = useRef<number | null>(null) // Track zoom when popup was opened
  const edgeClickPositionRef = useRef<{ x: number; y: number } | null>(null) // Store click position in flow coordinates
  const threadStyleClipboardRef = useRef<{
    algorithm: ThreadAlgorithm
    dotted: boolean
    strokeWidth: number
  } | null>(null) // Copy style / Paste style payload
  const [hasThreadStyleClipboard, setHasThreadStyleClipboard] = useState(false) // Enables Paste style row
  const nodePopupZoomRef = useRef<number | null>(null) // Track zoom when node popup was opened
  const nodeClickPositionRef = useRef<{ x: number; y: number } | null>(null) // Store click position in flow coordinates
  const scrollAccumulatorRef = useRef<number>(0) // Accumulate scroll delta for controlled navigation
  const lastScrollDirectionRef = useRef<'up' | 'down' | null>(null) // Track last scroll direction to reset accumulator on direction change

  // Load user preferences from localStorage only (profiles.metadata column doesn't exist yet)
  // TODO: Add profiles.metadata column via migration if needed for cross-device sync
  useEffect(() => {
    // Preferences are already loaded from localStorage in useState initializers
    // This effect is kept for future Supabase sync if metadata column is added
    preferencesLoadedRef.current = true
  }, [])

  // Save preferences to localStorage (instant) and Supabase (sync) when they change
  useEffect(() => {
    if (!preferencesLoadedRef.current) return // Don't save before loading
    if (typeof window === 'undefined') return

    // Save to localStorage immediately (lightweight, instant)
    localStorage.setItem('thinktable-view-mode', viewMode)
    localStorage.setItem('thinktable-scroll-mode', String(isScrollMode))

    // Save to Supabase in background (for cross-device sync)
    const saveToSupabase = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          // Get existing metadata to merge
          const { data: profile } = await supabase
            .from('profiles')
            .select('metadata')
            .eq('id', user.id)
            .single()

          const existingMetadata = profile?.metadata || {}

          // Update metadata with new preferences
          await supabase
            .from('profiles')
            .update({
              metadata: { ...existingMetadata, viewMode, isScrollMode },
            })
            .eq('id', user.id)
        }
      } catch (error) {
        console.error('Error saving preferences to Supabase:', error)
      }
    }

    saveToSupabase()
  }, [viewMode, isScrollMode])

  useEffect(() => {
    setScrollMode(isScrollMode) // Phone two-finger: Scroll nav pans like trackpad; Zoom nav pinches
  }, [isScrollMode, setScrollMode])

  // Save minimap visibility to localStorage and Supabase when it changes
  useEffect(() => {
    if (!preferencesLoadedRef.current) return // Don't save before loading
    if (typeof window === 'undefined') return

    // Save to localStorage immediately
    localStorage.setItem('thinktable-minimap-hidden', String(isMinimapHidden))
  }, [isMinimapHidden])

  // Sync minimap visibility with mode (only after loading is complete)
  useEffect(() => {
    if (isLoadingMinimapMode) return // Don't apply mode while loading

    // Apply mode
    if (minimapMode === 'shown') {
      // Always show
      setIsMinimapHidden(false)
      setIsMinimapManuallyHidden(false)
      wasAutoHiddenRef.current = false
    } else if (minimapMode === 'hidden') {
      // Always hide
      setIsMinimapHidden(true)
      setIsMinimapManuallyHidden(true)
      wasAutoHiddenRef.current = false
    } else {
      // Hover mode - reset to default hover behavior (minimap hidden, shown on hover)
      setIsMinimapHidden(true)
      setIsMinimapManuallyHidden(false)
      wasAutoHiddenRef.current = false
    }
  }, [minimapMode, isLoadingMinimapMode])

  // Phone AI open: reset minimap peek/pin so it auto-closes when the dock jumps
  useEffect(() => {
    if (phoneAiOpen) {
      setAiDockMinimapOpen(false)
      setAiDockMinimapPinned(false)
      aiDockMinimapPinnedRef.current = false
      return
    }
    // Chat closed on phone: restore minimap if preference is shown (don't leave it stuck collapsed)
    if (isMobileMode && minimapMode === 'shown') {
      setIsMinimapHidden(false)
      setIsMinimapManuallyHidden(false)
      wasAutoHiddenRef.current = false
    }
  }, [phoneAiOpen, isMobileMode, minimapMode])

  useEffect(() => {
    aiDockMinimapPinnedRef.current = aiDockMinimapPinned
  }, [aiDockMinimapPinned])

  // Keep ref in sync with state
  useEffect(() => {
    isMinimapHoveringRef.current = isMinimapHovering
  }, [isMinimapHovering])

  // Keep ref in sync with state
  useEffect(() => {
    isMinimapHoveringRef.current = isMinimapHovering
  }, [isMinimapHovering])

  // Auto-hide only for phone+chat hover-leave of an unpinned peek (open is click-only — no hover-to-open)
  const checkAndHideMinimap = useCallback((relatedTarget?: HTMLElement | null) => {
    // Phone + chat: auto-close unpinned peek when leaving the cluster
    if (phoneAiOpen) {
      if (aiDockMinimapPinned) return
      if (minimapHideTimeoutRef.current) {
        clearTimeout(minimapHideTimeoutRef.current)
        minimapHideTimeoutRef.current = null
      }
      if (relatedTarget && relatedTarget instanceof HTMLElement) {
        const minimapElement = relatedTarget.closest('[data-minimap-context]')
        const toggleElement = relatedTarget.closest('[data-minimap-toggle-context]')
        const pillElement = relatedTarget.closest('[data-minimap-pill-context]')
        if (minimapElement || toggleElement || pillElement) return
      }
      minimapHideTimeoutRef.current = setTimeout(() => {
        if (!isMinimapHoveringRef.current && !aiDockMinimapPinnedRef.current) {
          setAiDockMinimapOpen(false)
        }
      }, 200)
      return
    }

    // Desktop: no hover-to-open — nothing to auto-hide on leave (click pins 'shown' / 'hidden')
    if (minimapHideTimeoutRef.current) {
      clearTimeout(minimapHideTimeoutRef.current)
      minimapHideTimeoutRef.current = null
    }
  }, [phoneAiOpen, aiDockMinimapPinned])

  // Close context menu when clicking outside
  useEffect(() => {
    if (!minimapContextMenuPosition) return

    const handleClick = () => {
      setMinimapContextMenuPosition(null)
    }

    const handleContextMenu = (e: MouseEvent) => {
      // Close if right-clicking elsewhere (keep open when re-clicking map chrome or the menu)
      const target = e.target as HTMLElement
      if (
        !target.closest('[data-minimap-context]') &&
        !target.closest('[data-minimap-pill-context]') &&
        !target.closest('[data-minimap-toggle-context]') &&
        !target.closest('[data-map-menu]')
      ) {
        setMinimapContextMenuPosition(null)
      }
    }

    document.addEventListener('click', handleClick)
    document.addEventListener('contextmenu', handleContextMenu)

    return () => {
      document.removeEventListener('click', handleClick)
      document.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [minimapContextMenuPosition])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (minimapHideTimeoutRef.current) {
        clearTimeout(minimapHideTimeoutRef.current)
      }
    }
  }, [])

  // Fetch messages if conversationId is provided
  const {
    data: messages = [],
    refetch: refetchMessages,
    isPending: isMessagesPending,
  } = useQuery({
    // Embed uses lean fetch; still share cache with full board when possible for instant paint
    queryKey: ['messages-for-panels', conversationId, embedded ? 'embed' : 'full'],
    queryFn: () =>
      conversationId
        ? fetchMessagesForPanels(conversationId, { embed: embedded })
        : Promise.resolve([]),
    enabled: !!conversationId,
    // No interval poll — Realtime + explicit invalidate/refetch keep frames fresh without re-downloading HTML 2×/s
    refetchInterval: false,
    refetchOnWindowFocus: !embedded,
    refetchOnMount: !embedded, // Embed: avoid remount refetch if keep-alive already loaded
    refetchOnReconnect: !embedded,
    placeholderData: (previousData) => {
      if (!conversationId) return previousData
      // Prefer same-mode cache, then full-board cache (user may have opened the page already)
      const embedCached = queryClient.getQueryData([
        'messages-for-panels',
        conversationId,
        'embed',
      ])
      if (embedCached) return embedCached as Message[]
      const fullCached = queryClient.getQueryData([
        'messages-for-panels',
        conversationId,
        'full',
      ])
      if (fullCached) return fullCached as Message[]
      // Legacy key (pre embed/full split)
      const legacy = queryClient.getQueryData(['messages-for-panels', conversationId])
      if (legacy) return legacy as Message[]
      return previousData
    },
  })

  // Cold load: paint shimmer shells at last-visit positions so fitView has real places to focus
  useEffect(() => {
    if (!conversationId || !isMessagesPending || messages.length > 0) return
    const layout = readFrameLayoutCache(conversationId)
    const entries = Object.entries(layout)
    if (entries.length === 0) return // First visit — nothing to place until messages arrive
    setNodes(
      entries.map(([id, entry]) => ({
        id: frameShimmerNodeId(id), // Distinct from chatPanel id so both can overlap during the fade
        type: 'frameShimmer' as const,
        className: 'tt-frame-shimmer-node', // CSS targets this wrapper for fade-out
        zIndex: 1000, // Sit above the real frame while dissolving
        position: { x: entry.x, y: entry.y },
        data: {
          frameId: id, // Real message / frame id (layout cache key)
          width: entry.width,
          height: entry.height,
          hasText: entry.hasText,
          barCount: entry.barCount,
        },
        draggable: false,
        selectable: false,
        // Exact cached box — same AABB as the real frame (no 220/120 floor that shifts the shell)
        style: {
          width: entry.width && entry.width > 0 ? entry.width : 220,
          height: entry.height && entry.height > 0 ? entry.height : 72,
        },
        width: entry.width && entry.width > 0 ? entry.width : 220,
        height: entry.height && entry.height > 0 ? entry.height : 72,
      }))
    )
  }, [conversationId, isMessagesPending, messages.length, setNodes])

  useEffect(() => {
    setBoardLoadPhase('cold') // New board — wait for this load’s crossfade
  }, [conversationId])

  useEffect(() => {
    if (!conversationId || isMessagesPending) return // Still fetching
    if (messages.length === 0 && boardLoadPhase === 'cold') {
      setBoardLoadPhase('done') // Empty board has no shells or contents to fade
    }
  }, [conversationId, isMessagesPending, messages.length, boardLoadPhase])

  useEffect(() => {
    if (boardLoadPhase !== 'reveal') return // Only after panels have mounted under the shells
    const t = window.setTimeout(() => {
      setNodes((nds) => nds.filter((n) => n.type !== 'frameShimmer')) // Shells finished fading
      setBoardLoadPhase('done')
    }, BOARD_LOAD_FADE_MS)
    return () => window.clearTimeout(t)
  }, [boardLoadPhase, setNodes])

  const hasFrameShimmer = (nodes || []).some((n) => n.type === 'frameShimmer') // Load shells still on the board
  const hasRealMapNodes = (nodes || []).some((n) => n.type !== 'frameShimmer' && n.type !== 'placeholder') // Frames/drawings MiniMap can paint
  // Clip the minimap until prefs + frames are in, then expand-up (same tween as +/-)
  useEffect(() => {
    if (embedded || minimapLoadReady) return // Embeds have no minimap; only arm once
    if (isLoadingMinimapMode) return // Don't expand until shown/hidden/hover is known
    if (!reactFlowInstance) return // MiniMap needs the RF store
    if (conversationId && isMessagesPending) return // Wait for this board's frames
    if (hasFrameShimmer) return // Don't reveal over placeholder silhouettes
    if (conversationId && messages.length > 0 && !hasRealMapNodes) return // Wait until panels replace the fetch
    let cancelled = false // Drop the rAF if a later load gate fails
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) setMinimapLoadReady(true) // Two frames so MiniMap SVG can paint while clipped
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(id)
    }
  }, [embedded, minimapLoadReady, isLoadingMinimapMode, reactFlowInstance, conversationId, isMessagesPending, hasFrameShimmer, hasRealMapNodes, messages.length])

  // Refetch frames when AI edit session saves/discards/applies pending
  useEffect(() => {
    const onMutated = (event: Event) => {
      const detail = (event as CustomEvent<{
        contentUpdates?: Array<{ messageId: string; content: string }>
      }>).detail
      // Optimistic patch so Save isn't wiped by a stale refetch racing the DB write
      if (detail?.contentUpdates?.length) {
        const map = new Map(detail.contentUpdates.map((u) => [u.messageId, u.content]))
        const patch = (old: unknown) => {
          if (!Array.isArray(old)) return old
          return old.map((m: { id?: string; content?: string }) =>
            m?.id && map.has(m.id) ? { ...m, content: map.get(m.id) } : m
          )
        }
        queryClient.setQueriesData({ queryKey: ['messages-for-panels', conversationId] }, patch)
        queryClient.setQueriesData({ queryKey: ['messages-for-panels', conversationId, 'full'] }, patch)
        queryClient.setQueriesData({ queryKey: ['messages-for-panels', conversationId, 'embed'] }, patch)
      }
      void refetchMessages()
      // create_thread inserts / create_frame discard cascades edges
      void queryClient.invalidateQueries({ queryKey: ['panel-edges', conversationId] })
    }
    window.addEventListener('ai-edits-mutated', onMutated)
    return () => window.removeEventListener('ai-edits-mutated', onMutated)
  }, [refetchMessages, queryClient, conversationId])

  // Nest frame between TipTap blocks / stack behind on 4-side drop (after refetch + snapshot exist)
  const {
    dropUi: frameNestStackUi,
    onNodeDrag: onFrameNestStackDrag,
    onNodeDragStart: onFrameNestStackDragStart,
    onNodeDragStop: onFrameNestStackDragStop,
  } = useFrameNestStackDrag({
    conversationId,
    getNodes: () => reactFlowInstance.getNodes(),
    setNodes,
    isLocked,
    takeSnapshot,
    refetchMessages: () => {
      void refetchMessages()
    },
  })

  // Signal host as soon as RF can pan/zoom — don’t wait on messages (that delayed the veil)
  useEffect(() => {
    if (!embedded || !conversationId || !embedFlowReady) return
    if (typeof window === 'undefined' || window.parent === window) return
    const id = window.requestAnimationFrame(() => {
      window.parent.postMessage(
        { type: PREVIEW_READY_MESSAGE, pageId: conversationId },
        window.location.origin
      )
    })
    return () => window.cancelAnimationFrame(id)
  }, [embedded, conversationId, embedFlowReady])

  // Embed: keep RF pane sized to the iframe. Host zoom scales the portaled shell via CSS —
  // do NOT fitView on every resize message (that made nested items jump while zooming).
  useEffect(() => {
    if (!embedded) return
    let lastW = 0
    let lastH = 0
    const remasure = (forceFit: boolean) => {
      const el =
        (document.querySelector('#tt-embed-root .react-flow') as HTMLElement | null) ||
        (document.querySelector('.react-flow') as HTMLElement | null)
      if (!el) return
      // Prefer layout size (stable under parent CSS scale) over getBoundingClientRect
      const w = Math.round(el.clientWidth || el.getBoundingClientRect().width)
      const h = Math.round(el.clientHeight || el.getBoundingClientRect().height)
      if (w < 16 || h < 16) return
      const grewFromEmpty = lastW < 16 || lastH < 16
      const sizeChanged = Math.abs(w - lastW) > 2 || Math.abs(h - lastH) > 2
      lastW = w
      lastH = h
      if (!forceFit && !grewFromEmpty && !sizeChanged) return
      const prev = rfStore.getState()
      if (prev.width !== w || prev.height !== h) {
        rfStore.setState({ width: w, height: h })
      }
      window.dispatchEvent(new Event('resize'))
      if (forceFit || grewFromEmpty) {
        reactFlowInstance.fitView({ padding: 0.15, minZoom: 0.2, maxZoom: 1.5 })
      }
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as { type?: string; fit?: boolean } | null
      if (!data || data.type !== PREVIEW_RESIZE_MESSAGE) return
      const shouldFit = data.fit === true
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => remasure(shouldFit))
      })
    }
    window.addEventListener('message', onMessage)
    // ResizeObserver: update pane metrics only — never fitView (avoids zoom jitter)
    const ro = new ResizeObserver(() => remasure(false))
    const root = document.getElementById('tt-embed-root') || document.documentElement
    ro.observe(root)
    remasure(true)
    const t1 = window.setTimeout(() => remasure(true), 50)
    const t2 = window.setTimeout(() => remasure(true), 250)
    return () => {
      window.removeEventListener('message', onMessage)
      ro.disconnect()
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [embedded, reactFlowInstance, rfStore])

  // Fetch edges (connections) for the conversation - lightweight query
  const { data: savedEdges = [], refetch: refetchEdges } = useQuery({
    queryKey: ['panel-edges', conversationId],
    queryFn: () => conversationId ? fetchEdgesForConversation(conversationId) : Promise.resolve([]),
    enabled: !!conversationId,
    refetchOnWindowFocus: !embedded,
    refetchOnMount: true,
    refetchOnReconnect: !embedded,
  })

  // Fetch canvas nodes (freehand drawings, etc.) for the conversation
  const { data: savedCanvasNodes = [], refetch: refetchCanvasNodes } = useQuery({
    queryKey: ['canvas-nodes', conversationId],
    queryFn: () => conversationId ? fetchCanvasNodesForConversation(conversationId) : Promise.resolve([]),
    enabled: !!conversationId,
    refetchOnWindowFocus: !embedded,
    refetchOnMount: true,
    refetchOnReconnect: !embedded,
  })

  // Retry failed canvas node saves when conversation loads or comes back online
  useEffect(() => {
    if (!conversationId) return
    
    // Retry immediately when conversation loads
    retryFailedSaves(conversationId)
    
    // Retry when coming back online
    const handleOnline = () => {
      console.log('🎨 Network back online, retrying failed saves')
      retryFailedSaves(conversationId)
    }
    
    window.addEventListener('online', handleOnline)
    
    return () => {
      window.removeEventListener('online', handleOnline)
    }
  }, [conversationId])

  // Retry failed saves after canvas nodes are successfully loaded
  useEffect(() => {
    if (conversationId && savedCanvasNodes.length >= 0) {
      // Small delay to ensure save operations have completed
      const timer = setTimeout(() => {
        retryFailedSaves(conversationId)
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [conversationId, savedCanvasNodes])

  // After Notion OAuth import: refresh panels, fit the map, clean query params
  useEffect(() => {
    if (!searchParams || searchParams.get('notion') !== 'connected') return // Only run on successful connect landing
    const imported = searchParams.get('imported') // Optional count for logging
    console.log('📥 Notion connected', { imported, conversationId })

    const run = async () => {
      if (conversationId) {
        await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] }) // Pull new note nodes
        await queryClient.refetchQueries({ queryKey: ['messages-for-panels', conversationId] })
      }
      // Fit after panels paint
      window.setTimeout(() => {
        if (reactFlowInstance) {
          window.dispatchEvent(new CustomEvent('fit-view-start'))
          reactFlowInstance.fitView({ padding: 0.2, minZoom: 0.1, maxZoom: 1, duration: 300 })
          window.setTimeout(() => window.dispatchEvent(new CustomEvent('fit-view-end')), 350)
        }
      }, 500)
      // Strip OAuth feedback params without a full navigation
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href)
        url.searchParams.delete('notion')
        url.searchParams.delete('imported')
        window.history.replaceState({}, '', url.pathname + url.search)
      }
    }
    void run()
  }, [searchParams, conversationId, queryClient, reactFlowInstance])

  // Check if board has flashcards - check messages for isFlashcard metadata
  const hasFlashcardsInBoard = useMemo(() => {
    if (!messages || messages.length === 0) return false
    return messages.some((msg) => {
      if (msg.role !== 'user') return false
      const metadata = (msg.metadata as Record<string, any>) || {}
      return metadata.isFlashcard === true
    })
  }, [messages])

  // Fetch project_id from board metadata
  const { data: boardProjectId } = useQuery({
    queryKey: ['board-project-id', conversationId],
    queryFn: async () => {
      if (!conversationId) return null
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null
      const { data, error } = await supabase
        .from('conversations')
        .select('metadata')
        .eq('id', conversationId)
        .single()
      if (error || !data?.metadata) return null
      const metadata = data.metadata as Record<string, any>
      return metadata.project_id || null
    },
    enabled: !!conversationId,
  })

  // Check if project has flashcards in any board
  const { data: hasFlashcardsInProject = false } = useQuery({
    queryKey: ['project-flashcards', boardProjectId],
    queryFn: async () => {
      if (!boardProjectId) return false
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return false
      const { data: projectBoards, error: boardsError } = await supabase
        .from('conversations')
        .select('id')
        .eq('user_id', user.id)
        .contains('metadata', { project_id: boardProjectId })
      if (boardsError || !projectBoards || projectBoards.length === 0) return false
      const boardIds = projectBoards.map(b => b.id)
      const { data: allMessages, error: messagesError } = await supabase
        .from('messages')
        .select('id, role, metadata')
        .eq('user_id', user.id)
        .in('conversation_id', boardIds)
      if (messagesError || !allMessages || allMessages.length === 0) return false
      return allMessages.some((msg) => {
        if (msg.role !== 'user') return false
        const metadata = (msg.metadata as Record<string, any>) || {}
        return metadata.isFlashcard === true
      })
    },
    enabled: !!boardProjectId,
  })

  // Determine if menu should be shown - show if board has flashcards OR project has flashcards
  const shouldShowMenu = hasFlashcardsInBoard || hasFlashcardsInProject

  // Gate nav bottom transition after mount — prefs flipping isMinimapHidden would animate from wrong spot
  useEffect(() => {
    setMinimapLeft(MINIMAP_LEFT)
    const t = window.setTimeout(() => setNavBottomTransition(true), 400)
    return () => window.clearTimeout(t)
  }, [])

  // Mobile mode for narrow viewports (phone layout). Do NOT auto-hide minimap here —
  // minimap only auto-hides when phone chat opens (phoneAiOpen / aiDock peek).
  useEffect(() => {
    const MINIMAP_AUTO_HIDE_THRESHOLD = 900 // Same width as phone / mobile layout

    const checkMobileMode = () => {
      const windowWidth = window.innerWidth
      const isAboveThreshold = windowWidth >= MINIMAP_AUTO_HIDE_THRESHOLD
      const wasAbove = wasAboveThresholdRef.current

      if (!isAboveThreshold && wasAbove) {
        setIsMobileMode(true) // Enter phone layout — keep minimap visibility as-is
      } else if (isAboveThreshold && !wasAbove) {
        // Leaving phone width: restore minimap if it was only width-auto-hidden historically
        if (isMinimapHidden && (wasAutoHiddenRef.current || !isMinimapManuallyHidden)) {
          setIsMinimapHidden(false)
          wasAutoHiddenRef.current = false
        }
        setIsMobileMode(false)
      }

      wasAboveThresholdRef.current = isAboveThreshold
    }

    // Initial check - set both ref and mobile mode state (no minimap hide)
    const initialAboveThreshold = window.innerWidth >= MINIMAP_AUTO_HIDE_THRESHOLD
    wasAboveThresholdRef.current = initialAboveThreshold
    setIsMobileMode(!initialAboveThreshold)

    window.addEventListener('resize', checkMobileMode)

    return () => {
      window.removeEventListener('resize', checkMobileMode)
    }
  }, [isMinimapHidden, isMinimapManuallyHidden, setIsMobileMode])

  // Handle minimap click for fitView - clicking anywhere on minimap triggers fit view (same as Controls frame button)
  // Uses the same fitViewOptions as defined in ReactFlow props
  // We need to attach listeners directly to the minimap DOM element after React Flow renders it
  useEffect(() => {
    if (messages.length === 0 || !reactFlowInstance || !minimapExpanded) return

    let minimapElement: HTMLElement | null = null
    let cleanup: (() => void) | null = null

    // Function to attach listeners to minimap element
    const attachListeners = () => {
      // Find the minimap element - React Flow renders it with class 'react-flow__minimap'
      minimapElement = document.querySelector('.react-flow__minimap') as HTMLElement

      if (!minimapElement) {
        return false
      }

      let clickTimeoutId: NodeJS.Timeout | null = null

      const handleMouseDown = (e: MouseEvent) => {
        // Only process if the click is on the minimap element or its children
        const target = e.target as HTMLElement
        if (!minimapElement || !minimapElement.contains(target)) return

        // Don't process right-clicks (button 2) - allow context menu to work
        if (e.button === 2) {
          return
        }

        // Clear any existing timeout
        if (clickTimeoutId) {
          clearTimeout(clickTimeoutId)
          clickTimeoutId = null
        }

        // Record the starting position for click vs drag detection
        minimapDragStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          isDragging: false // Initialize as not dragging
        }

        // Fallback: If mouseup doesn't fire within 200ms, trigger centering anyway
        // This handles cases where React Flow prevents mouseup from reaching our handler
        clickTimeoutId = setTimeout(() => {
          if (minimapDragStartRef.current && !minimapDragStartRef.current.isDragging) {
            // Use the same centering logic as handleMouseUp
            // For fallback, we'll just do fitView since we don't have the exact click position
            if (reactFlowInstance) {
              fitViewInProgressRef.current = true

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
                const reactFlowRect = reactFlowElement!.getBoundingClientRect()
                const inputBoxHeight = reactFlowRect.bottom - inputBoxRect.top + 16
                const reactFlowHeight = reactFlowElement.offsetHeight
                if (inputBoxHeight > 0 && inputBoxHeight < reactFlowHeight) {
                  bottomPadding = inputBoxHeight / reactFlowHeight
                }
              }

              const uiPadding = Math.max(topPadding, bottomPadding, 0.05)

              const fitViewOptions = viewMode === 'linear'
                ? { padding: uiPadding, minZoom: 0.1, maxZoom: 1, duration: 300 }
                : { padding: Math.max(uiPadding, 0.1), minZoom: 0.3, maxZoom: 2, duration: 300 }
              reactFlowInstance.fitView(fitViewOptions)
              setTimeout(() => {
                fitViewInProgressRef.current = false
              }, 350)
            }
            minimapDragStartRef.current = null
          }
          clickTimeoutId = null
        }, 200)

        // Don't prevent default - allow React Flow's drag to work
      }

      const handleMouseMove = (e: MouseEvent) => {
        // Track if user is dragging (mouse moved significantly)
        // Only check if we have a valid drag start (from minimap mousedown)
        if (!minimapDragStartRef.current) return

        const deltaX = Math.abs(e.clientX - minimapDragStartRef.current.x)
        const deltaY = Math.abs(e.clientY - minimapDragStartRef.current.y)

        // Mark as drag if movement is significant (more than 15px)
        // This threshold distinguishes intentional drags from accidental movement during clicks
        if (deltaX > 15 || deltaY > 15) {
          minimapDragStartRef.current.isDragging = true
        }
      }

      const handleMouseUp = (e: MouseEvent) => {
        // Don't process right-clicks (button 2) - allow context menu to work
        if (e.button === 2) {
          minimapDragStartRef.current = null
          return
        }

        // Clear the fallback timeout since mouseup fired
        if (clickTimeoutId) {
          clearTimeout(clickTimeoutId)
          clickTimeoutId = null
        }

        if (!minimapDragStartRef.current) return

        // Check if it was actually a drag
        const wasDragging = minimapDragStartRef.current.isDragging

        // If it was a drag, don't trigger centering (allow React Flow's minimap drag to work)
        if (wasDragging) {
          minimapDragStartRef.current = null
          return
        }

        // It was a click (no significant drag) - center clicked node on prompt box
        requestAnimationFrame(() => {
          if (!reactFlowInstance || !nodes || !Array.isArray(nodes)) return

          // Find which node was clicked by checking click coordinates against minimap node positions
          const minimapSvg = minimapElement?.querySelector('svg')
          let clickedNode: Node | null = null

          if (minimapSvg && nodes && nodes.length > 0) {
            const minimapRect = minimapSvg.getBoundingClientRect()
            const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
            if (reactFlowElement) {
              const reactFlowRect = reactFlowElement.getBoundingClientRect()
              const viewport = reactFlowInstance.getViewport()

              // Convert click position to normalized minimap coordinates (0-1)
              const minimapX = (e.clientX - minimapRect.left) / minimapRect.width
              const minimapY = (e.clientY - minimapRect.top) / minimapRect.height

              // Find node closest to click position
              let closestNode = null
              let closestDistance = Infinity

              nodes.forEach((node) => {
                // Convert node world position to normalized screen coordinates
                const nodeScreenX = (node.position.x * viewport.zoom) + viewport.x
                const nodeScreenY = (node.position.y * viewport.zoom) + viewport.y
                const nodeNormalizedX = nodeScreenX / reactFlowRect.width
                const nodeNormalizedY = nodeScreenY / reactFlowRect.height

                const distance = Math.sqrt(
                  Math.pow(nodeNormalizedX - minimapX, 2) +
                  Math.pow(nodeNormalizedY - minimapY, 2)
                )

                if (distance < closestDistance) {
                  closestDistance = distance
                  closestNode = node
                }
              })

              // If click is close to a node (within reasonable threshold), use it
              if (closestNode && closestDistance < 0.15) {
                clickedNode = closestNode
              }
            }
          }

          if (clickedNode) {
            // Center the clicked node - horizontally on prompt box, vertically based on mode
            fitViewInProgressRef.current = true

            const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
            const chatTextarea = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]') as HTMLElement
            const promptBox = chatTextarea?.closest('[class*="pointer-events-auto"]') as HTMLElement

            if (reactFlowElement && promptBox && clickedNode) {
              const promptBoxRect = promptBox.getBoundingClientRect()
              const reactFlowRect = reactFlowElement.getBoundingClientRect()
              const promptBoxCenterX = (promptBoxRect.left + promptBoxRect.right) / 2 - reactFlowRect.left
              const promptBoxTop = promptBoxRect.top - reactFlowRect.top

              const panelWidth = 768
              const panelHeight = nodeHeightsRef.current.get((clickedNode as any).id) || 400 // Use actual height or estimate
              const currentZoom = reactFlowInstance.getViewport().zoom

              // Always center horizontally on prompt box (both modes)
              // Formula: screenX = worldX * zoom + viewportX
              // We want: (clickedNode.position.x + panelWidth/2) * zoom + viewportX = promptBoxCenterX
              // So: viewportX = promptBoxCenterX - (clickedNode.position.x + panelWidth/2) * zoom
              const targetViewportX = promptBoxCenterX - ((clickedNode as any).position.x + panelWidth / 2) * currentZoom

              let targetViewportY: number

              // Both modes: position panel above prompt box (centered over it)
              const gapAbovePrompt = 16 // Same gap as minimap jump
              // Position panel above prompt box: panel bottom = prompt box top - gap
              // Panel center Y in screen = promptBoxTop - gap - panelHeight/2
              // Panel center Y in world = clickedNode.position.y + panelHeight/2
              // Viewport Y = screenY - (worldY * zoom)
              const panelBottomScreenY = promptBoxTop - gapAbovePrompt
              const panelCenterScreenY = panelBottomScreenY - panelHeight / 2
              const panelCenterWorldY = (clickedNode as any).position.y + panelHeight / 2
              targetViewportY = panelCenterScreenY - (panelCenterWorldY * currentZoom)

              reactFlowInstance.setViewport({ x: targetViewportX, y: targetViewportY, zoom: currentZoom }, { duration: 200 })
            }

            setTimeout(() => {
              fitViewInProgressRef.current = false
            }, 250)
          } else {
            // No specific node clicked - fall back to fitView
            fitViewInProgressRef.current = true

            // Check if top bar and input box are visible to adjust fitView padding
            const topBar = document.querySelector('[class*="bg-white"][class*="shadow-sm"][class*="border-b"]') as HTMLElement
            const inputBox = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]')?.closest('[class*="pointer-events-auto"]') as HTMLElement
            const reactFlowElement = document.querySelector('.react-flow') as HTMLElement

            // Calculate padding based on visible UI elements
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

            // In linear mode, allow zooming out more to fit all panels vertically
            const fitViewOptions = viewMode === 'linear'
              ? { padding: uiPadding, minZoom: 0.1, maxZoom: 1, duration: 300 }
              : { padding: Math.max(uiPadding, 0.1), minZoom: 0.3, maxZoom: 2, duration: 300 }
            reactFlowInstance.fitView(fitViewOptions)
            // Clear flag after fitView animation completes
            setTimeout(() => {
              fitViewInProgressRef.current = false
            }, 350)
          }
        })

        // Reset drag start position
        minimapDragStartRef.current = null
      }

      // Attach mousedown listener to minimap element (capture phase to catch before React Flow)
      // Attach mousemove and mouseup listeners to document to catch them even if React Flow prevents them on minimap
      minimapElement.addEventListener('mousedown', handleMouseDown, true)
      document.addEventListener('mousemove', handleMouseMove, true)
      document.addEventListener('mouseup', handleMouseUp, true)

      cleanup = () => {
        if (clickTimeoutId) {
          clearTimeout(clickTimeoutId)
          clickTimeoutId = null
        }
        minimapElement?.removeEventListener('mousedown', handleMouseDown, true)
        document.removeEventListener('mousemove', handleMouseMove, true)
        document.removeEventListener('mouseup', handleMouseUp, true)
      }

      return true
    }

    // Try to attach immediately
    if (!attachListeners()) {
      // If minimap not found, wait a bit and try again
      const timeoutId = setTimeout(() => {
        attachListeners()
      }, 500)

      return () => {
        clearTimeout(timeoutId)
        if (cleanup) cleanup()
      }
    }

    return () => {
      if (cleanup) cleanup()
    }
  }, [messages.length, reactFlowInstance, minimapExpanded, viewMode]) // Re-attach when minimap visibility or view mode changes

  // Set up Supabase Realtime subscription for live message updates
  useEffect(() => {
    if (!conversationId) return

    const supabaseClient = createClient()
    const channel = supabaseClient
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          console.log('🔄 BoardFlow: Realtime - New message inserted:', payload.new?.id, 'role:', payload.new?.role)
          // Immediately refetch messages when a new one is inserted
          // For deterministic mapping, multiple messages might be inserted quickly
          refetchMessages().then((result) => {
            console.log('🔄 BoardFlow: Realtime refetch result:', result.data?.length, 'messages')
          }).catch((error) => {
            console.error('🔄 BoardFlow: Realtime refetch error:', error)
          })
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          console.log('Message updated:', payload.new)
          // Refetch when messages are updated
          refetchMessages()
        }
      )
      .subscribe()

    return () => {
      supabaseClient.removeChannel(channel)
    }
  }, [conversationId, refetchMessages])

  // Listen for message updates to refetch immediately (fallback)
  useEffect(() => {
    const handleMessageUpdate = () => {
      console.log('🔄 BoardFlow: message-updated event received, refetching messages')
      // Small delay to ensure database write is complete
      // For deterministic mapping, messages are created server-side, so we need a longer delay
      setTimeout(() => {
        refetchMessages().then((result) => {
          console.log('🔄 BoardFlow: Refetch result:', result.data?.length, 'messages')
          // If we got messages, trigger another refetch after a short delay to catch any late-arriving messages
          if (result.data && result.data.length > 0) {
            setTimeout(() => {
              console.log('🔄 BoardFlow: Second refetch attempt (for deterministic mapping)')
              refetchMessages().then((result2) => {
                console.log('🔄 BoardFlow: Second refetch result:', result2.data?.length, 'messages')
              })
            }, 500)
          }
        }).catch((error) => {
          console.error('🔄 BoardFlow: Refetch error:', error)
        })
      }, 200) // Increased delay for deterministic mapping
    }
    window.addEventListener('message-updated', handleMessageUpdate)
    return () => {
      window.removeEventListener('message-updated', handleMessageUpdate)
    }
  }, [refetchMessages])

  // Helper function to find closest handles between two nodes (checks all 4 handles on each node)
  const findClosestHandles = useCallback((sourceNode: Node, targetNode: Node): { sourceHandle: string; targetHandle: string } | null => {
    if (!reactFlowInstance) return null

    // Get node positions and dimensions (fallback to default panel size if not yet measured)
    const sourcePos = sourceNode.position
    const targetPos = targetNode.position
    const sourceWidth = sourceNode.width || 400 // Default panel width
    const sourceHeight = sourceNode.height || 400 // Default panel height
    const targetWidth = targetNode.width || 400
    const targetHeight = targetNode.height || 400

    // Connection points sit on the frame edge (indicators are outer-only, not edge geometry)
    const sourceOut = 0
    const targetOut = 0

    // Calculate all 4 handle positions for source node (top, bottom, left, right)
    const sourceHandles = {
      top: { x: sourcePos.x + sourceWidth / 2, y: sourcePos.y - sourceOut },
      bottom: { x: sourcePos.x + sourceWidth / 2, y: sourcePos.y + sourceHeight + sourceOut },
      left: { x: sourcePos.x - sourceOut, y: sourcePos.y + sourceHeight / 2 },
      right: { x: sourcePos.x + sourceWidth + sourceOut, y: sourcePos.y + sourceHeight / 2 },
    }

    // Calculate all 4 handle positions for target node (top, bottom, left, right)
    const targetHandles = {
      top: { x: targetPos.x + targetWidth / 2, y: targetPos.y - targetOut },
      bottom: { x: targetPos.x + targetWidth / 2, y: targetPos.y + targetHeight + targetOut },
      left: { x: targetPos.x - targetOut, y: targetPos.y + targetHeight / 2 },
      right: { x: targetPos.x + targetWidth + targetOut, y: targetPos.y + targetHeight / 2 },
    }

    // Calculate distances between all handle combinations (4x4 = 16 combinations)
    const distances: Array<{ sourceHandle: string; targetHandle: string; distance: number }> = []

    Object.entries(sourceHandles).forEach(([sourceHandleId, sourceHandlePos]) => {
      Object.entries(targetHandles).forEach(([targetHandleId, targetHandlePos]) => {
        const distance = Math.sqrt(
          Math.pow(sourceHandlePos.x - targetHandlePos.x, 2) +
          Math.pow(sourceHandlePos.y - targetHandlePos.y, 2)
        )
        distances.push({ sourceHandle: sourceHandleId, targetHandle: targetHandleId, distance })
      })
    })

    // Find the closest connection (any of the 16 combinations)
    const closest = distances.reduce((min, curr) => curr.distance < min.distance ? curr : min)

    return {
      sourceHandle: closest.sourceHandle,
      targetHandle: closest.targetHandle
    }
  }, [reactFlowInstance])

  // Load saved canvas nodes (freehand drawings, etc.) from database
  useEffect(() => {
    if (!savedCanvasNodes || savedCanvasNodes.length === 0) {
      console.log('🎨 BoardFlow: No saved canvas nodes to load', { savedCanvasNodesLength: savedCanvasNodes?.length || 0 })
      return
    }

    console.log(`🎨 BoardFlow: Loading ${savedCanvasNodes.length} saved canvas nodes from database`)

    // Convert saved canvas nodes to React Flow nodes
    const canvasReactFlowNodes: Node[] = savedCanvasNodes.map((savedNode) => {
      // Create React Flow node from saved canvas node
      // Note: reactflow v11 requires width/height in style, not as direct properties
      const reactFlowNode: Node = {
        id: savedNode.id, // Use same ID as database
        type: savedNode.node_type, // Node type (e.g., 'freehand')
        position: {
          x: savedNode.position_x, // X position in flow coordinates
          y: savedNode.position_y, // Y position in flow coordinates
        },
        width: savedNode.width, // Node width (for v12+ compatibility)
        height: savedNode.height, // Node height (for v12+ compatibility)
        style: { // Style object for v11 - required for node dimensions
          width: savedNode.width,
          height: savedNode.height,
        },
        data: savedNode.data, // Node data (points array, initialSize, etc.)
        // resizable: true, // Enable resizing (removed - not a valid Node property)
        selectable: true, // Enable selection
        draggable: true, // Enable dragging
      } as Node

      return reactFlowNode
    })

    // Add canvas nodes to existing nodes (merge with message-based nodes)
    setNodes((existingNodes) => {
      // Filter out any existing canvas nodes with same IDs (avoid duplicates)
      const existingCanvasNodeIds = new Set(
        existingNodes
          .filter((n) => n.type === 'freehand' || n.type === savedCanvasNodes[0]?.node_type)
          .map((n) => n.id)
      )

      // Only add canvas nodes that don't already exist
      const newCanvasNodes = canvasReactFlowNodes.filter(
        (node) => !existingCanvasNodeIds.has(node.id)
      )

      if (newCanvasNodes.length > 0) {
        console.log(`🎨 BoardFlow: Adding ${newCanvasNodes.length} canvas nodes to React Flow`)
        return [...existingNodes, ...newCanvasNodes]
      }

      return existingNodes
    })
  }, [savedCanvasNodes, setNodes])

  // Load saved edges from database when nodes are available
  useEffect(() => {
    if (!savedEdges || savedEdges.length === 0) {
      console.log('🔄 BoardFlow: No saved edges to load', { savedEdgesLength: savedEdges?.length || 0 })
      return
    }

    if (!nodes || nodes.length === 0) {
      console.log('🔄 BoardFlow: Nodes not ready yet, waiting...', { nodesLength: nodes?.length || 0 })
      return
    }

    console.log(`🔄 BoardFlow: Loading ${savedEdges.length} saved edges from database, ${nodes.length} nodes available`)

    // Convert saved edges (message IDs) to React Flow edges (node IDs)
    const reactFlowEdges: Edge[] = []

    for (const savedEdge of savedEdges) {
      // Find nodes by message ID (only nodes with promptMessage, skip freehand nodes)
      const sourceNodes = nodes.filter(n => n.data.promptMessage?.id === savedEdge.source_message_id)
      const targetNodes = nodes.filter(n => n.data.promptMessage?.id === savedEdge.target_message_id)

      // Skip if either source or target is a flashcard
      const sourceIsFlashcard = sourceNodes.some(n => n.data.promptMessage?.metadata?.isFlashcard === true)
      const targetIsFlashcard = targetNodes.some(n => n.data.promptMessage?.metadata?.isFlashcard === true)
      
      if (sourceIsFlashcard || targetIsFlashcard) {
        console.log(`🔄 BoardFlow: Skipping edge for flashcard: ${savedEdge.source_message_id} -> ${savedEdge.target_message_id}`)
        continue
      }

      if (sourceNodes.length === 0) {
        console.warn(`🔄 BoardFlow: Source node not found for message ID: ${savedEdge.source_message_id}`)
      }
      if (targetNodes.length === 0) {
        console.warn(`🔄 BoardFlow: Target node not found for message ID: ${savedEdge.target_message_id}`)
      }

      // Create edges between all matching source and target nodes
      for (const sourceNode of sourceNodes) {
        for (const targetNode of targetNodes) {
          // Find closest handles
          const handles = findClosestHandles(sourceNode, targetNode)
          if (!handles) continue

          // Use closest handles directly - all handles are equal, no swapping needed
          const finalSource = sourceNode.id
          const finalTarget = targetNode.id
          const finalSourceHandle = handles.sourceHandle
          const finalTargetHandle = handles.targetHandle

          const edgeId = `${finalSource}-${finalTarget}`

          // Check if edge already exists in current edges (in either direction)
          const existingEdge = edges.find(e => 
            (e.source === finalSource && e.target === finalTarget) ||
            (e.source === finalTarget && e.target === finalSource)
          )
          if (!existingEdge) {
            reactFlowEdges.push({
              id: edgeId,
              source: finalSource,
              target: finalTarget,
              sourceHandle: finalSourceHandle,
              targetHandle: finalTargetHandle,
              type: 'editable', // Miro-style adjustable thread
              data: {
                algorithm: savedEdge.metadata?.algorithm ?? DEFAULT_THREAD_ALGORITHM,
                points: savedEdge.metadata?.points ?? [],
                dotted: savedEdge.metadata?.dotted ?? lineStyle === 'dotted',
                strokeWidth: savedEdge.metadata?.strokeWidth ?? THREAD_DEFAULT_STROKE_WIDTH,
              } satisfies ThreadEdgeData,
            })
            console.log(`🔄 BoardFlow: Prepared edge: ${finalSource}(${finalSourceHandle}) -> ${finalTarget}(${finalTargetHandle})`)
          } else {
            console.log(`🔄 BoardFlow: Edge already exists in React Flow: ${edgeId}`)
          }
        }
      }
    }

    if (reactFlowEdges.length > 0) {
      console.log(`🔄 BoardFlow: Adding ${reactFlowEdges.length} saved edges to React Flow`)
      setEdges((eds) => {
        // Preserve placeholder edges when loading saved edges
        const placeholderEdges = eds.filter((e) => e.type === 'placeholder')
        
        // Filter out duplicates (check both directions)
        const edgesToAdd = reactFlowEdges.filter(newEdge =>
          !eds.some(existingEdge =>
            (existingEdge.source === newEdge.source && existingEdge.target === newEdge.target) ||
            (existingEdge.source === newEdge.target && existingEdge.target === newEdge.source)
          )
        )
        if (edgesToAdd.length > 0) {
          console.log(`🔄 BoardFlow: Adding ${edgesToAdd.length} new edges (${reactFlowEdges.length - edgesToAdd.length} already exist)`)
          // Preserve placeholder edges when adding saved edges
          const result = [...eds.filter((e) => e.type !== 'placeholder'), ...edgesToAdd, ...placeholderEdges]
          // Trigger placeholder update after edges are loaded to ensure placeholder edge is created
          setTimeout(() => {
            // This will be handled by the placeholder manager's useEffect that watches edges
          }, 100)
          return result
        }
        console.log('🔄 BoardFlow: All edges already exist in React Flow')
        return eds
      })
    } else {
      console.log('🔄 BoardFlow: No new edges to add (all already exist or nodes not found)')
    }
  }, [savedEdges, nodes, edges, setEdges, findClosestHandles, lineStyle])

  // Listen for edges-created event to create React Flow edges from AI-determined connections
  useEffect(() => {
    const handleEdgesCreated = (event: CustomEvent<{ edges: Array<{ sourcePanelMessageId: string; targetPanelMessageId: string }> }>) => {
      console.log('🔄 BoardFlow: edges-created event received, creating React Flow edges')
      const edgesData = event.detail.edges

      if (!edgesData || !Array.isArray(edgesData) || edgesData.length === 0) {
        console.log('🔄 BoardFlow: No edges to create')
        return
      }

      // Wait a bit for panels to be created from messages
      setTimeout(() => {
        // Get current nodes to find panel node IDs
        const currentNodes = reactFlowInstance?.getNodes() || nodes

        // Create edges by finding the corresponding panel nodes
        const newEdges: Edge[] = []

        for (const edgeData of edgesData) {
          // Convert message IDs to panel node IDs
          // Source panel: panel-{sourcePanelMessageId}
          // Target panel: panel-{targetPanelMessageId}
          const sourceNodeId = `panel-${edgeData.sourcePanelMessageId}`
          const targetNodeId = `panel-${edgeData.targetPanelMessageId}`

          // Find the nodes
          const sourceNode = currentNodes.find(n => n.id === sourceNodeId || n.id.startsWith(`${sourceNodeId}-`))
          const targetNode = currentNodes.find(n => n.id === targetNodeId || n.id.startsWith(`${targetNodeId}-`))

          // Skip if either source or target is a flashcard
          const sourceIsFlashcard = sourceNode?.data?.promptMessage?.metadata?.isFlashcard === true
          const targetIsFlashcard = targetNode?.data?.promptMessage?.metadata?.isFlashcard === true
          
          if (sourceIsFlashcard || targetIsFlashcard) {
            console.log(`🔄 BoardFlow: Skipping edge creation for flashcard: ${sourceNodeId} -> ${targetNodeId}`)
            continue
          }

          if (sourceNode && targetNode) {
            // Use the actual node IDs (might have -0, -1 suffix for multiple panels from same prompt)
            const actualSourceId = sourceNode.id
            const actualTargetId = targetNode.id

            // Find closest handles - all handles are equal, use closest pair
            const handles = findClosestHandles(sourceNode, targetNode)
            if (!handles) {
              console.warn(`🔄 BoardFlow: Could not find closest handles for edge: ${actualSourceId} -> ${actualTargetId}`)
              continue
            }

            // Use closest handles directly - no swapping needed, all handles work equally
            const newEdge: Edge = {
              id: `${actualSourceId}-${actualTargetId}`,
              source: actualSourceId,
              target: actualTargetId,
              sourceHandle: handles.sourceHandle,
              targetHandle: handles.targetHandle,
              type: 'editable', // Miro-style adjustable thread
              data: {
                algorithm: threadAlgorithmFromStyle(
                  typeof window !== 'undefined'
                    ? localStorage.getItem('thinktable-horizontal-line-style')
                    : null
                ),
                points: [],
                dotted: lineStyle === 'dotted',
              } satisfies ThreadEdgeData,
            }
            newEdges.push(newEdge)
            console.log(`🔄 BoardFlow: Preparing edge: ${actualSourceId}(${handles.sourceHandle}) -> ${actualTargetId}(${handles.targetHandle})`)
          } else {
            console.warn(`🔄 BoardFlow: Could not find nodes for edge: ${sourceNodeId} -> ${targetNodeId}`, {
              sourceNode: sourceNode ? sourceNode.id : 'not found',
              targetNode: targetNode ? targetNode.id : 'not found',
              availableNodes: currentNodes.map(n => n.id)
            })
          }
        }

        if (newEdges.length > 0) {
          console.log(`🔄 BoardFlow: Adding ${newEdges.length} new edges to React Flow`)
          setEdges((eds) => {
            // Filter out any edges that already exist (in either direction)
            const edgesToAdd = newEdges.filter(newEdge =>
              !eds.some(existingEdge =>
                (existingEdge.source === newEdge.source && existingEdge.target === newEdge.target) ||
                (existingEdge.source === newEdge.target && existingEdge.target === newEdge.source)
              )
            )
            if (edgesToAdd.length > 0) {
              console.log(`🔄 BoardFlow: Adding ${edgesToAdd.length} new edges (${newEdges.length - edgesToAdd.length} already exist)`)
              return [...eds, ...edgesToAdd]
            } else {
              console.log('🔄 BoardFlow: All edges already exist')
              return eds
            }
          })
        } else {
          console.log('🔄 BoardFlow: No new edges to add (nodes not found)')
        }
      }, 1000) // Wait 1 second for panels to be created from messages
    }

    window.addEventListener('edges-created', handleEdgesCreated as EventListener)
    return () => {
      window.removeEventListener('edges-created', handleEdgesCreated as EventListener)
    }
  }, [reactFlowInstance, nodes, setEdges, findClosestHandles, lineStyle]) // setEdges is stable, edges is accessed via closure

  // Also refetch when conversationId changes
  useEffect(() => {
    if (conversationId) {
      refetchMessages()
      // Reset message length tracking for new conversation
      prevMessagesLengthRef.current = 0
      wasAtBottomRef.current = true // New conversation should start at bottom
    }
  }, [conversationId, refetchMessages])

  // Listen for window resize to detect sidebar collapse/expand and reposition panels with push/center logic
  useEffect(() => {
    if (!nodes || !Array.isArray(nodes) || nodes.length === 0) return

    const handleResize = () => {
      // Apply push/center logic in both Linear and Canvas modes to keep panels aligned with prompt box

      const reactFlowElement = document.querySelector('.react-flow')
      if (!reactFlowElement) return

      const mapAreaWidth = reactFlowElement.clientWidth
      if (Math.abs(mapAreaWidth - prevViewportWidthRef.current) < 1) return // No significant change

      prevViewportWidthRef.current = mapAreaWidth

      // Use the EXACT same logic as prompt box to determine if panels should be centered
      // This must match input-area-with-sticky-prompt.tsx calculation exactly
      const currentZoom = reactFlowInstance.getViewport().zoom
      const promptBoxMaxWidth = 768 // Max width of prompt box

      // Calculate left gap same as prompt box (push/center mechanics)
      const expandedSidebarWidth = 256
      const collapsedSidebarWidth = 64
      const minimapWidth = 179
      const minimapMargin = 15

      const sidebarElement = document.querySelector('[class*="w-16"], [class*="w-64"]') as HTMLElement
      const isSidebarExpanded = sidebarElement?.classList.contains('w-64') ?? false
      const currentSidebarWidth = isSidebarExpanded ? expandedSidebarWidth : collapsedSidebarWidth

      // Calculate map area width with current sidebar state (full screen with current sidebar width)
      const fullWindowWidth = window.screen.width
      const fullMapAreaWidth = fullWindowWidth - currentSidebarWidth

      // Calculate gap from sidebar right edge (0px) to minimap left edge with current sidebar state
      const minimapLeftEdge = fullMapAreaWidth - minimapWidth - minimapMargin
      const gapFromSidebarToMinimap = minimapLeftEdge - 0

      // Calculate left gap: (1/2) * (gap from sidebar to minimap - prompt box width)
      const calculatedLeftGap = Math.max(0, (1 / 2) * (gapFromSidebarToMinimap - promptBoxMaxWidth))

      // Check if minimap has moved up - same logic as prompt box
      const minimapElement = document.querySelector('.react-flow__minimap') as HTMLElement
      let minimapBottom = 15 // Default minimap bottom position
      if (minimapElement) {
        const computedStyle = getComputedStyle(minimapElement)
        const bottomValue = computedStyle.bottom
        if (bottomValue && bottomValue !== 'auto') {
          minimapBottom = parseInt(bottomValue) || 15
        }
      }
      const minimapMovedUp = minimapBottom > 15 // Minimap moved up when bottom > 15px

      // When minimap is moved up, reduce right gap to allow input to expand into that space
      const baseRightGap = minimapMovedUp ? 0 : 16 // No right gap when minimap is up, normal 16px when in normal position

      // First calculate width with left-aligned positioning using calculated left gap
      const leftAlignedWidth = Math.min(promptBoxMaxWidth, mapAreaWidth - calculatedLeftGap - baseRightGap)

      // Calculate the right gap (distance from input box right edge to map area right edge) when left-aligned
      const rightGapWhenLeftAligned = mapAreaWidth - calculatedLeftGap - leftAlignedWidth

      // Use actual prompt box width from context (for 100% zoom) or default 768px
      // This is the width the panels should use for display
      const panelWidthToUse = (currentZoom <= 1.0 && 768 >= contextPanelWidth) ? contextPanelWidth : 768

      // Get current panel X
      const currentPanelX = nodes[0]?.position.x || 0

      let targetViewportX: number

      // Use the EXACT same centering logic as prompt box
      // The decision is based on leftAlignedWidth (which accounts for minimap position)
      // If right gap < left gap, center; otherwise use left-aligned (pushed)
      if (rightGapWhenLeftAligned < calculatedLeftGap) {
        // Center the panels (same as prompt box when centered)
        // When centered, prompt box uses: Math.min(promptBoxMaxWidth, mapAreaWidth - 32)
        // So panels should center with their actual width (panelWidthToUse)
        const screenCenterX = mapAreaWidth / 2
        targetViewportX = screenCenterX - (panelWidthToUse / 2) - (currentPanelX * currentZoom)
      } else {
        // Position panels with left gap (pushed, same as prompt box when left-aligned)
        // When left-aligned, prompt box uses leftAlignedWidth, but panels use panelWidthToUse
        // The viewport X should position the panel's left edge at calculatedLeftGap
        targetViewportX = calculatedLeftGap - (currentPanelX * currentZoom)
      }

      // Guard against NaN values
      if (!isFinite(targetViewportX)) return

      // Update viewport X to reposition panels
      const currentViewport = reactFlowInstance.getViewport()
      reactFlowInstance.setViewport({
        x: targetViewportX,
        y: currentViewport.y,
        zoom: currentViewport.zoom,
      })
    }

    // Initial measurement
    const reactFlowElement = document.querySelector('.react-flow')
    if (reactFlowElement) {
      prevViewportWidthRef.current = reactFlowElement.clientWidth
    }

    window.addEventListener('resize', handleResize)
    // Use ResizeObserver for more accurate detection of sidebar collapse/expand
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        handleResize()
      }
    })

    const reactFlowElementForObserver = document.querySelector('.react-flow')
    if (reactFlowElementForObserver) {
      resizeObserver.observe(reactFlowElementForObserver)
    }

    // Also watch for sidebar state changes using MutationObserver (same as prompt box)
    const sidebarElement = document.querySelector('[class*="w-16"], [class*="w-64"]') as HTMLElement
    const sidebarObserver = sidebarElement ? new MutationObserver(() => {
      handleResize()
    }) : null

    if (sidebarObserver && sidebarElement) {
      sidebarObserver.observe(sidebarElement, {
        attributes: true,
        attributeFilter: ['class']
      })
    }

    // Watch for minimap position changes - when minimap moves up, recalculate
    const minimapElement = document.querySelector('.react-flow__minimap') as HTMLElement
    const minimapObserver = minimapElement ? new MutationObserver(() => {
      handleResize()
    }) : null

    if (minimapObserver && minimapElement) {
      minimapObserver.observe(minimapElement, {
        attributes: true,
        attributeFilter: ['style']
      })
    }

    // Also use ResizeObserver on minimap to catch position changes
    const minimapResizeObserver = minimapElement ? new ResizeObserver(() => {
      handleResize()
    }) : null

    if (minimapResizeObserver && minimapElement) {
      minimapResizeObserver.observe(minimapElement)
    }

    return () => {
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      if (sidebarObserver) sidebarObserver.disconnect()
      if (minimapObserver) minimapObserver.disconnect()
      if (minimapResizeObserver) minimapResizeObserver.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes?.length ?? 0, isPromptBoxCentered, contextPanelWidth]) // Re-run when nodes change, prompt box centering changes, or panel width changes

  // Structural key only (ids + roles) — do NOT include content; content edits must not remount panels mid-typing
  const messagesKey = useMemo(() => {
    return messages.map(m => `${m.id}:${m.role}`).join(',')
  }, [messages])

  // Calculate bottom scroll limit for linear mode (last panel + padding for input box)
  const getBottomScrollLimit = useCallback(() => {
    if (viewMode !== 'linear' || !nodes || !Array.isArray(nodes) || nodes.length === 0) return null

    const reactFlowElement = document.querySelector('.react-flow')
    if (!reactFlowElement) return null

    const viewport = reactFlowInstance.getViewport()
    const viewportHeight = reactFlowElement.clientHeight
    const inputPadding = 200 // Padding for input box at bottom
    const estimatedPanelHeight = 400 // Fallback estimate

    // Get last panel (highest Y position)
    const lastPanel = nodes.reduce((prev, current) =>
      (current.position.y > prev.position.y) ? current : prev
    )
    const lastPanelY = lastPanel.position.y

    // Use measured height if available, otherwise estimate
    const lastPanelHeight = nodeHeightsRef.current.get(lastPanel.id) || estimatedPanelHeight
    const lastPanelBottom = lastPanelY + lastPanelHeight

    // Calculate bottom limit in viewport coordinates
    // This is the viewport Y position where the last panel's bottom is just above the input area
    const bottomLimit = -(lastPanelBottom + inputPadding - viewportHeight / viewport.zoom) * viewport.zoom

    return bottomLimit
  }, [viewMode, nodes, reactFlowInstance])

  // Check if scrolled to bottom and if bottommost panel is fully visible above input
  const checkIfAtBottom = useCallback(() => {
    if (viewMode !== 'linear' || !nodes || !Array.isArray(nodes) || nodes.length === 0) {
      setIsAtBottom(true)
      return
    }

    const bottomLimit = getBottomScrollLimit()
    if (bottomLimit === null) {
      setIsAtBottom(true)
      return
    }

    const viewport = reactFlowInstance.getViewport()
    const threshold = 50 // Show arrow when within 50px of bottom limit

    // Check if viewport is at or near the bottom limit
    // Viewport Y is negative, bottomLimit is also negative
    // When at bottom, viewport.y should be close to bottomLimit
    // isAtBottom = true means we're at bottom (arrow should NOT show)
    // isAtBottom = false means we're above bottom (arrow SHOULD show)
    const distanceFromBottom = Math.abs(viewport.y - bottomLimit)
    const isAtBottom = distanceFromBottom <= threshold

    setIsAtBottom(isAtBottom)
    wasAtBottomRef.current = isAtBottom
  }, [viewMode, nodes, reactFlowInstance, getBottomScrollLimit])

  // Scroll to bottom (center on last panel)
  const scrollToBottom = useCallback(() => {
    if (viewMode !== 'linear' || !nodes || !Array.isArray(nodes) || nodes.length === 0) return

    const reactFlowElement = document.querySelector('.react-flow')
    if (!reactFlowElement) return

    const viewport = reactFlowInstance.getViewport()
    const viewportHeight = reactFlowElement.clientHeight
    const inputPadding = 200

    // Get last panel (highest Y position)
    const lastPanel = nodes.reduce((prev, current) =>
      (current.position.y > prev.position.y) ? current : prev
    )
    const lastPanelY = lastPanel.position.y

    // Use measured height if available, otherwise estimate
    const estimatedPanelHeight = 400
    const lastPanelHeight = nodeHeightsRef.current.get(lastPanel.id) || estimatedPanelHeight
    const lastPanelBottom = lastPanelY + lastPanelHeight

    // Calculate viewport Y to show the bottom of the last panel with padding
    // Viewport Y is negative, so we need to calculate the offset
    // Use zoom = 1 (100%) for the calculation since we want to scroll at 100% zoom
    const targetZoom = 1
    const bottomLimit = -(lastPanelBottom + inputPadding - viewportHeight / targetZoom) * targetZoom

    // Set flag to prevent onMove from interfering
    isScrollingToBottomRef.current = true

    // Calculate horizontal position to center to prompt box (same as normal linear mode behavior)
    let targetViewportX = viewport.x
    if (nodes && Array.isArray(nodes) && nodes.length > 0) {
      const currentPanelX = nodes[0]?.position.x || 0
      const panelWidth = 768 // Same width as prompt box

      // Try to get the actual prompt box position for perfect alignment
      const chatTextarea = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]') as HTMLElement
      const promptBox = chatTextarea?.closest('[class*="pointer-events-auto"]') as HTMLElement

      if (promptBox) {
        const promptBoxRect = promptBox.getBoundingClientRect()
        const reactFlowRect = reactFlowElement.getBoundingClientRect()
        const promptBoxCenterX = (promptBoxRect.left + promptBoxRect.right) / 2 - reactFlowRect.left
        targetViewportX = promptBoxCenterX - (currentPanelX + panelWidth / 2) * targetZoom
      } else {
        // Fallback calculation
        const mapAreaWidth = reactFlowElement.clientWidth
        const expandedSidebarWidth = 256
        const collapsedSidebarWidth = 64
        const minimapWidth = 179
        const minimapMargin = 15

        const sidebarElement = document.querySelector('[class*="w-16"], [class*="w-64"]') as HTMLElement
        const isSidebarExpanded = sidebarElement?.classList.contains('w-64') ?? false
        const currentSidebarWidth = isSidebarExpanded ? expandedSidebarWidth : collapsedSidebarWidth

        const fullWindowWidth = window.innerWidth
        const fullMapAreaWidth = fullWindowWidth - currentSidebarWidth
        const minimapLeftEdge = fullMapAreaWidth - minimapWidth - minimapMargin
        const gapFromSidebarToMinimap = minimapLeftEdge
        const calculatedLeftGap = Math.max(0, (1 / 2) * (gapFromSidebarToMinimap - panelWidth))
        const rightGapWhenLeftAligned = mapAreaWidth - calculatedLeftGap - panelWidth

        let promptBoxCenterX: number
        if (rightGapWhenLeftAligned < calculatedLeftGap) {
          promptBoxCenterX = mapAreaWidth / 2
        } else {
          promptBoxCenterX = calculatedLeftGap + (panelWidth / 2)
        }

        targetViewportX = promptBoxCenterX - (currentPanelX + panelWidth / 2) * targetZoom
      }
    }

    // Set viewport to show bottom with smooth animation
    reactFlowInstance.setViewport({
      x: targetViewportX,
      y: bottomLimit,
      zoom: targetZoom, // Zoom to 100% when scrolling to bottom
    }, { duration: 300 }) // Smooth scroll animation (300ms)

    // Hide minimap during scroll (defer to avoid interfering with setViewport)
    requestAnimationFrame(() => {
      setIsScrollingToBottom(true) // Update state to hide minimap during scroll
    })

    // Clear flag and update state after animation completes
    setTimeout(() => {
      isScrollingToBottomRef.current = false
      setIsScrollingToBottom(false) // Update state to show minimap after scroll
      setIsAtBottom(true)
      wasAtBottomRef.current = true
    }, 350) // Slightly longer than animation duration
  }, [viewMode, nodes, reactFlowInstance])

  // Auto-scroll to bottom when conversation changes or first loads
  useEffect(() => {
    if (false && nodes && Array.isArray(nodes) && nodes.length > 0 && conversationId) {
      // Small delay to ensure nodes are positioned and heights are measured
      const timeoutId = setTimeout(() => {
        scrollToBottom()
      }, 400) // Longer delay to allow height measurement
      return () => clearTimeout(timeoutId)
    }
  }, [conversationId, viewMode, scrollToBottom]) // Only trigger on conversation change, not on every node change

  // Helper function to delete nodes by their IDs (works for both context menu and backspace deletion)
  const deleteNodesByIds = useCallback(async (nodeIdsToDelete: string[]) => {
    if (!conversationId || nodeIdsToDelete.length === 0) return

    // Find the nodes to delete
    const nodesToDelete = nodes.filter((n) => nodeIdsToDelete.includes(n.id))
    if (nodesToDelete.length === 0) return

    // Separate freehand nodes from chat panel nodes
    const freehandNodes = nodesToDelete.filter((n) => n.type === 'freehand') // Freehand drawing nodes
    const chatPanelNodes = nodesToDelete.filter((n) => n.type !== 'freehand') // Chat panel nodes (have promptMessage)

    // Collect all message IDs to delete (only for chatPanel nodes, skip freehand nodes)
    const messageIdsToDelete: string[] = []
    chatPanelNodes.forEach((node) => {
      // Only delete messages for chatPanel nodes (freehand nodes don't have promptMessage)
      if (node.data.promptMessage?.id) {
        messageIdsToDelete.push(node.data.promptMessage.id)
        if (node.data.responseMessage?.id) {
          messageIdsToDelete.push(node.data.responseMessage.id)
        }
      }
    })

    // Collect canvas node IDs to delete (only for freehand nodes)
    const canvasNodeIdsToDelete = freehandNodes.map((n) => n.id) // Freehand node IDs match database IDs

    // Delete from React Flow state immediately (optimistic update)
    const nodeIdsSet = new Set(nodeIdsToDelete)
    setNodes((nds) => nds.filter((n) => !nodeIdsSet.has(n.id)))

    try {
      const supabase = createClient()
      let messagesDeleted = true // Track if messages were deleted successfully
      let canvasNodesDeleted = true // Track if canvas nodes were deleted successfully

      // Delete linked pages for titled blocks before removing messages
      for (const node of chatPanelNodes) {
        const meta = node.data?.promptMessage?.metadata as Record<string, unknown> | undefined
        if (meta?.linkedBoardId) {
          try {
            await deleteLinkedBoardForBlock(supabase, meta)
          } catch (err) {
            console.error('Error deleting linked page for block:', err)
          }
        }
      }

      // Also delete block-group message rows when a group node is removed
      const groupMessageIds = nodesToDelete
        .filter((n) => n.type === 'blockGroup')
        .map((n) => n.id.replace(/^block-group-/, ''))
      messageIdsToDelete.push(...groupMessageIds)

      // Delete messages for chat panel nodes
      if (messageIdsToDelete.length > 0) {
        const { error } = await supabase
          .from('messages')
          .delete()
          .in('id', messageIdsToDelete)

        if (error) {
          console.error('Error deleting messages from database:', error)
          messagesDeleted = false
        } else {
          console.log('✅ Deleted messages from database')
          // Clear cache and invalidate queries to refresh the UI
          queryClient.removeQueries({ queryKey: ['messages-for-panels', conversationId] })
          await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
          await queryClient.refetchQueries({ queryKey: ['messages-for-panels', conversationId] })
        }
      }

      // Delete canvas nodes (freehand drawings) from database
      if (canvasNodeIdsToDelete.length > 0) {
        const { error } = await supabase
          .from('canvas_nodes')
          .delete()
          .in('id', canvasNodeIdsToDelete)

        if (error) {
          console.error('Error deleting canvas nodes from database:', error)
          canvasNodesDeleted = false
        } else {
          console.log('✅ Deleted canvas nodes from database')
          // Invalidate canvas nodes query to refresh the UI
          await queryClient.invalidateQueries({ queryKey: ['canvas-nodes', conversationId] })
        }
      }

      // If any deletion failed, re-add nodes to React Flow state
      if (!messagesDeleted || !canvasNodesDeleted) {
        setNodes((nds) => [...nds, ...nodesToDelete])
        return false
      }

      return true
    } catch (error) {
      console.error('Error deleting nodes:', error)
      // Re-add nodes to React Flow state if deletion failed
      setNodes((nds) => [...nds, ...nodesToDelete])
      return false
    }
  }, [conversationId, nodes, setNodes, queryClient])

  // Frames with a sole empty TipTap block ask to be removed when clicked off (deselected)
  useEffect(() => {
    const onEmptyFrame = (event: Event) => {
      const nodeId = (event as CustomEvent<{ nodeId?: string }>).detail?.nodeId
      if (!nodeId) return
      void deleteNodesByIds([nodeId])
    }
    window.addEventListener('tt-delete-empty-frame', onEmptyFrame)
    return () => window.removeEventListener('tt-delete-empty-frame', onEmptyFrame)
  }, [deleteNodesByIds])

  // Recalculate edge handles based on current node positions
  // Previously remapped every connected edge to the nearest sides while dragging.
  // Disabled — keep the sides the user snapped to; a future cleanup action will re-route.
  const recalculateEdgeHandles = useCallback((_nodeId: string, _currentNodes: Node[]) => {
    return
  }, [])

  // Track node position changes in Canvas mode to update stored positions
  const handleNodesChange = useCallback((changes: any[]) => {
    // Frames: block RF mousedown select — selection happens on click (mouseup) unless marquee
    const marquee = isMarqueeFrameSelectArmed() || !!rfStore.getState().userSelectionActive
    let changesToProcess = changes.filter((change) => {
      if (change.type !== 'select' || change.selected !== true) return true
      const node = nodes.find((n) => n.id === change.id)
      if (node?.type !== 'chatPanel') return true // Other node types keep RF default select
      if (marquee) return true // Selection-rect multi-select
      return false // Drop mousedown / drag-start auto-select
    })
    if (marquee && !rfStore.getState().userSelectionActive) {
      clearMarqueeFrameSelect() // Marquee batch consumed
    }

    // Check if a placeholder is being interacted with (dragged or clicked)
    const placeholderInteraction = changesToProcess.some((c) => {
      const node = nodes.find((n) => n.id === c.id);
      return node?.type === 'placeholder' && (c.type === 'position' || c.type === 'select');
    });

    // If a placeholder is being interacted with, preserve selection of non-placeholder nodes
    if (placeholderInteraction) {
      // Get currently selected non-placeholder nodes before changes are applied
      const selectedNonPlaceholderIds = nodes
        .filter((n) => n.selected && n.type !== 'placeholder')
        .map((n) => n.id);

      // Filter out deselection changes for non-placeholder nodes when placeholder is being interacted with
      changesToProcess = changesToProcess.filter((change) => {
        if (change.type === 'select' && change.selected === false) {
          const node = nodes.find((n) => n.id === change.id);
          // Filter out deselection of non-placeholder nodes when placeholder is being interacted with
          if (node && node.type !== 'placeholder' && selectedNonPlaceholderIds.includes(change.id)) {
            return false; // Prevent deselection of non-placeholder nodes
          }
        }
        return true; // Allow all other changes
      });

      // Restore selection of non-placeholder nodes after a short delay to ensure React Flow has processed
      if (selectedNonPlaceholderIds.length > 0) {
        setTimeout(() => {
          setNodes((nds) =>
            nds.map((n) => {
              if (selectedNonPlaceholderIds.includes(n.id) && n.type !== 'placeholder' && !n.selected) {
                return { ...n, selected: true };
              }
              return n;
            })
          );
        }, 0);
      }
    }
    // Track selected node
    // In linear mode, prevent any viewport changes when selecting nodes
    const hasSelectionChange = changesToProcess.some(change => change.type === 'select')
    
    // Update focused panel index when a panel is selected in linear mode
    if (hasSelectionChange && viewMode === 'linear') {
      const selectedChange = changesToProcess.find(change => change.type === 'select' && change.selected)
      if (selectedChange) {
        const selectedNode = nodes?.find(n => n.id === selectedChange.id)
        if (selectedNode) {
          const panels = getChronologicalPanels(linearNavMode)
          const index = panels.findIndex(p => p.id === selectedNode.id)
          if (index >= 0) {
            setFocusedPanelIndex(index)
            // Center the selected panel above prompt box
            setTimeout(() => {
              centerPanelAbovePrompt(selectedNode.id)
            }, 100)
          }
        }
      }
    }

    // Handle node removals (backspace/delete key) - delete from database
    const removedNodeIds: string[] = []
    changesToProcess.forEach((change) => {
      if (change.type === 'remove') {
        removedNodeIds.push(change.id)
      }
    })

    // If nodes were removed via backspace, delete them from database
    // Take snapshot before deletion for undo support
    if (removedNodeIds.length > 0) {
      takeSnapshot()
      deleteNodesByIds(removedNodeIds).catch((error) => {
        console.error('Error deleting nodes via backspace:', error)
      })
    }

    // Check if any node is being dragged - if so, move it to the end of the array to bring it to front layer
    // Also track when drag ends to recalculate edge handles
    const draggedNodeIds = new Set<string>()
    const dragEndedNodeIds = new Set<string>()
    const dragStartedNodeIds: string[] = [] // Z-order bump only once per drag (not every move tick)
    changesToProcess.forEach((change) => {
      if (change.type === 'position' && change.dragging === true) {
        draggedNodeIds.add(change.id)
        // Take snapshot at the START of a drag (only once per drag session per node)
        if (!dragSnapshotTakenRef.current.has(change.id)) {
          takeSnapshot() // Record state before drag for undo
          dragSnapshotTakenRef.current.add(change.id)
          dragStartedNodeIds.push(change.id)
        }
      } else if (change.type === 'position' && change.dragging === false) {
        // Drag just ended for this node - clear the snapshot flag
        dragEndedNodeIds.add(change.id)
        dragSnapshotTakenRef.current.delete(change.id) // Reset for next drag
      }
    })

    // Bring dragged frames to front ONCE at drag start — reordering every move tick used a stale
    // `nodes` snapshot and remounted TipTap (databaseBlock table NodeViews vanished mid-drag).
    if (dragStartedNodeIds.length > 0) {
      const started = new Set(dragStartedNodeIds)
      setNodes((nds) => {
        const dragged = nds.filter((n) => started.has(n.id))
        if (dragged.length === 0) return nds
        const others = nds.filter((n) => !started.has(n.id))
        const alreadyFront = nds.slice(-dragged.length).every((n, i) => n.id === dragged[i]?.id)
        return alreadyFront ? nds : [...others, ...dragged]
      })
    }

    // Recalculate edge handles live during drag AND when drag ends
    // This provides real-time feedback as nodes are moved
    if ((draggedNodeIds.size > 0 || dragEndedNodeIds.size > 0) && nodes && Array.isArray(nodes)) {
      // Get updated nodes with new positions from the changes
      const updatedNodes = nodes.map(node => {
        const positionChange = changesToProcess.find(c => c.type === 'position' && c.id === node.id && c.position)
        if (positionChange && positionChange.position) {
          return { ...node, position: positionChange.position }
        }
        return node
      })
      
      // Combine both sets of nodes that need recalculation
      const nodesToRecalculate = new Set([...draggedNodeIds, ...dragEndedNodeIds])
      
      // Recalculate edge handles for each node being dragged or that finished dragging
      nodesToRecalculate.forEach(nodeId => {
        recalculateEdgeHandles(nodeId, updatedNodes)
      })
    }

    // Update freehand node positions and sizes in database when they're moved or resized
    if (conversationId) {
      const freehandNodeUpdates: Array<{ id: string; position?: { x: number; y: number }; width?: number; height?: number }> = []
      
      changesToProcess.forEach((change) => {
        // Check if this is a position change for a freehand node
        if (change.type === 'position' && change.dragging === false) {
          // Drag just ended - update position in database
          const node = nodes.find((n) => n.id === change.id && n.type === 'freehand')
          if (node && change.position) {
            freehandNodeUpdates.push({
              id: change.id,
              position: change.position,
            })
          }
        }
        
        // Check if this is a dimension change (resize) for a freehand node
        if (change.type === 'dimensions' && change.dimensions) {
          const node = nodes.find((n) => n.id === change.id && n.type === 'freehand')
          if (node) {
            freehandNodeUpdates.push({
              id: change.id,
              width: change.dimensions.width,
              height: change.dimensions.height,
            })
          }
        }
      })

      // Update freehand nodes in database (async, don't block UI)
      if (freehandNodeUpdates.length > 0) {
        const updateFreehandNodes = async () => {
          try {
            const supabase = createClient()
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            // Update each freehand node
            for (const update of freehandNodeUpdates) {
              const updateData: { position_x?: number; position_y?: number; width?: number; height?: number } = {}
              if (update.position) {
                updateData.position_x = update.position.x
                updateData.position_y = update.position.y
              }
              if (update.width !== undefined) {
                updateData.width = update.width
              }
              if (update.height !== undefined) {
                updateData.height = update.height
              }

              const { error } = await supabase
                .from('canvas_nodes')
                .update(updateData)
                .eq('id', update.id)
                .eq('conversation_id', conversationId)
                .eq('user_id', user.id)

              if (error) {
                console.error('🎨 Error updating freehand node in database:', error, { nodeId: update.id })
              } else {
                console.log('🎨 ✅ Updated freehand node in database:', update.id)
              }
            }
          } catch (error) {
            console.error('🎨 Error updating freehand nodes:', error)
          }
        }

        // Update asynchronously (don't block UI)
        updateFreehandNodes()
      }
    }

    // Track when a target node (connected to placeholder) is being dragged to hide placeholders
    // Don't hide placeholders when the placeholder itself is being dragged
    let hasTargetNodeDragging = false
    const placeholderNodes = nodes?.filter((n) => n.type === 'placeholder') || []
    
    changesToProcess.forEach((change) => {
      if (change.type === 'position' && change.dragging === true) {
        // Check if this node is a placeholder - if so, don't hide placeholders
        const node = nodes?.find((n) => n.id === change.id)
        if (node?.type === 'placeholder') {
          return // Don't hide placeholders when dragging the placeholder itself
        }
        
        // Check if this node is the target of any placeholder (the node the placeholder is connected to)
        const isTargetNode = placeholderNodes.some(
          (placeholder) => placeholder.data?.targetNodeId === change.id
        )
        
        // Only hide placeholders if this is a target node being dragged
        if (isTargetNode && node?.selected) {
          hasTargetNodeDragging = true
        }
      } else if (change.type === 'position' && change.dragging === false) {
        // Drag ended - clear drag state
        const node = nodes?.find((n) => n.id === change.id)
        if (node?.type !== 'placeholder') {
          setIsSelectedNodeDragging(false)
        }
      }
    })
    
    // Update drag state only if a target node is being dragged
    if (hasTargetNodeDragging) {
      setIsSelectedNodeDragging(true)
    }

    // Update selected node ref first
    changesToProcess.forEach((change) => {
      if (change.type === 'select' && change.selected) {
        selectedNodeIdRef.current = change.id
        // Dispatch event when node is selected so input can refocus
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('node-selected'))
        }
      } else if (change.type === 'select' && !change.selected) {
        // If this node was deselected, check if any other node is selected
        const selectedNode = nodes && Array.isArray(nodes) ? nodes.find((n) => n.id === change.id && n.selected) : null
        if (!selectedNode) {
          // Check if any other node is selected
          const anySelected = nodes && Array.isArray(nodes) ? nodes.some((n) => n.id !== change.id && n.selected) : false
          if (!anySelected) {
            selectedNodeIdRef.current = null
          }
        }
      }
    })

    // Frame move never leaves a selection — deselect as soon as drag starts and again on drag end
    // (blue box comes from `dragging`, not `selected`).
    const frameDragSelectClearIds = new Set<string>([...draggedNodeIds, ...dragEndedNodeIds])
    if (frameDragSelectClearIds.size > 0) {
      const deselectChanges: Array<{ type: 'select'; id: string; selected: false }> = []
      frameDragSelectClearIds.forEach((nodeId) => {
        const node = nodes?.find((n) => n.id === nodeId)
        if (node?.type !== 'chatPanel') return
        deselectChanges.push({ type: 'select', id: nodeId, selected: false })
      })
      if (deselectChanges.length > 0) {
        changesToProcess = [...changesToProcess, ...deselectChanges]
      }
    }

    // Camera rotate: RF applies screen deltas along unrotated axes — rewrite so frames follow the finger
    changesToProcess = applyBoardRotationToPositionChanges(changesToProcess, nodes)

    // Apply helper lines snapping if enabled (before calling onNodesChange)
    const updatedChanges = snapEnabled ? updateHelperLines(changesToProcess, nodes) : changesToProcess
    
    // Call the original handler - this is necessary for React Flow to work
    // (Only if we haven't already called it above for placeholder interaction)
    onNodesChange(updatedChanges)

    // In linear mode, if there was a selection change, prevent any viewport adjustments
    // by setting a flag that onMove will check
    if (hasSelectionChange && viewMode === 'linear') {
      // Set a flag to prevent viewport adjustments in onMove for a short time
      selectionJustChangedRef.current = true
      setTimeout(() => {
        selectionJustChangedRef.current = false
      }, 500) // Clear flag after 500ms
      return
    }
  }, [onNodesChange, nodes, viewMode, setNodes, deleteNodesByIds, recalculateEdgeHandles, takeSnapshot, getChronologicalPanels, linearNavMode, centerPanelAbovePrompt, snapEnabled, updateHelperLines, rfStore])

  // Track selected node from nodes array
  // Don't trigger viewport changes on selection in linear mode
  useEffect(() => {
    if (!nodes || !Array.isArray(nodes)) return
    const selectedNode = nodes.find((n) => n.selected)
    if (selectedNode) {
      selectedNodeIdRef.current = selectedNode.id
    } else {
      selectedNodeIdRef.current = null
    }
    // Publish selected frames (+ content preview for pill hover) for AI composer
    const frames = nodes
      .filter((n) => n.selected && n.type === 'chatPanel' && n.data?.promptMessage?.id)
      .map((n) => {
        const msg = n.data.promptMessage as {
          id: string
          content?: string
          metadata?: Record<string, unknown>
        }
        const meta = (msg.metadata || {}) as Record<string, unknown>
        const titled =
          typeof meta.blockTitle === 'string' && meta.blockTitle.trim()
            ? meta.blockTitle.trim()
            : ''
        const plain = htmlToPlain(msg.content || '')
        return {
          id: String(msg.id),
          preview: titled ? `${titled}\n${plain}`.trim() : plain,
        }
      })
    setAiSelectedFrames(frames)
    // Keep viewport center fresh for Edit create placement (even without pan)
    if (reactFlowInstance) {
      const pane = document.querySelector('.react-flow')
      if (pane) {
        const r = pane.getBoundingClientRect()
        const c = reactFlowInstance.screenToFlowPosition({
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
        })
        setAiViewportCenter(c)
      }
    }
    // Don't trigger any viewport changes here - selection should not move the viewport in linear mode
  }, [nodes, reactFlowInstance])

  // Restore nav mode and selected tag from URL param when board loads and focus first flashcard
  useEffect(() => {
    if (!conversationId || !reactFlowInstance) return
    
    // Check for nav param in URL
    const navParam = searchParams?.get('nav')
    const tagParam = searchParams?.get('tag')
    
    if (navParam === 'flashcard') {
      // Restore flashcard nav mode if not already active
      if (flashcardMode !== 'flashcard') {
        setFlashcardMode('flashcard')
      }
      
      // Restore selected tag if present in URL
      if (tagParam && setSelectedTag) {
        setSelectedTag(tagParam)
      }
      
      // Wait for nodes to be created, then focus first flashcard
      // Use a small delay to ensure nodes are fully rendered
      const timeoutId = setTimeout(() => {
        if (hasFlashcardsInBoard && nodes.length > 0) {
          // Find first flashcard node (filtered by tag if tag param is present)
          const firstFlashcardNode = nodes.find((node) => {
            const nodeData = node.data as ChatPanelNodeData
            const nodeIsFlashcard = nodeData.promptMessage?.metadata?.isFlashcard === true
            if (!nodeIsFlashcard) return false
            
            // If tag param is present, check if flashcard has that tag
            if (tagParam) {
              const responseMessage = nodeData.responseMessage
              if (responseMessage?.metadata) {
                const metadata = responseMessage.metadata as Record<string, any>
                const studySetIds = (metadata.studySetIds || []) as string[]
                if (!studySetIds.includes(tagParam)) {
                  return false // Skip flashcards without the selected tag
                }
              } else {
                return false // No response message or metadata, can't have the tag
              }
            }
            
            return true
          })
          
          if (firstFlashcardNode && !firstFlashcardNode.selected) {
            // Select and focus the first flashcard
            setNodes((nds) =>
              nds.map((n) => ({ ...n, selected: n.id === firstFlashcardNode.id }))
            )
            // Scroll to the flashcard
            reactFlowInstance.fitView({ nodes: [{ id: firstFlashcardNode.id }], padding: 0.2, duration: 300 })
            // Remove nav and tag params from URL after focusing (keep clean URL)
            router.replace(`/board/${conversationId}`)
          }
        }
      }, 500) // Wait 500ms for nodes to be created
      
      return () => clearTimeout(timeoutId)
    }
  }, [conversationId, searchParams, flashcardMode, setFlashcardMode, hasFlashcardsInBoard, nodes, reactFlowInstance, setNodes, router])

  // Load canvas positions from localStorage when conversation changes
  useEffect(() => {
    if (!conversationId || viewMode !== 'canvas') return

    try {
      const layout = readFrameLayoutCache(conversationId)
      Object.entries(layout).forEach(([nodeId, pos]) => {
        originalPositionsRef.current.set(nodeId, { x: pos.x, y: pos.y })
      })
    } catch (error) {
      console.error('Failed to load canvas positions from localStorage:', error)
    }
  }, [conversationId, viewMode])

  // Save canvas positions to localStorage (debounced, lightweight)
  const saveCanvasPositions = useCallback(() => {
    // Save positions in both canvas and linear modes to prevent respacing on reload
    if (!conversationId || !nodes || !Array.isArray(nodes) || nodes.length === 0) return

    // Clear existing timeout
    if (savePositionsTimeoutRef.current) {
      clearTimeout(savePositionsTimeoutRef.current)
    }

    // Debounce saves (500ms delay)
    savePositionsTimeoutRef.current = setTimeout(() => {
      try {
        if (!nodes || !Array.isArray(nodes)) return
        const layout: FrameLayoutCache = {}
        nodes.forEach((node) => {
          if (node.type === 'frameShimmer' || node.type === 'placeholder') return // Don’t persist load shells
          if (node.type !== 'chatPanel' && node.type !== 'blockGroup') return // Frames (+ legacy groups) only
          const abs = absFlowPosition(node, nodes) // Always page-absolute (grouped nodes are relative in RF)
          const data = node.data as ChatPanelNodeData | undefined
          const html = data?.promptMessage?.content
          const hasText = frameHasVisibleText(html)
          const w =
            typeof node.width === 'number'
              ? node.width
              : typeof (node.style as { width?: number } | undefined)?.width === 'number'
                ? (node.style as { width: number }).width
                : undefined
          const h =
            typeof node.height === 'number'
              ? node.height
              : typeof (node.style as { height?: number } | undefined)?.height === 'number'
                ? (node.style as { height: number }).height
                : undefined
          layout[node.id] = {
            x: abs.x,
            y: abs.y,
            width: w,
            height: h,
            hasText,
            barCount: hasText ? shimmerBarCountFromHtml(html) : undefined,
          }
        })
        if (Object.keys(layout).length === 0) return
        writeFrameLayoutCache(conversationId, layout)
      } catch (error) {
        console.error('Failed to save canvas positions to localStorage:', error)
      }
    }, 500)
  }, [conversationId, viewMode, nodes])

  // Sync stored positions with current node positions in both Canvas and Linear modes
  // This ensures any moves are remembered and panels don't respace on reload
  useEffect(() => {
    if (nodes && Array.isArray(nodes) && nodes.length > 0) {
      // Update stored positions with current positions in both modes
      nodes.forEach((node) => {
        originalPositionsRef.current.set(node.id, absFlowPosition(node, nodes)) // Cache absolute so reload doesn’t double-subtract group origin
      })

      // Save to localStorage (debounced) - works for both canvas and linear modes
      saveCanvasPositions()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, viewMode, saveCanvasPositions]) // Update when nodes change (including position changes) in both modes

  // Create panels from messages (group into prompt+response pairs)
  useEffect(() => {
    // Check cache for optimistic updates even if query isn't enabled yet
    let messagesToUse = messages
    if (conversationId && messages.length === 0) {
      const cached = queryClient.getQueryData(['messages-for-panels', conversationId]) as Message[] | undefined
      if (cached && cached.length > 0) {
        console.log('🔄 BoardFlow: Using cached messages for immediate panel creation:', cached.length)
        messagesToUse = cached
      }
    }

    // If we have conversationId but no messages (neither from query nor cache), wait
    if (conversationId && messagesToUse.length === 0) {
      console.log('🔄 BoardFlow: Waiting for messages to load for conversation:', conversationId)
      return
    }

    // Ids + roles only — content saves must not rebuild/remount panels (wipes the TipTap caret)
    const messagesKeyToUse = messagesToUse.map(m => `${m.id}:${m.role}`).join(',')
    console.log('🔄 BoardFlow: Creating panels from messages, count:', messagesToUse.length, 'messagesKey:', messagesKeyToUse, 'prevKey:', prevMessagesKeyRef.current)

    // Skip if messages haven't actually changed (keep shells in place until the load fade removes them)
    const hasShimmerShells = (nodes || []).some((n) => n.type === 'frameShimmer')
    const hasRealPanels = (nodes || []).some((n) => n.type === 'chatPanel') // Already swapped in this load
    if (messagesKeyToUse === prevMessagesKeyRef.current && (hasRealPanels || !hasShimmerShells)) {
      console.log('🔄 BoardFlow: Messages key unchanged, skipping panel creation')
      return
    }

    console.log('🔄 BoardFlow: Messages changed, creating panels')
    prevMessagesKeyRef.current = messagesKeyToUse

    if (!conversationId || messagesToUse.length === 0) {
      // Keep an in-flight I-bar frame on empty /board — clearing unmounts TipTap mid-type
      if ((nodes || []).some((n) => n.type === 'chatPanel')) return
      console.log('🔄 BoardFlow: No conversationId or messages, clearing nodes')
      setNodes([])
      originalPositionsRef.current.clear()
      // Clear saved positions for this conversation
      if (typeof window !== 'undefined') {
        try {
          localStorage.removeItem(`thinktable-canvas-positions-${conversationId}`)
        } catch (error) {
          console.error('Failed to clear canvas positions from localStorage:', error)
        }
      }
      return
    }

    const newNodes: Node<ChatPanelNodeData>[] = []
    const blockGroupNodes: Node[] = [] // Visual group frames (not chat panels)
    const gapBetweenPanels = 50 // Fixed gap between panels (size-aware spacing)
    let panelIndex = 0 // Track panel index for consistent spacing

    // Calculate centered x position for new panels
    // Always center based on viewport for proper centering
    const reactFlowElement = document.querySelector('.react-flow')
    const viewportWidth = reactFlowElement ? reactFlowElement.clientWidth : 1200
    const viewportHeight = reactFlowElement ? reactFlowElement.clientHeight : 800
    const panelWidth = 500
    let centeredX = (viewportWidth / 2) - (panelWidth / 2) // Center horizontally    

    // If we have existing nodes, use their average to maintain alignment
    if (nodes && Array.isArray(nodes) && nodes.length > 0) {
      const existingXPositions = nodes.map(n => n.position.x)
      if (existingXPositions.length > 0) {
        const avgX = existingXPositions.reduce((sum, x) => sum + x, 0) / existingXPositions.length
        // Only use existing average if it's reasonably close to centered (within 200px)
        // Otherwise, use centered position to fix misalignment
        if (Math.abs(avgX - centeredX) < 200) {
          centeredX = avgX
        }
      }
    }

    // Calculate starting Y position - use same spacing as linear mode for consistency
    // Linear mode uses: startY = 0, then y = startY + (index * panelSpacing)
    // Canvas mode should use the same default spacing when no stored position exists
    const startY = 0 // Same as linear mode - start at y=0
    let currentY = startY // Start at 0, will increase as we add panels (top to bottom)

    // Group messages into prompt+response pairs
    // With deterministic mapping, multiple assistant messages can follow one user message
    // Process messages in reverse order so newest panels appear at bottom, oldest at top
    console.log('🔄 BoardFlow: Grouping messages into panels, total messages:', messagesToUse.length)

    // Process messages from end to start (newest first) to place newest panels at bottom
    let i = messagesToUse.length - 1
    while (i >= 0) {
      const message = messagesToUse[i]

      if (message.role === 'user') {
        // Legacy frame wrappers (`blockGroup`) — built in a second pass (not frames)
        if (isBlockGroupMeta(message.metadata as Record<string, unknown>)) {
          i--
          continue
        }

        // Find all consecutive assistant messages that follow this user message (in original order)
        // Since we're processing backwards, assistant messages are at higher indices (already passed)
        // So we need to look ahead in the original array
        const responseMessages: Message[] = []
        let j = i + 1
        while (j < messagesToUse.length && messagesToUse[j].role === 'assistant') {
          responseMessages.push(messagesToUse[j])
          j++
        }

        // Move backwards to the next user message
        // Since we're going backwards, just decrement i (we've already processed this user and its assistants)
        i--

        // Get node ID and position setup (shared for all panels from this user message)
        const baseNodeId = `panel-${message.id}`
        let storedPos = originalPositionsRef.current.get(baseNodeId)
        
        // Prefer explicit metadata.position (inline block / add-block menu spawn at click).
        // Always-absolute; required for grouped blocks so localStorage relative leftovers don’t double-subtract.
        const metadataPosition = message.metadata?.position as { x: number; y: number } | undefined
        const hasGroup = typeof (message.metadata as Record<string, unknown> | undefined)?.blockGroupId === 'string'

        if (metadataPosition && (!storedPos || hasGroup)) {
          storedPos = metadataPosition // Source of truth after persist / for grouped cards
          originalPositionsRef.current.set(baseNodeId, metadataPosition) // Cache in memory
        }

        // If not in memory, try loading from localStorage (works for both canvas and linear modes)
        // This ensures positions are preserved on reload regardless of view mode
        if (!storedPos && conversationId && typeof window !== 'undefined') {
          try {
            const savedPos = readFrameLayoutCache(conversationId)[baseNodeId]
            if (savedPos) {
              storedPos = { x: savedPos.x, y: savedPos.y }
              originalPositionsRef.current.set(baseNodeId, storedPos) // Cache in memory
            }
          } catch (error) {
            console.error('Failed to load position from localStorage:', error)
          }
        }

        // Calculate position based on arrow direction relative to most recent panel
        // Default: vertical top-to-bottom (down arrow)
        let currentPos: { x: number; y: number }

        if (storedPos?.x !== undefined && storedPos?.y !== undefined) {
          // Use stored position if available (user moved it or was saved before)
          // Works in both canvas and linear modes to prevent respacing on reload
          currentPos = { x: storedPos.x, y: storedPos.y }
        } else {
          // First, check if there's a placeholder node - use its position if available
          const existingNodes = nodes && Array.isArray(nodes) ? nodes : []
          const placeholderNode = existingNodes.find(n => n.type === 'placeholder')
          
          if (placeholderNode) {
            // Use placeholder position for new panel
            currentPos = { x: placeholderNode.position.x, y: placeholderNode.position.y }
            console.log('📍 Using placeholder position for new panel', { 
              placeholderPos: currentPos, 
              placeholderId: placeholderNode.id 
            })
          } else {
            // Find reference panel: use selected panel if one is selected, otherwise use most recent panel
            let referenceNode: Node<ChatPanelNodeData> | null = null

            if (existingNodes.length > 0) {
              // First, check if there's a selected panel (this overrides most recent)
              const selectedNode = existingNodes.find(n => n.selected)

              if (selectedNode) {
                // Use selected panel as reference
                referenceNode = selectedNode
              } else {
                // No selected panel - find node with the newest message (highest message ID or latest created_at)
                // Filter to only chatPanel nodes (skip freehand nodes)
                const chatPanelNodes = existingNodes.filter(n => n.data.promptMessage?.id)
                if (chatPanelNodes.length > 0) {
                  referenceNode = chatPanelNodes.reduce((newest, node) => {
                    const newestMessageId = newest.data.promptMessage.id
                    const nodeMessageId = node.data.promptMessage.id
                    // Compare message IDs (they're UUIDs, but newer ones should be lexicographically greater)
                    // Or compare created_at if available
                    const newestCreated = new Date(newest.data.promptMessage.created_at || 0).getTime()
                    const nodeCreated = new Date(node.data.promptMessage.created_at || 0).getTime()
                    return nodeCreated > newestCreated ? node : newest
                  }, chatPanelNodes[0])
                }
              }
            }

            if (referenceNode) {
              // Position relative to reference panel (selected or most recent) based on arrow direction
              // Use actual panel height for size-aware spacing
              const referenceHeight = nodeHeightsRef.current.get(referenceNode.id) || 400
              const baseX = referenceNode.position.x
              const baseY = referenceNode.position.y

              // In canvas mode, use arrow direction for positioning
              // In linear mode, always use down (vertical stacking)
              const directionToUse = viewMode === 'canvas' ? arrowDirection : 'down'

              switch (directionToUse) {
                case 'down':
                  // Place below (increase Y): baseY + panel height + gap
                  currentPos = { x: baseX, y: baseY + referenceHeight + gapBetweenPanels }
                  break
                case 'up':
                  // Place above (decrease Y): baseY - gap (we'll use estimated height for new panel)
                  const estimatedNewHeight = 400
                  currentPos = { x: baseX, y: baseY - estimatedNewHeight - gapBetweenPanels }
                  break
                case 'right':
                  // Place to the right (increase X): use panel width + gap for size-aware spacing
                  const panelWidthForSpacing = contextPanelWidth || 768
                  currentPos = { x: baseX + panelWidthForSpacing + gapBetweenPanels, y: baseY }
                  break
                case 'left':
                  // Place to the left (decrease X): use panel width + gap for size-aware spacing
                  const panelWidthForSpacingLeft = contextPanelWidth || 768
                  currentPos = { x: baseX - panelWidthForSpacingLeft - gapBetweenPanels, y: baseY }
                  break
                default:
                  // Default to down (below)
                  currentPos = { x: baseX, y: baseY + referenceHeight + gapBetweenPanels }
              }
            } else {
              // No existing panels or in linear mode: use size-aware vertical spacing
              // Calculate cumulative height of previous panels
              let cumulativeY = startY
              for (let i = 0; i < panelIndex; i++) {
                // Find the previous panel's height (if we had access to previous nodes)
                // For now, use estimated height for new panels
                const estimatedHeight = 400
                cumulativeY += estimatedHeight + gapBetweenPanels
              }
              currentPos = {
                x: centeredX,
                y: cumulativeY
              }
            }
          }
        }

        // With deterministic mapping, create separate panels for each assistant message
        // This allows multiple panels to be created from one user prompt
        if (responseMessages.length > 0) {
          // Create a panel for each assistant message
          responseMessages.forEach((responseMessage, responseIndex) => {
            // Use the user message ID for the first panel, append response message ID for subsequent ones to ensure uniqueness
            // This prevents duplicate keys when the same user message has multiple responses
            const nodeId = responseIndex === 0
              ? baseNodeId
              : `${baseNodeId}-panel-${responseMessage.id}`

            console.log('🔄 BoardFlow: Creating panel for user message:', message.id, 'with response:', responseMessage.id, `(panel ${responseIndex + 1}/${responseMessages.length})`)

            // For subsequent panels from the same user message, stack them in the arrow direction
            let panelPosition: { x: number; y: number }
            if (responseIndex === 0) {
              panelPosition = currentPos
            } else {
              // Stack subsequent panels in the arrow direction with size-aware spacing
              const estimatedPanelHeight = 400
              switch (arrowDirection) {
                case 'down':
                  // Stack below: current position + (previous panel height + gap) * index
                  panelPosition = {
                    x: currentPos.x,
                    y: currentPos.y + (responseIndex * (estimatedPanelHeight + gapBetweenPanels))
                  }
                  break
                case 'up':
                  // Stack above: current position - (panel height + gap) * index
                  panelPosition = {
                    x: currentPos.x,
                    y: currentPos.y - (responseIndex * (estimatedPanelHeight + gapBetweenPanels))
                  }
                  break
                case 'right':
                  // Stack to the right: use panel width + gap for size-aware spacing
                  const panelWidthForStackRight = contextPanelWidth || 768
                  panelPosition = {
                    x: currentPos.x + (responseIndex * (panelWidthForStackRight + gapBetweenPanels)),
                    y: currentPos.y
                  }
                  break
                case 'left':
                  // Stack to the left: use panel width + gap for size-aware spacing
                  const panelWidthForStackLeft = contextPanelWidth || 768
                  panelPosition = {
                    x: currentPos.x - (responseIndex * (panelWidthForStackLeft + gapBetweenPanels)),
                    y: currentPos.y
                  }
                  break
                default:
                  panelPosition = {
                    x: currentPos.x,
                    y: currentPos.y + (responseIndex * (estimatedPanelHeight + gapBetweenPanels))
                  }
              }
            }

            // Load panel styling from message metadata (fillColor, borderColor, borderStyle, borderWeight)
            const messageMetadata = message.metadata || {}
            const stackIndex = minStackIndex(messageMetadata as Record<string, unknown>)
            const panelNode: Node<ChatPanelNodeData> = {
              id: nodeId,
              type: 'chatPanel',
              position: panelPosition,
              data: {
                promptMessage: message, // Same user message for all panels
                responseMessage: responseMessage, // Different response for each panel
                conversationId: conversationId || '',
                isResponseCollapsed: false, // Initialize collapse state
                // Load panel styling from message metadata
                // Normalize null to empty string for fillColor (transparent) and 'none' for borderStyle
                fillColor: messageMetadata.fillColor === null ? '' : (messageMetadata.fillColor || undefined),
                borderColor: messageMetadata.borderColor === null ? undefined : (messageMetadata.borderColor || undefined),
                borderStyle: messageMetadata.borderStyle === null ? 'none' : (messageMetadata.borderStyle || undefined),
                borderWeight: messageMetadata.borderWeight === null ? undefined : (messageMetadata.borderWeight || undefined),
                frameShape: parseFrameShape(messageMetadata.frameShape) ?? undefined,
              },
              draggable: !isLocked && messageMetadata.boardLocked !== true, // Global freeze or per-frame board pin
              // Collapsed stack mates stay hidden until edge-line reveal
              hidden: isStackCollapsedMeta(messageMetadata as Record<string, unknown>),
              zIndex: stackIndex == null ? undefined : Math.max(0, 10 - stackIndex),
            }

            // Store position
            originalPositionsRef.current.set(nodeId, panelPosition)

            newNodes.push(panelNode)
            // Don't increment panelIndex here - all response panels from one user message should be at the same base Y
          })

          // Increment panelIndex after all response panels for this user message are created
          // This ensures the next user message is spaced below
          panelIndex++

          if (responseMessages.length > 1) {
            console.log('🔄 BoardFlow: Created', responseMessages.length, 'separate panels from one user message (deterministic mapping)')
          }
        } else {
          // No assistant messages found - create panel with just the user message
          const isBlock = message.metadata?.isBlock === true // Map block card
          console.log('🔄 BoardFlow: Creating panel for user message:', message.id, 'with response: none', isBlock ? '(block)' : '')

          // Load panel styling from message metadata (fillColor, borderColor, borderStyle, borderWeight)
          const messageMetadata = message.metadata || {}
          const stackIndex = minStackIndex(messageMetadata as Record<string, unknown>)
          const panelNode: Node<ChatPanelNodeData> = {
            id: baseNodeId,
            type: 'chatPanel',
            position: currentPos,
            data: {
              promptMessage: message,
              responseMessage: undefined, // No response yet (notes never have responses)
              conversationId: conversationId || '',
              isResponseCollapsed: false, // Initialize collapse state
              // Load panel styling from message metadata
              // Normalize null to empty string for fillColor (transparent) and 'none' for borderStyle
              fillColor: messageMetadata.fillColor === null ? '' : (messageMetadata.fillColor || undefined),
              borderColor: messageMetadata.borderColor === null ? undefined : (messageMetadata.borderColor || undefined),
              borderStyle: messageMetadata.borderStyle === null ? 'none' : (messageMetadata.borderStyle || undefined),
              borderWeight: messageMetadata.borderWeight === null ? undefined : (messageMetadata.borderWeight || undefined),
              frameShape: parseFrameShape(messageMetadata.frameShape) ?? undefined,
            },
            draggable: !isLocked && messageMetadata.boardLocked !== true, // Global freeze or per-frame board pin
            // Collapsed stack mates stay hidden until edge-line reveal
            hidden: isStackCollapsedMeta(messageMetadata as Record<string, unknown>),
            zIndex: stackIndex == null ? undefined : Math.max(0, 10 - stackIndex),
          }

          // Store position
          originalPositionsRef.current.set(baseNodeId, currentPos)

          newNodes.push(panelNode)
          panelIndex++ // Increment for next panel
        }
      } else {
        // Skip assistant messages that aren't part of a user-assistant pair
        // (they should have been processed in the user message loop above)
        // Since we're going backwards, decrement i
        i--
      }
    }

    // Build visual block-group frames from isBlockGroup messages
    for (const message of messagesToUse) {
      if (!isBlockGroupMeta(message.metadata as Record<string, unknown>)) continue
      const nodeId = blockGroupNodeId(message.id)
      const meta = (message.metadata || {}) as Record<string, unknown>
      const metaPos = meta.position as { x: number; y: number } | undefined
      const storedPos = originalPositionsRef.current.get(nodeId)
      const position = storedPos || metaPos || { x: 0, y: 0 }
      const dims = (meta.resizeDimensions as { width: number; height: number } | undefined) || {
        width: 400,
        height: 300,
      }
      blockGroupNodes.push({
        id: nodeId,
        type: 'blockGroup',
        position,
        style: { width: dims.width, height: dims.height }, // Visible dashed frame (sibling of cards)
        data: { conversationId: conversationId || '' },
        draggable: false, // RF never drags the group — only the dashed ring (custom pointer) does
        selectable: true,
        zIndex: 0, // Behind child cards, still above the canvas
      })
      originalPositionsRef.current.set(nodeId, position)
    }

    // Groups are visual siblings of cards (no RF parentId) — keep page-absolute positions.
    // Convert any leftover RF-parented coords so a reload doesn’t jump.
    const groupPosById = new Map(blockGroupNodes.map((g) => [g.id, g.position]))
    for (const node of newNodes) {
      const existing = nodes?.find((n) => n.id === node.id)
      if (existing?.parentId) {
        const groupPos = groupPosById.get(existing.parentId)
        node.position = {
          x: existing.position.x + (groupPos?.x ?? 0), // Relative → absolute
          y: existing.position.y + (groupPos?.y ?? 0),
        }
      }
      delete (node as { parentId?: string }).parentId // RF treats the key as parented even if undefined
      delete (node as { parentNode?: string }).parentNode
      delete (node as { extent?: unknown }).extent
      node.zIndex = 1 // Cards above the dashed group frame
    }

    // Deduplicate nodes by ID to prevent duplicate key errors
    const nodeMap = new Map<string, Node<ChatPanelNodeData>>()
    newNodes.forEach(node => {
      // If duplicate ID found, keep the one with response message (more complete)
      if (nodeMap.has(node.id)) {
        const existing = nodeMap.get(node.id)!
        if (!existing.data.responseMessage && node.data.responseMessage) {
          nodeMap.set(node.id, node)
        }
        // Otherwise keep existing (don't overwrite with less complete node)
      } else {
        nodeMap.set(node.id, node)
      }
    })
    const deduplicatedNodes = [...Array.from(nodeMap.values()), ...blockGroupNodes] as Node[]

    console.log('🔄 BoardFlow: Created', deduplicatedNodes.length, 'panels from', messagesToUse.length, 'messages (after deduplication)')
    console.log('🔄 BoardFlow: Messages order:', messagesToUse.map(m => ({ id: m.id, role: m.role, content: m.content.substring(0, 30) })))
    console.log('🔄 BoardFlow: Panel details:', deduplicatedNodes.map(n => ({
      id: n.id,
      promptId: n.data.promptMessage?.id, // Use optional chaining for freehand nodes
      hasResponse: !!n.data.responseMessage,
      responseId: n.data.responseMessage?.id,
      position: n.position
    })))

    // Canvas mode - add new nodes and update existing nodes that need updates (e.g., response added)
      // Find existing nodes (those that already exist in current nodes array)
      const existingNodeIds = new Set(nodes && Array.isArray(nodes) ? nodes.map(n => n.id) : [])
      const trulyNewNodesCanvas = deduplicatedNodes.filter(n => !existingNodeIds.has(n.id))
      const nodesToUpdateCanvas = deduplicatedNodes.filter(n => {
        if (!existingNodeIds.has(n.id)) return false // Not an existing node
        const existingNode = nodes.find(existing => existing.id === n.id)
        if (!existingNode) return false
        // Load shells use prefixed ids — never treat them as the real frame
        if (existingNode.type === 'frameShimmer') return false
        // Update if response changed (e.g., response was added or updated)
        const existingResponseId = existingNode.data?.responseMessage?.id
        const newResponseId = n.data?.responseMessage?.id
        // Also refresh when group membership / frame geometry changes
        const groupChanged =
          existingNode.parentId !== n.parentId ||
          Boolean(existingNode.parentId) || // Drop leftover RF parenting
          existingNode.type === 'blockGroup' ||
          n.type === 'blockGroup'
        return existingResponseId !== newResponseId || groupChanged
      })
      // Keep local-only nodes + message nodes that do not need a data refresh — but always
      // re-apply fresh `draggable` from metadata (?? kept stale false after Linear / pin / bugs;
      // Lock-to-board toggle “fixed” drag only because it forced draggable:true).
      const unchangedNodesCanvas = nodes
        .filter((n) => {
          if (n.type === 'frameShimmer') return true // Keep shells until the load fade unmounts them
          const needsUpdate = nodesToUpdateCanvas.some((update) => update.id === n.id)
          const stillInMessages =
            n.type === 'freehand' ||
            n.type === 'shape' ||
            n.type === 'placeholder' ||
            deduplicatedNodes.some((d) => d.id === n.id)
          return !needsUpdate && stillInMessages
        })
        .map((n) => {
          if (n.type === 'blockGroup') {
            return n.draggable === false ? n : { ...n, draggable: false }
          }
          const fresh = deduplicatedNodes.find((d) => d.id === n.id)
          if (!fresh || fresh.draggable === n.draggable) return n
          return { ...n, draggable: fresh.draggable }
        })

      console.log('🔄 BoardFlow: Adding', trulyNewNodesCanvas.length, 'new canvas nodes, updating', nodesToUpdateCanvas.length, 'existing nodes, keeping', unchangedNodesCanvas.length, 'unchanged')

      // Update existing nodes that need updates (e.g., response was added) - keep their positions
      const updatedExistingNodesCanvas = nodesToUpdateCanvas.map(node => {
        const existingNode = nodes.find(n => n.id === node.id)
        const sameParent = existingNode?.parentId === node.parentId
        return {
          ...node,
          // Keep position only when group parenting did not change (relative vs absolute)
          position: sameParent ? (existingNode?.position ?? node.position) : node.position,
          parentId: node.parentId,
          extent: node.extent,
          style: node.style ?? existingNode?.style,
          zIndex: node.zIndex ?? existingNode?.zIndex, // Cards above group frame
          // Always take freshly computed draggable (!isLocked && !boardLocked). Do NOT prefer
          // existingNode.draggable — `false ?? true` stays false and stuck frames until anchor toggle.
          draggable: node.type === 'blockGroup' ? false : node.draggable,
        }
      })

      // Merge: unchanged nodes + updated nodes + new nodes
      const updatedCanvasNodes = [...unchangedNodesCanvas, ...updatedExistingNodesCanvas, ...trulyNewNodesCanvas]
      
      // Take snapshot only when exactly ONE new panel is added (incremental creation, not bulk load)
      // This ensures each panel can be undone individually, not all at once
      if (trulyNewNodesCanvas.length === 1) takeSnapshot()
      
      setNodes(updatedCanvasNodes)
      if (boardLoadPhaseRef.current === 'cold') {
        setBoardLoadPhase('reveal') // Same paint: shells fade out, real nodes/edges fade in
      }

      // Persist new frame positions only — never recenter or force 100% zoom on create
      // (I-bar / grip / AI / Notion frames must stay under the user’s current viewport)
      if (trulyNewNodesCanvas.length > 0) {
        trulyNewNodesCanvas.forEach((node) => {
          originalPositionsRef.current.set(node.id, {
            x: node.position.x, // Cache flow coords for reload / mode switches
            y: node.position.y,
          })

          if (conversationId && typeof window !== 'undefined') {
            try {
              patchFrameLayoutEntry(conversationId, node.id, {
                x: node.position.x,
                y: node.position.y,
              })
            } catch (error) {
              console.error('Failed to save position to localStorage:', error)
            }
          }
        })
      }
    // Update prevArrowDirectionRef after panel creation
    prevArrowDirectionRef.current = arrowDirection
  }, [messagesKey, conversationId, messages.length, viewMode, setNodes, arrowDirection, nodes, takeSnapshot])

  // Handle arrow direction change when panels are selected
  // Format selected panels relative to each other based on arrow direction
  useEffect(() => {
    // Only run if arrow direction changed and at least one node is selected
    if (prevArrowDirectionRef.current === arrowDirection) return
    if (viewMode !== 'canvas') return // Only in canvas mode

    // Find all selected nodes (only chatPanel nodes for this operation)
    const selectedChatPanelNodes = nodes.filter(n => n.selected && n.data.promptMessage?.id)
    if (selectedChatPanelNodes.length === 0) return // No chat panels selected

    const selectedNodeIds = new Set(selectedChatPanelNodes.map(n => n.id))
    const gapBetweenPanels = 50 // Fixed gap between panels

    // Find the most recent selected panel (anchor point)
    const anchorNode = selectedChatPanelNodes.reduce((newest, node) => {
      const newestCreated = new Date(newest.data.promptMessage.created_at || 0).getTime()
      const nodeCreated = new Date(node.data.promptMessage.created_at || 0).getTime()
      return nodeCreated > newestCreated ? node : newest
    }, selectedChatPanelNodes[0])

    // Use anchor node's current position as the base
    const baseX = anchorNode.position.x
    const baseY = anchorNode.position.y
    const anchorHeight = nodeHeightsRef.current.get(anchorNode.id) || 400

    // Sort selected nodes by their current position to determine stacking order
    // For vertical directions (up/down), sort by Y; for horizontal (left/right), sort by X
    const sortedSelectedNodes = [...selectedChatPanelNodes].sort((a, b) => {
      if (arrowDirection === 'down' || arrowDirection === 'up') {
        return a.position.y - b.position.y // Sort by Y for vertical stacking
      } else {
        return a.position.x - b.position.x // Sort by X for horizontal stacking
      }
    })

    // Update all selected nodes' positions
    // Stack them in the arrow direction relative to the anchor panel with size-aware spacing
    setNodes((nds) =>
      nds.map((n) => {
        if (!selectedNodeIds.has(n.id)) return n

        // Find the index of this node in the sorted selected nodes
        const selectedIndex = sortedSelectedNodes.findIndex(sn => sn.id === n.id)

        // If this is the anchor node, keep it at base position
        if (n.id === anchorNode.id) {
          const newPosition = { x: baseX, y: baseY }

          // Update stored position
          originalPositionsRef.current.set(n.id, newPosition)

          // Save to localStorage
          if (conversationId && typeof window !== 'undefined') {
            try {
              patchFrameLayoutEntry(conversationId, n.id, newPosition)
            } catch (error) {
              console.error('Failed to save position to localStorage:', error)
            }
          }

          return { ...n, position: newPosition }
        }

        // For other selected nodes, position them relative to anchor in arrow direction
        // Use uniform spacing (fixed gap) regardless of panel sizes for even formatting
        // Both horizontal and vertical use the same gap between panels (50px visual gap)
        const panelWidthForFormat = contextPanelWidth || 768
        const gapBetweenPanels = 50 // Visual gap between panels (same for both directions)
        const estimatedPanelHeight = 400
        // For vertical: use a smaller spacing that still provides the gap (panel height is accounted for by panel itself)
        // Use panel height + gap for proper spacing, but this might be too much, so let's try a middle value
        const verticalSpacing = 250 // Middle value between 50px (too small) and 450px (too big)
        let offsetX = 0
        let offsetY = 0

        if (selectedIndex > 0) {
          // Use uniform spacing based on index (not cumulative sizes)
          // Horizontal: panel width + gap, Vertical: fixed spacing that provides visual gap
          switch (arrowDirection) {
            case 'down':
              offsetY = selectedIndex * verticalSpacing
              break
            case 'up':
              offsetY = -(selectedIndex * verticalSpacing)
              break
            case 'right':
              offsetX = selectedIndex * (panelWidthForFormat + gapBetweenPanels)
              break
            case 'left':
              offsetX = -(selectedIndex * (panelWidthForFormat + gapBetweenPanels))
              break
          }
        }

        const newPosition = {
          x: baseX + offsetX,
          y: baseY + offsetY
        }

        // Update stored position
        originalPositionsRef.current.set(n.id, newPosition)

        // Save to localStorage
        if (conversationId && typeof window !== 'undefined') {
          try {
            patchFrameLayoutEntry(conversationId, n.id, newPosition)
          } catch (error) {
            console.error('Failed to save position to localStorage:', error)
          }
        }

        return { ...n, position: newPosition }
      })
    )

    // Update prevArrowDirectionRef
    prevArrowDirectionRef.current = arrowDirection
  }, [arrowDirection, nodes, setNodes, viewMode, conversationId])

  // Measure actual node heights after render (but don't reposition panels in linear mode)
  // Panels should maintain their positions - only measure heights for centering calculations
  useEffect(() => {
    if (!nodes || !Array.isArray(nodes) || nodes.length === 0 || !reactFlowInstance) return

    // Use setTimeout to ensure DOM is fully rendered
    const timeoutId = setTimeout(() => {
      const reactFlowElement = document.querySelector('.react-flow')
      if (!reactFlowElement) return

      const viewport = reactFlowInstance.getViewport()

      // Measure all node heights and store them (for centering calculations)
      // But don't reposition panels - they should maintain their user-defined positions
      nodes.forEach((node) => {
        // Find the React Flow node element by ID
        const nodeElement = reactFlowElement.querySelector(`[data-id="${node.id}"]`) as HTMLElement
        if (nodeElement) {
          // Measure actual height (accounting for zoom)
          const actualHeight = nodeElement.getBoundingClientRect().height / viewport.zoom
          nodeHeightsRef.current.set(node.id, actualHeight)
        }
      })
    }, 150) // Delay to ensure DOM is ready

    return () => clearTimeout(timeoutId)
  }, [nodes, reactFlowInstance])

  // Handle smooth slide-up animation when panels collapse
  useEffect(() => {
    if (!nodes || !Array.isArray(nodes) || nodes.length === 0 || !reactFlowInstance) return

    const reactFlowElement = document.querySelector('.react-flow')
    if (!reactFlowElement) return

    const viewport = reactFlowInstance.getViewport()

    // Helper function to animate panels below a collapsed/expanded panel
    const animatePanelsBelow = (
      collapsedNode: Node<ChatPanelNodeData>,
      heightDiff: number,
      allNodes: Node<ChatPanelNodeData>[],
      reactFlowInstance: any,
      reactFlowElement: HTMLElement,
      viewport: { zoom: number },
      isCollapsed: boolean
    ) => {
      // Find all nodes below this one (higher Y position)
      const nodesBelow: Node<ChatPanelNodeData>[] = allNodes.filter((n) => n.position.y > collapsedNode.position.y)

      if (nodesBelow.length === 0) return

      // Animate smoothly using requestAnimationFrame
      const startTime = performance.now()
      const duration = 300 // 300ms animation
      const startPositions = new Map(nodesBelow.map(n => [n.id, n.position.y]))

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime
        const progress = Math.min(elapsed / duration, 1)
        // Ease-out easing function
        const eased = 1 - Math.pow(1 - progress, 3)

        setNodes((currentNodes) => {
          return currentNodes.map((n) => {
            if (nodesBelow.some(below => below.id === n.id)) {
              const startY = startPositions.get(n.id) || n.position.y
              // Move up when collapsing (positive heightDiff), down when expanding (negative heightDiff)
              const newY = startY - (heightDiff * eased)
              return {
                ...n,
                position: { ...n.position, y: newY }
              }
            }
            return n
          })
        })

        if (progress < 1) {
          requestAnimationFrame(animate)
        } else {
          // Animation complete - update stored heights and positions
          const finalNodes = reactFlowInstance.getNodes()
          finalNodes.forEach((n: Node<ChatPanelNodeData>) => {
            const el = reactFlowElement.querySelector(`[data-id="${n.id}"]`) as HTMLElement
            if (el) {
              const height = el.getBoundingClientRect().height / viewport.zoom
              nodeHeightsRef.current.set(n.id, height)
            }
            originalPositionsRef.current.set(n.id, {
              x: n.position.x,
              y: n.position.y,
            })
          })
        }
      }

      requestAnimationFrame(animate)
    }

    // Find nodes that have collapsed/expanded (compare with previous state)
    nodes.forEach((node) => {
      const nodeElement = reactFlowElement.querySelector(`[data-id="${node.id}"]`) as HTMLElement
      if (!nodeElement) return

      const isCollapsed = node.data.isResponseCollapsed || false
      const prevCollapsed = prevCollapseStatesRef.current.get(node.id) || false

      // Only animate if collapse state actually changed
      if (isCollapsed === prevCollapsed) {
        // Update stored height but don't animate
        const currentHeight = nodeElement.getBoundingClientRect().height / viewport.zoom
        nodeHeightsRef.current.set(node.id, currentHeight)
        return
      }

      // State changed - measure heights before and after
      const currentHeight = nodeElement.getBoundingClientRect().height / viewport.zoom
      const storedHeight = nodeHeightsRef.current.get(node.id) || currentHeight

      // Wait for CSS transition to complete, then measure the actual height difference
      // This ensures we get the accurate height change after the collapse/expand animation
      setTimeout(() => {
        const newHeight = nodeElement.getBoundingClientRect().height / viewport.zoom
        const heightDiff = storedHeight - newHeight

        if (Math.abs(heightDiff) >= 10) {
          // Find all nodes below this one (higher Y position)
          const nodesBelow = nodes.filter((n: Node<ChatPanelNodeData>) => n.position.y > node.position.y)

          if (nodesBelow.length > 0) {
            // Animate smoothly using requestAnimationFrame
            const startTime = performance.now()
            const duration = 300 // 300ms animation
            const startPositions = new Map(nodesBelow.map(n => [n.id, n.position.y]))

            const animate = (currentTime: number) => {
              const elapsed = currentTime - startTime
              const progress = Math.min(elapsed / duration, 1)
              // Ease-out easing function
              const eased = 1 - Math.pow(1 - progress, 3)

              setNodes((currentNodes) => {
                return currentNodes.map((n) => {
                  if (nodesBelow.some(below => below.id === n.id)) {
                    const startY = startPositions.get(n.id) || n.position.y
                    // Move up when collapsing (positive heightDiff), down when expanding (negative heightDiff)
                    const newY = startY - (heightDiff * eased)
                    return {
                      ...n,
                      position: { ...n.position, y: newY }
                    }
                  }
                  return n
                })
              })

              if (progress < 1) {
                requestAnimationFrame(animate)
              } else {
                // Animation complete - update stored heights and positions
                const finalNodes = reactFlowInstance.getNodes()
                finalNodes.forEach((n: Node<ChatPanelNodeData>) => {
                  const el = reactFlowElement.querySelector(`[data-id="${n.id}"]`) as HTMLElement
                  if (el) {
                    const height = el.getBoundingClientRect().height / viewport.zoom
                    nodeHeightsRef.current.set(n.id, height)
                  }
                  originalPositionsRef.current.set(n.id, {
                    x: n.position.x,
                    y: n.position.y,
                  })
                })
              }
            }

            requestAnimationFrame(animate)
          }
        }

        // Update stored state and height
        prevCollapseStatesRef.current.set(node.id, isCollapsed)
        nodeHeightsRef.current.set(node.id, newHeight)
      }, 250) // Wait for 200ms CSS transition + 50ms buffer
    })
  }, [nodes, reactFlowInstance, setNodes])

  // Handle wheel events for scroll mode (only vertical in Linear mode)
  useEffect(() => {
    // In Linear mode, enable chronological panel navigation
    // In Canvas mode, only enable if Scroll mode is active
    if (viewMode === 'linear' || isScrollMode) {
      const handleWheel = (e: WheelEvent) => {
        // Check if we're over the React Flow canvas
        const target = e.target as HTMLElement
        const reactFlowElement = target.closest('.react-flow')
        if (!reactFlowElement) {
          return
        }

        // In linear mode, handle chronological panel navigation
        if (viewMode === 'linear') {
          // Allow Ctrl/Cmd+scroll for zoom
          if (e.ctrlKey || e.metaKey) {
            return
          }

          e.preventDefault()
          e.stopPropagation()

          const panels = chronologicalPanels
          if (panels.length === 0) {
            // No panels available - allow normal scroll behavior
            return
          }

          // Get current focused panel index (default to most recent if not set)
          let currentIndex = focusedPanelIndex
          if (currentIndex === null || currentIndex >= panels.length || currentIndex < 0) {
            currentIndex = panels.length - 1
            setFocusedPanelIndex(currentIndex)
          }

          // Determine direction: scroll up = backwards (earlier), scroll down = forwards (later)
          const deltaY = e.deltaY
          const currentDirection: 'up' | 'down' = deltaY < 0 ? 'up' : 'down'
          
          // Reset accumulator if scroll direction changed
          if (lastScrollDirectionRef.current !== null && lastScrollDirectionRef.current !== currentDirection) {
            scrollAccumulatorRef.current = 0
          }
          lastScrollDirectionRef.current = currentDirection

          // Accumulate scroll delta
          scrollAccumulatorRef.current += Math.abs(deltaY)

          // Threshold for navigation (higher = less sensitive)
          const SCROLL_THRESHOLD = 400 // Increased threshold - requires more scroll to navigate

          // Only navigate if accumulated scroll exceeds threshold
          if (scrollAccumulatorRef.current < SCROLL_THRESHOLD) {
            return
          }

          // Reset accumulator after navigation
          scrollAccumulatorRef.current = 0

          let newIndex = currentIndex
          if (deltaY < 0) {
            // Scroll up - go to previous panel (earlier in history)
            newIndex = Math.max(0, currentIndex - 1)
          } else if (deltaY > 0) {
            // Scroll down - go to next panel (later in history)
            newIndex = Math.min(panels.length - 1, currentIndex + 1)
          }

          // Only update if index changed
          if (newIndex !== currentIndex) {
            setFocusedPanelIndex(newIndex)
            const panelToCenter = panels[newIndex]
            if (panelToCenter) {
              // Select the panel (like flashcard navigation does)
              setNodes((nds) =>
                nds.map((n) => ({ ...n, selected: n.id === panelToCenter.id }))
              )
              
              // Wait for selection to update, then center panel above prompt box
              // Use setTimeout to ensure React Flow has processed the selection update
              setTimeout(() => {
                centerPanelAbovePrompt(panelToCenter.id, false)
              }, 50) // Small delay to ensure selection has propagated
            }
          }

          return
        }

        // Handle zoom in linear mode - zoom around horizontal center but free vertically (around cursor)
        if (false && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          e.stopPropagation()

          const viewport = reactFlowInstance.getViewport()
          const reactFlowRect = (reactFlowElement as HTMLElement).getBoundingClientRect()

          // Calculate the horizontal center of the map area (for horizontal centering)
          const mapCenterX = reactFlowRect.width / 2

          // Get mouse cursor Y position (for free vertical zoom)
          const mouseY = e.clientY - reactFlowRect.top

          // Convert screen positions to flow coordinates at current zoom
          // screenX = flowX * zoom + viewport.x
          // flowX = (screenX - viewport.x) / zoom
          const flowCenterX = (mapCenterX - viewport.x) / viewport.zoom
          const flowMouseY = (mouseY - viewport.y) / viewport.zoom

          // Calculate zoom delta (React Flow uses exponential zoom)
          const zoomFactor = 1 + (e.deltaY > 0 ? -0.1 : 0.1)
          const newZoom = Math.max(0.1, Math.min(2, viewport.zoom * zoomFactor))

          // Calculate new viewport X to keep horizontal center fixed
          // We want: mapCenterX = flowCenterX * newZoom + newViewportX
          // Solving: newViewportX = mapCenterX - flowCenterX * newZoom
          const newViewportX = mapCenterX - flowCenterX * newZoom

          // Calculate new viewport Y to keep mouse cursor Y position fixed (free vertical zoom)
          // We want: mouseY = flowMouseY * newZoom + newViewportY
          // Solving: newViewportY = mouseY - flowMouseY * newZoom
          const newViewportY = mouseY - flowMouseY * newZoom

          // Apply zoom: centered horizontally, free vertically around cursor
          reactFlowInstance.setViewport({
            x: newViewportX,
            y: newViewportY,
            zoom: newZoom,
          })

          // Update zoom ref
          prevZoomRef.current = newZoom
          return
        }

        // Trackpad pinch is ctrl+wheel — always zoom around the cursor, even in Scroll nav
        if (e.ctrlKey || e.metaKey) {
          // Safari Mac pinch is GestureEvent (board-rotation); don’t double-zoom
          if (typeof window !== 'undefined' && 'GestureEvent' in window && !/iPhone|iPad|iPod/.test(navigator.userAgent)) {
            return
          }
          e.preventDefault()
          e.stopPropagation()
          if (!reactFlowInstance) return
          const viewport = reactFlowInstance.getViewport()
          const rect = (reactFlowElement as HTMLElement).getBoundingClientRect()
          const isMac = /Mac|iPhone|iPod|iPad/i.test(navigator.platform)
          const factor = e.ctrlKey && isMac ? 10 : 1
          const pinchDelta =
            -e.deltaY * (e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.002) * factor
          const nextZoom = Math.min(2, Math.max(0.1, viewport.zoom * Math.pow(2, pinchDelta)))
          if (nextZoom === viewport.zoom) return
          reactFlowInstance.setViewport(
            viewportKeepingPanePoint(
              e.clientX - rect.left,
              e.clientY - rect.top,
              viewport,
              boardRotation,
              boardRotation,
              nextZoom
            )
          )
          prevZoomRef.current = nextZoom
          return
        }

        e.preventDefault()
        e.stopPropagation()

        const viewport = reactFlowInstance.getViewport()
        const deltaX = false ? 0 : e.deltaX // No horizontal scroll in Linear mode
        const deltaY = e.deltaY

        // In linear mode, prevent scrolling past bottom
        if (false) {
          const bottomLimit = getBottomScrollLimit()
          if (bottomLimit !== null) {
            const newY = viewport.y - deltaY
            // Clamp to bottom limit (can't scroll past bottom)
            const clampedY = Math.max(newY, bottomLimit as number)
            reactFlowInstance.setViewport({
              x: viewport.x - deltaX,
              y: clampedY,
              zoom: viewport.zoom,
            })
            // Check if at bottom after scroll
            setTimeout(() => checkIfAtBottom(), 10)
            return
          }
        }

        // Pan the viewport based on scroll delta
        reactFlowInstance.setViewport({
          x: viewport.x - deltaX,
          y: viewport.y - deltaY,
          zoom: viewport.zoom,
        })
      }

      // Add event listener with capture to intercept before React Flow
      document.addEventListener('wheel', handleWheel, { passive: false, capture: true })

      return () => {
        document.removeEventListener('wheel', handleWheel, { capture: true })
      }
    }
  }, [isScrollMode, viewMode, reactFlowInstance, getBottomScrollLimit, checkIfAtBottom, chronologicalPanels, focusedPanelIndex, centerPanelAbovePrompt, boardRotation])

  // Check if at bottom when viewport changes in linear mode
  // Don't run when nodes change due to selection - only run when nodes are added/removed or viewMode changes
  const prevNodesLengthRef = useRef(nodes?.length ?? 0)
  useEffect(() => {
    // Only run if nodes length changed (nodes added/removed) or viewMode changed, not on selection changes
    const currentNodesLength = nodes?.length ?? 0
    if (prevNodesLengthRef.current !== currentNodesLength || prevViewModeRef.current !== viewMode) {
      prevNodesLengthRef.current = currentNodesLength
      if (false && nodes && Array.isArray(nodes) && nodes.length > 0) {
        const timeoutId = setTimeout(() => {
          checkIfAtBottom()
        }, 100)
        return () => clearTimeout(timeoutId)
      }
    }
  }, [viewMode, nodes, reactFlowInstance, checkIfAtBottom])

  // Auto-scroll to bottom when new messages arrive (if user was at bottom)
  useEffect(() => {
    if (false && nodes && Array.isArray(nodes) && nodes.length > 0) {
      const currentMessagesLength = messages.length
      const prevLength = prevMessagesLengthRef.current

      // If new messages were added and user was at bottom, auto-scroll
      if (currentMessagesLength > prevLength && wasAtBottomRef.current) {
        setTimeout(() => {
          scrollToBottom()
        }, 200) // Wait for nodes to update
      }

      prevMessagesLengthRef.current = currentMessagesLength
    }
  }, [messages.length, nodes?.length ?? 0, viewMode, scrollToBottom])

  // Handle Linear mode: center and align panels vertically when switching modes
  // Use a ref to track previous viewMode to only run when viewMode actually changes
  const prevViewModeForLinearRef = useRef(viewMode)
  useEffect(() => {
    // Only run when viewMode actually changes, not when nodes change
    if (prevViewModeForLinearRef.current === viewMode) {
      return
    }
    prevViewModeForLinearRef.current = viewMode

    if (!nodes || !Array.isArray(nodes) || nodes.length === 0) return

    // Save current zoom before switching modes
    if (reactFlowInstance) {
      const currentZoom = reactFlowInstance.getViewport().zoom
      if (false) {
        savedZoomRef.current.canvas = currentZoom // Save canvas zoom before switching to linear
      } else {
        savedZoomRef.current.linear = currentZoom // Save linear zoom before switching to canvas
      }
    }

    if (false) {
      isLinearModeRef.current = true
      isSwitchingToLinearRef.current = true // Mark that we're switching to Linear mode

      // Store current positions before transforming (in case user moved panels in Canvas)
      nodes.forEach((node) => {
        // Always update stored position with current position when switching to Linear
        // This captures any moves the user made in Canvas mode
        originalPositionsRef.current.set(node.id, { x: node.position.x, y: node.position.y })
      })

      // Use same centering approach as Canvas mode - stack vertically, let React Flow center horizontally
      const panelSpacing = 250 // Equidistant spacing (same as Canvas mode)
      const startY = 0 // Start at y=0 so we can position viewport to match visual gap between panels

      // Restore saved zoom or use default (1.0 = 100% zoom for readable panels)
      const linearZoom = savedZoomRef.current.linear ?? 1.0

      // Sort nodes by their stored Y position to maintain order
      const sortedNodes = [...nodes].sort((a, b) => {
        const posA = originalPositionsRef.current.get(a.id)?.y || a.position.y
        const posB = originalPositionsRef.current.get(b.id)?.y || b.position.y
        return posA - posB
      })

      // Calculate centered X position BEFORE creating nodes, using target zoom (1.0) for linear mode
      // We'll set panels at X=0 initially, then center via viewport adjustment
      const panelWidth = 768 // Same width as prompt box
      const centeredX = 0 // Start at 0, we'll center via viewport X adjustment

      // Apply size-aware spacing: accumulate panel heights + gaps
      const gapBetweenPanels = 50 // Fixed gap between panels
      let cumulativeY = startY
      const linearNodes = sortedNodes.map((node, index) => {
        // Calculate Y position based on previous panels' heights
        if (index > 0) {
          const prevNode = sortedNodes[index - 1]
          const prevHeight = nodeHeightsRef.current.get(prevNode.id) || 400
          cumulativeY += prevHeight + gapBetweenPanels
        }

        return {
          ...node,
          position: {
            x: centeredX, // Use calculated centered position from the start
            y: cumulativeY, // Size-aware spacing: previous panels' heights + gaps
          },
          draggable: isLocked ? false : false, // Not draggable in Linear mode (or when locked)
        }
      })

      // Find selected node index BEFORE transforming to linear (use sortedNodes, not linearNodes)
      const selectedNodeId = selectedNodeIdRef.current
      const selectedNodeIndex = selectedNodeId
        ? sortedNodes.findIndex((n) => n.id === selectedNodeId)
        : -1

      // Update nodes with centered positions
      setNodes(linearNodes)

      // Update stored positions with centered positions
      linearNodes.forEach((node) => {
        originalPositionsRef.current.set(node.id, {
          x: node.position.x,
          y: node.position.y,
        })
      })

      // Center viewport on panels - use setTimeout to ensure nodes are fully rendered
      setTimeout(() => {
        if (linearNodes.length > 0) {
          // Get actual current nodes to ensure we have the latest positions
          const currentNodes = reactFlowInstance.getNodes()
          if (currentNodes.length === 0) return

          const reactFlowElement = document.querySelector('.react-flow')
          if (!reactFlowElement) return

          const mapAreaWidth = reactFlowElement.clientWidth
          const viewportHeight = reactFlowElement.clientHeight
          const screenCenterY = viewportHeight / 2

          // Use the linear zoom level
          const currentZoom = linearZoom

          // Calculate left gap same as prompt box (push/center mechanics)
          const expandedSidebarWidth = 256
          const collapsedSidebarWidth = 64
          const minimapWidth = 179
          const minimapMargin = 15

          const sidebarElement = document.querySelector('[class*="w-16"], [class*="w-64"]') as HTMLElement
          const isSidebarExpanded = sidebarElement?.classList.contains('w-64') ?? false
          const currentSidebarWidth = isSidebarExpanded ? expandedSidebarWidth : collapsedSidebarWidth

          const fullWindowWidth = window.screen.width
          const fullMapAreaWidth = fullWindowWidth - currentSidebarWidth
          const minimapLeftEdge = fullMapAreaWidth - minimapWidth - minimapMargin
          const gapFromSidebarToMinimap = minimapLeftEdge
          const calculatedLeftGap = Math.max(0, (1 / 2) * (gapFromSidebarToMinimap - panelWidth))
          const rightGapWhenLeftAligned = mapAreaWidth - calculatedLeftGap - panelWidth

          // Helper function to calculate viewport X based on push/center logic
          const calculateViewportX = (panelX: number, zoom: number) => {
            if (rightGapWhenLeftAligned < calculatedLeftGap) {
              // Center the panels
              const screenCenterX = mapAreaWidth / 2
              return screenCenterX - (panelWidth / 2) - (panelX * zoom)
            } else {
              // Position panels with left gap (pushed)
              return calculatedLeftGap - (panelX * zoom)
            }
          }

          // Skip viewport adjustment when a node is selected - this prevents jumping to bottom
          // Only adjust viewport when switching to linear mode with no selection
          if (selectedNodeIndex < 0 || !selectedNodeId) {
            // No selected node - center viewport on first panel
            const firstPanelY = Math.min(...currentNodes.map(n => n.position.y))
            const panelHeight = 300 // Approximate panel height
            const firstPanelCenterY = firstPanelY + panelHeight / 2

            // Calculate viewport Y to center first panel vertically
            const targetViewportY = screenCenterY - firstPanelCenterY * currentZoom

            const currentPanelX = currentNodes[0]?.position.x || 0
            const targetViewportX = calculateViewportX(currentPanelX, currentZoom)

            // Adjust viewport to position panels correctly
            reactFlowInstance.setViewport({
              x: targetViewportX,
              y: targetViewportY,
              zoom: currentZoom,
            })

            // Update zoom ref
            prevZoomRef.current = currentZoom
          }
          // If there's a selected node, skip viewport adjustment entirely to prevent jumping

          // Clear the switching flag after centering is complete
          setTimeout(() => {
            isSwitchingToLinearRef.current = false
          }, 100)
        }
      }, 200)
    } else {
      // Canvas mode - just update draggable state, don't change positions
      // Panels should maintain their positions across mode switches (same map, different navigation)
      isLinearModeRef.current = false
      
      if (!nodes || !Array.isArray(nodes)) return
      
      // Only update draggable state, don't change positions
        const updatedNodes = nodes.map((node) => {
          // Placeholders should always be draggable regardless of lock state
          if (node.type === 'placeholder') {
            return node // Keep placeholder as-is (already draggable)
          }
          return {
            ...node,
            // Global freeze or per-frame board pin
            draggable:
              !isLocked &&
              (node.data?.promptMessage?.metadata as Record<string, unknown> | undefined)
                ?.boardLocked !== true,
          }
        })

      setNodes(updatedNodes)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]) // Only run when viewMode changes, ignore nodes dependency to avoid loops

  // Migrate legacy smoothstep/animatedDotted edges once onto editable threads
  useEffect(() => {
    setEdges((eds) => {
      let changed = false
      const next = eds.map((edge) => {
        if (edge.type === 'placeholder' || edge.type === 'editable') return edge
        changed = true
        return {
          ...edge,
          type: 'editable' as const,
          data: {
            algorithm: DEFAULT_THREAD_ALGORITHM,
            points: [],
            dotted: edge.type === 'animatedDotted',
            ...((edge.data as ThreadEdgeData | undefined) || {}),
          } satisfies ThreadEdgeData,
        }
      })
      return changed ? next : eds // Avoid churn when already migrated
    })
  }, [setEdges])

  // Open frame menu at a screen point (right-click or long-press)
  const openFrameMenuAt = useCallback(
    (clientX: number, clientY: number, node: Node<ChatPanelNodeData>) => {
      setBoardMenuPosition(null)
      boardClickFlowRef.current = null
      setMinimapContextMenuPosition(null)
      setIBarPosition(null)
      setIBarInputAnchor(null)
      iBarArmedRef.current = false
      if (iBarInputRef.current && document.activeElement === iBarInputRef.current) {
        iBarInputRef.current.value = ''
        iBarInputRef.current.blur()
      }
      setClickedEdge(null)

      // Kill RF marquee from the hold; select this frame (keep multi if it was already in one)
      rfStore.setState({
        userSelectionActive: false,
        userSelectionRect: null,
        nodesSelectionActive: false,
      })
      setNodes((nds) => {
        const targetSelected = nds.some((n) => n.id === node.id && n.selected)
        const multi = nds.filter((n) => n.selected).length > 1
        if (targetSelected && multi) return nds // Keep multi-select for bulk frame actions
        return nds.map((n) => {
          const sel = n.id === node.id
          return n.selected === sel ? n : { ...n, selected: sel }
        })
      })

      setNodePopupPosition({ x: clientX, y: clientY }) // Viewport coords — menu is position:fixed
      const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
      if (reactFlowInstance && reactFlowElement) {
        const rect = reactFlowElement.getBoundingClientRect()
        const screenX = clientX - rect.left
        const screenY = clientY - rect.top
        const viewport = reactFlowInstance.getViewport()
        const flowX = (screenX - viewport.x) / viewport.zoom
        const flowY = (screenY - viewport.y) / viewport.zoom
        nodeClickPositionRef.current = { x: flowX, y: flowY }
        nodePopupZoomRef.current = viewport.zoom
      }
      setRightClickedNode(node)
    },
    [reactFlowInstance, setNodes, rfStore]
  )

  // Open board menu (or frame menu if selection) at a screen point
  const openBoardMenuAt = useCallback(
    (clientX: number, clientY: number, opts?: { forceBoard?: boolean }) => {
      setIBarPosition(null)
      setIBarInputAnchor(null)
      iBarArmedRef.current = false
      if (iBarInputRef.current && document.activeElement === iBarInputRef.current) {
        iBarInputRef.current.value = ''
        iBarInputRef.current.blur()
      }
      setClickedEdge(null)
      setMinimapContextMenuPosition(null)

      // Kill RF marquee / nodes-selection box that started during the hold
      rfStore.setState({
        userSelectionActive: false,
        userSelectionRect: null,
        nodesSelectionActive: false,
      })

      const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
      let screenX = clientX
      let screenY = clientY
      let flowX = 0
      let flowY = 0
      if (reactFlowInstance && reactFlowElement) {
        const rect = reactFlowElement.getBoundingClientRect()
        screenX = clientX - rect.left
        screenY = clientY - rect.top
        const viewport = reactFlowInstance.getViewport()
        flowX = (screenX - viewport.x) / viewport.zoom
        flowY = (screenY - viewport.y) / viewport.zoom
        nodeClickPositionRef.current = { x: flowX, y: flowY }
        nodePopupZoomRef.current = viewport.zoom
      }

      // Long-press must open the board menu even if marquee selected frames mid-hold
      if (opts?.forceBoard) {
        setNodes((nds) =>
          nds.some((n) => n.selected) ? nds.map((n) => (n.selected ? { ...n, selected: false } : n)) : nds
        )
        setRightClickedNode(null)
        boardClickFlowRef.current = { x: flowX, y: flowY }
        setBoardMenuPosition({ x: screenX, y: screenY })
        return
      }

      const selectedNodes = nodesRef.current.filter((n) => n.selected)
      if (selectedNodes.length > 0) {
        setBoardMenuPosition(null)
        boardClickFlowRef.current = null
        setNodePopupPosition({ x: screenX, y: screenY })
        setRightClickedNode(selectedNodes[0] as Node<ChatPanelNodeData>)
        return
      }

      setRightClickedNode(null)
      boardClickFlowRef.current = { x: flowX, y: flowY }
      setBoardMenuPosition({ x: screenX, y: screenY })
    },
    [reactFlowInstance, rfStore, setNodes]
  )

  // Handle node right-click to show popup (select node if not selected, then show popup)
  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node<ChatPanelNodeData>) => {
      if (event.button !== 2) return // Phone pinch/hold uses long-press; iOS contextmenu is button 0
      event.preventDefault()
      event.stopPropagation()
      openFrameMenuAt(event.clientX, event.clientY, node)
    },
    [openFrameMenuAt]
  )

  // Handle pane (background) right-click — frame menu if selection, else board menu
  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 2) return // Phone pinch/hold uses long-press; iOS contextmenu is button 0
      event.preventDefault()
      event.stopPropagation()
      openBoardMenuAt(event.clientX, event.clientY)
    },
    [openBoardMenuAt]
  )

  // Phone long-press → board / frame / map menus (mouse keeps right-click)
  useEffect(() => {
    if (embedded) return
    const root = boardRootRef.current
    if (!root) return

    const clearDomSelection = () => {
      // Dismiss iOS Copy / Find Selection bar that latches onto welcome / pane text
      try {
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0) sel.removeAllRanges()
      } catch {
        // ignore
      }
    }

    const clearRfMarquee = () => {
      // selectionOnDrag draws a rect on tiny finger jitter — kill it while holding for a menu
      const state = rfStore.getState()
      if (state.userSelectionActive || state.userSelectionRect || state.nodesSelectionActive) {
        rfStore.setState({
          userSelectionActive: false,
          userSelectionRect: null,
          nodesSelectionActive: false,
        })
      }
    }

    const setArmedClass = (on: boolean) => {
      if (on) {
        root.classList.add('tt-long-press-armed')
        clearDomSelection()
      } else {
        root.classList.remove('tt-long-press-armed')
      }
    }

    const controller = createLongPressController({
      onLongPress: (point, { target }) => {
        setArmedClass(false)
        clearRfMarquee()
        clearDomSelection()
        const el = target instanceof Element ? target : null
        if (!el) return false

        // Native inputs keep their own long-press (not frame chrome)
        if (el.closest('input, textarea')) return false

        // Free nav / minimap → Map menu
        if (
          el.closest('[data-minimap-context]') ||
          el.closest('[data-minimap-toggle-context]') ||
          el.closest('[data-minimap-pill-context]')
        ) {
          setRightClickedNode(null)
          setBoardMenuPosition(null)
          boardClickFlowRef.current = null
          setClickedEdge(null)
          setMinimapContextMenuPosition({ x: point.clientX, y: point.clientY })
          clearDomSelection()
          return true
        }

        // Ignore other overlay chrome
        if (
          el.closest('.react-flow__resize-control') || // Live corner/edge drag
          el.closest('.node-popup') ||
          el.closest('[data-chat-sidebar-toggle]') ||
          el.closest('[data-map-menu]')
        ) {
          return false
        }

        // Frame (incl. TipTap text on an unselected frame) → frame menu
        // Selected-frame text long-press never arms (see onDown) so editing keeps native select
        const nodeEl = el.closest('.react-flow__node') as HTMLElement | null
        if (nodeEl) {
          const id = nodeEl.getAttribute('data-id')
          const node = id
            ? (nodesRef.current.find((n) => n.id === id) as Node<ChatPanelNodeData> | undefined)
            : undefined
          if (node && (node.type === 'chatPanel' || node.type === 'blockGroup')) {
            openFrameMenuAt(point.clientX, point.clientY, node)
            clearDomSelection()
            requestAnimationFrame(() => {
              clearDomSelection()
              requestAnimationFrame(clearDomSelection)
            })
            return true
          }
          return false
        }

        // Empty board pane → board menu (always — ignore mid-hold marquee selection)
        if (el.closest('.react-flow__pane') || el.closest('.react-flow__renderer')) {
          openBoardMenuAt(point.clientX, point.clientY, { forceBoard: true })
          clearDomSelection()
          // iOS sometimes re-applies selection after the menu paints — clear again next frames
          requestAnimationFrame(() => {
            clearDomSelection()
            requestAnimationFrame(clearDomSelection)
          })
          return true
        }

        return false
      },
    })
    longPressRef.current = controller

    const frameNodeFromEvent = (e: Event): Node<ChatPanelNodeData> | null => {
      const el = eventElement(e.target) // Text-node clicks have no .closest
      if (!el) return null
      if (el.closest('input, textarea')) return null
      if (el.closest('.node-popup') || el.closest('[data-map-menu]') || el.closest('.block-actions-menu')) {
        return null
      }
      const nodeEl = el.closest('.react-flow__node') as HTMLElement | null
      if (!nodeEl) return null
      const id = nodeEl.getAttribute('data-id')
      const node = id
        ? (nodesRef.current.find((n) => n.id === id) as Node<ChatPanelNodeData> | undefined)
        : undefined
      if (node && (node.type === 'chatPanel' || node.type === 'blockGroup')) return node
      return null
    }

    const onDown = (e: PointerEvent) => {
      // Desktop right-press: open the frame menu here. RF panOnDrag includes 2, so
      // contextmenu is often preventDefault'd and never reaches onNodeContextMenu.
      if (e.pointerType === 'mouse' && e.button === 2) {
        const node = frameNodeFromEvent(e)
        if (node) {
          e.preventDefault()
          e.stopPropagation()
          openFrameMenuAt(e.clientX, e.clientY, node)
        }
        return
      }
      const el = eventElement(e.target)
      // Selected frame + text: don't arm — keep iOS/TipTap text selection
      if (
        el &&
        (el.closest('.ProseMirror') || el.closest('[contenteditable="true"]'))
      ) {
        const nodeEl = el.closest('.react-flow__node') as HTMLElement | null
        const id = nodeEl?.getAttribute('data-id')
        const node = id ? nodesRef.current.find((n) => n.id === id) : undefined
        if (node?.selected) return
        // Unselected frame text: arm → frame menu (selection cleared while armed)
      }
      if (el?.closest('input, textarea')) return
      if (el?.closest('.react-flow__resize-control')) return // Corner/edge drag — don't arm the 450ms menu

      controller.pointerDown(e)
      if (controller.isArmed()) {
        setArmedClass(true)
        clearDomSelection()
        // Only kill pane marquee when holding empty board — never touch RF store during a frame press
        // (store setState mid-gesture aborts d3 node drag)
        if (el && !el.closest('.react-flow__node')) {
          clearRfMarquee()
        }
      }
    }
    const onMove = (e: PointerEvent) => {
      controller.pointerMove(e)
      if (controller.isArmed()) {
        // Do NOT clearRfMarquee here — rfStore.setState on every move breaks frame dragging
        clearDomSelection()
      } else {
        setArmedClass(false)
      }
    }
    const onUp = (e: PointerEvent) => {
      controller.pointerUp(e)
      if (!controller.isArmed()) setArmedClass(false)
      if (controller.didFire()) clearDomSelection()
    }
    const onCancel = (e: PointerEvent) => {
      controller.pointerCancel(e)
      setArmedClass(false)
    }
    const onTouchStart = (e: TouchEvent) => {
      controller.touchStart(e) // 2+ fingers: iOS often skips the second pointerdown
      if (controller.shouldSuppress()) setArmedClass(false)
    }
    const onTouchMove = (e: TouchEvent) => {
      controller.touchStart(e) // Backup if the 2nd finger's touchstart missed the root
      if (controller.shouldSuppress()) setArmedClass(false)
    }
    const onTouchEnd = (e: TouchEvent) => {
      controller.touchEnd(e)
      if (!controller.isArmed()) setArmedClass(false)
    }
    const onGestureStart = () => {
      controller.gestureStart() // Safari pinch/twist
      setArmedClass(false)
    }
    const onSelectStart = (e: Event) => {
      // Block browser text/image selection while holding for a menu
      if (controller.isArmed() || controller.didFire()) {
        e.preventDefault()
        clearDomSelection()
      }
    }
    const onSelectionChange = () => {
      // iOS can create a selection without selectstart — wipe it while armed / after menu
      if (controller.isArmed() || controller.didFire()) clearDomSelection()
    }
    const onContextMenu = (e: Event) => {
      // Pinch / two-finger pan must never open a menu (iOS fires contextmenu after the hold)
      if (controller.shouldSuppress() || controller.isArmed() || controller.didFire()) {
        e.preventDefault()
        e.stopPropagation()
        clearDomSelection()
        return
      }
      // Backup if pointerdown didn't run (some browsers still deliver contextmenu)
      const mouseEvent = e as MouseEvent
      if (mouseEvent.button !== 2) return // Touch menus come from long-press, not native contextmenu
      const node = frameNodeFromEvent(e)
      if (node) {
        e.preventDefault()
        e.stopPropagation()
        openFrameMenuAt(mouseEvent.clientX, mouseEvent.clientY, node)
      }
    }
    const onClickCapture = (e: MouseEvent) => {
      // Swallow the click that follows a successful long-press (I-bar, +/- toggle, select)
      if (controller.consumeFired()) {
        e.preventDefault()
        e.stopPropagation()
        clearDomSelection()
      }
    }

    const touchOpts: AddEventListenerOptions = { capture: true, passive: true }
    root.addEventListener('pointerdown', onDown, { capture: true })
    root.addEventListener('pointermove', onMove, { capture: true })
    root.addEventListener('pointerup', onUp, { capture: true })
    root.addEventListener('pointercancel', onCancel, { capture: true })
    root.addEventListener('touchstart', onTouchStart, touchOpts)
    root.addEventListener('touchmove', onTouchMove, touchOpts)
    root.addEventListener('touchend', onTouchEnd, touchOpts)
    root.addEventListener('touchcancel', onTouchEnd, touchOpts)
    root.addEventListener('gesturestart', onGestureStart, { capture: true })
    root.addEventListener('selectstart', onSelectStart, { capture: true })
    document.addEventListener('selectionchange', onSelectionChange)
    root.addEventListener('contextmenu', onContextMenu, { capture: true })
    root.addEventListener('click', onClickCapture, { capture: true })

    return () => {
      controller.cancel()
      longPressRef.current = null
      setArmedClass(false)
      root.removeEventListener('pointerdown', onDown, { capture: true })
      root.removeEventListener('pointermove', onMove, { capture: true })
      root.removeEventListener('pointerup', onUp, { capture: true })
      root.removeEventListener('pointercancel', onCancel, { capture: true })
      root.removeEventListener('touchstart', onTouchStart, { capture: true })
      root.removeEventListener('touchmove', onTouchMove, { capture: true })
      root.removeEventListener('touchend', onTouchEnd, { capture: true })
      root.removeEventListener('touchcancel', onTouchEnd, { capture: true })
      root.removeEventListener('gesturestart', onGestureStart, { capture: true })
      root.removeEventListener('selectstart', onSelectStart, { capture: true })
      document.removeEventListener('selectionchange', onSelectionChange)
      root.removeEventListener('contextmenu', onContextMenu, { capture: true })
      root.removeEventListener('click', onClickCapture, { capture: true })
    }
  }, [embedded, openBoardMenuAt, openFrameMenuAt, rfStore])

  // Desktop right-click on a frame — document capture so RF panOnDrag:[1,2] cannot swallow it
  useEffect(() => {
    if (embedded) return
    const onRightPress = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 2) return
      const el = eventElement(e.target)
      if (!el) return
      if (el.closest('input, textarea')) return
      if (el.closest('.node-popup') || el.closest('[data-map-menu]') || el.closest('.block-actions-menu')) {
        return
      }
      const nodeEl = el.closest('.react-flow__node') as HTMLElement | null
      if (!nodeEl) return
      const id = nodeEl.getAttribute('data-id')
      const node = id
        ? (nodesRef.current.find((n) => n.id === id) as Node<ChatPanelNodeData> | undefined)
        : undefined
      if (!node || (node.type !== 'chatPanel' && node.type !== 'blockGroup')) return
      e.preventDefault()
      e.stopPropagation()
      openFrameMenuAt(e.clientX, e.clientY, node)
    }
    document.addEventListener('pointerdown', onRightPress, { capture: true })
    return () => document.removeEventListener('pointerdown', onRightPress, { capture: true })
  }, [embedded, openFrameMenuAt])

  // Phone select tool: RF Pane marquee is mouse-only; drive the same store rect from touch/pen
  useEffect(() => {
    if (embedded || !isMobileMode || isDrawing || mapPointerTool !== 'select') return // Pan tool / desktop / draw keep RF defaults
    const root = boardRootRef.current
    if (!root) return
    return attachPhoneSelectMarquee(root, rfStore) // Pointer marquee → userSelectionRect + frame select
  }, [embedded, isMobileMode, isDrawing, mapPointerTool, rfStore])

  // Spawn a frame at a flow position (board Add frame / I-bar menu Turn into). Optimistic RF node first.
  const createBlockAtFlowPosition = useCallback(async (
    flowX: number,
    flowY: number,
    opts?: {
      html?: string
      blockType?: BlockTypeId
      propertyType?: import('@/lib/blocks/property').PropertyTypeId // Turn into → Property seed
    } // Seed content + Turn into kind (empty text if omitted)
  ): Promise<string | null> => {
    const cursorOffsetX = BLOCK_CREATE_OFFSET_X // Caret X = I-bar (not legacy p-1+px-3 = 40)
    // First-line Y; property strip sits above the text so spawn higher by PROPERTY_GROUP_H
    const cursorOffsetY = BLOCK_CREATE_OFFSET_Y + (opts?.propertyType ? PROPERTY_GROUP_H : 0)
    const itemPosition = { x: flowX - cursorOffsetX, y: flowY - cursorOffsetY }
    setIBarPosition(null) // Clear pre-create cursor
    iBarPositionRef.current = null // Sync ref now so menu onClose doesn't re-arm capture
    setIBarInputAnchor(null) // Drop capture field — TipTap will take focus
    setIBarBlockMenu(null) // Menu is gone once a real frame exists
    iBarBlockMenuOpenRef.current = false
    iBarArmedRef.current = false
    if (iBarInputRef.current) {
      iBarInputRef.current.value = ''
      if (document.activeElement === iBarInputRef.current) iBarInputRef.current.blur()
    }

    const html =
      opts?.html ??
      (opts?.propertyType ? propertyBlockHtml(opts.propertyType) : '<p></p>') // Property spawn = icon + Empty cell
    const messageId = generateUUID() // Client id so the RF node and DB row match

    const optimisticMessage = {
      id: messageId,
      role: 'user' as const,
      content: html,
      created_at: new Date().toISOString(),
      metadata: newBlockMetadata({
        position: itemPosition, // Spawn aligned to I-bar
        fadeIn: true, // Autofocus TipTap once the panel mounts
        ...(opts?.blockType ? { blockType: opts.blockType } : {}),
        ...(opts?.propertyType ? { propertyType: opts.propertyType } : {}),
      }),
    }

    const panelId = `panel-${messageId}`
    const liveBoardId = conversationIdRef.current || ''
    originalPositionsRef.current.set(panelId, itemPosition)
    setNodes((nds) => [
      ...nds.map((n) => ({ ...n, selected: false })),
      {
        id: panelId,
        type: 'chatPanel',
        position: itemPosition,
        selected: true,
        data: {
          promptMessage: optimisticMessage,
          responseMessage: undefined,
          conversationId: liveBoardId,
          isResponseCollapsed: false,
        },
      },
    ])

    const patch = (key: unknown[]) => {
      queryClient.setQueryData(key, (old: unknown) => {
        const list = Array.isArray(old) ? old : []
        if (list.some((m: { id?: string }) => m.id === messageId)) return list
        return [...list, optimisticMessage]
      })
    }
    if (liveBoardId) {
      patch(['messages-for-panels', liveBoardId])
      patch(['messages-for-panels', liveBoardId, 'full'])
      patch(['messages-for-panels', liveBoardId, 'embed'])
    }

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return messageId // Node is already on the board; persist skipped

      let currentConversationId = conversationIdRef.current
      if (!currentConversationId) {
        const { data: newConversation, error: convError } = await supabase
          .from('conversations')
          .insert({
            user_id: user.id,
            title: 'New Conversation',
            metadata: { position: -1 },
          })
          .select()
          .single()
        if (convError || !newConversation) {
          console.error('Error creating conversation for add-block:', convError)
          return messageId
        }
        currentConversationId = newConversation.id
        conversationIdRef.current = currentConversationId
        patch(['messages-for-panels', currentConversationId])
        patch(['messages-for-panels', currentConversationId, 'full'])
        setNodes((nds) =>
          nds.map((n) =>
            n.id === panelId
              ? { ...n, data: { ...n.data, conversationId: currentConversationId } }
              : n
          )
        )
        replaceBoardUrl(currentConversationId) // Address bar only — router.replace remounts the frame
      }

      const { error } = await supabase.from('messages').insert({
        id: messageId,
        conversation_id: currentConversationId,
        user_id: user.id,
        role: 'user',
        content: html,
        metadata: optimisticMessage.metadata,
      })
      if (error) {
        console.error('Error creating block at flow position:', error)
        return messageId
      }
      return messageId
    } catch (error) {
      console.error('Error creating block at flow position:', error)
      return messageId
    }
  }, [queryClient, setNodes])

  // Pre-frame ⋮⋮ menu — Turn into / Duplicate spawn a frame; Delete dismisses the I-bar
  const handleIBarBlockAction = useCallback(
    async (action: BlockActionId, payload?: BlockActionPayload) => {
      const pos = iBarPositionRef.current // Capture before create clears the I-bar
      setIBarBlockMenu(null)
      iBarBlockMenuOpenRef.current = false

      if (action === 'delete') {
        setIBarPosition(null) // Nothing to delete — drop the place cursor
        iBarPositionRef.current = null
        setIBarInputAnchor(null)
        iBarArmedRef.current = false
        if (iBarInputRef.current) {
          iBarInputRef.current.value = ''
          if (document.activeElement === iBarInputRef.current) iBarInputRef.current.blur()
        }
        return
      }

      if (action === 'turnInto' && payload?.propertyType && pos) {
        await createBlockAtFlowPosition(pos.x, pos.y, {
          html: propertyBlockHtml(payload.propertyType), // Icon + Empty cell (frame top icon via metadata)
          propertyType: payload.propertyType, // New frame with property chrome at top
        })
        return
      }

      if (action === 'turnInto' && payload?.blockType && pos) {
        const blockType = payload.blockType
        if (blockType === 'board' || blockType === 'boardIn') {
          const messageId = await createBlockAtFlowPosition(pos.x, pos.y, {
            html: '<p></p>',
            blockType,
          })
          const boardId = conversationIdRef.current
          if (!messageId || !boardId) return
          try {
            const supabase = createClient()
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const { applyTurnInto, htmlToPlainText } = await import('@/lib/blocks/turn-into')
            const { linkedBoardId } = await applyTurnInto(supabase, {
              messageId,
              conversationId: boardId,
              userId: user.id,
              blockType,
              boardInParentId: payload.boardInParentId || null,
            })
            if (linkedBoardId) {
              const { editorForHostNode } = await import('@/lib/tiptap/block-selection')
              const { setFrameToSoleBoardLink } = await import('@/lib/tiptap/board-blocks')
              const ed = editorForHostNode(`panel-${messageId}`)
              if (ed) {
                setFrameToSoleBoardLink(ed, {
                  boardId: linkedBoardId,
                  title: htmlToPlainText('') || 'Untitled',
                  icon: null,
                  variant: 'title',
                })
              }
              await queryClient.invalidateQueries({ queryKey: ['conversations'] })
            }
          } catch (err) {
            console.error('Failed to turn I-bar into board:', err)
          }
          return
        }
        const html = transformHtmlToBlockType('', blockType) // Empty heading / list / etc.
        await createBlockAtFlowPosition(pos.x, pos.y, { html, blockType })
        return
      }

      if ((action === 'duplicate' || action === 'copyLink') && pos) {
        const messageId = await createBlockAtFlowPosition(pos.x, pos.y) // Empty text frame
        if (action === 'copyLink' && messageId) {
          const url = `${window.location.href.split('?')[0]}?block=panel-${messageId}`
          void navigator.clipboard.writeText(url).catch(() => {})
        }
        return
      }

      // Stubs (color / comment / …) — keep the I-bar so the user can still type
      iBarArmedRef.current = true
      iBarInputRef.current?.focus({ preventScroll: true })
    },
    [createBlockAtFlowPosition, queryClient]
  )

  // Outside click: dismiss the pre-frame block menu (grip + menu itself are exempt)
  useEffect(() => {
    if (!iBarBlockMenu) return
    const onDoc = (event: MouseEvent) => {
      const t = event.target as HTMLElement
      if (t.closest?.('.block-actions-menu, [data-tt-ibar-grip]')) return
      setIBarBlockMenu(null)
      iBarBlockMenuOpenRef.current = false
      iBarArmedRef.current = true // I-bar still showing — typing is live again
    }
    document.addEventListener('mousedown', onDoc, true)
    return () => document.removeEventListener('mousedown', onDoc, true)
  }, [iBarBlockMenu])

  // Close board menu when clicking / right-clicking outside it
  useEffect(() => {
    if (!boardMenuPosition) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.board-actions-menu')) {
        setBoardMenuPosition(null)
        boardClickFlowRef.current = null
      }
    }

    const handleContextMenuOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      // Pane / node handlers open their own menus; close board menu unless re-clicking it
      if (!target.closest('.board-actions-menu')) {
        setBoardMenuPosition(null)
        boardClickFlowRef.current = null
      }
    }

    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside, true)
      document.addEventListener('contextmenu', handleContextMenuOutside, true)
    }, 0)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('mousedown', handleClickOutside, true)
      document.removeEventListener('contextmenu', handleContextMenuOutside, true)
    }
  }, [boardMenuPosition])

  // Board menu actions (empty-pane right-click)
  const handleBoardMenuAction = useCallback(
    (action: BoardActionId) => {
      const flow = boardClickFlowRef.current
      setBoardMenuPosition(null)
      boardClickFlowRef.current = null

      switch (action) {
        case 'addFrame': {
          if (!flow) return
          void createBlockAtFlowPosition(flow.x, flow.y)
          break
        }
        case 'paste': {
          // Frame clipboard paste not wired yet — row stays disabled until then
          break
        }
        case 'selectAll': {
          setNodes((nds) =>
            nds.map((n) =>
              n.type === 'chatPanel' || n.type === 'freehand' || n.type === 'shape'
                ? { ...n, selected: true }
                : n
            )
          )
          break
        }
        case 'undo': {
          mapUndo()
          break
        }
        case 'redo': {
          mapRedo()
          break
        }
        case 'zoomToFit': {
          if (!reactFlowInstance) return
          fitViewInProgressRef.current = true
          reactFlowInstance.fitView({ padding: 0.2, minZoom: 0.3, maxZoom: 2, duration: 300 })
          window.setTimeout(() => {
            fitViewInProgressRef.current = false
          }, 350)
          break
        }
        case 'zoomTo100': {
          if (!reactFlowInstance) return
          fitViewInProgressRef.current = true
          if (flow) {
            reactFlowInstance.setCenter(flow.x, flow.y, { zoom: 1, duration: 300 })
          } else {
            const vp = reactFlowInstance.getViewport()
            const el = document.querySelector('.react-flow') as HTMLElement | null
            if (el) {
              const rect = el.getBoundingClientRect()
              const cx = (rect.width / 2 - vp.x) / vp.zoom
              const cy = (rect.height / 2 - vp.y) / vp.zoom
              reactFlowInstance.setCenter(cx, cy, { zoom: 1, duration: 300 })
            } else {
              reactFlowInstance.zoomTo(1, { duration: 300 })
            }
          }
          window.setTimeout(() => {
            fitViewInProgressRef.current = false
          }, 350)
          break
        }
        case 'copyLink': {
          if (!conversationId || typeof window === 'undefined') return
          const url = `${window.location.origin}/board/${conversationId}`
          void navigator.clipboard.writeText(url).catch(() => {})
          break
        }
        case 'capture': {
          if (!conversationId) return
          const vp = reactFlowInstance?.getViewport() || { x: 0, y: 0, zoom: 1 }
          void takeBoardCapture((key) => queryClient.getQueryData(key), conversationId, vp)
          break
        }
        default:
          break
      }
    },
    [createBlockAtFlowPosition, mapUndo, mapRedo, reactFlowInstance, setNodes, conversationId, queryClient]
  )

  // Close popup when right-clicking on background or different node
  useEffect(() => {
    if (!rightClickedNode) return

    const handleContextMenuOutside = (event: MouseEvent) => {
      const target = eventElement(event.target) // Text click target has no .closest
      if (!target) return
      // Check if right-click is on the popup
      const isOnPopup = target.closest('.node-popup')
      // Check if right-click is on the same node that has the popup
      const isOnSameNode = target.closest(`[data-id="${rightClickedNode.id}"]`)
      // Check if right-click is on any React Flow node (including different nodes)
      const isOnAnyNode = target.closest('.react-flow__node')

      // Close popup if:
      // 1. Right-clicking on background (not on popup or any node)
      // 2. Right-clicking on a different node (not the same node that has the popup)
      // Note: handleNodeContextMenu will then open a new popup for the different node
      // Note: empty pane opens board menu via handlePaneContextMenu
      if (!isOnPopup && (!isOnAnyNode || !isOnSameNode)) {
        setRightClickedNode(null)
        nodeClickPositionRef.current = null
        nodePopupZoomRef.current = null
      }
    }

    // Listen for contextmenu events on the document (capture phase to catch before React Flow)
    document.addEventListener('contextmenu', handleContextMenuOutside, true)

    return () => {
      document.removeEventListener('contextmenu', handleContextMenuOutside, true)
    }
  }, [rightClickedNode])

  // Handle delete node/panel - delete ALL selected panels (from context menu)
  const handleDeleteNode = useCallback(async () => {
    if (!rightClickedNode || !conversationId) return

    // Get all selected nodes (not just the right-clicked one)
    const selectedNodes = nodes.filter((n) => n.selected)
    if (selectedNodes.length === 0) return

    const selectedNodeIds = selectedNodes.map((n) => n.id)

    // Close popup
    setRightClickedNode(null)
    nodeClickPositionRef.current = null
    nodePopupZoomRef.current = null

    // Delete the nodes
    await deleteNodesByIds(selectedNodeIds)
  }, [rightClickedNode, conversationId, nodes, deleteNodesByIds])

  // Handle condense node/panel (collapse response) - condense ALL selected panels
  const handleCondenseNode = useCallback(() => {
    if (!rightClickedNode) return

    // Get all selected nodes (not just the right-clicked one)
    const selectedNodes = nodes.filter((n) => n.selected)
    if (selectedNodes.length === 0) return

    // Determine if we should collapse or expand based on the right-clicked node's state
    // If the right-clicked node is collapsed, we'll expand all selected; otherwise collapse all
    const rightClickedNodeState = rightClickedNode.data.isResponseCollapsed || false
    const shouldCollapse = !rightClickedNodeState // Toggle: if expanded, collapse; if collapsed, expand

    // Update all selected nodes
    const selectedNodeIds = new Set(selectedNodes.map((n) => n.id))
    setNodes((nds) =>
      nds.map((n) =>
        selectedNodeIds.has(n.id)
          ? {
            ...n,
            data: {
              ...n.data,
              isResponseCollapsed: shouldCollapse,
            },
          }
          : n
      )
    )

    // Update rightClickedNode to reflect the change
    setRightClickedNode({
      ...rightClickedNode,
      data: {
        ...rightClickedNode.data,
        isResponseCollapsed: shouldCollapse,
      },
    })

    // Don't close popup - allow user to toggle again if needed
  }, [rightClickedNode, nodes, setNodes])

  // Duplicate selected chatPanel blocks (offset position; strip page link)
  const handleDuplicateBlocks = useCallback(async () => {
    if (!conversationId) return
    const selected = nodes.filter((n) => n.selected && n.type === 'chatPanel' && n.data?.promptMessage?.id)
    if (selected.length === 0) return
    setRightClickedNode(null)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      for (const node of selected) {
        const prompt = node.data.promptMessage
        if (!prompt?.id) continue
        const abs = absFlowPosition(node, nodes) // Group-relative → page-absolute
        const absPos = { x: abs.x + 40, y: abs.y + 40 } // Offset so the copy doesn’t sit on the original
        const meta = duplicateBlockMetadata(
          (prompt.metadata as Record<string, unknown>) || {},
          absPos
        )
        await supabase.from('messages').insert({
          conversation_id: conversationId,
          user_id: user.id,
          role: 'user',
          content: prompt.content || '',
          metadata: meta,
        })
      }
      await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
      await queryClient.refetchQueries({ queryKey: ['messages-for-panels', conversationId] })
    } catch (err) {
      console.error('Failed to duplicate blocks:', err)
    }
  }, [conversationId, nodes, queryClient])

  // Copy deep link to the focus block (#block=messageId)
  const handleCopyLinkToBlock = useCallback(async () => {
    if (!rightClickedNode || !conversationId) return
    const messageId = rightClickedNode.data?.promptMessage?.id
    if (!messageId) return
    const url = `${window.location.origin}/board/${conversationId}?block=${messageId}`
    try {
      await navigator.clipboard.writeText(url)
    } catch (err) {
      console.error('Failed to copy block link:', err)
    }
    setRightClickedNode(null)
  }, [rightClickedNode, conversationId])

  // Wrap ≥2 selected frames in the legacy dashed wrapper
  const handleGroupBlocks = useCallback(async () => {
    if (!conversationId) return
    const selected = nodes.filter((n) => n.selected && n.type === 'chatPanel' && n.data?.promptMessage?.id)
    if (selected.length < 2) return
    setRightClickedNode(null)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Absolute bounding box of selected blocks
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const node of selected) {
        const abs = absFlowPosition(node, nodes) // Bounds in page space even if already grouped
        const absX = abs.x
        const absY = abs.y
        const w = (node.width as number) || (node.style?.width as number) || 280
        const h = (node.height as number) || (node.style?.height as number) || 160
        minX = Math.min(minX, absX)
        minY = Math.min(minY, absY)
        maxX = Math.max(maxX, absX + w)
        maxY = Math.max(maxY, absY + h)
      }
      const pad = BLOCK_GROUP_PADDING
      const bounds = {
        x: minX - pad,
        y: minY - pad,
        width: maxX - minX + pad * 2,
        height: maxY - minY + pad * 2,
      }
      // Persist absolute child positions before parenting
      for (const node of selected) {
        const msgId = node.data.promptMessage!.id
        await persistBlockPlacement(supabase, {
          messageId: msgId,
          position: absFlowPosition(node, nodes), // Absolute before parenting
          blockGroupId: null, // createBlockGroup writes the new group id next
        })
      }
      await createBlockGroup(supabase, {
        conversationId,
        userId: user.id,
        childMessageIds: selected.map((n) => n.data.promptMessage!.id),
        bounds,
      })
      await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
      await queryClient.refetchQueries({ queryKey: ['messages-for-panels', conversationId] })
    } catch (err) {
      console.error('Failed to group blocks:', err)
    }
  }, [conversationId, nodes, queryClient])

  // Remove selected blocks from their group (delete empty groups)
  const handleUngroupBlocks = useCallback(async () => {
    if (!conversationId || !rightClickedNode) return
    const selected = nodes.filter((n) => n.selected && n.type === 'chatPanel' && n.data?.promptMessage?.id)
    const targets = selected.length > 0 ? selected : [rightClickedNode]
    const childIds = targets
      .map((n) => n.data?.promptMessage?.id)
      .filter((id): id is string => Boolean(id))
    if (childIds.length === 0) return
    setRightClickedNode(null)
    try {
      const supabase = createClient()
      // Write absolute positions before clearing parent
      for (const node of targets) {
        if (node.type !== 'chatPanel' || !node.data?.promptMessage?.id) continue
        await persistBlockPlacement(supabase, {
          messageId: node.data.promptMessage.id,
          position: absFlowPosition(node, nodes), // Absolute before clearing parent
          blockGroupId: null, // Standalone on the page
        })
      }
      await ungroupBlocks(supabase, { childMessageIds: childIds })
      await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
      await queryClient.refetchQueries({ queryKey: ['messages-for-panels', conversationId] })
    } catch (err) {
      console.error('Failed to ungroup blocks:', err)
    }
  }, [conversationId, nodes, queryClient, rightClickedNode])

  // Turn into — transform HTML + metadata (and promote Page / Page in)
  const handleTurnInto = useCallback(
    async (blockType: BlockTypeId, boardInParentId?: string | null) => {
      const messageId = rightClickedNode?.data?.promptMessage?.id
      const nodeId = rightClickedNode?.id // Live editor registry key
      const frameContent = (rightClickedNode?.data?.promptMessage?.content as string) || '' // Title seed
      if (!messageId || !conversationId) return
      setRightClickedNode(null)
      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return
        const { applyTurnInto, htmlToPlainText } = await import('@/lib/blocks/turn-into')
        // Frame → page prepends a title-variant boardLink to the content server-side (race-free)
        const { linkedBoardId } = await applyTurnInto(supabase, {
          messageId,
          conversationId,
          userId: user.id,
          blockType,
          boardInParentId: boardInParentId || null,
        })
        // Live editor may be focused (skips content re-sync) — replace the WHOLE doc with the sole
        // title boardLink. Prepend-only insert left sibling blocks visible and could re-save them.
        if ((blockType === 'board' || blockType === 'boardIn') && linkedBoardId && nodeId) {
          const { editorForHostNode } = await import('@/lib/tiptap/block-selection')
          const { setFrameToSoleBoardLink } = await import('@/lib/tiptap/board-blocks')
          const ed = editorForHostNode(nodeId)
          if (ed) {
            const title = htmlToPlainText(frameContent).split('\n')[0]?.trim() || 'Untitled'
            setFrameToSoleBoardLink(ed, { boardId: linkedBoardId, title, icon: null, variant: 'title' })
          }
        }
        await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
        await queryClient.refetchQueries({ queryKey: ['messages-for-panels', conversationId] })
        if (blockType === 'board' || blockType === 'boardIn') {
          await queryClient.invalidateQueries({ queryKey: ['conversations'] })
          await queryClient.refetchQueries({ queryKey: ['conversations'] })
        }
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === 'object' && err && 'message' in err
              ? String((err as { message: unknown }).message)
              : String(err)
        console.error('Failed to turn block into type:', msg, err)
      }
    },
    [rightClickedNode, conversationId, queryClient]
  )

  // Multi-selection → new page: snapshot selected frames + threads + drawings/shapes exactly as
  // they are onto a fresh child page, and drop a title link frame on this page (Phase C).
  const handleSelectionToBoard = useCallback(
    async (blockType: BlockTypeId, boardInParentId?: string | null) => {
      if (!conversationId) return
      const frameNodes = nodes.filter(
        (n) => n.selected && n.type === 'chatPanel' && n.data?.promptMessage?.id
      )
      const canvasNodes = nodes.filter(
        (n) => n.selected && (n.type === 'freehand' || n.type === 'shape')
      )
      if (frameNodes.length + canvasNodes.length === 0) return
      const linkPos = nodeClickPositionRef.current || undefined // Popup flow position
      setRightClickedNode(null)
      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return

        // node.id → message id (edges use RF node ids; panel_edges use message ids)
        const nodeIdToMsg = new Map<string, string>()
        const frames = frameNodes.map((n) => {
          const abs = absFlowPosition(n, nodes)
          const msgId = n.data.promptMessage!.id as string
          nodeIdToMsg.set(n.id, msgId)
          return {
            oldId: msgId,
            content: (n.data.promptMessage!.content as string) || '',
            metadata: (n.data.promptMessage!.metadata as Record<string, unknown>) || {},
            position: { x: abs.x, y: abs.y },
          }
        })
        const selNodeIds = new Set(frameNodes.map((n) => n.id))
        const edgesSel = edges
          .filter((e) => selNodeIds.has(e.source) && selNodeIds.has(e.target))
          .map((e) => ({ source: nodeIdToMsg.get(e.source)!, target: nodeIdToMsg.get(e.target)! }))
          .filter((e) => e.source && e.target)
        const canvas = canvasNodes.map((n) => ({
          node_type: n.type as string,
          position_x: n.positionAbsolute?.x ?? n.position.x,
          position_y: n.positionAbsolute?.y ?? n.position.y,
          width: (n.width as number) || (n.data?.width as number) || 100,
          height: (n.height as number) || (n.data?.height as number) || 100,
          data: n.data,
        }))

        // Title seed: first selected frame's first line, else default
        const firstText = frames[0]?.content?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || ''
        const title = firstText.split('\n')[0]?.slice(0, 60).trim() || 'Snapshot'

        // Bounding-box top-left fallback if the popup position is unknown
        const fallbackPos =
          frames.length > 0
            ? {
                x: Math.min(...frames.map((f) => f.position.x)),
                y: Math.min(...frames.map((f) => f.position.y)) - 60,
              }
            : { x: canvas[0]?.position_x ?? 0, y: (canvas[0]?.position_y ?? 0) - 60 }

        const parentId =
          blockType === 'boardIn' && boardInParentId ? boardInParentId : conversationId

        const { snapshotSelectionToBoard } = await import('@/lib/blocks/snapshot')
        await snapshotSelectionToBoard(supabase, {
          userId: user.id,
          sourceConversationId: conversationId,
          parentId,
          title,
          frames,
          edges: edgesSel,
          canvas,
          linkPosition: linkPos || fallbackPos,
        })

        await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
        await queryClient.refetchQueries({ queryKey: ['messages-for-panels', conversationId] })
        await queryClient.invalidateQueries({ queryKey: ['conversations'] })
        await queryClient.refetchQueries({ queryKey: ['conversations'] })
      } catch (err) {
        console.error('Failed to snapshot selection to page:', err)
      }
    },
    [conversationId, nodes, edges, queryClient]
  )

  // Apply / clear a silhouette on the focused frame (frames act as shapes)
  const handleSetFrameShape = useCallback(
    async (choice: FrameShapeChoice) => {
      const target = rightClickedNode
      if (!target || target.type !== 'chatPanel') return
      const msgId = target.data?.promptMessage?.id as string | undefined
      if (!msgId) return

      const shape = choice === FRAME_SHAPE_NONE ? null : parseFrameShape(choice)
      takeSnapshot?.()

      const live = nodes.find((n) => n.id === target.id) || target
      const meta = {
        ...((live.data?.promptMessage?.metadata as Record<string, unknown>) || {}),
      }
      const prevDims = meta.resizeDimensions as { width?: number; height?: number } | undefined
      const measured = nodeFlowSize(live)
      let nextW = Math.max(
        FRAME_SHAPE_MIN_SIZE.width,
        prevDims?.width || measured.width || FRAME_SHAPE_DEFAULT_SIZE.width
      )
      let nextH = Math.max(
        FRAME_SHAPE_MIN_SIZE.height,
        prevDims?.height || measured.height || FRAME_SHAPE_DEFAULT_SIZE.height
      )
      // First time applying a silhouette: bump tiny hugged frames up to a readable box
      if (shape && nextW < FRAME_SHAPE_DEFAULT_SIZE.width) nextW = FRAME_SHAPE_DEFAULT_SIZE.width
      if (shape && nextH < FRAME_SHAPE_DEFAULT_SIZE.height) nextH = FRAME_SHAPE_DEFAULT_SIZE.height

      const nextMeta: Record<string, unknown> = {
        ...meta,
        frameShape: shape, // null clears → default transparent frame
      }
      if (shape) {
        // Shaped frames need an explicit box so the silhouette is visible (unlock = free resize)
        nextMeta.frameUnlocked = true
        nextMeta.resizeDimensions = { width: nextW, height: nextH }
        nextMeta.unlockedFrameSize = { width: nextW, height: nextH }
      }

      const supabase = createClient()
      try {
        await supabase.from('messages').update({ metadata: nextMeta }).eq('id', msgId)
      } catch (err) {
        console.error('Failed to save frame shape:', err)
        return
      }

      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== target.id) return n
          const pm = n.data?.promptMessage
          if (!pm) return n
          return {
            ...n,
            data: {
              ...n.data,
              frameShape: shape ?? undefined,
              promptMessage: { ...pm, metadata: { ...pm.metadata, ...nextMeta } },
            },
          }
        })
      )
      setRightClickedNode(null)
    },
    [rightClickedNode, nodes, setNodes, takeSnapshot]
  )

  // Frames the style/lock actions should hit: multi-select when the menu target is selected
  const frameActionTargets = useCallback(() => {
    const target = rightClickedNode
    if (!target || target.type !== 'chatPanel') return []
    const selected = nodes.filter((n) => n.selected && n.type === 'chatPanel')
    if (target.selected && selected.length > 1) return selected
    const live = nodes.find((n) => n.id === target.id)
    return live ? [live] : [target]
  }, [rightClickedNode, nodes])

  // Persist fill/border onto the menu target (and selected mates)
  const handleSetFrameColor = useCallback(
    async (kind: 'fillColor' | 'borderColor', value: string) => {
      const targets = frameActionTargets()
      if (targets.length === 0) return
      takeSnapshot?.()
      const ids = new Set(targets.map((n) => n.id))
      // Border color needs a visible style; clearing color leaves style alone
      const patchMeta = (meta: Record<string, unknown>) => {
        const out: Record<string, unknown> = { ...meta, [kind]: value || null }
        if (kind === 'borderColor') {
          if (value) {
            if (!out.borderStyle || out.borderStyle === 'none') out.borderStyle = 'solid'
            if (out.borderWeight == null) out.borderWeight = 1
          }
        }
        return out
      }
      const patchData = (data: ChatPanelNodeData) => {
        const pm = data?.promptMessage
        const meta = patchMeta({ ...((pm?.metadata as Record<string, unknown>) || {}) })
        return {
          ...data,
          [kind]: value,
          ...(kind === 'borderColor' && value
            ? {
                borderStyle: (data.borderStyle && data.borderStyle !== 'none'
                  ? data.borderStyle
                  : 'solid') as string,
                borderWeight: data.borderWeight ?? 1,
              }
            : {}),
          promptMessage: pm ? { ...pm, metadata: meta } : pm,
        }
      }
      setNodes((nds) =>
        nds.map((n) => {
          if (!ids.has(n.id)) return n
          return { ...n, data: patchData(n.data) }
        })
      )
      setRightClickedNode((prev) => {
        if (!prev || !ids.has(prev.id)) return prev
        return { ...prev, data: patchData(prev.data) }
      })
      const supabase = createClient()
      for (const n of targets) {
        const msgId = n.data?.promptMessage?.id as string | undefined
        if (!msgId) continue
        const live = nodes.find((x) => x.id === n.id) || n
        const pm = live.data?.promptMessage
        const meta = patchMeta({ ...((pm?.metadata as Record<string, unknown>) || {}) })
        try {
          await supabase.from('messages').update({ metadata: meta }).eq('id', msgId)
        } catch (err) {
          console.error('Failed to save frame color:', err)
        }
      }
    },
    [frameActionTargets, nodes, setNodes, takeSnapshot]
  )

  // Persist border thickness onto the menu target (and selected mates)
  const handleSetFrameBorderWeight = useCallback(
    async (weight: number, commit = true) => {
      const targets = frameActionTargets()
      if (targets.length === 0) return
      const w = Math.min(8, Math.max(1, weight)) // Continuous 1–8px (no integer snap)
      if (commit) takeSnapshot?.() // One undo point per drag gesture
      const ids = new Set(targets.map((n) => n.id))
      const patchMeta = (meta: Record<string, unknown>) => ({
        ...meta,
        borderWeight: w,
        // Ensure a visible stroke when thickening — keep existing color/style
        borderStyle:
          meta.borderStyle && meta.borderStyle !== 'none' ? meta.borderStyle : 'solid',
      })
      const patchData = (data: ChatPanelNodeData) => {
        const pm = data?.promptMessage
        const meta = patchMeta({ ...((pm?.metadata as Record<string, unknown>) || {}) })
        return {
          ...data,
          borderWeight: w,
          borderStyle:
            data.borderStyle && data.borderStyle !== 'none' ? data.borderStyle : 'solid',
          promptMessage: pm ? { ...pm, metadata: meta } : pm,
        }
      }
      setNodes((nds) =>
        nds.map((n) => {
          if (!ids.has(n.id)) return n
          return { ...n, data: patchData(n.data) }
        })
      )
      setRightClickedNode((prev) => {
        if (!prev || !ids.has(prev.id)) return prev
        return { ...prev, data: patchData(prev.data) }
      })
      if (!commit) return // Live preview only while the slider is moving
      const supabase = createClient()
      for (const n of targets) {
        const msgId = n.data?.promptMessage?.id as string | undefined
        if (!msgId) continue
        const live = nodes.find((x) => x.id === n.id) || n
        const pm = live.data?.promptMessage
        const meta = patchMeta({ ...((pm?.metadata as Record<string, unknown>) || {}) })
        try {
          await supabase.from('messages').update({ metadata: meta }).eq('id', msgId)
        } catch (err) {
          console.error('Failed to save frame border weight:', err)
        }
      }
    },
    [frameActionTargets, nodes, setNodes, takeSnapshot]
  )

  // Connect / sync-mode / unlink Notion on the focused frame(s)
  const handleNotionConnection = useCallback(
    async (next: { connected: boolean; sync?: 'live' | 'manual' }) => {
      const targets = frameActionTargets()
      if (targets.length === 0) return
      takeSnapshot?.()
      const ids = new Set(targets.map((n) => n.id))
      const patchMeta = (meta: Record<string, unknown>) => {
        const out = { ...meta }
        if (!next.connected) {
          out.notionConnected = false // Explicit unlink (keeps imported notionPageId)
          delete out.notionSync
        } else {
          out.notionConnected = true
          out.notionSync = next.sync === 'manual' ? 'manual' : 'live'
        }
        return out
      }
      setNodes((nds) =>
        nds.map((n) => {
          if (!ids.has(n.id)) return n
          const pm = n.data?.promptMessage
          if (!pm) return n
          return {
            ...n,
            data: {
              ...n.data,
              promptMessage: { ...pm, metadata: patchMeta({ ...((pm.metadata as Record<string, unknown>) || {}) }) },
            },
          }
        })
      )
      setRightClickedNode((prev) => {
        if (!prev || !ids.has(prev.id)) return prev
        const pm = prev.data?.promptMessage
        if (!pm) return prev
        return {
          ...prev,
          data: {
            ...prev.data,
            promptMessage: { ...pm, metadata: patchMeta({ ...((pm.metadata as Record<string, unknown>) || {}) }) },
          },
        }
      })
      const supabase = createClient()
      for (const n of targets) {
        const msgId = n.data?.promptMessage?.id as string | undefined
        if (!msgId) continue
        const live = nodes.find((x) => x.id === n.id) || n
        const pm = live.data?.promptMessage
        const meta = patchMeta({ ...((pm?.metadata as Record<string, unknown>) || {}) })
        try {
          await supabase.from('messages').update({ metadata: meta }).eq('id', msgId)
        } catch (err) {
          console.error('Failed to save Notion connection:', err)
        }
      }
    },
    [frameActionTargets, nodes, setNodes, takeSnapshot]
  )

  // Turn into → Property: stamp propertyType on focused frame(s) (top icon only).
  // First-time apply shifts the frame up so block text stays on its prior board Y (I-bar / line).
  const handleTurnIntoProperty = useCallback(
    async (propertyType: import('@/lib/blocks/property').PropertyTypeId) => {
      const targets = frameActionTargets()
      if (targets.length === 0) return
      takeSnapshot?.()
      const ids = new Set(targets.map((n) => n.id))
      const patchMeta = (meta: Record<string, unknown>, nextPos?: { x: number; y: number }) => {
        const out: Record<string, unknown> = { ...meta, propertyType }
        if (nextPos) out.position = nextPos // Keep placement in sync with RF node
        return out
      }
      setNodes((nds) =>
        nds.map((n) => {
          if (!ids.has(n.id)) return n
          const pm = n.data?.promptMessage
          if (!pm) return n
          const prevMeta = { ...((pm.metadata as Record<string, unknown>) || {}) }
          const firstProperty = !prevMeta.propertyType // Strip is new → compensate Y
          const nextPos = firstProperty
            ? { x: n.position.x, y: n.position.y - PROPERTY_GROUP_H }
            : n.position
          return {
            ...n,
            position: nextPos,
            data: {
              ...n.data,
              promptMessage: {
                ...pm,
                metadata: patchMeta(prevMeta, firstProperty ? nextPos : undefined),
              },
            },
          }
        })
      )
      setRightClickedNode((prev) => {
        if (!prev || !ids.has(prev.id)) return prev
        const pm = prev.data?.promptMessage
        if (!pm) return prev
        const prevMeta = { ...((pm.metadata as Record<string, unknown>) || {}) }
        const firstProperty = !prevMeta.propertyType
        const nextPos = firstProperty
          ? { x: prev.position.x, y: prev.position.y - PROPERTY_GROUP_H }
          : prev.position
        return {
          ...prev,
          position: nextPos,
          data: {
            ...prev.data,
            promptMessage: {
              ...pm,
              metadata: patchMeta(prevMeta, firstProperty ? nextPos : undefined),
            },
          },
        }
      })
      const supabase = createClient()
      for (const n of targets) {
        const msgId = n.data?.promptMessage?.id as string | undefined
        if (!msgId) continue
        const live = nodes.find((x) => x.id === n.id) || n
        const pm = live.data?.promptMessage
        const prevMeta = { ...((pm?.metadata as Record<string, unknown>) || {}) }
        const firstProperty = !prevMeta.propertyType
        const nextPos = firstProperty
          ? { x: live.position.x, y: live.position.y - PROPERTY_GROUP_H }
          : undefined
        const meta = patchMeta(prevMeta, nextPos)
        try {
          await supabase.from('messages').update({ metadata: meta }).eq('id', msgId)
        } catch (err) {
          console.error('Failed to save frame property type:', err)
        }
      }
      setRightClickedNode(null)
    },
    [frameActionTargets, nodes, setNodes, takeSnapshot]
  )

  // Pin selected frames to the board (not draggable)
  const handleToggleBoardLock = useCallback(() => {
    const targets = frameActionTargets()
    if (targets.length === 0) return
    takeSnapshot?.()
    const nextLocked = !targets.every((n) => {
      const meta = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
      return meta.boardLocked === true
    })
    const ids = new Set(targets.map((n) => n.id))
    setNodes((nds) =>
      nds.map((n) => {
        if (!ids.has(n.id)) return n
        const pm = n.data?.promptMessage
        if (!pm) return n
        const meta = { ...(pm.metadata || {}) } as Record<string, unknown>
        if (nextLocked) meta.boardLocked = true
        else delete meta.boardLocked
        return {
          ...n,
          draggable: nextLocked ? false : !isLocked,
          data: { ...n.data, promptMessage: { ...pm, metadata: meta } },
        }
      })
    )
    window.dispatchEvent(new Event('tt-frame-lock-changed'))
    const supabase = createClient()
    void (async () => {
      for (const n of targets) {
        const msgId = n.data?.promptMessage?.id as string | undefined
        if (!msgId) continue
        const { data: row } = await supabase.from('messages').select('metadata').eq('id', msgId).maybeSingle()
        if (!row) continue
        const next = { ...((row.metadata as Record<string, unknown>) || {}) }
        if (nextLocked) next.boardLocked = true
        else delete next.boardLocked
        await supabase.from('messages').update({ metadata: next }).eq('id', msgId)
      }
    })()
    setRightClickedNode(null)
  }, [frameActionTargets, isLocked, setNodes, takeSnapshot])

  // Lock ≥2 selected frames so they drag as one group
  const handleToggleFrameLock = useCallback(() => {
    const targets = frameActionTargets()
    if (targets.length < 2) return
    takeSnapshot?.()
    const groupIds = targets.map((n) => {
      const meta = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
      return typeof meta.frameLockGroupId === 'string' ? meta.frameLockGroupId : null
    })
    const alreadyLocked =
      groupIds.every((id) => typeof id === 'string') && new Set(groupIds).size === 1
    const nextGroupId = alreadyLocked ? null : crypto.randomUUID()
    const ids = new Set(targets.map((n) => n.id))
    setNodes((nds) =>
      nds.map((n) => {
        if (!ids.has(n.id)) return n
        const pm = n.data?.promptMessage
        if (!pm) return n
        const meta = { ...(pm.metadata || {}) } as Record<string, unknown>
        if (nextGroupId) meta.frameLockGroupId = nextGroupId
        else delete meta.frameLockGroupId
        return {
          ...n,
          data: { ...n.data, promptMessage: { ...pm, metadata: meta } },
        }
      })
    )
    window.dispatchEvent(new Event('tt-frame-lock-changed'))
    const supabase = createClient()
    void (async () => {
      for (const n of targets) {
        const msgId = n.data?.promptMessage?.id as string | undefined
        if (!msgId) continue
        const { data: row } = await supabase.from('messages').select('metadata').eq('id', msgId).maybeSingle()
        if (!row) continue
        const next = { ...((row.metadata as Record<string, unknown>) || {}) }
        if (nextGroupId) next.frameLockGroupId = nextGroupId
        else delete next.frameLockGroupId
        await supabase.from('messages').update({ metadata: next }).eq('id', msgId)
      }
    })()
    setRightClickedNode(null)
  }, [frameActionTargets, setNodes, takeSnapshot])

  // Dispatch block action from the shared menu
  const handleBlockAction = useCallback(
    (action: BlockActionId, payload?: BlockActionPayload) => {
      switch (action) {
        case 'duplicate':
          void handleDuplicateBlocks()
          break
        case 'delete':
          void handleDeleteNode()
          break
        case 'addChild':
          if (rightClickedNode) {
            addChildNode(rightClickedNode.id)
            setRightClickedNode(null)
          }
          break
        case 'condense':
          handleCondenseNode()
          break
        case 'copyLink':
          void handleCopyLinkToBlock()
          break
        case 'group':
          void handleGroupBlocks()
          break
        case 'ungroup':
          void handleUngroupBlocks()
          break
        case 'turnInto':
          if (payload?.propertyType) {
            void handleTurnIntoProperty(payload.propertyType) // Property pane → frame top chrome
          } else if (payload?.blockType) {
            // Page/Page in on a multi-selection → snapshot to a new page; else single-frame promote
            const relevantSelected = nodes.filter(
              (n) => n.selected && (n.type === 'chatPanel' || n.type === 'freehand' || n.type === 'shape')
            )
            if (
              (payload.blockType === 'board' || payload.blockType === 'boardIn') &&
              relevantSelected.length >= 2
            ) {
              void handleSelectionToBoard(payload.blockType, payload.boardInParentId)
            } else {
              void handleTurnInto(payload.blockType, payload.boardInParentId)
            }
          }
          break
        case 'setFrameShape':
          if (payload?.frameShape) {
            void handleSetFrameShape(payload.frameShape)
          }
          break
        case 'setFillColor':
          void handleSetFrameColor('fillColor', payload?.fillColor ?? '')
          break
        case 'setBorderColor':
          void handleSetFrameColor('borderColor', payload?.borderColor ?? '')
          break
        case 'setBorderWeight':
          void handleSetFrameBorderWeight(
            payload?.borderWeight ?? 1,
            payload?.borderWeightCommit !== false // Default commit; slider drag passes false
          )
          break
        case 'lockToBoard':
          handleToggleBoardLock()
          break
        case 'lockFramesTogether':
          handleToggleFrameLock()
          break
        case 'connectNotion':
          void handleNotionConnection({ connected: true, sync: 'live' })
          break
        case 'setNotionSync':
          void handleNotionConnection({
            connected: true,
            sync: payload?.notionSync === 'manual' ? 'manual' : 'live',
          })
          break
        case 'removeNotionConnection':
          void handleNotionConnection({ connected: false })
          break
        // Baseline stubs — menu entries present; behavior later
        case 'color':
        case 'listFormat':
        case 'moveTo':
        case 'comment':
        case 'suggestEdits':
        case 'presentFromHere':
        case 'askAI':
        case 'skills':
          setRightClickedNode(null)
          break
      }
    },
    [
      handleDuplicateBlocks,
      handleDeleteNode,
      handleCondenseNode,
      handleCopyLinkToBlock,
      handleGroupBlocks,
      handleUngroupBlocks,
      handleTurnInto,
      handleSelectionToBoard,
      handleTurnIntoProperty,
      handleSetFrameShape,
      handleSetFrameColor,
      handleSetFrameBorderWeight,
      handleToggleBoardLock,
      handleToggleFrameLock,
      handleNotionConnection,
      nodes,
      rightClickedNode,
      addChildNode,
    ]
  )

  // Open block actions from the ⋮⋮ handle on a chat panel
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        nodeId?: string
        clientX?: number
        clientY?: number
      }
      if (!detail?.nodeId || !reactFlowInstance) return
      const node = nodes.find((n) => n.id === detail.nodeId)
      if (!node) return
      setIBarPosition(null)
      setIBarInputAnchor(null)
      iBarArmedRef.current = false
      if (iBarInputRef.current && document.activeElement === iBarInputRef.current) {
        iBarInputRef.current.value = ''
        iBarInputRef.current.blur()
      }
      if (!node.selected) {
        setNodes((nds) => nds.map((n) => (n.id === node.id ? { ...n, selected: true } : n)))
      }
      const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
      if (reactFlowElement && detail.clientX != null && detail.clientY != null) {
        const rect = reactFlowElement.getBoundingClientRect()
        const screenX = detail.clientX - rect.left
        const screenY = detail.clientY - rect.top
        const viewport = reactFlowInstance.getViewport()
        nodeClickPositionRef.current = {
          x: screenX / viewport.zoom - viewport.x,
          y: screenY / viewport.zoom - viewport.y,
        }
        setNodePopupPosition({ x: screenX, y: screenY })
        nodePopupZoomRef.current = viewport.zoom
      }
      setRightClickedNode(node as Node<ChatPanelNodeData>)
    }
    window.addEventListener('open-block-actions', onOpen as EventListener)
    return () => window.removeEventListener('open-block-actions', onOpen as EventListener)
  }, [nodes, reactFlowInstance, setNodes])

  // Update node popup position when node, nodes, or viewport changes
  // Position follows the click position on the node as viewport changes
  useEffect(() => {
    if (!rightClickedNode || !reactFlowInstance || !nodeClickPositionRef.current) return

    const updatePosition = () => {
      // Convert stored flow coordinates to screen coordinates using current viewport
      const viewport = reactFlowInstance.getViewport()
      const screenX = (nodeClickPositionRef.current!.x + viewport.x) * viewport.zoom
      const screenY = (nodeClickPositionRef.current!.y + viewport.y) * viewport.zoom

      setNodePopupPosition({ x: screenX, y: screenY })
    }

    // Initial position update
    updatePosition()

    // Update position continuously using requestAnimationFrame to catch viewport changes
    let animationFrameId: number
    const animate = () => {
      updatePosition()
      animationFrameId = requestAnimationFrame(animate)
    }
    animationFrameId = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animationFrameId)
    }
  }, [rightClickedNode, reactFlowInstance])

  // Close node popup on zoom (viewport change)
  useEffect(() => {
    if (!rightClickedNode || !reactFlowInstance) return

    const checkZoomChange = () => {
      const currentViewport = reactFlowInstance.getViewport()
      if (nodePopupZoomRef.current !== null && Math.abs(currentViewport.zoom - nodePopupZoomRef.current) > 0.01) {
        // Zoom changed - close popup
        setRightClickedNode(null)
        nodeClickPositionRef.current = null
        nodePopupZoomRef.current = null
      }
    }

    // Check for zoom changes periodically
    const intervalId = setInterval(checkZoomChange, 100)

    return () => {
      clearInterval(intervalId)
    }
  }, [rightClickedNode, reactFlowInstance])

  // Close node popup when clicking outside (left or right click)
  useEffect(() => {
    if (!rightClickedNode) return

    const handleClickOutside = (event: MouseEvent) => {
      if (event.button === 2) return // Right-click is contextmenu — don't close before the menu opens
      const target = eventElement(event.target) // Text click target has no .closest
      if (!target) return
      // Check if click is on the popup
      const isOnPopup = target.closest('.node-popup')

      // Check if click is on any React Flow node
      const isOnAnyNode = target.closest('.react-flow__node')

      // Also check if click is on a button inside the popup (to allow delete/condense buttons to work)
      const isOnButton = target.closest('button') && target.closest('.node-popup')

      // Close popup if:
      // 1. Clicking on background (not on popup or any node)
      // 2. Clicking on any node (including the selected panel) - but not on the popup itself
      // Allow button clicks inside popup to work
      if (!isOnPopup && !isOnButton) {
        setRightClickedNode(null)
        nodeClickPositionRef.current = null
        nodePopupZoomRef.current = null
      }
    }

    // Handle right-click outside to close popup
    const handleContextMenuOutside = (event: MouseEvent) => {
      const target = eventElement(event.target) // Text click target has no .closest
      if (!target) return
      // Check if right-click is on the popup
      const isOnPopup = target.closest('.node-popup')
      // Check if right-click is on the same node that has the popup
      const isOnSameNode = target.closest(`[data-id="${rightClickedNode.id}"]`)
      // Check if right-click is on any React Flow node (including different nodes)
      const isOnAnyNode = target.closest('.react-flow__node')

      // Close popup if:
      // 1. Right-clicking on background (not on popup or any node)
      // 2. Right-clicking on a different node (not the same node that has the popup)
      // Note: handleNodeContextMenu will then open a new popup for the different node
      if (!isOnPopup && (!isOnAnyNode || !isOnSameNode)) {
        setRightClickedNode(null)
        nodeClickPositionRef.current = null
        nodePopupZoomRef.current = null
      }
    }

    // Use capture phase to catch events before React Flow handles them
    // Use a small delay to allow button clicks to process first
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside, true)
      document.addEventListener('contextmenu', handleContextMenuOutside, true)
    }, 0)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('mousedown', handleClickOutside, true)
      document.removeEventListener('contextmenu', handleContextMenuOutside, true)
    }
  }, [rightClickedNode])

  // Handle edge click to show popup
  const handleEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.stopPropagation() // Prevent other click handlers
    setBoardMenuPosition(null) // Don't stack with board menu
    boardClickFlowRef.current = null

    // Toggle popup - if same edge is clicked, close it; otherwise open it
    if (clickedEdge?.id === edge.id) {
      setClickedEdge(null)
      edgeClickPositionRef.current = null
      edgePopupZoomRef.current = null
      return
    }

    // Get click position and convert to flow coordinates
    const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
    if (reactFlowInstance && reactFlowElement) {
      const rect = reactFlowElement.getBoundingClientRect()
      const screenX = event.clientX - rect.left
      const screenY = event.clientY - rect.top

      // Convert screen coordinates to flow coordinates
      const viewport = reactFlowInstance.getViewport()
      const flowX = screenX / viewport.zoom - viewport.x
      const flowY = screenY / viewport.zoom - viewport.y

      // Store click position in flow coordinates
      edgeClickPositionRef.current = { x: flowX, y: flowY }

      // Set initial screen position
      setEdgePopupPosition({ x: screenX, y: screenY })

      // Store zoom when popup opens
      edgePopupZoomRef.current = viewport.zoom
    }

    setClickedEdge(edge)
  }, [clickedEdge, reactFlowInstance])

  // Handle collapse/expand all panels connected to the edge
  const handleCollapseTarget = useCallback(() => {
    if (!clickedEdge) return

    // Find all nodes in the connected component (all nodes reachable from source and target)
    const connectedNodeIds = new Set<string>()
    const visited = new Set<string>()

    // Start with source and target nodes of the clicked edge
    const startNodes = [clickedEdge.source, clickedEdge.target]
    const queue = [...startNodes]

    // BFS to find all connected nodes
    while (queue.length > 0) {
      const currentNodeId = queue.shift()!
      if (visited.has(currentNodeId)) continue

      visited.add(currentNodeId)
      connectedNodeIds.add(currentNodeId)

      // Find all edges connected to this node
      edges.forEach(edge => {
        if (edge.source === currentNodeId && !visited.has(edge.target)) {
          queue.push(edge.target)
        }
        if (edge.target === currentNodeId && !visited.has(edge.source)) {
          queue.push(edge.source)
        }
      })
    }

    // Get all connected nodes
    const connectedNodes = nodes.filter(n => connectedNodeIds.has(n.id))
    if (connectedNodes.length === 0) return

    // Check collapse states
    const allCollapsed = connectedNodes.every(n => n.data.isResponseCollapsed || false)
    const allExpanded = connectedNodes.every(n => !(n.data.isResponseCollapsed || false))
    const someCollapsed = connectedNodes.some(n => n.data.isResponseCollapsed || false)

    // Determine action:
    // - If all are collapsed: expand all
    // - If all are expanded: collapse all
    // - If some are collapsed and some expanded: only expand the collapsed ones (don't collapse expanded ones)
    const shouldCollapse = allExpanded // Only collapse if all are expanded
    const shouldExpand = allCollapsed || someCollapsed // Expand if all are collapsed OR if some are collapsed

    // Update nodes: expand collapsed ones, or collapse all if all are expanded
    setNodes((nds) =>
      nds.map((n) => {
        if (connectedNodeIds.has(n.id)) {
          const isCurrentlyCollapsed = n.data.isResponseCollapsed || false

          if (shouldCollapse && allExpanded) {
            // All are expanded, so collapse all
            return {
              ...n,
              data: {
                ...n.data,
                isResponseCollapsed: true,
              },
            }
          } else if (shouldExpand && isCurrentlyCollapsed) {
            // Some are collapsed, so expand only the collapsed ones
            return {
              ...n,
              data: {
                ...n.data,
                isResponseCollapsed: false,
              },
            }
          }
          // Otherwise, keep current state
          return n
        }
        return n
      })
    )
    setClickedEdge(null) // Close popup
  }, [clickedEdge, nodes, edges, setNodes])

  // Handle delete edge - delete from both React Flow state and database
  const handleDeleteEdge = useCallback(async () => {
    console.log('🗑️ handleDeleteEdge called', { clickedEdge, conversationId, nodesLength: nodes?.length })

    if (!clickedEdge) {
      console.warn('Cannot delete edge: no clicked edge')
      return
    }

    if (!conversationId) {
      console.warn('Cannot delete edge: no conversation ID')
      return
    }

    console.log('🗑️ Deleting edge:', clickedEdge.id, 'from', clickedEdge.source, 'to', clickedEdge.target)

    // Store the edge to restore if deletion fails (store all needed data before setting clickedEdge to null)
    const edgeToDelete = clickedEdge
    const sourceNodeId = clickedEdge.source
    const targetNodeId = clickedEdge.target

    // Delete from React Flow state immediately (optimistic update)
    setEdges((eds) => {
      const filtered = eds.filter((e) => e.id !== clickedEdge.id)
      console.log(`🗑️ Removed edge from React Flow state. Had ${eds.length} edges, now have ${filtered.length}`)
      return filtered
    })
    setClickedEdge(null) // Close popup

    // Delete from database (lightweight - just message IDs)
    try {
      const supabase = createClient()

      // Find the source and target message IDs from the edge (use stored IDs since clickedEdge is now null)
      const sourceNode = nodes.find(n => n.id === sourceNodeId)
      const targetNode = nodes.find(n => n.id === targetNodeId)

      if (!sourceNode) {
        console.error('Cannot delete edge: source node not found', sourceNodeId, 'Available nodes:', nodes.map(n => n.id))
        // Re-add edge to React Flow state
        setEdges((eds) => [...eds, edgeToDelete])
        return
      }

      if (!targetNode) {
        console.error('Cannot delete edge: target node not found', targetNodeId, 'Available nodes:', nodes.map(n => n.id))
        // Re-add edge to React Flow state
        setEdges((eds) => [...eds, edgeToDelete])
        return
      }

      // Extract base message IDs (only for chatPanel nodes)
      if (!sourceNode.data.promptMessage?.id || !targetNode.data.promptMessage?.id) {
        console.warn('Cannot delete edge: source or target is not a chatPanel node (freehand nodes cannot have edges)')
        // Re-add edge to React Flow state
        setEdges((eds) => [...eds, edgeToDelete])
        return
      }
      const sourceMessageId = sourceNode.data.promptMessage.id
      const targetMessageId = targetNode.data.promptMessage.id

      console.log('🗑️ Deleting edge from database:', {
        conversationId,
        sourceMessageId,
        targetMessageId,
      })

      const { error, data } = await supabase
        .from('panel_edges')
        .delete()
        .eq('conversation_id', conversationId)
        .eq('source_message_id', sourceMessageId)
        .eq('target_message_id', targetMessageId)
        .select()

      if (error) {
        console.error('Error deleting edge from database:', error)
        // Re-add edge to React Flow state if database deletion failed
        setEdges((eds) => [...eds, edgeToDelete])
        setClickedEdge(edgeToDelete) // Re-open popup
      } else {
        console.log('✅ Deleted edge from database', data)
        // Refetch edges to update savedEdges and prevent edge loading useEffect from re-adding it
        refetchEdges()
      }
    } catch (error) {
      console.error('Error deleting edge:', error)
      // Re-add edge to React Flow state if deletion failed
      setEdges((eds) => [...eds, edgeToDelete])
      setClickedEdge(edgeToDelete) // Re-open popup
    }
  }, [clickedEdge, conversationId, nodes, setEdges, refetchEdges])

  // Handle toggle edge style (dotted/solid) for selected edge
  const handleToggleEdgeStyle = useCallback(() => {
    if (!clickedEdge) return

    const prev = (clickedEdge.data as ThreadEdgeData | undefined) || {}
    const isCurrentlyDotted = prev.dotted === true || clickedEdge.type === 'animatedDotted'
    const dotted = !isCurrentlyDotted
    const nextData: ThreadEdgeData = {
      ...prev,
      dotted,
      algorithm: prev.algorithm ?? DEFAULT_THREAD_ALGORITHM,
      points: prev.points ?? [],
    }

    setEdges((eds) =>
      eds.map((e) =>
        e.id === clickedEdge.id ? { ...e, type: 'editable', data: nextData } : e
      )
    )

    setClickedEdge({ ...clickedEdge, type: 'editable', data: nextData })
  }, [clickedEdge, setEdges])

  // Apply path algorithm + optional dotted/thickness to the open thread menu target
  const patchClickedThreadData = useCallback(
    (patch: Partial<ThreadEdgeData>) => {
      if (!clickedEdge) return
      const prev = (clickedEdge.data as ThreadEdgeData | undefined) || {}
      const nextData: ThreadEdgeData = {
        ...prev,
        algorithm: prev.algorithm ?? DEFAULT_THREAD_ALGORITHM,
        points: prev.points ?? [],
        ...patch,
      }
      setEdges((eds) =>
        eds.map((e) =>
          e.id === clickedEdge.id ? { ...e, type: 'editable', data: nextData } : e
        )
      )
      setClickedEdge({ ...clickedEdge, type: 'editable', data: nextData })
      if (!conversationId) return
      const sourceMsg = nodes.find((n) => n.id === clickedEdge.source)?.data?.promptMessage?.id
      const targetMsg = nodes.find((n) => n.id === clickedEdge.target)?.data?.promptMessage?.id
      if (!sourceMsg || !targetMsg) return
      void (async () => {
        const supabase = createClient()
        const { error } = await supabase
          .from('panel_edges')
          .update({ metadata: nextData })
          .eq('conversation_id', conversationId)
          .eq('source_message_id', sourceMsg)
          .eq('target_message_id', targetMsg)
        if (error && !String(error.message || '').includes('metadata')) {
          console.error('Failed to persist thread style:', error)
        }
      })()
    },
    [clickedEdge, setEdges, conversationId, nodes]
  )

  // ThreadActionsMenu → existing handlers + style clipboard; stubs close the menu
  const handleThreadMenuAction = useCallback(
    (action: ThreadActionId) => {
      if (!clickedEdge) return
      const prev = (clickedEdge.data as ThreadEdgeData | undefined) || {}

      switch (action) {
        case 'delete':
          handleDeleteEdge()
          return
        case 'insertBetween':
          insertNodeBetween(clickedEdge.id)
          setClickedEdge(null)
          return
        case 'collapse':
          handleCollapseTarget()
          return
        case 'toggleDotted':
          handleToggleEdgeStyle()
          return
        case 'copyStyle':
          threadStyleClipboardRef.current = {
            algorithm: prev.algorithm ?? DEFAULT_THREAD_ALGORITHM,
            dotted: prev.dotted === true || clickedEdge.type === 'animatedDotted',
            strokeWidth: prev.strokeWidth ?? THREAD_DEFAULT_STROKE_WIDTH,
          }
          setHasThreadStyleClipboard(true) // Re-render so Paste style enables
          return // Keep menu open
        case 'pasteStyle': {
          const clip = threadStyleClipboardRef.current
          if (!clip) return
          patchClickedThreadData({
            algorithm: clip.algorithm,
            dotted: clip.dotted,
            strokeWidth: clip.strokeWidth,
          })
          setClickedEdge(null)
          return
        }
        case 'styleSmooth':
          patchClickedThreadData({ algorithm: ThreadAlgorithm.BezierCatmullRom })
          setClickedEdge(null)
          return
        case 'styleSharp':
          patchClickedThreadData({ algorithm: ThreadAlgorithm.Orthogonal })
          setClickedEdge(null)
          return
        case 'styleLinear':
          patchClickedThreadData({ algorithm: ThreadAlgorithm.Linear })
          setClickedEdge(null)
          return
        case 'thickness1':
          patchClickedThreadData({ strokeWidth: 1 })
          return // Keep menu open so thickness can be compared
        case 'thickness2':
          patchClickedThreadData({ strokeWidth: 2 })
          return
        case 'thickness3':
          patchClickedThreadData({ strokeWidth: 3 })
          return
        case 'thickness4':
          patchClickedThreadData({ strokeWidth: 4 })
          return
        default:
          // Stubs (copy / duplicate / lock / template / info…) — close for now
          setClickedEdge(null)
      }
    },
    [
      clickedEdge,
      handleDeleteEdge,
      insertNodeBetween,
      handleCollapseTarget,
      handleToggleEdgeStyle,
      patchClickedThreadData,
    ]
  )

  // Miro: drag a thread endpoint to detach and snap onto another frame's connection point
  const handleThreadReconnect = useCallback(
    async (
      oldEdge: Edge,
      newConnection: {
        source: string | null
        target: string | null
        sourceHandle: string | null
        targetHandle: string | null
      }
    ) => {
      if (isLocked || !newConnection.source || !newConnection.target) return
      if (newConnection.source === newConnection.target) return

      const sourceNode = nodes.find((n) => n.id === newConnection.source)
      const targetNode = nodes.find((n) => n.id === newConnection.target)
      if (!sourceNode?.data?.promptMessage?.id || !targetNode?.data?.promptMessage?.id) return

      takeSnapshot()

      // Keep the sides the user snapped to (don't rewrite to nearest) — cleanup comes later
      const nextEdge: Edge = {
        ...oldEdge,
        source: newConnection.source,
        target: newConnection.target,
        sourceHandle:
          normalizeHandleId(newConnection.sourceHandle) || newConnection.sourceHandle,
        targetHandle:
          normalizeHandleId(newConnection.targetHandle) || newConnection.targetHandle,
        type: 'editable',
        data: {
          ...((oldEdge.data as ThreadEdgeData | undefined) || {}),
          algorithm:
            (oldEdge.data as ThreadEdgeData | undefined)?.algorithm ?? DEFAULT_THREAD_ALGORITHM,
          points: [], // Reset bends after reattach
        } satisfies ThreadEdgeData,
      }

      setEdges((eds) => eds.map((e) => (e.id === oldEdge.id ? nextEdge : e)))

      if (!conversationId) return
      try {
        const supabase = createClient()
        const oldSource = nodes.find((n) => n.id === oldEdge.source)?.data?.promptMessage?.id
        const oldTarget = nodes.find((n) => n.id === oldEdge.target)?.data?.promptMessage?.id
        if (!oldSource || !oldTarget) return

        const { error } = await supabase
          .from('panel_edges')
          .update({
            source_message_id: sourceNode.data.promptMessage.id,
            target_message_id: targetNode.data.promptMessage.id,
            metadata: nextEdge.data ?? {},
          })
          .eq('conversation_id', conversationId)
          .eq('source_message_id', oldSource)
          .eq('target_message_id', oldTarget)

        if (error && String(error.message || '').includes('metadata')) {
          await supabase
            .from('panel_edges')
            .update({
              source_message_id: sourceNode.data.promptMessage.id,
              target_message_id: targetNode.data.promptMessage.id,
            })
            .eq('conversation_id', conversationId)
            .eq('source_message_id', oldSource)
            .eq('target_message_id', oldTarget)
        } else if (error) {
          console.error('Error updating thread reconnect:', error)
        }
      } catch (err) {
        console.error('Error updating thread reconnect:', err)
      }
    },
    [conversationId, isLocked, nodes, setEdges, takeSnapshot]
  )

  // Update edge popup position when edge, nodes, or viewport changes
  // Position follows the click position on the edge as viewport changes
  useEffect(() => {
    if (!clickedEdge || !reactFlowInstance || !edgeClickPositionRef.current) return

    const updatePosition = () => {
      // Check if edgeClickPositionRef is still valid (could become null during animation)
      if (!edgeClickPositionRef.current) return
      
      // Convert stored flow coordinates to screen coordinates using current viewport
      const viewport = reactFlowInstance.getViewport()
      const screenX = (edgeClickPositionRef.current.x + viewport.x) * viewport.zoom
      const screenY = (edgeClickPositionRef.current.y + viewport.y) * viewport.zoom

      setEdgePopupPosition({ x: screenX, y: screenY })
    }

    // Initial position update
    updatePosition()

    // Update position continuously using requestAnimationFrame to catch viewport changes
    let animationFrameId: number
    const animate = () => {
      // Stop animation if ref becomes null (edge popup was closed)
      if (!edgeClickPositionRef.current || !clickedEdge) {
        return
      }
      updatePosition()
      animationFrameId = requestAnimationFrame(animate)
    }
    animationFrameId = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animationFrameId)
    }
  }, [clickedEdge, reactFlowInstance])

  // Close popup on zoom (viewport change)
  useEffect(() => {
    if (!clickedEdge || !reactFlowInstance) return

    const checkZoomChange = () => {
      const currentViewport = reactFlowInstance.getViewport()
      if (edgePopupZoomRef.current !== null && Math.abs(currentViewport.zoom - edgePopupZoomRef.current) > 0.01) {
        // Zoom changed - close popup
        setClickedEdge(null)
        edgeClickPositionRef.current = null
        edgePopupZoomRef.current = null
      }
    }

    // Check for zoom changes periodically
    const intervalId = setInterval(checkZoomChange, 100)

    return () => {
      clearInterval(intervalId)
    }
  }, [clickedEdge, reactFlowInstance])

  // Close popup when clicking outside
  useEffect(() => {
    if (!clickedEdge) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      // Check if click is on the popup or edge
      const isOnPopup = target.closest('.edge-popup')
      const isOnEdge = target.closest('.react-flow__edge')

      // Also check if click is on a button inside the popup (to allow delete/collapse buttons to work)
      const isOnButton = target.closest('button') && target.closest('.edge-popup')

      if (!isOnPopup && !isOnEdge && !isOnButton) {
        setClickedEdge(null)
      }
    }

    // Use a small delay to allow button clicks to process first
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [clickedEdge])

  // Map I-bar typing: keep capturing keys until the new frame editor takes over (no dropped chars)
  // Listeners stay mounted; `iBarArmedRef` / creating refs gate work so the first iOS `input` after tap isn’t lost waiting for useEffect
  useEffect(() => {
    const escapeHtml = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')

    const bufferToHtml = (text: string) => {
      if (!text) return '<p></p>'
      // Enter during capture becomes a soft break inside the first block (frame opens single-line)
      const safe = escapeHtml(text).replace(/\n/g, '<br>')
      return `<p>${safe}</p>`
    }

    const pushSeed = () => {
      const messageId = iBarPendingMessageIdRef.current
      if (!messageId) return
      window.dispatchEvent(
        new CustomEvent('tt-ibar-typed-seed', {
          detail: { messageId, text: iBarTypeBufferRef.current, html: bufferToHtml(iBarTypeBufferRef.current) },
        })
      )
    }

    // True when the spawned frame’s ProseMirror already owns focus — hand off and stop capturing
    const tipTapHasFocus = () => {
      if (!iBarPendingMessageIdRef.current) return false
      const nodeEl = document.querySelector(
        `.react-flow__node[data-id="panel-${iBarPendingMessageIdRef.current}"]`
      )
      const pm = nodeEl?.querySelector?.('.ProseMirror') as HTMLElement | null
      return !!(pm && (document.activeElement === pm || pm.contains(document.activeElement)))
    }

    const isCapturing = () =>
      iBarArmedRef.current || iBarCreatingRef.current || !!iBarPendingMessageIdRef.current

    // Frame asked for the latest buffer (editor just mounted / focused)
    const onRequestSeed = (event: Event) => {
      const messageId = (event as CustomEvent<{ messageId?: string }>).detail?.messageId
      if (!messageId || messageId !== iBarPendingMessageIdRef.current) return
      pushSeed()
    }

    // Shared path for desktop keydown chars and iOS soft-keyboard `input` (full buffer string)
    const applyIBarText = (nextText: string) => {
      if (!isCapturing()) return

      if (tipTapHasFocus()) {
        window.dispatchEvent(
          new CustomEvent('tt-ibar-seed-applied', {
            detail: { messageId: iBarPendingMessageIdRef.current },
          })
        )
        return
      }

      if (nextText === iBarTypeBufferRef.current) return // No change (composition tick / duplicate input)
      iBarTypeBufferRef.current = nextText

      // First non-empty buffer: spawn the frame immediately (no await) so text never blanks
      if (!iBarCreatingRef.current) {
        if (!nextText) return // Still idle at the empty I-bar
        const pos = iBarPositionRef.current ?? iBarCreatePosRef.current
        if (!pos) return

        iBarCreatingRef.current = true
        iBarCreatePosRef.current = pos
        setIBarPosition(null)
        iBarPositionRef.current = null
        setIBarBlockMenu(null) // Typing spawned a frame — menu is no longer pre-frame
        setIsCreatingInlineNote(true)

        const cursorOffsetX = BLOCK_CREATE_OFFSET_X // Same as createBlockAtFlowPosition — caret on I-bar
        const cursorOffsetY = BLOCK_CREATE_OFFSET_Y
        const notePosition = {
          x: pos.x - cursorOffsetX,
          y: pos.y - cursorOffsetY,
        }

        const messageId = generateUUID()
        iBarPendingMessageIdRef.current = messageId
        const html = bufferToHtml(iBarTypeBufferRef.current)
        const optimisticMessage = {
          id: messageId,
          role: 'user' as const,
          content: html,
          created_at: new Date().toISOString(),
          metadata: newBlockMetadata({
            position: notePosition,
            fadeIn: true,
          }),
        }

        // Instant RF node at the I-bar — selected + visible with the typed char already in content
        const panelId = `panel-${messageId}`
        const liveBoardId = conversationIdRef.current || '' // Ref: capture effect must not rebind on first board create
        originalPositionsRef.current.set(panelId, notePosition)
        setNodes((nds) => [
          ...nds.map((n) => ({ ...n, selected: false })),
          {
            id: panelId,
            type: 'chatPanel',
            position: notePosition,
            selected: true,
            data: {
              promptMessage: optimisticMessage,
              responseMessage: undefined,
              conversationId: liveBoardId,
              isResponseCollapsed: false,
            },
          },
        ])

        // Patch message caches so a later refetch merges instead of dropping the optimistic row
        const patch = (key: unknown[]) => {
          queryClient.setQueryData(key, (old: unknown) => {
            const list = Array.isArray(old) ? old : []
            if (list.some((m: { id?: string }) => m.id === messageId)) return list
            return [...list, optimisticMessage]
          })
        }
        if (liveBoardId) {
          patch(['messages-for-panels', liveBoardId])
          patch(['messages-for-panels', liveBoardId, 'full'])
          patch(['messages-for-panels', liveBoardId, 'embed'])
        }

        pushSeed()

        // Persist in the background — UI already has the frame
        void (async () => {
          try {
            const supabase = createClient()
            const {
              data: { user },
            } = await supabase.auth.getUser()
            if (!user) {
              console.warn('Cannot persist inline note: user not authenticated')
              return
            }

            let currentConversationId = conversationIdRef.current // Ref so this closure survives board-id assignment
            if (!currentConversationId) {
              const { data: newConversation, error: convError } = await supabase
                .from('conversations')
                .insert({
                  user_id: user.id,
                  title: 'New Conversation',
                  metadata: { position: -1 },
                })
                .select()
                .single()
              if (convError || !newConversation) {
                console.error('Error creating conversation:', convError)
                return
              }
              currentConversationId = newConversation.id
              conversationIdRef.current = currentConversationId // Persist path + later keys use this id immediately
              // Seed caches BEFORE BoardPage enables the query so the merge keeps this frame
              patch(['messages-for-panels', currentConversationId])
              patch(['messages-for-panels', currentConversationId, 'full'])
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === panelId
                    ? { ...n, data: { ...n.data, conversationId: currentConversationId } }
                    : n
                )
              )
              replaceBoardUrl(currentConversationId) // No App Router remount mid-type
            }

            const latestHtml = bufferToHtml(iBarTypeBufferRef.current)
            const { error } = await supabase.from('messages').insert({
              id: messageId,
              conversation_id: currentConversationId,
              user_id: user.id,
              role: 'user',
              content: latestHtml,
              metadata: optimisticMessage.metadata,
            })
            if (error) {
              console.error('Error persisting inline note:', error)
              return
            }
            // Do not refetch here — polling / later idle refetch would rebuild while capture still owns keys
            pushSeed()
          } catch (error) {
            console.error('Error persisting inline note:', error)
          }
        })()
        return
      }

      // Already spawning — keep buffer + live seed in sync until TipTap focuses
      pushSeed()
      const mid = iBarPendingMessageIdRef.current
      if (mid) {
        const html = bufferToHtml(iBarTypeBufferRef.current)
        setNodes((nds) =>
          nds.map((n) =>
            n.id === `panel-${mid}`
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    promptMessage: { ...n.data.promptMessage, content: html },
                  },
                }
              : n
          )
        )
      }
    }
    iBarApplyTextRef.current = applyIBarText // Textarea onInput + compositionend call this

    const handleKeyDown = (event: KeyboardEvent) => {
      // Pre-frame menu: Escape closes it even though capture is disarmed while search is focused
      if (event.key === 'Escape' && iBarBlockMenuOpenRef.current) {
        event.preventDefault()
        event.stopPropagation()
        setIBarBlockMenu(null)
        iBarBlockMenuOpenRef.current = false
        iBarArmedRef.current = true // Menu closed — typing at the I-bar is live again
        iBarInputRef.current?.focus({ preventScroll: true })
        return
      }

      if (!isCapturing()) return

      // Menu search / other fields own keys — don't spawn a frame from those keystrokes
      const keyTarget = event.target as HTMLElement | null
      if (
        keyTarget &&
        keyTarget !== iBarInputRef.current &&
        keyTarget.closest('input, textarea, [contenteditable="true"], .block-actions-menu')
      ) {
        return
      }

      // Escape dismisses the I-bar (only before create starts)
      if (event.key === 'Escape') {
        if (!iBarCreatingRef.current) {
          iBarArmedRef.current = false
          setIBarPosition(null)
          setIBarInputAnchor(null)
          setIBarBlockMenu(null)
          iBarTypeBufferRef.current = ''
          const el = iBarInputRef.current
          if (el) {
            el.value = ''
            el.blur()
          }
        }
        return
      }

      // Soft keyboard / focused capture field: `input` owns the buffer (iOS often sends Unidentified keydowns)
      if (event.target === iBarInputRef.current) {
        if (event.key === 'Enter') {
          event.preventDefault() // Don’t insert a bare newline into the capture field
        }
        if (event.key === 'Backspace' || event.key === 'Delete') {
          event.stopPropagation() // RF deleteKeyCode would otherwise remove the selected new frame
        }
        return
      }

      const ignoredKeys = [
        'Shift',
        'Control',
        'Alt',
        'Meta',
        'Tab',
        'CapsLock',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
        'PageUp',
        'PageDown',
        'Insert',
        'Delete',
        'F1',
        'F2',
        'F3',
        'F4',
        'F5',
        'F6',
        'F7',
        'F8',
        'F9',
        'F10',
        'F11',
        'F12',
      ]
      if (ignoredKeys.includes(event.key)) return
      if (event.ctrlKey || event.altKey || event.metaKey) return

      const isPrintable = event.key.length === 1
      const isEnter = event.key === 'Enter'
      const isBackspace = event.key === 'Backspace'
      if (!isPrintable && !isEnter && !isBackspace) return

      // TipTap already focused on the spawned frame — stop capturing so typing is normal
      if (tipTapHasFocus()) {
        window.dispatchEvent(
          new CustomEvent('tt-ibar-seed-applied', {
            detail: { messageId: iBarPendingMessageIdRef.current },
          })
        )
        return // Do not preventDefault — this keystroke goes into TipTap
      }

      event.preventDefault()
      event.stopPropagation()

      if (isBackspace) {
        applyIBarText(iBarTypeBufferRef.current.slice(0, -1))
        const el = iBarInputRef.current
        if (el) el.value = iBarTypeBufferRef.current // Keep capture field in sync for a later soft keyboard
        return
      }
      if (isEnter) return // Frame owns Enter after focus

      applyIBarText(iBarTypeBufferRef.current + event.key)
      const el = iBarInputRef.current
      if (el) el.value = iBarTypeBufferRef.current
    }

    // Frame editor took over — stop document capture
    const onSeedApplied = (event: Event) => {
      const messageId = (event as CustomEvent<{ messageId?: string }>).detail?.messageId
      if (!messageId || messageId !== iBarPendingMessageIdRef.current) return
      iBarTypeBufferRef.current = ''
      iBarPendingMessageIdRef.current = null
      iBarCreatePosRef.current = null
      iBarCreatingRef.current = false
      iBarArmedRef.current = false
      setIsCreatingInlineNote(false)
      setIBarInputAnchor(null) // Release capture-field anchor now that TipTap owns the keyboard
      const el = iBarInputRef.current
      if (el) {
        el.value = ''
        if (document.activeElement === el) el.blur()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true) // Capture so nothing else eats keys
    window.addEventListener('tt-ibar-seed-applied', onSeedApplied)
    window.addEventListener('tt-ibar-request-seed', onRequestSeed)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('tt-ibar-seed-applied', onSeedApplied)
      window.removeEventListener('tt-ibar-request-seed', onRequestSeed)
      iBarApplyTextRef.current = () => {}
    }
  }, [setNodes, queryClient])

  // Focus the hidden capture field in the same user-gesture turn as the board tap (required for iOS keyboard)
  const focusIBarCapture = useCallback(() => {
    iBarArmedRef.current = true // Arm before focus so an immediate soft-key input isn’t ignored
    const el = iBarInputRef.current
    if (!el) return
    el.value = ''
    iBarTypeBufferRef.current = ''
    el.focus({ preventScroll: true })
  }, [])

  // Handle double-click on map pane to place I-bar cursor
  // The I-bar shows where the note will be created when user starts typing
  const handlePaneDoubleClick = useCallback((event: React.MouseEvent) => {
    // Only proceed if we clicked directly on the pane (not on a node or other element)
    const target = event.target as HTMLElement
    
    // Check if click is on a node or inside a node - don't place I-bar on panels
    const isOnNode = target.closest('.react-flow__node')
    if (isOnNode) return // Don't place I-bar if clicking on panels/nodes
    
    const isPane = target.classList.contains('react-flow__pane') || 
                   target.classList.contains('react-flow__background') ||
                   target.closest('.react-flow__pane')
    
    if (!isPane) return // Don't place I-bar if clicking on edges/controls
    
    // Get click position relative to React Flow container
    const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
    if (!reactFlowElement || !reactFlowInstance) return
    
    const reactFlowRect = reactFlowElement.getBoundingClientRect()
    const screenX = event.clientX - reactFlowRect.left
    const screenY = event.clientY - reactFlowRect.top
    
    // Convert screen coordinates to flow coordinates (world space — rotation-aware)
    const viewport = reactFlowInstance.getViewport()
    const { x: flowX, y: flowY } = paneToFlow(screenX, screenY, viewport)
    
    // Store flow coordinates and current viewport for rendering
    setIBarPosition({ x: flowX, y: flowY })
    iBarPositionRef.current = { x: flowX, y: flowY } // Sync before paint so first soft-key can spawn
    setIBarViewport({ x: viewport.x, y: viewport.y, zoom: viewport.zoom })
    setIBarBlockMenu(null) // New I-bar — close any pre-frame block menu
    setIBarInputAnchor({
      x: flowX,
      y: flowY,
      vx: viewport.x,
      vy: viewport.y,
      zoom: viewport.zoom,
    })
    focusIBarCapture() // Same tap/double-tap gesture → soft keyboard on iOS
  }, [reactFlowInstance, focusIBarCapture])
  
  // Handle drag and drop for shapes from dropdown - matches shapes-pro-example
  // Also accepts AI sidebar chat blocks → create a page frame (user-initiated placement only)
  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault() // Allow drop
    const types = Array.from(event.dataTransfer.types || []) // DOMStringList → array
    const isAiBlock = types.includes(AI_CHAT_BLOCK_MIME) // AI chat turn?
    event.dataTransfer.dropEffect = isAiBlock ? 'copy' : 'move' // Copy chat → page; move shapes
  }, [])

  const handleDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!reactFlowInstance) return

    const position = reactFlowInstance.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    })

    // AI chat turn → new frame; contents are TipTap blocks (lists = listItem grips)
    const aiRaw = event.dataTransfer.getData(AI_CHAT_BLOCK_MIME)
    if (aiRaw) {
      let payload: AiChatBlockDragPayload | null = null
      try {
        payload = JSON.parse(aiRaw) as AiChatBlockDragPayload
      } catch {
        payload = null
      }
      if (payload?.source === 'ai-chat-block' && (payload.html || payload.plain)) {
        try {
          const supabase = createClient()
          const { data: { user } } = await supabase.auth.getUser()
          if (!user || !conversationId) return
          takeSnapshot()
          // Prefer TipTap HTML; markdown plain → proper blocks (never one giant paragraph)
          const rawContent = payload.html?.trim()
            ? payload.html
            : markdownToTipTapHtml(payload.plain || '')
          // Only assistant (AI) response text gets persistent AI-origin marks — not user prompts
          const content =
            payload.role === 'assistant' ? markHtmlWithAiOrigin(rawContent) : rawContent
          const { error } = await supabase
            .from('messages')
            .insert({
              conversation_id: conversationId,
              user_id: user.id,
              role: 'user',
              content,
              metadata: newBlockMetadata({
                position,
                fadeIn: true,
                fromAiChat: true,
                hasAiOrigin: payload.role === 'assistant',
                aiMessageId: payload.messageId,
              }),
            })
          if (error) {
            console.error('Failed to place AI chat turn as frame:', error)
            return
          }
          refetchMessages()
        } catch (err) {
          console.error('AI chat turn drop failed:', err)
        }
        return
      }
    }

    const shapeType = event.dataTransfer.getData('application/reactflow')
    // Only handle shape types, not other drag operations
    if (!shapeType || !['rectangle', 'round-rectangle', 'circle', 'hexagon', 'diamond', 'arrow-rectangle', 'cylinder', 'triangle', 'parallelogram', 'plus'].includes(shapeType)) {
      return
    }

    // Take snapshot before creating shape for undo support
    takeSnapshot()

    const newNodeId = `shape-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    const newNode = {
      id: newNodeId,
      type: 'shape' as const,
      position,
      style: { width: 100, height: 100 },
      data: {
        type: shapeType,
        color: fillColor || '#3F8AE2',
        fillColor: fillColor || '#3F8AE2',
        borderColor: borderColor || fillColor || '#3F8AE2',
        borderWeight: borderWeight || 2,
      },
      selected: true,
    }

    setNodes((nds) => {
      const updatedNodes = nds.map((n) => ({ ...n, selected: false }))
      return [...updatedNodes, newNode]
    })
  }, [reactFlowInstance, fillColor, borderColor, borderWeight, setNodes, takeSnapshot, conversationId, refetchMessages])

  // Embedded page previews stay chrome-light (no minimap / nav chrome fighting the tiny viewport)
  useEffect(() => {
    if (embedded) {
      setIsMinimapHidden(true)
      setIsMinimapManuallyHidden(true)
    }
  }, [embedded])

  // Pinch / ctrl+wheel over connection points, indicators, resize dots, or thread knobs can
  // miss RF's ZoomPane (nopan Handles + chrome outside the pane hit path) and zoom the browser.
  // Capture on the board root: always zoom the page around the cursor instead.
  useEffect(() => {
    const root = boardRootRef.current
    if (!root || !reactFlowInstance) return

    const HANDLE_ZOOM_SEL =
      '.react-flow__handle, [data-tt-connection-indicator], .react-flow__resize-control, .react-flow__edgeupdater, circle.nopan'

    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return // Only pinch / browser-zoom gestures
      const target = e.target as Element | null
      if (!target?.closest?.('.react-flow')) return // Outside the page map
      if (!target.closest(HANDLE_ZOOM_SEL)) return // Pane/body: let RF ZoomPane handle it

      e.preventDefault() // Never let the browser zoom
      e.stopPropagation() // Own this gesture (avoid double-zoom with RF)

      const flowEl = target.closest('.react-flow') as HTMLElement
      const rect = flowEl.getBoundingClientRect()
      const viewport = reactFlowInstance.getViewport()
      const isMac = /Mac|iPhone|iPod|iPad/i.test(navigator.platform)
      const factor = e.ctrlKey && isMac ? 10 : 1 // Match RF wheelDelta pinch feel
      const pinchDelta =
        -e.deltaY * (e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.002) * factor
      const minZ = embedded ? 0.15 : 0.1
      const maxZ = embedded ? 2.5 : 2
      const nextZoom = Math.min(
        maxZ,
        Math.max(minZ, viewport.zoom * Math.pow(2, pinchDelta))
      )
      if (nextZoom === viewport.zoom) return

      // Keep the flow point under the cursor fixed while zooming (rotation-aware)
      const next = viewportKeepingPanePoint(
        e.clientX - rect.left,
        e.clientY - rect.top,
        viewport,
        boardRotation,
        boardRotation,
        nextZoom
      )
      reactFlowInstance.setViewport(next)
    }

    root.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => root.removeEventListener('wheel', onWheel, { capture: true })
  }, [reactFlowInstance, embedded, boardRotation])

  return (
    <div
      ref={boardRootRef}
      data-board-root // Phone AI dock portals here (escapes main overflow-hidden)
      // absolute inset-0 fills the map column (chrome uses getBoundingClientRect of this box)
      className="absolute inset-0"
      style={{ WebkitTouchCallout: 'none' }} // Prefer our long-press menus over iOS callout
      onDoubleClick={embedded ? undefined : handlePaneDoubleClick}
    >
      {!embedded && <AiEditReviewBar />}
      <FrameNestStackOverlay ui={frameNestStackUi} />
      <ReactFlow
        // Hide React Flow watermark; Pro license by launch
        proOptions={{ hideAttribution: true }}
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesState}
        // Fill the (positioned) BoardFlow root via absolute insets — percentage height:100%
        // was resolving short, so the pane/dotted <Background> only covered the top of the map
        // (nodes/chrome still painted lower). inset:0 gives a definite full-height box.
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        onNodeDragStart={(event, node) => {
          // Do NOT cancel long-press here — RF threshold 0 fires drag-start on touchstart
          // (canceling here blocked hold→menu). Cancel on first real move in onNodeDrag instead.
          if (node) {
            frameDragOriginRef.current = {
              id: node.id,
              x: node.position.x,
              y: node.position.y,
            }
          }
          // Hide placeholders only when the connected target node is dragged, not when placeholder itself is dragged
          if (!node) return
          
          // Look up the node from nodes array to get accurate type
          const currentNode = nodes.find((n) => n.id === node.id)
          
          // Don't hide placeholders if the placeholder itself is being dragged
          if (node.type === 'placeholder' || currentNode?.type === 'placeholder') {
            return
          }

          // Check if this node is the target of any placeholder (the node the placeholder is connected to)
          const placeholderNodes = nodes.filter((n) => n.type === 'placeholder')
          const isTargetNode = placeholderNodes.some(
            (placeholder) => placeholder.data?.targetNodeId === node.id
          )
          
          // Only hide placeholders if this is a target node being dragged
          if (isTargetNode && (node.selected || currentNode?.selected)) {
            setIsSelectedNodeDragging(true)
          }

          onFrameNestStackDragStart(event, node) // Snapshot lock-group origins / reset unstack
        }}
        onNodeDrag={(event, node) => {
          // First real move — abandon long-press so drag owns the gesture
          const origin = frameDragOriginRef.current
          if (origin && node && origin.id === node.id) {
            const dx = node.position.x - origin.x
            const dy = node.position.y - origin.y
            if (dx * dx + dy * dy > 0.25) {
              longPressRef.current?.cancel()
            }
          }
          // Hide placeholders only when the connected target node is dragged, not when placeholder itself is dragged
          if (!node) return
          
          // Look up the node from nodes array to get accurate type
          const currentNode = nodes.find((n) => n.id === node.id)
          
          // Don't hide placeholders if the placeholder itself is being dragged
          if (node.type === 'placeholder' || currentNode?.type === 'placeholder') {
            return
          }
          
          // Check if this node is the target of any placeholder (the node the placeholder is connected to)
          const placeholderNodes = nodes.filter((n) => n.type === 'placeholder')
          const isTargetNode = placeholderNodes.some(
            (placeholder) => placeholder.data?.targetNodeId === node.id
          )
          
          // Only hide placeholders if this is a target node being dragged
          if (isTargetNode && (node.selected || currentNode?.selected)) {
            setIsSelectedNodeDragging(true)
          }

          onBlockGroupNodeDrag(event, node) // Highlight group drop target while dragging a block
          onFrameNestStackDrag(event, node) // Edge-snap preview / magnet
        }}
        onNodeDragStop={(event, node) => {
          // Clear drag state when drag stops
          setIsSelectedNodeDragging(false)
          // Rebuild helper lines index when drag stops
          if (snapEnabled) {
            rebuildIndex(nodes)
          }
          void onBlockGroupNodeDragStop(event, node) // Attach to group / detach onto the page + persist
          void onFrameNestStackDragStop(event, node) // Link snap pair → stack line (no hide)

          // Only skip click-select when the frame actually moved (threshold-0 still fires drag start/stop on tap)
          const origin = frameDragOriginRef.current
          frameDragOriginRef.current = null
          if (node?.type === 'chatPanel' && origin && origin.id === node.id) {
            const dx = node.position.x - origin.x
            const dy = node.position.y - origin.y
            if (dx * dx + dy * dy > 0.25) {
              justDraggedFrameRef.current.add(node.id)
              window.setTimeout(() => justDraggedFrameRef.current.delete(node.id), 100)
            }
          }
        }}
        nodeTypes={memoizedNodeTypes}
        edgeTypes={memoizedEdgeTypes}
        connectionMode={ConnectionMode.Loose}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineComponent={ThreadConnectionLine} // Thread free end tracks the cursor
        connectionRadius={36} // Snap only when close to a connection point (not the whole frame)
        edgesUpdatable={canEdit && !isLocked} // Drag either end to detach / reconnect (view-only off)
        edgeUpdaterRadius={20} // Hit area for grabbing a thread endpoint
        onEdgeUpdate={handleThreadReconnect}
        onSelectionChange={() => {
          window.dispatchEvent(new Event('tt-selection-changed')) // Top-bar frame lock reads selection
        }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onConnect={async (params) => {
          if (!isLocked && params.source && params.target) {
            // Check if either source or target is a flashcard or freehand node
            const sourceNode = nodes.find(n => n.id === params.source)
            const targetNode = nodes.find(n => n.id === params.target)
            
            // Prevent edge creation for freehand nodes (they don't have promptMessage)
            if (!sourceNode?.data?.promptMessage || !targetNode?.data?.promptMessage) {
              console.log('🔄 BoardFlow: Cannot create edge for freehand nodes')
              return
            }
            
            const sourceIsFlashcard = sourceNode.data.promptMessage.metadata?.isFlashcard === true
            const targetIsFlashcard = targetNode.data.promptMessage.metadata?.isFlashcard === true
            
            // Prevent edge creation for flashcards
            if (sourceIsFlashcard || targetIsFlashcard) {
              console.log('🔄 BoardFlow: Cannot create edge for flashcard')
              return
            }
            
            // Check if an edge already exists between these two nodes (in either direction)
            const existingEdge = edges.find(e => 
              (e.source === params.source && e.target === params.target) ||
              (e.source === params.target && e.target === params.source)
            )
            
            if (existingEdge) {
              console.log('🔄 BoardFlow: Edge already exists between these nodes, preventing duplicate')
              return
            }
            
            // Take snapshot before creating edge for undo support
            takeSnapshot()
            
            // Keep the sides the user snapped to; only fall back to closest if a side is missing
            const sourceHandle =
              normalizeHandleId(params.sourceHandle) || params.sourceHandle || null
            const targetHandle =
              normalizeHandleId(params.targetHandle) || params.targetHandle || null
            const fallback =
              !sourceHandle || !targetHandle
                ? findClosestHandles(sourceNode, targetNode)
                : null
            if (!sourceHandle && !fallback?.sourceHandle) {
              console.warn('🔄 BoardFlow: Could not resolve source handle for edge creation')
              return
            }
            if (!targetHandle && !fallback?.targetHandle) {
              console.warn('🔄 BoardFlow: Could not resolve target handle for edge creation')
              return
            }

            const newEdge: Edge = {
              id: `${params.source}-${params.target}`,
              source: params.source,
              target: params.target,
              // Always store edge-anchor ids (never *-indicator) so geometry stays on the frame
              sourceHandle: sourceHandle || fallback?.sourceHandle || null,
              targetHandle: targetHandle || fallback?.targetHandle || null,
              type: 'editable', // Miro-style adjustable thread
              data: {
                algorithm: threadAlgorithmFromStyle(
                  typeof window !== 'undefined'
                    ? localStorage.getItem('thinktable-horizontal-line-style')
                    : null
                ),
                points: [],
                dotted: lineStyle === 'dotted',
              } satisfies ThreadEdgeData,
            }

            // Add to React Flow state immediately (optimistic update)
            setEdges((eds) => {
              if (eds.some((e) => e.id === newEdge.id)) return eds // Already present
              return [...eds, newEdge]
            })
            // Remeasure handle bounds so the path attaches on both ends
            if (params.source) updateNodeInternals(params.source)
            if (params.target) updateNodeInternals(params.target)

            // Save to database
            try {
              const supabase = createClient()
              const { data: { user } } = await supabase.auth.getUser()

              if (!user) {
                console.warn('Cannot save edge: user not authenticated')
                return
              }

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
                  console.error('Error creating conversation:', convError)
                  // Remove edge from React Flow state if conversation creation failed
                  setEdges((eds) => eds.filter(e => e.id !== newEdge.id))
                  return
                }

                currentConversationId = newConversation.id

                replaceBoardUrl(currentConversationId) // Address bar only — router.replace remounts the map
              }

              // Find source and target nodes to get message IDs
              const sourceNode = nodes.find(n => n.id === params.source)
              const targetNode = nodes.find(n => n.id === params.target)

              if (sourceNode && targetNode) {
                // Ensure both nodes are chatPanel nodes (have promptMessage)
                if (!sourceNode.data.promptMessage?.id || !targetNode.data.promptMessage?.id) {
                  console.warn('Cannot save edge: source or target is not a chatPanel node (freehand nodes cannot have edges)')
                  // Remove edge from React Flow state
                  setEdges((eds) => eds.filter(e => e.id !== newEdge.id))
                  return
                }
                const sourceMessageId = sourceNode.data.promptMessage.id
                const targetMessageId = targetNode.data.promptMessage.id

                // Check if edge already exists in database (in either direction)
                const { data: existingEdges } = await supabase
                  .from('panel_edges')
                  .select('id')
                  .eq('conversation_id', currentConversationId)
                  .or(`and(source_message_id.eq.${sourceMessageId},target_message_id.eq.${targetMessageId}),and(source_message_id.eq.${targetMessageId},target_message_id.eq.${sourceMessageId})`)
                
                // Also check if we're trying to connect a node to itself
                if (sourceMessageId === targetMessageId) {
                  console.log('🔄 BoardFlow: Cannot create edge from node to itself')
                  setEdges((eds) => eds.filter(e => e.id !== newEdge.id))
                  return
                }

                if (existingEdges && existingEdges.length > 0) {
                  console.log('🔄 BoardFlow: Edge already exists in database between these nodes, preventing duplicate')
                  // Remove edge from React Flow state since it already exists
                  setEdges((eds) => eds.filter(e => e.id !== newEdge.id))
                  return
                }

                const { error } = await supabase
                  .from('panel_edges')
                  .insert({
                    conversation_id: currentConversationId,
                    user_id: user.id,
                    source_message_id: sourceMessageId,
                    target_message_id: targetMessageId,
                    metadata: newEdge.data ?? {},
                  })

                if (error) {
                  // Retry without metadata if column not migrated yet
                  if (String(error.message || '').includes('metadata')) {
                    const retry = await supabase.from('panel_edges').insert({
                      conversation_id: currentConversationId,
                      user_id: user.id,
                      source_message_id: sourceMessageId,
                      target_message_id: targetMessageId,
                    })
                    if (retry.error) {
                      console.error('Error saving edge to database:', retry.error)
                      setEdges((eds) => eds.filter((e) => e.id !== newEdge.id))
                      return
                    }
                    console.log('✅ Saved edge to database (without metadata column)')
                    refetchEdges()
                  } else {
                    console.error('Error saving edge to database:', error)
                    try {
                      const errorDetails = {
                        message: error?.message || 'Unknown error',
                        code: error?.code || 'Unknown code',
                        details: error?.details || null,
                        hint: error?.hint || null,
                        name: error?.name || null,
                        fullError: error
                          ? JSON.stringify(error, Object.getOwnPropertyNames(error))
                          : 'Error object is null or undefined',
                      }
                      console.error('Error details:', errorDetails)
                    } catch (stringifyError) {
                      console.error('Error stringifying error object:', stringifyError)
                      console.error('Raw error:', error)
                    }
                    if (error.code === '23505') {
                      console.log('Edge already exists in database (duplicate), keeping in React Flow')
                    } else {
                      setEdges((eds) => eds.filter((e) => e.id !== newEdge.id))
                    }
                  }
                } else {
                  console.log('✅ Saved edge to database')
                  refetchEdges()
                }
              } else {
                console.warn('Cannot save edge: source or target node not found')
              }
            } catch (error: any) {
              console.error('Error saving edge:', error)
              // Log full error details for debugging
              if (error) {
                try {
                  const errorDetails = {
                    message: error?.message || 'Unknown error',
                    code: error?.code || 'Unknown code',
                    details: error?.details || null,
                    hint: error?.hint || null,
                    name: error?.name || null,
                    stack: error?.stack || null,
                    fullError: error ? JSON.stringify(error, Object.getOwnPropertyNames(error)) : 'Error object is null or undefined'
                  }
                  console.error('Error details:', errorDetails)
                } catch (stringifyError) {
                  console.error('Error stringifying error object:', stringifyError)
                  console.error('Raw error:', error)
                }
              } else {
                console.error('Error object is null or undefined')
              }
              // Remove edge from React Flow state if save failed
              setEdges((eds) => eds.filter(e => e.id !== newEdge.id))
            }
          }
        }}
        onEdgeClick={handleEdgeClick}
        onNodeClick={(event, node) => {
          // Long-press already opened the frame menu — skip click-select
          if (longPressRef.current?.consumeFired()) return
          // Clear I-bar cursor when clicking on a node/panel
          if (iBarPosition || iBarInputAnchor) {
            setIBarPosition(null)
            setIBarInputAnchor(null)
            iBarArmedRef.current = false
            if (iBarInputRef.current && document.activeElement === iBarInputRef.current) {
              iBarInputRef.current.value = ''
              iBarInputRef.current.blur()
            }
          }
          // Clicking a host block (outside nested preview chrome) clears preview style-focus
          if (!embedded && previewFocus?.focusedBoardId) {
            const target = event.target as Element | null
            if (!target?.closest?.('[data-page-preview]')) {
              previewFocus.clearPreviewFocus()
            }
          }
          // Frames: select on click release only (mousedown select is blocked so drag ≠ select)
          if (node?.type !== 'chatPanel') return
          if (justDraggedFrameRef.current.has(node.id)) return // Drag release is not a select
          const additive = event.metaKey || event.ctrlKey || event.shiftKey
          setNodes((nds) =>
            nds.map((n) => {
              if (n.id === node.id) return { ...n, selected: true }
              if (additive) return n // Keep other selected frames for multi-select
              return n.selected ? { ...n, selected: false } : n
            })
          )
        }}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneContextMenu={handlePaneContextMenu}
        onPaneClick={(event) => {
          // Long-press already opened the board menu — don't place I-bar
          if (longPressRef.current?.consumeFired()) return
          // Empty host pane click drops nested preview style-focus
          if (!embedded && previewFocus?.focusedBoardId) {
            previewFocus.clearPreviewFocus()
          }

          // Left click on empty map only
          if (!reactFlowInstance || event.button !== 0) return

          // Blur boardLink title / TipTap focus BEFORE deselection settles. Otherwise
          // onEditorActiveChange still sees focus inside the frame and re-selects it
          // (boardLink contentEditable lives inside the ProseMirror DOM).
          const ae = document.activeElement as HTMLElement | null
          if (ae && ae !== document.body && typeof ae.blur === 'function') {
            const inFrame = ae.closest?.('.react-flow__node')
            if (inFrame) ae.blur()
          }

          // If a panel is selected, let React Flow deselect — don't place I-bar on that click
          const hasSelectedPanel = selectedNodeIdsRef.current.length > 0
          if (hasSelectedPanel) {
            setIBarPosition(null)
            setIBarInputAnchor(null)
            iBarArmedRef.current = false
            const el = iBarInputRef.current
            if (el && document.activeElement === el) {
              el.value = ''
              el.blur()
            }
            return
          }

          const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
          if (!reactFlowElement) return

          const reactFlowRect = reactFlowElement.getBoundingClientRect()
          const screenX = event.clientX - reactFlowRect.left
          const screenY = event.clientY - reactFlowRect.top
          const viewport = reactFlowInstance.getViewport()
          const { x: flowX, y: flowY } = paneToFlow(screenX, screenY, viewport) // Caret point in world space (rotation-aware)

          setRightClickedNode(null) // Don't stack with node action popup
          setBoardMenuPosition(null) // Don't stack with board menu
          boardClickFlowRef.current = null
          setIBarBlockMenu(null) // New I-bar — close any pre-frame block menu
          // Place blinking cursor + grip (type or click grip to open the block menu) — not Item/Flashcard menu
          setIBarPosition({ x: flowX, y: flowY })
          iBarPositionRef.current = { x: flowX, y: flowY } // Available immediately for first soft-key spawn
          setIBarViewport({ x: viewport.x, y: viewport.y, zoom: viewport.zoom })
          setIBarInputAnchor({
            x: flowX,
            y: flowY,
            vx: viewport.x,
            vy: viewport.y,
            zoom: viewport.zoom,
          })
          focusIBarCapture() // Must focus editable in this tap turn or iPhone keyboard never opens
        }}
        defaultViewport={{ x: 0, y: 0, zoom: embedded ? 0.8 : 0.6 }}
        // Embedded previews: no continuous fitView (fights pan/zoom); host keeps canvas fitView
        fitView={!embedded && viewMode === 'canvas'}
        fitViewOptions={{ padding: 0.2, minZoom: 0.3, maxZoom: 2 }}
        className={cn(
          'h-full w-full bg-gray-50 dark:bg-[#0f0f0f]',
          isThreadConnecting && 'tt-thread-connecting', // Invisible edge points stay snappable while dragging a thread
          !embedded && mapPointerTool === 'pan' && !isDrawing && 'tt-map-pan-tool', // Grab cursor while pan tool is active
          boardLoadPhase === 'reveal' && 'tt-board-load-reveal' // Crossfade placeholder shells with real contents
        )}
        onInit={(instance) => {
          const currentViewport = instance.getViewport()
          if (!isFinite(currentViewport.x) || !isFinite(currentViewport.y) || !isFinite(currentViewport.zoom)) {
            instance.setViewport({ x: 0, y: 0, zoom: embedded ? 0.8 : 0.6 })
          } else if (embedded) {
            instance.fitView({ padding: 0.15, minZoom: 0.2, maxZoom: 1.5 }) // One-shot frame in preview
          }
          setReactFlowInstance(instance)
          if (embedded) setEmbedFlowReady(true) // Host can drop loading veil once messages also resolve
        }}
        // Host default = drag-select; pan tool / embed / middle-right mouse pan instead
        panOnDrag={
          embedded
            ? true
            : isDrawing
              ? false
              : mapPointerTool === 'pan'
                ? true
                : isMobileMode
                  ? false // Phone: RF [1,2] only filters mousedown — touchstart still pans
                  : [1, 2] // Desktop select: middle/right still pan; left drag = selection box
        }
        selectionOnDrag={!embedded && !isDrawing && mapPointerTool === 'select'} // Left-drag marquee without Shift
        zoomOnScroll={embedded ? true : !isScrollMode && !isDrawing}
        zoomOnPinch={embedded ? true : !isDrawing} // Pinch always zooms; Scroll nav only changes wheel pan vs wheel zoom
        zoomOnDoubleClick={false}
        minZoom={embedded ? 0.15 : 0.1}
        maxZoom={embedded ? 2.5 : 2}
        preventScrolling // RF consumes wheel so the host page/map doesn’t scroll
        autoPanOnNodeDrag={false}
        selectNodesOnDrag={embedded ? false : !isDrawing} // Preview: drag starts pan, not selection box
        multiSelectionKeyCode={MULTI_SELECT_KEYS}
        selectionKeyCode={
          embedded || isDrawing || mapPointerTool === 'select'
            ? null // Select tool uses selectionOnDrag; no Shift required
            : SELECTION_BOX_KEYS // Pan tool: Shift+drag still draws a selection box
        }
        // Backspace/Delete remove selected frames/threads. TipTap editors use class `nokey` so RF
        // skips delete while typing (isInputDOMNode misses <p>/<br> without contenteditable).
        deleteKeyCode={canEdit ? DELETE_KEYS : null}
        nodesDraggable={canEdit}
        nodesConnectable={canEdit}
        onMove={(event, viewport) => {
          // Publish flow-space center of the visible pane for AI Edit frame placement
          const pane = document.querySelector('.react-flow')
          if (pane && reactFlowInstance) {
            const r = pane.getBoundingClientRect()
            const c = reactFlowInstance.screenToFlowPosition({
              x: r.left + r.width / 2,
              y: r.top + r.height / 2,
            })
            setAiViewportCenter(c)
          }
          // Update viewport key to trigger re-render for button visibility check (throttled)
          // Only update every 100ms to prevent excessive re-renders
          if (viewportUpdateTimeoutRef.current) {
            clearTimeout(viewportUpdateTimeoutRef.current)
          }
          viewportUpdateTimeoutRef.current = setTimeout(() => {
            setViewportKey(prev => prev + 1)
            viewportUpdateTimeoutRef.current = null
          }, 100)
          
          // Skip centering adjustments if we're currently switching to Linear mode
          if (isSwitchingToLinearRef.current) {
            return
          }

          // Skip adjustments during fitView/zoom reset transitions to allow smooth animation
          if (fitViewInProgressRef.current) {
            prevZoomRef.current = viewport.zoom
            return
          }

          // Skip adjustments if we're currently zooming to 100% on click
          if (isZoomingTo100Ref.current) {
            prevZoomRef.current = viewport.zoom
            return
          }

          // Skip adjustments if we're currently scrolling to bottom
          if (isScrollingToBottomRef.current) {
            prevZoomRef.current = viewport.zoom
            return
          }

          // Skip adjustments if we're currently centering a panel
          if (isCenteringPanelRef.current) {
            prevZoomRef.current = viewport.zoom
            return
          }

          // Skip adjustments if a node was just selected (prevent jump to bottom on selection)
          // Check if selection just changed - if so, don't adjust viewport in linear mode
          if (selectionJustChangedRef.current && viewMode === 'linear') {
            // Restore previous Y position if it changed significantly (jump detected)
            if (previousViewportYRef.current !== null && Math.abs(viewport.y - previousViewportYRef.current) > 10) {
              // Viewport Y jumped - restore it to prevent jump
              reactFlowInstance.setViewport({
                x: viewport.x,
                y: previousViewportYRef.current, // Keep previous Y position
                zoom: viewport.zoom,
              }, { duration: 0 })
            } else {
              // Update stored Y position
              previousViewportYRef.current = viewport.y
            }
            // Just update zoom ref, don't adjust viewport position
            prevZoomRef.current = viewport.zoom
            savedZoomRef.current.linear = viewport.zoom
            return
          }

          // Update stored Y position for future comparisons
          previousViewportYRef.current = viewport.y

          // In Linear mode, always lock horizontal position to prevent horizontal panning
          if (false && nodes && Array.isArray(nodes) && nodes.length > 0) {
            const currentZoom = viewport.zoom

            // Find the prompt box and align panels to its horizontal center
            const reactFlowElement = document.querySelector('.react-flow') as HTMLElement | null
            if (reactFlowElement) {
              const mapAreaWidth = reactFlowElement!.clientWidth
              const panelWidth = 768 // Same width as prompt box

              // Guard against invalid values
              if (!isFinite(mapAreaWidth) || !isFinite(currentZoom) || !isFinite(viewport.x) || !isFinite(viewport.y)) {
                return
              }

              // Get current panel X position (all panels should have same X in linear mode)
              const currentPanelX = nodes[0]?.position.x || 0

              // Try to get the actual prompt box position for perfect alignment
              const promptBoxContainer = document.querySelector('[class*="pointer-events-auto"]') as HTMLElement
              const chatTextarea = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]') as HTMLElement
              const promptBox = chatTextarea?.closest('[class*="pointer-events-auto"]') as HTMLElement

              let targetViewportX: number

              if (promptBox) {
                // Get prompt box position relative to React Flow container
                const promptBoxRect = promptBox.getBoundingClientRect()
                const reactFlowRect = reactFlowElement!.getBoundingClientRect()

                // Calculate prompt box center relative to React Flow container
                const promptBoxCenterX = (promptBoxRect.left + promptBoxRect.right) / 2 - reactFlowRect.left

                // Position panels so their center aligns with prompt box center
                // Formula: screenX = worldX * zoom + viewportX
                // Panel center in world coords: currentPanelX + panelWidth/2
                // We want: (currentPanelX + panelWidth/2) * zoom + viewportX = promptBoxCenterX
                // So: viewportX = promptBoxCenterX - (currentPanelX + panelWidth/2) * zoom
                targetViewportX = promptBoxCenterX - (currentPanelX + panelWidth / 2) * currentZoom
              } else {
                // Fallback: use same calculation as prompt box
                const expandedSidebarWidth = 256
                const collapsedSidebarWidth = 64
                const minimapWidth = 179
                const minimapMargin = 15

                const sidebarElement = document.querySelector('[class*="w-16"], [class*="w-64"]') as HTMLElement
                const isSidebarExpanded = sidebarElement?.classList.contains('w-64') ?? false
                const currentSidebarWidth = isSidebarExpanded ? expandedSidebarWidth : collapsedSidebarWidth

                const fullWindowWidth = window.screen.width
                const fullMapAreaWidth = fullWindowWidth - currentSidebarWidth
                const minimapLeftEdge = fullMapAreaWidth - minimapWidth - minimapMargin
                const gapFromSidebarToMinimap = minimapLeftEdge
                const calculatedLeftGap = Math.max(0, (1 / 2) * (gapFromSidebarToMinimap - panelWidth))

                // Calculate prompt box center based on its positioning logic
                const rightGapWhenLeftAligned = mapAreaWidth - calculatedLeftGap - panelWidth

                let promptBoxCenterX: number
                if (rightGapWhenLeftAligned < calculatedLeftGap) {
                  // Prompt box is centered
                  promptBoxCenterX = mapAreaWidth / 2
                } else {
                  // Prompt box is pushed left
                  promptBoxCenterX = calculatedLeftGap + (panelWidth / 2)
                }

                // Same formula: viewportX = promptBoxCenterX - (panelX + panelWidth/2) * zoom
                targetViewportX = promptBoxCenterX - (currentPanelX + panelWidth / 2) * currentZoom
              }

              // Guard against NaN values
              if (!isFinite(targetViewportX)) {
                return
              }

              // Only adjust if X position differs (allow vertical panning, lock horizontal to prompt box)
              if (Math.abs(viewport.x - targetViewportX) > 1) {
                reactFlowInstance.setViewport({
                  x: targetViewportX,
                  y: viewport.y, // Keep vertical position from panning/zoom
                  zoom: currentZoom,
                })
              }
            }

            prevZoomRef.current = currentZoom
            // Save zoom for linear mode
            savedZoomRef.current.linear = currentZoom

            // Check if at bottom
            checkIfAtBottom()
          } else {
            // Not in linear mode, just update zoom ref and save for canvas mode
            prevZoomRef.current = viewport.zoom
            savedZoomRef.current.canvas = viewport.zoom
          }
          
          // Update I-bar viewport for re-rendering (keeps I-bar in correct visual position)
          if (iBarPosition) {
            setIBarViewport({ x: viewport.x, y: viewport.y, zoom: viewport.zoom })
          }
        }}
      >
        {backgroundVariant && (
          <Background
            variant={backgroundVariant}
            gap={boardStyle === 'lined' ? [9999, backgroundGap] : [backgroundGap, backgroundGap]}
            size={1}
            lineWidth={0.5}
          />
        )}

        {/* Freehand drawing overlay - only shown when drawing mode is active and drawTool is pencil */}
        {isDrawing && drawTool === 'pencil' && <Freehand conversationId={conversationId} onBeforeCreate={takeSnapshot} />}
        
        {/* Helper lines for snap-to-grid functionality */}
        <HelperLines />

      </ReactFlow>
    {/* Minimap + Free nav + brand — outside RF, absolute on BoardFlow root */}
      {/* Column stack: Free nav above minimap (no absolute overlap cutting corners) */}
      {!embedded && !hideMapChrome && (
       <>
       <div
         className="z-10 flex flex-col items-stretch"
         style={{
           position: 'absolute',
           bottom: `${
             // Tighter to the AI dock when phone chat is open; keep default inset otherwise
             (isMobileMode && isChatSidebarOpen ? 2 : MINIMAP_BOTTOM) + mapChromeBottomPad
           }px`,
           left: `${mapChromeLeft}px`,
           width: FREE_NAV_WIDTH,
           gap: 0, // Nav↔minimap air lives on the minimap clip so it collapses with the expand tween
           transition: 'none', // Instant with AI dock — no lag
         }}
       >
        {/* Free nav: Scroll/Zoom + zoom % + select/pan — always first in the stack */}
        <div
          data-minimap-toggle-context
          className="relative"
          onContextMenuCapture={(e) => {
            // Capture so RF MiniMap / child handlers cannot swallow the map menu
            e.preventDefault()
            e.stopPropagation()
            setMinimapContextMenuPosition({ x: e.clientX, y: e.clientY })
          }}
          onMouseEnter={() => {
            setIsMinimapHovering(true)
            isMinimapHoveringRef.current = true
            if (minimapHideTimeoutRef.current) {
              clearTimeout(minimapHideTimeoutRef.current)
              minimapHideTimeoutRef.current = null
            }
          }}
          onMouseLeave={(e) => {
            setIsMinimapHovering(false)
            isMinimapHoveringRef.current = false
            checkAndHideMinimap(e.relatedTarget as HTMLElement)
          }}
        >
          {/* Minimap +/- — circle, top-left of Free nav; fill matches nav menu */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-minimap-pill-context
            className={cn(
              'absolute -top-1 -left-1 z-20 h-5 w-5 p-0 rounded-full border-0 shadow-sm focus-visible:ring-0 focus-visible:ring-offset-0',
              freeNavBoardFill, // Same fill as Free nav bar
              !minimapExpanded
                ? 'text-gray-500 dark:text-gray-400 hover:opacity-90'
                : 'text-gray-900 dark:text-gray-100 hover:opacity-90'
            )}
            title={!minimapExpanded ? 'Show minimap' : 'Hide minimap'}
            aria-label={!minimapExpanded ? 'Show minimap' : 'Hide minimap'}
            aria-pressed={minimapExpanded}
            onContextMenuCapture={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setMinimapContextMenuPosition({ x: e.clientX, y: e.clientY })
            }}
            onClick={(e) => {
              e.stopPropagation()
              // Phone AI jumped: click when closed → pin open; click when pinned → close
              if (phoneAiOpen) {
                if (!aiDockMinimapOpen || !aiDockMinimapPinned) {
                  setAiDockMinimapOpen(true)
                  setAiDockMinimapPinned(true)
                  aiDockMinimapPinnedRef.current = true
                } else {
                  setAiDockMinimapOpen(false)
                  setAiDockMinimapPinned(false)
                  aiDockMinimapPinnedRef.current = false
                }
                return
              }
              // Closed → open and stay (shown). Open → hide.
              if (minimapMode === 'shown' && !isMinimapHidden) {
                setMinimapMode('hidden')
                setIsMinimapHidden(true)
                setIsMinimapManuallyHidden(true)
                wasAutoHiddenRef.current = false
              } else {
                setMinimapMode('shown')
                setIsMinimapHidden(false)
                setIsMinimapManuallyHidden(false)
                wasAutoHiddenRef.current = false
              }
            }}
          >
            {!minimapExpanded ? (
              <Plus className="h-2.5 w-2.5" strokeWidth={2.5} />
            ) : (
              <Minus className="h-2.5 w-2.5" strokeWidth={2.5} />
            )}
          </Button>
          <div
            className={cn(
              // w-full = column width (minimap); gap-0 — slashes carry the visual gap so 179px fits
              'px-0.5 py-1 flex items-center gap-0 relative w-full border-0 shadow-sm rounded-lg',
              freeNavBoardFill // Board fill on desktop even with chat open; phone keeps input-only white
            )}
          >
            <div className="flex-[1.25] basis-0 min-w-0 flex items-center justify-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full h-auto py-1 px-0 text-xs rounded-lg bg-transparent text-gray-900 dark:text-gray-100 hover:bg-gray-200/60 dark:hover:bg-gray-700/60 focus-visible:ring-0 focus-visible:ring-offset-0 justify-center"
                title={isScrollMode ? 'Scroll — click for Zoom' : 'Zoom — click for Scroll'}
                aria-label={isScrollMode ? 'Switch to Zoom' : 'Switch to Scroll'}
                onClick={() => {
                  setIsScrollMode((s) => !s)
                  if (viewMode !== 'canvas') setViewMode('canvas')
                }}
              >
                <span>{isScrollMode ? 'Scroll' : 'Zoom'}</span>
              </Button>
            </div>
            {/* Thin slash — Scroll/Zoom | zoom% */}
            <span className="flex h-7 items-center text-xl font-thin text-gray-300 dark:text-gray-500 mx-0.5 flex-shrink-0 select-none leading-none" aria-hidden>/</span>
            <div className="flex-1 basis-0 flex items-center justify-center min-w-0">
              <NavZoomControl />
            </div>
            <div className="flex items-center shrink-0">
              <NavRotateControl />
            </div>
            <div className="flex items-center shrink-0">
              {/* Thin slash — rotate | select/pan */}
              <span className="flex h-7 items-center text-xl font-thin text-gray-300 dark:text-gray-500 mx-0.5 flex-shrink-0 select-none leading-none" aria-hidden>/</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 shrink-0 rounded-lg text-gray-900 dark:text-gray-100 hover:bg-gray-200/60 dark:hover:bg-gray-700/60 focus-visible:ring-0 focus-visible:ring-offset-0"
                title={mapPointerTool === 'select' ? 'Select — click for pan' : 'Pan — click for select'}
                aria-label={mapPointerTool === 'select' ? 'Switch to pan' : 'Switch to select'}
                onClick={() => setMapPointerTool((t) => (t === 'select' ? 'pan' : 'select'))}
              >
                {mapPointerTool === 'select' ? (
                  <MousePointer2 className="h-3.5 w-3.5" />
                ) : (
                  <Hand className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Minimap — always mounted, height-clipped so load and +/- share an expand-up tween */}
        <div
          data-minimap-context
          className="relative"
          aria-hidden={!minimapExpanded}
          onContextMenuCapture={(e) => {
            // Capture: MiniMap SVG can eat bubble-phase contextmenu
            e.preventDefault()
            e.stopPropagation()
            setMinimapContextMenuPosition({ x: e.clientX, y: e.clientY })
          }}
          onMouseEnter={() => {
            setIsMinimapHovering(true)
            isMinimapHoveringRef.current = true
            if (minimapHideTimeoutRef.current) {
              clearTimeout(minimapHideTimeoutRef.current)
              minimapHideTimeoutRef.current = null
            }
          }}
          onMouseLeave={(e) => {
            setIsMinimapHovering(false)
            isMinimapHoveringRef.current = false
            checkAndHideMinimap(e.relatedTarget as HTMLElement)
          }}
          style={{
            position: 'relative',
            width: MINIMAP_WIDTH, // Same as Free nav so the column edges line up
            height: minimapExpanded ? MINIMAP_HEIGHT : 0, // Closed = clipped; open grows because the stack is bottom-anchored
            marginTop: minimapExpanded ? MINIMAP_NAV_GAP : 0, // Collapse the nav air with the same tween
            overflow: 'hidden', // Reveal MiniMap from the bottom as height grows
            flexShrink: 0,
            pointerEvents: minimapExpanded ? 'auto' : 'none', // Clicks pass through while clipped
            transition: `height ${MINIMAP_EXPAND_MS}ms ease-out, margin-top ${MINIMAP_EXPAND_MS}ms ease-out`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              bottom: 0, // Pin full-size MiniMap to the clip bottom so growth reveals upward
              left: 0,
              width: MINIMAP_WIDTH,
              height: MINIMAP_HEIGHT, // Keep RF MiniMap at real size while the clip is 0
            }}
          >
            <MiniMap
              position="bottom-left"
              nodeColor={(node) => {
                return node.selected ? '#9ca3af' : '#e5e7eb'
              }}
              maskColor={resolvedTheme === 'dark'
                ? 'rgba(42, 42, 58, 0.35)'
                : 'rgba(200, 200, 200, 0.2)'}
              maskStrokeColor="none"
              pannable={true}
              zoomable={true}
              className="minimap-custom-size shadow-sm"
              style={{
                // Same 8px radius on all corners (Free nav sits above with a gap — tops stay visible)
                borderRadius: '8px',
                overflow: 'hidden',
                cursor: 'pointer',
                width: MINIMAP_WIDTH, // Match Free nav / CSS .minimap-custom-size
                height: MINIMAP_HEIGHT,
                position: 'absolute',
                top: 0,
                left: 0,
                margin: 0,
              }}
            />
          </div>
        </div>
       </div>

      </>
      )}

      {/* Brand logo — opens chat; hide while chat is open (desktop column + phone dock) */}
      {/* Omitted in embedded page-preview boards (chrome belongs to the parent map) */}
      {!embedded && !isChatSidebarOpen && (
        <button
          type="button"
          data-chat-sidebar-toggle
          onClick={() => toggleChatSidebar()}
          className="z-40 flex items-center justify-center bg-transparent opacity-80 hover:opacity-100 transition-opacity p-0 border-0 overflow-visible"
          style={{
            position: 'absolute',
            bottom: `${MINIMAP_BOTTOM + mapChromeBottomPad}px`,
            right: `${BRAND_RIGHT}px`,
            transition: 'none',
            // Above phone map-dock shell (z-30) so taps always hit the brand when closed
            pointerEvents: 'auto',
          }}
          title="Show chat"
          aria-label="Show chat sidebar"
        >
          <ThinktableBrandMark drawingUrl={logoDrawing} size={42} />
        </button>
      )}



      {/* I-bar + grip — empty board click (or double-click); type to create a frame, or click ⋮⋮ for the block menu (no frame required) */}
      {iBarPosition && (() => {
        const z = iBarViewport.zoom
        const paneScale = z * threadComfortScale(z) // Match TipTap grip screen size (RF zoom × comfort)
        return (
        <div
          className="absolute flex items-center"
          style={{
            // Convert flow coordinates back to pane coordinates (rotation-aware); grip sits left of caret
            left: `${flowToPane(iBarPosition.x, iBarPosition.y, iBarViewport, boardRotation).x}px`,
            top: `${flowToPane(iBarPosition.x, iBarPosition.y, iBarViewport, boardRotation).y}px`,
            zIndex: 1000,
            transform: `translateX(-${24 * paneScale}px)`, // Grip (20) + gap (4) → caret sits on the flow click
            gap: `${4 * paneScale}px`,
          }}
        >
          <button
            type="button"
            className="nodrag nopan flex items-center justify-center rounded text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-black/5 dark:hover:bg-white/10 pointer-events-auto cursor-pointer"
            style={{
              width: `${20 * paneScale}px`,
              height: `${24 * paneScale}px`,
            }}
            title="Block actions"
            data-tt-ibar-grip
            onMouseDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
            }}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              // Second click on the same ⋮⋮ closes the pre-frame block menu
              if (iBarBlockMenuOpenRef.current) {
                setIBarBlockMenu(null)
                iBarBlockMenuOpenRef.current = false
                iBarArmedRef.current = true // Menu closed — typing at the I-bar is live again
                iBarInputRef.current?.focus({ preventScroll: true })
                return
              }
              const rect = e.currentTarget.getBoundingClientRect()
              const MENU_W = 248 // Same estimate as TipTap ⋮⋮ BlockActionsMenu
              const GAP = 8
              const openLeft = rect.left - GAP - MENU_W >= 0 // Prefer left of the grip when there's room
              iBarArmedRef.current = false // Menu search owns keys until close
              iBarBlockMenuOpenRef.current = true
              if (iBarInputRef.current && document.activeElement === iBarInputRef.current) {
                iBarInputRef.current.blur()
              }
              setIBarBlockMenu({
                x: openLeft ? rect.left : rect.right,
                y: rect.top,
                openLeft,
              })
            }}
          >
            <GripVertical style={{ width: `${16 * paneScale}px`, height: `${16 * paneScale}px` }} />
          </button>
          {/* Blinking vertical line — same comfort scale as TipTap grips */}
          <div
            className="bg-gray-800 dark:bg-gray-100 pointer-events-none"
            style={{
              width: `${1 * paneScale}px`,
              height: `${18 * paneScale}px`,
              animation: 'blink 1s step-end infinite',
            }}
          />
        </div>
        )
      })()}

      {/* Pre-frame block menu — I-bar ⋮⋮ click; no frame required */}
      {iBarBlockMenu &&
        typeof document !== 'undefined' &&
        createPortal(
          <BlockActionsMenu
            positionMode="fixed"
            x={iBarBlockMenu.x}
            y={iBarBlockMenu.y}
            zoom={1}
            openLeft={iBarBlockMenu.openLeft}
            currentBlockType="text"
            showAddChild={false}
            selectedCount={1}
            canUngroup={false}
            boardInTargets={(() => {
              const convs =
                (queryClient.getQueryData(['conversations']) as
                  | Array<{ id: string; title?: string | null }>
                  | undefined) || []
              const targets = convs
                .filter((c) => c.id !== conversationId)
                .slice(0, 40)
                .map((c) => ({ id: c.id, title: c.title?.trim() || 'Untitled' }))
              return [
                { id: conversationId || '', title: 'Current board' },
                ...targets.filter((t) => t.id),
              ]
            })()}
            onAction={(action, payload) => {
              void handleIBarBlockAction(action, payload)
            }}
            onClose={() => {
              setIBarBlockMenu(null)
              iBarBlockMenuOpenRef.current = false
              if (iBarPositionRef.current) {
                iBarArmedRef.current = true // Dismissed without creating — type at the I-bar
                iBarInputRef.current?.focus({ preventScroll: true })
              }
            }}
          />,
          document.body
        )}

      {/* Always-mounted capture field: board tap focuses it so iOS shows the keyboard; feeds I-bar buffer via onInput */}
      <textarea
        ref={iBarInputRef}
        aria-label="Type to create a frame"
        autoCapitalize="sentences"
        autoCorrect="on"
        autoComplete="off"
        enterKeyHint="done"
        inputMode="text"
        rows={1}
        tabIndex={-1}
        className="tt-ibar-capture nodrag nopan nokey"
        onInput={(e) => iBarApplyTextRef.current(e.currentTarget.value)}
        onCompositionEnd={(e) => iBarApplyTextRef.current(e.currentTarget.value)}
        onBlur={() => {
          // Phone: keyboard dismissed — release create capture without focusing edge TipTap (avoids Safari zoom)
          const pending = iBarPendingMessageIdRef.current
          if (!pending) return
          window.dispatchEvent(
            new CustomEvent('tt-ibar-seed-applied', { detail: { messageId: pending } })
          )
        }}
        style={{
          // Park capture at board center (not the edge tap) so iOS doesn’t pan/zoom to an off-center caret
          position: 'absolute',
          left: iBarInputAnchor ? '50%' : '-9999px',
          top: iBarInputAnchor ? '50%' : '0px',
          transform: iBarInputAnchor ? 'translate(-50%, -50%)' : undefined,
          zIndex: 1001,
          width: 12,
          height: 24,
          margin: 0,
          padding: 0,
          opacity: 0.01, // Fully invisible / zero-size fields often won’t open the iOS keyboard
          border: 'none',
          outline: 'none',
          resize: 'none',
          overflow: 'hidden',
          background: 'transparent',
          color: 'transparent',
          caretColor: 'transparent',
          fontSize: 16, // Avoid iOS Safari zoom-on-focus
          lineHeight: '24px',
          pointerEvents: 'none', // Programmatic focus only — don’t steal map taps
        }}
      />

      {/* Frame menu — portaled + fixed so RF overflow / zoom cannot clip it */}
      {rightClickedNode &&
        reactFlowInstance &&
        typeof document !== 'undefined' &&
        createPortal(
        <BlockActionsMenu
          positionMode="fixed"
          x={nodePopupPosition.x}
          y={nodePopupPosition.y}
          zoom={reactFlowInstance.getViewport().zoom}
          isCollapsed={!!rightClickedNode.data?.isResponseCollapsed}
          selectedCount={nodes.filter((n) => n.selected && n.type === 'chatPanel').length}
          canUngroup={
            !!rightClickedNode.parentId ||
            !!rightClickedNode.data?.promptMessage?.metadata?.blockGroupId
          }
          showAddChild={rightClickedNode.type !== 'blockGroup'}
          currentBlockType={
            (rightClickedNode.data?.promptMessage?.metadata?.blockType as BlockTypeId) || 'text'
          }
          currentFrameShape={
            parseFrameShape(rightClickedNode.data?.promptMessage?.metadata?.frameShape) ??
            FRAME_SHAPE_NONE
          }
          showFrameShape={rightClickedNode.type === 'chatPanel'}
          currentFillColor={
            (rightClickedNode.data?.fillColor as string | undefined) ||
            (rightClickedNode.data?.promptMessage?.metadata?.fillColor as string | undefined) ||
            ''
          }
          currentBorderColor={
            (rightClickedNode.data?.borderColor as string | undefined) ||
            (rightClickedNode.data?.promptMessage?.metadata?.borderColor as string | undefined) ||
            ''
          }
          currentBorderWeight={(() => {
            const raw =
              rightClickedNode.data?.borderWeight ??
              (rightClickedNode.data?.promptMessage?.metadata as Record<string, unknown> | undefined)
                ?.borderWeight
            const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '1'))
            return Number.isFinite(n) && n > 0 ? n : 1
          })()}
          boardLocked={
            (rightClickedNode.data?.promptMessage?.metadata as Record<string, unknown> | undefined)
              ?.boardLocked === true
          }
          notionConnected={
            readNotionConnection(
              rightClickedNode.data?.promptMessage?.metadata as Record<string, unknown> | undefined
            ).connected
          }
          notionSync={
            readNotionConnection(
              rightClickedNode.data?.promptMessage?.metadata as Record<string, unknown> | undefined
            ).sync
          }
          canLockFramesTogether={
            nodes.filter((n) => n.selected && n.type === 'chatPanel').length >= 2
          }
          framesLockedTogether={(() => {
            const selected = nodes.filter((n) => n.selected && n.type === 'chatPanel')
            if (selected.length < 2) return false
            const groupIds = selected.map((n) => {
              const meta = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
              return typeof meta.frameLockGroupId === 'string' ? meta.frameLockGroupId : null
            })
            return groupIds.every((id) => typeof id === 'string') && new Set(groupIds).size === 1
          })()}
          boardInTargets={(() => {
            // Pages the new page can nest under (from sidebar cache)
            const convs =
              (queryClient.getQueryData(['conversations']) as
                | Array<{ id: string; title?: string | null }>
                | undefined) || []
            const targets = convs
              .filter((c) => c.id !== conversationId)
              .slice(0, 40)
              .map((c) => ({ id: c.id, title: c.title?.trim() || 'Untitled' }))
            // Always offer current map first
            return [
              { id: conversationId || '', title: 'Current board' },
              ...targets.filter((t) => t.id),
            ]
          })()}
          onAction={handleBlockAction}
          onClose={() => {
            setRightClickedNode(null)
            nodeClickPositionRef.current = null
            nodePopupZoomRef.current = null
          }}
        />,
        document.body
      )}

      {/* Board menu — empty-pane right-click */}
      {boardMenuPosition && reactFlowInstance && (
        <BoardActionsMenu
          x={boardMenuPosition.x}
          y={boardMenuPosition.y}
          canUndo={canMapUndo}
          canRedo={canMapRedo}
          canPaste={false}
          onAction={handleBoardMenuAction}
          onClose={() => {
            setBoardMenuPosition(null)
            boardClickFlowRef.current = null
          }}
        />
      )}

      {/* Thread click menu — same chrome as ⋮⋮ handle / text-select menus */}
      {clickedEdge && reactFlowInstance && (
        <ThreadActionsMenu
          x={edgePopupPosition.x}
          y={edgePopupPosition.y}
          isDotted={
            (clickedEdge.data as ThreadEdgeData | undefined)?.dotted === true ||
            clickedEdge.type === 'animatedDotted'
          }
          isCollapsedLabel={(() => {
            // Collapse when every connected frame is expanded; else Expand
            const connectedNodeIds = new Set<string>()
            const visited = new Set<string>()
            const queue = [clickedEdge.source, clickedEdge.target]
            while (queue.length > 0) {
              const currentNodeId = queue.shift()!
              if (visited.has(currentNodeId)) continue
              visited.add(currentNodeId)
              connectedNodeIds.add(currentNodeId)
              edges.forEach((edge) => {
                if (edge.source === currentNodeId && !visited.has(edge.target)) {
                  queue.push(edge.target)
                }
                if (edge.target === currentNodeId && !visited.has(edge.source)) {
                  queue.push(edge.source)
                }
              })
            }
            const connectedNodes = nodes.filter((n) => connectedNodeIds.has(n.id))
            const allExpanded =
              connectedNodes.length > 0 &&
              connectedNodes.every((n) => !(n.data.isResponseCollapsed || false))
            return allExpanded ? 'Collapse' : 'Expand'
          })()}
          canPasteStyle={hasThreadStyleClipboard}
          currentStyle={threadStyleFromAlgorithm(
            (clickedEdge.data as ThreadEdgeData | undefined)?.algorithm
          )}
          currentStrokeWidth={
            (clickedEdge.data as ThreadEdgeData | undefined)?.strokeWidth ??
            THREAD_DEFAULT_STROKE_WIDTH
          }
          onAction={handleThreadMenuAction}
          onClose={() => {
            setClickedEdge(null)
            edgeClickPositionRef.current = null
            edgePopupZoomRef.current = null
          }}
        />
      )}

      {/* Map menu — right-click Free nav / minimap (Shown / Hidden / Hover) */}
      {!embedded && !hideMapChrome && minimapContextMenuPosition && (
        <div
          data-map-menu
          className="fixed z-[100] bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] py-1 min-w-[180px]"
          style={{
            // Open above + to the right of cursor so bottom-left chrome stays on-screen
            left: `${minimapContextMenuPosition.x}px`,
            top: `${minimapContextMenuPosition.y}px`,
            transform: 'translateY(-100%)',
            marginTop: '-4px',
            marginLeft: '4px',
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <div className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-[#2f2f2f]">
            Map menu
          </div>
          <div className="py-1">
            <button
              onClick={() => {
                setMinimapMode('shown')
                setMinimapContextMenuPosition(null)
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2a2a3a] flex items-center gap-2"
            >
              {minimapMode === 'shown' && (
                <span className="w-1.5 h-1.5 rounded-full bg-gray-700 dark:bg-gray-300" />
              )}
              {minimapMode !== 'shown' && <span className="w-1.5 h-1.5" />}
              <span>Shown</span>
            </button>
            <button
              onClick={() => {
                setMinimapMode('hidden')
                // Immediately hide the minimap (mode sync will handle this, but ensure it's hidden)
                setIsMinimapHidden(true)
                setIsMinimapManuallyHidden(true)
                wasAutoHiddenRef.current = false
                setMinimapContextMenuPosition(null)
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2a2a3a] flex items-center gap-2"
            >
              {minimapMode === 'hidden' && (
                <span className="w-1.5 h-1.5 rounded-full bg-gray-700 dark:bg-gray-300" />
              )}
              {minimapMode !== 'hidden' && <span className="w-1.5 h-1.5" />}
              <span>Hidden</span>
            </button>
            <button
              onClick={() => {
                setMinimapMode('hover')
                setMinimapContextMenuPosition(null)
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2a2a3a] flex items-center gap-2"
            >
              {minimapMode === 'hover' && (
                <span className="w-1.5 h-1.5 rounded-full bg-gray-700 dark:bg-gray-300" />
              )}
              {minimapMode !== 'hover' && <span className="w-1.5 h-1.5" />}
              <span>Show on hover</span>
            </button>
          </div>
        </div>
      )}

      {/* Return to bottom button - visible when most recent panel is not centered */}
      {/* Aligned to prompt box center with same gap as minimap when jumped (16px) */}
      {!embedded && messages.length > 0 && (() => {
        // Check if most recent panel is centered above prompt box
        const filter = viewMode === 'linear' ? linearNavMode : 'all'
        const mostRecentPanel = getMostRecentPanel(filter)
        
        // Determine if button should be visible (hide if most recent panel is already centered)
        // This works in both linear and canvas modes - checks if panel is actually centered, not just focused
        const isVisible = !(mostRecentPanel && reactFlowInstance && isPanelCentered(mostRecentPanel.id))
        
        return (
          <ReturnToBottomButton 
            isVisible={isVisible}
            onClick={() => {
              if (mostRecentPanel) {
                // Center the most recent panel above prompt box and reset zoom to 100%
                centerPanelAbovePrompt(mostRecentPanel.id, true)
                
                // Update focused panel index if in linear mode and reset scroll accumulator
                if (viewMode === 'linear') {
                  const panels = getChronologicalPanels(linearNavMode)
                  if (panels.length > 0) {
                    const index = panels.findIndex((p: Node<ChatPanelNodeData>) => p.id === mostRecentPanel.id)
                    setFocusedPanelIndex(index >= 0 ? index : panels.length - 1)
                    scrollAccumulatorRef.current = 0
                    lastScrollDirectionRef.current = null
                  } else {
                    setFocusedPanelIndex(null)
                    scrollAccumulatorRef.current = 0
                    lastScrollDirectionRef.current = null
                  }
                }
              } else {
                // Fallback to old scrollToBottom behavior if no panels (only in linear mode)
                if (viewMode === 'linear') {
                  scrollToBottom()
                }
                // In canvas mode, do nothing if no panels
              }
            }} 
          />
        )
      })()}

      {/* Left vertical menu (set menu) - show if board or project has flashcards */}
      {!embedded && shouldShowMenu && (
        <LeftVerticalMenu conversationId={conversationId} />
      )}
    </div>
  )
}

// Wrapper component that handles Suspense for useSearchParams
function BoardFlowWithSearchParams({
  conversationId,
  embedded,
  hideMapChrome,
}: {
  conversationId?: string
  embedded?: boolean
  hideMapChrome?: boolean
}) {
  const searchParams = useSearchParams()
  return (
    <BoardFlowInner
      conversationId={conversationId}
      searchParams={searchParams}
      embedded={embedded}
      hideMapChrome={hideMapChrome}
    />
  )
}

export function BoardFlow({
  conversationId,
  embedded = false,
  hideMapChrome = false, // Public homepage: strip Free nav + minimap only
}: {
  conversationId?: string
  embedded?: boolean // Page-within-page: strip outer chrome
  hideMapChrome?: boolean // Pre-login homepage: no Free nav / minimap
}) {
  return (
    <BoardEmbedProvider embedded={embedded}>
      <ReactFlowProvider>
        <BoardRotationProvider>
          <Suspense fallback={<div className="h-full w-full flex items-center justify-center">Loading...</div>}>
            <BoardFlowWithSearchParams
              conversationId={conversationId}
              embedded={embedded}
              hideMapChrome={hideMapChrome}
            />
          </Suspense>
        </BoardRotationProvider>
      </ReactFlowProvider>
    </BoardEmbedProvider>
  )
}


