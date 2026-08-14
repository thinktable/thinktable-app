// Board view captures + presentations (local until persisted). Searchable by board path, date/time, and captured words.

import { htmlToPlain } from '@/lib/ai/context-pack' // Strip frame HTML → searchable text

const CAPTURES_KEY = 'thinktable-board-captures' // localStorage: capture list
const PRESENTATIONS_KEY = 'thinktable-board-presentations' // localStorage: presentation list

/** Saved camera/region of a board (timestamp + path + words). */
export type BoardCapture = {
  id: string // UUID
  createdAt: string // ISO timestamp
  boardId: string // conversations.id at capture time
  boardPath: string // Ancestor / … / board label
  text: string // Plain words from frames (search + chat)
  viewport: { x: number; y: number; zoom: number } // RF camera for later present/nav
  imageDataUrl?: string // JPEG of the visible board (mini + expanded preview)
}

/** Ordered set of captures to step through later. */
export type BoardPresentation = {
  id: string // UUID
  name: string // Display title (search key)
  createdAt: string // ISO
  captureIds: string[] // Captures in this presentation
}

/** Lightweight board row used to walk the ancestor path. */
export type CapturePathBoard = {
  id: string
  title: string
  parent_id: string | null
}

type CaptureListener = () => void // Store subscribers (menus + composer)

const captureListeners = new Set<CaptureListener>() // Capture/presentation list
const chatListeners = new Set<CaptureListener>() // Chat-attached capture ids

let capturesCache: BoardCapture[] | null = null // Stable snapshot for useSyncExternalStore
let presentationsCache: BoardPresentation[] | null = null // Stable snapshot
let chatCaptureIds: string[] = [] // In-memory ids attached to the composer
let chatCapturesCache: BoardCapture[] = [] // Stable resolved pills

/** Notify capture/presentation list subscribers. */
function notifyCaptures() {
  captureListeners.forEach((fn) => fn())
}

/** Notify chat-attachment subscribers. */
function notifyChat() {
  chatListeners.forEach((fn) => fn())
}

/** Subscribe to capture/presentation list changes. */
export function subscribeCaptures(fn: CaptureListener): () => void {
  captureListeners.add(fn)
  return () => {
    captureListeners.delete(fn)
  }
}

/** Subscribe to chat-attached capture ids. */
export function subscribeChatCaptures(fn: CaptureListener): () => void {
  chatListeners.add(fn)
  return () => {
    chatListeners.delete(fn)
  }
}

/** Read captures (newest first). SSR → empty. Cached for useSyncExternalStore. */
export function getCaptures(): BoardCapture[] {
  if (typeof window === 'undefined') return []
  if (capturesCache) return capturesCache
  try {
    const raw = localStorage.getItem(CAPTURES_KEY)
    const list = raw ? (JSON.parse(raw) as BoardCapture[]) : []
    capturesCache = Array.isArray(list) ? list : []
  } catch {
    capturesCache = []
  }
  return capturesCache
}

/** Persist captures (drop oldest images if localStorage quota is hit). */
function setCaptures(next: BoardCapture[]) {
  const write = (list: BoardCapture[]) => {
    localStorage.setItem(CAPTURES_KEY, JSON.stringify(list)) // Persist JSON
    capturesCache = list // Stable snapshot
  }
  try {
    write(next)
  } catch {
    const stripped = next.map((c, i) => (i < 8 ? c : { ...c, imageDataUrl: undefined })) // Keep images on newest 8
    try {
      write(stripped)
    } catch {
      write(next.map((c) => ({ ...c, imageDataUrl: undefined }))) // Last resort: text-only
    }
  }
  refreshChatCapturesCache()
  notifyCaptures()
}

/** Read presentations (newest first). SSR → empty. Cached for useSyncExternalStore. */
export function getPresentations(): BoardPresentation[] {
  if (typeof window === 'undefined') return []
  if (presentationsCache) return presentationsCache
  try {
    const raw = localStorage.getItem(PRESENTATIONS_KEY)
    const list = raw ? (JSON.parse(raw) as BoardPresentation[]) : []
    presentationsCache = Array.isArray(list) ? list : []
  } catch {
    presentationsCache = []
  }
  return presentationsCache
}

/** Persist presentations and notify. */
function setPresentations(next: BoardPresentation[]) {
  presentationsCache = next
  localStorage.setItem(PRESENTATIONS_KEY, JSON.stringify(next))
  notifyCaptures()
}

