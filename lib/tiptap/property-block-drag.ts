// Drag property icons (top strip + in-frame) to reorder among property cells.

import type { Editor } from '@tiptap/core'
import type { PropertyTypeId } from '@/lib/blocks/property'
import { moveEditorBlockToPos } from '@/lib/tiptap/block-selection'
import {
  inlinePropertyBlockInBody,
  isPropertyBlockHeaderOnly,
  type PropertyHeaderItem,
} from '@/lib/tiptap/property-block'

export type PropertyDropLine = { top: number; left: number; width: number }

type BlockRect = PropertyDropLine & { from: number; to: number; bottom: number }

/** One visible body property cell (not the top-strip header group spanning many cells). */
export function isSingleVisiblePropertyCell(
  editor: Editor,
  block: { from: number; to: number; typeName: string }
): boolean {
  if (!editor || editor.isDestroyed || block.typeName !== 'propertyBlock') return false
  const node = editor.state.doc.nodeAt(block.from)
  if (!node || node.type.name !== 'propertyBlock') return false
  if (block.to !== block.from + node.nodeSize) return false // Header ⋮⋮ spans multiple cells
  return !isPropertyBlockHeaderOnly(node.attrs as Record<string, unknown>)
}

/** Every propertyBlock in doc order (optionally skip one being dragged). */
export function collectPropertyBlockPositions(
  editor: Editor,
  skipFrom?: number
): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'propertyBlock') return true
    if (skipFrom != null && pos === skipFrom) return false
    out.push({ from: pos, to: pos + node.nodeSize })
    return false
  })
  return out
}

const PROPERTY_ROW_HEIGHT = 32 // min-height 28 + vertical margin on .tt-property-block

function resolvePropertyBlockDom(editor: Editor, pos: number): HTMLElement | null {
  const raw = editor.view.nodeDOM(pos)
  if (!(raw instanceof HTMLElement)) return null
  if (raw.classList.contains('tt-property-block')) return raw
  return (raw.querySelector('.tt-property-block') as HTMLElement | null) ?? raw
}

/** Where inlined property rows stack when none are visible yet (all header-only on strip). */
function propertyStackAnchor(editor: Editor): { left: number; width: number; top: number } | null {
  const root = editor.view.dom as HTMLElement
  const link = root.querySelector('.tt-board-link') as HTMLElement | null
  if (link) {
    const r = link.getBoundingClientRect()
    return { left: r.left, width: Math.max(r.width, 160), top: r.bottom + 4 }
  }
  const visible = root.querySelector(
    '.tt-property-block:not([data-header-only="true"])'
  ) as HTMLElement | null
  if (visible) {
    const r = visible.getBoundingClientRect()
    return { left: r.left, width: Math.max(r.width, 160), top: r.top }
  }
  const pm = root.getBoundingClientRect()
  if (pm.height <= 0) return null
  return { left: pm.left, width: Math.max(pm.width, 160), top: pm.top + 8 }
}

/** Visible body property cells (filled or inline-empty) — not header-only strip ghosts. */
function collectVisiblePropertyRects(editor: Editor, skipFrom?: number): BlockRect[] {
  const blocks: BlockRect[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'propertyBlock') return true
    if (isPropertyBlockHeaderOnly(node.attrs as Record<string, unknown>)) return false
    if (skipFrom != null && pos === skipFrom) return false
    const dom = resolvePropertyBlockDom(editor, pos)
    if (!dom) return false
    const rect = dom.getBoundingClientRect()
    if (rect.height <= 0 || rect.width <= 0) return false
    blocks.push({
      from: pos,
      to: pos + node.nodeSize,
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
    })
    return false
  })
  return blocks
}

/** Estimated row slots when every property is still header-only (strip drag into frame). */
function collectSyntheticPropertyRects(editor: Editor, skipFrom?: number): BlockRect[] {
  const positions = collectPropertyBlockPositions(editor, skipFrom)
  const anchor = propertyStackAnchor(editor)
  if (!anchor || positions.length === 0) return []
  return positions.map((p, i) => ({
    from: p.from,
    to: p.to,
    top: anchor.top + i * PROPERTY_ROW_HEIGHT,
    bottom: anchor.top + (i + 1) * PROPERTY_ROW_HEIGHT,
    left: anchor.left,
    width: anchor.width,
  }))
}

