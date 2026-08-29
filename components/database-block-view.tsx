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
import { NotionDbStaticPreview } from '@/components/notion-db-static-preview'
import { useBoardLinkActions } from '@/lib/board-link-context'
import {
  isBoardNavigating,
  subscribeBoardNavigating,
} from '@/lib/board-navigating'
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
  const [alwaysExpanded, setAlwaysExpanded] = useState(false) // Frame menu: show every row while unselected

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

  // Selection alone decides this. Gating on nav/drag as well meant every pan, pinch and frame drag
  // unmounted the live table at gesture start and rebuilt it at gesture end — measured **472ms of
  // blocking across 3 long tasks per gesture** (vs 0 with nothing selected), because a table build is
  // ~130-220ms and the freeze paid it twice. That freeze was worth it when a selected table mounted
  // every loaded row with full per-row chrome ("fast pan over DB OOMed Safari"); now that idle rows
  // are `StaticCell`s and only on-screen chunks mount, a mounted table pans for **0 long tasks**, so
  // the swap costs everything and saves nothing.
  const showLiveTable = !!notionDatabaseId && frameSelected
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
    ]
  )

  useEffect(() => {
    const dom = editor?.view?.dom as HTMLElement | undefined
    if (!dom) return
    const sync = () => {
      setFrameDragging(dom.hasAttribute('data-frame-dragging'))
      setAlwaysExpanded(dom.hasAttribute('data-db-always-expanded'))
    }
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(dom, {
      attributes: true,
      attributeFilter: ['data-frame-dragging', 'data-db-always-expanded'],
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
              frameSelected={false}
              // ~12 rows by default: the pan/drag freeze needs a stable *box*, not rows. The earlier
              // "full tables on deselect" regression came from keying all-rows on a nav flag that
              // could wedge true — this is an explicit frame setting instead, and it must hold during
              // nav too, since for these frames the full table *is* the at-rest box.
              compact={!alwaysExpanded}
              minWidth={freezeToLastBox ? lastBox?.w : undefined}
              minHeight={freezeToLastBox ? lastBox?.h : undefined}
            />
          )}
        </div>
      ) : null}
    </NodeViewWrapper>
  )
}
