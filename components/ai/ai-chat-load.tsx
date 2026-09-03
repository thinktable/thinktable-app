'use client'

// Chat load reveal: placeholder fades out fully, then the real transcript fades in (no overlap).

import { useEffect, useState, type ReactNode } from 'react' // Phase machine
import { cn } from '@/lib/utils' // className merge

export const CHAT_PLACEHOLDER_OUT_MS = 200 // Placeholder must finish fading before content mounts
export const CHAT_CONTENT_IN_MS = 220 // Loaded chat / empty-state fade-in after placeholder unmounts

export type ChatLoadPhase = 'placeholder' | 'out' | 'in' | 'shown' // Sequential load stages

/** True until the restored thread (if any) has its messages, or we know there is no thread. */
export function isChatTranscriptLoading(
  threadHydrated: boolean, // Restore fetch finished
  threadId: string | undefined, // Active thread
  loadedThreadId: string | null, // Thread whose messages are in state
  hasMessages: boolean // Optimistic turns (first send) must not flash the placeholder
): boolean {
  if (!threadHydrated) return true // Still deciding whether a saved chat exists
  if (threadId && loadedThreadId !== threadId && !hasMessages) return true // Waiting on a fetch with an empty transcript
  return false // Empty new chat, this thread’s messages are ready, or live turns already painted
}

/** Drive placeholder → fade-out → content fade-in. Skip placeholder when load was already done. */
export function useChatLoadReveal(isLoading: boolean): ChatLoadPhase {
  const [phase, setPhase] = useState<ChatLoadPhase>(isLoading ? 'placeholder' : 'shown') // First paint

  useEffect(() => {
    if (isLoading) {
      setPhase('placeholder') // Reload / thread switch — show shimmer immediately
      return
    }
    setPhase((prev) => (prev === 'placeholder' ? 'out' : prev)) // Only fade out if we were showing it
  }, [isLoading])

  useEffect(() => {
    if (phase !== 'out') return // Wait until placeholder opacity has been set to 0
    const t = window.setTimeout(() => setPhase('in'), CHAT_PLACEHOLDER_OUT_MS) // Unmount placeholder, mount content at 0
    return () => window.clearTimeout(t)
  }, [phase])

  useEffect(() => {
    if (phase !== 'in') return // Content just mounted at opacity 0 — need a paint before fading in
    let raf1 = 0 // First frame: let opacity 0 commit
    let raf2 = 0 // Second frame: flip to shown so the transition runs
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setPhase('shown')) // Starts the opacity 0→1 transition
    })
    return () => {
      cancelAnimationFrame(raf1) // Drop the first frame if we leave 'in' early
      cancelAnimationFrame(raf2) // Drop the second frame too
    }
  }, [phase])

  return phase
}

/** Placeholder vs loaded chat — never both visible. */
export function ChatLoadStage({
  phase,
  placeholder,
  children,
}: {
  phase: ChatLoadPhase
  placeholder: ReactNode
  children: ReactNode
}) {
  const showPlaceholder = phase === 'placeholder' || phase === 'out' // Keep mounted through fade-out
  const showContent = phase === 'in' || phase === 'shown' // Mount only after placeholder is gone
  return (
    <>
      {showPlaceholder && (
        <div
          aria-busy="true"
          aria-label="Loading chat"
          style={{
            opacity: phase === 'out' ? 0 : 1, // Kick fade-out when phase flips
            transition: `opacity ${CHAT_PLACEHOLDER_OUT_MS}ms ease-out`,
            pointerEvents: 'none', // Placeholder never steals transcript scroll / drag
          }}
        >
          {placeholder}
        </div>
      )}
      {showContent && (
        <div
          style={{
            opacity: phase === 'shown' ? 1 : 0, // in = 0 (first paint); shown = fade in
            transition: `opacity ${CHAT_CONTENT_IN_MS}ms ease-out`,
          }}
        >
          {children}
        </div>
      )}
    </>
  )
}

/** Fake prompt / response turns while the real transcript fetches. */
export function AiTranscriptPlaceholder() {
  return (
    <div className="flex flex-col gap-3 w-full max-w-[320px] mx-auto" role="presentation">
      <PlaceholderTurn user widths={['72%', '44%']} />
      <PlaceholderTurn user={false} widths={['92%', '78%', '61%']} />
      <PlaceholderTurn user widths={['58%']} />
      <PlaceholderTurn user={false} widths={['84%', '70%']} />
    </div>
  )
}

function PlaceholderTurn({ user, widths }: { user: boolean; widths: string[] }) {
  return (
    <div
      className={cn(
        'rounded-lg px-2 py-2', // Match AiTranscript turn chrome (no hover border)
        user ? 'bg-[#eaf4fc] dark:bg-[#152536]' : '' // Light blue prompts; responses clear
      )}
      style={{ paddingLeft: 24, paddingRight: 24, paddingTop: 4, paddingBottom: 4 }} // Match live ⋮⋮ gutter
    >
      <div className="tt-frame-shimmer-lines">
        {widths.map((width, i) => (
          <div key={i} className="tt-frame-shimmer-line" style={{ width }} />
        ))}
      </div>
    </div>
  )
}