function collectPropertyDropRects(editor: Editor, skipFrom?: number): BlockRect[] {
  const visible = collectVisiblePropertyRects(editor, skipFrom)
  if (visible.length > 0) return visible
  return collectSyntheticPropertyRects(editor, skipFrom)
}

function dropLineFromBlocks(
  blocks: BlockRect[],
  clientY: number
): { insertPos: number; line: PropertyDropLine } | null {
  if (blocks.length === 0) return null
  const first = blocks[0]
  const last = blocks[blocks.length - 1]
  if (clientY < first.top) {
    return { insertPos: first.from, line: { top: first.top, left: first.left, width: first.width } }
  }
  if (clientY > last.bottom) {
    return { insertPos: last.to, line: { top: last.bottom, left: last.left, width: last.width } }
  }
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (clientY >= b.top && clientY <= b.bottom) {
      const mid = (b.top + b.bottom) / 2
      if (clientY <= mid) {
        return { insertPos: b.from, line: { top: b.top, left: b.left, width: b.width } }
      }
      return { insertPos: b.to, line: { top: b.bottom, left: b.left, width: b.width } }
    }
    const next = blocks[i + 1]
    if (next && clientY > b.bottom && clientY < next.top) {
      const gapMid = (b.bottom + next.top) / 2
      const left = Math.min(b.left, next.left)
      const right = Math.max(b.left + b.width, next.left + next.width)
      return {
        insertPos: b.to,
        line: { top: gapMid, left, width: right - left },
      }
    }
  }
  return { insertPos: last.to, line: { top: last.bottom, left: last.left, width: last.width } }
}

/** Drop line between visible property cells in the frame body. */
export function findPropertyBlockDropTarget(
  editor: Editor,
  clientY: number,
  skipFrom?: number
): { insertPos: number; line: PropertyDropLine } | null {
  if (!editor || editor.isDestroyed) return null
  return dropLineFromBlocks(collectPropertyDropRects(editor, skipFrom), clientY)
}

/** When every property is still header-only, drop at end of the property run in the doc. */
export function endOfPropertyGroupInsertPos(editor: Editor, skipFrom?: number): number {
  const peers = collectPropertyBlockPositions(editor, skipFrom)
  if (peers.length === 0) return editor.state.doc.content.size
  return peers[peers.length - 1].to
}

/** Drop a property at `insertPos` — inline header-only cells first, then reorder. */
export function dropPropertyBlockAt(
  editor: Editor,
  from: number,
  insertPos?: number
): boolean {
  if (!editor || editor.isDestroyed || from < 0) return false
  const node = editor.state.doc.nodeAt(from)
  if (!node || node.type.name !== 'propertyBlock') return false
  const headerOnly = isPropertyBlockHeaderOnly(node.attrs as Record<string, unknown>)
  const pos = insertPos ?? endOfPropertyGroupInsertPos(editor, from)
  if (headerOnly) return inlinePropertyBlockInBody(editor, from, pos)
  const to = from + node.nodeSize
  return moveEditorBlockToPos(editor, from, to, pos)
}

/** Reorder a header-only property on the top strip (doc order only — stays on strip). */
export function reorderHeaderPropertyOnStrip(
  editor: Editor,
  from: number,
  targetIndex: number
): boolean {
  if (!editor || editor.isDestroyed || from < 0) return false
  const peers = collectPropertyBlockPositions(editor, from)
  if (peers.length === 0) return false
  const clamped = Math.max(0, Math.min(targetIndex, peers.length))
  let insertPos: number
  if (clamped >= peers.length) {
    insertPos = peers[peers.length - 1].to
  } else {
    insertPos = peers[clamped].from
  }
  const node = editor.state.doc.nodeAt(from)
  if (!node) return false
  const to = from + node.nodeSize
  return moveEditorBlockToPos(editor, from, to, insertPos)
}

