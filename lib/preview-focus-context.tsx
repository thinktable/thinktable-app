'use client'

// When a nested page preview’s top bar is selected, the parent map’s View toolbar
// edits that preview page’s board rule/style (not the host map’s).
// Style live-updates reach the iframe via postMessage (PREVIEW_STYLE_MESSAGE).

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { createClient } from '@/lib/supabase/client'

export const PREVIEW_STYLE_MESSAGE = 'thinktable-preview-style' // Host → iframe board style sync
export const PREVIEW_READY_MESSAGE = 'thinktable-preview-ready' // Iframe → host when pan/zoom is live
export const PREVIEW_RESIZE_MESSAGE = 'thinktable-preview-resize' // Host → iframe: container shown / size changed

type BoardRule = 'wide' | 'college' | 'narrow'
type BoardStyle = 'none' | 'dotted' | 'lined' | 'grid'

type PreviewFocusContextValue = {
  focusedBoardId: string | null // Linked page whose preview is style-selected
  focusedTitle: string | null
  boardRule: BoardRule // Styles shown/edited in the parent View toolbar while focused
  boardStyle: BoardStyle
  selectPreview: (opts: {
    pageId: string
    title: string
    boardRule?: BoardRule | null
    boardStyle?: BoardStyle | null
  }) => void
  clearPreviewFocus: () => void
  setBoardRule: (rule: BoardRule) => void
  setBoardStyle: (style: BoardStyle) => void
}

const PreviewFocusContext = createContext<PreviewFocusContextValue | null>(null)

async function persistBoardStyle(
  pageId: string,
  patch: { boardRule?: BoardRule; boardStyle?: BoardStyle }
) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  const { data: conversation } = await supabase
    .from('conversations')
    .select('metadata')
    .eq('id', pageId)
    .eq('user_id', user.id)
    .maybeSingle()

  const existing = (conversation?.metadata as Record<string, unknown>) || {}
  await supabase
    .from('conversations')
    .update({ metadata: { ...existing, ...patch } })
    .eq('id', pageId)
    .eq('user_id', user.id)

  // Keep local prefs cache in sync for the next open
  const storageKey = `thinktable-prefs-${pageId}`
  const local = JSON.parse(localStorage.getItem(storageKey) || '{}')
  localStorage.setItem(storageKey, JSON.stringify({ ...local, ...patch }))
}

export function PreviewFocusProvider({ children }: { children: ReactNode }) {
  const [focusedBoardId, setFocusedPageId] = useState<string | null>(null)
  const [focusedTitle, setFocusedTitle] = useState<string | null>(null)
  const [boardRule, setBoardRuleState] = useState<BoardRule>('college')
  const [boardStyle, setBoardStyleState] = useState<BoardStyle>('dotted')

  const selectPreview = useCallback(
    (opts: {
      pageId: string
      title: string
      boardRule?: BoardRule | null
      boardStyle?: BoardStyle | null
    }) => {
      setFocusedPageId(opts.pageId)
      setFocusedTitle(opts.title)
      if (opts.boardRule && ['wide', 'college', 'narrow'].includes(opts.boardRule)) {
        setBoardRuleState(opts.boardRule)
      }
      if (opts.boardStyle && ['none', 'dotted', 'lined', 'grid'].includes(opts.boardStyle)) {
        setBoardStyleState(opts.boardStyle)
      }
    },
    []
  )

  const clearPreviewFocus = useCallback(() => {
    setFocusedPageId(null)
    setFocusedTitle(null)
  }, [])

  const setBoardRule = useCallback(
    (rule: BoardRule) => {
      setBoardRuleState(rule)
      if (focusedBoardId) void persistBoardStyle(focusedBoardId, { boardRule: rule })
    },
    [focusedBoardId]
  )

  const setBoardStyle = useCallback(
    (style: BoardStyle) => {
      setBoardStyleState(style)
      if (focusedBoardId) void persistBoardStyle(focusedBoardId, { boardStyle: style })
    },
    [focusedBoardId]
  )

  const value = useMemo(
    () => ({
      focusedBoardId,
      focusedTitle,
      boardRule,
      boardStyle,
      selectPreview,
      clearPreviewFocus,
      setBoardRule,
      setBoardStyle,
    }),
    [
      focusedBoardId,
      focusedTitle,
      boardRule,
      boardStyle,
      selectPreview,
      clearPreviewFocus,
      setBoardRule,
      setBoardStyle,
    ]
  )

  return (
    <PreviewFocusContext.Provider value={value}>{children}</PreviewFocusContext.Provider>
  )
}

/** Returns null when no provider (embedded trees without host focus). */
export function usePreviewFocus() {
  return useContext(PreviewFocusContext)
}
