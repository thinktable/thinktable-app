// Bridge page selection + viewport from BoardFlow → AI sidebar without a heavy context rewrite

type Listener = () => void // Composer re-renders when live context changes
const listeners = new Set<Listener>() // Pub/sub subscribers

/** Notify all AI sidebar listeners that live context changed. */
function notify(): void {
  listeners.forEach((l) => l()) // Fire every subscriber
}

/** Subscribe to live AI context changes (frames / blocks / text / page). */
export function subscribeAiSelection(listener: Listener): () => void {
  listeners.add(listener) // Register
  return () => {
    listeners.delete(listener) // Cleanup
  }
}

let selectedFrameIds: string[] = [] // Module-level selection snapshot (message ids)
let viewportCenter = { x: 0, y: 0 } // Flow-space center of the visible page

const PREVIEW_MAX = 280 // Hover preview char cap

/** One selected frame (id + plain preview for pill hover). */
export type AiFrameSelectionItem = {
  id: string // messages.id / RF node id
  preview?: string // Plain text snippet shown on pill hover
}

/** Armed ⋮⋮ block selection within one frame (multi-block same frame → one pill). */
export type AiBlockSelection = {
  frameId: string // Host frame message id
  count: number // How many blocks armed via handle click
  preview?: string // Plain text of armed block(s) for hover
} | null

/** Non-empty TipTap text highlight for a context pill. */
export type AiTextSelection = {
  frameId: string // Host frame message id
  text: string // Selected plain text (hover + API)
} | null

/** Current board shown as a default context pill when chat opens. */
export type AiBoardContext = {
  id: string // conversations.id
  title: string // Board title
} | null

/** Live context pill rendered inside the composer. */
export type AiLiveContextPill = {
  id: string // Stable key for React + dismiss
  kind: 'board' | 'frame' | 'block' | 'text' | 'selection' // What the pill represents
  label: string // Visible chip text (fixed names, not content)
  frameId?: string // Related frame when kind ≠ page
  preview?: string // Hover reveals the referenced context
}

let selectedFrames: AiFrameSelectionItem[] = [] // Frame selection (RF)
let blockSelection: AiBlockSelection = null // Armed via ⋮⋮ only — not I-bar/caret
let textSelection: AiTextSelection = null // Highlighted text range
let pageContext: AiBoardContext = null // Default page pill

/** Clamp plain text for hover previews. */
export function clipAiPreview(text: string, max = PREVIEW_MAX): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return ''
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

/** Set / clear the current page pill (chat open + page load). */
export function setAiBoardContext(page: AiBoardContext): void {
  const same =
    (page === null && pageContext === null) ||
    (page !== null &&
      pageContext !== null &&
      page.id === pageContext.id &&
      page.title === pageContext.title)
  if (same) return // Avoid needless re-renders
  pageContext = page
  notify()
}

/** Read current page context for pills. */
export function getAiBoardContext(): AiBoardContext {
  return pageContext
}

/**
 * Publish selected frames (with optional content previews for hover).
 * Also keeps `selectedFrameIds` in sync for the chat request body.
 */
export function setAiSelectedFrames(frames: AiFrameSelectionItem[]): void {
  selectedFrames = frames.map((f) => ({
    id: f.id,
    preview: f.preview ? clipAiPreview(f.preview) : undefined,
  }))
  selectedFrameIds = frames.map((f) => f.id)
  notify()
}

/** Called from BoardFlow when RF selection changes (chatPanel message ids). */
export function setAiSelectedFrameIds(ids: string[]): void {
  selectedFrameIds = ids.slice()
  const prevById = new Map(selectedFrames.map((f) => [f.id, f.preview]))
  selectedFrames = ids.map((id) => ({ id, preview: prevById.get(id) }))
  notify()
}

/** Read by AiComposer when building the Ask/Edit request body. */
export function getAiSelectedFrameIds(): string[] {
  return selectedFrameIds.slice()
}

/** Publish armed ⋮⋮ block selection (null clears). Never publish for I-bar/caret alone. */
export function setAiBlockSelection(sel: AiBlockSelection): void {
  const next = sel
    ? {
        frameId: sel.frameId,
        count: sel.count,
        preview: sel.preview ? clipAiPreview(sel.preview) : undefined,
      }
    : null
  const same =
    (next === null && blockSelection === null) ||
    (next !== null &&
      blockSelection !== null &&
      next.frameId === blockSelection.frameId &&
      next.count === blockSelection.count &&
      next.preview === blockSelection.preview)
  if (same) return
  blockSelection = next
  notify()
}

