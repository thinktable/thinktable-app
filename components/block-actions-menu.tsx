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
} from 'lucide-react' // Action + Turn into icons
import { Button } from '@/components/ui/button' // Row buttons
import { cn } from '@/lib/utils' // Class merge
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
  | 'page'
  | 'pageIn'
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

export type BlockActionPayload = {
  blockType?: BlockTypeId // Present when action === 'turnInto'
  pageInParentId?: string | null // Nest target for Page in
  frameShape?: FrameShapeChoice // Present when action === 'setFrameShape'
}

export type PageInTarget = {
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
  pageInTargets?: PageInTarget[] // Pages available for "Page in"
  /** Current frame silhouette (frame menu only). */
  currentFrameShape?: FrameShapeChoice
  /** Show Shape submenu — frame-level menu only (not TipTap ⋮⋮ block menu). */
  showFrameShape?: boolean
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

type RowDef =
  | {
      kind: 'action'
      id: BlockActionId
      label: string
      shortcut?: string
      icon: React.ReactNode
      danger?: boolean
      submenu?: 'turnInto' | 'color' | 'listFormat' | 'skills' | 'pageIn' | 'frameShape'
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
    page: 'Page',
    pageIn: 'Page in',
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
  { id: 'page', label: 'Page', icon: <FileText className="h-4 w-4" /> },
  { id: 'pageIn', label: 'Page in', icon: <FolderInput className="h-4 w-4" /> },
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

export function BlockActionsMenu({
  x,
  y,
  zoom = 1,
  isCollapsed = false,
  selectedCount = 1,
  canUngroup = false,
  showAddChild = true,
  currentBlockType = 'text',
  pageInTargets = [],
  currentFrameShape = FRAME_SHAPE_NONE,
  showFrameShape = false,
  lastEditedLabel,
  onAction,
  onClose,
  className,
  positionMode = 'absolute',
  openLeft = false,
}: BlockActionsMenuProps) {
  const [query, setQuery] = useState('') // Filter actions + turn-into
  const [openSubmenu, setOpenSubmenu] = useState<'turnInto' | 'pageIn' | 'frameShape' | null>(null) // Flyout
  const inputRef = useRef<HTMLInputElement>(null) // Autofocus search
  const rootRef = useRef<HTMLDivElement>(null) // Position flyout

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

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
            TURN_INTO_OPTIONS.some((t) => t.label.toLowerCase().includes(q))) ||
          (r.id === 'setFrameShape' &&
            ['default', 'shape', ...FRAME_SHAPE_TYPES].some((s) =>
              frameShapeLabel(s === 'default' ? FRAME_SHAPE_NONE : (s as FrameShapeChoice))
                .toLowerCase()
                .includes(q)
            )))
    )
  }, [query, isCollapsed, selectedCount, canUngroup, showAddChild, currentBlockType, showFrameShape])

  // When searching, also surface matching Turn into types as flat picks
  const turnIntoMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return TURN_INTO_OPTIONS.filter((t) => t.label.toLowerCase().includes(q))
  }, [query])

  const filteredTurnInto = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return TURN_INTO_OPTIONS
    return TURN_INTO_OPTIONS.filter((t) => t.label.toLowerCase().includes(q))
  }, [query])

  return (
    <div
      ref={rootRef}
      className={cn(
        'block-actions-menu node-popup z-[1000] bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-1 min-w-[240px]',
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
        {rows.length === 0 && turnIntoMatches.length === 0 && (
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
          return (
            <Button
              key={row.id}
              variant="ghost"
              size="sm"
              onMouseEnter={() => {
                if (row.submenu === 'turnInto') setOpenSubmenu('turnInto')
                else if (row.submenu === 'frameShape') setOpenSubmenu('frameShape')
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
                (isTurnIntoOpen || isShapeOpen) && 'bg-gray-100 dark:bg-[#2a2a2a]'
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
      </div>

      {/* Turn into flyout — full functional type list */}
      {(openSubmenu === 'turnInto' || openSubmenu === 'pageIn') && (
        <div
          className="absolute left-full top-0 ml-1 z-[1001] min-w-[220px] max-h-[420px] overflow-y-auto bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-1"
          onMouseEnter={() => {
            if (openSubmenu !== 'pageIn') setOpenSubmenu('turnInto')
          }}
        >
          {filteredTurnInto.map((t) => (
            <Button
              key={t.id}
              variant="ghost"
              size="sm"
              onMouseEnter={() => {
                if (t.id === 'pageIn') setOpenSubmenu('pageIn')
                else if (openSubmenu === 'pageIn') setOpenSubmenu('turnInto')
              }}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (t.id === 'pageIn') {
                  setOpenSubmenu('pageIn')
                  return
                }
                onAction('turnInto', { blockType: t.id })
                onClose()
              }}
              className={cn(
                'justify-start text-sm h-8 px-2 font-normal w-full',
                currentBlockType === t.id && 'bg-blue-50 dark:bg-blue-950/40',
                t.id === 'pageIn' && openSubmenu === 'pageIn' && 'bg-gray-100 dark:bg-[#2a2a2a]'
              )}
            >
              <span className="mr-2 text-gray-500 dark:text-gray-400">{t.icon}</span>
              <span className="flex-1 text-left">{t.label}</span>
              {t.id === 'pageIn' && <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
              {currentBlockType === t.id && t.id !== 'pageIn' && (
                <Check className="h-3.5 w-3.5 text-gray-500" />
              )}
            </Button>
          ))}
        </div>
      )}

      {/* Page in — pick parent page to nest under */}
      {openSubmenu === 'pageIn' && (
        <div
          className="absolute left-full top-8 ml-1 z-[1002] min-w-[200px] max-h-[280px] overflow-y-auto bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-1"
          onMouseEnter={() => setOpenSubmenu('pageIn')}
        >
          <div className="px-2 py-1.5 text-[11px] text-gray-400">Nest page under…</div>
          {(pageInTargets.length > 0 ? pageInTargets : [{ id: '', title: 'Current page' }]).map(
            (target) => (
              <Button
                key={target.id || 'current'}
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onAction('turnInto', {
                    blockType: 'pageIn',
                    pageInParentId: target.id || null, // null → current conversation in applyTurnInto
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

      {lastEditedLabel && (
        <div className="px-2.5 py-1.5 text-[11px] text-gray-400 border-t border-gray-100 dark:border-[#2f2f2f] mt-0.5">
          {lastEditedLabel}
        </div>
      )}
    </div>
  )
}
