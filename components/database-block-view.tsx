'use client'

// React NodeView for databaseBlock: Notion-like structured table (columns + typed cells).
// Selected → full live table. Unselected → compact static (~12 rows) + hug shrink.
// Pan/drag no longer swap the table — only the idle box freeze reads those flags.
// Selection is `lib/frame-panel-selected` (host RF
// `selected`) — never isEditable / DOM attrs (those stayed true after deselect).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Table2 } from 'lucide-react'
import { BoardOpenMenu } from '@/components/board-open-menu'
import { NotionMarkIcon } from '@/components/notion-mark-icon'
import { NotionDatabaseTableView } from '@/components/notion-database-table'
import {
  COMPACT_PREVIEW_ROWS,
  NotionDbStaticPreview,
} from '@/components/notion-db-static-preview'
import { useBoardLinkActions } from '@/lib/board-link-context'
import {
  isBoardNavigating,
  subscribeBoardNavigating,
} from '@/lib/board-navigating'
import { useQueryClient } from '@tanstack/react-query'
import {
  NOTION_DB_CLIENT_ROW_CAP,
  NOTION_DB_CLIENT_ROW_PAGE,
  type NotionDatabaseTable,
} from '@/lib/notion/database'
import { useDbLiveClaims } from '@/lib/frame-db-live'
import { useFramePanelSelected } from '@/lib/frame-panel-selected'
import { cn } from '@/lib/utils'

