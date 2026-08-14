'use client'

// Full-height right chat column — Thinktable AI copilot (Ask in sidebar; drag blocks onto page)
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react' // Hooks
import { createPortal } from 'react-dom' // Phone dock must paint on the map, not inside clipped main
import {
  useSidebarContext,
  CHAT_SIDEBAR_WIDTH,
  TT_CHAT_THREAD_ID_KEY,
} from './sidebar-context' // Open state + logo + thread persist key
import { ThinktableBrandMark, PersonalizeAiModal } from './personalize-ai-modal' // Brand
import { AiThreadPicker, type AiThreadFilter } from './ai/ai-thread-picker' // History
import { AiTranscript } from './ai/ai-transcript' // Turns
import {
  AiTranscriptPlaceholder,
  ChatLoadStage,
  isChatTranscriptLoading,
  useChatLoadReveal,
} from './ai/ai-chat-load' // Load shimmer → fade-out → transcript fade-in
import { AiComposer, regenerateAfterEdit } from './ai/ai-composer' // Composer
import { AiPromptBars } from './ai/ai-prompt-bars' // Compact prompt stack / phone list
import type { AiContextSnapshot, AiMessage, AiThread } from '@/lib/ai/types' // Types
import { isSelectableAiMode } from '@/lib/ai/modes'
import { useAiEditSession, buildFramePendingEdit, buildCreateFramePendingEdit, buildCreateThreadPendingEdit } from '@/lib/ai/edit-session'
import { htmlToPlain } from '@/lib/ai/context-pack' // Plain excerpts for snapshots
import { createClient } from '@/lib/supabase/client' // Snapshot frame load
import { cn } from '@/lib/utils' // cn
import {
  ChevronsRight,
  MessageSquarePlus,
  Pencil,
} from 'lucide-react' // Icons

interface ChatSidebarProps {
  conversationId?: string // Current board id
  projectId?: string // Kept for call-site compat
}

/** Write / clear the active thread id so reload restores the same chat. */
function persistActiveThreadId(threadId: string | null) {
  if (typeof window === 'undefined') return // No storage on server
  if (threadId) localStorage.setItem(TT_CHAT_THREAD_ID_KEY, threadId) // Remember thread
  else localStorage.removeItem(TT_CHAT_THREAD_ID_KEY) // New chat / cleared
}

