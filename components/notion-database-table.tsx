'use client'

// Editable Notion database with Thinktable view settings (layout / filter / sort / group / color / sub-tasks).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Hash,
  List,
  Loader2,
  Plus,
  Type,
} from 'lucide-react'
import {
  BlockActionsMenu,
  type BlockActionId,
  type BlockActionPayload,
  type DbConvertLayoutId,
} from '@/components/block-actions-menu'
import { useBoardLinkActions } from '@/lib/board-link-context'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { CardConvertBringDialog } from '@/components/card-convert-bring-dialog'
import {
  collectRowsForCardConvert,
  cardedPageIdsFromMessages,
  resolveParentRelationProperty,
  rowIsNestedOrParent,
  type CardConvertBringPrefs,
} from '@/lib/notion/card-convert-bring'
import { setGroupLocked, setSideStackEntry, sideStackGroupId } from '@/lib/frame-side-stacks'
import {
  appendPeeledCardToMessagesCache,
  appendPeeledPageIdsOnHostFrame,
  createRowCardOnBoard,
  NOTION_ROW_DRAG_MIME,
  readPeeledNotionPageIds,
  type NotionRowDragPayload,
} from '@/lib/notion/row-to-card-client'
import {
  applyEditToCell,
  isNotionPropertyEditable,
  notionSelectColor,
  type NotionDatabaseTable,
  type NotionDbCell,
  type NotionDbProperty,
  type NotionDbRow,
  type NotionPropertyEditValue,
} from '@/lib/notion/database'
import {
  applyNotionLayoutConfig,
  applyViewRows,
  buildSubTaskTree,
  columnWidthPx,
  defaultDatabaseViewSettings,
  groupRows,
  normalizeViewSettings,
  parseViewSettings,
  rowBackground,
  subTasksFromNotionView,
  visibleProperties,
  type DatabaseViewSettings,
} from '@/lib/notion/database-view'
import { DatabaseViewToolbar } from '@/components/database-view-settings'
import { rowTitleFromCells } from '@/lib/notion/property-map'
import { useSidebarContext } from '@/components/sidebar-context' // Phone: lightweight cells until tapped
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const ROW_GUTTER = 20 // Left padding so overlay ⋮⋮ / + sit outside the first property column

type NotionDatabaseTableViewProps = {
  notionDatabaseId: string // Notion DB UUID to load
  fallbackTitle?: string // Attr title while loading
  className?: string
  viewSettingsJson?: string | null // Persisted TipTap attr
  onViewSettingsChange?: (json: string) => void // Persist back to databaseBlock
  /** Board containing the host frame — Convert layout places cards here. */
  conversationId?: string | null
  /** Host frame message id — Convert layout source + thread endpoint. */
  hostMessageId?: string | null
  /** Host frame selected — only then block RF drag (unselected = grab table to move frame). */
  frameSelected?: boolean
}

/** Column-type icon for property headers. */
function PropertyTypeIcon({ type }: { type: string }) {
  if (type === 'checkbox') return <Check className="h-3 w-3 opacity-50" aria-hidden />
  if (type === 'number') return <Hash className="h-3 w-3 opacity-50" aria-hidden />
  if (type === 'select' || type === 'multi_select' || type === 'status') {
    return <List className="h-3 w-3 opacity-50" aria-hidden />
  }
  return <Type className="h-3 w-3 opacity-50" aria-hidden />
}

/** Colored option pill (select / multi_select / status). */
function TagPill({ name, color }: { name: string; color?: string }) {
  const { bg, fg } = notionSelectColor(color)
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-tight max-w-full truncate"
      style={{ background: bg, color: fg }}
    >
      {name}
    </span>
  )
}

/** Read-only display for one cell (used inside editors + non-editable types). */
function CellDisplay({
  prop,
  cell,
  rowIcon,
}: {
  prop: NotionDbProperty
  cell?: NotionDbCell
  rowIcon?: string | null
}) {
  if (prop.type === 'checkbox') {
    return (
      <span
        className={cn(
          'inline-flex h-4 w-4 items-center justify-center rounded-[3px] border',
          cell?.checked
            ? 'bg-[#2eaadc] border-[#2eaadc] text-white'
            : 'bg-white border-gray-300'
        )}
        aria-checked={!!cell?.checked}
        role="checkbox"
      >
        {cell?.checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
      </span>
    )
  }
  if (prop.type === 'select' || prop.type === 'multi_select' || prop.type === 'status') {
    const tags = cell?.tags || []
    if (tags.length === 0) return <span className="text-gray-300 text-[13px]">Empty</span>
    return (
      <span className="inline-flex flex-wrap gap-1">
        {tags.map((t) => (
          <TagPill key={t.name} name={t.name} color={t.color} />
        ))}
      </span>
    )
  }
  if (prop.type === 'title') {
    return (
      <span className="flex items-center gap-1.5 min-w-0 max-w-full overflow-hidden font-medium text-[13px] text-gray-900">
        {rowIcon ? <span className="flex-shrink-0 leading-none">{rowIcon}</span> : null}
        <span className="min-w-0 truncate">{cell?.text || 'Untitled'}</span>
      </span>
    )
  }
  return (
    <span className="block min-w-0 truncate text-[13px] text-gray-700 tabular-nums">
      {cell?.text || <span className="text-gray-300">Empty</span>}
    </span>
  )
}

type SaveFn = (
  pageId: string,
  propertyName: string,
  value: NotionPropertyEditValue
) => Promise<void>

/** Inline text/number editor — click to edit, blur/Enter commits. */
function TextCellEditor({
  prop,
  cell,
  rowIcon,
  pageId,
  onSave,
  saving,
}: {
  prop: NotionDbProperty
  cell?: NotionDbCell
  rowIcon?: string | null
  pageId: string
  onSave: SaveFn
  saving: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(cell?.text || '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(cell?.text || '')
  }, [cell?.text, editing])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = async () => {
    setEditing(false)
    const next = draft.trim()
    const prev = (cell?.text || '').trim()
    if (next === prev) return
    if (prop.type === 'number') {
      if (next === '') {
        await onSave(pageId, prop.name, { type: 'number', number: null })
      } else {
        const n = parseFloat(next)
        if (Number.isNaN(n)) {
          setDraft(cell?.text || '')
          return
        }
        await onSave(pageId, prop.name, { type: 'number', number: n })
      }
      return
    }
    const type = prop.type as 'title' | 'rich_text' | 'url' | 'email' | 'phone_number' | 'date'
    await onSave(pageId, prop.name, { type, text: next })
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={cn(
          'w-full min-w-0 max-w-full min-h-[28px] overflow-hidden text-left rounded px-0.5 -mx-0.5 hover:bg-black/[0.04]',
          saving && 'opacity-60'
        )}
        onClick={(e) => {
          e.stopPropagation()
          setEditing(true)
        }}
        disabled={saving}
      >
        <CellDisplay prop={prop} cell={cell} rowIcon={rowIcon} />
      </button>
    )
  }

  return (
    <input
      ref={inputRef}
      type={prop.type === 'number' ? 'number' : prop.type === 'date' ? 'date' : 'text'}
      className="w-full min-w-0 rounded border border-blue-400 bg-white px-1 py-0.5 text-[13px] outline-none"
      value={draft}
      disabled={saving}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        e.stopPropagation() // Keep RF / TipTap from seeing keys
        if (e.key === 'Enter') {
          e.preventDefault()
          void commit()
        }
        if (e.key === 'Escape') {
          setDraft(cell?.text || '')
          setEditing(false)
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    />
  )
}

/** Checkbox — click toggles and saves immediately. */
function CheckboxCellEditor({
  prop,
  cell,
  pageId,
  onSave,
  saving,
}: {
  prop: NotionDbProperty
  cell?: NotionDbCell
  pageId: string
  onSave: SaveFn
  saving: boolean
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center rounded p-0.5 hover:bg-black/[0.04]',
        saving && 'opacity-60'
      )}
      disabled={saving}
      onClick={(e) => {
        e.stopPropagation()
        void onSave(pageId, prop.name, {
          type: 'checkbox',
          checked: !cell?.checked,
        })
      }}
      aria-label={cell?.checked ? 'Uncheck' : 'Check'}
    >
      <CellDisplay prop={prop} cell={cell} />
    </button>
  )
}