export function DatabaseBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const notionDatabaseId = (node.attrs.notionDatabaseId as string | null) || null
  const icon = (node.attrs.icon as string | null) || null
  const url = (node.attrs.url as string | null) || null
  const viewSettingsJson = (node.attrs.viewSettings as string | null) || null
  const actions = useBoardLinkActions()
  const hostPageId = actions.hostLinkedBoardId || null
  const notionUrl = url || actions.notionUrl || null
  const frameHost = (
    editor?.storage as
      | {
          frameHost?: {
            conversationId: string | null
            hostMessageId: string | null
            hostNodeId?: string | null
            frameSelected?: boolean
          }
        }
      | undefined
  )?.frameHost
  const hostConversationId = frameHost?.conversationId || actions.conversationId || null
  const hostMessageId = frameHost?.hostMessageId || actions.hostMessageId || null
  const hostNodeId = frameHost?.hostNodeId || null
  // RF `selected` from the host frame — not DOM attrs (those stayed true after deselect)
  const frameSelected = useFramePanelSelected([hostMessageId, hostNodeId])

  const [title, setTitle] = useState<string>((node.attrs.title as string) || 'Untitled database')
  const [editing, setEditing] = useState(false)
  const titleRef = useRef<HTMLSpanElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [lastBox, setLastBox] = useState<{ w: number; h: number } | null>(null)
  const [frameDragging, setFrameDragging] = useState(false)
  const [frameFreeResize, setFrameFreeResize] = useState(false)
  const [frameClipHeight, setFrameClipHeight] = useState<number | null>(null)
  const [frameClipPreview, setFrameClipPreview] = useState(false)
  const queryClient = useQueryClient()

  // Prefer the live Notion database name for the blue header (attrs can be stale import junk like
  // "… and New data source"). Same react-query cache as the table/preview — no extra fetch.
  useEffect(() => {
    if (!notionDatabaseId || editing) return
    const key = ['notion-database', notionDatabaseId] as const
    const apply = (next: string | undefined) => {
      if (!next) return
      setTitle((prev) => {
        if (prev === next) return prev
        updateAttributes({ title: next })
        if (titleRef.current && titleRef.current.textContent !== next) {
          titleRef.current.textContent = next
        }
        return next
      })
    }
    apply(queryClient.getQueryData<NotionDatabaseTable>(key)?.title)
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' && event.type !== 'added') return
      const qk = event.query.queryKey
      if (qk[0] !== 'notion-database' || qk[1] !== notionDatabaseId) return
      apply((event.query.state.data as NotionDatabaseTable | undefined)?.title)
    })
  }, [notionDatabaseId, queryClient, editing, updateAttributes])

  const instanceId = useMemo(() => {
    if (!notionDatabaseId) return undefined
    return `${hostMessageId || 'local'}:${notionDatabaseId}`
  }, [hostMessageId, notionDatabaseId])

  const { onPointerEnter, onPointerLeave } = useDbLiveClaims(instanceId, frameSelected)

  const navigating = useSyncExternalStore(
    subscribeBoardNavigating,
    isBoardNavigating,
    () => false
  )

  // Live table waits for a *row* click (not frame select). Reset on deselect.
  const [engaged, setEngaged] = useState(false)
  const [engageRowId, setEngageRowId] = useState<string | null>(null)
  useEffect(() => {
    if (!frameSelected) {
      setEngaged(false)
      setEngageRowId(null)
    }
  }, [frameSelected])
  const engageRow = useCallback((rowId: string) => {
    setEngageRowId(rowId)
    setEngaged(true)
  }, [])
  // Per host *frame* (message metadata → data-db-visible-row-cap). Never key off notionDatabaseId —
  // duplicate frames share that id and must still page independently.
  const [visibleRowCap, setVisibleRowCap] = useState(COMPACT_PREVIEW_ROWS)
  const effectiveRowCap = visibleRowCap

  // Pull enough pages into the shared cache for `target` rows (display still slices per frame cap).
  const ensureRowsCached = useCallback(
    (target: number) => {
      if (!notionDatabaseId) return
      const tableQueryKey = ['notion-database', notionDatabaseId] as const
      void (async () => {
        try {
          for (;;) {
            const current = queryClient.getQueryData<NotionDatabaseTable>(tableQueryKey)
            if (!current) break
            if (current.rows.length >= target) break
            if (!current.rowsHasMore || !current.rowsNextCursor) break
            if (current.rows.length >= NOTION_DB_CLIENT_ROW_CAP) break
            const url = new URL(
              `/api/notion/database/${encodeURIComponent(notionDatabaseId)}`,
              window.location.origin
            )
            const page = Math.min(
              NOTION_DB_CLIENT_ROW_PAGE,
              NOTION_DB_CLIENT_ROW_CAP - current.rows.length
            )
            url.searchParams.set('limit', String(page))
            url.searchParams.set('cursor', current.rowsNextCursor)
            const res = await fetch(url.toString())
            const json = (await res.json()) as NotionDatabaseTable & { error?: string }
            if (!res.ok) break
            queryClient.setQueryData<NotionDatabaseTable>(tableQueryKey, (prevTable) => {
              if (!prevTable) return prevTable
              const seen = new Set(prevTable.rows.map((r) => r.id.replace(/-/g, '').toLowerCase()))
              const merged = [...prevTable.rows]
              for (const row of json.rows) {
                if (merged.length >= NOTION_DB_CLIENT_ROW_CAP) break
                const k = row.id.replace(/-/g, '').toLowerCase()
                if (!seen.has(k)) {
                  seen.add(k)
                  merged.push(row)
                }
              }
              return {
                ...prevTable,
                rows: merged,
                rowsHasMore: merged.length < NOTION_DB_CLIENT_ROW_CAP && !!json.rowsHasMore,
                rowsNextCursor: json.rowsNextCursor,
              }
            })
            if (!json.rowsHasMore || !json.rowsNextCursor) break
          }
        } catch (e) {
          console.error('Show more rows failed:', e)
        }
      })()
    },
    [notionDatabaseId, queryClient]
  )

  const persistVisibleRowCap = useCallback(
    (cap: number) => {
      // Optimistic local paint; host ChatPanelNode owns metadata + DOM attr for siblings.
      setVisibleRowCap(cap)
      window.dispatchEvent(
        new CustomEvent('tt-set-db-visible-row-cap', {
          detail: {
            nodeIds: hostNodeId ? [hostNodeId] : [],
            messageIds: hostMessageId ? [hostMessageId] : [],
            cap,
          },
        })
      )
      ensureRowsCached(cap)
    },
    [hostNodeId, hostMessageId, ensureRowsCached]
  )

  const onShowMoreRows = useCallback(() => {
    // 12 → 50 on first click; then +50 each click (Preview and Expanded alike).
    const next =
      effectiveRowCap < NOTION_DB_CLIENT_ROW_PAGE
        ? NOTION_DB_CLIENT_ROW_PAGE
        : Math.min(NOTION_DB_CLIENT_ROW_CAP, effectiveRowCap + NOTION_DB_CLIENT_ROW_PAGE)
    if (next === effectiveRowCap) return
    persistVisibleRowCap(next)
  }, [effectiveRowCap, persistVisibleRowCap])

  // Cover the current unlock (menu Expanded seed, reload, or show-more) without waiting for a click.
  useEffect(() => {
    ensureRowsCached(visibleRowCap)
  }, [visibleRowCap, ensureRowsCached])

  // Frame select is for move/resize/menu — not edit intent. Live table mounts only after a row
  // click (`engaged`); that row is seeded as the sole hydrated row. Show-more stays on static.
  const showLiveTable = !!notionDatabaseId && frameSelected && engaged
  // Row engage only while selected and still static (selecting press must not warm — RF selects after).
  const canRowEngage = frameSelected && !engaged && !frameDragging
  const freezeToLastBox = (frameDragging || navigating) && !!lastBox

  // A nav notification must not re-render the live table. `navigating` feeds only the *static* path
  // (freeze box + idle-compact hug), yet subscribing to it re-rendered this NodeView at every gesture
  // start and end, and re-rendering the table subtree cost **370ms across 2 long tasks per gesture**
  // even after the unmount/remount swap was removed. Holding the element in a memo lets React reuse
  // it and skip the subtree; exhaustive-deps polices the dependency list.
  const liveTable = useMemo(
    () => (
      <NotionDatabaseTableView
        notionDatabaseId={notionDatabaseId || ''}
        fallbackTitle={title}
        viewSettingsJson={viewSettingsJson}
        onViewSettingsChange={(json) => updateAttributes({ viewSettings: json })}
        conversationId={hostConversationId}
        hostMessageId={hostMessageId}
        frameSelected={frameSelected}
        frameDragging={false}
        frameFreeResize={frameFreeResize}
        frameClipHeight={frameClipHeight}
        frameClipPreview={frameClipPreview}
        interactive
        rowCap={effectiveRowCap}
        onShowMore={onShowMoreRows}
        initialActiveRowId={engageRowId}
      />
    ),
    [
      notionDatabaseId,
      title,
      viewSettingsJson,
      hostConversationId,
      hostMessageId,
      frameSelected,
      frameFreeResize,
      frameClipHeight,
      frameClipPreview,
      updateAttributes,
      effectiveRowCap,
      onShowMoreRows,
      engageRowId,
    ]
  )

  useEffect(() => {
    const dom = editor?.view?.dom as HTMLElement | undefined
    if (!dom) return
    const sync = () => {
      setFrameDragging(dom.hasAttribute('data-frame-dragging'))
      const raw = dom.getAttribute('data-db-visible-row-cap')
      const n = raw ? parseInt(raw, 10) : NaN
      if (Number.isFinite(n) && n > 0) setVisibleRowCap(n)
    }
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(dom, {
      attributes: true,
      attributeFilter: ['data-frame-dragging', 'data-db-visible-row-cap'],
    })
    return () => mo.disconnect()
  }, [editor])

  useEffect(() => {
    const dom = editor?.view?.dom as HTMLElement | undefined
    if (!dom) return
    const sync = () => {
      setFrameFreeResize(dom.hasAttribute('data-frame-free-resize'))
      setFrameClipPreview(dom.hasAttribute('data-clip-preview'))
      const raw = dom.getAttribute('data-frame-clip-height')
      const h = raw ? parseInt(raw, 10) : NaN
      setFrameClipHeight(Number.isFinite(h) && h > 0 ? h : null)
    }
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(dom, {
      attributes: true,
      attributeFilter: ['data-frame-free-resize', 'data-frame-clip-height', 'data-clip-preview'],
    })
    return () => mo.disconnect()
  }, [editor])

  useEffect(() => {
    if (!showLiveTable) return
    const el = boxRef.current
    if (!el) return
    const snap = () => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      if (w > 40 && h > 40) setLastBox({ w, h })
      el.dispatchEvent(new CustomEvent('tt-db-content-resize', { bubbles: true }))
    }
    snap()
    const ro = new ResizeObserver(snap)
    ro.observe(el)
    return () => ro.disconnect()
  }, [showLiveTable, title, frameSelected])

  // Idle compact: clear freeze box + nudge hug so the frame shrinks to ~12 rows
  useEffect(() => {
    if (frameSelected || frameDragging || navigating) return
    setLastBox(null)
    const el = boxRef.current
    if (el) {
      requestAnimationFrame(() => {
        el.dispatchEvent(new CustomEvent('tt-db-content-resize', { bubbles: true }))
      })
    }
  }, [frameSelected, frameDragging, navigating])

  useEffect(() => {
    const attrTitle = (node.attrs.title as string) || 'Untitled database'
    setTitle(attrTitle)
    if (!editing && titleRef.current && titleRef.current.textContent !== attrTitle) {
      titleRef.current.textContent = attrTitle
    }
  }, [node.attrs.title, editing])

  const commitTitle = useCallback(() => {
    const next = (titleRef.current?.textContent || '').trim() || 'Untitled database'
    setEditing(false)
    if (next === (node.attrs.title as string)) return
    updateAttributes({ title: next })
  }, [node.attrs.title, updateAttributes])

  const openInNotion = useCallback(() => {
    if (!notionUrl || editing) return
    window.open(notionUrl, '_blank', 'noopener,noreferrer')
  }, [notionUrl, editing])

  const IconEl = icon ? (
    <span className="tt-database-block-emoji leading-none">{icon}</span>
  ) : (
    <Table2 className="tt-database-block-fallback h-4 w-4 text-blue-500" aria-hidden />
  )

  return (
    <NodeViewWrapper
      as="div"
      className={cn(
        'tt-database-block group relative nokey',
        editing && 'tt-database-block-editing',
        frameFreeResize && 'tt-database-block-free-resize'
      )}
      data-notion-database-id={notionDatabaseId || undefined}
      data-frame-free-resize={frameFreeResize ? 'true' : undefined}
      data-tt-db-live={showLiveTable ? 'true' : undefined}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className="tt-database-block-row relative inline-flex items-center gap-1.5 max-w-full mb-2 shrink-0">
        <button
          type="button"
          className="tt-database-block-icon flex-shrink-0 rounded hover:bg-black/5 dark:hover:bg-white/10"
          onClick={hostPageId ? undefined : openInNotion}
          title={!hostPageId && notionUrl ? 'Open in Notion' : undefined}
          aria-label={!hostPageId && notionUrl ? `Open ${title} in Notion` : title}
        >
          {IconEl}
        </button>
        <span
          ref={titleRef}
          className="tt-database-block-label"
          contentEditable
          suppressContentEditableWarning
          data-placeholder="Untitled database"
          onFocus={() => setEditing(true)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              titleRef.current?.blur()
            }
            e.stopPropagation()
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {title}
        </span>
        {hostPageId ? (
          <BoardOpenMenu
            boardId={hostPageId}
            notionUrl={notionUrl}
            forceVisible
            className="!relative !left-auto !right-auto !top-auto !translate-y-0 !ml-1"
          />
        ) : notionUrl ? (
          <span
            data-page-link-preview
            className="tt-board-link-preview nodrag nopan !relative !left-auto !right-auto !top-auto !translate-y-0 !ml-1 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
          >
            <button
              type="button"
              className="tt-board-link-preview-btn nodrag nopan"
              title="Open in Notion"
              aria-label="Open in Notion"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                openInNotion()
              }}
            >
              <NotionMarkIcon className="h-3.5 w-3.5" />
            </button>
          </span>
        ) : null}
      </div>

      {notionDatabaseId ? (
        <div ref={boxRef} className="min-w-0">
          {showLiveTable ? (
            liveTable
          ) : (
            <NotionDbStaticPreview
              notionDatabaseId={notionDatabaseId}
              fallbackTitle={title}
              viewSettingsJson={viewSettingsJson}
              frameSelected={frameSelected}
              // Preview starts at ~12; Expanded seeds to 50. Cap is owned here so idle and live
              // stay in sync when the user pages with "click to show more".
              compact={effectiveRowCap <= COMPACT_PREVIEW_ROWS}
              rowCap={effectiveRowCap}
              // Idle TipTap paint is what gets snapshotted for cold replay — windowing would store
              // spacer stubs and cold frames would miss columns/rows.
              completePaint
              onShowMore={onShowMoreRows}
              onRowEngage={canRowEngage ? engageRow : undefined}
              minWidth={freezeToLastBox ? lastBox?.w : undefined}
              minHeight={freezeToLastBox ? lastBox?.h : undefined}
            />
          )}
        </div>
      ) : null}
    </NodeViewWrapper>
  )
}