/** Read armed ⋮⋮ block selection (top bar Turn into gates). */
export function getAiBlockSelection(): AiBlockSelection {
  return blockSelection
}

/** Publish TipTap text highlight (null clears). */
export function setAiTextSelection(sel: AiTextSelection): void {
  const same =
    (sel === null && textSelection === null) ||
    (sel !== null &&
      textSelection !== null &&
      sel.frameId === textSelection.frameId &&
      sel.text === textSelection.text)
  if (same) return
  textSelection = sel
  notify()
}

/** Called from BoardFlow on pan/zoom so Edit can place new frames in view. */
export function setAiViewportCenter(center: { x: number; y: number }): void {
  viewportCenter = { x: center.x, y: center.y }
}

/** Read by AiComposer when sending Edit creates. */
export function getAiViewportCenter(): { x: number; y: number } {
  return { x: viewportCenter.x, y: viewportCenter.y }
}

/** Build a multi-selection hover preview from live pieces. */
function multiSelectionPreview(): string {
  const parts: string[] = []
  if (selectedFrames.length > 1) {
    selectedFrames.forEach((f, i) => {
      const body = f.preview?.trim()
      parts.push(body ? `Frame ${i + 1}: ${body}` : `Frame ${i + 1}`)
    })
  } else if (selectedFrames.length === 1 && selectedFrames[0].preview) {
    // Single host frame under multi block/text — only list if useful alongside others
  }
  if (blockSelection && blockSelection.count > 0) {
    const body = blockSelection.preview?.trim()
    const head =
      blockSelection.count > 1 ? `Blocks (${blockSelection.count})` : 'Block'
    parts.push(body ? `${head}: ${body}` : head)
  }
  if (textSelection?.text?.trim()) {
    parts.push(`Text: ${clipAiPreview(textSelection.text)}`)
  }
  // If multi was only 2+ frames and we already listed them, done; else ensure something shows
  if (parts.length === 0 && selectedFrames.length > 0) {
    selectedFrames.forEach((f, i) => {
      const body = f.preview?.trim()
      parts.push(body ? `Frame ${i + 1}: ${body}` : `Frame ${i + 1}`)
    })
  }
  return parts.join('\n') || 'Multiple selections'
}

/**
 * Live context pills: page (when set) + one selection pill.
 * Host frame alone is ignored when a block/text inside it is selected.
 * "Currently selected" when multiple content selections are live (block+text, 2+ blocks, 2+ frames).
 * Each pill carries a `preview` for hover.
 */
export function getAiLiveContextPills(): AiLiveContextPill[] {
  const pills: AiLiveContextPill[] = []

  if (pageContext) {
    const title = pageContext.title.trim() || 'Board'
    pills.push({
      id: `page:${pageContext.id}`,
      kind: 'board',
      label: title,
      preview: title,
    })
  }

  const hasText = Boolean(textSelection?.text?.trim())
  const blockCount = blockSelection?.count ?? 0
  const hasBlock = blockCount > 0
  const frameCount = selectedFrames.length

  const isMulti =
    frameCount > 1 ||
    (hasBlock && hasText) ||
    blockCount > 1

  if (isMulti) {
    pills.push({
      id: 'selection:multi',
      kind: 'selection',
      label: 'Currently selected',
      preview: multiSelectionPreview(),
    })
    return pills
  }

  if (hasText && textSelection) {
    pills.push({
      id: `text:${textSelection.frameId}`,
      kind: 'text',
      label: 'Selected text',
      frameId: textSelection.frameId,
      preview: clipAiPreview(textSelection.text),
    })
    return pills
  }

  if (hasBlock && blockSelection) {
    pills.push({
      id: `block:${blockSelection.frameId}`,
      kind: 'block',
      label: 'Selected block',
      frameId: blockSelection.frameId,
      preview: blockSelection.preview || 'Selected block',
    })
    return pills
  }

  if (frameCount === 1) {
    const f = selectedFrames[0]
    pills.push({
      id: `frame:${f.id}`,
      kind: 'frame',
      label: 'Selected frame',
      frameId: f.id,
      preview: f.preview || 'Selected frame',
    })
  }

  return pills
}