export function ChatSidebar({ conversationId }: ChatSidebarProps) {
  const {
    isChatSidebarOpen,
    setChatSidebarOpen,
    isMobileMode,
    logoDrawing,
    setLogoDrawing,
    setAiMapDockLiftPx,
    setAiMapDockLeftPx,
    setAiChatHasTranscript,
    closeSidebar,
  } = useSidebarContext()
  const { addPendingEdits } = useAiEditSession()
  const [personalizeOpen, setPersonalizeOpen] = useState(false) // Logo modal
  const [hoverBrand, setHoverBrand] = useState(false) // Personalize pill
  const [thread, setThread] = useState<AiThread | null>(null) // Active thread
  const [filter, setFilter] = useState<AiThreadFilter>('all') // History filter
  const [messages, setMessages] = useState<AiMessage[]>([]) // Transcript
  const [streamingId, setStreamingId] = useState<string | null>(null) // Live assistant
  const [mode, setMode] = useState<'ask' | 'edit'>('ask') // Composer mode
  const [seedPrompt, setSeedPrompt] = useState<string | undefined>(undefined) // Quick action
  const [attachedSnapshots, setAttachedSnapshots] = useState<AiContextSnapshot[]>([]) // Chips
  const [refreshKey, setRefreshKey] = useState(0) // Thread list refresh
  const [savedSnapshots, setSavedSnapshots] = useState<AiContextSnapshot[]>([]) // Library
  // Phone: lift dock above the soft keyboard via visualViewport inset
  const [keyboardInset, setKeyboardInset] = useState(0)
  const mapDockRef = useRef<HTMLDivElement>(null) // Outer shell (keyboard inset)
  const mapDockContentRef = useRef<HTMLDivElement>(null) // Inner max-w-lg — left edge Free nav aligns to
  const [mapRoot, setMapRoot] = useState<HTMLElement | null>(null) // BoardFlow root — phone dock host

  const [threadHydrated, setThreadHydrated] = useState(false) // False until restore finishes (SSR + client match)
  const [loadedThreadId, setLoadedThreadId] = useState<string | null>(null) // Thread whose messages are in state

  // Publish whether the chat box (transcript) has messages — Free nav fill depends on it
  useEffect(() => {
    const loading = isChatTranscriptLoading(
      threadHydrated,
      thread?.id,
      loadedThreadId,
      messages.length > 0
    ) // Placeholder occupies the transcript card, so treat it as “has transcript”
    setAiChatHasTranscript(messages.length > 0 || loading)
    return () => setAiChatHasTranscript(false) // Clear on unmount
  }, [messages.length, threadHydrated, thread?.id, loadedThreadId, setAiChatHasTranscript])

  // Restore the last active thread once on mount (same chat after reload)
  useEffect(() => {
    if (typeof window === 'undefined') { // SSR guard
      setThreadHydrated(true) // Nothing to restore on server
      return
    }
    const storedId = localStorage.getItem(TT_CHAT_THREAD_ID_KEY) // Last thread id
    if (!storedId) {
      setThreadHydrated(true) // No saved chat — allow later persists
      return
    }
    let cancelled = false // Unmount / Strict Mode remount guard
    const restore = async () => {
      try {
        const res = await fetch(`/api/ai/threads/${storedId}`) // Load owned thread
        if (!res.ok) {
          if (!cancelled) persistActiveThreadId(null) // Stale / deleted — drop key
          return
        }
        const data = await res.json() // Parse
        const t = data.thread as AiThread | undefined // Thread row
        if (cancelled || !t) return // Bail if gone
        setThread(t) // Reopen same chat
        setMode(isSelectableAiMode(t.mode) ? t.mode : 'ask') // Match saved mode
      } finally {
        if (!cancelled) setThreadHydrated(true) // Unlock persist after restore attempt
      }
    }
    void restore() // Fire
    return () => {
      cancelled = true // Cancel late apply / skip hydrated on aborted mount
    }
  }, [])

  // Persist thread only after restore — mount-null must not wipe the stored id
  useEffect(() => {
    if (!threadHydrated) return // Wait until restore finished (or found nothing)
    persistActiveThreadId(thread?.id ?? null) // Persist select / clear on new
  }, [thread?.id, threadHydrated])

  useEffect(() => {
    if (!thread?.id) {
      setMessages([])
      setLoadedThreadId(null) // New chat — nothing to restore
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`/api/ai/threads/${thread.id}/messages`)
        const data = res.ok ? await res.json() : { messages: [] }
        if (!cancelled) {
          setMessages(data.messages || [])
          setLoadedThreadId(thread.id) // Unlock reveal even when the fetch is empty / failed
        }
      } catch {
        if (!cancelled) {
          setMessages([])
          setLoadedThreadId(thread.id) // Don't leave the placeholder spinning
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [thread?.id])
  useEffect(() => {
    if (!isChatSidebarOpen) return
    let cancelled = false
    const load = async () => {
      const res = await fetch('/api/ai/snapshots')
      if (!res.ok) return
      const data = await res.json()
      if (!cancelled) setSavedSnapshots(data.snapshots || [])
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [isChatSidebarOpen, refreshKey])

  // Phone dock host: BoardFlow root (absolute inset-0) — escapes main overflow-hidden clipping
  useLayoutEffect(() => {
    if (!isMobileMode) {
      setMapRoot(null) // Desktop uses the column, not the map portal
      return
    }
    let cancelled = false // Strict Mode / unmount
    const sync = () => {
      const el = document.querySelector('[data-board-root]') as HTMLElement | null
      if (!cancelled) setMapRoot(el)
      return !!el
    }
    if (sync()) return // Board already mounted (sibling under the same page)
    const id = requestAnimationFrame(() => {
      sync() // One frame retry if BoardFlow paints after this layout
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(id)
    }
  }, [isMobileMode, conversationId]) // Board remounts when the route id changes

  // Phone: boards-nav scrim (z-40) would cover the dock — close nav when chat is open
  useEffect(() => {
    if (isMobileMode && isChatSidebarOpen) closeSidebar()
  }, [isMobileMode, isChatSidebarOpen, closeSidebar])

  // Phone dock: track how much of the layout viewport the keyboard covers
  useEffect(() => {
    if (!isChatSidebarOpen || !isMobileMode) {
      setKeyboardInset(0)
      return
    }
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      // Covered height below the visual viewport (keyboard / browser chrome)
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      setKeyboardInset(inset)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [isChatSidebarOpen, isMobileMode])

  // Phone: publish dock+keyboard lift + left so Free nav sits above and flush with the composer
  // useLayoutEffect + geometric left so Free nav snaps aligned on the same frame (no lag)
  useLayoutEffect(() => {
    if (!isMobileMode || !isChatSidebarOpen) {
      setAiMapDockLiftPx(0) // No lift when closed / desktop
      setAiMapDockLeftPx(null) // Restore default MINIMAP_LEFT
      return
    }
    // Geometric left of centered max-w-lg card inside px-2 shell — available before measure
    const syncGeometricLeft = () => {
      const vw = window.innerWidth
      const contentW = Math.min(vw - 16, 512) // max-w-lg = 32rem
      setAiMapDockLeftPx(Math.round((vw - contentW) / 2))
    }
    syncGeometricLeft() // Instant left so Free nav never starts at MINIMAP_LEFT then slides
    const shell = mapDockRef.current
    const content = mapDockContentRef.current
    if (!shell || !content) {
      // Closed-opacity dock still mounted — estimate composer height until next open paint
      setAiMapDockLiftPx(Math.round(72 + keyboardInset + 2)) // Tight to chat when estimate only
      return
    }
    const publish = () => {
      const h = shell.offsetHeight // Composer (+ transcript / chrome) height
      setAiMapDockLiftPx(Math.round(h + keyboardInset + 2)) // + keyboard + small gap to chat
      // Prefer measured left (safe-area / subpixel) over geometric
      setAiMapDockLeftPx(Math.round(content.getBoundingClientRect().left))
    }
    const onResize = () => {
      syncGeometricLeft()
      publish()
    }
    publish()
    const ro = new ResizeObserver(publish) // Grow/shrink with transcript / wrap / rotate
    ro.observe(shell)
    ro.observe(content)
    window.addEventListener('resize', onResize)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onResize)
      setAiMapDockLiftPx(0)
      setAiMapDockLeftPx(null)
    }
  }, [
    isMobileMode,
    isChatSidebarOpen,
    keyboardInset,
    setAiMapDockLiftPx,
    setAiMapDockLeftPx,
    messages.length,
  ])

  const handleNew = useCallback(() => {
    setThread(null)
    setMessages([])
    setLoadedThreadId(null) // Don't treat the next thread as already loaded
    setStreamingId(null)
    setAttachedSnapshots([])
    setMode('ask')
  }, [])

  /** Scroll the transcript to a user prompt picked from the compact bars. */
  const handleJumpToMessage = useCallback((messageId: string) => {
    const el = document.querySelector(`[data-ai-turn="${messageId}"]`) // Row stamped in AiTranscript
    const root = document.querySelector('[data-ai-transcript-scroll]') // Phone card / sidebar scroller
    if (!el || !root) return // Nothing to jump to
    const delta = el.getBoundingClientRect().top - root.getBoundingClientRect().top // Align turn to the visible top
    root.scrollTo({ top: root.scrollTop + delta, behavior: 'smooth' }) // Only the transcript, not the page
  }, [])

  const handleEditUserMessage = useCallback(
    async (messageId: string, content: string) => {
      const res = await fetch(`/api/ai/messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      const truncated: string[] = data.truncatedIds || []
      setMessages((prev) =>
        prev
          .filter((m) => !truncated.includes(m.id))
          .map((m) => (m.id === messageId ? data.message : m))
      )
      const threadId = (data.threadId as string) || thread?.id
      if (!threadId) return
      await regenerateAfterEdit({
        message: content,
        threadId,
        boardId: conversationId,
        snapshotIds: attachedSnapshots.map((s) => s.id),
        onMessagesDelta: setMessages,
        onStreamingId: setStreamingId,
      })
      setRefreshKey((k) => k + 1)
    },
    [thread?.id, conversationId, attachedSnapshots]
  )

  const handleSaveSnapshot = useCallback(
    async (message: AiMessage) => {
      let frames: Array<{ id: string; text: string }> = []
      if (conversationId) {
        const supabase = createClient()
        const { data } = await supabase
          .from('messages')
          .select('id, content, metadata')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true })
          .limit(30)
        frames = (data || []).map((m) => ({
          id: m.id as string,
          text: htmlToPlain(m.content as string).slice(0, 400),
        }))
      }
      const name = `Snapshot · ${message.content.slice(0, 40) || 'chat'}`
      const res = await fetch('/api/ai/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          threadId: message.thread_id,
          messageId: message.id,
          payload: {
            boardId: conversationId || null,
            anchorMessageId: message.id,
            anchorRole: message.role,
            anchorContent: message.content.slice(0, 2000),
            frames,
          },
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      if (data.snapshot) {
        setSavedSnapshots((prev) => [data.snapshot, ...prev])
        setAttachedSnapshots((prev) =>
          prev.some((s) => s.id === data.snapshot.id) ? prev : [...prev, data.snapshot]
        )
      }
      setRefreshKey((k) => k + 1)
    },
    [conversationId]
  )

  /** Drop chat turn onto composer → save + attach context (not paste into the box). */
  const handleAttachChatBlock = useCallback(
    async (payload: { messageId: string; plain: string }) => {
      const existing = messages.find((m) => m.id === payload.messageId)
      const message: AiMessage =
        existing ||
        ({
          id: payload.messageId,
          thread_id: thread?.id || '',
          user_id: '',
          role: 'assistant',
          content: payload.plain,
          parts: [{ type: 'text', text: payload.plain }],
          parent_id: null,
          status: 'complete',
          metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as AiMessage)
      // Reuse if this message already has an attached snapshot chip
      const already = attachedSnapshots.find((s) => s.message_id === payload.messageId)
      if (already) return
      await handleSaveSnapshot(message)
    },
    [messages, thread?.id, attachedSnapshots, handleSaveSnapshot]
  )

  const hasTranscript = messages.length > 0
  const chatLoading = isChatTranscriptLoading(
    threadHydrated,
    thread?.id,
    loadedThreadId,
    messages.length > 0
  ) // Restore only — don’t cover a live first send
  const loadPhase = useChatLoadReveal(chatLoading) // Placeholder out, then content in
  const showLoadPlaceholder = loadPhase === 'placeholder' || loadPhase === 'out' // Keep phone card during fade-out

  if (!isChatSidebarOpen && !isMobileMode) return null // Desktop: unmount when closed; phone: keep dock mounted for same-tap focus

  const promptBarProps = {
    boardId: conversationId, // This-board recents when the picker is filtered
    filter, // Match the thread picker
    thread, // Skip the open chat in the recent fallback
    messages, // In-thread user prompts
    refreshKey, // Refetch recents after send
    onSeedPrompt: (prompt: string) => setSeedPrompt(prompt), // Starter → composer
    onSelectThread: (t: AiThread) => {
      setThread(t) // Open that chat
      setMode(isSelectableAiMode(t.mode) ? t.mode : 'ask') // Match saved mode
    },
    onJumpToMessage: handleJumpToMessage, // Scroll to a user turn
  }

  // Shared composer props (desktop column + phone map dock)
  const composer = (
    <AiComposer
      boardId={conversationId}
      thread={thread}
      mode={mode}
      onModeChange={setMode}
      attachedSnapshots={attachedSnapshots}
      onRemoveSnapshot={(id) =>
        setAttachedSnapshots((prev) => prev.filter((s) => s.id !== id))
      }
      onAttachChatBlock={handleAttachChatBlock}
      onThreadEnsured={(t) => {
        setThread(t)
        setRefreshKey((k) => k + 1)
      }}
      onMessagesDelta={setMessages}
      onStreamingId={setStreamingId}
      seedPrompt={seedPrompt}
      onSeedConsumed={() => setSeedPrompt(undefined)}
      autoFocus={false} // Brand tap focuses via registerAiComposerFocus (same user gesture)
      onEdits={async (edits) => {
        const mapped = edits
          .map((e) => {
            if (e.kind === 'create_frame' && e.frameId) {
              return buildCreateFramePendingEdit({
                messageId: e.frameId,
                contentHtml: e.contentHtml || '',
                summary: e.summary,
                actionLogId: e.actionLogId,
              })
            }
            if (e.kind === 'create_thread' && e.edgeId) {
              return buildCreateThreadPendingEdit({
                edgeId: e.edgeId,
                summary: e.summary,
                actionLogId: e.actionLogId,
                sourceFrameId: e.sourceFrameId,
                targetFrameId: e.targetFrameId,
              })
            }
            if (!e.frameId) return null
            return buildFramePendingEdit({
              messageId: e.frameId,
              originalContent: e.originalContent,
              contentHtml: e.contentHtml,
              replacements: e.replacements,
              summary: e.summary,
              actionLogId: e.actionLogId,
            })
          })
          .filter((e): e is NonNullable<typeof e> => e !== null)
        if (mapped.length) await addPendingEdits(mapped)
      }}
    />
  )

  // Phone: composer docks on the map above the keyboard — no sidebar column
  // Stay mounted while closed (invisible) so brand tap can focus() in the same gesture
  // Portal onto [data-board-root]: flex-sibling fixed inside main overflow-hidden is clipped
  if (isMobileMode) {
    // Prefer state; fall back to live query so the first phone frame after shrink still paints
    const host =
      mapRoot ??
      (typeof document !== 'undefined'
        ? (document.querySelector('[data-board-root]') as HTMLElement | null)
        : null)
    if (!host) return null // Board not in the DOM yet (rare — sibling under the same page)
    const dock = (
      <>
        <div
          ref={mapDockRef}
          data-chat-sidebar
          data-chat-map-dock
          className={cn(
            'absolute inset-x-0 px-2', // Absolute on the map (not fixed — board root is the box)
            isChatSidebarOpen ? 'z-[45]' : 'z-20' // Open above Free nav / scrim; closed below brand (z-40)
          )}
          aria-hidden={!isChatSidebarOpen}
          style={{
            bottom: isChatSidebarOpen ? keyboardInset : 0, // Sit just above the soft keyboard when open
            paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
            // Closed: opacity 0 only — visibility:hidden / display:none blocks iOS keyboard on focus()
            opacity: isChatSidebarOpen ? 1 : 0,
            pointerEvents: isChatSidebarOpen ? 'auto' : 'none',
          }}
        >
          <div
            ref={mapDockContentRef}
            // Transparent stack: transcript / chrome / prompt are separate rounded cards with map showing in gaps
            className={cn(
              'mx-auto w-full max-w-lg flex flex-col gap-1.5 bg-transparent',
              isChatSidebarOpen ? 'pointer-events-auto' : 'pointer-events-none'
            )}
          >
            {(isChatSidebarOpen && (hasTranscript || showLoadPlaceholder)) && (
              <div
                className={cn(
                  'relative rounded-xl min-h-[40px]', // Response box — ticks pin here, not in the composer
                  'bg-white/95 dark:bg-[#202020]/95 backdrop-blur-md',
                  'border border-black/10 dark:border-white/10 shadow-sm'
                )}
              >
                <div data-ai-transcript-scroll className="max-h-[32vh] overflow-y-auto px-3 py-2 pr-12">
                  <ChatLoadStage phase={loadPhase} placeholder={<AiTranscriptPlaceholder />}>
                    {hasTranscript ? (
                      <AiTranscript
                        messages={messages}
                        streamingId={streamingId}
                        onEditUserMessage={handleEditUserMessage}
                      />
                    ) : null}
                  </ChatLoadStage>
                </div>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10">
                  <AiPromptBars orientation="horizontal" {...promptBarProps} />
                </div>
              </div>
            )}
            {isChatSidebarOpen && (
              // Mid chrome: own rounded board-fill card — not fused to transcript or prompt
              <div
                className={cn(
                  'flex items-center gap-1 px-1.5 py-0.5 min-w-0 rounded-xl',
                  'bg-gray-50 dark:bg-[#0f0f0f]' // Board-fill card only — no border
                )}
              >
                <div className="flex-1 min-w-0 bg-transparent">
                  <AiThreadPicker
                    boardId={conversationId}
                    thread={thread}
                    filter={filter}
                    onFilterChange={setFilter}
                    onSelect={(t) => {
                      setThread(t)
                      setMode(isSelectableAiMode(t.mode) ? t.mode : 'ask')
                    }}
                    onNew={handleNew}
                    refreshKey={refreshKey}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleNew}
                  className="w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center bg-transparent border-0 shadow-none text-gray-600 dark:text-gray-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                  title="New chat"
                  aria-label="New chat"
                >
                  <MessageSquarePlus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setChatSidebarOpen(false)}
                  className="w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center bg-transparent border-0 shadow-none text-gray-600 dark:text-gray-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                  title="Close AI"
                  aria-label="Close AI chat"
                >
                  <ChevronsRight className="h-4 w-4" />
                </button>
              </div>
            )}
            <div className="rounded-xl overflow-hidden bg-white dark:bg-[#202020] border border-black/10 dark:border-white/10 shadow-lg">
              <div className="px-1 pt-1">{composer}</div>
            </div>
          </div>
        </div>
        <PersonalizeAiModal
          open={personalizeOpen}
          onOpenChange={setPersonalizeOpen}
          drawingUrl={logoDrawing}
          onDrawingChange={setLogoDrawing}
        />
      </>
    )
    return createPortal(dock, host) // Paint on the map — not as a clipped main flex sibling
  }

  if (!isChatSidebarOpen) return null // Desktop closed (belt-and-suspenders after early return)

  return (
    <div className="relative h-full flex flex-shrink-0 z-20">
      <aside
        data-chat-sidebar
        className={cn(
          'relative h-full flex flex-col', // relative so ticks pin to this column (site height)
          'bg-gray-50 dark:bg-[#0f0f0f]',
          'border-l border-black/10 dark:border-white/10'
        )}
        style={{ width: CHAT_SIDEBAR_WIDTH }}
      >
        <header className="flex-shrink-0 flex items-center justify-between gap-2 px-3 h-11">
          <AiThreadPicker
            boardId={conversationId}
            thread={thread}
            filter={filter}
            onFilterChange={setFilter}
            onSelect={(t) => {
              setThread(t)
              setMode(isSelectableAiMode(t.mode) ? t.mode : 'ask')
            }}
            onNew={handleNew}
            refreshKey={refreshKey}
          />

          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              type="button"
              onClick={handleNew}
              className="w-7 h-7 rounded-md flex items-center justify-center text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
              title="New chat"
              aria-label="New chat"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setChatSidebarOpen(false)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
              title="Hide chat"
              aria-label="Hide chat sidebar"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div data-ai-transcript-scroll className="flex-1 min-h-0 overflow-y-auto px-4 py-6 pr-8">
          <ChatLoadStage phase={loadPhase} placeholder={<AiTranscriptPlaceholder />}>
            {!hasTranscript ? (
            <div className="flex flex-col items-start gap-5 max-w-[280px] mx-auto mt-6">
              <div
                className="flex items-center gap-2.5"
                onMouseEnter={() => setHoverBrand(true)}
                onMouseLeave={() => setHoverBrand(false)}
              >
                <button
                  type="button"
                  onClick={() => setPersonalizeOpen(true)}
                  className="rounded-full overflow-visible focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                  title="Personalize Thinktable AI"
                  aria-label="Personalize Thinktable AI"
                >
                  <ThinktableBrandMark drawingUrl={logoDrawing} size={52} />
                </button>
                <button
                  type="button"
                  onClick={() => setPersonalizeOpen(true)}
                  className={cn(
                    'flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium',
                    'bg-black/[0.06] dark:bg-white/[0.08] text-gray-700 dark:text-gray-200',
                    'border border-black/5 dark:border-white/10',
                    'hover:bg-black/[0.1] dark:hover:bg-white/[0.12] transition-all',
                    hoverBrand
                      ? 'opacity-100 translate-x-0'
                      : 'opacity-0 -translate-x-1 pointer-events-none'
                  )}
                  tabIndex={hoverBrand ? 0 : -1}
                  aria-hidden={!hoverBrand}
                >
                  <Pencil className="h-3 w-3" />
                  Personalize
                </button>
              </div>

              <div>
                <h2 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-50">
                  What&apos;s on your mind?
                </h2>
                <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                  Ask in the sidebar. Drag a reply onto the page as a frame, or onto the input as context.
                </p>
              </div>

              {savedSnapshots.length > 0 && (
                <div className="w-full mt-2">
                  <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1 px-1">
                    Context snapshots
                  </div>
                  <ul className="flex flex-col gap-0.5">
                    {savedSnapshots.slice(0, 5).map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() =>
                            setAttachedSnapshots((prev) =>
                              prev.some((x) => x.id === s.id) ? prev : [...prev, s]
                            )
                          }
                          className="w-full text-left text-xs px-2 py-1.5 rounded-md text-gray-600 dark:text-gray-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] truncate"
                        >
                          {s.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <AiTranscript
              messages={messages}
              streamingId={streamingId}
              onEditUserMessage={handleEditUserMessage}
            />
          )}
          </ChatLoadStage>

          <div
            data-chat-return-slot
            className="flex justify-center items-center min-h-[44px] mt-4"
          />
        </div>

        <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10 pointer-events-auto">
          <AiPromptBars orientation="vertical" {...promptBarProps} />
        </div>

        <div className="flex-shrink-0 px-3 pb-3 pt-1 pointer-events-auto">
          <div className="rounded-xl overflow-hidden bg-white dark:bg-[#202020] border border-black/10 dark:border-white/10 shadow-sm">
            <div className="px-1 pt-1">{composer}</div>
          </div>
        </div>
      </aside>

      <PersonalizeAiModal
        open={personalizeOpen}
        onOpenChange={setPersonalizeOpen}
        drawingUrl={logoDrawing}
        onDrawingChange={setLogoDrawing}
      />
    </div>
  )
}
