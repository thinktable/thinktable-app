'use client'

// Virtualized Notion DB table/list bodies + memoized row cells (perf).

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, ChevronDown, ChevronRight, GripVertical, Plus } from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  BlockActionsMenu,
  type BlockActionId,
  type BlockActionPayload,
  type DbConvertLayoutId,
} from '@/components/block-actions-menu'
import {
  isNotionPropertyEditable,
  notionSelectColor,
  type NotionDbCell,
  type NotionDbProperty,
  type NotionDbRow,
  type NotionPropertyEditValue,
} from '@/lib/notion/database'
import { NOTION_ROW_DRAG_MIME, type NotionRowDragPayload } from '@/lib/notion/row-to-card-client'
import type { DatabaseViewSettings } from '@/lib/notion/database-view'
import { columnWidthPx } from '@/lib/notion/database-view'
import { elementUniformScale } from '@/lib/dom-transform'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export const DB_TABLE_ROW_HEIGHT = 32
export const DB_TABLE_SCROLL_CAP = 480 // Internal scroll + virtualization above this height
export const DB_TABLE_VIRTUALIZE_MIN = 20 // Row count before capping height

const ROW_GUTTER = 20
// Viewport-windowing granularity for expanded tables. Matches the static preview's 12-row slice, so
// an on-screen chunk costs about what the unselected preview costs.
const ROW_CHUNK = 12