/** Rebuild the chat-pill snapshot when ids or the capture list change. */
function refreshChatCapturesCache() {
  const byId = new Map(getCaptures().map((c) => [c.id, c]))
  chatCapturesCache = chatCaptureIds.map((id) => byId.get(id)).filter((c): c is BoardCapture => Boolean(c))
}

/** Chat-attached capture ids (composer pills). */
export function getChatCaptureIds(): string[] {
  return chatCaptureIds
}

/** Locale timestamp for list rows + date/time search. */
export function formatCaptureTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Walk parent_id chain → "Root / … / Board". */
export function pathLabelForBoard(boardId: string, boards: CapturePathBoard[]): string {
  const byId = new Map(boards.map((b) => [b.id, b]))
  const parts: string[] = []
  let id: string | null = boardId
  const seen = new Set<string>()
  while (id && !seen.has(id) && parts.length < 20) {
    seen.add(id)
    const row = byId.get(id)
    if (!row) {
      parts.unshift('Untitled')
      break
    }
    parts.unshift(row.title || 'Untitled')
    id = row.parent_id
  }
  return parts.join(' / ') || 'Untitled'
}

/** Haystack for capture search: board path, date/time, and words inside. */
export function captureSearchHaystack(capture: BoardCapture): string {
  const ts = formatCaptureTimestamp(capture.createdAt)
  return `${capture.boardPath} ${ts} ${capture.createdAt} ${capture.text}`.toLowerCase()
}

/** Filter captures by free-text (path / date / words) and optional this-board scope. */
export function filterCaptures(
  captures: BoardCapture[],
  query: string,
  opts?: { boardId?: string; thisBoardOnly?: boolean }
): BoardCapture[] {
  const scoped = opts?.thisBoardOnly && opts.boardId
    ? captures.filter((c) => c.boardId === opts.boardId)
    : captures
  const q = query.trim().toLowerCase()
  if (!q) return scoped
  return scoped.filter((c) => captureSearchHaystack(c).includes(q))
}

/** Filter presentations by name. */
export function filterPresentations(
  presentations: BoardPresentation[],
  query: string
): BoardPresentation[] {
  const q = query.trim().toLowerCase()
  if (!q) return presentations
  return presentations.filter((p) => p.name.toLowerCase().includes(q))
}

/** Next unused "Presentation" / "Presentation 2" name. */
export function nextPresentationName(existing: BoardPresentation[]): string {
  const used = new Set(existing.map((p) => p.name))
  if (!used.has('Presentation')) return 'Presentation'
  let n = 2
  while (used.has(`Presentation ${n}`)) n += 1
  return `Presentation ${n}`
}

type QueryDataGetter = (key: unknown[]) => unknown // react-query getQueryData

/** Gather path + frame words + viewport for a new capture of the current view. */
export function buildCaptureInput(
  getQueryData: QueryDataGetter,
  boardId: string,
  viewport: { x: number; y: number; zoom: number }
): Omit<BoardCapture, 'id' | 'createdAt'> {
  const boards = (getQueryData(['path-board-menu']) as CapturePathBoard[] | undefined) || []
  const boardPath = pathLabelForBoard(boardId, boards)
  const msgs =
    (getQueryData(['messages-for-panels', boardId, 'full']) as Array<{ content?: string }> | undefined) ||
    (getQueryData(['messages-for-panels', boardId]) as Array<{ content?: string }> | undefined) ||
    []
  const text = msgs
    .map((m) => htmlToPlain(m.content))
    .filter((t) => t.length > 0)
    .join('\n')
  return { boardId, boardPath, text, viewport }
}

const VIEW_JPEG_MAX_W = 480 // Expanded-preview width; mini uses the same file via CSS

/** JPEG of the visible board (current camera), scaled for storage. */
export async function captureBoardViewImage(): Promise<string | undefined> {
  if (typeof document === 'undefined') return undefined
  const el = document.querySelector('.react-flow') as HTMLElement | null // Main board pane (chrome sits outside RF)
  if (!el || el.clientWidth < 8 || el.clientHeight < 8) return undefined
  try {
    const { toJpeg } = await import('html-to-image') // RF-recommended DOM snapshot
    const w = el.clientWidth
    const h = el.clientHeight
    const scale = Math.min(1, VIEW_JPEG_MAX_W / w)
    const dataUrl = await toJpeg(el, {
      quality: 0.62,
      pixelRatio: 1,
      cacheBust: true,
      width: Math.round(w * scale),
      height: Math.round(h * scale),
      style: {
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        width: `${w}px`,
        height: `${h}px`,
      },
      filter: (node) => {
        if (!(node instanceof HTMLElement)) return true
        const cls = node.classList
        return (
          !cls.contains('react-flow__minimap') &&
          !cls.contains('react-flow__controls') &&
          !cls.contains('react-flow__panel') &&
          !cls.contains('react-flow__attribution')
        )
      },
    })
    return dataUrl || undefined
  } catch {
    return undefined // Still save the capture without an image
  }
}

