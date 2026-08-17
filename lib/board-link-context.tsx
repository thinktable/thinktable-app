'use client'

// Bridges boardLink NodeViews (inside TipTap) to the host frame's page actions:
// open the in-place preview, open the full page, prefetch, and rename the linked page.

import { createContext, useContext } from 'react'

export type BoardLinkActions = {
  /** Open the in-place iframe preview for this child page (reuses the frame's shell). */
  openPreview: (pageId: string) => void
  /** Close the in-place preview. */
  closePreview: () => void
  /** Which page is currently previewed (for active styling), or null. */
  previewBoardId: string | null
  /** Navigate to the child page's own board (Expand). */
  openBoard: (pageId: string) => void
  /** Warm /embed/{id} + mount the iframe before click (hover). */
  prefetch: (pageId: string) => void
  /** Persist a new title on the linked page (keeps node + page in sync). */
  renameTitle: (pageId: string, title: string) => void | Promise<void>
  /** Persist the page icon (emoji or null to clear) so the nav/menu match. */
  setIcon: (pageId: string, icon: string | null) => void | Promise<void>
  /** Notion deep link for this host frame (Open in Notion in the shared menu), or null. */
  notionUrl?: string | null
  /** Host frame's linkedBoardId — lets sole databaseBlock frames use the same open menu. */
  hostLinkedBoardId?: string | null
  /** Host frame message id — Convert layout from databaseBlock / row ⋮⋮. */
  hostMessageId?: string | null
  /** Board the host frame sits on — Convert layout API. */
  conversationId?: string | null
}

// Safe no-op default so NodeViews used outside a host frame don't crash.
const noop = () => {}
const BoardLinkContext = createContext<BoardLinkActions>({
  openPreview: noop,
  closePreview: noop,
  previewBoardId: null,
  openBoard: noop,
  prefetch: noop,
  renameTitle: noop,
  setIcon: noop,
  notionUrl: null,
  hostLinkedBoardId: null,
  hostMessageId: null,
  conversationId: null,
})

export const BoardLinkProvider = BoardLinkContext.Provider // Provided by the host frame (chat-panel-node)

/** Read page actions inside a boardLink NodeView. */
export function useBoardLinkActions(): BoardLinkActions {
  return useContext(BoardLinkContext)
}
