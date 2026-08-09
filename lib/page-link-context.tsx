'use client'

// Bridges pageLink NodeViews (inside TipTap) to the host frame's page actions:
// open the in-place preview, open the full page, prefetch, and rename the linked page.

import { createContext, useContext } from 'react'

export type PageLinkActions = {
  /** Open the in-place iframe preview for this child page (reuses the frame's shell). */
  openPreview: (pageId: string) => void
  /** Close the in-place preview. */
  closePreview: () => void
  /** Which page is currently previewed (for active styling), or null. */
  previewPageId: string | null
  /** Navigate to the child page's own board (Expand). */
  openPage: (pageId: string) => void
  /** Warm /embed/{id} + mount the iframe before click (hover). */
  prefetch: (pageId: string) => void
  /** Persist a new title on the linked page (keeps node + page in sync). */
  renameTitle: (pageId: string, title: string) => void | Promise<void>
  /** Persist the page icon (emoji or null to clear) so the nav/menu match. */
  setIcon: (pageId: string, icon: string | null) => void | Promise<void>
  /** Notion deep link for this host frame (Open in Notion in the shared menu), or null. */
  notionUrl?: string | null
  /** Host frame's linkedPageId — lets sole databaseBlock frames use the same open menu. */
  hostLinkedPageId?: string | null
}

// Safe no-op default so NodeViews used outside a host frame don't crash.
const noop = () => {}
const PageLinkContext = createContext<PageLinkActions>({
  openPreview: noop,
  closePreview: noop,
  previewPageId: null,
  openPage: noop,
  prefetch: noop,
  renameTitle: noop,
  setIcon: noop,
  notionUrl: null,
  hostLinkedPageId: null,
})

export const PageLinkProvider = PageLinkContext.Provider // Provided by the host frame (chat-panel-node)

/** Read page actions inside a pageLink NodeView. */
export function usePageLinkActions(): PageLinkActions {
  return useContext(PageLinkContext)
}
