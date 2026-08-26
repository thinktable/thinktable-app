'use client'

// Notion-style block actions menu — baseline options (Turn into / Color / etc.);
// wired actions work now; submenu stubs are intentional until we flesh them out.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react' // Search, submenu, focus
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Columns2,
  Columns3,
  Columns4,
  Copy,
  FileText,
  Group,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Image as ImageIcon,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  MessageSquare,
  MonitorPlay,
  PaintRoller,
  Plus,
  Quote,
  RefreshCw,
  Shapes,
  Sigma,
  Sparkles,
  SquareCode,
  TextCursorInput,
  Trash2,
  Triangle,
  Ungroup,
  FolderInput,
  Type,
  Anchor,
  AlignJustify,
  Hash,
  CircleChevronDown,
  CircleDashed,
  Calendar,
  Users,
  Paperclip,
  SquareCheck,
  Phone,
  AtSign,
  Search,
  ArrowUpRight,
  Clock,
  CircleUser,
  MapPin,
  MousePointerClick,
  HelpCircle,
  Languages,
  AlignLeft,
  Cable,
  Hand,
  Unplug,
  LayoutGrid,
  Table2,
  AppWindow,
} from 'lucide-react' // Action + Turn into + Property + Connections icons
import { NotionMarkIcon } from '@/components/notion-mark-icon' // Notion row in Connections
import type { NotionSyncMode } from '@/lib/blocks' // Live vs Manual sync
import { Button } from '@/components/ui/button' // Row buttons
import { cn } from '@/lib/utils' // Class merge
import { applyMenuPlacement, watchMenuSafeRect } from '@/lib/menu-placement' // Stay in-window, miss top bar / chat / selection
import { LegoBrickIcon } from './lego-brick-icon' // Frame-group lock: two bricks, top one stud back
import Shape from '@/components/shapes/Shape' // Mini silhouette previews in the Shape flyout
import {
  FRAME_SHAPE_NONE,
  FRAME_SHAPE_TYPES,
  frameShapeLabel,
  type FrameShapeChoice,
} from '@/lib/frame-shape' // Frame-as-shape picker values

/** Notion-like frame palette — fill uses pale bg; border uses stronger stroke hues. */
const FRAME_COLOR_SWATCHES = [
  { id: 'default', name: 'Default', fill: '', border: '' }, // Empty = transparent chrome
  { id: 'gray', name: 'Gray', fill: '#F1F1EF', border: '#787774' },
  { id: 'brown', name: 'Brown', fill: '#F4EEEE', border: '#9F6B53' },
  { id: 'orange', name: 'Orange', fill: '#FBECDD', border: '#D9730D' },
  { id: 'yellow', name: 'Yellow', fill: '#FBF3DB', border: '#CB912F' },
  { id: 'green', name: 'Green', fill: '#EDF3EC', border: '#448361' },
  { id: 'blue', name: 'Blue', fill: '#E7F3F8', border: '#337EA9' },
  { id: 'purple', name: 'Purple', fill: '#F6F3F9', border: '#9065B0' },
  { id: 'pink', name: 'Pink', fill: '#F9F2F5', border: '#C14C8A' },
  { id: 'red', name: 'Red', fill: '#FDEBEC', border: '#E03E3E' },
] as const

type FrameColorKind = 'fill' | 'border' // Which chrome channel a last-used / pick targets

/** Persisted “Last used” row for the frame Color flyout. */
type FrameLastColor = {
  kind: FrameColorKind
  id: string
  value: string
  label: string
}

const FRAME_LAST_COLOR_KEY = 'thinktable-frame-last-color' // localStorage key

/** Case-insensitive hex/empty match for active swatch highlighting. */
function colorsMatch(a: string, b: string): boolean {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase()
}

