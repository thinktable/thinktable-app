'use client'

// Lightweight Notion DB shell when the table is not the focus-gated live instance.
// Same shared react-query cache as the live table — no second Notion fetch.
// Read-only DOM (no virtualizer, editors, or row menus) so pan/zoom stays cheap.

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Hash, List, Loader2, Type } from 'lucide-react'
import {
  NOTION_DB_CLIENT_ROW_CAP,
  NOTION_DB_CLIENT_ROW_PAGE,
  type NotionDatabaseTable,
} from '@/lib/notion/database'
import { columnWidthPx, normalizeViewSettings, parseViewSettings, visibleProperties } from '@/lib/notion/database-view'
import { CellDisplay, ChunkedRowGroups } from '@/components/notion-db-virtual-body'
import { cn } from '@/lib/utils'

const ROW_GUTTER = 20
const COMPACT_PREVIEW_ROWS = 12 // Idle unselected — not the full table

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
  /** Preserve last live box so swap does not hug-collapse mid-pan. */
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

  const columns = visibleProperties(data.properties, settings)
  const visibleCols = columns.slice(0, compact ? 8 : 16)
  const rowCap = compact ? COMPACT_PREVIEW_ROWS : NOTION_DB_CLIENT_ROW_CAP
  const rows = data.rows.slice(0, rowCap)
  const tablePixelWidth = visibleCols.reduce((sum, prop) => sum + columnWidthPx(prop, settings), 0)
  const vLines = settings.layoutOptions.showVerticalLines
  const extra = Math.max(0, data.rows.length - rows.length) + (data.rowsHasMore ? 1 : 0)

  const renderRow = (row: (typeof rows)[number]) => (
    <tr key={row.id} className="border-b border-gray-100">
      {visibleCols.map((prop, colIndex) => {
        const colW = columnWidthPx(prop, settings)
        return (
          <td
            key={prop.id}
            style={{ width: colW, maxWidth: colW, minWidth: 0 }}
            className={cn(
              'overflow-hidden whitespace-nowrap px-2 py-1 text-[13px] align-middle',
              vLines && colIndex < visibleCols.length - 1 && 'border-r border-gray-200'
            )}
          >
            <CellDisplay
              prop={prop}
              cell={row.cells[prop.name]}
              rowIcon={colIndex === 0 ? row.icon : null}
            />
          </td>
        )
      })}
    </tr>
  )

  return (
    <div
      className={cn(
        'tt-notion-db tt-notion-db-static nokey pointer-events-none select-none overflow-hidden',
        frameSelected && 'nodrag',
        className
      )}
      style={{ minWidth: minWidth ?? Math.min(tablePixelWidth + ROW_GUTTER, 720), minHeight }}
      aria-hidden
      data-tt-db-static
    >
      <div className="relative overflow-hidden" style={{ paddingLeft: ROW_GUTTER }}>
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
          {compact ? (
            <tbody>{rows.map(renderRow)}</tbody>
          ) : (
            // Always-expanded frames can be hundreds of rows; window them the same way the live
            // table does so showing the whole table stays as cheap as the 12-row slice.
            <ChunkedRowGroups
              count={rows.length}
              colSpan={visibleCols.length}
              renderRange={(start, end) => rows.slice(start, end).map(renderRow)}
            />
          )}
        </table>
      </div>
      {extra > 0 ? (
        <div className="px-3 py-1 text-[11px] text-gray-400">
          +{data.rowsHasMore ? `${extra}+` : extra} more — select to expand
        </div>
      ) : null}
    </div>
  )
}