/** Select / status — menu lists every option from the Notion property schema. */
function SelectCellEditor({
  prop,
  cell,
  pageId,
  onSave,
  saving,
}: {
  prop: NotionDbProperty
  cell?: NotionDbCell
  pageId: string
  onSave: SaveFn
  saving: boolean
}) {
  const options = prop.options || []
  const current = cell?.tags?.[0]?.name || null
  const type = prop.type as 'select' | 'status'

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'w-full min-h-[28px] text-left rounded px-0.5 -mx-0.5 hover:bg-black/[0.04]',
            saving && 'opacity-60'
          )}
          disabled={saving}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <CellDisplay prop={prop} cell={cell} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-64 min-w-[180px] overflow-y-auto z-[200]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {options.length === 0 ? (
          <DropdownMenuItem disabled>No options in Notion</DropdownMenuItem>
        ) : (
          options.map((opt) => (
            <DropdownMenuItem
              key={opt.id || opt.name}
              className={cn(current === opt.name && 'bg-accent')}
              onSelect={() => {
                void onSave(pageId, prop.name, { type, name: opt.name })
              }}
            >
              <TagPill name={opt.name} color={opt.color} />
            </DropdownMenuItem>
          ))
        )}
        {current ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void onSave(pageId, prop.name, { type, name: null })
              }}
            >
              <span className="text-gray-500 text-xs">Clear</span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Multi-select — checklist of every Notion option; stays open while toggling. */
function MultiSelectCellEditor({
  prop,
  cell,
  pageId,
  onSave,
  saving,
}: {
  prop: NotionDbProperty
  cell?: NotionDbCell
  pageId: string
  onSave: SaveFn
  saving: boolean
}) {
  const options = prop.options || []
  const selected = new Set((cell?.tags || []).map((t) => t.name))

  const toggle = (name: string) => {
    const next = new Set(selected)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    // Preserve Notion option order in the saved list
    const names = options.filter((o) => next.has(o.name)).map((o) => o.name)
    // Include any selected names not in schema (legacy) at the end
    for (const n of next) {
      if (!names.includes(n)) names.push(n)
    }
    void onSave(pageId, prop.name, { type: 'multi_select', names })
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'w-full min-h-[28px] text-left rounded px-0.5 -mx-0.5 hover:bg-black/[0.04]',
            saving && 'opacity-60'
          )}
          disabled={saving}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <CellDisplay prop={prop} cell={cell} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-64 min-w-[200px] overflow-y-auto z-[200]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {options.length === 0 ? (
          <DropdownMenuItem disabled>No options in Notion</DropdownMenuItem>
        ) : (
          options.map((opt) => (
            <DropdownMenuCheckboxItem
              key={opt.id || opt.name}
              checked={selected.has(opt.name)}
              onCheckedChange={() => toggle(opt.name)}
              onSelect={(e) => e.preventDefault()} // Keep menu open for multi-toggle
            >
              <TagPill name={opt.name} color={opt.color} />
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Pick the right editor for a property type (or read-only display). */
function EditableCell({
  prop,
  cell,
  rowIcon,
  pageId,
  onSave,
  saving,
}: {
  prop: NotionDbProperty
  cell?: NotionDbCell
  rowIcon?: string | null
  pageId: string
  onSave: SaveFn
  saving: boolean
}) {
  const { isMobileMode } = useSidebarContext() // Phone: defer heavy editors until the cell is armed
  const [armed, setArmed] = useState(false) // True after tap — mount select/input chrome
  // Phone Safari: hundreds of select/checkbox editors in a DB frame OOMs on fast pan
  if (isMobileMode && !armed) {
    return (
      <div
        className="min-h-[28px] w-full min-w-0 max-w-full overflow-hidden cursor-text"
        onPointerDown={(e) => {
          e.stopPropagation() // Arm without starting RF drag
          setArmed(true)
        }}
      >
        <CellDisplay prop={prop} cell={cell} rowIcon={rowIcon} />
      </div>
    )
  }
  if (!isNotionPropertyEditable(prop.type)) {
    return <CellDisplay prop={prop} cell={cell} rowIcon={rowIcon} />
  }
  if (prop.type === 'checkbox') {
    return (
      <CheckboxCellEditor
        prop={prop}
        cell={cell}
        pageId={pageId}
        onSave={onSave}
        saving={saving}
      />
    )
  }
  if (prop.type === 'select' || prop.type === 'status') {
    return (
      <SelectCellEditor
        prop={prop}
        cell={cell}
        pageId={pageId}
        onSave={onSave}
        saving={saving}
      />
    )
  }
  if (prop.type === 'multi_select') {
    return (
      <MultiSelectCellEditor
        prop={prop}
        cell={cell}
        pageId={pageId}
        onSave={onSave}
        saving={saving}
      />
    )
  }
  return (
    <TextCellEditor
      prop={prop}
      cell={cell}
      rowIcon={rowIcon}
      pageId={pageId}
      onSave={onSave}
      saving={saving}
    />
  )
}

/** Left-gutter ⋮⋮ for a database row — select + menu; drag onto board → new DB. */
function RowHandle({
  row,
  selected,
  onSelect,
  onDelete,
  onOpen,
  onDuplicate,
  onConvertLayout,
  dragPayload,
}: {
  row: NotionDbRow
  selected: boolean
  onSelect: () => void
  onDelete: () => void
  onOpen: () => void
  onDuplicate: () => void
  onConvertLayout?: (layout: DbConvertLayoutId, rowId: string) => void
  dragPayload: NotionRowDragPayload
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const draggedRef = useRef(false) // Skip menu open after a drag

  const closeMenu = useCallback(() => setMenu(null), [])

  // Click away closes — same pattern as TipTap block ⋮⋮
  useEffect(() => {
    if (!menu) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('.block-actions-menu')) return
      if (btnRef.current?.contains(t)) return
      closeMenu()
    }
    document.addEventListener('mousedown', onDoc, true)
    return () => document.removeEventListener('mousedown', onDoc, true)
  }, [menu, closeMenu])

  const onAction = useCallback(
    (action: BlockActionId, payload?: BlockActionPayload) => {
      if (action === 'open') onOpen()
      else if (action === 'delete') onDelete()
      else if (action === 'duplicate') onDuplicate()
      else if (action === 'convertLayout' && payload?.convertLayout) {
        onConvertLayout?.(payload.convertLayout, row.id)
      } else if (action === 'copyLink') {
        const url =
          row.url || `https://www.notion.so/${String(row.id).replace(/-/g, '')}`
        void navigator.clipboard.writeText(url).catch(() => {})
      }
      closeMenu()
    },
    [onOpen, onDelete, onDuplicate, onConvertLayout, row.url, row.id, closeMenu]
  )

  const openMenuAt = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    setMenu({
      x: r ? r.left : 0,
      y: r ? r.top + r.height / 2 : 0,
    })
  }, [])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        draggable
        className={cn(
          'tt-db-row-handle flex h-5 w-5 items-center justify-center rounded text-gray-400 cursor-grab active:cursor-grabbing',
          'opacity-0 group-hover/row:opacity-100 focus:opacity-100 hover:bg-black/5 hover:text-gray-800',
          'group-hover/gutter:opacity-100',
          selected && 'opacity-100 bg-blue-50 text-blue-600',
          menu && 'opacity-100 bg-blue-50 text-blue-600'
        )}
        title="Drag to board or open actions"
        aria-label="Row handle"
        onPointerDown={(e) => {
          e.stopPropagation() // Don't start RF frame drag
          onSelect() // Arm this row immediately
        }}
        onDragStart={(e) => {
          draggedRef.current = false
          onSelect()
          e.dataTransfer.setData(NOTION_ROW_DRAG_MIME, JSON.stringify(dragPayload))
          e.dataTransfer.effectAllowed = 'copy'
          // Some browsers need text/plain for drop to fire
          e.dataTransfer.setData('text/plain', dragPayload.row.id)
          closeMenu()
        }}
        onDrag={() => {
          draggedRef.current = true
        }}
        onDragEnd={() => {
          // click may fire after dragend in some browsers — keep flag briefly
          window.setTimeout(() => {
            draggedRef.current = false
          }, 0)
        }}
        onClick={(e) => {
          e.stopPropagation()
          onSelect()
          if (draggedRef.current) return // Drag, not a menu click
          if (menu) {
            closeMenu()
            return
          }
          openMenuAt()
        }}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      {menu &&
        typeof document !== 'undefined' &&
        createPortal(
          <BlockActionsMenu
            x={menu.x}
            y={menu.y}
            zoom={1}
            positionMode="fixed"
            openLeft
            showOpen
            menuHeader="Page"
            showAddChild={false}
            convertLayoutMode={onConvertLayout ? 'table' : null}
            onAction={onAction}
            onClose={closeMenu}
          />,
          document.body
        )}
    </>
  )
}

