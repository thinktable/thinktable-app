'use client'

// Ask-mode composer for the AI sidebar (does not place frames on the page)
import { useEffect, useRef, useState } from 'react' // Hooks
import { Textarea } from '@/components/ui/textarea' // Input
import { Button } from '@/components/ui/button' // Button
import { ArrowUp, Loader2, X } from 'lucide-react' // Icons
import { AI_MODES, type AiModeId } from '@/lib/ai/modes' // Modes
import type {
  AiChatBlockDragPayload,
  AiContextSnapshot,
  AiMessage,
  AiThread,
} from '@/lib/ai/types' // Types
import { AI_CHAT_BLOCK_MIME } from '@/lib/ai/types' // Drag MIME
import { consumeAiSse } from '@/lib/ai/stream' // SSE
import { getAiSelectedFrameIds, getAiViewportCenter } from '@/lib/ai/selection-bridge' // Selection + placement
import { cn } from '@/lib/utils' // cn

interface AiComposerProps {
  pageId?: string // Current page
  thread: AiThread | null // Active thread (null = create on send)
  mode: AiModeId // Selected mode — ask | edit (plan legacy only)
  onModeChange: (mode: 'ask' | 'edit') => void // Mode setter
  attachedSnapshots: AiContextSnapshot[] // Chips
  onRemoveSnapshot: (id: string) => void // Detach chip
  /** Drop a chat turn here → attach as context snapshot (not paste text). */
  onAttachChatBlock: (payload: AiChatBlockDragPayload) => Promise<void>
  onThreadEnsured: (thread: AiThread) => void // When API creates/uses a thread
  onMessagesDelta: (updater: (prev: AiMessage[]) => AiMessage[]) => void // Stream into transcript
  onStreamingId: (id: string | null) => void // Highlight streaming row
  seedPrompt?: string // Quick-action seed
  onSeedConsumed?: () => void // Clear seed
  /** When Edit mode returns proposed page mutations. */
  onEdits?: (
    edits: Array<{
      kind?: 'update_frame' | 'create_frame' | 'create_thread'
      frameId?: string
      edgeId?: string
      sourceFrameId?: string
      targetFrameId?: string
      contentHtml?: string
      summary: string
      actionLogId?: string
      originalContent?: string
      replacements?: Array<{ oldText: string; newText: string }>
    }>
  ) => void | Promise<void>
}

