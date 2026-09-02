'use client'

// Lightweight Notion DB shell when the table is not the focus-gated live instance.
// Same shared react-query cache as the live table — no second Notion fetch.
// Read-only DOM (no virtualizer, editors, or row menus) so pan/zoom stays cheap.

import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Hash, List, Loader2, Type } from 'lucide-react'
import {
  isNotionPropertyEditable,
  NOTION_DB_CLIENT_ROW_CAP,
  NOTION_DB_CLIENT_ROW_PAGE,
  type NotionDatabaseTable,
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
  caretIndexFromColdClick,
  useVisibleColumnRange,
} from '@/components/notion-db-virtual-body'
import { useNotionDbCellSave } from '@/lib/notion/use-notion-db-cell-save'
import { cn } from '@/lib/utils'

const ROW_GUTTER = 20
/** Idle preview slice before the first "show more" click. */
export const COMPACT_PREVIEW_ROWS = 12

/** Footer copy for paged reveal (50 rows per click). Use a stable page size when the server still
 *  has more — do not advertise the full shared-cache remainder (another copy's fetch would change it). */
export function formatShowMoreLabel(hiddenLoaded: number, rowsHasMore: boolean): string {
  if (rowsHasMore) return `+${NOTION_DB_CLIENT_ROW_PAGE} more — click to show more`
  if (hiddenLoaded > 0) return `+${hiddenLoaded} more — click to show more`
  return `click to show more`
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
  /** Frame already selected: row click warms the live table for that row only. */
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
  const visibleCols = useMemo(() => columns.slice(0, compact ? 8 : 16), [columns, compact])
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
  // Reveal more only while under the client cap (Expanded at CAP with server leftovers hides this).
  const showMoreFooter =
    hiddenLoaded > 0 || (!!data.rowsHasMore && rows.length < NOTION_DB_CLIENT_ROW_CAP)
  // Still window when painting a large expanded slice; small caps paint in one tbody.
  const useChunkedRows = !completePaint && effectiveCap > COMPACT_PREVIEW_ROWS

  const renderRow = (row: (typeof rows)[number]) => {
    if (warmRowId === row.id) {
      return (
        <DbTableRow
          key={`${row.id}:${warmEpoch}`}
          row={row}
          depth={0}
          insertBeforeAfterId={null}
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
          onCreateRow={() => {}}
          rowBackground={rowBgFn(row)}
          hydrated
          onHover={() => {}}
          onActivate={setActiveRowId}
          colRange={colRangeBand}
          armColumnIndex={armColumnIndex}
          armCaretIndex={warmCaretIndex}
        />
      )
    }
    return (
    <tr
      key={row.id}
      className={cn(
        'border-b border-gray-100',
        // Row hit-target only while the host wants engage — keeps unselected/pan drag free.
        onRowEngage && 'nodrag nopan pointer-events-auto cursor-text hover:bg-[#fafafa]'
      )}
      onPointerDown={
        onRowEngage
          ? (e) => {
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
              'relative px-2 py-1 align-middle min-w-0 text-[13px] overflow-hidden whitespace-nowrap',
              vLines && colIndex < visibleCols.length - 1 && 'border-r border-gray-200'
            )}
          >
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
      style={{ minWidth: minWidth ?? Math.min(tablePixelWidth + ROW_GUTTER, 720), minHeight }}
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
            <tbody>{rows.map(renderRow)}</tbody>
          ) : (
            // Larger paged slices window like the live table.
            <ChunkedRowGroups
              count={rows.length}
              colSpan={visibleCols.length}
              renderRange={(start, end) => rows.slice(start, end).map(renderRow)}
            />
          )}
        </table>
      </div>
      {showMoreFooter ? (
        <button
          type="button"
          className="nodrag nopan pointer-events-auto px-3 py-1 text-[11px] text-gray-400 hover:text-blue-600 text-left w-full"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onShowMore?.()
          }}
        >
          {formatShowMoreLabel(hiddenLoaded, !!data.rowsHasMore)}
        </button>
      ) : null}
    </div>
  )
}