/** Map a click's clientX to a caret index inside a single-line text input. */
function caretIndexAtClientX(input: HTMLInputElement, clientX: number): number {
  const text = input.value
  if (!text) return 0
  const style = window.getComputedStyle(input)
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return text.length
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`.trim()
  const padL = parseFloat(style.paddingLeft) || 0
  const target = clientX - input.getBoundingClientRect().left - padL + (input.scrollLeft || 0)
  if (target <= 0) return 0
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(text.slice(0, mid)).width <= target) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * Caret index in `value` from a click on the cold cell paint (not the later input).
 * Uses caretRangeFromPoint so board zoom / cell padding match what the user clicked.
 */
export function caretIndexFromColdClick(
  clientX: number,
  clientY: number,
  root: Element,
  value: string
): number {
  if (!value) return 0
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  let node: Node | null = null
  let offset = 0
  if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(clientX, clientY)
    if (range && root.contains(range.startContainer)) {
      node = range.startContainer
      offset = range.startOffset
    }
  } else if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(clientX, clientY)
    if (pos && root.contains(pos.offsetNode)) {
      node = pos.offsetNode
      offset = pos.offset
    }
  }
  if (!node) {
    // Fallback: ratio across the root box (zoom-safe via getBoundingClientRect).
    const rect = root.getBoundingClientRect()
    const t = rect.width > 0 ? (clientX - rect.left) / rect.width : 1
    return Math.max(0, Math.min(value.length, Math.round(t * value.length)))
  }
  // Absolute offset among text nodes under root, then clamp to the editable value length
  // (cold paint may show "Empty" or an icon + title — don't overshoot the real string).
  let abs = 0
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n: Node | null = walk.nextNode()
  while (n) {
    const len = (n.textContent || '').length
    if (n === node) return Math.max(0, Math.min(value.length, abs + offset))
    abs += len
    n = walk.nextNode()
  }
  return Math.max(0, Math.min(value.length, abs))
}
// Screen-px band kept mounted to each side of the window, so a column is already there when a pan
// brings it in.
const COL_BAND_PX = 400

/** Inclusive on-screen column band. `null` = no windowing (render every column). */
export type ColumnRange = { start: number; end: number } | null

/**
 * Horizontal twin of `RowChunk`: which columns are on screen, plus the probe overlay that measures it.
 *
 * Rows were already windowed, but every mounted row still painted *all* its columns — a 15-column,
 * 2530px-wide table inside a 597px window built 363 cells to show ~100. A CPU profile of one select
 * spent 477ms in `jsxDEV` versus 14ms in this file's own code, i.e. selection cost is cell *element
 * count*, not logic, so off-screen cells must not be created at all.
 *
 * Probes are **full-height absolute bars, one per column**, rendered into the table wrapper. The
 * obvious probe — the `<th>`s, already one per column at the right offsets — does not work: React
 * Flow's pane is `overflow: hidden`, ancestor clipping is applied *before* `rootMargin`, so the moment
 * the header pans above the window every `<th>` reports off-screen, the observer sees an empty set and
 * windowing silently turns itself off. A bar spanning the table's height always overlaps whatever
 * slice of the table is visible, so the test reduces to the x axis on its own.
 *
 * IntersectionObserver (not transform math) keeps this correct under the board's pan/zoom/rotate with
 * zero per-frame JS, and the wrapper's own `overflow: hidden` clips the bars for free, so columns the
 * frame itself hides are windowed out too.
 */
export function useVisibleColumnRange(
  columns: NotionDbProperty[],
  settings: DatabaseViewSettings
): { colRange: ColumnRange; columnProbes: React.ReactNode } {
  // First commit has no layout to observe yet, so seed the band from the widest thing that could be
  // on screen (window width in board px) starting at column 0 — the case when you zoom to a frame.
  // A wrong guess self-corrects on the observer's first callback, one frame later.
  const [range, setRange] = useState<ColumnRange>(() => {
    if (typeof window === 'undefined' || columns.length === 0) return null
    const viewport = document.querySelector('.react-flow__viewport')
    const scale = viewport instanceof HTMLElement ? elementUniformScale(viewport) : 1
    const budget = window.innerWidth / Math.max(scale, 0.05) + COL_BAND_PX
    let acc = 0
    for (let i = 0; i < columns.length; i++) {
      acc += columnWidthPx(columns[i]!, settings)
      if (acc > budget) return { start: 0, end: i }
    }
    return null // Whole table fits on screen — nothing to window
  })

  // The probe host node, not a ref: a ref object never changes identity, so the effect could not
  // re-run when React replaced the overlay (loading → loaded, layout switch) and the observer would
  // keep watching detached bars.
  const [probeHost, setProbeHost] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setRange(null) // No observer (SSR / old browser): correctness beats the optimization
      return
    }
    // A missing host is transient — keep the current band rather than widening to every column, which
    // would look like a fix and cost like the bug.
    if (!probeHost) return
    const probes = Array.from(probeHost.querySelectorAll<HTMLElement>('[data-col-index]'))
    if (probes.length < 2) return
    const onScreen = new Set<number>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const i = Number((entry.target as HTMLElement).dataset.colIndex)
          if (Number.isNaN(i)) continue
          if (entry.isIntersecting) onScreen.add(i)
          else onScreen.delete(i)
        }
        // Table entirely off screen to the left/right: keep the last band rather than collapsing to
        // nothing, so panning back does not have to rebuild from zero.
        if (onScreen.size === 0) return
        let start = Number.POSITIVE_INFINITY
        let end = -1
        for (const i of onScreen) {
          if (i < start) start = i
          if (i > end) end = i
        }
        setRange((prev) => (prev && prev.start === start && prev.end === end ? prev : { start, end }))
      },
      { rootMargin: `0px ${COL_BAND_PX}px` }
    )
    for (const probe of probes) io.observe(probe)
    return () => io.disconnect()
  }, [probeHost, columns.length])

  // `left` starts at ROW_GUTTER because the wrapper pads that much for the row gutter, and an absolute
  // child is placed against the *padding* box — without it every bar sits one gutter left of its column.
  const columnProbes = useMemo(() => {
    let x = ROW_GUTTER
    const bars = columns.map((prop, i) => {
      const left = x
      const width = columnWidthPx(prop, settings)
      x += width
      return (
        <div
          key={prop.id}
          data-col-index={i}
          style={{ position: 'absolute', top: 0, bottom: 0, left, width }}
        />
      )
    })
    return (
      <div ref={setProbeHost} aria-hidden className="pointer-events-none absolute inset-0">
        {bars}
      </div>
    )
  }, [columns, settings])

  return { colRange: range, columnProbes }
}

export type SaveFn = (
  pageId: string,
  propertyName: string,
  value: NotionPropertyEditValue
) => Promise<void>

export type FlatTableItem =
  | { kind: 'group'; key: string; label: string; count: number }
  | {
      kind: 'row'
      row: NotionDbRow
      depth: number
      insertBeforeAfterId: string | null
    }

/** Colored option pill (select / multi_select / status). */
function TagPill({ name, color }: { name: string; color?: string }) {
  const { bg, fg } = notionSelectColor(color)
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-tight max-w-full truncate"
      style={{ background: bg, color: fg }}
    >
      {name}
    </span>
  )
}

/** Read-only display — exported for board/gallery layouts. */
export function CellDisplay({
  prop,
  cell,
  rowIcon,
}: {
  prop: NotionDbProperty
  cell?: NotionDbCell
  rowIcon?: string | null
}) {
  if (prop.type === 'checkbox') {
    return (
      <span
        className={cn(
          'inline-flex h-4 w-4 items-center justify-center rounded-[3px] border',
          cell?.checked
            ? 'bg-[#2eaadc] border-[#2eaadc] text-white'
            : 'bg-white border-gray-300'
        )}
        aria-checked={!!cell?.checked}
        role="checkbox"
      >
        {cell?.checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
      </span>
    )
  }
  if (prop.type === 'select' || prop.type === 'multi_select' || prop.type === 'status') {
    const tags = cell?.tags || []
    if (tags.length === 0) return <span className="text-gray-300 text-[13px]">Empty</span>
    return (
      <span className="inline-flex flex-wrap gap-1">
        {tags.map((t) => (
          <TagPill key={t.name} name={t.name} color={t.color} />
        ))}
      </span>
    )
  }
  if (prop.type === 'title') {
    return (
      <span className="flex items-center gap-1.5 min-w-0 max-w-full overflow-hidden font-medium text-[13px] text-gray-900">
        {rowIcon ? <span className="flex-shrink-0 leading-none">{rowIcon}</span> : null}
        <span className="min-w-0 truncate">{cell?.text || 'Untitled'}</span>
      </span>
    )
  }
  return (
    <span className="block min-w-0 truncate text-[13px] text-gray-700 tabular-nums">
      {cell?.text || <span className="text-gray-300">Empty</span>}
    </span>
  )
}

function TextCellEditor({
  prop,
  cell,
  rowIcon,
  pageId,
  onSave,
  saving,
  autoEdit = false,
  caretIndex = null,
}: {
  prop: NotionDbProperty
  cell?: NotionDbCell
  rowIcon?: string | null
  pageId: string
  onSave: SaveFn
  saving: boolean
  /** Static → live row engage: open input + caret on first paint. */
  autoEdit?: boolean
  /** Character offset from the cold-cell click (preferred over guessing from screen X). */
  caretIndex?: number | null
}) {
  const [editing, setEditing] = useState(autoEdit)
  const [draft, setDraft] = useState(cell?.text || '')
  const inputRef = useRef<HTMLInputElement>(null)
  const caretIndexRef = useRef(caretIndex)
  caretIndexRef.current = caretIndex
  const pendingClickXRef = useRef<number | null>(null)
  // Warm handoff: TipTap/container click often steals focus right after we place the I-bar.
  const ignoreBlurUntilRef = useRef(autoEdit ? performance.now() + 400 : 0)

  useEffect(() => {
    if (!editing) setDraft(cell?.text || '')
  }, [cell?.text, editing])

  const placeCaret = useCallback(() => {
    const input = inputRef.current
    if (!input) return
    input.focus({ preventScroll: true })
    if (input.type === 'text' || input.type === 'url' || input.type === 'email' || input.type === 'tel') {
      const fromCold = caretIndexRef.current
      const fromClick = pendingClickXRef.current
      pendingClickXRef.current = null
      let idx =
        typeof fromCold === 'number' && Number.isFinite(fromCold)
          ? fromCold
          : typeof fromClick === 'number'
            ? caretIndexAtClientX(input, fromClick)
            : input.value.length
      idx = Math.max(0, Math.min(input.value.length, idx))
      try {
        input.setSelectionRange(idx, idx)
      } catch {
        // number/date inputs reject setSelectionRange in some browsers
      }
    }
  }, [])

  useEffect(() => {
    if (!editing) return
    if (autoEdit) ignoreBlurUntilRef.current = performance.now() + 400
    // Double rAF: wait for layout after cold→warm swap, then beat the trailing click's focus steal.
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => placeCaret())
    })
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
    }
  }, [editing, autoEdit, placeCaret])

  const commit = async () => {
    setEditing(false)
    const next = draft.trim()
    const prev = (cell?.text || '').trim()
    if (next === prev) return
    if (prop.type === 'number') {
      if (next === '') {
        await onSave(pageId, prop.name, { type: 'number', number: null })
      } else {
        const n = parseFloat(next)
        if (Number.isNaN(n)) {
          setDraft(cell?.text || '')
          return
        }
        await onSave(pageId, prop.name, { type: 'number', number: n })
      }
      return
    }
    const type = prop.type as 'title' | 'rich_text' | 'url' | 'email' | 'phone_number' | 'date'
    await onSave(pageId, prop.name, { type, text: next })
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={cn(
          'w-full min-w-0 max-w-full min-h-[28px] overflow-hidden text-left rounded px-0.5 -mx-0.5 hover:bg-black/[0.04]',
          saving && 'opacity-60'
        )}
        onClick={(e) => {
          e.stopPropagation()
          pendingClickXRef.current = e.clientX
          caretIndexRef.current = null
          setEditing(true)
        }}
        disabled={saving}
      >
        <CellDisplay prop={prop} cell={cell} rowIcon={rowIcon} />
      </button>
    )
  }

  return (
    <input
      ref={inputRef}
      type={prop.type === 'number' ? 'number' : prop.type === 'date' ? 'date' : 'text'}
      className="w-full min-w-0 rounded border border-blue-400 bg-white px-1 py-0.5 text-[13px] outline-none"
      value={draft}
      disabled={saving}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        // Trailing click after cold→warm often focuses TipTap and blurs us — keep the I-bar.
        if (performance.now() < ignoreBlurUntilRef.current) {
          requestAnimationFrame(() => placeCaret())
          return
        }
        void commit()
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          void commit()
        }
        if (e.key === 'Escape') {
          setDraft(cell?.text || '')
          setEditing(false)
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    />
  )
}

function CheckboxCellEditor({
  prop,
  cell,
  pageId,
  onSave,
  saving,
}: {
  prop: NotionDbProperty
  cell?: NotionDbCell
  pageId: string
  onSave: SaveFn
  saving: boolean
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center rounded p-0.5 hover:bg-black/[0.04]',
        saving && 'opacity-60'
      )}
      disabled={saving}
      onClick={(e) => {
        e.stopPropagation()
        void onSave(pageId, prop.name, {
          type: 'checkbox',
          checked: !cell?.checked,
        })
      }}
      aria-label={cell?.checked ? 'Uncheck' : 'Check'}
    >
      <CellDisplay prop={prop} cell={cell} />
    </button>
  )
}

function SelectCellEditor({
  prop,
  cell,
  pageId,
  onSave,
  saving,
}: {
  prop: NotionDbProperty
  cell?: NotionDbCell
  pageId: string
  onSave: SaveFn
  saving: boolean
}) {
  const options = prop.options || []
  const current = cell?.tags?.[0]?.name || null
  const type = prop.type as 'select' | 'status'

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'w-full min-h-[28px] text-left rounded px-0.5 -mx-0.5 hover:bg-black/[0.04]',
            saving && 'opacity-60'
          )}
          disabled={saving}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <CellDisplay prop={prop} cell={cell} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-64 min-w-[180px] overflow-y-auto z-[200]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {options.length === 0 ? (
          <DropdownMenuItem disabled>No options in Notion</DropdownMenuItem>
        ) : (
          options.map((opt) => (
            <DropdownMenuItem
              key={opt.id || opt.name}
              className={cn(current === opt.name && 'bg-accent')}
              onSelect={() => {
                void onSave(pageId, prop.name, { type, name: opt.name })
              }}
            >
              <TagPill name={opt.name} color={opt.color} />
            </DropdownMenuItem>
          ))
        )}
        {current ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void onSave(pageId, prop.name, { type, name: null })
              }}
            >
              <span className="text-gray-500 text-xs">Clear</span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MultiSelectCellEditor({
  prop,
  cell,
  pageId,
  onSave,
  saving,
}: {
  prop: NotionDbProperty
  cell?: NotionDbCell
  pageId: string
  onSave: SaveFn
  saving: boolean
}) {
  const options = prop.options || []
  const selected = new Set((cell?.tags || []).map((t) => t.name))

  const toggle = (name: string) => {
    const next = new Set(selected)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    const names = options.filter((o) => next.has(o.name)).map((o) => o.name)
    for (const n of next) {
      if (!names.includes(n)) names.push(n)
    }
    void onSave(pageId, prop.name, { type: 'multi_select', names })
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'w-full min-h-[28px] text-left rounded px-0.5 -mx-0.5 hover:bg-black/[0.04]',
            saving && 'opacity-60'
          )}
          disabled={saving}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <CellDisplay prop={prop} cell={cell} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-64 min-w-[200px] overflow-y-auto z-[200]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {options.length === 0 ? (
          <DropdownMenuItem disabled>No options in Notion</DropdownMenuItem>
        ) : (
          options.map((opt) => (
            <DropdownMenuCheckboxItem
              key={opt.id || opt.name}
              checked={selected.has(opt.name)}
              onCheckedChange={() => toggle(opt.name)}
              onSelect={(e) => e.preventDefault()}
            >
              <TagPill name={opt.name} color={opt.color} />
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Idle-row cell: the same box an unarmed `EditableCell` paints, minus the arm handlers.
 * `px-0.5 -mx-0.5` on the interactive variant cancel out, so the layout box is identical and the
 * hover affordance appears exactly when the row is hydrated — i.e. when it can actually be used.
 */
function StaticCell({
  prop,
  cell,
  rowIcon,
}: {
  prop: NotionDbProperty
  cell?: NotionDbCell
  rowIcon?: string | null
}) {
  return (
    <div className="min-h-[28px] w-full min-w-0 max-w-full overflow-hidden">
      <CellDisplay prop={prop} cell={cell} rowIcon={rowIcon} />
    </div>
  )
}

/** Lazy-mount heavy editors on every platform — display until click. */
function EditableCell({
  prop,
  cell,
  rowIcon,
  pageId,
  onSave,
  saving,
  startArmed = false,
  caretIndex = null,
}: {
  prop: NotionDbProperty
  cell?: NotionDbCell
  rowIcon?: string | null
  pageId: string
  onSave: SaveFn
  saving: boolean
  /** Row engage from static preview — skip display-only click before edit. */
  startArmed?: boolean
  /** Cold-click caret offset for TextCellEditor. */
  caretIndex?: number | null
}) {
  const [armed, setArmed] = useState(startArmed)

  if (!armed) {
    const interactive = isNotionPropertyEditable(prop.type)
    return (
      <div
        className={cn(
          'min-h-[28px] w-full min-w-0 max-w-full overflow-hidden',
          interactive && 'cursor-text rounded px-0.5 -mx-0.5 hover:bg-black/[0.04]'
        )}
        onPointerDown={(e) => {
          if (!interactive) return
          e.stopPropagation()
          setArmed(true)
        }}
        onClick={(e) => {
          if (!interactive) return
          e.stopPropagation()
          setArmed(true)
        }}
      >
        <CellDisplay prop={prop} cell={cell} rowIcon={rowIcon} />
      </div>
    )
  }

  if (!isNotionPropertyEditable(prop.type)) {
    return <CellDisplay prop={prop} cell={cell} rowIcon={rowIcon} />
  }
  if (prop.type === 'checkbox') {
    return (
      <CheckboxCellEditor prop={prop} cell={cell} pageId={pageId} onSave={onSave} saving={saving} />
    )
  }
  if (prop.type === 'select' || prop.type === 'status') {
    return (
      <SelectCellEditor prop={prop} cell={cell} pageId={pageId} onSave={onSave} saving={saving} />
    )
  }
  if (prop.type === 'multi_select') {
    return (
      <MultiSelectCellEditor
        prop={prop}
        cell={cell}
        pageId={pageId}
        onSave={onSave}
        saving={saving}
      />
    )
  }
  return (
    <TextCellEditor
      prop={prop}
      cell={cell}
      rowIcon={rowIcon}
      pageId={pageId}
      onSave={onSave}
      saving={saving}
      autoEdit={startArmed}
      caretIndex={startArmed ? caretIndex : null}
    />
  )
}

export function RowInsertBar({ onAdd, edge }: { onAdd: () => void; edge: 'top' | 'bottom' }) {
  return (
    <button
      type="button"
      data-tt-db-insert
      className={cn(
        'group/insert absolute left-0 z-[6] h-3 w-5 cursor-pointer select-none',
        // Same reveal as the ⋮⋮ — row hover or gutter hover (cold + warm).
        'opacity-0 group-hover/row:opacity-100 group-hover/gutter:opacity-100',
        edge === 'top' ? 'top-0' : 'bottom-0'
      )}
      title="Add row"
      aria-label="Add row"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onAdd()
      }}
    >
      <span
        className={cn(
          'pointer-events-none absolute left-1/2 h-px w-3 -translate-x-1/2 rounded-full',
          'bg-[#e5e7eb] transition-colors group-hover/insert:bg-black/35',
          'dark:bg-gray-600 dark:group-hover/insert:bg-white/40',
          edge === 'top' ? 'top-0 -translate-y-1/2' : 'bottom-0 translate-y-1/2'
        )}
        aria-hidden
      />
    </button>
  )
}

/** Row ⋮⋮ — drag to board / open page menu. Exported so cold static rows can show it on hover
 *  without mounting editors (warm/hydrate). */
export const RowHandle = memo(function RowHandle({
  row,
  selected,
  onSelect,
  onDelete,
  onOpen,
  onDuplicate,
  onConvertLayout,
  dragPayload,
  onMenuOpenChange,
}: {
  row: NotionDbRow
  selected: boolean
  onSelect: () => void
  onDelete: () => void
  onOpen: () => void
  onDuplicate: () => void
  onConvertLayout?: (layout: DbConvertLayoutId, rowId: string) => void
  dragPayload: NotionRowDragPayload
  /** So parents that mount this only on hover can keep it while the portal menu is open. */
  onMenuOpenChange?: (open: boolean) => void
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const draggedRef = useRef(false)

  const closeMenu = useCallback(() => setMenu(null), [])

  useEffect(() => {
    onMenuOpenChange?.(!!menu)
  }, [menu, onMenuOpenChange])

  useEffect(() => {
    if (!menu) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('.block-actions-menu')) return
      if (btnRef.current?.contains(t)) return
      closeMenu()
    }
    document.addEventListener('mousedown', onDoc, true)
    return () => document.removeEventListener('mousedown', onDoc, true)
  }, [menu, closeMenu])

  const onAction = useCallback(
    (action: BlockActionId, payload?: BlockActionPayload) => {
      if (action === 'open') onOpen()
      else if (action === 'delete') onDelete()
      else if (action === 'duplicate') onDuplicate()
      else if (action === 'convertLayout' && payload?.convertLayout) {
        onConvertLayout?.(payload.convertLayout, row.id)
      } else if (action === 'copyLink') {
        const url = row.url || `https://www.notion.so/${String(row.id).replace(/-/g, '')}`
        void navigator.clipboard.writeText(url).catch(() => {})
      }
      closeMenu()
    },
    [onOpen, onDelete, onDuplicate, onConvertLayout, row.url, row.id, closeMenu]
  )

  const openMenuAt = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    setMenu({ x: r ? r.left : 0, y: r ? r.top + r.height / 2 : 0 })
  }, [])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        draggable
        className={cn(
          'tt-db-row-handle flex h-5 w-5 items-center justify-center rounded text-gray-400 cursor-grab active:cursor-grabbing',
          'opacity-0 group-hover/row:opacity-100 focus:opacity-100 hover:bg-black/5 hover:text-gray-800',
          'group-hover/gutter:opacity-100',
          selected && 'opacity-100 bg-blue-50 text-blue-600',
          menu && 'opacity-100 bg-blue-50 text-blue-600'
        )}
        title="Drag to board or open actions"
        aria-label="Row handle"
        onPointerDown={(e) => {
          e.stopPropagation()
          onSelect()
        }}
        onDragStart={(e) => {
          draggedRef.current = false
          onSelect()
          e.dataTransfer.setData(NOTION_ROW_DRAG_MIME, JSON.stringify(dragPayload))
          e.dataTransfer.effectAllowed = 'copy'
          e.dataTransfer.setData('text/plain', dragPayload.row.id)
          closeMenu()
        }}
        onDrag={() => {
          draggedRef.current = true
        }}
        onDragEnd={() => {
          window.setTimeout(() => {
            draggedRef.current = false
          }, 0)
        }}
        onClick={(e) => {
          e.stopPropagation()
          onSelect()
          if (draggedRef.current) return
          if (menu) {
            closeMenu()
            return
          }
          openMenuAt()
        }}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      {menu &&
        typeof document !== 'undefined' &&
        createPortal(
          <BlockActionsMenu
            x={menu.x}
            y={menu.y}
            zoom={1}
            positionMode="fixed"
            openLeft
            showOpen
            menuHeader="Page"
            showAddChild={false}
            convertLayoutMode={onConvertLayout ? 'table' : null}
            onAction={onAction}
            onClose={closeMenu}
          />,
          document.body
        )}
    </>
  )
})

