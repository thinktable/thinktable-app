'use client'

// Shared page open menu: [preview AppWindow] + [open-full ↗] + optional [Notion icon].
// Used by pageLink NodeViews and by page frames whose content is still regular TipTap blocks
// (linkedPageId, no pageLink yet). Notion-linked frames add the Notion mark right of open.

import { forwardRef, type CSSProperties } from 'react'
import { AppWindow, ArrowUpRight } from 'lucide-react'
import { NotionMarkIcon } from '@/components/notion-mark-icon' // Same monochrome mark as top bar
import { usePageLinkActions } from '@/lib/page-link-context'
import { cn } from '@/lib/utils'

type PageOpenMenuProps = {
  pageId: string // Child page to preview / open
  /** Notion deep link — when set, shows Notion icon right of open (prop wins over context). */
  notionUrl?: string | null
  className?: string // Extra classes on the chrome wrapper (positioning)
  /** Inline layout overrides (e.g. clamped left within an unlocked clipped frame). */
  style?: CSSProperties
  /** Force visible (frame-level hover); pageLink still uses CSS :hover when false. */
  forceVisible?: boolean
}

export const PageOpenMenu = forwardRef<HTMLSpanElement, PageOpenMenuProps>(
  function PageOpenMenu({ pageId, notionUrl: notionUrlProp, className, style, forceVisible }, ref) {
    const actions = usePageLinkActions() // Host frame preview / open / prefetch / notionUrl
    const previewActive = actions.previewPageId === pageId // Highlight while this page is previewed
    const notionUrl = notionUrlProp ?? actions.notionUrl ?? null // Prop override, else frame context

    return (
      <span
        ref={ref}
        data-page-link-preview
        className={cn(
          'tt-page-link-preview',
          forceVisible && 'tt-page-link-preview-force', // Visible without hovering the pageLink itself
          className
        )}
        style={style}
      >
        {/* Toggle the in-place iframe preview */}
        <button
          type="button"
          className={cn('tt-page-link-preview-btn', previewActive && 'tt-page-link-preview-active')}
          title={previewActive ? 'Close page preview' : 'Open page preview'}
          onPointerEnter={() => actions.prefetch(pageId)} // Warm iframe before click
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            if (previewActive) actions.closePreview()
            else actions.openPreview(pageId)
          }}
        >
          <AppWindow className="h-3.5 w-3.5" />
        </button>
        {/* Open the full Thinktable page */}
        <button
          type="button"
          className="tt-page-link-preview-btn"
          title="Open full page"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            actions.openPage(pageId)
          }}
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
        {/* Notion-linked: Notion icon right of open → source page in Notion */}
        {notionUrl ? (
          <button
            type="button"
            className="tt-page-link-preview-btn"
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
