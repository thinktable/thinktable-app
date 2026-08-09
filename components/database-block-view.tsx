'use client'

// React NodeView for databaseBlock: Notion-like structured table (columns + typed cells).
// Header keeps icon + title + PageOpenMenu (preview / open / Notion). Nested page-body DBs
// and map DB frames both render the live table from /api/notion/database/[id].

import { useCallback, useEffect, useRef, useState } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Table2 } from 'lucide-react'
import { PageOpenMenu } from '@/components/page-open-menu' // Same chrome as pageLink blocks
import { NotionMarkIcon } from '@/components/notion-mark-icon' // Monochrome Notion mark
import { NotionDatabaseTableView } from '@/components/notion-database-table' // Structured table
import { usePageLinkActions } from '@/lib/page-link-context'
import { cn } from '@/lib/utils'

export function DatabaseBlockView({ node, updateAttributes }: NodeViewProps) {
  const notionDatabaseId = (node.attrs.notionDatabaseId as string | null) || null // Linked Notion DB
  const icon = (node.attrs.icon as string | null) || null // Emoji, else table icon
  const url = (node.attrs.url as string | null) || null // Open-in-Notion when set
  const actions = usePageLinkActions() // Host may supply linkedPageId + notionUrl
  const hostPageId = actions.hostLinkedPageId || null // Map-frame DB → full open menu
  const notionUrl = url || actions.notionUrl || null // Prefer block url, else frame metadata

  const [title, setTitle] = useState<string>((node.attrs.title as string) || 'Untitled database') // Local label
  const [editing, setEditing] = useState(false) // True while the title span holds focus
  const titleRef = useRef<HTMLSpanElement>(null) // contentEditable span

  // Keep local title in sync when the node attr changes externally (e.g. re-import)
  useEffect(() => {
    const attrTitle = (node.attrs.title as string) || 'Untitled database'
    setTitle(attrTitle)
    if (!editing && titleRef.current && titleRef.current.textContent !== attrTitle) {
      titleRef.current.textContent = attrTitle
    }
  }, [node.attrs.title, editing])

  // Commit an edited title to the node attr (local only until Notion sync exists for DBs)
  const commitTitle = useCallback(() => {
    const next = (titleRef.current?.textContent || '').trim() || 'Untitled database'
    setEditing(false)
    if (next === (node.attrs.title as string)) return
    updateAttributes({ title: next }) // Persist into the frame message HTML
  }, [node.attrs.title, updateAttributes])

  // Nested DB without a host page: open Notion directly from the icon
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
        'tt-database-block group relative nokey', // nokey: RF must not steal Backspace while editing
        editing && 'tt-database-block-editing'
      )}
      data-notion-database-id={notionDatabaseId || undefined}
    >
      {/* Title row — icon + label + open menu (preview / open / Notion) */}
      <div className="tt-database-block-row relative inline-flex items-center gap-1.5 max-w-full mb-2">
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
        {/* Map-frame: full preview / open / Notion menu; nested: Notion-only when no Thinktable page */}
        {hostPageId ? (
          <PageOpenMenu
            pageId={hostPageId}
            notionUrl={notionUrl}
            forceVisible
            className="!relative !left-auto !right-auto !top-auto !translate-y-0 !ml-1"
          />
        ) : notionUrl ? (
          <span className="tt-page-link-preview !relative !left-auto !right-auto !top-auto !translate-y-0 !ml-1 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto">
            <button
              type="button"
              className="tt-page-link-preview-btn"
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

      {/* Structured Notion table — properties as columns, pages as rows */}
      {notionDatabaseId ? (
        <NotionDatabaseTableView
          notionDatabaseId={notionDatabaseId}
          fallbackTitle={title}
          viewSettingsJson={(node.attrs.viewSettings as string | null) || null}
          onViewSettingsChange={(json) => updateAttributes({ viewSettings: json })}
        />
      ) : null}
    </NodeViewWrapper>
  )
}
