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
  FileText,
  Box,
  TextCursorInput,
} from 'lucide-react'
import type { AiModeId } from '@/lib/ai/modes'
import { AI_SKILLS, type AiSkill } from '@/lib/ai/skills'
import { AI_CONNECTORS } from '@/lib/ai/connectors'
import type {
  AiChatBlockDragPayload,
  AiContextSnapshot,
  AiMessage,
  AiThread,
} from '@/lib/ai/types'
import { AI_CHAT_BLOCK_MIME } from '@/lib/ai/types'
import { consumeAiSse } from '@/lib/ai/stream'
import {
  getAiLiveContextPills,
  getAiSelectedFrameIds,
  getAiViewportCenter,
  setAiBoardContext,
  subscribeAiSelection,
  type AiLiveContextPill,
} from '@/lib/ai/selection-bridge'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

/** + menu skill rows — driven by the skill registry (user-attached, not LLM tools). */
const MENU_SKILLS: Array<{
  id: string
  name: string
  description: string
  icon: typeof Sparkles
}> = [
  {
    id: 'summarize',
    name: 'Summarize',
    description: 'Concise summary of frames on this board',
    icon: Sparkles,
  },
  {
    id: 'tasks',
    name: 'Tasks',
    description: 'Track changes with a sidebar smart list',
    icon: ListTodo,
  },
  {
    id: 'search-board',
    name: 'Search board',
    description: 'What stands out across frames here',
    icon: Search,
  },
  {
    id: 'learn',
    name: 'Learn',
    description: 'Quiz yourself and explore answers',
    icon: MessageSquare,
  },
]

interface AiComposerProps {
  boardId?: string
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

/** Icon for a live context pill kind. */
function LivePillIcon({ kind }: { kind: AiLiveContextPill['kind'] }) {
  if (kind === 'board') return <FileText className="h-3 w-3 flex-shrink-0 opacity-70" />
  if (kind === 'frame' || kind === 'selection')
    return <Box className="h-3 w-3 flex-shrink-0 opacity-70" />
  if (kind === 'block') return <Box className="h-3 w-3 flex-shrink-0 opacity-70" />
  return <TextCursorInput className="h-3 w-3 flex-shrink-0 opacity-70" />
}

/** One live context chip — hover reveals the referenced content (portaled so overflow can't clip it). */
function LiveContextPill({
  pill,
  onDismiss,
}: {
  pill: AiLiveContextPill
  onDismiss: (id: string) => void
}) {
  const [hover, setHover] = useState(false)
  // Fixed coords for the portaled tip (bottom = distance from viewport bottom when above)
  const [tipPos, setTipPos] = useState<{
    left: number
    bottom?: number
    top?: number
  } | null>(null)
  const chipRef = useRef<HTMLSpanElement>(null)
  const preview = pill.preview?.trim()

  const placeTip = () => {
    const el = chipRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 248))
    // Prefer above the chip; flip below if too close to the top of the viewport
    if (r.top < 56) {
      setTipPos({ left, top: r.bottom + 8 })
    } else {
      setTipPos({ left, bottom: window.innerHeight - r.top + 8 })
    }
  }

  useEffect(() => {
    if (!hover || !preview) {
      setTipPos(null)
      return
    }
    placeTip()
    const onReposition = () => placeTip()
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [hover, preview])

  return (
    <span
      ref={chipRef}
      className="relative inline-flex"
      onMouseEnter={() => {
        setHover(true)
        placeTip()
      }}
      onMouseLeave={() => setHover(false)}
    >
      <span
        className={cn(
          'inline-flex items-center gap-1 max-w-full h-6 pl-1.5 pr-1 rounded-md text-[11px]',
          pill.kind === 'board'
            ? 'bg-black/[0.06] dark:bg-white/[0.08] text-gray-700 dark:text-gray-200'
            : pill.kind === 'text'
              ? 'bg-amber-500/15 text-amber-800 dark:text-amber-200'
              : pill.kind === 'selection'
                ? 'bg-black/[0.06] dark:bg-white/[0.08] text-gray-700 dark:text-gray-200'
                : 'bg-[#2383e2]/12 text-[#1a6fc9] dark:bg-[#2383e2]/20 dark:text-[#7db7f0]'
        )}
      >
        <LivePillIcon kind={pill.kind} />
        <span className="truncate max-w-[140px]">{pill.label}</span>
        <button
          type="button"
          className="w-4 h-4 rounded flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 flex-shrink-0"
          onClick={() => onDismiss(pill.id)}
          aria-label={`Remove ${pill.label}`}
        >
          <X className="h-3 w-3" />
        </button>
      </span>
      {hover &&
        preview &&
        tipPos &&
        typeof document !== 'undefined' &&
        createPortal(
          <span
            role="tooltip"
            style={{
              position: 'fixed',
              left: tipPos.left,
              ...(tipPos.bottom != null
                ? { bottom: tipPos.bottom }
                : { top: tipPos.top }),
              zIndex: 90,
            }}
            className={cn(
              'w-max max-w-[240px] max-h-[160px] overflow-y-auto',
              'rounded-md px-2.5 py-2 text-[11px] leading-snug whitespace-pre-wrap break-words',
              'bg-gray-900 text-gray-50 shadow-lg dark:bg-gray-100 dark:text-gray-900',
              'pointer-events-none'
            )}
          >
            {preview}
          </span>,
          document.body
        )}
    </span>
  )
}

