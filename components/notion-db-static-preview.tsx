'use client'

// Lightweight Notion DB shell when the table is not the focus-gated live instance.
// Same shared react-query cache as the live table — no second Notion fetch.
// Read-only DOM (no virtualizer, editors, or row menus) so pan/zoom stays cheap.

import { useCallback, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Hash, List, Loader2, Type } from 'lucide-react'
import {
  isNotionPropertyEditable,
  COMPACT_PREVIEW_ROWS,
  NOTION_DB_CLIENT_ROW_CAP,
  NOTION_DB_CLIENT_ROW_PAGE,
  type NotionDatabaseTable,
  type NotionDbCell,
  type NotionDbRow,
} from '@/lib/notion/database'
import {
  columnWidthPx,
  normalizeViewSettings,
  parseViewSettings,
  rowBackground,
  visibleProperties,
} from '@/lib/notion/database-view'
import {
  CellDisplay,
  ChunkedRowGroups,
  DbTableRow,
  RowHandle,
  RowInsertBar,
  caretIndexFromColdClick,
  useVisibleColumnRange,
} from '@/components/notion-db-virtual-body'
import { useNotionDbCellSave } from '@/lib/notion/use-notion-db-cell-save'
import { cn } from '@/lib/utils'

const ROW_GUTTER = 20
/** Re-export for callers that imported the idle floor from this module. */
export { COMPACT_PREVIEW_ROWS } from '@/lib/notion/database'

/** Remaining-row count for the footer. Prefer a stable page size while the server still has more —
 *  do not advertise the full shared-cache remainder (another copy's fetch would change it). */
export function remainingRowsCount(hiddenLoaded: number, rowsHasMore: boolean): number {
  if (rowsHasMore) return NOTION_DB_CLIENT_ROW_PAGE // Next page size, not sibling-cache leftovers
  return Math.max(0, hiddenLoaded) // Loaded but still capped on this frame
}

/** Dual-action footer: `+# rows — show more / show less`. */
export function DbRowsRevealFooter({
  hiddenLoaded,
  rowsHasMore,
  canShowMore,
  canShowLess,
  onShowMore,
  onShowLess,
  className,
}: {
  hiddenLoaded: number
  rowsHasMore: boolean
  canShowMore: boolean
  canShowLess: boolean
  onShowMore?: () => void
  onShowLess?: () => void
  className?: string
}) {
  const remaining = remainingRowsCount(hiddenLoaded, rowsHasMore) // Count shown before the em dash
  return (
    <div
      className={cn(
        'nodrag nopan pointer-events-auto px-3 py-1 text-[11px] text-gray-400 text-left w-full',
        className
      )}
      onPointerDown={(e) => e.stopPropagation()} // Keep RF from starting a frame drag
    >
      {remaining > 0 ? `+${remaining} rows — ` : null}
      <button
        type="button"
        className={cn(
          'hover:text-blue-600 disabled:hover:text-gray-400 disabled:opacity-40 disabled:cursor-default'
        )}
        disabled={!canShowMore || !onShowMore}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          if (canShowMore) onShowMore?.()
        }}
      >
        show more
      </button>
      <span aria-hidden="true"> / </span>
      <button
        type="button"
        className={cn(
          'hover:text-blue-600 disabled:hover:text-gray-400 disabled:opacity-40 disabled:cursor-default'
        )}
        disabled={!canShowLess || !onShowLess}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          if (canShowLess) onShowLess?.()
        }}
      >
        show less
      </button>
    </div>
  )
}

function PropertyTypeIcon({ type }: { type: string }) {
  if (type === 'checkbox') return <Check className="h-3 w-3 opacity-50" aria-hidden />
  if (type === 'number') return <Hash className="h-3 w-3 opacity-50" aria-hidden />
  if (type === 'select' || type === 'multi_select' || type === 'status') {
    return <List className="h-3 w-3 opacity-50" aria-hidden />
  }
  return <Type className="h-3 w-3 opacity-50" aria-hidden />
}

