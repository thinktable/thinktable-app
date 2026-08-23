'use client'

// Virtualized Notion DB table/list bodies + memoized row cells (perf).

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, ChevronDown, ChevronRight, GripVertical, Plus } from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  BlockActionsMenu,
  type BlockActionId,
  type BlockActionPayload,
  type DbConvertLayoutId,
} from '@/components/block-actions-menu'
import {
  isNotionPropertyEditable,
  notionSelectColor,
  type NotionDbCell,
  type NotionDbProperty,
  type NotionDbRow,
  type NotionPropertyEditValue,
} from '@/lib/notion/database'
import { NOTION_ROW_DRAG_MIME, type NotionRowDragPayload } from '@/lib/notion/row-to-card-client'
import type { DatabaseViewSettings } from '@/lib/notion/database-view'
import { columnWidthPx } from '@/lib/notion/database-view'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export const DB_TABLE_ROW_HEIGHT = 32
export const DB_TABLE_SCROLL_CAP = 480 // Internal scroll + virtualization above this height
export const DB_TABLE_VIRTUALIZE_MIN = 20 // Row count before capping height

const ROW_GUTTER = 20

export type SaveFn = (
  pageId: string,
  propertyName: string,
  value: NotionPropertyEditValue
) => Promise<void>

export type FlatTableItem =
  | { kind: 'group'; key: string; label: string; count: number }
  | {
      kind: 'row'
      row: NotionDbRow
      depth: number
      insertBeforeAfterId: string | null
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

/** Read-only display — exported for board/gallery layouts. */
export function CellDisplay({
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
        e.stopPropagation()
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
    const names = options.filter((o) => next.has(o.name)).map((o) => o.name)
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
              onSelect={(e) => e.preventDefault()}
            >
              <TagPill name={opt.name} color={opt.color} />
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Lazy-mount heavy editors on every platform — display until click. */
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
  const [armed, setArmed] = useState(false)

  if (!armed) {
    const interactive = isNotionPropertyEditable(prop.type)
    return (
      <div
        className={cn(
          'min-h-[28px] w-full min-w-0 max-w-full overflow-hidden',
          interactive && 'cursor-text rounded px-0.5 -mx-0.5 hover:bg-black/[0.04]'
        )}
        onPointerDown={(e) => {
          if (!interactive) return
          e.stopPropagation()
          setArmed(true)
        }}
        onClick={(e) => {
          if (!interactive) return
          e.stopPropagation()
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
      <CheckboxCellEditor prop={prop} cell={cell} pageId={pageId} onSave={onSave} saving={saving} />
    )
  }
  if (prop.type === 'select' || prop.type === 'status') {
    return (
      <SelectCellEditor prop={prop} cell={cell} pageId={pageId} onSave={onSave} saving={saving} />
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

function RowInsertBar({ onAdd, edge }: { onAdd: () => void; edge: 'top' | 'bottom' }) {
  return (
    <button
      type="button"
      data-tt-db-insert
      className={cn(
        'group/insert absolute left-0 z-[6] h-3 w-5 cursor-pointer select-none',
        'opacity-0 group-hover/gutter:opacity-100',
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
      <span
        className={cn(
          'pointer-events-none absolute left-1/2 h-px w-3 -translate-x-1/2 rounded-full',
          'bg-[#e5e7eb] transition-colors group-hover/insert:bg-black/35',
          'dark:bg-gray-600 dark:group-hover/insert:bg-white/40',
          edge === 'top' ? 'top-0 -translate-y-1/2' : 'bottom-0 translate-y-1/2'
        )}
        aria-hidden
      />
    </button>
  )
}

const RowHandle = memo(function RowHandle({
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
  const draggedRef = useRef(false)

  const closeMenu = useCallback(() => setMenu(null), [])

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
        const url = row.url || `https://www.notion.so/${String(row.id).replace(/-/g, '')}`
        void navigator.clipboard.writeText(url).catch(() => {})
      }
      closeMenu()
    },
    [onOpen, onDelete, onDuplicate, onConvertLayout, row.url, row.id, closeMenu]
  )

  const openMenuAt = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    setMenu({ x: r ? r.left : 0, y: r ? r.top + r.height / 2 : 0 })
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
          e.stopPropagation()
          onSelect()
        }}
        onDragStart={(e) => {
          draggedRef.current = false
          onSelect()
          e.dataTransfer.setData(NOTION_ROW_DRAG_MIME, JSON.stringify(dragPayload))
          e.dataTransfer.effectAllowed = 'copy'
          e.dataTransfer.setData('text/plain', dragPayload.row.id)
          closeMenu()
        }}
        onDrag={() => {
          draggedRef.current = true
        }}
        onDragEnd={() => {
          window.setTimeout(() => {
            draggedRef.current = false
          }, 0)
        }}
        onClick={(e) => {
          e.stopPropagation()
          onSelect()
          if (draggedRef.current) return
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
})

type DbTableRowProps = {
  row: NotionDbRow
  depth: number
  insertBeforeAfterId: string | null
  columns: NotionDbProperty[]
  settings: DatabaseViewSettings
  selected: boolean
  savingKey: string | null
  vLines: boolean
  notionDatabaseId: string
  databaseTitle: string
  properties: NotionDbProperty[]
  conversationId: string | null | undefined
  childrenOf: Map<string, NotionDbRow[]>
  expandedParents: Set<string>
  onSelect: (id: string) => void
  onToggleExpand: (id: string) => void
  onSave: SaveFn
  onDelete: (id: string) => void
  onOpen: (row: NotionDbRow) => void
  onCreateRow: (afterId: string | null) => void
  onConvertLayout?: (layout: DbConvertLayoutId, rowId: string) => void
  rowBackground: string | undefined
}

export const DbTableRow = memo(function DbTableRow({
  row,
  depth,
  insertBeforeAfterId,
  columns,
  settings,
  selected,
  savingKey,
  vLines,
  notionDatabaseId,
  databaseTitle,
  properties,
  conversationId,
  childrenOf,
  expandedParents,
  onSelect,
  onToggleExpand,
  onSave,
  onDelete,
  onOpen,
  onCreateRow,
  onConvertLayout,
  rowBackground,
}: DbTableRowProps) {
  return (
    <tr
      className={cn(
        'group/row relative hover:bg-[#fafafa]',
        selected && 'bg-blue-50/50 ring-1 ring-inset ring-blue-200'
      )}
      style={{ background: selected ? undefined : rowBackground }}
      onClick={() => onSelect(row.id)}
    >
      {columns.map((prop, colIndex) => {
        const colW = columnWidthPx(prop, settings)
        return (
          <td
            key={prop.id}
            style={{ width: colW, maxWidth: colW, minWidth: 0 }}
            className={cn(
              'relative px-2 py-1 align-middle min-w-0 text-[13px]',
              colIndex === 0 ? 'overflow-visible' : 'overflow-hidden',
              vLines && colIndex < columns.length - 1 && 'border-r border-gray-200',
              selected && 'bg-blue-50/40',
              !settings.layoutOptions.wrapAllContent && 'tt-db-cell-nowrap whitespace-nowrap'
            )}
          >
            {colIndex === 0 ? (
              <div
                data-tt-db-gutter
                className="group/gutter absolute -left-5 top-0 bottom-0 z-[2] w-5"
              >
                <div className="absolute left-0 top-1/2 -translate-y-1/2">
                  <RowHandle
                    row={row}
                    selected={selected}
                    onSelect={() => onSelect(row.id)}
                    onDelete={() => onDelete(row.id)}
                    onOpen={() => onOpen(row)}
                    onDuplicate={() => onCreateRow(row.id)}
                    onConvertLayout={conversationId ? onConvertLayout : undefined}
                    dragPayload={{
                      source: 'notion-db-row',
                      notionDatabaseId,
                      row,
                      properties,
                      databaseTitle,
                    }}
                  />
                </div>
                <RowInsertBar edge="top" onAdd={() => onCreateRow(insertBeforeAfterId)} />
                <RowInsertBar edge="bottom" onAdd={() => onCreateRow(row.id)} />
              </div>
            ) : null}
            <div
              className={cn(
                'min-w-0 max-w-full overflow-hidden',
                !settings.layoutOptions.wrapAllContent && 'tt-db-cell-nowrap whitespace-nowrap'
              )}
            >
              {prop.type === 'title' &&
              settings.subTasks.enabled &&
              settings.subTasks.display === 'nested' ? (
                <div
                  className="flex items-center gap-0.5 min-w-0 max-w-full overflow-hidden"
                  style={depth ? { paddingLeft: depth * 16 } : undefined}
                >
                  {(() => {
                    const kids = childrenOf.get(row.id) || []
                    if (!kids.length) {
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
                          onToggleExpand(row.id)
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
    </tr>
  )
})

type VirtualizedTableBodyProps = {
  flatItems: FlatTableItem[]
  columns: NotionDbProperty[]
  settings: DatabaseViewSettings
  tablePixelWidth: number
  vLines: boolean
  selectedRowId: string | null
  savingKey: string | null
  notionDatabaseId: string
  databaseTitle: string
  properties: NotionDbProperty[]
  conversationId: string | null | undefined
  childrenOf: Map<string, NotionDbRow[]>
  expandedParents: Set<string>
  onSelect: (id: string) => void
  onToggleExpand: (id: string) => void
  onSave: SaveFn
  onDelete: (id: string) => void
  onOpen: (row: NotionDbRow) => void
  onCreateRow: (afterId: string | null) => void
  onConvertLayout?: (layout: DbConvertLayoutId, rowId: string) => void
  rowBackgroundFn: (row: NotionDbRow) => string | undefined
  scrollParentRef: React.RefObject<HTMLDivElement | null>
}

export function VirtualizedTableBody({
  flatItems,
  columns,
  settings,
  tablePixelWidth,
  vLines,
  selectedRowId,
  savingKey,
  notionDatabaseId,
  databaseTitle,
  properties,
  conversationId,
  childrenOf,
  expandedParents,
  onSelect,
  onToggleExpand,
  onSave,
  onDelete,
  onOpen,
  onCreateRow,
  onConvertLayout,
  rowBackgroundFn,
  scrollParentRef,
}: VirtualizedTableBodyProps) {
  const rowCount = flatItems.length
  const useCap = rowCount > DB_TABLE_VIRTUALIZE_MIN
  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: (i) =>
      flatItems[i]?.kind === 'group' ? DB_TABLE_ROW_HEIGHT + 4 : DB_TABLE_ROW_HEIGHT,
    overscan: 10,
  })
  useEffect(() => {
    const el = scrollParentRef.current
    if (!el || !useCap) return
    const ro = new ResizeObserver(() => virtualizer.measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollParentRef, useCap, virtualizer])
  const virtualRows = virtualizer.getVirtualItems()
  const paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start ?? 0 : 0
  const paddingBottom =
    virtualRows.length > 0
      ? virtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0

  const colSpan = Math.max(1, columns.length)

  if (!rowCount) {
    return (
      <tbody>
        <tr>
          <td
            colSpan={colSpan}
            className="relative overflow-visible px-2 py-2 text-sm text-gray-400"
          >
            <div className="absolute -left-5 top-1/2 -translate-y-1/2">
              <button
                type="button"
                className="flex h-5 w-5 items-center justify-center rounded text-blue-500 hover:bg-blue-50"
                title="Add row"
                onClick={() => onCreateRow(null)}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            No rows — click + to add
          </td>
        </tr>
      </tbody>
    )
  }

  return (
    <tbody>
      {useCap && paddingTop > 0 ? (
        <tr aria-hidden>
          <td colSpan={colSpan} style={{ height: paddingTop, padding: 0, border: 'none' }} />
        </tr>
      ) : null}
      {(useCap ? virtualRows : flatItems.map((_, i) => ({ index: i }))).map((vi) => {
        const index = vi.index
        const item = flatItems[index]
        if (!item) return null
        if (item.kind === 'group') {
          return (
            <tr key={`g:${item.key}`}>
              <td
                colSpan={colSpan}
                className="px-2 py-1 text-[12px] font-semibold text-gray-600 border-b border-gray-200"
              >
                {item.label}
                <span className="ml-2 font-normal text-gray-400">{item.count}</span>
              </td>
            </tr>
          )
        }
        return (
          <DbTableRow
            key={item.row.id}
            row={item.row}
            depth={item.depth}
            insertBeforeAfterId={item.insertBeforeAfterId}
            columns={columns}
            settings={settings}
            selected={selectedRowId === item.row.id}
            savingKey={savingKey}
            vLines={vLines}
            notionDatabaseId={notionDatabaseId}
            databaseTitle={databaseTitle}
            properties={properties}
            conversationId={conversationId}
            childrenOf={childrenOf}
            expandedParents={expandedParents}
            onSelect={onSelect}
            onToggleExpand={onToggleExpand}
            onSave={onSave}
            onDelete={onDelete}
            onOpen={onOpen}
            onCreateRow={onCreateRow}
            onConvertLayout={onConvertLayout}
            rowBackground={rowBackgroundFn(item.row)}
          />
        )
      })}
      {useCap && paddingBottom > 0 ? (
        <tr aria-hidden>
          <td colSpan={colSpan} style={{ height: paddingBottom, padding: 0, border: 'none' }} />
        </tr>
      ) : null}
    </tbody>
  )
}

export function VirtualizedListBody({
  rows,
  titleProp,
  columns,
  settings,
  rowBackgroundFn,
  scrollParentRef,
}: {
  rows: NotionDbRow[]
  titleProp?: NotionDbProperty
  columns: NotionDbProperty[]
  settings: DatabaseViewSettings
  rowBackgroundFn: (row: NotionDbRow) => string | undefined
  scrollParentRef: React.RefObject<HTMLDivElement | null>
}) {
  const useCap = rows.length > DB_TABLE_VIRTUALIZE_MIN
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => DB_TABLE_ROW_HEIGHT + 8,
    overscan: 8,
  })
  useEffect(() => {
    const el = scrollParentRef.current
    if (!el || !useCap) return
    const ro = new ResizeObserver(() => virtualizer.measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollParentRef, useCap, virtualizer])
  const virtualRows = virtualizer.getVirtualItems()
  const paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start ?? 0 : 0
  const paddingBottom =
    virtualRows.length > 0
      ? virtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0

  if (!rows.length) {
    return <div className="px-3 py-3 text-sm text-gray-400">No rows</div>
  }

  const renderRow = (row: NotionDbRow) => {
    const title = titleProp ? row.cells[titleProp.name]?.text || 'Untitled' : 'Untitled'
    return (
      <div
        key={row.id}
        className="flex items-center gap-2 px-3 py-2 hover:bg-[#fafafa] min-w-0 overflow-hidden"
        style={{ background: rowBackgroundFn(row) }}
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
  }

  if (!useCap) {
    return <div className="divide-y divide-gray-100 min-w-0 max-w-full overflow-hidden">{rows.map(renderRow)}</div>
  }

  return (
    <div className="relative divide-y divide-gray-100 min-w-0 max-w-full" style={{ height: virtualizer.getTotalSize() }}>
      {paddingTop > 0 ? <div style={{ height: paddingTop }} aria-hidden /> : null}
      {virtualRows.map((vi) => {
        const row = rows[vi.index]
        if (!row) return null
        return (
          <div
            key={row.id}
            className="absolute left-0 right-0"
            style={{ transform: `translateY(${vi.start}px)` }}
          >
            {renderRow(row)}
          </div>
        )
      })}
    </div>
  )
}

export function buildFlatTableItems(
  groups: Array<{ key: string; rows: NotionDbRow[] }>,
  settings: DatabaseViewSettings,
  subTaskTree: { roots: NotionDbRow[]; childrenOf: Map<string, NotionDbRow[]> },
  groupBy: string | null,
  expandedParents: Set<string>
): FlatTableItem[] {
  const out: FlatTableItem[] = []
  for (const g of groups) {
    if (groupBy && g.key) {
      out.push({
        kind: 'group',
        key: g.key,
        label: g.key,
        count: g.rows.length,
      })
    }
    const rows = g.rows
    const { roots, childrenOf } = settings.subTasks.enabled
      ? subTaskTree
      : { roots: rows, childrenOf: new Map<string, NotionDbRow[]>() }
    const flat: Array<{ row: NotionDbRow; depth: number }> = []
    if (settings.subTasks.enabled && settings.subTasks.display === 'flat') {
      for (const row of rows) flat.push({ row, depth: 0 })
    } else {
      const walk = (row: NotionDbRow, depth: number) => {
        flat.push({ row, depth })
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
    for (let i = 0; i < flat.length; i++) {
      const insertBeforeAfterId = i === 0 ? null : flat[i - 1].row.id
      out.push({
        kind: 'row',
        row: flat[i].row,
        depth: flat[i].depth,
        insertBeforeAfterId,
      })
    }
  }
  return out
}
