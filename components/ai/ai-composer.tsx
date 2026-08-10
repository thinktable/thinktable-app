'use client'

// AI sidebar composer — Ask/Edit toggle in-box + Cursor-style + skills menu
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  ArrowUp,
  Loader2,
  X,
  Plus,
  Paperclip,
  Link2,
  Sparkles,
  ListTodo,
  Search,
  MessageSquare,
} from 'lucide-react'
import type { AiModeId } from '@/lib/ai/modes'
import { AI_SKILLS } from '@/lib/ai/skills'
import { AI_CONNECTORS } from '@/lib/ai/connectors'
import type {
  AiChatBlockDragPayload,
  AiContextSnapshot,
  AiMessage,
  AiThread,
} from '@/lib/ai/types'
import { AI_CHAT_BLOCK_MIME } from '@/lib/ai/types'
import { consumeAiSse } from '@/lib/ai/stream'
import { getAiSelectedFrameIds, getAiViewportCenter } from '@/lib/ai/selection-bridge'
import { cn } from '@/lib/utils'

/** Menu skill rows — registry skills + a few Thinktable quick actions. */
const MENU_SKILLS: Array<{
  id: string
  name: string
  description: string
  icon: typeof Sparkles
  prompt?: string
  skillId?: string
}> = [
  {
    id: 'summarize-page',
    name: 'Summarize page',
    description: 'Concise summary of frames on this page',
    icon: Sparkles,
    prompt: 'Summarize this page.',
    skillId: 'summarize-page',
  },
  {
    id: 'tasks-from-notes',
    name: 'Tasks from notes',
    description: 'Turn page notes into a checklist in chat',
    icon: ListTodo,
    prompt: 'Turn the notes on this page into a task list.',
    skillId: 'tasks-from-notes',
  },
  {
    id: 'search-page',
    name: 'Search page',
    description: 'What stands out across frames here',
    icon: Search,
    prompt: 'What stands out across the frames on this page?',
  },
  {
    id: 'quiz-me',
    name: 'Quiz me',
    description: 'Ask questions from the frames on this page',
    icon: MessageSquare,
    prompt: 'Quiz me on the content of this page. Ask one question at a time and wait for my answer before continuing.',
  },
]

interface AiComposerProps {
  pageId?: string
  thread: AiThread | null
  mode: AiModeId
  onModeChange: (mode: 'ask' | 'edit') => void
  attachedSnapshots: AiContextSnapshot[]
  onRemoveSnapshot: (id: string) => void
  onAttachChatBlock: (payload: AiChatBlockDragPayload) => Promise<void>
  onThreadEnsured: (thread: AiThread) => void
  onMessagesDelta: (updater: (prev: AiMessage[]) => AiMessage[]) => void
  onStreamingId: (id: string | null) => void
  seedPrompt?: string
  onSeedConsumed?: () => void
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
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [plusOpen, setPlusOpen] = useState(false)
  const [menuQuery, setMenuQuery] = useState('')
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const plusBtnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuSearchRef = useRef<HTMLInputElement>(null)