export function NotionDbStaticPreview({
  notionDatabaseId,
  fallbackTitle,
  viewSettingsJson,
  className,
  frameSelected = false,
  compact = true,
  /** Paint every row/column (no IO windowing) so an idle TipTap snapshot is complete. */
  completePaint = false,
  /** How many rows to paint (Preview pages this; Expanded uses the full cap). */
  rowCap,
  /** Reveal the next page of rows — parent owns the cap. */
  onShowMore,
  /** Collapse one page toward the compact preview — parent owns the cap. */
  onShowLess,
  /** Frame already selected: row click warms that row (and can switch to another while warm). */
  onRowEngage,
  warmRowId = null,
  warmColIndex = null,
  warmCaretIndex = null,
  warmEpoch = 0,
  conversationId = null,
  minWidth,
  minHeight,
}: {
  notionDatabaseId: string
  fallbackTitle?: string
  viewSettingsJson?: string | null
  className?: string
  frameSelected?: boolean
  /** Idle: few rows. Pan freeze: all cached rows inside lastBox. */
  compact?: boolean
  completePaint?: boolean
  rowCap?: number
  onShowMore?: () => void
  /** Collapse one page toward the compact preview — parent owns the cap. */
  onShowLess?: () => void
  /** Row + column + caret from static preview — seeds warm row + I-bar. */
  onRowEngage?: (
    rowId: string,
    colIndex: number,
    detail: { clientX: number; clientY: number; caretIndex: number }
  ) => void
  warmRowId?: string | null
  warmColIndex?: number | null
  /** Character offset from the cold-cell click. */
  warmCaretIndex?: number | null
  /** Bumps when engage retargets so the armed editor remounts. */
  warmEpoch?: number
  conversationId?: string | null
  minWidth?: number
  minHeight?: number
}) {
  const tableQueryKey = useMemo(
    () => ['notion-database', notionDatabaseId] as const,
    [notionDatabaseId]
  )
  const queryClient = useQueryClient()
  const { data, isPending } = useQuery({
    queryKey: tableQueryKey,
    queryFn: async (): Promise<NotionDatabaseTable> => {
      const url = new URL(
        `/api/notion/database/${encodeURIComponent(notionDatabaseId)}`,
        typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
      )
      url.searchParams.set('limit', String(NOTION_DB_CLIENT_ROW_PAGE))
      const res = await fetch(url.toString())
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((json as { error?: string }).error || 'Failed to load database')
      return json as NotionDatabaseTable
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false, // Idle preview — live table owns refocus refresh
  })

  const settings = useMemo(
    () => normalizeViewSettings(parseViewSettings(viewSettingsJson), data?.properties ?? []),
    [viewSettingsJson, data?.properties]
  )

  // Columns must be derived before the loading/empty returns below, because the windowing hook cannot
  // sit after a conditional return. An expanded preview is the whole table, so it pays the same
  // all-columns cost the live table used to — window it with the same probes.
  const columns = useMemo(
    () => visibleProperties(data?.properties ?? [], settings),
    [data?.properties, settings]
  )
  // All view-visible columns — never hard-slice (that cut off properties past col 8/16).
  const visibleCols = columns
  // Hooks cannot sit behind `completePaint` — call the windowing hook always, ignore it when complete.
  const { colRange, columnProbes } = useVisibleColumnRange(visibleCols, settings)
  const colStart = completePaint ? 0 : colRange ? Math.max(0, colRange.start) : 0
  const colEnd = completePaint
    ? visibleCols.length - 1
    : colRange
      ? Math.min(visibleCols.length - 1, colRange.end)
      : visibleCols.length - 1
  const showColumnProbes = !completePaint
  const { onSave, savingKey } = useNotionDbCellSave(notionDatabaseId, data?.properties)
  const [, setActiveRowId] = useState<string | null>(warmRowId)
  // One cold-row handle at a time — avoid N RowHandle mounts on idle expanded tables.
  // Keep mounted while its portal menu is open (pointer leaves the row into the menu).
  const [hoverRowId, setHoverRowId] = useState<string | null>(null)
  const [menuRowId, setMenuRowId] = useState<string | null>(null)
  const coldHandleRowId = hoverRowId ?? menuRowId
  const onColdMenuOpenChange = useCallback((rowId: string, open: boolean) => {
    setMenuRowId(open ? rowId : null)
  }, [])
  const rowBusyRef = useRef(false)
  /** POST a Notion page and splice it into the shared react-query cache (cold + warm chrome). */
  const createRow = useCallback(
    async (afterId: string | null) => {
      if (rowBusyRef.current) return
      rowBusyRef.current = true
      try {
        const res = await fetch(`/api/notion/database/${encodeURIComponent(notionDatabaseId)}`, {
          method: 'POST',
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error((json as { error?: string }).error || 'Failed to add row')
        const row = (json as { row: NotionDbRow }).row
        const props =
          queryClient.getQueryData<NotionDatabaseTable>(tableQueryKey)?.properties ?? []
        const cells: Record<string, NotionDbCell> = { ...row.cells }
        for (const prop of props) {
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
        queryClient.setQueryData<NotionDatabaseTable>(tableQueryKey, (prev) => {
          if (!prev) return prev
          const next = [...prev.rows]
          if (afterId == null) next.unshift(fullRow)
          else {
            const i = next.findIndex((r) => r.id === afterId)
            if (i >= 0) next.splice(i + 1, 0, fullRow)
            else next.push(fullRow)
          }
          return { ...prev, rows: next }
        })
      } catch (e) {
        console.error('Add row failed:', e)
      } finally {
        rowBusyRef.current = false
      }
    },
    [notionDatabaseId, queryClient, tableQueryKey]
  )
  const armColumnIndex = useMemo(() => {
    if (warmColIndex == null || !warmRowId) return null
    const prop = visibleCols[warmColIndex]
    if (prop && isNotionPropertyEditable(prop.type)) return warmColIndex
    for (let i = colStart; i <= colEnd; i++) {
      if (isNotionPropertyEditable(visibleCols[i]?.type)) return i
    }
    return warmColIndex
  }, [warmColIndex, warmRowId, visibleCols, colStart, colEnd])
  const colRangeBand = useMemo(() => ({ start: colStart, end: colEnd }), [colStart, colEnd])
  const openRow = useCallback((row: NotionDbRow) => {
    const url = row.url || `https://www.notion.so/${String(row.id).replace(/-/g, '')}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])
  const rowBgFn = useCallback(
    (row: NotionDbRow) => rowBackground(row, settings.conditionalColors),
    [settings.conditionalColors]
  )

  if (isPending && !data) {
    return (
      <div
        className={cn(
          'tt-notion-db tt-notion-db-static nokey flex items-center gap-2 py-3 text-sm text-gray-500 min-w-[420px] min-h-[120px]',
          frameSelected && 'nodrag',
          className
        )}
        style={{ minWidth, minHeight }}
        aria-busy
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading {fallbackTitle || 'database'}…
      </div>
    )
  }

  if (!data) {
    return (
      <div
        className={cn(
          'tt-notion-db tt-notion-db-static nokey min-w-[420px] min-h-[120px] tt-frame-shimmer rounded-sm',
          className
        )}
        style={{ minWidth, minHeight }}
        aria-hidden
      />
    )
  }

  const effectiveCap = rowCap ?? (compact ? COMPACT_PREVIEW_ROWS : NOTION_DB_CLIENT_ROW_CAP)
  const rows = data.rows.slice(0, effectiveCap)
  const tablePixelWidth = visibleCols.reduce((sum, prop) => sum + columnWidthPx(prop, settings), 0)
  const vLines = settings.layoutOptions.showVerticalLines
  const hiddenLoaded = Math.max(0, data.rows.length - rows.length)
  // Show-more while under the client cap; show-less once past the compact preview.
  const canShowMore =
    hiddenLoaded > 0 || (!!data.rowsHasMore && rows.length < NOTION_DB_CLIENT_ROW_CAP)
  const canShowLess = effectiveCap > COMPACT_PREVIEW_ROWS
  const showRevealFooter = canShowMore || canShowLess
  // Still window when painting a large expanded slice; small caps paint in one tbody.
  const useChunkedRows = !completePaint && effectiveCap > COMPACT_PREVIEW_ROWS

  const renderRow = (row: (typeof rows)[number], rowIndex: number) => {
    // Top insert line places after the previous painted row (null = above first).
    const insertBeforeAfterId = rowIndex > 0 ? rows[rowIndex - 1]!.id : null
    if (warmRowId === row.id) {
      return (
        <DbTableRow
          key={`${row.id}:${warmEpoch}`}
          row={row}
          depth={0}
          insertBeforeAfterId={insertBeforeAfterId}
          columns={visibleCols}
          settings={settings}
          selected
          savingKey={savingKey}
          vLines={vLines}
          notionDatabaseId={notionDatabaseId}
          databaseTitle={data.title || fallbackTitle || 'Untitled database'}
          properties={data.properties}
          conversationId={conversationId}
          childrenOf={new Map()}
          expandedParents={new Set()}
          onSelect={() => {}}
          onToggleExpand={() => {}}
          onSave={onSave}
          onDelete={() => {}}
          onOpen={openRow}
          onCreateRow={(afterId) => void createRow(afterId)}
          rowBackground={rowBgFn(row)}
          hydrated
          onHover={setHoverRowId}
          onActivate={setActiveRowId}
          colRange={colRangeBand}
          armColumnIndex={armColumnIndex}
          armCaretIndex={warmCaretIndex}
        />
      )
    }
    // Cold row: ⋮⋮ + add-row lines on hover (no cell editors). One gutter mount at a time.
    const showColdHandle = !!onRowEngage && coldHandleRowId === row.id
    return (
    <tr
      key={row.id}
      className={cn(
        'group/row border-b border-gray-100',
        // Row hit-target only while the host wants engage — keeps unselected/pan drag free.
        onRowEngage && 'nodrag nopan pointer-events-auto cursor-text hover:bg-[#fafafa]'
      )}
      onPointerEnter={onRowEngage ? () => setHoverRowId(row.id) : undefined}
      onPointerLeave={onRowEngage ? () => setHoverRowId(null) : undefined}
      onPointerDown={
        onRowEngage
          ? (e) => {
              // Gutter/handle/insert own their gesture — don't warm the row for chrome clicks.
              if ((e.target as HTMLElement).closest?.('[data-tt-db-gutter], [data-tt-db-insert]')) {
                return
              }
              // preventDefault suppresses the trailing click that would focus TipTap and unplace the I-bar.
              e.preventDefault()
              e.stopPropagation()
              const td = (e.target as HTMLElement).closest('td')
              let colIndex = colStart
              if (td?.parentElement) {
                const cells = Array.from(td.parentElement.children).filter(
                  (c) => c.tagName === 'TD' && !(c as HTMLElement).getAttribute('aria-hidden')
                )
                const ti = cells.indexOf(td as HTMLTableCellElement)
                if (ti >= 0) colIndex = colStart + ti
              }
              const prop = visibleCols[colIndex]
              const value = (prop && row.cells[prop.name]?.text) || ''
              // Prefer the text span (skips title-column emoji) so caret index matches the input value.
              const root =
                (td?.querySelector('span.min-w-0.truncate') as HTMLElement | null) ||
                td ||
                (e.currentTarget as HTMLElement)
              const caretIndex = caretIndexFromColdClick(e.clientX, e.clientY, root, value)
              onRowEngage(row.id, colIndex, {
                clientX: e.clientX,
                clientY: e.clientY,
                caretIndex,
              })
            }
          : undefined
      }
      onClick={
        onRowEngage
          ? (e) => {
              e.preventDefault()
              e.stopPropagation()
            }
          : undefined
      }
    >
      {colStart > 0 ? (
        <td colSpan={colStart} style={{ padding: 0, border: 'none' }} aria-hidden />
      ) : null}
      {visibleCols.slice(colStart, colEnd + 1).map((prop, i) => {
        const colIndex = colStart + i
        const colW = columnWidthPx(prop, settings)
        return (
          <td
            key={prop.id}
            style={{ width: colW, maxWidth: colW, minWidth: 0 }}
            className={cn(
              // Same box as live `DbTableRow` + `StaticCell` so idle TipTap (and its snapshot) match warm.
              // First cell overflow-visible so cold ⋮⋮ can sit in the left gutter.
              'relative px-2 py-1 align-middle min-w-0 text-[13px] whitespace-nowrap',
              colIndex === 0 ? 'overflow-visible' : 'overflow-hidden',
              vLines && colIndex < visibleCols.length - 1 && 'border-r border-gray-200'
            )}
          >
            {colIndex === 0 && showColdHandle ? (
              <div
                data-tt-db-gutter
                className="group/gutter absolute -left-5 top-0 bottom-0 z-[2] w-5 pointer-events-auto"
              >
                <div className="absolute left-0 top-1/2 -translate-y-1/2">
                  <RowHandle
                    row={row}
                    selected={false}
                    onSelect={() => {}}
                    onDelete={() => {}}
                    onOpen={() => openRow(row)}
                    onDuplicate={() => void createRow(row.id)}
                    onMenuOpenChange={(open) => onColdMenuOpenChange(row.id, open)}
                    dragPayload={{
                      source: 'notion-db-row',
                      notionDatabaseId,
                      row,
                      properties: data.properties,
                      databaseTitle: data.title || fallbackTitle || 'Untitled database',
                    }}
                  />
                </div>
                <RowInsertBar edge="top" onAdd={() => void createRow(insertBeforeAfterId)} />
                <RowInsertBar edge="bottom" onAdd={() => void createRow(row.id)} />
              </div>
            ) : null}
            <div className="min-h-[28px] w-full min-w-0 max-w-full overflow-hidden">
              <CellDisplay
                prop={prop}
                cell={row.cells[prop.name]}
                rowIcon={colIndex === 0 ? row.icon : null}
              />
            </div>
          </td>
        )
      })}
      {colEnd < visibleCols.length - 1 ? (
        <td colSpan={visibleCols.length - 1 - colEnd} style={{ padding: 0, border: 'none' }} aria-hidden />
      ) : null}
    </tr>
    )
  }

  return (
    <div
      className={cn(
        'tt-notion-db tt-notion-db-static nokey pointer-events-none select-none overflow-hidden',
        frameSelected && 'nodrag',
        className
      )}
      style={{ minWidth: minWidth ?? tablePixelWidth + ROW_GUTTER, minHeight }}
      aria-hidden={warmRowId ? undefined : true}
      data-tt-db-static
      data-tt-db-row-warm={warmRowId ? 'true' : undefined}
    >
      <div className="relative overflow-hidden" style={{ paddingLeft: ROW_GUTTER }}>
        {showColumnProbes ? columnProbes : null}
        <table
          className="border-separate border-spacing-0 text-left border-0"
          style={{ width: tablePixelWidth, tableLayout: 'fixed' }}
        >
          <thead>
            <tr className="border-b border-gray-200">
              {visibleCols.map((prop, colIndex) => {
                const colW = columnWidthPx(prop, settings)
                return (
                  <th
                    key={prop.id}
                    style={{ width: colW, maxWidth: colW, minWidth: 0 }}
                    className={cn(
                      'overflow-hidden whitespace-nowrap px-2 py-1 text-[12px] font-medium text-gray-500',
                      vLines && colIndex < visibleCols.length - 1 && 'border-r border-gray-200'
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
          {completePaint || !useChunkedRows ? (
            // Small caps / snapshot paint: every visible row in one tbody.
            <tbody>{rows.map((row, i) => renderRow(row, i))}</tbody>
          ) : (
            // Larger paged slices window like the live table.
            <ChunkedRowGroups
              count={rows.length}
              colSpan={visibleCols.length}
              renderRange={(start, end) =>
                rows.slice(start, end).map((row, i) => renderRow(row, start + i))
              }
            />
          )}
        </table>
      </div>
      {showRevealFooter ? (
        <DbRowsRevealFooter
          hiddenLoaded={hiddenLoaded}
          rowsHasMore={!!data.rowsHasMore}
          canShowMore={canShowMore}
          canShowLess={canShowLess}
          onShowMore={onShowMore}
          onShowLess={onShowLess}
        />
      ) : null}
    </div>
  )
}
