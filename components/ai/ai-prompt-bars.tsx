'use client'

// Compact prompt ticks — vertical strokes in the sidebar, horizontal dashes stacked on the phone card
import { useEffect, useMemo, useRef, useState } from 'react' // Hover + fetch
import { createPortal } from 'react-dom' // Hover list escapes overflow-hidden shells
import type { AiMessage, AiThread } from '@/lib/ai/types' // Prompt sources
import { AI_STARTER_PROMPTS } from '@/lib/ai/starter-prompts' // Empty-chat seeds
import type { AiThreadFilter } from './ai-thread-picker' // Same filter as the thread picker
import { cn } from '@/lib/utils' // className merge

const MAX_BARS = 6 // Cap so the tick cluster stays small
const POPOVER_W = 260 // Hover list width (px) — truncates like the sample
const CLOSE_MS = 160 // Leave delay so the pointer can reach the portaled list
const SCROLL_PROBE = 0.4 // Fraction down the visible transcript — last user turn above this is current

/** Last user-turn id whose top has crossed the visible probe line (classic scroll-spy). */
function findScrolledUserTurnId(root: Element, userIds: string[]): string | null {
  if (userIds.length === 0) return null // No in-thread ticks
  const rootRect = root.getBoundingClientRect() // Visible transcript box
  const probeY = rootRect.top + rootRect.height * SCROLL_PROBE // Reading line inside the scroller
  let active = userIds[0] // Default: first tick if everything is still below the probe
  for (const id of userIds) {
    const el = root.querySelector(`[data-ai-turn="${CSS.escape(id)}"]`) // User-turn row
    if (!el) continue // Not mounted yet
    if (el.getBoundingClientRect().top <= probeY) active = id // This turn (and its reply) is in view
  }
  return active // Last turn that reached the probe, else first
}

/** One tick in the cluster / one row in the hover list. */
export type PromptBarItem = {
  id: string // React key
  text: string // Truncated label
  kind: 'starter' | 'thread' | 'message' // Click behavior
  prompt?: string // Starter → composer
  thread?: AiThread // Recent chat → switch thread
  messageId?: string // In-thread user turn → jump
}

interface AiPromptBarsProps {
  boardId?: string // This-board filter for recent chats
  filter: AiThreadFilter // all | board — match the picker
  thread: AiThread | null // Active thread (skip it in the recent fallback)
  messages: AiMessage[] // Current transcript — user turns become ticks
  refreshKey?: number // Bump after send so recent-chat fetch refreshes
  orientation: 'vertical' | 'horizontal' // Stroke direction: sidebar vertical lines vs phone horizontal dashes
  onSeedPrompt: (prompt: string) => void // Fill the composer
  onSelectThread: (thread: AiThread) => void // Open a recent chat
  onJumpToMessage: (messageId: string) => void // Scroll to that user turn
}

/** Build the visible prompt set: in-thread user turns, else recent chats, else starters. */
function buildItems(
  messages: AiMessage[],
  threads: AiThread[],
  activeThreadId: string | null
): PromptBarItem[] {
  const userTurns = messages.filter((m) => m.role === 'user' && m.content.trim()) // Only sent prompts
  if (userTurns.length > 0) {
    return userTurns.slice(-MAX_BARS).map((m) => ({
      id: m.id, // Turn id
      text: m.content.trim(), // Full prompt (CSS truncates)
      kind: 'message' as const, // Jump in the transcript
      messageId: m.id, // Scroll target
    }))
  }
  const recents = threads
    .filter((t) => t.id !== activeThreadId && t.title.trim() && t.title !== 'New AI chat') // Skip empty / current
    .slice(0, MAX_BARS) // Newest first from the API
    .reverse() // Oldest first — last tick is the active one
    .map((t) => ({
      id: t.id, // Thread id
      text: t.title.trim(), // First-prompt title
      kind: 'thread' as const, // Open that chat
      thread: t, // Payload
    }))
  if (recents.length > 0) return recents // Prefer real history over starters
  return AI_STARTER_PROMPTS.slice(0, MAX_BARS).map((s) => ({
    id: s.id, // Starter id
    text: s.label, // Short label
    kind: 'starter' as const, // Seed composer
    prompt: s.prompt, // Full seed
  }))
}

