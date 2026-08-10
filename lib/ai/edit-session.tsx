'use client'

// Pending AI edit session — originals stay in DB until Save; eye/remove use in-memory proposals
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { createClient } from '@/lib/supabase/client'
import { promotePendingToOrigin } from '@/lib/ai/wrap-ai-html'
import {
  buildProposedHtml,
  type AiTextReplacement,
} from '@/lib/ai/apply-replacements'
import { generateUUID } from '@/lib/utils'

/** Input for queueing a pending edit — proposed HTML is built after re-reading DB original. */
export type AiPendingEditInput = {
  kind: AiPendingEditKind
  messageId?: string
  edgeId?: string
  summary: string
  /** Hint only — live DB content wins for update_frame. */
  originalContent?: string
  /** Pre-built proposal (skips rebuild). */
  proposedContent?: string
  contentHtml?: string
  replacements?: AiTextReplacement[]
  actionLogId?: string
}

export type AiPendingEditKind = 'update_frame' | 'create_frame' | 'update_thread'

export interface AiPendingEdit {
  id: string
  kind: AiPendingEditKind
  messageId?: string
  edgeId?: string
  summary: string
  /** Exact page content before the proposal (never written over until discard/save resolves). */
  originalContent: string
  /** Proposed HTML with ai-pending marks (shown on page until save/discard). */
  proposedContent: string
  actionLogId?: string
}

interface AiEditSessionValue {
  pendingEdits: AiPendingEdit[]
  previewOriginal: boolean
  showAiOrigin: boolean
  focusedEditId: string | null
  /** messageId → original HTML right after Remove (panel consumes once). */
  justRestoredByMessage: Record<string, string>
  setShowAiOrigin: (v: boolean) => void
  setPreviewOriginal: (v: boolean) => void
  setFocusedEditId: (id: string | null) => void
  consumeRestoredContent: (messageId: string) => void
  addPendingEdits: (edits: AiPendingEditInput[]) => void | Promise<void>
  saveEdit: (id: string) => Promise<void>
  discardEdit: (id: string) => Promise<void>
  saveAll: () => Promise<void>
  discardAll: () => Promise<void>
  displayContentFor: (messageId: string, liveContent: string) => string
  isFramePending: (messageId: string) => boolean
  isThreadPending: (edgeId: string) => boolean
  pendingForMessage: (messageId: string) => AiPendingEdit | undefined
}

const AiEditSessionContext = createContext<AiEditSessionValue | null>(null)

const SHOW_AI_ORIGIN_KEY = 'thinktable-show-ai-origin'

function bumpMessages(detail?: {
  contentUpdates?: Array<{ messageId: string; content: string }>
}) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ai-edits-mutated', { detail }))
  }
}

