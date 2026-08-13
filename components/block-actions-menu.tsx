'use client'

// Notion-style block actions menu — baseline options (Turn into / Color / etc.);
// wired actions work now; submenu stubs are intentional until we flesh them out.

import { useEffect, useMemo, useRef, useState } from 'react' // Search, submenu, focus
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
  PencilLine,
  Type,
  PaintBucket,
  Pencil,
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
} from 'lucide-react' // Action + Turn into + Property icons
import { Button } from '@/components/ui/button' // Row buttons
import { cn } from '@/lib/utils' // Class merge
import { LegoBrickIcon } from './lego-brick-icon' // Frame-group lock: two bricks, top one stud back
import Shape from '@/components/shapes/Shape' // Mini silhouette previews in the Shape flyout
import {
  FRAME_SHAPE_NONE,
  FRAME_SHAPE_TYPES,
  frameShapeLabel,
  type FrameShapeChoice,
} from '@/lib/frame-shape' // Frame-as-shape picker values

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
  | 'suggestEdits'
  | 'presentFromHere'
  | 'askAI'
  | 'skills'
  | 'setFrameShape' // Apply / clear a silhouette on the host frame
  | 'setFillColor' // Frame background (transparent when empty)
  | 'setBorderColor' // Frame border stroke
  | 'lockToBoard' // Pin selected frames so they cannot drag
  | 'lockFramesTogether' // Rigid-group lock for ≥2 selected frames

export type BlockActionPayload = {
  blockType?: BlockTypeId // Present when action === 'turnInto'
  propertyType?: PropertyTypeId // Present when Turn into → Property pick
  aiAutofill?: AiAutofillId // Present when Turn into → AI Autofill pick
  boardInParentId?: string | null // Nest target for Page in
  frameShape?: FrameShapeChoice // Present when action === 'setFrameShape'
  fillColor?: string // Empty string = transparent fill
  borderColor?: string // Empty string = transparent border
}

/** AI Autofill rows in the Property pane (stubs until wired). */
export type AiAutofillId = 'summarize' | 'translate' | 'riskTier' | 'customerSentiment'

/** Notion-like property kinds in the Turn into right pane. */
export type PropertyTypeId =
  | 'text'
  | 'number'
  | 'select'
  | 'multiSelect'
  | 'status'
  | 'date'
  | 'person'
  | 'files'
  | 'checkbox'
  | 'url'
  | 'phone'
  | 'email'
  | 'relation'
  | 'rollup'
  | 'formula'
  | 'button'
  | 'uniqueId'
  | 'place'
  | 'createdTime'
  | 'lastEditedTime'
  | 'createdBy'
  | 'lastEditedBy'
  | 'googleDriveFile'
  | 'figmaFile'
  | 'zendeskTicket'

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
  /** True when the focused frame is pinned to the board. */
  boardLocked?: boolean
  /** True when ≥2 selected frames share a frameLockGroupId. */
  framesLockedTogether?: boolean
  /** Enables “Lock frames to each other” (≥2 selected frames). */
  canLockFramesTogether?: boolean
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
      submenu?: 'turnInto' | 'color' | 'listFormat' | 'skills' | 'boardIn' | 'frameShape' | 'fillColor' | 'borderColor'
      hidden?: boolean
      beta?: boolean
    }
  | { kind: 'separator'; hidden?: boolean }

