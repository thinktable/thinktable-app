'use client'

// Shared page open menu: [preview AppWindow] + [open-full ↗] + optional [Notion icon].
// Used by boardLink NodeViews and by page frames whose content is still regular TipTap blocks
// (linkedBoardId, no boardLink yet). Notion-linked frames add the Notion mark right of open.

import { forwardRef, type CSSProperties } from 'react'
import { AppWindow, ArrowUpRight } from 'lucide-react'
import { NotionMarkIcon } from '@/components/notion-mark-icon' // Same monochrome mark as top bar
import { useBoardLinkActions } from '@/lib/board-link-context'
import { cn } from '@/lib/utils'

type BoardOpenMenuProps = {
  boardId: string // Child page to preview / open
  /** Notion deep link — when set, shows Notion icon right of open (prop wins over context). */
  notionUrl?: string | null
  className?: string // Extra classes on the chrome wrapper (positioning)
  /** Inline layout overrides (e.g. clamped left within an unlocked clipped frame). */
  style?: CSSProperties
  /** Force visible (frame-level hover); boardLink still uses CSS :hover when false. */
  forceVisible?: boolean
}

export const BoardOpenMenu = forwardRef<HTMLSpanElement, BoardOpenMenuProps>(
  function BoardOpenMenu({ boardId, notionUrl: notionUrlProp, className, style, forceVisible }, ref) {
    const actions = useBoardLinkActions() // Host frame preview / open / prefetch / notionUrl
    const previewActive = actions.previewBoardId === boardId // Highlight while this page is previewed
    const notionUrl = notionUrlProp ?? actions.notionUrl ?? null // Prop override, else frame context

    return (
      <span
        ref={ref}
        data-page-link-preview
        className={cn(
          'tt-board-link-preview nodrag nopan', // Phone/RF: never start frame drag / pan from the pill
          forceVisible && 'tt-board-link-preview-force', // Visible without hovering the boardLink itself
          className
        )}
        style={style}
      >
        {/* Toggle the in-place iframe preview */}
        <button
          type="button"
          className={cn(
            'tt-board-link-preview-btn nodrag nopan',
            previewActive && 'tt-board-link-preview-active'
          )}
          title={previewActive ? 'Close board preview' : 'Open board preview'}
          onPointerEnter={() => actions.prefetch(boardId)} // Warm iframe before click
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            if (previewActive) actions.closePreview()
            else actions.openPreview(boardId)
          }}
        >
          <AppWindow className="h-3.5 w-3.5" />
        </button>
        {/* Open the full Thinktable page */}
        <button
          type="button"
          className="tt-board-link-preview-btn nodrag nopan"
          title="Open full board"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            actions.openBoard(boardId)
          }}
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
        {/* Notion-linked: Notion icon right of open → source page in Notion */}
        {notionUrl ? (
          <button
            type="button"
            className="tt-board-link-preview-btn nodrag nopan"
            title="Open in Notion"
            aria-label="Open in Notion"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              window.open(notionUrl, '_blank', 'noopener,noreferrer') // External Notion deep link
            }}
          >
            <NotionMarkIcon className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </span>
    )
  }
)