/** Read last-used frame color from localStorage (null if missing/corrupt). */
function readFrameLastColor(): FrameLastColor | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(FRAME_LAST_COLOR_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as FrameLastColor
    if (!parsed || (parsed.kind !== 'fill' && parsed.kind !== 'border')) return null
    if (typeof parsed.label !== 'string' || typeof parsed.value !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

/** Persist last-used frame color for the top of the Color flyout. */
function writeFrameLastColor(entry: FrameLastColor) {
  try {
    localStorage.setItem(FRAME_LAST_COLOR_KEY, JSON.stringify(entry))
  } catch {
    // Ignore quota / private-mode failures
  }
}

/** Baseline block kinds (Notion Turn into list) — stored as metadata.blockType for now. */
export type BlockTypeId =
  | 'text'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'board'
  | 'boardIn'
  | 'bulletedList'
  | 'numberedList'
  | 'todoList'
  | 'toggleList'
  | 'code'
  | 'quote'
  | 'callout'
  | 'image'
  | 'blockEquation'
  | 'syncedBlock'
  | 'toggleHeading1'
  | 'toggleHeading2'
  | 'toggleHeading3'
  | 'toggleHeading4'
  | 'columns2'
  | 'columns3'
  | 'columns4'
  | 'columns5'

export type BlockActionId =
  | 'duplicate'
  | 'delete'
  | 'addChild'
  | 'condense'
  | 'copyLink'
  | 'group'
  | 'ungroup'
  | 'turnInto'
  | 'color'
  | 'listFormat'
  | 'moveTo'
  | 'comment'
  | 'presentFromHere'
  | 'askAI'
  | 'skills'
  | 'setFrameShape' // Apply / clear a silhouette on the host frame
  | 'setFillColor' // Frame background (transparent when empty)
  | 'setBorderColor' // Frame border stroke
  | 'setBorderWeight' // Frame border thickness in px
  | 'lockToBoard' // Pin selected frames so they cannot drag
  | 'lockFramesTogether' // Rigid-group lock for ≥2 selected frames
  | 'connectNotion' // Connections → Notion (link this frame)
  | 'setNotionSync' // Live Sync vs Manual
  | 'removeNotionConnection' // Unlink Notion from this frame
  | 'convertLayout' // Frame menu → Card view / Table view (Notion DB)
  | 'open' // Open linked board / Notion page (DB row ⋮⋮, boardLink)

export type DbConvertLayoutId = 'card' | 'table' // Convert layout flyout picks

export type BlockActionPayload = {
  blockType?: BlockTypeId // Present when action === 'turnInto'
  propertyType?: PropertyTypeId // Present when Turn into → Property pick
  aiAutofill?: AiAutofillId // Present when Turn into → AI Autofill pick
  boardInParentId?: string | null // Nest target for Page in
  frameShape?: FrameShapeChoice // Present when action === 'setFrameShape'
  fillColor?: string // Empty string = transparent fill
  borderColor?: string // Empty string = transparent border
  borderWeight?: number // Border thickness in px (fractional OK)
  borderWeightCommit?: boolean // true = undo snapshot + DB save (slider release)
  notionSync?: NotionSyncMode // Present when action === 'setNotionSync'
  convertLayout?: DbConvertLayoutId // Present when action === 'convertLayout'
}

/** AI Autofill rows in the Property pane (stubs until wired). */
export type AiAutofillId = 'summarize' | 'translate' | 'riskTier' | 'customerSentiment'

/** Notion-like property kinds — shared with frame metadata + top chrome. */
export type { PropertyTypeId } from '@/lib/blocks/property'
import type { PropertyTypeId } from '@/lib/blocks/property' // Local use in this module

export type BoardInTarget = {
  id: string // Conversation id to nest under
  title: string // Display label
}

export type BlockActionsMenuProps = {
  x: number // Screen x relative to React Flow pane
  y: number // Screen y relative to React Flow pane
  zoom?: number // Optional scale with viewport
  isCollapsed?: boolean // Condense toggle label state
  selectedCount?: number // Enables Group when ≥2
  canUngroup?: boolean // True when focus frame is inside the legacy dashed wrapper
  showAddChild?: boolean // Study-set may omit Add child
  currentBlockType?: BlockTypeId // Checkmark in Turn into
  boardInTargets?: BoardInTarget[] // Boards available for "Board in"
  /** Current frame silhouette (frame menu only). */
  currentFrameShape?: FrameShapeChoice
  /** Show Shape submenu — frame-level menu only (not TipTap ⋮⋮ block menu). */
  showFrameShape?: boolean
  /** Current frame fill (frame menu). Empty = transparent. */
  currentFillColor?: string
  /** Current frame border (frame menu). Empty = transparent. */
  currentBorderColor?: string
  /** Current frame border thickness in px (frame menu). */
  currentBorderWeight?: number
  /** True when the focused frame is pinned to the board. */
  boardLocked?: boolean
  /** True when ≥2 selected frames share a frameLockGroupId. */
  framesLockedTogether?: boolean
  /** Enables “Lock frames to each other” (≥2 selected frames). */
  canLockFramesTogether?: boolean
  /** Frame is Notion-connected — show Notion under Connections. */
  notionConnected?: boolean
  /** Current Notion sync mode (Live vs Manual). */
  notionSync?: NotionSyncMode
  /**
   * Current Notion DB layout on this frame (`table` | `card`).
   * null/undefined = hide Convert layout. Flyout checks the current mode.
   */
  convertLayoutMode?: DbConvertLayoutId | null
  /** Show Open (DB row / page) at the top of the block menu. */
  showOpen?: boolean
  /** Override the gray context label under search (e.g. "Page" for DB rows). */
  menuHeader?: string
  /** Slim Live Sync / Manual / Remove menu (Notion footer ⋮⋮). */
  variant?: 'default' | 'notionConnection'
  lastEditedLabel?: string // Footer metadata
  onAction: (action: BlockActionId, payload?: BlockActionPayload) => void
  onClose: () => void
  className?: string
  /** absolute = board-flow pane coords; fixed = viewport (TipTap in-editor menu) */
  positionMode?: 'absolute' | 'fixed'
  /** fixed mode only: anchor to the LEFT of x (menu's right edge) instead of right of the handle */
  openLeft?: boolean
}

type TurnIntoDef = {
  id: BlockTypeId
  label: string
  icon: React.ReactNode
}

type PropertyTurnIntoDef = {
  id: PropertyTypeId // Stable pick id for the Property grid
  label: string // Menu copy (matches the screenshot labels)
  icon: React.ReactNode // Type icon to the left of the label
  hint?: boolean // Formula-style trailing help mark
}

type AiAutofillDef = {
  id: AiAutofillId // Stable pick id
  label: string // Row copy
  icon: React.ReactNode // Left icon
  badge: 'Basic' | 'Custom Agent' // Pill on the right of the label
  chevron?: boolean // Submenu affordance (Summarize / Translate)
}

type PropertySectionDef = {
  id: string // basic | advanced | system | connector
  items: PropertyTurnIntoDef[] // Two-col grid for this band
}

/** Compact brand marks for connector rows (16px). */
function GoogleDriveIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#3777E3" d="M8.2 3.2h7.6L22 15.4h-7.6z" />
      <path fill="#FFBA00" d="M8.2 3.2 1.2 15.4h7.6L15.8 3.2z" />
      <path fill="#26A65B" d="M1.2 15.4 5 21.2h14l-3.8-5.8z" />
    </svg>
  )
}
function FigmaIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#F24E1E" d="M8.5 3h3.5v6H8.5a3 3 0 0 1 0-6z" />
      <path fill="#FF7262" d="M12 3h3.5a3 3 0 1 1 0 6H12z" />
      <path fill="#A259FF" d="M8.5 9H12v6H8.5a3 3 0 0 1 0-6z" />
      <path fill="#1ABCFE" d="M12 9h3.5a3 3 0 1 1-3.5 3z" />
      <path fill="#0ACF83" d="M8.5 15H12a3 3 0 1 1-3-3" />
    </svg>
  )
}
function ZendeskIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#03363D" d="M12.2 3.2c.5 2.2 2.8 5 7.6 6.1-4.2.9-6.9 3.8-7.6 11.5-.5-2.2-2.8-5-7.6-6.1 4.2-.9 6.9-3.8 7.6-11.5z" />
    </svg>
  )
}

type RowDef =
  | {
      kind: 'action'
      id: BlockActionId
      label: string
      shortcut?: string
      icon: React.ReactNode
      danger?: boolean
      submenu?: 'turnInto' | 'color' | 'listFormat' | 'skills' | 'boardIn' | 'frameShape' | 'frameColor' | 'connections' | 'convertLayout'
      hidden?: boolean
      beta?: boolean
    }
  | { kind: 'separator'; hidden?: boolean }

/** Human label for a baseline block type (menu context + Turn into). */
export function blockTypeLabel(type: BlockTypeId): string {
  const map: Record<BlockTypeId, string> = {
    text: 'Block', // Menu header for default/plain blocks (Turn into still says Text)
    heading1: 'Heading 1',
    heading2: 'Heading 2',
    heading3: 'Heading 3',
    heading4: 'Heading 4',
    board: 'Board',
    boardIn: 'Board in',
    bulletedList: 'Bulleted list',
    numberedList: 'Numbered list',
    todoList: 'To-do list',
    toggleList: 'Toggle list',
    code: 'Code',
    quote: 'Quote',
    callout: 'Callout',
    image: 'Image',
    blockEquation: 'Block equation',
    syncedBlock: 'Synced block',
    toggleHeading1: 'Toggle heading 1',
    toggleHeading2: 'Toggle heading 2',
    toggleHeading3: 'Toggle heading 3',
    toggleHeading4: 'Toggle heading 4',
    columns2: '2 columns',
    columns3: '3 columns',
    columns4: '4 columns',
    columns5: '5 columns',
  }
  return map[type]
}