type DbTableRowProps = {
  row: NotionDbRow
  depth: number
  insertBeforeAfterId: string | null
  columns: NotionDbProperty[]
  settings: DatabaseViewSettings
  selected: boolean
  savingKey: string | null
  vLines: boolean
  notionDatabaseId: string
  databaseTitle: string
  properties: NotionDbProperty[]
  conversationId: string | null | undefined
  childrenOf: Map<string, NotionDbRow[]>
  expandedParents: Set<string>
  onSelect: (id: string) => void
  onToggleExpand: (id: string) => void
  onSave: SaveFn
  onDelete: (id: string) => void
  onOpen: (row: NotionDbRow) => void
  onCreateRow: (afterId: string | null) => void
  onConvertLayout?: (layout: DbConvertLayoutId, rowId: string) => void
  rowBackground: string | undefined
  /**
   * Row owns editors + insert bars only while hydrated. Handle can still paint on hover without
   * hydrate (`showHandle`) so cold static rows get ⋮⋮ without mounting every cell editor.
   * Never mount handle+insert on all idle rows — 200× RowInsertBar was the old cost cliff.
   */
  hydrated: boolean
  /** Paint ⋮⋮ without editors (cold hover). Defaults to `hydrated`. */
  showHandle?: boolean
  onHover: (id: string | null) => void
  onActivate: (id: string) => void
  /** On-screen column band; columns outside it collapse into one spanned spacer cell per side. */
  colRange: ColumnRange
  /** Column to auto-arm after static → live row engage (that row only). */
  armColumnIndex?: number | null
  /** Caret offset from the cold-cell click. */
  armCaretIndex?: number | null
}