/** Human label for a baseline block type (menu context + Turn into). */
export function blockTypeLabel(type: BlockTypeId): string {
  const map: Record<BlockTypeId, string> = {
    text: 'Text',
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
  boardLocked = false,
  framesLockedTogether = false,
  canLockFramesTogether = false,
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
  const [openSubmenu, setOpenSubmenu] = useState<
    'turnInto' | 'boardIn' | 'frameShape' | 'fillColor' | 'borderColor' | null
  >(null) // Flyout
  const inputRef = useRef<HTMLInputElement>(null) // Autofocus search
  const propertySearchRef = useRef<HTMLInputElement>(null) // Focus when Property search opens
  const rootRef = useRef<HTMLDivElement>(null) // Position flyout

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (showPropertySearch) propertySearchRef.current?.focus() // Caret in Property search
  }, [showPropertySearch])

  const rows = useMemo((): RowDef[] => {
    const list: RowDef[] = [
      {
        kind: 'action',
        id: 'turnInto',
        label: 'Turn into',
        icon: <RefreshCw className="h-4 w-4" />,
        submenu: 'turnInto',
      },
      {
        kind: 'action',
        id: 'color',
        label: 'Color',
        icon: <PaintRoller className="h-4 w-4" />,
        submenu: 'color',
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
        hidden: !showAddChild,
      },
      {
        kind: 'action',
        id: 'condense',
        label: isCollapsed ? 'Expand' : 'Condense',
        icon: isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />,
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
        id: 'setFillColor',
        label: 'Fill',
        icon: <PaintBucket className="h-4 w-4" />,
        submenu: 'fillColor', // Frame background color picker
        hidden: !showFrameShape,
      },
      {
        kind: 'action',
        id: 'setBorderColor',
        label: 'Border',
        icon: <Pencil className="h-4 w-4" />,
        submenu: 'borderColor', // Frame border color picker
        hidden: !showFrameShape,
      },
      {
        kind: 'action',
        id: 'lockToBoard',
        label: boardLocked ? 'Unlock from board' : 'Lock to board',
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
        id: 'group',
        label: 'Group',
        icon: <Group className="h-4 w-4" />,
        hidden: selectedCount < 2,
      },
      {
        kind: 'action',
        id: 'ungroup',
        label: 'Ungroup', // Legacy wrapper around frames — not a product “block group”
        icon: <Ungroup className="h-4 w-4" />,
        hidden: !canUngroup,
      },
      { kind: 'separator' },
      {
        kind: 'action',
        id: 'comment',
        label: 'Comment',
        shortcut: '⌘⇧M',
        icon: <MessageSquare className="h-4 w-4" />,
      },
      {
        kind: 'action',
        id: 'suggestEdits',
        label: 'Suggest edits',
        shortcut: '⌘⇧X',
        icon: <PencilLine className="h-4 w-4" />,
      },
      { kind: 'separator' },
      {
        kind: 'action',
        id: 'presentFromHere',
        label: 'Present from here',
        shortcut: '⌘⇧P',
        icon: <MonitorPlay className="h-4 w-4" />,
        beta: true,
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
  }, [query, isCollapsed, selectedCount, canUngroup, showAddChild, currentBlockType, showFrameShape, boardLocked, framesLockedTogether, canLockFramesTogether])

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

  return (
    <div
      ref={rootRef}
      className={cn(
        'block-actions-menu node-popup z-[1000] overflow-visible bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-1 min-w-[240px]',
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

      {/* Current block type context (Notion-style) */}
      <div className="px-2.5 pb-1 text-xs text-gray-500 dark:text-gray-400">
        {blockTypeLabel(currentBlockType)}
      </div>

      <div className="flex flex-col gap-0.5 max-h-[360px] overflow-y-auto px-0.5 pb-0.5">
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
          const isFillOpen = row.submenu === 'fillColor' && openSubmenu === 'fillColor'
          const isBorderOpen = row.submenu === 'borderColor' && openSubmenu === 'borderColor'
          return (
            <Button
              key={row.id}
              variant="ghost"
              size="sm"
              onMouseEnter={() => {
                if (row.submenu === 'turnInto') setOpenSubmenu('turnInto')
                else if (row.submenu === 'frameShape') setOpenSubmenu('frameShape')
                else if (row.submenu === 'fillColor') setOpenSubmenu('fillColor')
                else if (row.submenu === 'borderColor') setOpenSubmenu('borderColor')
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
                if (row.submenu === 'fillColor') {
                  setOpenSubmenu((s) => (s === 'fillColor' ? null : 'fillColor'))
                  return
                }
                if (row.submenu === 'borderColor') {
                  setOpenSubmenu((s) => (s === 'borderColor' ? null : 'borderColor'))
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
                'justify-start text-sm h-8 px-2 font-normal',
                row.danger && 'text-red-600 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950',
                (isTurnIntoOpen || isShapeOpen || isFillOpen || isBorderOpen) && 'bg-gray-100 dark:bg-[#2a2a2a]'
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

      {/* Turn into flyout: type list shrink-wraps; Property is a fixed second column */}
      {(openSubmenu === 'turnInto' || openSubmenu === 'boardIn') && (
        <div
          className={cn(
            'absolute top-0 z-[1001] inline-flex w-fit max-h-[420px] bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f]',
            // Toward the frame so the Property column stays on-screen (not past the viewport)
            openLeft ? 'left-full ml-1' : 'right-full left-auto mr-1'
          )}
          onMouseEnter={() => {
            if (openSubmenu !== 'boardIn') setOpenSubmenu('turnInto')
          }}
        >
          {/* Left: shrink-wrap to the longest type label; same row rhythm as the main menu */}
          <div className="flex w-max min-w-max shrink-0 flex-col gap-1 max-h-[420px] overflow-y-auto p-1">
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

          <div className="w-px shrink-0 self-stretch bg-gray-100 dark:bg-[#2f2f2f] my-1" />

          {/* Right: Property header + AI Autofill + type grids + connectors */}
          <div className="w-[320px] shrink-0 max-h-[420px] overflow-y-auto p-1.5">
            <div className="flex items-center gap-1 px-1.5 py-1">
              <span className="flex-1 text-[11px] text-gray-400">Property</span>
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
            </div>
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

          {/* Board in — nest under a parent; sits to the right of the combined flyout */}
          {openSubmenu === 'boardIn' && (
            <div
              className="absolute left-full top-8 ml-1 z-[1002] min-w-[200px] max-h-[280px] overflow-y-auto bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-1"
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
          className="absolute left-full top-0 ml-1 z-[1001] w-[220px] bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-2"
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

      {/* Fill — frame background color (empty = transparent) */}
      {openSubmenu === 'fillColor' && (
        <div
          className="absolute left-full top-0 ml-1 z-[1001] w-[180px] bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-2"
          onMouseEnter={() => setOpenSubmenu('fillColor')}
        >
          <div className="px-1 pb-1.5 text-[11px] text-gray-400">Frame fill</div>
          <input
            type="color"
            value={currentFillColor || '#ffffff'}
            onChange={(e) => onAction('setFillColor', { fillColor: e.target.value })}
            className="w-full h-8 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
            title="Fill color"
            aria-label="Fill color"
          />
          <Button
            variant={!currentFillColor ? 'default' : 'outline'}
            size="sm"
            className="w-full mt-2 h-7 text-xs"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onAction('setFillColor', { fillColor: '' })
            }}
          >
            Transparent
          </Button>
        </div>
      )}

      {/* Border — frame stroke color (empty = transparent) */}
      {openSubmenu === 'borderColor' && (
        <div
          className="absolute left-full top-8 ml-1 z-[1001] w-[180px] bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-2"
          onMouseEnter={() => setOpenSubmenu('borderColor')}
        >
          <div className="px-1 pb-1.5 text-[11px] text-gray-400">Frame border</div>
          <input
            type="color"
            value={currentBorderColor || '#000000'}
            onChange={(e) => onAction('setBorderColor', { borderColor: e.target.value })}
            className="w-full h-8 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
            title="Border color"
            aria-label="Border color"
          />
          <Button
            variant={!currentBorderColor ? 'default' : 'outline'}
            size="sm"
            className="w-full mt-2 h-7 text-xs"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onAction('setBorderColor', { borderColor: '' })
            }}
          >
            Transparent
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
