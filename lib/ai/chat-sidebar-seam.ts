// Chat sidebar left-edge seam gaps — punched where chat↔board threads cross.

/** Half-height of each gap around a thread centerline (px). Stroke is 2px. */
export const CHAT_SEAM_GAP_HALF = 6

type Listener = (clientYs: number[]) => void // Merged gap centers in client Y

const sources = new Map<string, number[]>() // Per turn / rubber band → Y centers
const listeners = new Set<Listener>()

/** Flatten + dedupe all published seam crossing Ys. */
function mergedYs(): number[] {
  const out: number[] = []
  for (const ys of sources.values()) {
    for (const y of ys) out.push(y)
  }
  return out
}

function notify() {
  const ys = mergedYs()
  for (const cb of listeners) cb(ys)
}

/** Publish (or replace) gap centers for one source; empty clears that source. */
export function publishChatSeamGaps(sourceId: string, clientYs: number[]) {
  if (clientYs.length === 0) {
    if (!sources.has(sourceId)) return
    sources.delete(sourceId)
  } else {
    const prev = sources.get(sourceId)
    // Skip notify when Ys are unchanged (avoids React churn on chat↔board paint ticks)
    if (
      prev &&
      prev.length === clientYs.length &&
      prev.every((y, i) => Math.abs(y - clientYs[i]) < 0.5)
    ) {
      return
    }
    sources.set(sourceId, clientYs)
  }
  notify()
}

/** Drop one source (deselected turn / unmount). */
export function clearChatSeamGaps(sourceId: string) {
  if (!sources.has(sourceId)) return
  sources.delete(sourceId)
  notify()
}

/** Subscribe to merged seam gap centers (client Y). Fires immediately with current set. */
export function subscribeChatSeamGaps(cb: Listener): () => void {
  listeners.add(cb)
  cb(mergedYs()) // Sync first paint so gaps exist before next publish
  return () => {
    listeners.delete(cb)
  }
}

/** Seam X = left edge of `[data-chat-sidebar]` in client coords, or null if closed. */
export function chatSidebarSeamX(): number | null {
  if (typeof document === 'undefined') return null
  const el = document.querySelector('[data-chat-sidebar]') as HTMLElement | null
  if (!el) return null
  return el.getBoundingClientRect().left
}