export const DbTableRow = memo(function DbTableRow({
  row,
  depth,
  insertBeforeAfterId,
  columns,
  settings,
  selected,
  savingKey,
  vLines,
  notionDatabaseId,
  databaseTitle,
  properties,
  conversationId,
  childrenOf,
  expandedParents,
  onSelect,
  onToggleExpand,
  onSave,
  onDelete,
  onOpen,
  onCreateRow,
  onConvertLayout,
  rowBackground,
  hydrated,
  showHandle,
  onHover,
  onActivate,
  colRange,
  armColumnIndex = null,
  armCaretIndex = null,
}: DbTableRowProps) {
  // `tableLayout: 'fixed'` means the header row alone decides column widths, so a spanned spacer here
  // cannot shift alignment — the skipped columns keep their exact geometry with one element instead of
  // one per column.
  const colStart = colRange ? Math.max(0, colRange.start) : 0
  const colEnd = colRange ? Math.min(columns.length - 1, colRange.end) : columns.length - 1
  // Handle + insert bars without editors: hover/selected cold rows. Editors stay hydrate-only.
  const paintHandle = showHandle ?? hydrated
  return (
    <tr
      className={cn(
        'group/row relative hover:bg-[#fafafa]',
        selected && 'bg-blue-50/50 ring-1 ring-inset ring-blue-200',
        // Static preview host is pointer-events-none; warm row must receive the caret + edits.
        armColumnIndex != null && 'nodrag nopan pointer-events-auto'
      )}
      style={{ background: selected ? undefined : rowBackground }}
      onClick={() => onSelect(row.id)}
      onPointerEnter={() => onHover(row.id)}
      onPointerLeave={() => onHover(null)}
      // Capture phase: `EditableCell` stops propagation on pointerdown/click, so a bubbling
      // handler here would never see a cell press and the edited row could unhydrate under the caret.
      onPointerDownCapture={() => onActivate(row.id)}
    >
      {colStart > 0 ? (
        <td colSpan={colStart} style={{ padding: 0, border: 'none' }} aria-hidden />
      ) : null}
      {columns.slice(colStart, colEnd + 1).map((prop, i) => {
        const colIndex = colStart + i
        const startArmed = hydrated && armColumnIndex === colIndex
        const colW = columnWidthPx(prop, settings)
        return (
          <td
            key={prop.id}
            style={{ width: colW, maxWidth: colW, minWidth: 0 }}
            className={cn(
              'relative px-2 py-1 align-middle min-w-0 text-[13px]',
              colIndex === 0 ? 'overflow-visible' : 'overflow-hidden',
              vLines && colIndex < columns.length - 1 && 'border-r border-gray-200',
              selected && 'bg-blue-50/40',
              !settings.layoutOptions.wrapAllContent && 'tt-db-cell-nowrap whitespace-nowrap'
            )}
          >
            {colIndex === 0 && paintHandle ? (
              <div
                data-tt-db-gutter
                className="group/gutter absolute -left-5 top-0 bottom-0 z-[2] w-5"
              >
                <div className="absolute left-0 top-1/2 -translate-y-1/2">
                  <RowHandle
                    row={row}
                    selected={selected}
                    onSelect={() => onSelect(row.id)}
                    onDelete={() => onDelete(row.id)}
                    onOpen={() => onOpen(row)}
                    onDuplicate={() => onCreateRow(row.id)}
                    onConvertLayout={conversationId ? onConvertLayout : undefined}
                    dragPayload={{
                      source: 'notion-db-row',
                      notionDatabaseId,
                      row,
                      properties,
                      databaseTitle,
                    }}
                  />
                </div>
                {paintHandle ? (
                  <>
                    <RowInsertBar edge="top" onAdd={() => onCreateRow(insertBeforeAfterId)} />
                    <RowInsertBar edge="bottom" onAdd={() => onCreateRow(row.id)} />
                  </>
                ) : null}
              </div>
            ) : null}
            <div
              className={cn(
                'min-w-0 max-w-full overflow-hidden',
                !settings.layoutOptions.wrapAllContent && 'tt-db-cell-nowrap whitespace-nowrap'
              )}
            >
              {prop.type === 'title' &&
              settings.subTasks.enabled &&
              settings.subTasks.display === 'nested' ? (
                <div
                  className="flex items-center gap-0.5 min-w-0 max-w-full overflow-hidden"
                  style={depth ? { paddingLeft: depth * 16 } : undefined}
                >
                  {(() => {
                    const kids = childrenOf.get(row.id) || []
                    if (!kids.length) {
                      return <span className="inline-block w-3.5 shrink-0" aria-hidden />
                    }
                    const open = expandedParents.has(row.id)
                    return (
                      <button
                        type="button"
                        className="shrink-0 -ml-0.5 p-0.5 rounded text-gray-400 hover:bg-black/5 hover:text-gray-600"
                        title={open ? 'Collapse' : 'Expand'}
                        aria-expanded={open}
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleExpand(row.id)
                        }}
                      >
                        {open ? (
                          <ChevronDown className="h-3 w-3" strokeWidth={2.5} />
                        ) : (
                          <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
                        )}
                      </button>
                    )
                  })()}
                  <div className="min-w-0 flex-1">
                    {hydrated ? (
                      <EditableCell
                        prop={prop}
                        cell={row.cells[prop.name]}
                        rowIcon={settings.layoutOptions.showPageIcon ? row.icon : null}
                        pageId={row.id}
                        onSave={onSave}
                        saving={savingKey === `${row.id}:${prop.name}`}
                        startArmed={startArmed}
                        caretIndex={startArmed ? armCaretIndex : null}
                      />
                    ) : (
                      <StaticCell
                        prop={prop}
                        cell={row.cells[prop.name]}
                        rowIcon={settings.layoutOptions.showPageIcon ? row.icon : null}
                      />
                    )}
                  </div>
                </div>
              ) : hydrated ? (
                <EditableCell
                  prop={prop}
                  cell={row.cells[prop.name]}
                  rowIcon={
                    prop.type === 'title' && settings.layoutOptions.showPageIcon ? row.icon : null
                  }
                  pageId={row.id}
                  onSave={onSave}
                  saving={savingKey === `${row.id}:${prop.name}`}
                  startArmed={startArmed}
                  caretIndex={startArmed ? armCaretIndex : null}
                />
              ) : (
                <StaticCell
                  prop={prop}
                  cell={row.cells[prop.name]}
                  rowIcon={
                    prop.type === 'title' && settings.layoutOptions.showPageIcon ? row.icon : null
                  }
                />
              )}
            </div>
          </td>
        )
      })}
      {colEnd < columns.length - 1 ? (
        <td colSpan={columns.length - 1 - colEnd} style={{ padding: 0, border: 'none' }} aria-hidden />
      ) : null}
    </tr>
  )
})

