'use client'

// Full-height right chat column — Thinktable AI copilot (Ask in sidebar; drag blocks onto page)
import { useCallback, useEffect, useState } from 'react' // Hooks
import {
  useSidebarContext,
  CHAT_SIDEBAR_WIDTH,
  TT_CHAT_THREAD_ID_KEY,
} from './sidebar-context' // Open state + logo + thread persist key
import { ThinktableBrandMark, PersonalizeAiModal } from './personalize-ai-modal' // Brand
import { AiThreadPicker, type AiThreadFilter } from './ai/ai-thread-picker' // History
import { AiTranscript } from './ai/ai-transcript' // Turns
import { AiComposer, regenerateAfterEdit } from './ai/ai-composer' // Composer
import type { AiContextSnapshot, AiMessage, AiThread } from '@/lib/ai/types' // Types
import { isSelectableAiMode } from '@/lib/ai/modes'
import { useAiEditSession, buildFramePendingEdit, buildCreateFramePendingEdit, buildCreateThreadPendingEdit } from '@/lib/ai/edit-session'
import { htmlToPlain } from '@/lib/ai/context-pack' // Plain excerpts for snapshots
import { createClient } from '@/lib/supabase/client' // Snapshot frame load
import { cn } from '@/lib/utils' // cn
import {
  ChevronsRight,
  MessageSquarePlus,
  Search,
  ListTodo,
  Sparkles,
  Pencil,
} from 'lucide-react' // Icons

interface ChatSidebarProps {
  conversationId?: string // Current page id
  projectId?: string // Kept for call-site compat
}

/** Write / clear the active thread id so reload restores the same chat. */
function persistActiveThreadId(threadId: string | null) {
  if (typeof window === 'undefined') return // No storage on server
  if (threadId) localStorage.setItem(TT_CHAT_THREAD_ID_KEY, threadId) // Remember thread
  else localStorage.removeItem(TT_CHAT_THREAD_ID_KEY) // New chat / cleared
}

export function ChatSidebar({ conversationId }: ChatSidebarProps) {
  const { isChatSidebarOpen, setChatSidebarOpen, logoDrawing, setLogoDrawing } = useSidebarContext()
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

  const [threadHydrated, setThreadHydrated] = useState(false) // Block persist-until-restore (Strict Mode safe)

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
      return
    }
    let cancelled = false
    const load = async () => {
      const res = await fetch(`/api/ai/threads/${thread.id}/messages`)
      if (!res.ok) return
      const data = await res.json()
      if (!cancelled) setMessages(data.messages || [])
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

  const handleNew = useCallback(() => {
    setThread(null)
    setMessages([])
    setStreamingId(null)
    setAttachedSnapshots([])
    setMode('ask')
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
        pageId: conversationId,
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
            pageId: conversationId || null,
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

  if (!isChatSidebarOpen) return null

  const hasTranscript = messages.length > 0

  return (
    <div className="relative h-full flex flex-shrink-0 z-20">
      <aside
        data-chat-sidebar
        className={cn(
          'h-full flex flex-col',
          'bg-gray-50 dark:bg-[#0f0f0f]',
          'border-l border-black/10 dark:border-white/10'
        )}
        style={{ width: CHAT_SIDEBAR_WIDTH }}
      >
        <header className="flex-shrink-0 flex items-center justify-between gap-2 px-3 h-11">
          <AiThreadPicker
            pageId={conversationId}
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

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6">
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

              <ul className="w-full flex flex-col gap-0.5">
                {[
                  { icon: Sparkles, label: 'Summarize this page', prompt: 'Summarize this page.' },
                  {
                    icon: ListTodo,
                    label: 'Turn notes into tasks',
                    prompt: 'Turn the notes on this page into a task list.',
                  },
                  {
                    icon: Search,
                    label: 'Search connected pages',
                    prompt: 'What stands out across the frames on this page?',
                  },
                ].map(({ icon: Icon, label, prompt }) => (
                  <li key={label}>
                    <button
                      type="button"
                      onClick={() => setSeedPrompt(prompt)}
                      className={cn(
                        'w-full flex items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm',
                        'text-gray-700 dark:text-gray-300',
                        'hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors'
                      )}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0 text-gray-500 dark:text-gray-400" />
                      <span className="truncate">{label}</span>
                    </button>
                  </li>
                ))}
              </ul>

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

          <div
            data-chat-return-slot
            className="flex justify-center items-center min-h-[44px] mt-4"
          />
        </div>

        <div className="flex-shrink-0 px-3 pb-3 pt-1 pointer-events-auto">
          <div className="rounded-xl overflow-hidden bg-white dark:bg-[#202020] border border-black/10 dark:border-white/10 shadow-sm">
            <div className="px-1 pt-1">
              <AiComposer
                pageId={conversationId}
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
            </div>
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
