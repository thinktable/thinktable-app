'use client'

// Editable Notion database with Thinktable view settings (layout / filter / sort / group / color / sub-tasks).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Hash, List, Loader2, Type } from 'lucide-react'
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
  applyViewRows,
  buildSubTaskTree,
  groupRows,
  normalizeViewSettings,
  parseViewSettings,
  rowBackground,
  visibleProperties,
  type DatabaseViewSettings,
} from '@/lib/notion/database-view'
import { DatabaseViewToolbar } from '@/components/database-view-settings'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

type NotionDatabaseTableViewProps = {
  notionDatabaseId: string // Notion DB UUID to load
  fallbackTitle?: string // Attr title while loading
  className?: string
  viewSettingsJson?: string | null // Persisted TipTap attr
  onViewSettingsChange?: (json: string) => void // Persist back to databaseBlock
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
      <span className="inline-flex items-center gap-1.5 min-w-0 font-medium text-[13px] text-gray-900">
        {rowIcon ? <span className="flex-shrink-0 leading-none">{rowIcon}</span> : null}
        <span className="truncate">{cell?.text || 'Untitled'}</span>
      </span>
    )
  }
  return (
    <span className="truncate text-[13px] text-gray-700 tabular-nums">
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
          'w-full min-h-[28px] text-left rounded px-0.5 -mx-0.5 hover:bg-black/[0.04]',
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
}: NotionDatabaseTableViewProps) {
  const [data, setData] = useState<NotionDatabaseTable | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [settings, setSettings] = useState<DatabaseViewSettings>(() =>
    normalizeViewSettings(parseViewSettings(viewSettingsJson), [])
  )
  const [expandedParents, setExpandedParents] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const res = await fetch(`/api/notion/database/${encodeURIComponent(notionDatabaseId)}`)
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Failed to load database')
        if (!cancelled) {
          const table = json as NotionDatabaseTable
          setData(table)
          setSettings(normalizeViewSettings(parseViewSettings(viewSettingsJson), table.properties))
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load database')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [notionDatabaseId]) // eslint-disable-line react-hooks/exhaustive-deps -- reload on id only

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
      setData((prev) => {
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
        try {
          const res = await fetch(`/api/notion/database/${encodeURIComponent(notionDatabaseId)}`)
          const json = await res.json()
          if (res.ok) setData(json as NotionDatabaseTable)
        } catch {
          /* keep optimistic */
        }
      } finally {
        setSavingKey(null)
      }
    },
    [data?.properties, notionDatabaseId]
  )

  const columns = useMemo(
    () => (data ? visibleProperties(data.properties, settings) : []),
    [data, settings]
  )
  const filteredRows = useMemo(
    () => (data ? applyViewRows(data.rows, settings) : []),
    [data, settings]
  )
  const groups = useMemo(
    () => groupRows(filteredRows, settings.groupBy),
    [filteredRows, settings.groupBy]
  )

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 py-3 text-sm text-gray-500', className)}>
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading {fallbackTitle || 'database'}…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className={cn('py-2 text-sm text-red-600', className)}>
        {error || 'Database unavailable'}
      </div>
    )
  }

  const titleProp = data.properties.find((p) => p.type === 'title')

  const renderRowCells = (row: NotionDbRow, depth = 0) => (
    <>
      {columns.map((prop, colIndex) => (
        <td
          key={prop.id}
          className={cn(
            'px-2 py-1.5 align-middle max-w-[220px]',
            prop.type === 'title' && 'min-w-[180px]',
            settings.layoutOptions.showVerticalLines && 'border-r border-gray-100'
          )}
          style={colIndex === 0 && depth ? { paddingLeft: 8 + depth * 16 } : undefined}
        >
          {prop.type === 'title' && settings.subTasks.enabled && depth === 0 ? (
            <div className="flex items-center gap-0.5">
              {(() => {
                const { childrenOf } = buildSubTaskTree(
                  filteredRows,
                  settings.subTasks.relationProperty
                )
                const kids = childrenOf.get(row.id) || []
                if (!kids.length) return <span className="w-4" />
                const open = expandedParents.has(row.id)
                return (
                  <button
                    type="button"
                    className="p-0.5 text-gray-400"
                    onClick={() => {
                      setExpandedParents((prev) => {
                        const next = new Set(prev)
                        if (next.has(row.id)) next.delete(row.id)
                        else next.add(row.id)
                        return next
                      })
                    }}
                  >
                    {open ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
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
        </td>
      ))}
    </>
  )

  const renderTableBody = (rows: NotionDbRow[]) => {
    if (!rows.length) {
      return (
        <tr>
          <td colSpan={Math.max(1, columns.length)} className="px-2 py-3 text-sm text-gray-400">
            No rows
          </td>
        </tr>
      )
    }
    const { roots, childrenOf } = settings.subTasks.enabled
      ? buildSubTaskTree(rows, settings.subTasks.relationProperty)
      : { roots: rows, childrenOf: new Map<string, NotionDbRow[]>() }
    const out: React.ReactNode[] = []
    const walk = (row: NotionDbRow, depth: number) => {
      out.push(
        <tr
          key={row.id}
          className="border-b border-gray-100 hover:bg-[#fafafa]"
          style={{ background: rowBackground(row, settings.conditionalColors) }}
        >
          {renderRowCells(row, depth)}
        </tr>
      )
      if (
        settings.subTasks.enabled &&
        settings.subTasks.display === 'nested' &&
        expandedParents.has(row.id)
      ) {
        for (const child of childrenOf.get(row.id) || []) walk(child, depth + 1)
      }
    }
    for (const row of settings.subTasks.enabled ? roots : rows) walk(row, 0)
    return out
  }

  const tableLayout = (
    <table
      className={cn(
        'w-full border-collapse text-left',
        settings.layoutOptions.wrapAllContent ? '' : 'whitespace-nowrap'
      )}
    >
      <thead>
        <tr className="border-b border-gray-200 bg-[#f7f6f3]">
          {columns.map((prop) => (
            <th
              key={prop.id}
              className={cn(
                'sticky top-0 z-[1] whitespace-nowrap px-2 py-1.5 text-[12px] font-medium text-gray-500 bg-[#f7f6f3]',
                settings.layoutOptions.showVerticalLines && 'border-r border-gray-200'
              )}
            >
              <span className="inline-flex items-center gap-1">
                <PropertyTypeIcon type={prop.type} />
                {prop.name}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <FragmentGroup key={g.key || '__all'}>
            {settings.groupBy && g.key ? (
              <tr className="bg-gray-50">
                <td
                  colSpan={Math.max(1, columns.length)}
                  className="px-2 py-1.5 text-[12px] font-semibold text-gray-600"
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
  )

  const listLayout = (
    <div className="divide-y divide-gray-100">
      {filteredRows.length === 0 ? (
        <div className="px-3 py-3 text-sm text-gray-400">No rows</div>
      ) : (
        filteredRows.map((row) => {
          const title = titleProp ? row.cells[titleProp.name]?.text || 'Untitled' : 'Untitled'
          return (
            <div
              key={row.id}
              className="flex items-center gap-2 px-3 py-2 hover:bg-[#fafafa]"
              style={{ background: rowBackground(row, settings.conditionalColors) }}
            >
              {settings.layoutOptions.showPageIcon && row.icon ? (
                <span className="leading-none">{row.icon}</span>
              ) : null}
              <span className="text-[13px] font-medium truncate flex-1">{title}</span>
              {columns
                .filter((c) => c.type !== 'title')
                .slice(0, 3)
                .map((prop) => (
                  <span key={prop.id} className="text-[12px] text-gray-500 max-w-[120px] truncate">
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

  return (
    <div
      className={cn(
        'tt-notion-db nodrag nokey',
        'w-full min-w-[420px] max-w-full overflow-auto rounded-md border border-gray-200 bg-white',
        className
      )}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {settings.layoutOptions.showDataSourceTitle ? (
        <div className="px-2 pt-2 text-[12px] font-medium text-gray-500 truncate">
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
    </div>
  )
}

/** Tiny helper so grouped table sections don't need Fragment import noise. */
function FragmentGroup({ children }: { children: ReactNode }) {
  return <>{children}</>
}