type VirtualizedTableBodyProps = {
  flatItems: FlatTableItem[]
  columns: NotionDbProperty[]
  settings: DatabaseViewSettings
  tablePixelWidth: number
  vLines: boolean
  selectedRowId: string | null
  savingKey: string | null
  notionDatabaseId: string
  databaseTitle: string
  properties: NotionDbProperty[]
  conversationId: string | null | undefined
  childrenOf: Map<string, NotionDbRow[]>
  expandedParents: Set<string>
  onSelect: (id: string) => void
  onToggleExpand: (id: string) => void
  onSave: SaveFn
  onDelete: (id: string) => void
  onOpen: (row: NotionDbRow) => void
  onCreateRow: (afterId: string | null) => void
  onConvertLayout?: (layout: DbConvertLayoutId, rowId: string) => void
  rowBackgroundFn: (row: NotionDbRow) => string | undefined
  scrollParentRef: React.RefObject<HTMLDivElement | null>
  /** When false, render every row (selected hug / show-all). Virtualize only inside a clip scroller. */
  virtualize?: boolean
  /** On-screen column band from `useVisibleColumnRange`. */
  colRange: ColumnRange
  /** Seed hydration from a static-preview row click. */
  initialActiveRowId?: string | null
  /** Column clicked on static preview — auto I-bar that cell on first live paint. */
  initialArmColumnIndex?: number | null
}