export function AiComposer({
  boardId,
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
  const [attachedSkills, setAttachedSkills] = useState<AiSkill[]>([])
  // Live page/frame/block/text pills from the selection bridge (page on open + selection)
  const [livePills, setLivePills] = useState<AiLiveContextPill[]>(() => getAiLiveContextPills())
  // User-dismissed live pill ids (cleared when that pill leaves / returns with a new id)
  const [dismissedLiveIds, setDismissedLiveIds] = useState<Set<string>>(() => new Set())
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

  // Subscribe to BoardFlow / TipTap selection → refresh live context pills
  useEffect(() => {
    const sync = () => setLivePills(getAiLiveContextPills())
    sync()
    return subscribeAiSelection(sync)
  }, [])

  // Drop dismiss flags for pills that are no longer present
  useEffect(() => {
    setDismissedLiveIds((prev) => {
      if (prev.size === 0) return prev
      const ids = new Set(livePills.map((p) => p.id))
      let changed = false
      const next = new Set<string>()
      prev.forEach((id) => {
        if (ids.has(id)) next.add(id)
        else changed = true
      })
      return changed ? next : prev
    })
  }, [livePills])

  // Current board → default context pill on chat open / page switch
  useEffect(() => {
    if (!boardId) {
      setAiBoardContext(null)
      return
    }
    let cancelled = false
    const load = async () => {
      // Optimistic label while title loads
      setAiBoardContext({ id: boardId, title: 'Board' })
      const supabase = createClient()
      const { data } = await supabase
        .from('conversations')
        .select('id, title')
        .eq('id', boardId)
        .maybeSingle()
      if (cancelled) return
      const title = ((data?.title as string | undefined)?.trim() || 'Untitled')
      setAiBoardContext({ id: boardId, title })
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [boardId])

  useEffect(() => {
    if (seedPrompt) {
      setInput(seedPrompt)
      onSeedConsumed?.()
      textareaRef.current?.focus()
    }
  }, [seedPrompt, onSeedConsumed])

  // New / switched thread → drop skill pills (snapshots are parent-owned)
  useEffect(() => {
    setAttachedSkills([])
  }, [thread?.id])

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
        s.description.toLowerCase().includes(q)
    )
  }, [menuQuery])

  // Visible live pills (page + selection), minus user-dismissed
  const visibleLivePills = useMemo(
    () => livePills.filter((p) => !dismissedLiveIds.has(p.id)),
    [livePills, dismissedLiveIds]
  )

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
          boardId: boardId || null,
          mode,
          selectedFrameIds: getAiSelectedFrameIds(),
          viewportCenter: getAiViewportCenter(),
          snapshotIds: attachedSnapshots.map((s) => s.id),
          skillIds: attachedSkills.map((s) => s.id),
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
              board_id: boardId || null,
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
    const reg = AI_SKILLS.find((s) => s.id === skill.id)
    if (!reg) return
    setAttachedSkills((prev) => (prev.some((s) => s.id === reg.id) ? prev : [...prev, reg]))
    textareaRef.current?.focus()
  }

  const removeSkill = (id: string) => {
    setAttachedSkills((prev) => prev.filter((s) => s.id !== id))
  }

  const dismissLivePill = (id: string) => {
    setDismissedLiveIds((prev) => new Set(prev).add(id))
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
  const hasPills =
    visibleLivePills.length > 0 ||
    attachedSkills.length > 0 ||
    attachedSnapshots.length > 0

  return (
    <div
      className={cn(
        'flex flex-col rounded-lg transition-colors',
        dropActive && 'ring-2 ring-[#2383e2]/40 bg-blue-50/50 dark:bg-blue-950/20'
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
    >
      {/* Context pills sit at the top of the input box (page + selection + skills/snapshots) */}
      {hasPills && (
        <div className="flex flex-wrap gap-1 px-2 pt-2 pb-0.5">
          {visibleLivePills.map((p) => (
            <LiveContextPill key={p.id} pill={p} onDismiss={dismissLivePill} />
          ))}
          {attachedSkills.map((s) => (
            <span
              key={`skill-${s.id}`}
              className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-md text-[11px] bg-[#2383e2]/12 text-[#1a6fc9] dark:bg-[#2383e2]/20 dark:text-[#7db7f0]"
              title={s.description}
            >
              {s.name}
              <button
                type="button"
                className="w-4 h-4 rounded flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10"
                onClick={() => removeSkill(s.id)}
                aria-label={`Remove ${s.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
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
        {/* items-center keeps + / text / Ask / send on one vertical midline */}
        <div className="flex items-center gap-1 pl-1 pr-1 py-1">
          {/* + skills / context / connection menu (portaled — escapes overflow-hidden shell) */}
          <div className="relative flex-shrink-0">
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
            rows={1}
            placeholder={
              dropActive || attaching
                ? attaching
                  ? 'Attaching context…'
                  : 'Drop to attach as context'
                : selectableMode === 'edit'
                  ? 'Describe edits for this board…'
                  : 'Ask anything…'
            }
            disabled={false}
            className={cn(
              // block (not flex) + matched line-height so placeholder sits on the control midline
              'block min-h-[32px] max-h-[200px] resize-none border-0 bg-transparent shadow-none',
              'text-sm leading-5 flex-1 self-center',
              'placeholder:text-gray-400 dark:placeholder:text-gray-500',
              'focus-visible:ring-0 focus-visible:ring-offset-0',
              'px-1 py-[6px]'
            )}
          />

          {/* Ask ↔ Edit — same click-toggle pattern as nav Scroll ↔ Zoom */}
          <button
            type="button"
            className={cn(
              'h-8 px-2 rounded-lg text-xs font-medium flex-shrink-0',
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
              'h-8 w-8 rounded-md flex-shrink-0',
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
  boardId?: string
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
      boardId: opts.boardId || null,
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
