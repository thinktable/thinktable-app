'use client'

// Notion-like structured database table (columns + typed cells) for databaseBlock frames.

import { useEffect, useState } from 'react'
import { Check, Hash, List, Loader2, Type } from 'lucide-react'
import {
  notionSelectColor,
  type NotionDatabaseTable,
  type NotionDbProperty,
} from '@/lib/notion/database'
import { cn } from '@/lib/utils'

type NotionDatabaseTableViewProps = {
  notionDatabaseId: string // Notion DB UUID to load
  fallbackTitle?: string // Attr title while loading
  className?: string
}

/** Column-type icon like Notion’s property headers. */
function PropertyTypeIcon({ type }: { type: string }) {
  if (type === 'checkbox') return <Check className="h-3 w-3 opacity-50" aria-hidden />
  if (type === 'number') return <Hash className="h-3 w-3 opacity-50" aria-hidden />
  if (type === 'select' || type === 'multi_select' || type === 'status') {
    return <List className="h-3 w-3 opacity-50" aria-hidden />
  }
  return <Type className="h-3 w-3 opacity-50" aria-hidden /> // title / text / default
}

/** One select / multi-select pill. */
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

/** Render a single cell by property type. */
function CellContent({
  prop,
  cell,
  rowIcon,
}: {
  prop: NotionDbProperty
  cell?: { type: string; text?: string; checked?: boolean; tags?: Array<{ name: string; color?: string }> }
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
    if (tags.length === 0) return <span className="text-gray-300"> </span>
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
      {cell?.text || ''}
    </span>
  )
}

/**
 * Fetches and renders a Notion database as a structured table (Name + property columns).
 */
export function NotionDatabaseTableView({
  notionDatabaseId,
  fallbackTitle,
  className,
}: NotionDatabaseTableViewProps) {
  const [data, setData] = useState<NotionDatabaseTable | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const res = await fetch(`/api/notion/database/${encodeURIComponent(notionDatabaseId)}`)
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Failed to load database')
        if (!cancelled) setData(json as NotionDatabaseTable)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load database')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [notionDatabaseId])

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

  // Prefer a readable subset of columns first (title + common props), then the rest
  const columns = data.properties

  return (
    <div
      className={cn(
        'tt-notion-db nodrag nowheel nokey', // RF: don't start frame drag / pan from the table
        'w-full min-w-[420px] max-w-full overflow-auto rounded-md border border-gray-200 bg-white',
        className
      )}
      onPointerDown={(e) => e.stopPropagation()} // Keep selection inside cells
    >
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-gray-200 bg-[#f7f6f3]">
            {columns.map((prop) => (
              <th
                key={prop.id}
                className="sticky top-0 z-[1] whitespace-nowrap px-2 py-1.5 text-[12px] font-medium text-gray-500 bg-[#f7f6f3]"
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
          {data.rows.length === 0 ? (
            <tr>
              <td
                colSpan={Math.max(1, columns.length)}
                className="px-2 py-3 text-sm text-gray-400"
              >
                No rows
              </td>
            </tr>
          ) : (
            data.rows.map((row) => (
              <tr key={row.id} className="border-b border-gray-100 hover:bg-[#fafafa]">
                {columns.map((prop) => (
                  <td
                    key={prop.id}
                    className={cn(
                      'px-2 py-1.5 align-middle max-w-[220px]',
                      prop.type === 'title' && 'min-w-[180px]'
                    )}
                  >
                    <CellContent
                      prop={prop}
                      cell={row.cells[prop.name]}
                      rowIcon={prop.type === 'title' ? row.icon : null}
                    />
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
