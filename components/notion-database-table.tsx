'use client'

// Editable Notion database with Thinktable view settings (layout / filter / sort / group / color / sub-tasks).

import { useCallback, useEffect, useMemo, useRef, useState, memo, type CSSProperties } from 'react'
import {
  Check,
  Hash,
  List,
  Loader2,
  Type,
} from 'lucide-react'
import type { DbConvertLayoutId } from '@/components/block-actions-menu'
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
  readPeeledNotionPageIds,
} from '@/lib/notion/row-to-card-client'
import {
  applyEditToCell,
  NOTION_DB_CLIENT_ROW_CAP,
  NOTION_DB_CLIENT_ROW_PAGE,
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
import {
  buildFlatTableItems,
  CellDisplay,
  DB_TABLE_ROW_HEIGHT,
  DB_TABLE_SCROLL_CAP,
  DB_TABLE_VIRTUALIZE_MIN,
  VirtualizedListBody,
  VirtualizedTableBody,
  useVisibleColumnRange,
  type SaveFn,
} from '@/components/notion-db-virtual-body'
import { rowTitleFromCells } from '@/lib/notion/property-map'
import { notionDbFreeResizeScrollCap } from '@/lib/notion/db-table-scroll'
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
  /** RF frame drag — swap heavy table DOM for a light shell. */
  frameDragging?: boolean
  /** Unlocked user-sized frame — scroll body fills the clip box (as many rows as fit). */
  frameFreeResize?: boolean
  /** Host clipBoxH in layout px (from data-frame-clip-height). */
  frameClipHeight?: number | null
  /** Hover clip preview — expand to full table, not the free-resize viewport. */
  frameClipPreview?: boolean
  /** Focus-gated live table (false = caller should use static preview instead). */
  interactive?: boolean
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

const MemoDatabaseViewToolbar = memo(DatabaseViewToolbar)

export function NotionDatabaseTableView({
  notionDatabaseId,
  fallbackTitle,
  className,
  viewSettingsJson,
  onViewSettingsChange,
  conversationId: conversationIdProp,
  hostMessageId: hostMessageIdProp,
  frameSelected = false,
  frameDragging = false,
  frameFreeResize = false,
  frameClipHeight = null,
  frameClipPreview = false,
  interactive = true,
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
    staleTime: 5 * 60 * 1000, // Fresh enough for edits; drag remounts reuse cache instantly
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: interactive, // Idle/static embeds skip refocus churn
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
  const [loadingMore, setLoadingMore] = useState(false)
  const [freeResizeScrollCap, setFreeResizeScrollCap] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollWrapRef = useRef<HTMLDivElement>(null)

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

  // Which columns are on screen. Rows outside the window already collapse to spacers; without this a
  // mounted row still built a cell for every column, on- or off-screen, which is what made selecting a
  // wide table cost the whole table instead of the part you can see.
  const theadRef = useRef<HTMLTableSectionElement | null>(null)
  const colRange = useVisibleColumnRange(columns, settings, theadRef)

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

  const flatItems = useMemo(
    () => buildFlatTableItems(groups, settings, subTaskTree, settings.groupBy, expandedParents),
    [groups, settings, subTaskTree, expandedParents]
  )

  const rowItemCount = useMemo(
    () => flatItems.filter((i) => i.kind === 'row').length,
    [flatItems]
  )
  // Nested table scroll only when the user free-resized a clip shorter than content.
  // Selected/locked tables hug and show all loaded rows — wheel stays with the board
  // (inner scroll on a zoom/pan canvas is a fight; idle uses static preview slice).
  const useFrameFill = frameFreeResize && !frameClipPreview
  const useBoundedScroll = useFrameFill
  const virtualizeRows = useBoundedScroll && rowItemCount > DB_TABLE_VIRTUALIZE_MIN

  /** Free-resize: measure clip box so the table shows as many rows as fit (not a fixed 480px cap). */
  const syncFreeResizeScrollCap = useCallback(() => {
    if (!frameFreeResize) {
      setFreeResizeScrollCap(null)
      return
    }
    const scrollEl = scrollRef.current
    if (!scrollEl) return
    setFreeResizeScrollCap(notionDbFreeResizeScrollCap(scrollEl, frameClipHeight))
  }, [frameFreeResize, frameClipHeight])

  useEffect(() => {
    if (!frameFreeResize) {
      setFreeResizeScrollCap(null)
      return
    }
    let raf = 0
    const run = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => syncFreeResizeScrollCap())
    }
    run()
    const scrollEl = scrollRef.current
    if (!scrollEl) return () => cancelAnimationFrame(raf)
    const ro = new ResizeObserver(run)
    ro.observe(scrollEl)
    let ancestor: HTMLElement | null = scrollEl.parentElement
    for (let i = 0; i < 14 && ancestor; i++) {
      ro.observe(ancestor)
      if (ancestor.classList.contains('react-flow__node')) break
      ancestor = ancestor.parentElement
    }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [syncFreeResizeScrollCap, frameFreeResize, frameClipHeight, rowItemCount, settings.layout])

  const scrollBodyStyle = useMemo((): CSSProperties | undefined => {
    if (frameClipPreview) return undefined // Hover preview — full table height, no scroll cap
    if (frameFreeResize) {
      // Only free-resize clip boxes scroll internally
      const cap =
        freeResizeScrollCap ??
        (frameClipHeight != null && frameClipHeight > 96
          ? Math.max(DB_TABLE_ROW_HEIGHT * 3, frameClipHeight - 88)
          : null) ??
        DB_TABLE_SCROLL_CAP
      return { maxHeight: cap }
    }
    // Selected / locked: show all loaded rows (hug). No fixed 480px inner scroller.
    return undefined
  }, [frameFreeResize, freeResizeScrollCap, frameClipHeight, frameClipPreview])

  /** Top/bottom … when capped table is not fully scrolled (or more rows on server). */
  const syncScrollHints = useCallback(() => {
    const el = scrollRef.current
    const wrap = scrollWrapRef.current
    if (!wrap) return
    if (!el || !useBoundedScroll) {
      wrap.classList.remove('tt-notion-db-v-overflow', 'tt-notion-db-at-top', 'tt-notion-db-at-bottom')
      return
    }
    const edge = 4
    const hasOverflow = el.scrollHeight > el.clientHeight + 2
    const atTop = el.scrollTop <= edge
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - edge
    wrap.classList.toggle('tt-notion-db-v-overflow', hasOverflow)
    wrap.classList.toggle('tt-notion-db-at-top', !hasOverflow || atTop)
    wrap.classList.toggle(
      'tt-notion-db-at-bottom',
      !hasOverflow || (atBottom && !data?.rowsHasMore)
    )
  }, [useBoundedScroll, data?.rowsHasMore])

  useEffect(() => {
    syncScrollHints()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', syncScrollHints, { passive: true })
    const ro = new ResizeObserver(syncScrollHints)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', syncScrollHints)
      ro.disconnect()
    }
  }, [syncScrollHints, rowItemCount, filteredRows.length, settings.layout, frameSelected, scrollBodyStyle])

  const rowBgFn = useCallback(
    (row: NotionDbRow) => rowBackground(row, settings.conditionalColors),
    [settings.conditionalColors]
  )

  const handleSelectRow = useCallback((id: string) => setSelectedRowId(id), [])

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const loadMoreRows = useCallback(async () => {
    if (!interactive) return // Only the focus-gated live table paginates
    if (!data?.rowsHasMore || !data.rowsNextCursor || loadingMore) return
    // Cap client heap — full row sets kill the board regardless of virtualization
    if (data.rows.length >= NOTION_DB_CLIENT_ROW_CAP) return
    setLoadingMore(true)
    try {
      const url = new URL(
        `/api/notion/database/${encodeURIComponent(notionDatabaseId)}`,
        window.location.origin
      )
      const page = Math.min(
        NOTION_DB_CLIENT_ROW_PAGE,
        NOTION_DB_CLIENT_ROW_CAP - data.rows.length
      )
      url.searchParams.set('limit', String(page))
      url.searchParams.set('cursor', data.rowsNextCursor)
      const res = await fetch(url.toString())
      const json = (await res.json()) as NotionDatabaseTable & { error?: string }
      if (!res.ok) throw new Error(json.error || 'Failed to load more rows')
      setCachedTable((prev) => {
        if (!prev) return prev
        const seen = new Set(prev.rows.map((r) => r.id.replace(/-/g, '').toLowerCase()))
        const merged = [...prev.rows]
        for (const row of json.rows) {
          if (merged.length >= NOTION_DB_CLIENT_ROW_CAP) break
          const k = row.id.replace(/-/g, '').toLowerCase()
          if (!seen.has(k)) {
            seen.add(k)
            merged.push(row)
          }
        }
        return {
          ...prev,
          rows: merged,
          rowsHasMore:
            merged.length < NOTION_DB_CLIENT_ROW_CAP && !!json.rowsHasMore,
          rowsNextCursor: json.rowsNextCursor,
        }
      })
    } catch (e) {
      console.error('Load more rows failed:', e)
    } finally {
      setLoadingMore(false)
    }
  }, [data, loadingMore, notionDatabaseId, setCachedTable, interactive])

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

  if (frameDragging) {
    return (
      <div
        className={cn(
          'tt-notion-db tt-notion-db-drag-shell nokey flex items-center justify-center min-w-[420px] min-h-[120px] text-sm text-gray-400 bg-transparent',
          frameSelected && 'nodrag',
          className
        )}
        onPointerDown={frameSelected ? (e) => e.stopPropagation() : undefined}
      >
        {filteredRows.length} row{filteredRows.length === 1 ? '' : 's'}
      </div>
    )
  }

  const titleProp = data.properties.find((p) => p.type === 'title')
  const vLines = settings.layoutOptions.showVerticalLines
  // Explicit px widths (Notion view or defaults) so fixed-layout cells clip instead of expanding the hug
  const tablePixelWidth = columns.reduce((sum, prop) => sum + columnWidthPx(prop, settings), 0)

  // Every layout below is a thunk, and only the selected one is called.
  //
  // They used to be plain `const`s, so each render of a *table* also built the gallery, board and
  // calendar views and threw them away — each one walking `filteredRows` (all rows, unwindowed) and
  // emitting a card per row. A CPU profile of one selection put 132ms in the gallery map, 51ms in the
  // board grouping and 29ms in the calendar bucketing: 212ms of the table's 229ms render was invisible
  // output. This is why selecting slowed with total row count rather than with what was on screen.
  const renderTable = () => (
    <div className="relative tt-db-table-wrap overflow-hidden" style={{ paddingLeft: ROW_GUTTER }}>
      <table
        className="border-separate border-spacing-0 text-left border-0"
        style={{ width: tablePixelWidth, tableLayout: 'fixed' }}
      >
        <thead ref={theadRef}>
          <tr className="border-b border-gray-200">
            {columns.map((prop, colIndex) => {
              const colW = columnWidthPx(prop, settings)
              return (
                <th
                  key={prop.id}
                  data-col-index={colIndex}
                  style={{ width: colW, maxWidth: colW, minWidth: 0 }}
                  className={cn(
                    'sticky top-0 z-[1] overflow-hidden whitespace-nowrap px-2 py-1 text-[12px] font-medium text-gray-500 bg-transparent',
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
        <VirtualizedTableBody
          flatItems={flatItems}
          columns={columns}
          settings={settings}
          tablePixelWidth={tablePixelWidth}
          vLines={vLines}
          selectedRowId={selectedRowId}
          savingKey={savingKey}
          notionDatabaseId={notionDatabaseId}
          databaseTitle={data.title}
          properties={data.properties}
          conversationId={conversationId}
          childrenOf={subTaskTree.childrenOf}
          expandedParents={expandedParents}
          onSelect={handleSelectRow}
          onToggleExpand={handleToggleExpand}
          onSave={onSave}
          onDelete={(id) => void deleteRow(id)}
          onOpen={openRow}
          onCreateRow={(afterId) => void createRow(afterId)}
          onConvertLayout={
            conversationId
              ? (layout, rowId) => void handleConvertLayout(layout, rowId)
              : undefined
          }
          rowBackgroundFn={rowBgFn}
          scrollParentRef={scrollRef}
          virtualize={virtualizeRows}
          colRange={colRange}
        />
      </table>
    </div>
  )

  const renderList = () => (
    <VirtualizedListBody
      rows={filteredRows}
      titleProp={titleProp}
      columns={columns}
      settings={settings}
      rowBackgroundFn={rowBgFn}
      scrollParentRef={scrollRef}
      virtualize={virtualizeRows}
    />
  )

  const renderBoard = () => {
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
  }

  const renderGallery = () => (
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

  const renderCalendar = () => {
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
  }

  const body =
    settings.layout === 'list'
      ? renderList()
      : settings.layout === 'board'
        ? renderBoard()
        : settings.layout === 'gallery'
          ? renderGallery()
          : settings.layout === 'calendar'
            ? renderCalendar()
            : renderTable()

  const bringDialogRow = bringDialogRowId
    ? data.rows.find((r) => r.id === bringDialogRowId) || null
    : null
  const bringDialogTitle = bringDialogRow
    ? rowTitleFromCells(data.properties, bringDialogRow.cells)
    : undefined

  return (
    <div
      className={cn(
        'tt-notion-db nokey w-full min-w-[420px] max-w-full bg-transparent',
        frameSelected && 'nodrag',
        className
      )}
      onPointerDown={frameSelected ? (e) => e.stopPropagation() : undefined}
    >
      {settings.layoutOptions.showDataSourceTitle ? (
        <div className="px-1 pb-1 text-[12px] font-medium text-gray-500 truncate shrink-0">
          {data.title || fallbackTitle}
        </div>
      ) : null}
      <MemoDatabaseViewToolbar
        settings={settings}
        onChange={updateSettings}
        properties={data.properties}
        sourceTitle={data.title}
        className="shrink-0"
      />
      {saveError ? (
        <div className="px-2 py-1 text-[11px] text-red-600 border-b border-red-100 bg-red-50">
          {saveError}
        </div>
      ) : null}
      <div ref={scrollWrapRef} className="relative min-w-0 tt-notion-db-scroll-wrap">
        <div
          ref={scrollRef}
          className={cn(
            'tt-notion-db-scroll w-full min-w-0',
            useBoundedScroll
              ? frameSelected
                ? 'overflow-y-auto overflow-x-auto tt-notion-db-scroll-active'
                : 'overflow-y-hidden overflow-x-auto'
              : 'overflow-x-auto overflow-y-visible'
          )}
          style={scrollBodyStyle}
        >
          {body}
          {data.rowsHasMore ? (
            <div className="flex justify-center py-2 border-t border-gray-100">
              <button
                type="button"
                className="rounded-md px-3 py-1 text-[12px] text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                disabled={loadingMore}
                onClick={() => void loadMoreRows()}
              >
                {loadingMore ? 'Loading…' : 'Load more rows'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
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