/** Build + JPEG-snapshot the current view and append it to the list. */
export async function takeBoardCapture(
  getQueryData: QueryDataGetter,
  boardId: string,
  viewport: { x: number; y: number; zoom: number }
): Promise<BoardCapture> {
  const input = buildCaptureInput(getQueryData, boardId, viewport)
  const imageDataUrl = await captureBoardViewImage()
  return addCapture({ ...input, imageDataUrl })
}

/** Append a capture (newest first) and return it. */
export function addCapture(input: Omit<BoardCapture, 'id' | 'createdAt'>): BoardCapture {
  const capture: BoardCapture = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
  setCaptures([capture, ...getCaptures()])
  return capture
}

/** Create a presentation seeded with the given capture ids. */
export function createPresentation(captureIds: string[]): BoardPresentation {
  const existing = getPresentations()
  const presentation: BoardPresentation = {
    id: crypto.randomUUID(),
    name: nextPresentationName(existing),
    createdAt: new Date().toISOString(),
    captureIds: [...new Set(captureIds)],
  }
  setPresentations([presentation, ...existing])
  return presentation
}

/** Append capture ids onto an existing presentation (deduped). */
export function addCapturesToPresentation(presentationId: string, captureIds: string[]): void {
  setPresentations(
    getPresentations().map((p) => {
      if (p.id !== presentationId) return p
      const ids = [...new Set([...p.captureIds, ...captureIds])]
      return { ...p, captureIds: ids }
    })
  )
}

/** Insert a capture at index (no-op if already in the presentation). */
export function insertCaptureIntoPresentation(
  presentationId: string,
  captureId: string,
  index: number
): void {
  setPresentations(
    getPresentations().map((p) => {
      if (p.id !== presentationId) return p
      if (p.captureIds.includes(captureId)) return p
      const ids = [...p.captureIds]
      const i = Math.max(0, Math.min(index, ids.length))
      ids.splice(i, 0, captureId)
      return { ...p, captureIds: ids }
    })
  )
}

/** Replace the capture order for a presentation (reorder). */
export function setPresentationCaptureOrder(presentationId: string, captureIds: string[]): void {
  setPresentations(
    getPresentations().map((p) => (p.id === presentationId ? { ...p, captureIds } : p))
  )
}

/** Rename a presentation (empty → Untitled). */
export function renamePresentation(id: string, name: string): void {
  const trimmed = name.trim() || 'Untitled'
  setPresentations(getPresentations().map((p) => (p.id === id ? { ...p, name: trimmed } : p)))
}

/** Merge selected presentations into the first: union captures, drop the rest. */
export function mergePresentations(ids: string[]): BoardPresentation | null {
  const unique = [...new Set(ids)]
  if (unique.length < 2) return null
  const all = getPresentations()
  const ordered = unique.map((id) => all.find((p) => p.id === id)).filter((p): p is BoardPresentation => Boolean(p))
  if (ordered.length < 2) return null
  const keep = ordered[0]
  const captureIds = [...new Set(ordered.flatMap((p) => p.captureIds))]
  const drop = new Set(ordered.slice(1).map((p) => p.id))
  const merged: BoardPresentation = { ...keep, captureIds }
  setPresentations(all.filter((p) => !drop.has(p.id)).map((p) => (p.id === keep.id ? merged : p)))
  return merged
}

/** Attach captures as composer pills (opens chat separately). */
export function attachCapturesToChat(ids: string[]): void {
  const next = new Set(chatCaptureIds)
  ids.forEach((id) => next.add(id))
  chatCaptureIds = [...next]
  refreshChatCapturesCache()
  notifyChat()
}

/** Dismiss one capture pill from the composer. */
export function detachCaptureFromChat(id: string): void {
  chatCaptureIds = chatCaptureIds.filter((x) => x !== id)
  refreshChatCapturesCache()
  notifyChat()
}

/** Resolve attached chat captures (drops ids that were deleted). */
export function getChatCaptures(): BoardCapture[] {
  return chatCapturesCache
}
