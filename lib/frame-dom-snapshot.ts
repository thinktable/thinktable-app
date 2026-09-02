// Cold frames render the *live* frame's own DOM, captured once and replayed inert.
//
// The deferred shell used to re-derive an approximation of each frame (shimmer bars, a hand-built
// boardLink row, a guessed box). Every NodeView we added was a new chance for that approximation to
// drift from the real thing — which is where "blank until hover" and titles clipped to the 98×32
// empty-frame hug came from. Snapshotting the mounted subtree removes the second code path
// entirely: cold *is* live's markup under live's stylesheet, so it cannot drift, and it keeps text
// selectable/searchable and crisp at any zoom (a bitmap would be resolution-bound on a board that
// zooms continuously).
//
// Notion DB frames are snapshotted only while idle (static preview inside TipTap) — never while the
// interactive live table is up. See `snapshotEligible`.

const STORE_PREFIX = 'thinktable-frame-dom-'
const MAX_ENTRY_CHARS = 250_000 // Idle always-expanded tables are wider than text frames
const MAX_STORE_CHARS = 1_200_000 // Rough localStorage budget per board

type SnapshotEntry = {
  h: string // Hash of the source content — stale captures are never shown
  m: string // Sanitized outerHTML of the editor root
}

type SnapshotStore = Record<string, SnapshotEntry>

// Per-board memory mirror so cold frames never touch localStorage during a gesture.
const memory = new Map<string, SnapshotStore>()
const dirty = new Set<string>()
let flushHandle: ReturnType<typeof setTimeout> | null = null
// Bumped on every successful capture/invalidate so `coldReady` subscribers re-read without a prop change.
let storeEpoch = 0
const storeListeners = new Set<() => void>()

function bumpStoreEpoch() {
  storeEpoch += 1
  for (const listener of storeListeners) listener()
}

/** Subscribe to snapshot store writes — used so `coldReady` flips true right after first idle capture. */
export function subscribeFrameSnapshots(onStoreChange: () => void): () => void {
  storeListeners.add(onStoreChange)
  return () => {
    storeListeners.delete(onStoreChange)
  }
}

export function getFrameSnapshotEpoch(): number {
  return storeEpoch
}

/** Cheap non-cryptographic content hash (djb2) — only needs to detect edits. */
function hashContent(content: string): string {
  let h = 5381
  for (let i = 0; i < content.length; i++) h = ((h << 5) + h + content.charCodeAt(i)) | 0
  return (h >>> 0).toString(36) + ':' + content.length.toString(36)
}

export type FrameSnapshotKeyOpts = {
  /** Idle DB expand mode — compact vs always-expanded are different cold images. */
  dbExpand?: 'compact' | 'expanded' | null
}

/** True when TipTap HTML is a Notion databaseBlock frame (attr-only atom). */
export function contentHasDatabaseBlock(content: string | undefined | null): boolean {
  return !!content && /data-type=["']databaseBlock["']/i.test(content)
}

/** Stable per-frame key. Prompt and response bodies are separate editors in one frame. */
export function frameSnapshotKey(
  messageId: string | undefined,
  section?: string | null,
  opts?: FrameSnapshotKeyOpts
): string | null {
  if (!messageId) return null
  const base = `${messageId}:${section || 'main'}`
  if (opts?.dbExpand === 'compact' || opts?.dbExpand === 'expanded') {
    // `db2` busts captures taken before idle cells matched live `min-h-[28px]` row chrome.
    return `${base}:db2:${opts.dbExpand}`
  }
  return base
}

/** Resolve the DB expand slot for snapshot keys from frame metadata + HTML. */
export function dbExpandSnapshotSlot(
  content: string | undefined | null,
  dbAlwaysExpanded?: boolean
): 'compact' | 'expanded' | null {
  if (!contentHasDatabaseBlock(content)) return null
  return dbAlwaysExpanded ? 'expanded' : 'compact'
}

function storeKey(conversationId: string): string {
  return STORE_PREFIX + conversationId
}

function loadStore(conversationId: string): SnapshotStore {
  const cached = memory.get(conversationId)
  if (cached) return cached
  let parsed: SnapshotStore = {}
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(storeKey(conversationId))
      if (raw) {
        const value = JSON.parse(raw) as Record<string, unknown>
        for (const [k, v] of Object.entries(value)) {
          if (!v || typeof v !== 'object') continue
          const entry = v as Record<string, unknown>
          if (typeof entry.h === 'string' && typeof entry.m === 'string') {
            parsed[k] = { h: entry.h, m: entry.m }
          }
        }
      }
    } catch {
      parsed = {} // Corrupt / quota-denied — cold frames fall back to the shimmer path
    }
  }
  memory.set(conversationId, parsed)
  return parsed
}