const TURN_INTO_OPTIONS: TurnIntoDef[] = [
  { id: 'text', label: 'Text', icon: <Type className="h-4 w-4" /> },
  { id: 'heading1', label: 'Heading 1', icon: <Heading1 className="h-4 w-4" /> },
  { id: 'heading2', label: 'Heading 2', icon: <Heading2 className="h-4 w-4" /> },
  { id: 'heading3', label: 'Heading 3', icon: <Heading3 className="h-4 w-4" /> },
  { id: 'heading4', label: 'Heading 4', icon: <Heading4 className="h-4 w-4" /> },
  { id: 'board', label: 'Board', icon: <FileText className="h-4 w-4" /> },
  { id: 'boardIn', label: 'Board in', icon: <FolderInput className="h-4 w-4" /> },
  { id: 'bulletedList', label: 'Bulleted list', icon: <List className="h-4 w-4" /> },
  { id: 'numberedList', label: 'Numbered list', icon: <ListOrdered className="h-4 w-4" /> },
  { id: 'todoList', label: 'To-do list', icon: <ListChecks className="h-4 w-4" /> },
  { id: 'toggleList', label: 'Toggle list', icon: <Triangle className="h-3.5 w-3.5 rotate-90" /> },
  { id: 'code', label: 'Code', icon: <SquareCode className="h-4 w-4" /> },
  { id: 'quote', label: 'Quote', icon: <Quote className="h-4 w-4" /> },
  { id: 'callout', label: 'Callout', icon: <TextCursorInput className="h-4 w-4" /> },
  { id: 'image', label: 'Image', icon: <ImageIcon className="h-4 w-4" /> },
  { id: 'blockEquation', label: 'Block equation', icon: <Sigma className="h-4 w-4" /> },
  { id: 'syncedBlock', label: 'Synced block', icon: <RefreshCw className="h-4 w-4" /> },
  { id: 'toggleHeading1', label: 'Toggle heading 1', icon: <Heading1 className="h-4 w-4" /> },
  { id: 'toggleHeading2', label: 'Toggle heading 2', icon: <Heading2 className="h-4 w-4" /> },
  { id: 'toggleHeading3', label: 'Toggle heading 3', icon: <Heading3 className="h-4 w-4" /> },
  { id: 'toggleHeading4', label: 'Toggle heading 4', icon: <Heading4 className="h-4 w-4" /> },
  { id: 'columns2', label: '2 columns', icon: <Columns2 className="h-4 w-4" /> },
  { id: 'columns3', label: '3 columns', icon: <Columns3 className="h-4 w-4" /> },
  { id: 'columns4', label: '4 columns', icon: <Columns4 className="h-4 w-4" /> },
  { id: 'columns5', label: '5 columns', icon: <Columns4 className="h-4 w-4" /> },
]

/** AI Autofill rows — sit under the Property header, above type grids. */
const AI_AUTOFILL_OPTIONS: AiAutofillDef[] = [
  { id: 'summarize', label: 'Summarize', icon: <AlignLeft className="h-4 w-4" />, badge: 'Basic', chevron: true },
  { id: 'translate', label: 'Translate', icon: <Languages className="h-4 w-4" />, badge: 'Basic', chevron: true },
  { id: 'riskTier', label: 'Risk Tier', icon: <CircleChevronDown className="h-4 w-4" />, badge: 'Custom Agent' },
  { id: 'customerSentiment', label: 'Customer Sentiment', icon: <CircleChevronDown className="h-4 w-4" />, badge: 'Custom Agent' },
]

/** Property type bands; each band is a 2-col grid separated by a hairline. */
const PROPERTY_SECTIONS: PropertySectionDef[] = [
  {
    id: 'basic',
    items: [
      { id: 'text', label: 'Text', icon: <AlignJustify className="h-4 w-4" /> },
      { id: 'number', label: 'Number', icon: <Hash className="h-4 w-4" /> },
      { id: 'select', label: 'Select', icon: <CircleChevronDown className="h-4 w-4" /> },
      { id: 'multiSelect', label: 'Multi-select', icon: <List className="h-4 w-4" /> },
      { id: 'status', label: 'Status', icon: <CircleDashed className="h-4 w-4" /> },
      { id: 'date', label: 'Date', icon: <Calendar className="h-4 w-4" /> },
      { id: 'person', label: 'Person', icon: <Users className="h-4 w-4" /> },
      { id: 'files', label: 'Files & media', icon: <Paperclip className="h-4 w-4" /> },
      { id: 'checkbox', label: 'Checkbox', icon: <SquareCheck className="h-4 w-4" /> },
      { id: 'url', label: 'URL', icon: <Link2 className="h-4 w-4" /> },
      { id: 'phone', label: 'Phone', icon: <Phone className="h-4 w-4" /> },
      { id: 'email', label: 'Email', icon: <AtSign className="h-4 w-4" /> },
    ],
  },
  {
    id: 'advanced',
    items: [
      { id: 'relation', label: 'Relation', icon: <ArrowUpRight className="h-4 w-4" /> },
      { id: 'rollup', label: 'Rollup', icon: <Search className="h-4 w-4" /> },
      { id: 'formula', label: 'Formula', icon: <Sigma className="h-4 w-4" />, hint: true },
      { id: 'button', label: 'Button', icon: <MousePointerClick className="h-4 w-4" /> },
      { id: 'uniqueId', label: 'ID', icon: <span className="text-[11px] font-semibold leading-none">№</span> },
      { id: 'place', label: 'Place', icon: <MapPin className="h-4 w-4" /> },
    ],
  },
  {
    id: 'system',
    items: [
      { id: 'createdTime', label: 'Created time', icon: <Clock className="h-4 w-4" /> },
      { id: 'lastEditedTime', label: 'Last edited time', icon: <Clock className="h-4 w-4" /> },
      { id: 'createdBy', label: 'Created by', icon: <CircleUser className="h-4 w-4" /> },
      { id: 'lastEditedBy', label: 'Last edited by', icon: <CircleUser className="h-4 w-4" /> },
    ],
  },
  {
    id: 'connector',
    items: [
      { id: 'googleDriveFile', label: 'Google Drive File', icon: <GoogleDriveIcon className="h-4 w-4" /> },
      { id: 'figmaFile', label: 'Figma File', icon: <FigmaIcon className="h-4 w-4" /> },
      { id: 'zendeskTicket', label: 'Zendesk Ticket', icon: <ZendeskIcon className="h-4 w-4" /> },
    ],
  },
]

/** Flat list for search hits in the main actions menu. */
const PROPERTY_TURN_INTO_OPTIONS: PropertyTurnIntoDef[] = PROPERTY_SECTIONS.flatMap((s) => s.items)

