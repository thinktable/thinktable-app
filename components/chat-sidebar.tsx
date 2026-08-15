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
import { CustomizeAgentPanel } from './ai/customize-agent-panel' // Brand → customize agent
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
import {
  loadAgentDrafts,
  saveAgentDrafts,
  WORKSPACE_AGENT_ID,
} from '@/lib/ai/agents' // Personalize → custom agent icon
import { useAiEditSession, buildFramePendingEdit, buildCreateFramePendingEdit, buildCreateThreadPendingEdit } from '@/lib/ai/edit-session'
import { htmlToPlain } from '@/lib/ai/context-pack' // Plain excerpts for snapshots
import { createClient } from '@/lib/supabase/client' // Snapshot frame load
import { cn } from '@/lib/utils' // cn
import {
  ArrowDown,
  ChevronsRight,
  MessageSquarePlus,
  Settings2,
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
    setPhoneDockTight,
    closeSidebar,
  } = useSidebarContext()
  const { addPendingEdits } = useAiEditSession()
  const [personalizeOpen, setPersonalizeOpen] = useState(false) // Logo draw modal
  const [personalizeDraftId, setPersonalizeDraftId] = useState<string | null>(null) // Which agent gets the icon
  const [customizeOpen, setCustomizeOpen] = useState(false) // Brand → customize panel
  const [agentIconRevision, setAgentIconRevision] = useState(0) // Reload custom icons after Done
  const [hoverBrand, setHoverBrand] = useState(false) // Customize pill on empty state
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
  const [dockMaxHeight, setDockMaxHeight] = useState<number | null>(null) // Cap so the dock cannot grow over the top bar
  const [dockCompact, setDockCompact] = useState(false) // Hide transcript + thread chrome when the strip is short
  const mapDockRef = useRef<HTMLDivElement>(null) // Outer shell (keyboard inset)
  const mapDockContentRef = useRef<HTMLDivElement>(null) // Inner max-w-lg — left edge Free nav aligns to
  const [mapRoot, setMapRoot] = useState<HTMLElement | null>(null) // BoardFlow root — phone dock host

  const [threadHydrated, setThreadHydrated] = useState(false) // False until restore finishes (SSR + client match)
  const [loadedThreadId, setLoadedThreadId] = useState<string | null>(null) // Thread whose messages are in state
  const [showReturnToBottom, setShowReturnToBottom] = useState(false) // Transcript scrolled away from bottom
  const transcriptScrollRef = useRef<HTMLDivElement>(null) // Phone content card or desktop sidebar scroller
  const scrolledOpenThreadRef = useRef<string | null>(null) // Which thread we already pinned to bottom on open
  /** Distance from bottom — survives phone↔desktop remounts on resize */
  const scrollAnchorRef = useRef<{ threadId: string; fromBottom: number } | null>(null)
  const activeThreadIdRef = useRef<string | null>(null) // Latest thread id for scroll capture in listeners
  activeThreadIdRef.current = thread?.id ?? null

  /** Read the live transcript scroller (desktop column or phone card). */
  const getTranscriptScroller = useCallback((): HTMLElement | null => {
    return (
      transcriptScrollRef.current ??
      (document.querySelector('[data-ai-transcript-scroll]') as HTMLElement | null)
    )
  }, [])

  /** Apply a saved from-bottom offset onto the current scroller. */
  const restoreTranscriptScroll = useCallback(() => {
    const anchor = scrollAnchorRef.current
    const threadId = activeThreadIdRef.current
    if (!anchor || !threadId || anchor.threadId !== threadId) return
    const root = getTranscriptScroller()
    if (!root) return
    root.scrollTop = Math.max(0, root.scrollHeight - root.clientHeight - anchor.fromBottom)
    setShowReturnToBottom(anchor.fromBottom > 64)
  }, [getTranscriptScroller])

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

  // Show return-to-bottom only when a chat has turns and the scroller is not at the end
  useEffect(() => {
    if (messages.length === 0) {
      setShowReturnToBottom(false) // Empty “New AI chat” — never show
      return
    }
    const root = getTranscriptScroller()
    if (!root) {
      setShowReturnToBottom(false)
      return
    }
    let raf = 0
    const update = () => {
      const gap = root.scrollHeight - root.scrollTop - root.clientHeight
      const threadId = activeThreadIdRef.current
      if (threadId) scrollAnchorRef.current = { threadId, fromBottom: Math.max(0, gap) }
      setShowReturnToBottom(gap > 64) // Past a small threshold → offer jump down
    }
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        update()
      })
    }
    update()
    root.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(onScroll) // Streaming / layout growth
    ro.observe(root)
    if (root.firstElementChild) ro.observe(root.firstElementChild)
    return () => {
      // Capture from this node — ref may already point elsewhere mid phone↔desktop swap
      const threadId = activeThreadIdRef.current
      if (threadId) {
        const fromBottom = Math.max(0, root.scrollHeight - root.scrollTop - root.clientHeight)
        scrollAnchorRef.current = { threadId, fromBottom }
      }
      root.removeEventListener('scroll', onScroll)
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [messages.length, streamingId, isMobileMode, isChatSidebarOpen, dockCompact, getTranscriptScroller])

  // Phone↔desktop (or dock compact) remounts a new scroller at top — restore prior offset
  useLayoutEffect(() => {
    if (messages.length === 0) return
    restoreTranscriptScroll()
    const raf = requestAnimationFrame(() => restoreTranscriptScroll())
    return () => cancelAnimationFrame(raf)
  }, [isMobileMode, isChatSidebarOpen, dockCompact, messages.length, restoreTranscriptScroll])
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

  /** Brand mark → customize agent panel (not the draw modal). */
  const openCustomize = useCallback(() => {
    setCustomizeOpen(true)
  }, [])

  /** Draw modal for a draft — workspace agent writes the shared brand mark. */
  const openPersonalizeForDraft = useCallback((draftId: string) => {
    setPersonalizeDraftId(draftId)
    setPersonalizeOpen(true)
  }, [])

  /** Route Done: shared logo vs per-agent iconDrawing in localStorage. */
  const handleDrawingChange = useCallback(
    (url: string | null) => {
      const target = personalizeDraftId
      if (!target || target === WORKSPACE_AGENT_ID) {
        setLogoDrawing(url) // Workspace brand everywhere
      } else {
        const drafts = loadAgentDrafts()
        saveAgentDrafts(
          drafts.map((d) => (d.id === target ? { ...d, iconDrawing: url } : d))
        )
        setAgentIconRevision((n) => n + 1) // Panel reloads custom icons
      }
    },
    [personalizeDraftId, setLogoDrawing]
  )

  /** Seed the personalize canvas: shared brand or that draft's icon. */
  const personalizeDrawingUrl =
    personalizeDraftId && personalizeDraftId !== WORKSPACE_AGENT_ID
      ? loadAgentDrafts().find((d) => d.id === personalizeDraftId)?.iconDrawing ?? null
      : logoDrawing

  // Leaving chat closes customize so reopen lands on the transcript
  useEffect(() => {
    if (!isChatSidebarOpen) setCustomizeOpen(false)
  }, [isChatSidebarOpen])

  useEffect(() => {
    scrolledOpenThreadRef.current = null // New selection must pin to bottom again after load
    scrollAnchorRef.current = null // Don't restore the previous chat's offset
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

  // Phone dock: keyboard inset + height cap so landscape+keyboard cannot cover the top bar
  useLayoutEffect(() => {
    if (!isChatSidebarOpen || !isMobileMode) {
      setKeyboardInset(0) // Desktop / closed: no lift
      setDockMaxHeight(null) // No cap
      setDockCompact(false) // Show transcript + chrome when there is room
      setPhoneDockTight(false) // Restore the top bar / mode pill
      return
    }
    const TOP_CHROME_H = 96 // 52px top bar + mode pill at 56px — both sit in the same short landscape strip
    const COMPOSER_FLOOR = 72 // Ask row + padding — keep this fully on screen or iOS yanks it over the tools
    const DOCK_GAP = 8 // Air between the top chrome and the dock
    const EXTRAS_MIN = 148 // Transcript + thread chrome + composer
    const KEYBOARD_OPEN_PX = 80 // Treat as keyboard-up (ignore tiny address-bar insets)
    const update = () => {
      window.scrollTo(0, 0) // iOS focus-scroll must not drag the board under the dock
      const vv = window.visualViewport
      const vvHeight = vv?.height ?? window.innerHeight // Visible strip (keyboard excluded)
      const vvTop = vv?.offsetTop ?? 0 // Layout Y of the visual viewport top
      const inset = Math.max(0, window.innerHeight - vvHeight - vvTop) // Keyboard / chrome below the visual viewport
      setKeyboardInset(inset)
      const keyboardOpen = inset >= KEYBOARD_OPEN_PX // Landscape squeeze only matters with the keyboard up
      const tight = keyboardOpen && vvHeight < TOP_CHROME_H + COMPOSER_FLOOR + DOCK_GAP // Cannot stack tools + Ask row
      setPhoneDockTight(tight) // Hide top bar / pill so the composer can occupy that strip
      const reservedTop = tight ? vvTop : vvTop + TOP_CHROME_H // Tight: full strip; else stay below bar + pill
      const available = Math.max(COMPOSER_FLOOR, vvTop + vvHeight - reservedTop - DOCK_GAP) // Room above the keyboard
      setDockMaxHeight(Math.round(available)) // Never grow into the top bar (or past the visual strip)
      setDockCompact(available < EXTRAS_MIN) // Drop transcript + chrome when they would force an overlap
    }
    update()
    const vv = window.visualViewport
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      setPhoneDockTight(false) // Bar back if this effect tears down mid-keyboard
    }
  }, [isChatSidebarOpen, isMobileMode, setPhoneDockTight])

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
    dockCompact,
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

  /** Jump the transcript (desktop column or phone content card) to the latest turn. */
  const scrollTranscriptToBottom = useCallback(() => {
    const root = getTranscriptScroller()
    if (!root) return
    root.scrollTo({ top: root.scrollHeight, behavior: 'smooth' })
    const threadId = activeThreadIdRef.current
    if (threadId) scrollAnchorRef.current = { threadId, fromBottom: 0 }
  }, [getTranscriptScroller])

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

  // Opening a chat: jump to the latest turn once the transcript is painted
  useLayoutEffect(() => {
    if (!thread?.id || loadedThreadId !== thread.id || messages.length === 0) return
    if (loadPhase !== 'in' && loadPhase !== 'shown') return // Wait until ChatLoadStage mounts content
    if (scrolledOpenThreadRef.current === thread.id) return // One jump per open
    const root = getTranscriptScroller()
    if (!root) return
    const pin = () => {
      root.scrollTop = root.scrollHeight // Instant — opening should land at bottom
      scrollAnchorRef.current = { threadId: thread.id, fromBottom: 0 }
      setShowReturnToBottom(false)
    }
    pin()
    scrolledOpenThreadRef.current = thread.id
    // Second frame: markdown / images may grow height after first paint
    const raf = requestAnimationFrame(pin)
    return () => cancelAnimationFrame(raf)
  }, [thread?.id, loadedThreadId, messages.length, loadPhase, getTranscriptScroller])

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
            maxHeight: isChatSidebarOpen && dockMaxHeight != null ? dockMaxHeight : undefined, // Stay below the top bar in a short visual viewport
            overflow: isChatSidebarOpen && dockMaxHeight != null ? 'hidden' : undefined, // Clip extras rather than paint over tools
            paddingBottom:
              isChatSidebarOpen && keyboardInset >= 80
                ? 8 // Keyboard already clears the home indicator — don’t spend the short landscape strip on safe-area
                : 'max(8px, env(safe-area-inset-bottom))',
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
            {customizeOpen ? (
              <div
                className={cn(
                  'rounded-xl overflow-hidden max-h-[min(70vh,560px)]',
                  'bg-gray-50 dark:bg-[#0f0f0f]',
                  'border border-black/10 dark:border-white/10 shadow-lg'
                )}
              >
                <CustomizeAgentPanel
                  open={customizeOpen}
                  onClose={() => setCustomizeOpen(false)}
                  sharedDrawingUrl={logoDrawing}
                  onRequestPersonalize={openPersonalizeForDraft}
                  iconRevision={agentIconRevision}
                />
              </div>
            ) : (
              <>
            {(isChatSidebarOpen && !dockCompact && (hasTranscript || showLoadPlaceholder)) && (
              <div
                className={cn(
                  'relative rounded-xl min-h-[40px]', // Response box — ticks pin here, not in the composer
                  'bg-white/95 dark:bg-[#202020]/95 backdrop-blur-md',
                  'border border-black/10 dark:border-white/10 shadow-sm'
                )}
              >
                <div
                  ref={transcriptScrollRef}
                  data-ai-transcript-scroll
                  className="max-h-[32vh] overflow-y-auto px-3 py-2 pr-12"
                >
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
                {/* Return to bottom — floats at the bottom of the phone content card */}
                {showReturnToBottom && (
                  <div className="absolute bottom-2 left-0 right-0 z-10 flex justify-center pointer-events-none">
                    <button
                      type="button"
                      onClick={scrollTranscriptToBottom}
                      className="pointer-events-auto h-9 w-9 rounded-full flex items-center justify-center bg-white dark:bg-[#1f1f1f] border border-gray-300 dark:border-[#2f2f2f] shadow-lg hover:bg-gray-50 dark:hover:bg-[#2a2a2a] transition-colors"
                      title="Return to bottom"
                      aria-label="Return to bottom"
                    >
                      <ArrowDown className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                    </button>
                  </div>
                )}
              </div>
            )}
            {isChatSidebarOpen && !dockCompact && (
              // Mid chrome: own rounded board-fill card — not fused to transcript or prompt
              <div
                className={cn(
                  'flex items-center gap-1 px-1.5 py-0.5 min-w-0 rounded-xl',
                  'bg-gray-50 dark:bg-[#0f0f0f]' // Board-fill card only — no border
                )}
              >
                {/* Brand left of thread select while chat is open (map toggle hides) */}
                <button
                  type="button"
                  onClick={openCustomize}
                  className="flex-shrink-0 rounded-full overflow-visible focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 opacity-90 hover:opacity-100 transition-opacity"
                  title="Customize Thinktable AI"
                  aria-label="Customize Thinktable AI"
                >
                  <ThinktableBrandMark drawingUrl={logoDrawing} size={28} />
                </button>
                <div className="flex-1 min-w-0 overflow-hidden bg-transparent">
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
              </>
            )}
          </div>
        </div>
        <PersonalizeAiModal
          open={personalizeOpen}
          onOpenChange={(open) => {
            setPersonalizeOpen(open)
            if (!open) setPersonalizeDraftId(null)
          }}
          drawingUrl={personalizeDrawingUrl}
          onDrawingChange={handleDrawingChange}
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
        {customizeOpen ? (
          <CustomizeAgentPanel
            open={customizeOpen}
            onClose={() => setCustomizeOpen(false)}
            sharedDrawingUrl={logoDrawing}
            onRequestPersonalize={openPersonalizeForDraft}
            iconRevision={agentIconRevision}
          />
        ) : (
          <>
        <header className="flex-shrink-0 flex items-center justify-between gap-2 px-3 h-11">
          {/* Brand only when transcript exists — empty state already has the big icon */}
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {hasTranscript && (
              <button
                type="button"
                onClick={openCustomize}
                className="flex-shrink-0 rounded-full overflow-visible focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 opacity-90 hover:opacity-100 transition-opacity"
                title="Customize Thinktable AI"
                aria-label="Customize Thinktable AI"
              >
                <ThinktableBrandMark drawingUrl={logoDrawing} size={28} />
              </button>
            )}
            <div className="min-w-0 flex-1 overflow-hidden">
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
          </div>

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

        <div className="relative flex-1 min-h-0 flex flex-col">
          <div
            ref={transcriptScrollRef}
            data-ai-transcript-scroll
            className="flex-1 min-h-0 overflow-y-auto px-4 py-6 pr-8"
          >
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
                    onClick={openCustomize}
                    className="rounded-full overflow-visible focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                    title="Customize Thinktable AI"
                    aria-label="Customize Thinktable AI"
                  >
                    <ThinktableBrandMark drawingUrl={logoDrawing} size={52} />
                  </button>
                  <button
                    type="button"
                    onClick={openCustomize}
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
                    <Settings2 className="h-3 w-3" />
                    Customize
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
          </div>

          {/* Transcript jump — only when scrolled up in a chat that has turns (not empty New AI chat) */}
          {showReturnToBottom && (
            <div className="absolute bottom-3 left-0 right-0 z-10 flex justify-center pointer-events-none">
              <button
                type="button"
                onClick={scrollTranscriptToBottom}
                className="pointer-events-auto h-9 w-9 rounded-full flex items-center justify-center bg-white dark:bg-[#1f1f1f] border border-gray-300 dark:border-[#2f2f2f] shadow-lg hover:bg-gray-50 dark:hover:bg-[#2a2a2a] transition-colors"
                title="Return to bottom"
                aria-label="Return to bottom"
              >
                <ArrowDown className="h-4 w-4 text-gray-600 dark:text-gray-300" />
              </button>
            </div>
          )}
        </div>

        <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10 pointer-events-auto">
          <AiPromptBars orientation="vertical" {...promptBarProps} />
        </div>

        <div className="flex-shrink-0 px-3 pb-3 pt-1 pointer-events-auto">
          <div className="rounded-xl overflow-hidden bg-white dark:bg-[#202020] border border-black/10 dark:border-white/10 shadow-sm">
            <div className="px-1 pt-1">{composer}</div>
          </div>
        </div>
          </>
        )}
      </aside>

      <PersonalizeAiModal
        open={personalizeOpen}
        onOpenChange={(open) => {
          setPersonalizeOpen(open)
          if (!open) setPersonalizeDraftId(null)
        }}
        drawingUrl={personalizeDrawingUrl}
        onDrawingChange={handleDrawingChange}
      />
    </div>
  )
}
