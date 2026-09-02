'use client'

// Shared optimistic cell save for static preview row-warm (no full live table mount).

import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  applyEditToCell,
  type NotionDatabaseTable,
  type NotionDbProperty,
} from '@/lib/notion/database'
import type { SaveFn } from '@/components/notion-db-virtual-body'

export function useNotionDbCellSave(
  notionDatabaseId: string,
  properties: NotionDbProperty[] | undefined
) {
  const queryClient = useQueryClient()
  const tableQueryKey = useMemo(
    () => ['notion-database', notionDatabaseId] as const,
    [notionDatabaseId]
  )
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const setCachedTable = useCallback(
    (updater: (prev: NotionDatabaseTable | null) => NotionDatabaseTable | null) => {
      queryClient.setQueryData<NotionDatabaseTable>(tableQueryKey, (prev) => {
        const next = updater(prev ?? null)
        return next === null ? prev : next
      })
    },
    [queryClient, tableQueryKey]
  )

  const onSave = useCallback<SaveFn>(
    async (pageId, propertyName, value) => {
      const key = `${pageId}:${propertyName}`
      setSavingKey(key)
      const prop = properties?.find((p) => p.name === propertyName)
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
      } catch {
        void queryClient.invalidateQueries({ queryKey: tableQueryKey })
      } finally {
        setSavingKey(null)
      }
    },
    [properties, queryClient, setCachedTable, tableQueryKey]
  )

  return { onSave, savingKey }
}