export function BlockActionsMenu({
  x,
  y,
  zoom = 1,
  isCollapsed = false,
  selectedCount = 1,
  canUngroup = false,
  showAddChild = true,
  currentBlockType = 'text',
  boardInTargets = [],
  currentFrameShape = FRAME_SHAPE_NONE,
  showFrameShape = false,
  currentFillColor = '',
  currentBorderColor = '',
  currentBorderWeight = 1,
  boardLocked = false,
  framesLockedTogether = false,
  canLockFramesTogether = false,
  notionConnected = false,
  notionSync = 'live',
  convertLayoutMode = null,
  showOpen = false,
  menuHeader,
  variant = 'default',
  lastEditedLabel,
  onAction,
  onClose,
  className,
  positionMode = 'absolute',
  openLeft = false,
}: BlockActionsMenuProps) {
  const [query, setQuery] = useState('') // Filter actions + turn-into
  const [propertyQuery, setPropertyQuery] = useState('') // Filter inside the Property pane
  const [showPropertySearch, setShowPropertySearch] = useState(false) // Magnifier next to Property
  const [turnIntoPane, setTurnIntoPane] = useState<'format' | 'property'>('format') // Format / Property tabs (one pane at a time)
  const [openSubmenu, setOpenSubmenu] = useState<
    | 'turnInto'
    | 'boardIn'
    | 'frameShape'
    | 'frameColor'
    | 'connections'
    | 'convertLayout'
    | null
  >(null) // Flyout
  const inputRef = useRef<HTMLInputElement>(null) // Autofocus search
  const propertySearchRef = useRef<HTMLInputElement>(null) // Focus when Property search opens
  const rootRef = useRef<HTMLDivElement>(null) // Position flyout
  const connectionsRowRef = useRef<HTMLButtonElement>(null) // Align Connections picker to that row
  const colorRowRef = useRef<HTMLButtonElement>(null) // Align frame Color flyout to Color row
  const [lastFrameColor, setLastFrameColor] = useState<FrameLastColor | null>(null) // Last used fill/border
  const [borderWeightDraft, setBorderWeightDraft] = useState<number | null>(null) // Live slider value while dragging
  const borderWeightDraggingRef = useRef(false) // Ignore prop sync mid-drag

  useEffect(() => {
    // Phone / touch: skip search autofocus — soft keyboard must not open with the frame menu (I-bar isn’t placed)
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) return
    inputRef.current?.focus() // Desktop: caret in Search actions for quick filter
  }, [])

  // Reset to Format when the Turn into flyout closes so reopen starts compact
  useEffect(() => {
    if (openSubmenu !== 'turnInto' && openSubmenu !== 'boardIn') {
      setTurnIntoPane('format')
      setShowPropertySearch(false)
      setPropertyQuery('')
    }
  }, [openSubmenu])

  useEffect(() => {
    setLastFrameColor(readFrameLastColor()) // Hydrate Last used after mount
  }, [])

  // Follow prop when not dragging so external updates stay in sync
  useEffect(() => {
    if (!borderWeightDraggingRef.current) setBorderWeightDraft(null)
  }, [currentBorderWeight])

  useEffect(() => {
    if (showPropertySearch) propertySearchRef.current?.focus() // Caret in Property search
  }, [showPropertySearch])

  // Park the card + any open flyout in the chrome-free window (below top bar, above chat)
  useLayoutEffect(() => {
    const root = rootRef.current // Menu shell
    if (!root) return // Not mounted yet
    const row =
      openSubmenu === 'connections'
        ? connectionsRowRef.current
        : openSubmenu === 'frameColor'
          ? colorRowRef.current
          : null // Turn into / Shape align to the cluster top
    const place = () =>
      applyMenuPlacement(root, {
        anchorX: x, // Grip / click X
        anchorY: y, // Grip / click Y
        openLeft, // Prefer the side that misses the frame
        preferredFlyoutTop: row?.getBoundingClientRect().top, // Color / Connections hug their row
        // Lock the card once a flyout is open so left-side Turn into doesn't slide the
        // hovered row out from under the cursor (hover thrash / menu glitch).
        fromExisting: openSubmenu != null,
      })
    place() // Before paint so the first frame is already in-bounds
    // The frame's selection chrome (blue ring / connection dots) mounts in the same commit, so the
    // first measure can read a frame box that is still missing it — re-place once it has laid out.
    const raf = requestAnimationFrame(place)
    const stop = watchMenuSafeRect(place) // Window + phone keyboard move the chat dock
    return () => {
      cancelAnimationFrame(raf)
      stop()
    }
  }, [x, y, positionMode, openLeft, openSubmenu, notionConnected, query, propertyQuery, showPropertySearch, turnIntoPane])

  /** Apply fill or border, remember as Last used, keep the flyout open. */
  const applyFrameColor = (kind: FrameColorKind, swatch: (typeof FRAME_COLOR_SWATCHES)[number]) => {
    const value = kind === 'fill' ? swatch.fill : swatch.border
    const label = `${swatch.name} ${kind === 'fill' ? 'background' : 'border'}`
    const entry: FrameLastColor = { kind, id: swatch.id, value, label }
    writeFrameLastColor(entry)
    setLastFrameColor(entry)
    if (kind === 'fill') onAction('setFillColor', { fillColor: value })
    else onAction('setBorderColor', { borderColor: value })
  }

  const rows = useMemo((): RowDef[] => {
    const list: RowDef[] = [
      {
        kind: 'action',
        id: 'open',
        label: 'Open',
        icon: <AppWindow className="h-4 w-4" />,
        hidden: !showOpen, // DB row / page menus
      },
      { kind: 'separator', hidden: !showOpen },
      {
        kind: 'action',
        id: 'turnInto',
        label: 'Turn into',
        icon: <RefreshCw className="h-4 w-4" />,
        submenu: 'turnInto',
        hidden: showFrameShape, // Frame menu has no Turn into (block ⋮⋮ only)
      },
      {
        kind: 'action',
        id: 'color',
        label: 'Color',
        icon: <PaintRoller className="h-4 w-4" />,
        submenu: showFrameShape ? 'frameColor' : 'color', // Frame → fill/border palette; block → stub
      },
      {
        kind: 'action',
        id: 'listFormat',
        label: 'List format',
        icon: <List className="h-4 w-4" />,
        submenu: 'listFormat',
        // Show when current type looks like a list (baseline)
        hidden: !['bulletedList', 'numberedList', 'todoList', 'toggleList'].includes(currentBlockType),
      },
      { kind: 'separator' },
      {
        kind: 'action',
        id: 'copyLink',
        label: 'Copy link to block',
        shortcut: '⌘⌃L',
        icon: <Link2 className="h-4 w-4" />,
      },
      {
        kind: 'action',
        id: 'duplicate',
        label: 'Duplicate',
        shortcut: '⌘D',
        icon: <Copy className="h-4 w-4" />,
      },
      {
        kind: 'action',
        id: 'moveTo',
        label: 'Move to',
        shortcut: '⌘⇧P',
        icon: <FolderInput className="h-4 w-4" />,
      },
      {
        kind: 'action',
        id: 'delete',
        label: 'Delete',
        shortcut: 'Del',
        icon: <Trash2 className="h-4 w-4" />,
        danger: true,
      },
      { kind: 'separator' },
      {
        kind: 'action',
        id: 'addChild',
        label: 'Add child',
        icon: <Plus className="h-4 w-4" />,
        hidden: !showAddChild || (notionConnected && !showFrameShape), // Notion block ⋮⋮ skips Add child
      },
      {
        kind: 'action',
        id: 'condense',
        label: isCollapsed ? 'Expand' : 'Condense',
        icon: isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />,
        hidden: notionConnected && !showFrameShape, // Notion block ⋮⋮ skips Condense
      },
      {
        kind: 'action',
        id: 'setFrameShape',
        label: 'Shape',
        icon: <Shapes className="h-4 w-4" />,
        submenu: 'frameShape', // Silhouette picker — frames act as shapes
        hidden: !showFrameShape, // Frame menu only (not TipTap block ⋮⋮)
      },
      {
        kind: 'action',
        id: 'convertLayout',
        label: 'Convert layout',
        icon: <LayoutGrid className="h-4 w-4" />,
        submenu: 'convertLayout', // Card view / Table view
        hidden: !convertLayoutMode, // Frame or block ⋮⋮ when Notion DB table / Card view
      },
      {
        kind: 'action',
        id: 'lockToBoard',
        label: boardLocked ? 'Unanchor from board' : 'Anchor to board',
        icon: <Anchor className="h-4 w-4" />, // Same anchor as Actions-bar board lock
        hidden: !showFrameShape, // Pin this frame (and selection) to the board
      },
      {
        kind: 'action',
        id: 'lockFramesTogether',
        label: framesLockedTogether ? 'Unlock frames from each other' : 'Lock frames to each other',
        icon: <LegoBrickIcon className="h-4 w-4" />, // Same brick as Actions-bar frame lock
        hidden: !showFrameShape || !canLockFramesTogether, // Needs ≥2 selected frames
      },
      {
        kind: 'action',
        id: 'connectNotion',
        label: 'Connections',
        icon: <Cable className="h-4 w-4" />,
        submenu: 'connections', // Click → Notion picker
        hidden: !showFrameShape, // Frame menu only
      },
      {
        kind: 'action',
        id: 'group',
        label: 'Group',
        icon: <Group className="h-4 w-4" />,
        hidden: selectedCount < 2 || (notionConnected && !showFrameShape),
      },
      {
        kind: 'action',
        id: 'ungroup',
        label: 'Ungroup', // Legacy wrapper around frames — not a product “block group”
        icon: <Ungroup className="h-4 w-4" />,
        hidden: !canUngroup || (notionConnected && !showFrameShape),
      },
      { kind: 'separator' },
      {
        kind: 'action',
        id: 'comment',
        label: 'Comment',
        shortcut: '⌘⇧M',
        icon: <MessageSquare className="h-4 w-4" />,
      },
      { kind: 'separator', hidden: !showFrameShape }, // Only when Present is shown (frame menu)
      {
        kind: 'action',
        id: 'presentFromHere',
        label: 'Present from here',
        shortcut: '⌘⇧P',
        icon: <MonitorPlay className="h-4 w-4" />,
        beta: true,
        hidden: !showFrameShape, // Frame menu only — not TipTap block ⋮⋮
      },
      { kind: 'separator' },
      {
        kind: 'action',
        id: 'askAI',
        label: 'Ask AI',
        shortcut: '⌘J',
        icon: <Sparkles className="h-4 w-4" />,
      },
      {
        kind: 'action',
        id: 'skills',
        label: 'Skills',
        icon: <Sparkles className="h-4 w-4" />,
        submenu: 'skills',
      },
    ]
    const q = query.trim().toLowerCase()
    if (!q) return list.filter((r) => !r.hidden)
    // Search: keep matching actions; drop separators when filtering
    return list.filter(
      (r) =>
        r.kind === 'action' &&
        !r.hidden &&
        (r.label.toLowerCase().includes(q) ||
          (r.id === 'turnInto' &&
            (TURN_INTO_OPTIONS.some((t) => t.label.toLowerCase().includes(q)) ||
              PROPERTY_TURN_INTO_OPTIONS.some((t) => t.label.toLowerCase().includes(q)))) ||
          (r.id === 'setFrameShape' &&
            ['default', 'shape', ...FRAME_SHAPE_TYPES].some((s) =>
              frameShapeLabel(s === 'default' ? FRAME_SHAPE_NONE : (s as FrameShapeChoice))
                .toLowerCase()
                .includes(q)
            )))
    )
  }, [query, isCollapsed, selectedCount, canUngroup, showAddChild, currentBlockType, showFrameShape, boardLocked, framesLockedTogether, canLockFramesTogether, notionConnected, convertLayoutMode, showOpen])

  // When searching, also surface matching Turn into types as flat picks
  const turnIntoMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return TURN_INTO_OPTIONS.filter((t) => t.label.toLowerCase().includes(q))
  }, [query])

  // Flat Properties hits in the main list while searching (⋮⋮ menu only)
  const propertyMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || showFrameShape) return []
    return PROPERTY_TURN_INTO_OPTIONS.filter((t) => t.label.toLowerCase().includes(q))
  }, [query, showFrameShape])

  const filteredTurnInto = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return TURN_INTO_OPTIONS
    return TURN_INTO_OPTIONS.filter((t) => t.label.toLowerCase().includes(q))
  }, [query])

  // Property pane search (magnifier) wins over the main menu query when set
  const propertyFilterQ = (propertyQuery || query).trim().toLowerCase()

  const filteredAiAutofill = useMemo(() => {
    if (!propertyFilterQ) return AI_AUTOFILL_OPTIONS
    return AI_AUTOFILL_OPTIONS.filter((t) => t.label.toLowerCase().includes(propertyFilterQ))
  }, [propertyFilterQ])

  const filteredPropertySections = useMemo(() => {
    if (!propertyFilterQ) return PROPERTY_SECTIONS
    return PROPERTY_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((t) => t.label.toLowerCase().includes(propertyFilterQ)),
    })).filter((section) => section.items.length > 0)
  }, [propertyFilterQ])

  const menuShellStyle = {
    left: `${x}px`,
    top: `${y}px`,
    transform:
      positionMode === 'fixed'
        ? openLeft
          ? 'translate(calc(-100% - 8px), 4px)'
          : 'translate(8px, 4px)'
        : 'translate(-50%, -100%)',
    transformOrigin:
      (positionMode === 'fixed' ? (openLeft ? 'top right' : 'top left') : 'center bottom') as const,
    marginTop: positionMode === 'fixed' ? 0 : '-8px',
  }

  // Slim menu for the Notion connection mark (Live Sync / Manual / Remove)
  if (variant === 'notionConnection') {
    return (
      <div
        ref={rootRef}
        className={cn(
          'block-actions-menu node-popup z-[1000] overflow-visible tt-menu-surface rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-1 min-w-[200px]',
          positionMode === 'fixed' ? 'fixed' : 'absolute',
          className
        )}
        style={menuShellStyle}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
        }}
        onMouseDown={(e) => {
          e.stopPropagation()
          e.preventDefault()
        }}
      >
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'justify-start text-sm h-8 px-2 font-normal w-full',
            notionSync === 'live' && 'bg-blue-50 dark:bg-blue-950/40'
          )}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onAction('setNotionSync', { notionSync: 'live' })
            onClose()
          }}
        >
          <RefreshCw className="h-4 w-4 mr-2 text-gray-500" />
          <span className="flex-1 text-left">Live Sync</span>
          {notionSync === 'live' && <Check className="h-3.5 w-3.5 text-gray-500" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'justify-start text-sm h-8 px-2 font-normal w-full',
            notionSync === 'manual' && 'bg-blue-50 dark:bg-blue-950/40'
          )}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onAction('setNotionSync', { notionSync: 'manual' })
            onClose()
          }}
        >
          <Hand className="h-4 w-4 mr-2 text-gray-500" />
          <span className="flex-1 text-left">Manual</span>
          {notionSync === 'manual' && <Check className="h-3.5 w-3.5 text-gray-500" />}
        </Button>
        <div className="my-1 h-px bg-gray-100 dark:bg-[#2f2f2f] mx-1" />
        <Button
          variant="ghost"
          size="sm"
          className="justify-start text-sm h-8 px-2 font-normal w-full text-red-600 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onAction('removeNotionConnection')
            onClose()
          }}
        >
          <Unplug className="h-4 w-4 mr-2" />
          <span className="flex-1 text-left">Remove Connection</span>
        </Button>
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        'block-actions-menu node-popup z-[1000] overflow-visible tt-menu-surface rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-1 min-w-[240px]',
        positionMode === 'fixed' ? 'fixed' : 'absolute',
        className
      )}
      style={{
        left: `${x}px`,
        top: `${y}px`,
        transform:
          positionMode === 'fixed'
            ? openLeft
              ? 'translate(calc(-100% - 8px), 4px)' // Left of frame: menu's right edge sits 8px left of x
              : 'translate(8px, 4px)' // TipTap default: open just beside the handle
            : 'translate(-50%, -100%)', // Constant size regardless of zoom (like the text highlight menu) — no scale(zoom)
        transformOrigin:
          positionMode === 'fixed' ? (openLeft ? 'top right' : 'top left') : 'center bottom',
        marginTop: positionMode === 'fixed' ? 0 : '-8px',
      }}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
      }}
      onMouseDown={(e) => {
        e.stopPropagation()
        e.preventDefault()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          if (openSubmenu) setOpenSubmenu(null)
          else onClose()
        }
      }}
    >
      <div className="px-1.5 pt-1 pb-1">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search actions..."
          className="w-full h-8 px-2 text-sm rounded-md bg-gray-50 dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#3a3a3a] outline-none text-gray-900 dark:text-gray-100"
        />
      </div>

      {/* Current context: Frame menu vs TipTap block type (Notion-style) */}
      <div className="px-2.5 pb-1 text-xs text-gray-500 dark:text-gray-400">
        {menuHeader || (showFrameShape ? 'Frame' : blockTypeLabel(currentBlockType))}
      </div>

      <div data-tt-menu-body className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-0.5 pb-0.5">
        {rows.length === 0 && turnIntoMatches.length === 0 && propertyMatches.length === 0 && (
          <div className="px-2 py-2 text-xs text-gray-400">No matching actions</div>
        )}

        {rows.map((row, index) => {
          if (row.kind === 'separator') {
            return (
              <div
                key={`sep-${index}`}
                className="my-1 h-px bg-gray-100 dark:bg-[#2f2f2f] mx-1"
              />
            )
          }
          const hasSub = Boolean(row.submenu)
          const isTurnIntoOpen = row.submenu === 'turnInto' && openSubmenu === 'turnInto'
          const isShapeOpen = row.submenu === 'frameShape' && openSubmenu === 'frameShape'
          const isFrameColorOpen = row.submenu === 'frameColor' && openSubmenu === 'frameColor'
          const isConnectionsOpen = row.submenu === 'connections' && openSubmenu === 'connections'
          const isConvertLayoutOpen =
            row.submenu === 'convertLayout' && openSubmenu === 'convertLayout'
          return (
            <Button
              key={row.id}
              ref={
                row.submenu === 'connections'
                  ? connectionsRowRef
                  : row.submenu === 'frameColor'
                    ? colorRowRef
                    : undefined
              }
              variant="ghost"
              size="sm"
              onMouseEnter={() => {
                if (row.submenu === 'turnInto') setOpenSubmenu('turnInto')
                else if (row.submenu === 'frameShape') setOpenSubmenu('frameShape')
                else if (row.submenu === 'frameColor') setOpenSubmenu('frameColor')
                else if (row.submenu === 'convertLayout') setOpenSubmenu('convertLayout')
                else if (row.submenu === 'connections') return // Click-only picker
                else setOpenSubmenu(null)
              }}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (row.submenu === 'turnInto') {
                  setOpenSubmenu((s) => (s === 'turnInto' ? null : 'turnInto'))
                  return
                }
                if (row.submenu === 'frameShape') {
                  setOpenSubmenu((s) => (s === 'frameShape' ? null : 'frameShape'))
                  return
                }
                if (row.submenu === 'frameColor') {
                  setOpenSubmenu((s) => (s === 'frameColor' ? null : 'frameColor'))
                  return
                }
                if (row.submenu === 'convertLayout') {
                  setOpenSubmenu((s) => (s === 'convertLayout' ? null : 'convertLayout'))
                  return
                }
                if (row.submenu === 'connections') {
                  setOpenSubmenu((s) => (s === 'connections' ? null : 'connections')) // Click → Notion
                  return
                }
                // Submenus without UI yet — fire stub action and close
                if (row.submenu) {
                  onAction(row.id)
                  onClose()
                  return
                }
                onAction(row.id)
              }}
              className={cn(
                'h-8 shrink-0 justify-start px-2 text-sm font-normal',
                row.danger && 'text-red-600 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950',
                (isTurnIntoOpen ||
                  isShapeOpen ||
                  isFrameColorOpen ||
                  isConnectionsOpen ||
                  isConvertLayoutOpen) &&
                  'bg-gray-100 dark:bg-[#2a2a2a]'
              )}
            >
              <span className="mr-2 text-gray-500 dark:text-gray-400">{row.icon}</span>
              <span className="flex-1 text-left">{row.label}</span>
              {row.beta && (
                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#2a2a2a] text-gray-500">
                  Beta
                </span>
              )}
              {row.shortcut && !hasSub && (
                <span className="ml-3 text-[11px] text-gray-400 tabular-nums">{row.shortcut}</span>
              )}
              {hasSub && <ChevronRight className="h-3.5 w-3.5 ml-1 text-gray-400" />}
            </Button>
          )
        })}

        {/* Flat Turn into hits while searching */}
        {turnIntoMatches.map((t) => (
          <Button
            key={`search-${t.id}`}
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onAction('turnInto', { blockType: t.id })
              onClose()
            }}
            className="justify-start text-sm h-8 px-2 font-normal"
          >
            <span className="mr-2 text-gray-500 dark:text-gray-400">{t.icon}</span>
            <span className="flex-1 text-left">Turn into · {t.label}</span>
            {currentBlockType === t.id && <Check className="h-3.5 w-3.5 text-gray-500" />}
          </Button>
        ))}

        {/* Flat Properties hits while searching (block handle menu) */}
        {propertyMatches.map((t) => (
          <Button
            key={`search-prop-${t.id}`}
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onAction('turnInto', { propertyType: t.id }) // Property pick from search
              onClose()
            }}
            className="justify-start text-sm h-8 px-2 font-normal"
          >
            <span className="mr-2 text-gray-500 dark:text-gray-400">{t.icon}</span>
            <span className="flex-1 text-left">Turn into · {t.label}</span>
          </Button>
        ))}
      </div>

      {/* Turn into flyout: Format / Property tabs — one pane so the menu stays compact */}
      {(openSubmenu === 'turnInto' || openSubmenu === 'boardIn') && (
        <div
          data-tt-menu-flyout="main"
          className={cn(
            'absolute z-[1001] tt-menu-surface rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f]',
            turnIntoPane === 'property' ? 'w-[320px]' : 'w-max min-w-[180px]'
          )}
          onMouseEnter={() => {
            if (openSubmenu !== 'boardIn') setOpenSubmenu('turnInto')
          }}
        >
          {/* Format / Property — slash separates the two section headings on one row */}
          <div className="flex items-center gap-1.5 border-b border-gray-100 px-2.5 py-1.5 dark:border-[#2f2f2f]">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setTurnIntoPane('format')
                setShowPropertySearch(false)
              }}
              className={cn(
                'text-[11px]',
                turnIntoPane === 'format'
                  ? 'text-gray-700 dark:text-gray-200'
                  : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
              )}
            >
              Format
            </button>
            <span className="text-[11px] text-gray-300 dark:text-gray-600" aria-hidden>
              /
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setTurnIntoPane('property')
                if (openSubmenu === 'boardIn') setOpenSubmenu('turnInto')
              }}
              className={cn(
                'flex-1 text-left text-[11px]',
                turnIntoPane === 'property'
                  ? 'text-gray-700 dark:text-gray-200'
                  : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
              )}
            >
              Property
            </button>
            {turnIntoPane === 'property' && (
              <button
                type="button"
                aria-label="Search properties"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setShowPropertySearch((v) => !v) // Toggle the in-pane search field
                }}
                className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-[#2a2a2a]"
              >
                <Search className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {turnIntoPane === 'format' ? (
            /* Format: shrink-wrap type list */
            <div className="flex w-max min-w-max flex-col gap-1 overflow-y-auto p-1">
              {filteredTurnInto.map((t) => (
                <Button
                  key={t.id}
                  variant="ghost"
                  size="sm"
                  onMouseEnter={() => {
                    if (t.id === 'boardIn') setOpenSubmenu('boardIn')
                    else if (openSubmenu === 'boardIn') setOpenSubmenu('turnInto')
                  }}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (t.id === 'boardIn') {
                      setOpenSubmenu('boardIn')
                      return
                    }
                    onAction('turnInto', { blockType: t.id })
                    onClose()
                  }}
                  className={cn(
                    'justify-start gap-2 text-sm h-8 px-2 font-normal w-auto min-w-full whitespace-nowrap',
                    currentBlockType === t.id && 'bg-blue-50 dark:bg-blue-950/40',
                    t.id === 'boardIn' && openSubmenu === 'boardIn' && 'bg-gray-100 dark:bg-[#2a2a2a]'
                  )}
                >
                  <span className="text-gray-500 dark:text-gray-400">{t.icon}</span>
                  <span className="flex-1 text-left">{t.label}</span>
                  {t.id === 'boardIn' && <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
                  {currentBlockType === t.id && t.id !== 'boardIn' && (
                    <Check className="h-3.5 w-3.5 text-gray-500" />
                  )}
                </Button>
              ))}
            </div>
          ) : (
            /* Property: AI Autofill + type grids + connectors */
            <div className="max-h-[min(70vh,420px)] overflow-y-auto p-1.5">
              {showPropertySearch && (
                <input
                  ref={propertySearchRef}
                  value={propertyQuery}
                  onChange={(e) => setPropertyQuery(e.target.value)}
                  onMouseDown={(e) => e.stopPropagation()} // Don't let the menu root preventDefault steal focus
                  placeholder="Type property name..."
                  className="mb-1.5 h-7 w-full rounded-md border border-gray-200 bg-gray-50 px-2 text-xs outline-none dark:border-[#3a3a3a] dark:bg-[#2a2a2a] dark:text-gray-100"
                />
              )}

              {filteredAiAutofill.length > 0 && (
                <>
                  <div className="px-1.5 pb-1 pt-0.5 text-[11px] text-gray-400">AI Autofill</div>
                  <div className="flex flex-col gap-0.5">
                    {filteredAiAutofill.map((t) => (
                      <Button
                        key={t.id}
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          onAction('turnInto', { aiAutofill: t.id }) // AI Autofill stub
                          onClose()
                        }}
                        className="justify-start text-sm h-8 px-1.5 font-normal w-full"
                      >
                        <span className="mr-1.5 shrink-0 text-gray-500 dark:text-gray-400">{t.icon}</span>
                        <span className="min-w-0 truncate text-left">{t.label}</span>
                        <span
                          className={cn(
                            'ml-1.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none',
                            t.badge === 'Custom Agent'
                              ? 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                              : 'bg-gray-100 text-gray-500 dark:bg-[#2a2a2a] dark:text-gray-400'
                          )}
                        >
                          {t.badge}
                        </span>
                        {t.chevron && <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-gray-400" />}
                      </Button>
                    ))}
                  </div>
                  <div className="my-1.5 h-px bg-gray-100 dark:bg-[#2f2f2f]" />
                </>
              )}

              {filteredPropertySections.map((section, i) => (
                <div key={section.id}>
                  {i > 0 && <div className="my-1.5 h-px bg-gray-100 dark:bg-[#2f2f2f]" />}
                  <div className="grid grid-cols-2 gap-0.5">
                    {section.items.map((t) => (
                      <Button
                        key={t.id}
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          onAction('turnInto', { propertyType: t.id }) // Property type pick
                          onClose()
                        }}
                        className="justify-start text-sm h-8 px-1.5 font-normal w-full"
                      >
                        <span className="mr-1.5 flex h-4 w-4 shrink-0 items-center justify-center text-gray-500 dark:text-gray-400">
                          {t.icon}
                        </span>
                        <span className="min-w-0 truncate text-left">{t.label}</span>
                        {t.hint && (
                          <HelpCircle className="ml-auto h-3.5 w-3.5 shrink-0 text-gray-300" />
                        )}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Board in — nest under a parent; sits to the right of the Format pane */}
          {openSubmenu === 'boardIn' && turnIntoPane === 'format' && (
            <div
              data-tt-menu-flyout="nested"
              className="absolute z-[1002] min-w-[200px] overflow-y-auto tt-menu-surface rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-1"
              onMouseEnter={() => setOpenSubmenu('boardIn')}
            >
              <div className="px-2 py-1.5 text-[11px] text-gray-400">Nest board under…</div>
              {(boardInTargets.length > 0 ? boardInTargets : [{ id: '', title: 'Current board' }]).map(
                (target) => (
                  <Button
                    key={target.id || 'current'}
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onAction('turnInto', {
                        blockType: 'boardIn',
                        boardInParentId: target.id || null, // null → current conversation in applyTurnInto
                      })
                      onClose()
                    }}
                    className="justify-start text-sm h-8 px-2 font-normal w-full"
                  >
                    <FileText className="h-4 w-4 mr-2 text-gray-500" />
                    <span className="truncate">{target.title || 'Untitled'}</span>
                  </Button>
                )
              )}
            </div>
          )}
        </div>
      )}

      {/* Shape — frame silhouette picker (frames act as shapes) */}
      {openSubmenu === 'frameShape' && (
        <div
          data-tt-menu-flyout="main"
          className="absolute z-[1001] w-[220px] tt-menu-surface rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-2"
          onMouseEnter={() => setOpenSubmenu('frameShape')}
        >
          <div className="px-1 pb-1.5 text-[11px] text-gray-400">Frame shape</div>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onAction('setFrameShape', { frameShape: FRAME_SHAPE_NONE })
              onClose()
            }}
            className={cn(
              'mb-1.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-[#2a2a2a]',
              (currentFrameShape === FRAME_SHAPE_NONE || !currentFrameShape) &&
                'bg-blue-50 dark:bg-blue-950/40'
            )}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded border border-dashed border-gray-300 dark:border-gray-600 text-[10px] text-gray-400">
              —
            </span>
            <span className="flex-1 text-left">Default</span>
            {(currentFrameShape === FRAME_SHAPE_NONE || !currentFrameShape) && (
              <Check className="h-3.5 w-3.5 text-gray-500" />
            )}
          </button>
          <div className="grid grid-cols-5 gap-1">
            {FRAME_SHAPE_TYPES.map((shapeType) => {
              const selected = currentFrameShape === shapeType
              return (
                <button
                  key={shapeType}
                  type="button"
                  title={frameShapeLabel(shapeType)}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onAction('setFrameShape', { frameShape: shapeType })
                    onClose()
                  }}
                  className={cn(
                    'flex h-9 w-full items-center justify-center rounded-md p-1.5 hover:bg-gray-100 dark:hover:bg-[#2a2a2a]',
                    selected && 'bg-blue-50 dark:bg-blue-950/40'
                  )}
                >
                  <Shape
                    type={shapeType}
                    width={22}
                    height={22}
                    fill="transparent"
                    strokeWidth={1.25}
                    stroke="#222"
                    className="dark:[&_*]:stroke-gray-300"
                  />
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Convert layout — Card view / Table view (Notion database frames) */}
      {openSubmenu === 'convertLayout' && convertLayoutMode && (
        <div
          data-tt-menu-flyout="main"
          className="absolute z-[1001] min-w-[180px] tt-menu-surface rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-1"
          onMouseEnter={() => setOpenSubmenu('convertLayout')}
        >
          <div className="px-2 py-1.5 text-[11px] text-gray-400">Layout</div>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (convertLayoutMode === 'card') {
                onClose() // Already Card view
                return
              }
              onAction('convertLayout', { convertLayout: 'card' })
              onClose()
            }}
            className={cn(
              'justify-start text-sm h-8 px-2 font-normal w-full',
              convertLayoutMode === 'card' && 'bg-blue-50 dark:bg-blue-950/40'
            )}
          >
            <LayoutGrid className="h-4 w-4 mr-2 text-gray-500" />
            <span className="flex-1 text-left">Card view</span>
            {convertLayoutMode === 'card' && <Check className="h-3.5 w-3.5 text-gray-500" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (convertLayoutMode === 'table') {
                onClose() // Already Table view
                return
              }
              onAction('convertLayout', { convertLayout: 'table' })
              onClose()
            }}
            className={cn(
              'justify-start text-sm h-8 px-2 font-normal w-full',
              convertLayoutMode === 'table' && 'bg-blue-50 dark:bg-blue-950/40'
            )}
          >
            <Table2 className="h-4 w-4 mr-2 text-gray-500" />
            <span className="flex-1 text-left">Table view</span>
            {convertLayoutMode === 'table' && <Check className="h-3.5 w-3.5 text-gray-500" />}
          </Button>
        </div>
      )}

      {/* Frame Color — Last used / Background color / Border color (Notion-style) */}
      {openSubmenu === 'frameColor' && (
        <div
          data-tt-menu-flyout="main"
          className="absolute z-[1001] w-[240px] overflow-y-auto tt-menu-surface rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] py-1.5"
          onMouseEnter={() => setOpenSubmenu('frameColor')}
        >
          {/* Last used */}
          <div className="px-3 pt-1 pb-1 text-[11px] font-medium text-gray-400">Last used</div>
          {lastFrameColor ? (
            <button
              type="button"
              className="mx-1 flex w-[calc(100%-8px)] items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-gray-900 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-[#2a2a2a]"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                // Re-apply the stored channel + value (do not rematch by id)
                if (lastFrameColor.kind === 'fill') {
                  onAction('setFillColor', { fillColor: lastFrameColor.value })
                } else {
                  onAction('setBorderColor', { borderColor: lastFrameColor.value })
                }
                writeFrameLastColor(lastFrameColor)
              }}
            >
              <span
                className="h-5 w-5 shrink-0 rounded-[4px] border border-gray-200 dark:border-gray-600"
                style={{
                  backgroundColor: lastFrameColor.value || '#ffffff', // Swatch preview (default = white)
                }}
                aria-hidden
              />
              <span className="flex-1 truncate">{lastFrameColor.label}</span>
              <span className="text-[11px] text-gray-400 tabular-nums">⌘⇧H</span>
            </button>
          ) : (
            <div className="px-3 py-1.5 text-[12px] text-gray-400">None yet</div>
          )}

          <div className="my-1.5 mx-2 h-px bg-gray-100 dark:bg-[#2f2f2f]" />

          {/* Background color (= frame fill) */}
          <div className="px-3 pt-0.5 pb-1 text-[11px] font-medium text-gray-400">
            Background color
          </div>
          {FRAME_COLOR_SWATCHES.map((swatch) => {
            const selected = colorsMatch(currentFillColor, swatch.fill)
            return (
              <button
                key={`fill-${swatch.id}`}
                type="button"
                className={cn(
                  'mx-1 flex w-[calc(100%-8px)] items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-gray-900 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-[#2a2a2a]',
                  selected && 'bg-purple-50/60 outline outline-2 outline-blue-500 outline-offset-[-1px] dark:bg-purple-950/30'
                )}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  applyFrameColor('fill', swatch)
                }}
              >
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-gray-200 dark:border-gray-600"
                  style={{ backgroundColor: swatch.fill || '#ffffff' }}
                  aria-hidden
                />
                <span className="flex-1 truncate">{swatch.name} background</span>
              </button>
            )
          })}

          <div className="my-1.5 mx-2 h-px bg-gray-100 dark:bg-[#2f2f2f]" />

          {/* Border color */}
          <div className="px-3 pt-0.5 pb-1 text-[11px] font-medium text-gray-400">Border color</div>
          {/* Size slider — continuous drag; commit on release (no numeric readout) */}
          {(() => {
            const clampedProp = Math.min(8, Math.max(1, Number(currentBorderWeight) || 1))
            const shown =
              borderWeightDraft != null
                ? Math.min(8, Math.max(1, borderWeightDraft))
                : clampedProp
            return (
              <div className="mx-1 mb-1.5 flex items-center px-2 py-1">
                <input
                  type="range"
                  min={1}
                  max={8}
                  step={0.1}
                  value={shown}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    borderWeightDraggingRef.current = true // Own the thumb until release
                    setBorderWeightDraft(shown)
                  }}
                  onChange={(e) => {
                    e.stopPropagation()
                    const w = parseFloat(e.target.value)
                    setBorderWeightDraft(w)
                    // Live preview only — no undo snapshot / DB write yet
                    onAction('setBorderWeight', { borderWeight: w, borderWeightCommit: false })
                  }}
                  onPointerUp={(e) => {
                    e.stopPropagation()
                    borderWeightDraggingRef.current = false
                    const w = parseFloat((e.currentTarget as HTMLInputElement).value) // Final thumb position
                    onAction('setBorderWeight', { borderWeight: w, borderWeightCommit: true })
                    setBorderWeightDraft(null)
                  }}
                  onPointerCancel={() => {
                    borderWeightDraggingRef.current = false
                    setBorderWeightDraft(null)
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-gray-700 dark:bg-[#333] dark:accent-gray-300"
                  title="Border size"
                  aria-label="Border size"
                />
              </div>
            )
          })()}
          {FRAME_COLOR_SWATCHES.map((swatch) => {
            const selected = colorsMatch(currentBorderColor, swatch.border)
            return (
              <button
                key={`border-${swatch.id}`}
                type="button"
                className={cn(
                  'mx-1 flex w-[calc(100%-8px)] items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-gray-900 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-[#2a2a2a]',
                  selected && 'bg-purple-50/60 outline outline-2 outline-blue-500 outline-offset-[-1px] dark:bg-purple-950/30'
                )}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  applyFrameColor('border', swatch)
                }}
              >
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border bg-white dark:bg-[#1f1f1f]"
                  style={{
                    borderColor: swatch.border || '#d1d5db',
                    borderWidth: swatch.border ? 2 : 1,
                    boxShadow: swatch.border ? `inset 0 0 0 1px ${swatch.border}` : undefined,
                  }}
                  aria-hidden
                />
                <span className="flex-1 truncate">{swatch.name} border</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Connections — click picker (Notion) */}
      {openSubmenu === 'connections' && (
        <div
          data-tt-menu-flyout="main"
          className="absolute z-[1001] min-w-[180px] tt-menu-surface rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-1"
          onMouseEnter={() => setOpenSubmenu('connections')}
        >
          <Button
            variant="ghost"
            size="sm"
            className="justify-start text-sm h-8 px-2 font-normal w-full"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onAction('connectNotion') // Select Notion → logo + handle on the frame
              onClose()
            }}
          >
            <NotionMarkIcon className="h-4 w-4 mr-2" />
            <span className="flex-1 text-left">Notion</span>
          </Button>
        </div>
      )}

      {lastEditedLabel && (
        <div className="px-2.5 py-1.5 text-[11px] text-gray-400 border-t border-gray-100 dark:border-[#2f2f2f] mt-0.5">
          {lastEditedLabel}
        </div>
      )}
    </div>
  )
}