export function AiEditSessionProvider({
  children,
  onMessagesMutated,
}: {
  children: ReactNode
  onMessagesMutated?: () => void
}) {
  const [pendingEdits, setPendingEdits] = useState<AiPendingEdit[]>([])
  const [previewOriginal, setPreviewOriginal] = useState(false)
  const [focusedEditId, setFocusedEditId] = useState<string | null>(null)
  const [showAiOrigin, setShowAiOriginState] = useState(false)
  const [justRestoredByMessage, setJustRestoredByMessage] = useState<Record<string, string>>({})

  const consumeRestoredContent = useCallback((messageId: string) => {
    setJustRestoredByMessage((prev) => {
      if (!(messageId in prev)) return prev
      const next = { ...prev }
      delete next[messageId]
      return next
    })
  }, [])

  useEffect(() => {
    try {
      const on = localStorage.getItem(SHOW_AI_ORIGIN_KEY) === '1'
      setShowAiOriginState(on)
      document.documentElement.classList.toggle('tt-show-ai-origin', on)
    } catch {
      /* ignore */
    }
  }, [])

  const setShowAiOrigin = useCallback((v: boolean) => {
    setShowAiOriginState(v)
    try {
      localStorage.setItem(SHOW_AI_ORIGIN_KEY, v ? '1' : '0')
    } catch {
      /* ignore */
    }
    document.documentElement.classList.toggle('tt-show-ai-origin', v)
  }, [])

  const persistFrameContent = useCallback(async (messageId: string, content: string) => {
    const supabase = createClient()
    const { error } = await supabase.from('messages').update({ content }).eq('id', messageId)
    if (error) throw error
  }, [])

  const persistFrameMeta = useCallback(
    async (messageId: string, patch: Record<string, unknown>) => {
      const supabase = createClient()
      const { data } = await supabase.from('messages').select('metadata').eq('id', messageId).single()
      const meta = { ...((data?.metadata as Record<string, unknown>) || {}), ...patch }
      const { error } = await supabase.from('messages').update({ metadata: meta }).eq('id', messageId)
      if (error) throw error
    },
    []
  )

  /** Queue proposals in memory only — DB keeps original until Save. */
  const addPendingEdits = useCallback(
    async (edits: AiPendingEditInput[]) => {
      const supabase = createClient()
      const withIds: AiPendingEdit[] = []

      for (const e of edits) {
        let original = e.originalContent || ''
        // Always re-read live DB content as source of truth for original (ignore stale SSE)
        if (e.kind === 'update_frame' && e.messageId) {
          const { data: msg } = await supabase
            .from('messages')
            .select('content')
            .eq('id', e.messageId)
            .maybeSingle()
          if (typeof msg?.content === 'string') original = msg.content
          // Soft-flag metadata for chrome without mutating content
          await persistFrameMeta(e.messageId, { aiPendingEdit: true })
        }
        // Build proposal against the live original so eye/remove match DB
        const proposed =
          e.proposedContent ||
          buildProposedHtml({
            originalHtml: original,
            contentHtml: e.contentHtml,
            replacements: e.replacements,
          })
        withIds.push({
          id: generateUUID(),
          kind: e.kind,
          messageId: e.messageId,
          edgeId: e.edgeId,
          summary: e.summary,
          originalContent: original,
          proposedContent: proposed,
          actionLogId: e.actionLogId,
        })
      }

      setPendingEdits((prev) => {
        // Replace any existing pending for the same frame (latest proposal wins)
        const withoutDupes = prev.filter(
          (p) => !withIds.some((n) => n.messageId && n.messageId === p.messageId)
        )
        return [...withoutDupes, ...withIds]
      })
      setPreviewOriginal(false)
      onMessagesMutated?.()
      bumpMessages()
    },
    [persistFrameMeta, onMessagesMutated]
  )

  const saveEdit = useCallback(
    async (id: string) => {
      const edit = pendingEdits.find((e) => e.id === id)
      if (!edit) return
      if (edit.kind === 'update_frame' && edit.messageId) {
        const finalHtml = promotePendingToOrigin(edit.proposedContent)
        await persistFrameContent(edit.messageId, finalHtml)
        await persistFrameMeta(edit.messageId, {
          aiPendingEdit: false,
          hasAiOrigin: true,
        })
        if (edit.actionLogId) {
          const supabase = createClient()
          await supabase
            .from('ai_action_log')
            .update({ status: 'applied' })
            .eq('id', edit.actionLogId)
        }
        setJustRestoredByMessage((prev) => ({
          ...prev,
          [edit.messageId!]: finalHtml,
        }))
      }
      setPendingEdits((prev) => prev.filter((e) => e.id !== id))
      if (focusedEditId === id) setFocusedEditId(null)
      onMessagesMutated?.()
      bumpMessages(
        edit.messageId
          ? {
              contentUpdates: [
                {
                  messageId: edit.messageId,
                  content: promotePendingToOrigin(edit.proposedContent),
                },
              ],
            }
          : undefined
      )
    },
    [pendingEdits, persistFrameContent, persistFrameMeta, focusedEditId, onMessagesMutated]
  )

  const discardEdit = useCallback(
    async (id: string) => {
      const edit = pendingEdits.find((e) => e.id === id)
      if (!edit) return
      // DB was never overwritten with the proposal — just clear the flag + session entry
      if (edit.kind === 'update_frame' && edit.messageId) {
        await persistFrameMeta(edit.messageId, { aiPendingEdit: false })
        // Ensure DB still has original (no-op if untouched; heals if something else wrote)
        await persistFrameContent(edit.messageId, edit.originalContent)
        if (edit.actionLogId) {
          const supabase = createClient()
          await supabase
            .from('ai_action_log')
            .update({ status: 'undone' })
            .eq('id', edit.actionLogId)
        }
        setJustRestoredByMessage((prev) => ({
          ...prev,
          [edit.messageId!]: edit.originalContent,
        }))
      }
      setPendingEdits((prev) => prev.filter((e) => e.id !== id))
      if (focusedEditId === id) setFocusedEditId(null)
      setPreviewOriginal(false)
      onMessagesMutated?.()
      bumpMessages(
        edit.messageId
          ? { contentUpdates: [{ messageId: edit.messageId, content: edit.originalContent }] }
          : undefined
      )
    },
    [pendingEdits, persistFrameContent, persistFrameMeta, focusedEditId, onMessagesMutated]
  )

  const saveAll = useCallback(async () => {
    const snapshot = [...pendingEdits]
    const restored: Record<string, string> = {}
    for (const edit of snapshot) {
      if (edit.kind === 'update_frame' && edit.messageId) {
        const finalHtml = promotePendingToOrigin(edit.proposedContent)
        await persistFrameContent(edit.messageId, finalHtml)
        await persistFrameMeta(edit.messageId, {
          aiPendingEdit: false,
          hasAiOrigin: true,
        })
        if (edit.actionLogId) {
          const supabase = createClient()
          await supabase
            .from('ai_action_log')
            .update({ status: 'applied' })
            .eq('id', edit.actionLogId)
        }
        restored[edit.messageId] = finalHtml
      }
    }
    setJustRestoredByMessage((prev) => ({ ...prev, ...restored }))
    setPendingEdits([])
    setFocusedEditId(null)
    setPreviewOriginal(false)
    onMessagesMutated?.()
    bumpMessages({
      contentUpdates: Object.entries(restored).map(([messageId, content]) => ({
        messageId,
        content,
      })),
    })
  }, [pendingEdits, persistFrameContent, persistFrameMeta, onMessagesMutated])

  const discardAll = useCallback(async () => {
    const snapshot = [...pendingEdits]
    const restored: Record<string, string> = {}
    for (const edit of snapshot) {
      if (edit.kind === 'update_frame' && edit.messageId) {
        await persistFrameMeta(edit.messageId, { aiPendingEdit: false })
        await persistFrameContent(edit.messageId, edit.originalContent)
        if (edit.actionLogId) {
          const supabase = createClient()
          await supabase
            .from('ai_action_log')
            .update({ status: 'undone' })
            .eq('id', edit.actionLogId)
        }
        restored[edit.messageId] = edit.originalContent
      }
    }
    setJustRestoredByMessage((prev) => ({ ...prev, ...restored }))
    setPendingEdits([])
    setFocusedEditId(null)
    setPreviewOriginal(false)
    onMessagesMutated?.()
    bumpMessages({
      contentUpdates: Object.entries(restored).map(([messageId, content]) => ({
        messageId,
        content,
      })),
    })
  }, [pendingEdits, persistFrameContent, persistFrameMeta, onMessagesMutated])

  const displayContentFor = useCallback(
    (messageId: string, liveContent: string) => {
      const edit = pendingEdits.find((e) => e.messageId === messageId)
      if (!edit) return liveContent
      // Eye on → original; eye off → proposed (DB live content stays original until save)
      return previewOriginal ? edit.originalContent : edit.proposedContent
    },
    [pendingEdits, previewOriginal]
  )

  const isFramePending = useCallback(
    (messageId: string) => pendingEdits.some((e) => e.messageId === messageId),
    [pendingEdits]
  )

  const isThreadPending = useCallback(
    (edgeId: string) => pendingEdits.some((e) => e.edgeId === edgeId),
    [pendingEdits]
  )

  const pendingForMessage = useCallback(
    (messageId: string) => pendingEdits.find((e) => e.messageId === messageId),
    [pendingEdits]
  )

  const value = useMemo<AiEditSessionValue>(
    () => ({
      pendingEdits,
      previewOriginal,
      showAiOrigin,
      focusedEditId,
      justRestoredByMessage,
      setShowAiOrigin,
      setPreviewOriginal,
      setFocusedEditId,
      consumeRestoredContent,
      addPendingEdits,
      saveEdit,
      discardEdit,
      saveAll,
      discardAll,
      displayContentFor,
      isFramePending,
      isThreadPending,
      pendingForMessage,
    }),
    [
      pendingEdits,
      previewOriginal,
      showAiOrigin,
      focusedEditId,
      justRestoredByMessage,
      setShowAiOrigin,
      consumeRestoredContent,
      addPendingEdits,
      saveEdit,
      discardEdit,
      saveAll,
      discardAll,
      displayContentFor,
      isFramePending,
      isThreadPending,
      pendingForMessage,
    ]
  )

  return (
    <AiEditSessionContext.Provider value={value}>{children}</AiEditSessionContext.Provider>
  )
}

