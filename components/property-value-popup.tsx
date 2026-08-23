'use client'

// Type-specific property editor popup (date calendar, checkbox, text, …).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { propertyTypeLabel, type PropertyTypeId } from '@/lib/blocks/property'

export type PropertyEditorAnchor = {
  left: number
  top: number
  width: number
  height: number
}

type PropertyValuePopupProps = {
  open: boolean
  anchor: PropertyEditorAnchor | null
  type: PropertyTypeId
  name: string
  value: string
  onCommit: (value: string) => void
  onClose: () => void
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const

function parseDateValue(raw: string): Date | null {
  const t = raw.trim()
  if (!t) return null
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatDateLabel(d: Date, includeTime: boolean): string {
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  if (!includeTime) return date
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${date} | ${time}`
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function DatePropertyEditor({
  value,
  onCommit,
  onClose,
}: {
  value: string
  onCommit: (value: string) => void
  onClose: () => void
}) {
  const initial = parseDateValue(value) ?? new Date()
  const [view, setView] = useState(() => new Date(initial.getFullYear(), initial.getMonth(), 1))
  const [selected, setSelected] = useState<Date | null>(parseDateValue(value))
  const [includeTime, setIncludeTime] = useState(() => /T|\d:\d{2}/.test(value))

  const days = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1)
    const start = new Date(first)
    start.setDate(start.getDate() - start.getDay())
    const cells: Date[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      cells.push(d)
    }
    return cells
  }, [view])

  const commitDate = useCallback(
    (d: Date | null) => {
      if (!d) {
        onCommit('')
        onClose()
        return
      }
      if (includeTime) {
        const withTime = new Date(d)
        const prev = parseDateValue(value)
        if (prev) {
          withTime.setHours(prev.getHours(), prev.getMinutes(), 0, 0)
        } else {
          withTime.setHours(21, 0, 0, 0)
        }
        onCommit(withTime.toISOString())
      } else {
        onCommit(toIsoDate(d))
      }
      onClose()
    },
    [includeTime, onClose, onCommit, value]
  )

  return (
    <div className="flex w-[280px] flex-col gap-2 p-2">
      <div className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-[13px] text-gray-800 dark:border-[#2f2f2f] dark:bg-[#1a1a1a] dark:text-gray-100">
        {selected ? formatDateLabel(selected, includeTime) : 'Empty'}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-gray-800 dark:text-gray-100">
          {view.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className="rounded p-1 hover:bg-gray-100 dark:hover:bg-[#2a2a2a]"
            onClick={() => commitDate(new Date())}
          >
            Now
          </button>
          <button
            type="button"
            className="rounded p-1 hover:bg-gray-100 dark:hover:bg-[#2a2a2a]"
            aria-label="Previous month"
            onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() - 1, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded p-1 hover:bg-gray-100 dark:hover:bg-[#2a2a2a]"
            aria-label="Next month"
            onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() + 1, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] text-gray-500">
        {WEEKDAYS.map((d) => (
          <span key={d} className="py-0.5">
            {d}
          </span>
        ))}
        {days.map((d) => {
          const inMonth = d.getMonth() === view.getMonth()
          const isSel =
            selected &&
            d.getFullYear() === selected.getFullYear() &&
            d.getMonth() === selected.getMonth() &&
            d.getDate() === selected.getDate()
          const isToday =
            d.toDateString() === new Date().toDateString()
          return (
            <button
              key={d.toISOString()}
              type="button"
              className={cn(
                'h-7 w-7 rounded-full text-[12px]',
                !inMonth && 'text-gray-300 dark:text-gray-600',
                inMonth && 'text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#2a2a2a]',
                isSel && 'bg-blue-600 text-white hover:bg-blue-600',
                isToday && !isSel && 'ring-1 ring-blue-400'
              )}
              onClick={() => {
                setSelected(d)
                commitDate(d)
              }}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
      <label className="flex items-center justify-between gap-2 text-[12px] text-gray-600 dark:text-gray-300">
        <span>Include time</span>
        <input
          type="checkbox"
          checked={includeTime}
          onChange={(e) => setIncludeTime(e.target.checked)}
        />
      </label>
      <button
        type="button"
        className="self-start text-[12px] text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
        onClick={() => commitDate(null)}
      >
        Clear
      </button>
    </div>
  )
}

function TextPropertyEditor({
  type,
  value,
  onCommit,
  onClose,
}: {
  type: PropertyTypeId
  value: string
  onCommit: (value: string) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  const inputType =
    type === 'number'
      ? 'number'
      : type === 'email'
        ? 'email'
        : type === 'url'
          ? 'url'
          : type === 'phone'
            ? 'tel'
            : 'text'
  return (
    <div className="flex w-[240px] flex-col gap-2 p-2">
      <input
        ref={inputRef}
        type={inputType}
        className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[13px] outline-none focus:border-blue-400 dark:border-[#2f2f2f] dark:bg-[#1a1a1a] dark:text-gray-100"
        value={draft}
        placeholder="Empty"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            onCommit(draft)
            onClose()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <div className="flex justify-end gap-2">
        <button type="button" className="text-[12px] text-gray-500" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="rounded bg-blue-600 px-2 py-0.5 text-[12px] text-white"
          onClick={() => {
            onCommit(draft)
            onClose()
          }}
        >
          Done
        </button>
      </div>
    </div>
  )
}

function CheckboxPropertyEditor({
  value,
  onCommit,
  onClose,
}: {
  value: string
  onCommit: (value: string) => void
  onClose: () => void
}) {
  const checked = value === 'true'
  return (
    <div className="flex w-[200px] items-center justify-between gap-2 p-3">
      <span className="text-[13px] text-gray-800 dark:text-gray-100">Checked</span>
      <input
        type="checkbox"
        checked={checked}
        autoFocus
        onChange={(e) => {
          onCommit(e.target.checked ? 'true' : 'false')
          onClose()
        }}
      />
    </div>
  )
}

export function PropertyValuePopup({
  open,
  anchor,
  type,
  name,
  value,
  onCommit,
  onClose,
}: PropertyValuePopupProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  const place = useCallback(() => {
    if (!anchor) return
    const w = panelRef.current?.offsetWidth ?? 280
    const h = panelRef.current?.offsetHeight ?? 320
    let left = anchor.left
    let top = anchor.top + anchor.height + 6
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8
    if (left < 8) left = 8
    if (top + h > window.innerHeight - 8) top = Math.max(8, anchor.top - h - 6)
    setPos({ left, top })
  }, [anchor])

  useEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    place()
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (panelRef.current?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDoc, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('mousedown', onDoc, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, onClose, place])

  if (!open || !anchor || typeof document === 'undefined') return null

  const title = name.trim() || propertyTypeLabel(type)

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Edit ${title}`}
      className={cn(
        'fixed z-[110] rounded-lg border border-gray-200 bg-white shadow-xl',
        'dark:border-[#2f2f2f] dark:bg-[#1f1f1f]'
      )}
      style={pos ? { left: pos.left, top: pos.top } : { left: anchor.left, top: anchor.top + anchor.height + 6, visibility: 'hidden' }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="border-b border-gray-100 px-3 py-2 text-[12px] font-medium text-gray-700 dark:border-[#2a2a2a] dark:text-gray-200">
        {title}
      </div>
      {type === 'date' || type === 'createdTime' || type === 'lastEditedTime' ? (
        <DatePropertyEditor value={value} onCommit={onCommit} onClose={onClose} />
      ) : type === 'checkbox' ? (
        <CheckboxPropertyEditor value={value} onCommit={onCommit} onClose={onClose} />
      ) : (
        <TextPropertyEditor type={type} value={value} onCommit={onCommit} onClose={onClose} />
      )}
    </div>,
    document.body
  )
}