/**
 * Between-row add control — 1px hairline on the row border (same #e5e7eb as table rules);
 * darkens on hover. Hit target is taller; the stroke sits on the cell edge (no ±50% drift).
 */
function RowInsertBar({
  onAdd,
  edge,
}: {
  onAdd: () => void
  edge: 'top' | 'bottom'
}) {
  return (
    <button
      type="button"
      data-tt-db-insert
      className={cn(
        'group/insert absolute left-0 z-[6] h-3 w-5 cursor-pointer select-none',
        'opacity-0 group-hover/gutter:opacity-100',
        // Flush to the cell edge where border-collapse paints the row rule
        edge === 'top' ? 'top-0' : 'bottom-0'
      )}
      title="Add row"
      aria-label="Add row"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onAdd()
      }}
    >
      {/* 1px stroke on the cell edge — rounded ends like TipTap add lines; soft → dark on hover */}
      <span
        className={cn(
          'pointer-events-none absolute left-1/2 h-px w-3 -translate-x-1/2 rounded-full',
          'bg-[#e5e7eb] transition-colors group-hover/insert:bg-black/35',
          'dark:bg-gray-600 dark:group-hover/insert:bg-white/40',
          // Center the 1px stroke on the collapsed border (sits outside the padding edge)
          edge === 'top' ? 'top-0 -translate-y-1/2' : 'bottom-0 translate-y-1/2'
        )}
        aria-hidden
      />
    </button>
  )
}

/**
 * Fetches a Notion database and renders it with Thinktable view settings.
 * Cell edits write through to Notion; view config (layout/filter/sort/…) is Thinktable-owned.
 */