export function VirtualizedTableBody({
  flatItems,
  columns,
  settings,
  tablePixelWidth,
  vLines,
  selectedRowId,
  savingKey,
  notionDatabaseId,
  databaseTitle,
  properties,
  conversationId,
  childrenOf,
  expandedParents,
  onSelect,
  onToggleExpand,
  onSave,
  onDelete,
  onOpen,
  onCreateRow,
  onConvertLayout,
  rowBackgroundFn,
  scrollParentRef,
  virtualize = true,
  colRange,
  initialActiveRowId = null,
  initialArmColumnIndex = null,
}: VirtualizedTableBodyProps) {
  const rowCount = flatItems.length
  const useCap = virtualize && rowCount > DB_TABLE_VIRTUALIZE_MIN
  // Exactly one row owns editors + gutter chrome. Hover drives it; the last pressed row keeps it so
  // an open editor cannot be unmounted from under the caret when the pointer wanders off.
  const [hoverRowId, setHoverRowId] = useState<string | null>(null)
  const [activeRowId, setActiveRowId] = useState<string | null>(initialActiveRowId)
  useEffect(() => {
    // Static → live handoff: keep the clicked row hydrated on first paint.
    if (initialActiveRowId) setActiveRowId(initialActiveRowId)
  }, [initialActiveRowId])
  const hydratedRowId = hoverRowId ?? activeRowId
  // If the engaged column is read-only, arm the first editable visible column instead.
  const armColumnIndex = useMemo(() => {
    if (initialArmColumnIndex == null || !initialActiveRowId) return null
    const prop = columns[initialArmColumnIndex]
    if (prop && isNotionPropertyEditable(prop.type)) return initialArmColumnIndex
    const start = colRange?.start ?? 0
    const end = colRange?.end ?? columns.length - 1
    for (let i = start; i <= end; i++) {
      if (isNotionPropertyEditable(columns[i]?.type)) return i
    }
    return initialArmColumnIndex
  }, [initialArmColumnIndex, initialActiveRowId, columns, colRange])
  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: (i) =>
      flatItems[i]?.kind === 'group' ? DB_TABLE_ROW_HEIGHT + 4 : DB_TABLE_ROW_HEIGHT,
    overscan: 4, // Smaller window = fewer React cell trees on Chromium
    // Skip scroll-only React work (padding-row layout — no containerRef / absolute items)
    directDomUpdates: true,
    useFlushSync: false,
    enabled: useCap,
  })
  useEffect(() => {
    const el = scrollParentRef.current
    if (!el || !useCap) return
    const ro = new ResizeObserver(() => virtualizer.measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollParentRef, useCap, virtualizer])
  const virtualRows = virtualizer.getVirtualItems()
  const paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start ?? 0 : 0
  const paddingBottom =
    virtualRows.length > 0
      ? virtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0

  const colSpan = Math.max(1, columns.length)

  if (!rowCount) {
    return (
      <tbody>
        <tr>
          <td
            colSpan={colSpan}
            className="relative overflow-visible px-2 py-2 text-sm text-gray-400"
          >
            <div className="absolute -left-5 top-1/2 -translate-y-1/2">
              <button
                type="button"
                className="flex h-5 w-5 items-center justify-center rounded text-blue-500 hover:bg-blue-50"
                title="Add row"
                onClick={() => onCreateRow(null)}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            No rows — click + to add
          </td>
        </tr>
      </tbody>
    )
  }

  const renderItem = (index: number) => {
    const item = flatItems[index]
    if (!item) return null
    if (item.kind === 'group') {
      return (
        <tr key={`g:${item.key}`}>
          <td
            colSpan={colSpan}
            className="px-2 py-1 text-[12px] font-semibold text-gray-600 border-b border-gray-200"
          >
            {item.label}
            <span className="ml-2 font-normal text-gray-400">{item.count}</span>
          </td>
        </tr>
      )
    }
    return (
      <DbTableRow
        key={item.row.id}
        row={item.row}
        depth={item.depth}
        insertBeforeAfterId={item.insertBeforeAfterId}
        columns={columns}
        settings={settings}
        selected={selectedRowId === item.row.id}
        savingKey={savingKey}
        vLines={vLines}
        notionDatabaseId={notionDatabaseId}
        databaseTitle={databaseTitle}
        properties={properties}
        conversationId={conversationId}
        childrenOf={childrenOf}
        expandedParents={expandedParents}
        onSelect={onSelect}
        onToggleExpand={onToggleExpand}
        onSave={onSave}
        onDelete={onDelete}
        onOpen={onOpen}
        onCreateRow={onCreateRow}
        onConvertLayout={onConvertLayout}
        rowBackground={rowBackgroundFn(item.row)}
        hydrated={hydratedRowId === item.row.id || selectedRowId === item.row.id}
        onHover={setHoverRowId}
        onActivate={setActiveRowId}
        colRange={colRange}
        armColumnIndex={
          item.row.id === initialActiveRowId ? armColumnIndex : null
        }
      />
    )
  }

  if (useCap) {
    return (
      <tbody>
        {paddingTop > 0 ? (
          <tr aria-hidden>
            <td colSpan={colSpan} style={{ height: paddingTop, padding: 0, border: 'none' }} />
          </tr>
        ) : null}
        {virtualRows.map((vi) => renderItem(vi.index))}
        {paddingBottom > 0 ? (
          <tr aria-hidden>
            <td colSpan={colSpan} style={{ height: paddingBottom, padding: 0, border: 'none' }} />
          </tr>
        ) : null}
      </tbody>
    )
  }

  // Expanded (hug) table: the frame is as tall as the whole table, so there is no inner scroller for
  // `useVirtualizer` to window against — and adding one is wrong, because inner scroll fights the
  // board's own pan/zoom. Window against the *browser viewport* instead: rows live in chunks that
  // mount only while on screen and hold a measured spacer when not. IntersectionObserver does this
  // with zero per-frame JS and stays correct under the board's transform (pan, zoom, rotate).
  return (
    <ChunkedRowGroups
      count={flatItems.length}
      colSpan={colSpan}
      renderRange={(start, end) => {
        const out: React.ReactNode[] = []
        for (let i = start; i < end; i++) out.push(renderItem(i))
        return out
      }}
    />
  )
}