  const placePlusMenu = () => {
    const btn = plusBtnRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    // Fixed: bottom edge of menu sits just above the + button
    setMenuPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - 328)),
      bottom: window.innerHeight - r.top + 8,
    })
  }

  useEffect(() => {
    if (seedPrompt) {
      setInput(seedPrompt)
      onSeedConsumed?.()
      textareaRef.current?.focus()
    }
  }, [seedPrompt, onSeedConsumed])

  // Close + menu on outside click / Escape
  useEffect(() => {
    if (!plusOpen) return
    placePlusMenu()
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (plusBtnRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      setPlusOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPlusOpen(false)
    }
    const onReposition = () => placePlusMenu()
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [plusOpen])

  useEffect(() => {
    if (plusOpen) {
      setMenuQuery('')
      requestAnimationFrame(() => menuSearchRef.current?.focus())
    }
  }, [plusOpen])

  const filteredSkills = useMemo(() => {
    const q = menuQuery.trim().toLowerCase()
    if (!q) return MENU_SKILLS
    return MENU_SKILLS.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        (s.skillId && AI_SKILLS.some((r) => r.id === s.skillId && r.name.toLowerCase().includes(q)))
    )
  }, [menuQuery])

  const isAiChatDrag = (event: React.DragEvent) => {
    const types = Array.from(event.dataTransfer.types || [])
    return types.includes(AI_CHAT_BLOCK_MIME)
  }

  const handleDragOver = (event: React.DragEvent) => {
    if (!isAiChatDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    setDropActive(true)
  }

  const handleDragLeave = (event: React.DragEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return
    setDropActive(false)
  }

  const handleDrop = async (event: React.DragEvent) => {
    if (!isAiChatDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    setDropActive(false)
    const raw = event.dataTransfer.getData(AI_CHAT_BLOCK_MIME)
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
      await onAttachChatBlock(payload)
    } finally {
      setAttaching(false)
    }
  }

  const send = async (text: string, opts?: { skipUserInsert?: boolean; threadId?: string }) => {
    const message = text.trim()
    if (!message || isLoading) return

    setIsLoading(true)
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

  const pickSkill = (skill: (typeof MENU_SKILLS)[number]) => {
    setPlusOpen(false)
    if (skill.prompt) setInput(skill.prompt)
    textareaRef.current?.focus()
  }

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    setPlusOpen(false)
    if (!file) return
    // Text-ish files → drop contents into the draft as context; others name-tag only
    const isText =
      file.type.startsWith('text/') ||
      /\.(md|txt|csv|json|ts|tsx|js|jsx|css|html)$/i.test(file.name)
    if (isText && file.size < 200_000) {
      try {
        const text = await file.text()
        const snippet = text.slice(0, 8000)
        setInput((prev) =>
          prev
            ? `${prev}\n\n[File: ${file.name}]\n${snippet}`
            : `[File: ${file.name}]\n${snippet}`
        )
      } catch {
        setInput((prev) => (prev ? `${prev}\n\n[File: ${file.name}]` : `[File: ${file.name}]`))
      }
    } else {
      setInput((prev) => (prev ? `${prev}\n\n[File: ${file.name}]` : `[File: ${file.name}]`))
    }
    textareaRef.current?.focus()
  }

  const openNotionConnect = () => {
    setPlusOpen(false)
    // Reuse top-bar Notion OAuth entry if present
    const btn = document.querySelector<HTMLElement>('[data-notion-connect]')
    if (btn) {
      btn.click()
      return
    }
    window.dispatchEvent(new CustomEvent('thinktable-open-notion-connect'))
  }

  const selectableMode = mode === 'edit' ? 'edit' : 'ask'

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
        <div className="flex items-end gap-1 pl-1 pr-1 pb-1 pt-0.5">
          {/* + skills / context / connection menu (portaled — escapes overflow-hidden shell) */}
          <div className="relative flex-shrink-0 self-center">
            <button
              ref={plusBtnRef}
              type="button"
              className={cn(
                'h-8 w-8 rounded-full flex items-center justify-center transition-colors',
                'text-gray-600 dark:text-gray-300',
                'hover:bg-black/[0.06] dark:hover:bg-white/[0.08]',
                plusOpen && 'bg-black/[0.08] dark:bg-white/[0.12]'
              )}
              title="Add skills, files, connections"
              aria-expanded={plusOpen}
              aria-haspopup="dialog"
              onClick={() => {
                if (!plusOpen) placePlusMenu()
                setPlusOpen((o) => !o)
              }}
            >
              <Plus className="h-4 w-4" />
            </button>

            {plusOpen &&
              menuPos &&
              typeof document !== 'undefined' &&
              createPortal(
                <div
                  ref={menuRef}
                  role="dialog"
                  aria-label="Skills and context"
                  style={{
                    position: 'fixed',
                    left: menuPos.left,
                    bottom: menuPos.bottom,
                    zIndex: 80,
                  }}
                  className={cn(
                    'w-[min(320px,calc(100vw-48px))]',
                    'rounded-xl border border-black/10 dark:border-white/10',
                    'bg-white dark:bg-[#1a1a1a] shadow-xl',
                    'overflow-hidden'
                  )}
                >
                  <div className="px-3 pt-3 pb-2 border-b border-black/5 dark:border-white/10">
                    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 bg-black/[0.04] dark:bg-white/[0.06]">
                      <Search className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                      <input
                        ref={menuSearchRef}
                        value={menuQuery}
                        onChange={(e) => setMenuQuery(e.target.value)}
                        placeholder="Search skills, context, chats…"
                        className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500 text-gray-900 dark:text-gray-100"
                      />
                    </div>
                  </div>

                  <ul className="py-1 max-h-[220px] overflow-y-auto">
                    {filteredSkills.length === 0 && (
                      <li className="px-3 py-2 text-xs text-gray-400">No matching skills</li>
                    )}
                    {filteredSkills.map((s) => {
                      const Icon = s.icon
                      return (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => pickSkill(s)}
                            className="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                          >
                            <Icon className="h-4 w-4 mt-0.5 flex-shrink-0 text-gray-500 dark:text-gray-400" />
                            <span className="min-w-0 flex flex-col gap-0.5">
                              <span className="text-sm font-medium text-gray-900 dark:text-gray-50">
                                {s.name}
                              </span>
                              <span className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                                {s.description}
                              </span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>

                  <div className="border-t border-black/5 dark:border-white/10 py-1">
                    {(!menuQuery.trim() ||
                      'file'.includes(menuQuery.trim().toLowerCase()) ||
                      menuQuery.trim().toLowerCase().includes('file')) && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                      >
                        <Paperclip className="h-4 w-4 text-gray-500" />
                        File
                      </button>
                    )}
                    {(!menuQuery.trim() ||
                      'connection'.includes(menuQuery.trim().toLowerCase()) ||
                      menuQuery.trim().toLowerCase().includes('connect') ||
                      menuQuery.trim().toLowerCase().includes('notion')) && (
                      <button
                        type="button"
                        onClick={openNotionConnect}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                      >
                        <Link2 className="h-4 w-4 text-gray-500" />
                        <span className="flex-1 text-left">Connection</span>
                        <span className="text-xs text-gray-400 truncate max-w-[120px]">
                          {AI_CONNECTORS.find((c) => c.enabled)?.name || 'Notion'}
                        </span>
                      </button>
                    )}
                  </div>
                </div>,
                document.body
              )}

            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => void onFilePicked(e)}
            />
          </div>

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
            onDragOver={handleDragOver}
            onDrop={(e) => void handleDrop(e)}
            placeholder={
              dropActive || attaching
                ? attaching
                  ? 'Attaching context…'
                  : 'Drop to attach as context'
                : selectableMode === 'edit'
                  ? 'Describe edits for this page…'
                  : 'Ask anything…'
            }
            disabled={false}
            className={cn(
              'min-h-[40px] max-h-[200px] resize-none border-0 bg-transparent shadow-none text-sm flex-1',
              'placeholder:text-gray-400 dark:placeholder:text-gray-500',
              'focus-visible:ring-0 focus-visible:ring-offset-0 px-1 py-2'
            )}
          />

          {/* Ask ↔ Edit — same click-toggle pattern as nav Scroll ↔ Zoom */}
          <button
            type="button"
            className={cn(
              'h-8 px-2 rounded-lg text-xs font-medium flex-shrink-0 self-center',
              'text-gray-800 dark:text-gray-100',
              'hover:bg-black/[0.06] dark:hover:bg-white/[0.08]',
              'focus-visible:outline-none'
            )}
            title={
              selectableMode === 'edit'
                ? 'Edit — click for Ask'
                : 'Ask — click for Edit'
            }
            aria-label={
              selectableMode === 'edit' ? 'Switch to Ask' : 'Switch to Edit'
            }
            onClick={() => onModeChange(selectableMode === 'edit' ? 'ask' : 'edit')}
          >
            {selectableMode === 'edit' ? 'Edit' : 'Ask'}
          </button>

          <Button
            type="submit"
            disabled={isLoading || !input.trim()}
            size="icon"
            className={cn(
              'h-8 w-8 rounded-md flex-shrink-0 self-center',
              input.trim()
                ? 'bg-[#2383e2] hover:bg-[#1a6fc9] text-white'
                : 'bg-[#cbd5e1] dark:bg-gray-700 text-gray-600'
            )}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </Button>
        </div>
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