/** Persist off the critical path — captures happen while the board is idle, not mid-gesture. */
function scheduleFlush(): void {
  if (typeof window === 'undefined' || flushHandle !== null) return
  flushHandle = setTimeout(() => {
    flushHandle = null
    for (const conversationId of dirty) {
      const store = memory.get(conversationId)
      if (!store) continue
      try {
        let serialized = JSON.stringify(store)
        if (serialized.length > MAX_STORE_CHARS) {
          // Insertion order is roughly least-recently-captured first; drop from the front.
          const keys = Object.keys(store)
          while (keys.length > 1 && serialized.length > MAX_STORE_CHARS) {
            delete store[keys.shift() as string]
            serialized = JSON.stringify(store)
          }
        }
        localStorage.setItem(storeKey(conversationId), serialized)
      } catch {
        // Quota / private mode — memory cache still serves this session
      }
    }
    dirty.clear()
  }, 1200)
}

/**
 * Idle paint only. A selected interactive DB (`data-tt-db-live`) must never be stored — replaying it
 * while unselected is the "full tables on deselect" regression. Static idle (title + preview +
 * connections) *is* the cold image we want, including for future connection NodeViews.
 */
export function snapshotEligible(root: HTMLElement): boolean {
  if (root.querySelector('[data-tt-db-live="true"], [data-tt-db-row-warm="true"]')) return false
  return true
}

/**
 * Clone the live editor root and strip everything that only makes sense while mounted.
 * Form controls need special care: a textarea/input shows `.value`, which never appears in markup.
 */
function sanitizedOuterHtml(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement
  const liveFields = Array.from(root.querySelectorAll('textarea, input'))
  const cloneFields = Array.from(clone.querySelectorAll('textarea, input'))
  cloneFields.forEach((field, i) => {
    const live = liveFields[i]
    if (field instanceof HTMLTextAreaElement && live instanceof HTMLTextAreaElement) {
      field.textContent = live.value // Property cell values live in .value only
    } else if (field instanceof HTMLInputElement && live instanceof HTMLInputElement) {
      field.setAttribute('value', live.value)
    }
    field.setAttribute('tabindex', '-1') // Cold content must stay out of the tab order
  })
  clone.removeAttribute('tabindex')
  clone.removeAttribute('spellcheck')
  clone.classList.remove('ProseMirror-focused')
  clone.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'))
  clone.querySelectorAll('.ProseMirror-gapcursor').forEach((n) => n.remove())
  clone.querySelectorAll('.ProseMirror-selectednode').forEach((n) =>
    n.classList.remove('ProseMirror-selectednode')
  )
  clone.querySelectorAll('.tt-block-highlight').forEach((n) =>
    n.classList.remove('tt-block-highlight')
  )
  // Column-window probes are absolute IO bars — useless (and misleading) when replayed cold.
  clone.querySelectorAll('[data-col-index]').forEach((n) => n.remove())
  clone.removeAttribute('contenteditable')
  // Keep `.ProseMirror-trailingBreak` — empty paragraphs collapse without it.
  return clone.outerHTML
}

/** Capture one frame's live subtree. Cheap (one clone + serialize); call from idle time. */
export function captureFrameSnapshot(opts: {
  conversationId?: string
  key: string | null
  content: string
  root: HTMLElement | null | undefined
}): void {
  const { conversationId, key, content, root } = opts
  if (!conversationId || !key || !root || typeof window === 'undefined') return
  if (!snapshotEligible(root)) return
  let markup: string
  try {
    markup = sanitizedOuterHtml(root)
  } catch {
    return
  }
  if (!markup || markup.length > MAX_ENTRY_CHARS) return
  const store = loadStore(conversationId)
  const h = hashContent(content)
  const prev = store[key]
  if (prev && prev.h === h && prev.m === markup) return // Nothing changed
  delete store[key] // Re-insert so insertion order tracks recency for eviction
  store[key] = { h, m: markup }
  dirty.add(conversationId)
  bumpStoreEpoch()
  scheduleFlush()
}

/** Markup for a cold frame, or null when we have never seen this exact content live. */
export function readFrameSnapshot(
  conversationId: string | undefined,
  key: string | null,
  content: string
): string | null {
  if (!conversationId || !key) return null
  const entry = loadStore(conversationId)[key]
  if (!entry) return null
  return entry.h === hashContent(content) ? entry.m : null // Edited since capture → shimmer instead
}

/** Drop a frame's capture (content replaced wholesale, frame deleted). */
export function invalidateFrameSnapshot(conversationId: string | undefined, key: string | null) {
  if (!conversationId || !key) return
  const store = loadStore(conversationId)
  if (!store[key]) return
  delete store[key]
  dirty.add(conversationId)
  bumpStoreEpoch()
  scheduleFlush()
}