/**
 * Splits `count` rows into viewport-windowed `<tbody>` chunks. Shared by the live table and the
 * static preview so "always expanded" costs the same as "expand when selected".
 */
export function ChunkedRowGroups({
  count,
  colSpan,
  renderRange,
}: {
  count: number
  colSpan: number
  /** Rows for `[start, end)` — called only while that chunk is on screen. */
  renderRange: (start: number, end: number) => React.ReactNode
}) {
  // Real average row height, learned from the first chunk that mounts, so collapsed spacers reserve
  // the height their rows would actually take.
  const [measuredRowH, setMeasuredRowHState] = useState<number | null>(null)
  const setMeasuredRowH = useCallback((h: number) => {
    if (!(h > 8) || h > 400) return // Ignore nonsense (collapsed/hidden measurement)
    setMeasuredRowHState((prev) => (prev != null && Math.abs(prev - h) < 1 ? prev : h))
  }, [])
  const chunks = useMemo(() => {
    const out: Array<{ start: number; end: number }> = []
    for (let start = 0; start < count; start += ROW_CHUNK) {
      out.push({ start, end: Math.min(start + ROW_CHUNK, count) })
    }
    return out
  }, [count])

  return (
    <>
      {chunks.map((chunk, ci) => {
        const rows = chunk.end - chunk.start
        return (
          <RowChunk
            key={chunk.start}
            colSpan={colSpan}
            eager={ci < 2} // Top of the table paints on first commit — no blank flash before IO fires
            estimateHeight={rows * (measuredRowH ?? DB_TABLE_ROW_HEIGHT)}
            rowCount={rows}
            onMeasureRowHeight={setMeasuredRowH}
            render={() => renderRange(chunk.start, chunk.end)}
          />
        )
      })}
    </>
  )
}

/**
 * One `<tbody>` of rows that mounts only while it intersects the viewport, and collapses to a
 * single spacer row of its last measured height when it does not. Multiple `<tbody>` per `<table>`
 * is valid HTML, and keeping the spacer in the same table means column widths never shift.
 */