export function AiPromptBars({
  boardId,
  filter,
  thread,
  messages,
  refreshKey = 0,
  orientation,
  onSeedPrompt,
  onSelectThread,
  onJumpToMessage,
}: AiPromptBarsProps) {
  const [threads, setThreads] = useState<AiThread[]>([]) // Recent chats for empty-state ticks
  const [hoverIndex, setHoverIndex] = useState<number | null>(null) // Which tick / row is hot
  const [scrolledId, setScrolledId] = useState<string | null>(null) // User turn currently in the transcript viewport
  const [open, setOpen] = useState(false) // Hover list visible
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; left: number } | null>(
    null
  ) // Fixed popover origin
  const stackRef = useRef<HTMLDivElement>(null) // Measure the tick cluster
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null) // Hover-bridge timer
  const isDash = orientation === 'horizontal' // Phone: horizontal dashes (still stacked); sidebar keeps vertical strokes

  const needsThreads = messages.every((m) => m.role !== 'user' || !m.content.trim()) // Fallback to recents / starters

  useEffect(() => {
    if (!needsThreads) return // In-thread prompts already fill the ticks
    let cancelled = false // Unmount guard
    const load = async () => {
      const params = new URLSearchParams() // Same query as the thread picker
      params.set('filter', filter) // all | board
      if (filter === 'board' && boardId) params.set('boardId', boardId) // Scope
      const res = await fetch(`/api/ai/threads?${params.toString()}`) // List
      if (!res.ok) return // Soft fail → starters
      const data = await res.json() // Parse
      if (!cancelled) setThreads(data.threads || []) // Apply
    }
    void load() // Fire
    return () => {
      cancelled = true // Drop late apply
    }
  }, [needsThreads, filter, boardId, refreshKey]) // Refetch when the chat set changes

  const items = useMemo(
    () => buildItems(messages, threads, thread?.id ?? null), // Prefer turns → recents → starters
    [messages, threads, thread?.id]
  )

  const userIdKey = items
    .filter((i) => i.kind === 'message' && i.messageId) // In-thread ticks only
    .map((i) => i.messageId) // Ids in chronological order
    .join(',') // Stable while streaming the assistant reply

  useEffect(() => {
    const userIds = userIdKey ? userIdKey.split(',') : [] // Reconstruct from the stable key
    if (userIds.length === 0) {
      setScrolledId(null) // Recents / starters have no transcript spy
      return
    }
    const root = document.querySelector('[data-ai-transcript-scroll]') // Phone card or sidebar scroller
    if (!root) {
      setScrolledId(userIds[userIds.length - 1] ?? null) // No scroller yet — last tick
      return
    }
    let raf = 0 // Coalesce scroll/resize to one measure per frame
    const update = () => {
      setScrolledId(findScrolledUserTurnId(root, userIds)) // Black tick follows the in-view turn
    }
    const onScroll = () => {
      if (raf) return // Already queued
      raf = requestAnimationFrame(() => {
        raf = 0 // Allow the next frame
        update() // Measure
      })
    }
    update() // Initial
    root.addEventListener('scroll', onScroll, { passive: true }) // Spy while the user scrolls
    const ro = new ResizeObserver(onScroll) // Content growth (streaming) shifts which turn is in view
    ro.observe(root) // Scroller box
    if (root.firstElementChild) ro.observe(root.firstElementChild) // Transcript height
    return () => {
      root.removeEventListener('scroll', onScroll) // Drop listener
      ro.disconnect() // Drop observer
      if (raf) cancelAnimationFrame(raf) // Drop queued measure
    }
  }, [userIdKey]) // Rebind when the tick set changes

  const scrolledIndex = items.findIndex((i) => i.id === scrolledId) // Map spy id → tick index
  const activeIndex = hoverIndex ?? (scrolledIndex >= 0 ? scrolledIndex : items.length - 1) // Hover preview, else in-view turn, else last

  const clearClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current) // Cancel pending hide
    closeTimer.current = null // Reset
  }

  const scheduleClose = () => {
    clearClose() // Replace any prior timer
    closeTimer.current = setTimeout(() => {
      setOpen(false) // Hide the list
      setHoverIndex(null) // Restore in-view / last-tick active
      setMenuPos(null) // Drop coords
    }, CLOSE_MS) // Time to reach the portaled list
  }

  const placeMenu = () => {
    const el = stackRef.current // Tick cluster
    if (!el) return // Unmounted
    const r = el.getBoundingClientRect() // Screen box
    const left = Math.max(8, Math.min(r.right - POPOVER_W, window.innerWidth - POPOVER_W - 8)) // Keep on-screen
    if (isDash) {
      setMenuPos({ bottom: window.innerHeight - r.top + 8, left }) // Phone: open above the stacked dashes
    } else {
      setMenuPos({ top: r.top, left: Math.max(8, r.left - POPOVER_W - 8) }) // Sidebar: open left of the column
    }
  }

  const openMenu = () => {
    clearClose() // Stay open while hovering
    placeMenu() // Measure now
    setOpen(true) // Show
  }

  useEffect(() => () => clearClose(), []) // Clear timer on unmount

  const activate = (item: PromptBarItem) => {
    if (item.kind === 'starter' && item.prompt) onSeedPrompt(item.prompt) // Fill composer
    else if (item.kind === 'thread' && item.thread) onSelectThread(item.thread) // Switch chat
    else if (item.kind === 'message' && item.messageId) onJumpToMessage(item.messageId) // Scroll to turn
    setOpen(false) // Dismiss hover list after click
    setHoverIndex(null) // Reset
  }

  if (items.length === 0) return null // Nothing to show

  return (
    <div
      data-chat-prompt-bars
      className="flex" // Tick-width only so the pin does not block chat text
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
    >
      <div
        ref={stackRef}
        className="flex flex-col items-center gap-1 py-1" // Both variants stack; stroke direction is per-tick
        role="list"
        aria-label="Prompts"
      >
        {items.map((item, i) => (
          <button
            key={item.id}
            type="button"
            role="listitem"
            aria-label={item.text}
            onMouseEnter={() => {
              setHoverIndex(i) // Highlight matching list row
              openMenu() // Keep the popover up
            }}
            onFocus={() => {
              setHoverIndex(i) // Keyboard parity
              openMenu()
            }}
            onClick={() => activate(item)}
            className={cn(
              'flex-shrink-0 border-0 p-0 rounded-full transition-colors', // Shared tick chrome
              isDash ? 'h-[3px] w-3.5' : 'w-[3px] h-3.5', // Phone = horizontal dashes stacked; sidebar = vertical lines stacked
              i === activeIndex
                ? 'bg-gray-900 dark:bg-white' // Active / in-view tick is black
                : 'bg-gray-300 dark:bg-white/25 hover:bg-gray-900 dark:hover:bg-white' // Idle gray
            )}
          />
        ))}
      </div>

      {open && menuPos && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="menu"
              onMouseEnter={() => {
                clearClose() // Crossing into the list must not close
                setOpen(true)
              }}
              onMouseLeave={scheduleClose}
              style={{
                position: 'fixed', // Overlay — not clipped by the composer / sidebar
                top: menuPos.top, // Sidebar column
                bottom: menuPos.bottom, // Phone stack — grows upward
                left: menuPos.left, // Shared
                width: POPOVER_W, // Fixed so truncation matches the sample
                zIndex: 80, // Above the phone dock (z-30) and sidebar
              }}
              className={cn(
                'rounded-2xl border border-black/10 dark:border-white/10', // Sample card
                'bg-white dark:bg-[#202020] shadow-lg p-1' // White + soft shadow
              )}
            >
              {items.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  onMouseEnter={() => setHoverIndex(i)} // Sync tick ↔ row
                  onClick={() => activate(item)}
                  className={cn(
                    'w-full text-left text-[13px] leading-snug truncate rounded-lg px-2.5 py-1.5', // Sample row
                    'text-gray-900 dark:text-gray-100', // Body
                    i === activeIndex
                      ? 'bg-black/[0.06] dark:bg-white/[0.08]' // Hover / current wash
                      : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                  )}
                  title={item.text}
                >
                  {item.text}
                </button>
              ))}
            </div>,
            document.body // Escape overflow-hidden on the composer / sidebar scroller
          )
        : null}
    </div>
  )
}