export function NotionDatabaseTableView({
  notionDatabaseId,
  fallbackTitle,
  className,
  viewSettingsJson,
  onViewSettingsChange,
  conversationId: conversationIdProp,
  hostMessageId: hostMessageIdProp,
  frameSelected = false,
}: NotionDatabaseTableViewProps) {
  const queryClient = useQueryClient()
  const boardLink = useBoardLinkActions() // Fallback when props missing
  const pathBoardId =
    typeof window !== 'undefined'
      ? window.location.pathname.match(/\/board\/([^/?#]+)/)?.[1] ||
        window.location.pathname.match(/\/embed\/([^/?#]+)/)?.[1] ||
        null
      : null
  const conversationId =
    conversationIdProp || boardLink.conversationId || pathBoardId || null
  const hostMessageId = hostMessageIdProp || boardLink.hostMessageId || null
  const tableQueryKey = useMemo(
    () => ['notion-database', notionDatabaseId] as const,
    [notionDatabaseId]
  )

  // Cache by DB id — TipTap NodeView remounts (e.g. after drag) must not hit Notion again
  const {
    data,
    error: queryError,
    isPending,
  } = useQuery({
    queryKey: tableQueryKey,
    queryFn: async (): Promise<NotionDatabaseTable> => {
      const res = await fetch(`/api/notion/database/${encodeURIComponent(notionDatabaseId)}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((json as { error?: string }).error || 'Failed to load database')
      return json as NotionDatabaseTable
    },
    staleTime: 5 * 60 * 1000, // Fresh enough for edits; drag remounts reuse cache instantly
    gcTime: 30 * 60 * 1000,
  })

  const error = queryError ? (queryError instanceof Error ? queryError.message : 'Failed to load database') : null
  // Only show the loading shell when we have nothing cached (remount with cache = no spinner)
  const loading = isPending && !data
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [settings, setSettings] = useState<DatabaseViewSettings>(() =>
    normalizeViewSettings(parseViewSettings(viewSettingsJson), [])
  )
  const [expandedParents, setExpandedParents] = useState<Set<string>>(() => new Set()) // Nested: empty = collapsed (Notion default)
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null)
  const [rowBusy, setRowBusy] = useState(false)
  /** Nested/parent Card convert — pending row until bring-options dialog confirms. */
  const [bringDialogRowId, setBringDialogRowId] = useState<string | null>(null)

  /** Patch cached table rows (optimistic edits survive NodeView remount). */
  const setCachedTable = useCallback(
    (updater: (prev: NotionDatabaseTable | null) => NotionDatabaseTable | null) => {
      queryClient.setQueryData<NotionDatabaseTable>(tableQueryKey, (prev) => {
        const next = updater(prev ?? null)
        return next === null ? prev : next
      })
    },
    [queryClient, tableQueryKey]
  )

  /** Open a DB row — Notion page URL (fallback from page id when url missing). */
  const openRow = useCallback((row: NotionDbRow) => {
    const url = row.url || `https://www.notion.so/${String(row.id).replace(/-/g, '')}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  /** Peel one or more rows into stacked Card frames on this board (table stays). */
  const convertRowsToCards = useCallback(
    async (primaryRowId: string, prefs: CardConvertBringPrefs) => {
      if (!conversationId || !data || !notionDatabaseId) {
        console.error('Convert layout: missing board or table data', {
          conversationId,
          hasData: !!data,
        })
        return
      }
      const primary = data.rows.find((r) => r.id === primaryRowId)
      if (!primary) {
        console.error('Convert layout: row not in loaded table', primaryRowId)
        return
      }
      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return

        // Prefer host frame position so the card sits to its right
        let origin = { x: 80, y: 80 }
        if (hostMessageId) {
          const { data: hostMsg } = await supabase
            .from('messages')
            .select('metadata')
            .eq('id', hostMessageId)
            .maybeSingle()
          const pos = (hostMsg?.metadata as { position?: { x?: number; y?: number } } | null)
            ?.position
          if (typeof pos?.x === 'number' && typeof pos?.y === 'number') {
            origin = { x: pos.x, y: pos.y }
          }
        }

        const parentRelation = resolveParentRelationProperty(
          data.properties,
          settings.subTasks.relationProperty
        )
        const { ordered } = collectRowsForCardConvert({
          primary,
          allRows: data.rows,
          parentRelation,
          prefs,
        })
        // Collapsed stack (Stack under): one visible host, mates hidden at the same XY
        const hostCardId = crypto.randomUUID() // Stable id so groupId can reference the host
        const stackSide = 'bottom' as const // Pack sits under the host
        const stackGroupId =
          ordered.length > 1 ? sideStackGroupId(hostCardId, stackSide) : null // Skip stack chrome for a lone frame
        const position = { x: origin.x + 320, y: origin.y } // All frames share this park so they overlay

        for (let i = 0; i < ordered.length; i++) {
          const cardMessageId = i === 0 ? hostCardId : crypto.randomUUID() // Host id is the group seed
          let frameMetadataExtras: Record<string, unknown> | undefined
          if (stackGroupId) {
            let meta = setSideStackEntry(
              {},
              stackSide,
              i === 0
                ? { groupId: stackGroupId, index: 0, anchor: true, expanded: true } // Visible top of stack
                : { groupId: stackGroupId, index: i, expanded: false } // Hidden under host
            )
            meta = setGroupLocked(meta, stackGroupId, true) // Match first Stack-under lock
            frameMetadataExtras = meta
          }
          const { cacheMessage } = await createRowCardOnBoard({
            supabase,
            userId: user.id,
            conversationId,
            sourceMessageId: hostMessageId || undefined,
            notionDatabaseId,
            databaseTitle: data.title,
            properties: data.properties,
            row: ordered[i],
            origin,
            position,
            cardMessageId,
            frameMetadataExtras,
          })
          // Hide row immediately — don't wait for messages refetch
          appendPeeledCardToMessagesCache(queryClient, conversationId, cacheMessage)
        }

        setMessagesTick((n) => n + 1) // Recompute cardedRowIds now

        if (hostMessageId) {
          await appendPeeledPageIdsOnHostFrame({
            supabase,
            hostMessageId,
            pageIds: ordered.map((r) => r.id),
            queryClient,
            conversationId,
          })
          setMessagesTick((n) => n + 1)
        }

        // Drop converted rows from the table cache so they don’t sit beside their cards
        const peeled = new Set(ordered.map((r) => r.id.replace(/-/g, '').toLowerCase()))
        setCachedTable((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            rows: prev.rows.filter((r) => !peeled.has(r.id.replace(/-/g, '').toLowerCase())),
          }
        })

        await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
        await queryClient.refetchQueries({ queryKey: ['messages-for-panels', conversationId] })
        await queryClient.invalidateQueries({ queryKey: ['panel-edges', conversationId] })
        await queryClient.refetchQueries({ queryKey: ['panel-edges', conversationId] })
        await queryClient.invalidateQueries({ queryKey: ['conversations'] })
      } catch (err) {
        console.error('Convert row to card failed:', err)
      }
    },
    [
      conversationId,
      hostMessageId,
      notionDatabaseId,
      data,
      queryClient,
      settings.subTasks.relationProperty,
      setCachedTable,
    ]
  )

  /** One row → card on THIS board (client-side; table stays). Nested/parent → bring dialog. */
  const handleConvertLayout = useCallback(
    async (layout: DbConvertLayoutId, rowId?: string) => {
      if (layout !== 'card' || !rowId) {
        // Table view / full-DB convert still uses the API when no rowId
        if (!conversationId || !hostMessageId || !notionDatabaseId) return
        try {
          const res = await fetch(
            `/api/notion/database/${encodeURIComponent(notionDatabaseId)}/convert-layout`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ layout, conversationId, sourceMessageId: hostMessageId }),
            }
          )
          if (!res.ok) {
            const json = (await res.json().catch(() => ({}))) as { error?: string }
            console.error('Convert layout failed:', json.error || res.statusText)
            return
          }
          await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
          await queryClient.refetchQueries({ queryKey: ['messages-for-panels', conversationId] })
          await queryClient.invalidateQueries({ queryKey: ['panel-edges', conversationId] })
          await queryClient.refetchQueries({ queryKey: ['panel-edges', conversationId] })
        } catch (err) {
          console.error('Convert layout failed:', err)
        }
        return
      }

      if (!data) {
        console.error('Convert layout: missing table data')
        return
      }
      const row = data.rows.find((r) => r.id === rowId)
      if (!row) {
        console.error('Convert layout: row not in loaded table', rowId)
        return
      }
      const parentRelation = resolveParentRelationProperty(
        data.properties,
        settings.subTasks.relationProperty
      )
      // Nested or parent rows get a bring-along picker (prefs remembered)
      if (rowIsNestedOrParent(row, data.rows, parentRelation)) {
        setBringDialogRowId(rowId)
        return
      }
      // Flat row — convert alone with default prefs (no related hierarchy)
      await convertRowsToCards(rowId, {
        subRows: false,
        parentRows: false,
      })
    },
    [conversationId, hostMessageId, notionDatabaseId, data, queryClient, settings.subTasks.relationProperty, convertRowsToCards]
  )

  // Seed Thinktable view settings once when table data lands (cache hit or first fetch)
  useEffect(() => {
    if (!data) return
    const saved = parseViewSettings(viewSettingsJson)
    let seeded =
      !saved && data.notionView
        ? {
            ...defaultDatabaseViewSettings(data.notionView.name || 'Default'),
            layout: data.notionView.layout,
            name: data.notionView.name || 'Default',
          }
        : saved
    // Prefer Notion view layout (subtasks + column widths / wrap / visibility) when present
    if (data.notionView && seeded) {
      seeded = applyNotionLayoutConfig(
        {
          ...seeded,
          subTasks: subTasksFromNotionView(data.notionView.subtasks, data.properties),
        },
        data.notionView.layoutConfig,
        data.properties
      )
    }
    const normalized = normalizeViewSettings(seeded, data.properties)
    setSettings(normalized)
    if (!saved && data.notionView) onViewSettingsChange?.(JSON.stringify(normalized))
    else if (saved && (data.notionView?.subtasks || data.notionView?.layoutConfig)) {
      // Persist Notion-synced layout so remounts stay in sync
      onViewSettingsChange?.(JSON.stringify(normalized))
    }
    // Nested starts collapsed (empty expandedParents) — same as Notion
    // Only re-seed when the DB id / table identity changes — not every viewSettings edit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notionDatabaseId, data?.title, data?.properties?.length, data?.notionView?.id])

  const updateSettings = useCallback(
    (next: DatabaseViewSettings) => {
      const normalized = normalizeViewSettings(next, data?.properties || [])
      setSettings(normalized)
      onViewSettingsChange?.(JSON.stringify(normalized))
    },
    [data?.properties, onViewSettingsChange]
  )

  const onSave = useCallback<SaveFn>(
    async (pageId, propertyName, value) => {
      const key = `${pageId}:${propertyName}`
      setSavingKey(key)
      setSaveError(null)
      const prop = data?.properties.find((p) => p.name === propertyName)
      setCachedTable((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          rows: prev.rows.map((row) => {
            if (row.id !== pageId) return row
            return {
              ...row,
              cells: {
                ...row.cells,
                [propertyName]: applyEditToCell(row.cells[propertyName], value, prop?.options),
              },
            }
          }),
        }
      })
      try {
        const body: Record<string, unknown> = { property: propertyName, type: value.type }
        if (value.type === 'checkbox') body.checked = value.checked
        else if (value.type === 'number') body.number = value.number
        else if (value.type === 'select' || value.type === 'status') body.name = value.name
        else if (value.type === 'multi_select') body.names = value.names
        else if (
          value.type === 'title' ||
          value.type === 'rich_text' ||
          value.type === 'url' ||
          value.type === 'email' ||
          value.type === 'phone_number' ||
          value.type === 'date'
        ) {
          body.text = value.text
        }
        const res = await fetch(`/api/notion/page/${encodeURIComponent(pageId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error || 'Failed to save')
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'Failed to save')
        // Soft refresh into the same cache key (no loading flash)
        void queryClient.invalidateQueries({ queryKey: tableQueryKey })
      } finally {
        setSavingKey(null)
      }
    },
    [data?.properties, queryClient, setCachedTable, tableQueryKey]
  )

  /** Create a Notion page (row) and insert it after `afterId` (null = top). */
  const createRow = useCallback(
    async (afterId: string | null) => {
      if (rowBusy || !data) return
      setRowBusy(true)
      setSaveError(null)
      try {
        const res = await fetch(`/api/notion/database/${encodeURIComponent(notionDatabaseId)}`, {
          method: 'POST',
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error || 'Failed to add row')
        const row = json.row as NotionDbRow
        // Seed empty cells for every property so editors work immediately
        const cells: Record<string, NotionDbCell> = { ...row.cells }
        for (const prop of data.properties) {
          if (!cells[prop.name]) {
            cells[prop.name] =
              prop.type === 'checkbox'
                ? { type: 'checkbox', checked: false }
                : prop.type === 'multi_select' || prop.type === 'select' || prop.type === 'status'
                  ? { type: prop.type, tags: [], text: '' }
                  : { type: prop.type, text: '' }
          }
        }
        const fullRow: NotionDbRow = { ...row, cells }
        setCachedTable((prev) => {
          if (!prev) return prev
          const rows = [...prev.rows]
          if (afterId == null) {
            rows.unshift(fullRow)
          } else {
            const i = rows.findIndex((r) => r.id === afterId)
            if (i >= 0) rows.splice(i + 1, 0, fullRow)
            else rows.push(fullRow)
          }
          return { ...prev, rows }
        })
        setSelectedRowId(fullRow.id)
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'Failed to add row')
      } finally {
        setRowBusy(false)
      }
    },
    [data, notionDatabaseId, rowBusy, setCachedTable]
  )

  /** Archive a Notion page (row) and remove it from the table. */
  const deleteRow = useCallback(
    async (pageId: string) => {
      if (rowBusy) return
      setRowBusy(true)
      setSaveError(null)
      const prevRows = data?.rows
      setCachedTable((prev) =>
        prev ? { ...prev, rows: prev.rows.filter((r) => r.id !== pageId) } : prev
      )
      if (selectedRowId === pageId) setSelectedRowId(null)
      try {
        const res = await fetch(`/api/notion/page/${encodeURIComponent(pageId)}`, {
          method: 'DELETE',
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error || 'Failed to delete row')
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'Failed to delete row')
        if (prevRows && data) {
          setCachedTable(() => ({ ...data, rows: prevRows }))
        }
      } finally {
        setRowBusy(false)
      }
    },
    [data, rowBusy, selectedRowId, setCachedTable]
  )

  const columns = useMemo(
    () => (data ? visibleProperties(data.properties, settings) : []),
    [data, settings]
  )

  // Re-render when board frames change so peeled cards drop out of the table
  const [messagesTick, setMessagesTick] = useState(0)
  useEffect(() => {
    if (!conversationId) return
    const unsub = queryClient.getQueryCache().subscribe((event) => {
      const key = event?.query?.queryKey
      if (
        Array.isArray(key) &&
        key[0] === 'messages-for-panels' &&
        key[1] === conversationId
      ) {
        setMessagesTick((n) => n + 1)
      }
    })
    return unsub
  }, [conversationId, queryClient])

  /** Rows already on the board as Card-view frames — hide from the live table. */
  const cardedRowIds = useMemo(() => {
    if (!conversationId || !notionDatabaseId) return new Set<string>()
    const queries = queryClient.getQueriesData({
      queryKey: ['messages-for-panels', conversationId],
    })
    const all: Array<{ id?: string; metadata?: Record<string, unknown> | null }> = []
    let hostPeeled: string[] | null = null
    for (const [, cached] of queries) {
      if (Array.isArray(cached)) {
        for (const msg of cached) {
          const m = msg as { id?: string; metadata?: Record<string, unknown> | null }
          all.push(m)
          if (hostMessageId && m.id === hostMessageId && !hostPeeled) {
            hostPeeled = readPeeledNotionPageIds(m.metadata || undefined)
          }
        }
      }
    }
    return cardedPageIdsFromMessages(all, notionDatabaseId, hostPeeled)
    // messagesTick forces refresh when panel messages cache updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, notionDatabaseId, hostMessageId, queryClient, messagesTick])

  const filteredRows = useMemo(() => {
    if (!data) return []
    const viewed = applyViewRows(data.rows, settings)
    if (cardedRowIds.size === 0) return viewed
    return viewed.filter((r) => !cardedRowIds.has(r.id.replace(/-/g, '').toLowerCase()))
  }, [data, settings, cardedRowIds])
  const groups = useMemo(
    () => groupRows(filteredRows, settings.groupBy),
    [filteredRows, settings.groupBy]
  )
  // Parent→children once — title chevrons + nested walk share this (before early returns)
  const subTaskTree = useMemo(() => {
    if (!settings.subTasks.enabled || !settings.subTasks.relationProperty) {
      return { roots: filteredRows, childrenOf: new Map<string, NotionDbRow[]>() }
    }
    return buildSubTaskTree(filteredRows, settings.subTasks.relationProperty)
  }, [filteredRows, settings.subTasks.enabled, settings.subTasks.relationProperty])

  if (loading) {
    return (
      <div
        className={cn(
          // Keep DB hug size while refetching after NodeView remount / frame drag
          'tt-notion-db nokey flex items-center gap-2 py-3 text-sm text-gray-500 min-w-[420px] min-h-[120px]',
          // Selected: nodrag so cell edits don't move the frame; unselected: allow RF frame drag
          frameSelected && 'nodrag',
          className
        )}
        onPointerDown={frameSelected ? (e) => e.stopPropagation() : undefined}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading {fallbackTitle || 'database'}…
      </div>
    )
  }

  if (error || !data) {
    const linked =
      !!error &&
      (/linked notion view/i.test(error) ||
        /no data sources accessible/i.test(error) ||
        /share the original database/i.test(error))
    // Linked views: title + Notion open chrome already render above — skip the noisy line
    if (linked) return null
    return (
      <div className={cn('py-2 text-sm text-red-600', className)}>
        {error || 'Database unavailable'}
      </div>
    )
  }

  const titleProp = data.properties.find((p) => p.type === 'title')
  const vLines = settings.layoutOptions.showVerticalLines
  // Explicit px widths (Notion view or defaults) so fixed-layout cells clip instead of expanding the hug
  const tablePixelWidth = columns.reduce((sum, prop) => sum + columnWidthPx(prop, settings), 0)

  const renderRowCells = (
    row: NotionDbRow,
    depth: number,
    opts: { insertBeforeAfterId: string | null }
  ) => (
    <>
      {columns.map((prop, colIndex) => {
        const colW = columnWidthPx(prop, settings)
        return (
        <td
          key={prop.id}
          style={{ width: colW, maxWidth: colW, minWidth: 0 }}
          className={cn(
            'relative px-2 py-1 align-middle min-w-0 text-[13px]',
            // First col: overflow visible so -left gutter ⋮⋮ paints into wrap padding; others clip text
            colIndex === 0 ? 'overflow-visible' : 'overflow-hidden',
            // Vertical dividers only BETWEEN columns (never outer left/right)
            vLines && colIndex < columns.length - 1 && 'border-r border-gray-200',
            selectedRowId === row.id && 'bg-blue-50/40',
            !settings.layoutOptions.wrapAllContent && 'tt-db-cell-nowrap whitespace-nowrap'
          )}
        >
          {colIndex === 0 ? (
            <>
              {/* Full row-height gutter — CSS group-hover shows top+bottom add lines together */}
              <div
                data-tt-db-gutter
                className="group/gutter absolute -left-5 top-0 bottom-0 z-[2] w-5"
              >
                <div className="absolute left-0 top-1/2 -translate-y-1/2">
                  <RowHandle
                    row={row}
                    selected={selectedRowId === row.id}
                    onSelect={() => setSelectedRowId(row.id)}
                    onDelete={() => void deleteRow(row.id)}
                    onOpen={() => openRow(row)}
                    onDuplicate={() => void createRow(row.id)}
                    onConvertLayout={
                      conversationId
                        ? (layout, rowId) => void handleConvertLayout(layout, rowId)
                        : undefined
                    }
                    dragPayload={{
                      source: 'notion-db-row',
                      notionDatabaseId,
                      row,
                      properties: data?.properties || [],
                      databaseTitle: data?.title,
                    }}
                  />
                </div>
                <RowInsertBar
                  edge="top"
                  onAdd={() => void createRow(opts.insertBeforeAfterId)}
                />
                <RowInsertBar edge="bottom" onAdd={() => void createRow(row.id)} />
              </div>
            </>
          ) : null}
          {/* Inner clip so first-col overflow:visible still ellipsizes cell text */}
          <div
            className={cn(
              'min-w-0 max-w-full overflow-hidden',
              !settings.layoutOptions.wrapAllContent && 'tt-db-cell-nowrap whitespace-nowrap'
            )}
          >
          {prop.type === 'title' && settings.subTasks.enabled && settings.subTasks.display === 'nested' ? (
            <div
              className="flex items-center gap-0.5 min-w-0 max-w-full overflow-hidden"
              // Nest indent on the name (chevron + icon + title), Notion-style — not the Status column
              style={depth ? { paddingLeft: depth * 16 } : undefined}
            >
              {(() => {
                const kids = subTaskTree.childrenOf.get(row.id) || []
                if (!kids.length) {
                  // Spacer so titles without kids line up with chevron column
                  return <span className="inline-block w-3.5 shrink-0" aria-hidden />
                }
                const open = expandedParents.has(row.id)
                return (
                  <button
                    type="button"
                    className="shrink-0 -ml-0.5 p-0.5 rounded text-gray-400 hover:bg-black/5 hover:text-gray-600"
                    title={open ? 'Collapse' : 'Expand'}
                    aria-expanded={open}
                    onClick={(e) => {
                      e.stopPropagation()
                      setExpandedParents((prev) => {
                        const next = new Set(prev)
                        if (next.has(row.id)) next.delete(row.id)
                        else next.add(row.id)
                        return next
                      })
                    }}
                  >
                    {open ? (
                      <ChevronDown className="h-3 w-3" strokeWidth={2.5} />
                    ) : (
                      <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
                    )}
                  </button>
                )
              })()}
              <div className="min-w-0 flex-1">
                <EditableCell
                  prop={prop}
                  cell={row.cells[prop.name]}
                  rowIcon={settings.layoutOptions.showPageIcon ? row.icon : null}
                  pageId={row.id}
                  onSave={onSave}
                  saving={savingKey === `${row.id}:${prop.name}`}
                />
              </div>
            </div>
          ) : (
            <EditableCell
              prop={prop}
              cell={row.cells[prop.name]}
              rowIcon={
                prop.type === 'title' && settings.layoutOptions.showPageIcon ? row.icon : null
              }
              pageId={row.id}
              onSave={onSave}
              saving={savingKey === `${row.id}:${prop.name}`}
            />
          )}
          </div>
        </td>
        )
      })}
    </>
  )

  const renderTableBody = (rows: NotionDbRow[]) => {
    if (!rows.length) {
      return (
        <tr>
          <td
            colSpan={Math.max(1, columns.length)}
            className="relative overflow-visible px-2 py-2 text-sm text-gray-400"
          >
            <div className="absolute -left-5 top-1/2 -translate-y-1/2">
              <button
                type="button"
                className="flex h-5 w-5 items-center justify-center rounded text-blue-500 hover:bg-blue-50"
                title="Add row"
                onClick={() => void createRow(null)}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            No rows — click + to add
          </td>
        </tr>
      )
    }
    const { roots, childrenOf } = settings.subTasks.enabled
      ? subTaskTree
      : { roots: rows, childrenOf: new Map<string, NotionDbRow[]>() }
    const flat: Array<{ row: NotionDbRow; depth: number }> = []
    // Flat Notion mode: show every row (roots-only walk hid sub-items)
    if (settings.subTasks.enabled && settings.subTasks.display === 'flat') {
      for (const row of rows) flat.push({ row, depth: 0 })
    } else {
      const walk = (row: NotionDbRow, depth: number) => {
        flat.push({ row, depth })
        // Nested starts collapsed — only walk children when the parent chevron is open
        if (
          settings.subTasks.enabled &&
          settings.subTasks.display === 'nested' &&
          expandedParents.has(row.id)
        ) {
          for (const child of childrenOf.get(row.id) || []) walk(child, depth + 1)
        }
      }
      for (const row of settings.subTasks.enabled ? roots : rows) walk(row, 0)
    }

    return flat.map(({ row, depth }, index) => {
      const isFirst = index === 0
      // Top add inserts after previous row (null = before first)
      const insertBeforeAfterId = isFirst ? null : flat[index - 1].row.id
      return (
        <tr
          key={row.id}
          className={cn(
            'group/row relative hover:bg-[#fafafa]',
            // Row rules painted on td via globals.css — avoid a second tr border (misaligns add lines)
            selectedRowId === row.id && 'bg-blue-50/50 ring-1 ring-inset ring-blue-200'
          )}
          style={{
            background:
              selectedRowId === row.id
                ? undefined
                : rowBackground(row, settings.conditionalColors),
          }}
          onClick={() => setSelectedRowId(row.id)}
        >
          {renderRowCells(row, depth, { insertBeforeAfterId })}
        </tr>
      )
    })
  }

  const tableLayout = (
    <div className="relative tt-db-table-wrap overflow-hidden" style={{ paddingLeft: ROW_GUTTER }}>
      {/* Left gutter for overlay grips / + — not a visible empty column */}
      <table
        className="border-separate border-spacing-0 text-left border-0"
        style={{ width: tablePixelWidth, tableLayout: 'fixed' }}
      >
        <thead>
          {/* No top perimeter; header↔body rule only (not a full box) */}
          <tr className="border-b border-gray-200">
            {columns.map((prop, colIndex) => {
              const colW = columnWidthPx(prop, settings)
              return (
              <th
                key={prop.id}
                style={{ width: colW, maxWidth: colW, minWidth: 0 }}
                className={cn(
                  'sticky top-0 z-[1] overflow-hidden whitespace-nowrap px-2 py-1 text-[12px] font-medium text-gray-500 bg-transparent',
                  // Column dividers only when "Show vertical lines" is on — never outer L/R
                  vLines && colIndex < columns.length - 1 && 'border-r border-gray-200'
                )}
              >
                <span className="inline-flex items-center gap-1 max-w-full truncate">
                  <PropertyTypeIcon type={prop.type} />
                  {prop.name}
                </span>
              </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <FragmentGroup key={g.key || '__all'}>
              {settings.groupBy && g.key ? (
                <tr>
                  <td
                    colSpan={Math.max(1, columns.length)}
                    className="px-2 py-1 text-[12px] font-semibold text-gray-600 border-b border-gray-200"
                  >
                    {g.key}
                    <span className="ml-2 font-normal text-gray-400">{g.rows.length}</span>
                  </td>
                </tr>
              ) : null}
              {renderTableBody(g.rows)}
            </FragmentGroup>
          ))}
        </tbody>
      </table>
    </div>
  )

  const listLayout = (
    <div className="divide-y divide-gray-100 min-w-0 max-w-full overflow-hidden">
      {filteredRows.length === 0 ? (
        <div className="px-3 py-3 text-sm text-gray-400">No rows</div>
      ) : (
        filteredRows.map((row) => {
          const title = titleProp ? row.cells[titleProp.name]?.text || 'Untitled' : 'Untitled'
          return (
            <div
              key={row.id}
              className="flex items-center gap-2 px-3 py-2 hover:bg-[#fafafa] min-w-0 overflow-hidden"
              style={{ background: rowBackground(row, settings.conditionalColors) }}
            >
              {settings.layoutOptions.showPageIcon && row.icon ? (
                <span className="leading-none shrink-0">{row.icon}</span>
              ) : null}
              <span className="text-[13px] font-medium truncate min-w-0 flex-1 overflow-hidden">
                {title}
              </span>
              {columns
                .filter((c) => c.type !== 'title')
                .slice(0, 3)
                .map((prop) => (
                  <span
                    key={prop.id}
                    className="text-[12px] text-gray-500 max-w-[120px] truncate shrink-0 overflow-hidden"
                  >
                    <CellDisplay prop={prop} cell={row.cells[prop.name]} />
                  </span>
                ))}
            </div>
          )
        })
      )}
    </div>
  )

  const boardLayout = (() => {
    const boardProp =
      data.properties.find((p) => p.name === settings.groupBy) ||
      data.properties.find((p) => p.type === 'status' || p.type === 'select')
    const boardGroups = groupRows(filteredRows, boardProp?.name || null)
    const cols =
      boardProp?.options?.map((o) => o.name) ||
      boardGroups.map((g) => g.key).filter(Boolean)
    const colSet = new Set(cols)
    for (const g of boardGroups) if (g.key && !colSet.has(g.key)) cols.push(g.key)
    if (!cols.includes('No value') && boardGroups.some((g) => g.key === 'No value')) {
      cols.push('No value')
    }
    const byKey = new Map(boardGroups.map((g) => [g.key || 'No value', g.rows]))
    return (
      <div className="flex gap-2 overflow-x-auto p-2 min-h-[160px]">
        {(cols.length ? cols : ['No value']).map((col) => (
          <div
            key={col}
            className="w-[200px] flex-shrink-0 rounded-md bg-gray-50 border border-gray-100"
          >
            <div className="px-2 py-1.5 text-[12px] font-semibold text-gray-600 border-b border-gray-100">
              {col}
              <span className="ml-1 text-gray-400 font-normal">
                {(byKey.get(col) || []).length}
              </span>
            </div>
            <div className="p-1.5 space-y-1.5 max-h-[320px] overflow-y-auto">
              {(byKey.get(col) || []).map((row) => {
                const title = titleProp
                  ? row.cells[titleProp.name]?.text || 'Untitled'
                  : 'Untitled'
                return (
                  <div
                    key={row.id}
                    className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[13px] shadow-sm"
                    style={{ background: rowBackground(row, settings.conditionalColors) || '#fff' }}
                  >
                    <div className="flex items-center gap-1.5 font-medium">
                      {settings.layoutOptions.showPageIcon && row.icon ? (
                        <span>{row.icon}</span>
                      ) : null}
                      <span className="truncate">{title}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    )
  })()

  const galleryLayout = (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2">
      {filteredRows.map((row) => {
        const title = titleProp ? row.cells[titleProp.name]?.text || 'Untitled' : 'Untitled'
        return (
          <div
            key={row.id}
            className="rounded-md border border-gray-200 p-3 min-h-[88px]"
            style={{ background: rowBackground(row, settings.conditionalColors) || '#fff' }}
          >
            <div className="flex items-center gap-1.5 text-[13px] font-medium mb-2">
              {settings.layoutOptions.showPageIcon && row.icon ? <span>{row.icon}</span> : null}
              <span className="truncate">{title}</span>
            </div>
            {columns
              .filter((c) => c.type !== 'title')
              .slice(0, 4)
              .map((prop) => (
                <div key={prop.id} className="text-[11px] text-gray-500 truncate">
                  {prop.name}: <CellDisplay prop={prop} cell={row.cells[prop.name]} />
                </div>
              ))}
          </div>
        )
      })}
    </div>
  )

  const calendarLayout = (() => {
    const dateProp =
      data.properties.find((p) => p.type === 'date') ||
      data.properties.find((p) => /due|date/i.test(p.name))
    if (!dateProp) {
      return (
        <div className="px-3 py-4 text-sm text-gray-500">
          Add a date property to use calendar layout.
        </div>
      )
    }
    const byDay = new Map<string, NotionDbRow[]>()
    for (const row of filteredRows) {
      const day = (row.cells[dateProp.name]?.text || '').slice(0, 10) || 'No date'
      const list = byDay.get(day) || []
      list.push(row)
      byDay.set(day, list)
    }
    const days = Array.from(byDay.keys()).sort()
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 p-2">
        {days.map((day) => (
          <div key={day} className="rounded-md border border-gray-100 bg-gray-50 p-2">
            <div className="text-[11px] font-semibold text-gray-500 mb-1">{day}</div>
            <div className="space-y-1">
              {(byDay.get(day) || []).map((row) => (
                <div
                  key={row.id}
                  className="rounded bg-white border border-gray-200 px-1.5 py-1 text-[12px] truncate"
                  style={{ background: rowBackground(row, settings.conditionalColors) || '#fff' }}
                >
                  {settings.layoutOptions.showPageIcon && row.icon ? (
                    <span className="mr-1">{row.icon}</span>
                  ) : null}
                  {titleProp ? row.cells[titleProp.name]?.text || 'Untitled' : 'Untitled'}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  })()

  const body =
    settings.layout === 'list'
      ? listLayout
      : settings.layout === 'board'
        ? boardLayout
        : settings.layout === 'gallery'
          ? galleryLayout
          : settings.layout === 'calendar'
            ? calendarLayout
            : tableLayout

  const bringDialogRow = bringDialogRowId
    ? data.rows.find((r) => r.id === bringDialogRowId) || null
    : null
  const bringDialogTitle = bringDialogRow
    ? rowTitleFromCells(data.properties, bringDialogRow.cells)
    : undefined

  return (
    <div
      className={cn(
        // No perimeter box — dividers live on rows/cols inside the table
        'tt-notion-db nokey w-full min-w-[420px] max-w-full overflow-auto bg-transparent',
        // Selected: nodrag so scrolling/editing doesn't start RF drag; unselected: drag the frame
        frameSelected && 'nodrag',
        className
      )}
      onPointerDown={frameSelected ? (e) => e.stopPropagation() : undefined}
    >
      {settings.layoutOptions.showDataSourceTitle ? (
        <div className="px-1 pb-1 text-[12px] font-medium text-gray-500 truncate">
          {data.title || fallbackTitle}
        </div>
      ) : null}
      <DatabaseViewToolbar
        settings={settings}
        onChange={updateSettings}
        properties={data.properties}
        sourceTitle={data.title}
      />
      {saveError ? (
        <div className="px-2 py-1 text-[11px] text-red-600 border-b border-red-100 bg-red-50">
          {saveError}
        </div>
      ) : null}
      {body}
      <CardConvertBringDialog
        open={!!bringDialogRowId}
        onOpenChange={(open) => {
          if (!open) setBringDialogRowId(null)
        }}
        rowTitle={bringDialogTitle}
        onConfirm={(prefs) => {
          const id = bringDialogRowId
          setBringDialogRowId(null)
          if (id) void convertRowsToCards(id, prefs)
        }}
      />
    </div>
  )
}

/** Tiny helper so grouped table sections don't need Fragment import noise. */
function FragmentGroup({ children }: { children: ReactNode }) {
  return <>{children}</>
}