function RowChunk({
  colSpan,
  eager,
  estimateHeight,
  rowCount,
  onMeasureRowHeight,
  render,
}: {
  colSpan: number
  eager: boolean
  estimateHeight: number
  rowCount: number
  onMeasureRowHeight: (h: number) => void
  render: () => React.ReactNode
}) {
  const ref = useRef<HTMLTableSectionElement | null>(null)
  const [visible, setVisible] = useState(eager)
  // Own measurement once this chunk has been on screen; until then follow the shared estimate, which
  // improves as soon as any sibling measures. A ref seeded from `estimateHeight` would freeze the
  // initial guess and never pick that up.
  const measuredRef = useRef<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true) // No IO (SSR / old browser) — correctness beats the optimization
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setVisible(entry.isIntersecting)
      },
      // Generous band: a chunk should already be mounted by the time it scrolls/pans into view.
      { rootMargin: '600px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    const el = ref.current
    if (!el) return
    const measure = () => {
      // offsetHeight is layout px, so the board's zoom transform does not skew it.
      const h = el.offsetHeight
      if (!h) return
      measuredRef.current = h
      // Teach every *other* chunk the real row height. Rows measure ~37px against a 32px constant, so
      // unvisited spacers were 13% short and the hugged frame grew as you panned down the table.
      if (rowCount > 0) onMeasureRowHeight(h / rowCount)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    // A one-shot measure on mount reads 0 — the frame stages its content in, so the rows have no
    // layout height yet on the first commit. Observing catches the real height whenever it lands.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [visible, rowCount, onMeasureRowHeight])

  return (
    <tbody ref={ref}>
      {visible ? (
        render()
      ) : (
        <tr aria-hidden>
          <td
            colSpan={colSpan}
            style={{ height: measuredRef.current ?? estimateHeight, padding: 0, border: 'none' }}
          />
        </tr>
      )}
    </tbody>
  )
}

export function VirtualizedListBody({
  rows,
  titleProp,
  columns,
  settings,
  rowBackgroundFn,
  scrollParentRef,
  virtualize = true,
}: {
  rows: NotionDbRow[]
  titleProp?: NotionDbProperty
  columns: NotionDbProperty[]
  settings: DatabaseViewSettings
  rowBackgroundFn: (row: NotionDbRow) => string | undefined
  scrollParentRef: React.RefObject<HTMLDivElement | null>
  virtualize?: boolean
}) {
  const useCap = virtualize && rows.length > DB_TABLE_VIRTUALIZE_MIN
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => DB_TABLE_ROW_HEIGHT + 8,
    overscan: 4,
    directDomUpdates: true,
    useFlushSync: false,
    enabled: useCap,
  })
  useEffect(() => {
    const el = scrollParentRef.current
    if (!el || !useCap) return
    const ro = new ResizeObserver(() => virtualizer.measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollParentRef, useCap, virtualizer])
  const virtualRows = virtualizer.getVirtualItems()
  const paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start ?? 0 : 0
  const paddingBottom =
    virtualRows.length > 0
      ? virtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0

  if (!rows.length) {
    return <div className="px-3 py-3 text-sm text-gray-400">No rows</div>
  }

  const renderRow = (row: NotionDbRow) => {
    const title = titleProp ? row.cells[titleProp.name]?.text || 'Untitled' : 'Untitled'
    return (
      <div
        key={row.id}
        className="flex items-center gap-2 px-3 py-2 hover:bg-[#fafafa] min-w-0 overflow-hidden"
        style={{ background: rowBackgroundFn(row) }}
      >
        {settings.layoutOptions.showPageIcon && row.icon ? (
          <span className="leading-none shrink-0">{row.icon}</span>
        ) : null}
        <span className="text-[13px] font-medium truncate min-w-0 flex-1 overflow-hidden">
          {title}
        </span>
        {columns
          .filter((c) => c.type !== 'title')
          .slice(0, 3)
          .map((prop) => (
            <span
              key={prop.id}
              className="text-[12px] text-gray-500 max-w-[120px] truncate shrink-0 overflow-hidden"
            >
              <CellDisplay prop={prop} cell={row.cells[prop.name]} />
            </span>
          ))}
      </div>
    )
  }

  if (!useCap) {
    return <div className="divide-y divide-gray-100 min-w-0 max-w-full overflow-hidden">{rows.map(renderRow)}</div>
  }

  return (
    <div className="relative divide-y divide-gray-100 min-w-0 max-w-full" style={{ height: virtualizer.getTotalSize() }}>
      {paddingTop > 0 ? <div style={{ height: paddingTop }} aria-hidden /> : null}
      {virtualRows.map((vi) => {
        const row = rows[vi.index]
        if (!row) return null
        return (
          <div
            key={row.id}
            className="absolute left-0 right-0"
            style={{ transform: `translateY(${vi.start}px)` }}
          >
            {renderRow(row)}
          </div>
        )
      })}
    </div>
  )
}

export function buildFlatTableItems(
  groups: Array<{ key: string; rows: NotionDbRow[] }>,
  settings: DatabaseViewSettings,
  subTaskTree: { roots: NotionDbRow[]; childrenOf: Map<string, NotionDbRow[]> },
  groupBy: string | null,
  expandedParents: Set<string>
): FlatTableItem[] {
  const out: FlatTableItem[] = []
  for (const g of groups) {
    if (groupBy && g.key) {
      out.push({
        kind: 'group',
        key: g.key,
        label: g.key,
        count: g.rows.length,
      })
    }
    const rows = g.rows
    const { roots, childrenOf } = settings.subTasks.enabled
      ? subTaskTree
      : { roots: rows, childrenOf: new Map<string, NotionDbRow[]>() }
    const flat: Array<{ row: NotionDbRow; depth: number }> = []
    if (settings.subTasks.enabled && settings.subTasks.display === 'flat') {
      for (const row of rows) flat.push({ row, depth: 0 })
    } else {
      const walk = (row: NotionDbRow, depth: number) => {
        flat.push({ row, depth })
        if (
          settings.subTasks.enabled &&
          settings.subTasks.display === 'nested' &&
          expandedParents.has(row.id)
        ) {
          for (const child of childrenOf.get(row.id) || []) walk(child, depth + 1)
        }
      }
      for (const row of settings.subTasks.enabled ? roots : rows) walk(row, 0)
    }
    for (let i = 0; i < flat.length; i++) {
      const insertBeforeAfterId = i === 0 ? null : flat[i - 1].row.id
      out.push({
        kind: 'row',
        row: flat[i].row,
        depth: flat[i].depth,
        insertBeforeAfterId,
      })
    }
  }
  return out
}