/** Which top-strip icon index (doc order) the pointer is over. */
export function findPropertyHeaderDropIndex(
  headerEl: HTMLElement,
  clientX: number,
  _pageStart = 0 // legacy — strip scrolls; all icons stay in the DOM
): number {
  const scrollEl =
    (headerEl.closest('[data-tt-property-scroll]') as HTMLElement | null) ??
    (headerEl.parentElement as HTMLElement | null) ??
    headerEl
  const clip = scrollEl.getBoundingClientRect()
  const marks = headerEl.querySelectorAll('[data-tt-property-icon]')
  if (marks.length === 0) return 0

  if (clientX <= clip.left) {
    for (let i = 0; i < marks.length; i++) {
      const r = marks[i].getBoundingClientRect()
      if (r.right > clip.left) return i
    }
    return 0
  }

  for (let i = 0; i < marks.length; i++) {
    const r = marks[i].getBoundingClientRect()
    if (r.right <= clip.left) continue // Scrolled off the left
    if (r.left >= clip.right) break // Off the right — rest are too
    if (clientX < r.left + r.width / 2) return _pageStart + i
  }

  for (let i = marks.length - 1; i >= 0; i--) {
    const r = marks[i].getBoundingClientRect()
    if (r.left < clip.right && r.right > clip.left) return _pageStart + i + 1
  }
  return _pageStart + marks.length
}

export type PropertyIconDragCallbacks = {
  setGhost: (g: { x: number; y: number; type: PropertyTypeId } | null) => void
  setDropLine: (line: PropertyDropLine | null) => void
}

const DRAG_THRESHOLD_PX = 4

/** Pointer drag on a property icon — reorder in frame or on the top strip; click opens editor. */
export function bindPropertyIconDrag(
  e: React.PointerEvent<HTMLElement>,
  opts: {
    getEditor: () => Editor | null
    from: number
    el: HTMLElement
    headerEl?: HTMLElement | null
    pageStart?: number
    iconType: PropertyTypeId
    onClick: () => void
    callbacks: PropertyIconDragCallbacks
  }
): void {
  const { getEditor, from, el, headerEl, pageStart = 0, iconType, onClick, callbacks } = opts
  const ed = getEditor()
  if (!ed || from < 0) return
  e.stopPropagation()
  const start = { x: e.clientX, y: e.clientY, dragged: false, el }
  const onMove = (ev: PointerEvent) => {
    const editor = getEditor()
    if (!editor || editor.isDestroyed) return
    if (!start.dragged) {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD_PX) return
      start.dragged = true
      callbacks.setGhost({ x: ev.clientX, y: ev.clientY, type: iconType })
    }
    callbacks.setGhost({ x: ev.clientX, y: ev.clientY, type: iconType })
    const overHeader = !!document
      .elementFromPoint(ev.clientX, ev.clientY)
      ?.closest('[data-tt-property-header]')
    if (overHeader && headerEl) {
      callbacks.setDropLine(null)
      return
    }
    const drop = findPropertyBlockDropTarget(editor, ev.clientY, from)
    callbacks.setDropLine(drop?.line ?? null)
  }
  const onUp = (ev: PointerEvent) => {
    const editor = getEditor()
    callbacks.setGhost(null)
    callbacks.setDropLine(null)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    if (!editor || editor.isDestroyed) return
    if (!start.dragged) {
      onClick()
      return
    }
    const target = document.elementFromPoint(ev.clientX, ev.clientY)
    const strip = target?.closest('[data-tt-property-header]') as HTMLElement | null
    if (strip && headerEl) {
      const idx = findPropertyHeaderDropIndex(strip, ev.clientX, pageStart)
      reorderHeaderPropertyOnStrip(editor, from, idx)
      return
    }
    const drop = findPropertyBlockDropTarget(editor, ev.clientY, from)
    const insertPos = drop?.insertPos ?? endOfPropertyGroupInsertPos(editor, from)
    dropPropertyBlockAt(editor, from, insertPos)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

/** Resolve doc `from` for a header item (may be stale after reorder — match type+name). */
export function resolvePropertyHeaderFrom(
  editor: Editor,
  item: PropertyHeaderItem
): number {
  if (item.from >= 0) {
    const node = editor.state.doc.nodeAt(item.from)
    if (node?.type.name === 'propertyBlock') return item.from
  }
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'propertyBlock') return true
    if (!isPropertyBlockHeaderOnly(node.attrs as Record<string, unknown>)) return false
    const t = node.attrs.propertyType
    const name = typeof node.attrs.propertyName === 'string' ? node.attrs.propertyName.trim() : ''
    if (t === item.type && name === item.name) {
      found = pos
      return false
    }
    return false
  })
  return found
}