export function useAiEditSession(): AiEditSessionValue {
  const ctx = useContext(AiEditSessionContext)
  if (!ctx) {
    return {
      pendingEdits: [],
      previewOriginal: false,
      showAiOrigin: false,
      focusedEditId: null,
      justRestoredByMessage: {},
      setShowAiOrigin: () => {},
      setPreviewOriginal: () => {},
      setFocusedEditId: () => {},
      consumeRestoredContent: () => {},
      addPendingEdits: () => {},
      saveEdit: async () => {},
      discardEdit: async () => {},
      saveAll: async () => {},
      discardAll: async () => {},
      displayContentFor: (_id, live) => live,
      isFramePending: () => false,
      isThreadPending: () => false,
      pendingForMessage: () => undefined,
    }
  }
  return ctx
}

export function buildFramePendingEdit(opts: {
  messageId: string
  originalContent?: string
  proposedHtml?: string
  contentHtml?: string
  replacements?: AiTextReplacement[]
  summary: string
  actionLogId?: string
}): AiPendingEditInput {
  return {
    kind: 'update_frame',
    messageId: opts.messageId,
    summary: opts.summary,
    originalContent: opts.originalContent,
    proposedContent: opts.proposedHtml,
    contentHtml: opts.contentHtml,
    replacements: opts.replacements,
    actionLogId: opts.actionLogId,
  }
}