export function AiComposer({
  pageId,
  thread,
  mode,
  onModeChange,
  attachedSnapshots,
  onRemoveSnapshot,
  onAttachChatBlock,
  onThreadEnsured,
  onMessagesDelta,
  onStreamingId,
  seedPrompt,
  onSeedConsumed,
  onEdits,
}: AiComposerProps) {
  const [input, setInput] = useState('') // Draft
  const [isLoading, setIsLoading] = useState(false) // In flight
  const [dropActive, setDropActive] = useState(false) // Highlight when dragging chat over input
  const [attaching, setAttaching] = useState(false) // Snapshot create in flight
  const textareaRef = useRef<HTMLTextAreaElement>(null) // Focus target

  useEffect(() => {
    if (seedPrompt) {
      setInput(seedPrompt) // Apply quick action
      onSeedConsumed?.() // Clear parent seed
      textareaRef.current?.focus() // Focus
    }
  }, [seedPrompt, onSeedConsumed])

  const isAiChatDrag = (event: React.DragEvent) => {
    const types = Array.from(event.dataTransfer.types || []) // DOMStringList → array
    return types.includes(AI_CHAT_BLOCK_MIME) // Chat turn payload present
  }

  const handleDragOver = (event: React.DragEvent) => {
    if (!isAiChatDrag(event)) return // Ignore non-chat drags
    event.preventDefault() // Allow drop
    event.stopPropagation() // Don't bubble to page
    event.dataTransfer.dropEffect = 'copy' // Attach affordance
    setDropActive(true) // Visual cue
  }

  const handleDragLeave = (event: React.DragEvent) => {
    // Only clear when leaving the composer shell (not child churn)
    if (event.currentTarget.contains(event.relatedTarget as Node)) return
    setDropActive(false)
  }

  const handleDrop = async (event: React.DragEvent) => {
    if (!isAiChatDrag(event)) return // Not our payload
    event.preventDefault() // Block text paste into the box
    event.stopPropagation() // Keep off the page drop handler
    setDropActive(false)
    const raw = event.dataTransfer.getData(AI_CHAT_BLOCK_MIME) // Custom MIME
    if (!raw) return
    let payload: AiChatBlockDragPayload | null = null
    try {
      payload = JSON.parse(raw) as AiChatBlockDragPayload
    } catch {
      payload = null
    }
    if (!payload || payload.source !== 'ai-chat-block' || !payload.messageId) return
    setAttaching(true)
    try {
      await onAttachChatBlock(payload) // Create + attach snapshot chip
    } finally {
      setAttaching(false)
    }
  }

  const send = async (text: string, opts?: { skipUserInsert?: boolean; threadId?: string }) => {
    const message = text.trim() // Normalize
    if (!message || isLoading) return // Guard
    // Ask + Edit both live

    setIsLoading(true) // Busy
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          threadId: opts?.threadId || thread?.id || null,
          pageId: pageId || null,
          mode,
          selectedFrameIds: getAiSelectedFrameIds(),
          viewportCenter: getAiViewportCenter(),
          snapshotIds: attachedSnapshots.map((s) => s.id),
          skipUserInsert: opts?.skipUserInsert === true,
        }),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => 'Request failed')
        throw new Error(errText)
      }

      await consumeAiSse(res, (event) => {
        if (event.type === 'message') {
          const msg = event.message
          onMessagesDelta((prev) => {
            const exists = prev.some((m) => m.id === msg.id)
            if (exists) return prev.map((m) => (m.id === msg.id ? msg : m))
            return [...prev, msg]
          })
          if (msg.role === 'assistant') onStreamingId(msg.id)
          // Ensure parent knows thread id from first message
          if (!thread && msg.thread_id) {
            onThreadEnsured({
              id: msg.thread_id,
              user_id: msg.user_id,
              title: message.slice(0, 60) || 'New AI chat',
              mode: 'ask',
              page_id: pageId || null,
              metadata: {},
              created_at: msg.created_at,
              updated_at: msg.updated_at,
            })
          }
        } else if (event.type === 'text') {
          onMessagesDelta((prev) => {
            const lastAsst = [...prev].reverse().find((m) => m.role === 'assistant')
            if (!lastAsst) return prev
            return prev.map((m) =>
              m.id === lastAsst.id
                ? { ...m, content: m.content + event.text, status: 'streaming' as const }
                : m
            )
          })
        } else if (event.type === 'edits') {
          if (onEdits && event.edits?.length) {
            void onEdits(event.edits)
          }
        } else if (event.type === 'done') {
          onMessagesDelta((prev) =>
            prev.map((m) => (m.id === event.message.id ? event.message : m))
          )
          onStreamingId(null)
        } else if (event.type === 'error') {
          console.error('AI stream error:', event.error)
          onStreamingId(null)
        }
      })

      // Refresh thread from list so title/updated_at stick
      if (thread?.id || opts?.threadId) {
        const tid = opts?.threadId || thread!.id
        const tRes = await fetch(`/api/ai/threads?filter=all`)
        if (tRes.ok) {
          const data = await tRes.json()
          const found = (data.threads || []).find((t: AiThread) => t.id === tid)
          if (found) onThreadEnsured(found)
        }
      }
    } finally {
      setIsLoading(false)
    }
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = input
    setInput('')
    await send(text)
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg transition-colors',
        dropActive && 'ring-2 ring-[#2383e2]/40 bg-blue-50/50 dark:bg-blue-950/20'
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
    >
      {/* Mode switcher — Ask live; Plan/Edit stubbed */}
      <div className="flex items-center gap-1 px-1">
        {AI_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            title={m.description}
            onClick={() => onModeChange(m.id)}
            className={cn(
              'h-7 px-2 rounded-md text-xs font-medium transition-colors',
              mode === m.id
                ? 'bg-black/[0.08] dark:bg-white/[0.12] text-gray-900 dark:text-gray-50'
                : 'text-gray-500 dark:text-gray-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {attachedSnapshots.length > 0 && (
        <div className="flex flex-wrap gap-1 px-1">
          {attachedSnapshots.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-md text-[11px] bg-black/[0.06] dark:bg-white/[0.08] text-gray-700 dark:text-gray-200"
            >
              {s.name}
              <button
                type="button"
                className="w-4 h-4 rounded flex items-center justify-center hover:bg-black/10"
                onClick={() => onRemoveSnapshot(s.id)}
                aria-label={`Remove ${s.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <form onSubmit={onSubmit} className="relative w-full">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void onSubmit(e as unknown as React.FormEvent)
            }
          }}
          // Also catch drop directly on the textarea (block paste of full chat text)
          onDragOver={handleDragOver}
          onDrop={(e) => void handleDrop(e)}
          placeholder={
            dropActive || attaching
              ? attaching
                ? 'Attaching context…'
                : 'Drop to attach as context'
              : mode === 'edit'
                ? 'Describe edits for this page…'
                : 'Ask anything…'
          }
          disabled={false}
          className={cn(
            'min-h-[44px] max-h-[200px] resize-none border-0 bg-transparent shadow-none text-sm',
            'placeholder:text-gray-400 dark:placeholder:text-gray-500',
            'focus-visible:ring-0 focus-visible:ring-offset-0 pr-10 pl-3 py-2.5'
          )}
        />
        <Button
          type="submit"
          disabled={isLoading || !input.trim()}
          size="icon"
          className={cn(
            'absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-md',
            input.trim()
              ? 'bg-[#2383e2] hover:bg-[#1a6fc9] text-white'
              : 'bg-[#cbd5e1] dark:bg-gray-700 text-gray-600'
          )}
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  )
}

/** Expose send-after-edit for transcript rewind without remounting composer state. */
export async function regenerateAfterEdit(opts: {
  message: string
  threadId: string
  pageId?: string
  snapshotIds?: string[]
  onMessagesDelta: (updater: (prev: AiMessage[]) => AiMessage[]) => void
  onStreamingId: (id: string | null) => void
}) {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: opts.message,
      threadId: opts.threadId,
      pageId: opts.pageId || null,
      selectedFrameIds: getAiSelectedFrameIds(),
      snapshotIds: opts.snapshotIds || [],
      skipUserInsert: true,
    }),
  })
  if (!res.ok) throw new Error(await res.text().catch(() => 'Regenerate failed'))
  await consumeAiSse(res, (event) => {
    if (event.type === 'message') {
      const msg = event.message
      opts.onMessagesDelta((prev) => {
        const exists = prev.some((m) => m.id === msg.id)
        if (exists) return prev.map((m) => (m.id === msg.id ? msg : m))
        return [...prev, msg]
      })
      if (msg.role === 'assistant') opts.onStreamingId(msg.id)
    } else if (event.type === 'text') {
      opts.onMessagesDelta((prev) => {
        const lastAsst = [...prev].reverse().find((m) => m.role === 'assistant')
        if (!lastAsst) return prev
        return prev.map((m) =>
          m.id === lastAsst.id
            ? { ...m, content: m.content + event.text, status: 'streaming' as const }
            : m
        )
      })
    } else if (event.type === 'done') {
      opts.onMessagesDelta((prev) =>
        prev.map((m) => (m.id === event.message.id ? event.message : m))
      )
      opts.onStreamingId(null)
    } else if (event.type === 'error') {
      opts.onStreamingId(null)
      console.error(event.error)
    }
  })
}
