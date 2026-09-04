'use client'

// Top-bar Filter / Sort — Notion-style criteria strip under the toolbar (above the mode pill).
// Scope: no selection → board-global; frame(s) selected → per-frame (property pickers later).

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  ArrowUpDown, // Sorts pill / toolbar Sort
  ChevronDown, // Pill dropdown chevron
  ListFilter, // Toolbar Filter + filter pills
  Plus, // + Filter
} from 'lucide-react'
import { Button } from '@/components/ui/button' // Ghost toolbar triggers
import { useReactFlowContext } from './react-flow-context' // Selection outside RF provider
import { ToolbarTitle } from './toolbar-title' // Animated icon-adjacent titles
import { newId, type DatabaseFilter, type DatabaseSort } from '@/lib/notion/database-view'
import {
  getBoardFilterSortUi,
  subscribeBoardFilterSortUi,
  toggleBoardFilterSort,
  type BoardFilterSortFocus,
} from '@/lib/board-filter-sort-ui'
import { cn } from '@/lib/utils'

export type { BoardFilterSortFocus }
export type FilterSortScope = 'board' | 'frame'

type BoardFilterSortTriggersProps = {
  showFilterLabel?: boolean
  showSortLabel?: boolean
  filterTriggerVisible?: boolean
  sortTriggerVisible?: boolean
}

/** Count selected frames (isBlock) — toolbar sits outside ReactFlowProvider. */
function useSelectedFrameCount(): number {
  const { reactFlowInstance } = useReactFlowContext()
  const [count, setCount] = useState(0)

  useEffect(() => {
    const refresh = () => {
      if (!reactFlowInstance) {
        setCount(0)
        return
      }
      const n = reactFlowInstance.getNodes().filter((node) => {
        if (!node.selected) return false
        const meta = (node.data?.promptMessage?.metadata || {}) as Record<string, unknown>
        return meta.isBlock === true
      }).length
      setCount(n)
    }
    refresh()
    window.addEventListener('node-selected', refresh)
    window.addEventListener('tt-selection-changed', refresh)
    return () => {
      window.removeEventListener('node-selected', refresh)
      window.removeEventListener('tt-selection-changed', refresh)
    }
  }, [reactFlowInstance])

  return count
}

function useFilterSortUi() {
  return useSyncExternalStore(subscribeBoardFilterSortUi, getBoardFilterSortUi, getBoardFilterSortUi)
}

/** Format one filter as Notion-like "Prop: Value" chip label (stub until property menus). */
function filterChipLabel(f: DatabaseFilter): string {
  const op =
    f.operator === 'contains'
      ? 'Contains'
      : f.operator === 'does_not_contain'
        ? 'Does not contain'
        : f.operator === 'is'
          ? ''
          : f.operator === 'is_not'
            ? '≠'
            : f.operator === 'is_empty'
              ? 'Is empty'
              : f.operator === 'is_not_empty'
                ? 'Is not empty'
                : f.operator === 'gt'
                  ? '>'
                  : f.operator === 'lt'
                    ? '<'
                    : f.operator
  if (f.operator === 'is_empty' || f.operator === 'is_not_empty') {
    return `${f.property}: ${op}`
  }
  const mid = op ? ` ${op} ` : ': '
  return `${f.property}${mid}${f.value || '…'}`
}

/** Blue Notion-style criteria pill. */
function CriteriaPill({
  icon,
  label,
  onClick,
  title,
  rounded = 'md',
}: {
  icon: ReactNode
  label: string
  onClick?: () => void
  title?: string
  rounded?: 'md' | 'full' // Sort uses full pill; filter chips stay md
}) {
  return (
    <button
      type="button"
      title={title || label}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 max-w-[220px] items-center gap-1 px-2 text-[13px]',
        rounded === 'full' ? 'rounded-full' : 'rounded-md',
        'bg-[#e7f3f8] text-[#0b6e99] hover:bg-[#d3edf6]',
        'dark:bg-[#1a3a4a] dark:text-[#6ec3e0] dark:hover:bg-[#214a5e]'
      )}
    >
      <span className="flex-shrink-0 opacity-80">{icon}</span>
      <span className="truncate font-medium">{label}</span>
      <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 opacity-70" />
    </button>
  )
}

/**
 * Actions-bar Filter + Sort buttons — toggle the under-toolbar criteria strip (not a dropdown).
 */
export function BoardFilterSortTriggers({
  showFilterLabel = true,
  showSortLabel = true,
  filterTriggerVisible = true,
  sortTriggerVisible = true,
}: BoardFilterSortTriggersProps) {
  const { openFilter, openSort } = useFilterSortUi()

  const triggerClass = (pressed: boolean, showLabel: boolean) =>
    cn(
      'h-7 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] flex-shrink-0 flex items-center',
      'transition-[padding,gap] duration-200 ease-out',
      showLabel ? 'px-2 gap-1.5' : 'px-1.5 gap-0',
      pressed && 'bg-gray-100 dark:bg-[#1f1f1f] text-gray-900 dark:text-gray-100'
    )

  if (!filterTriggerVisible && !sortTriggerVisible) return null

  return (
    <div className="flex items-center gap-0.5 flex-shrink-0">
      {filterTriggerVisible ? (
        <Button
          variant="ghost"
          size="sm"
          className={triggerClass(openFilter, showFilterLabel)}
          title="Filter"
          aria-label="Filter"
          aria-pressed={openFilter}
          onClick={() => toggleBoardFilterSort('filter')}
        >
          <ListFilter className="h-4 w-4 flex-shrink-0" />
          <ToolbarTitle show={showFilterLabel}>Filter</ToolbarTitle>
        </Button>
      ) : null}
      {sortTriggerVisible ? (
        <Button
          variant="ghost"
          size="sm"
          className={triggerClass(openSort, showSortLabel)}
          title="Sort"
          aria-label="Sort"
          aria-pressed={openSort}
          onClick={() => toggleBoardFilterSort('sort')}
        >
          <ArrowUpDown className="h-4 w-4 flex-shrink-0" />
          <ToolbarTitle show={showSortLabel}>Sort</ToolbarTitle>
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Criteria strip under the Actions/Layout/Draw/View mode pill (no divider).
 * Always left-aligns to the mode select button (`[data-edit-menu-select]`) and wraps —
 * selected desktop chip or phone mode dropdown trigger.
 */
export function BoardFilterSortBar() {
  const { open, openFilter, openSort, focus } = useFilterSortUi()
  const { editMenuPillMode } = useReactFlowContext() // Re-measure when the selected mode chip moves
  const selectedCount = useSelectedFrameCount()
  const scope: FilterSortScope = selectedCount === 0 ? 'board' : 'frame'
  const barRef = useRef<HTMLDivElement>(null) // Full-width strip for relative left
  const chipsRef = useRef<HTMLDivElement>(null) // Natural width measure target
  const [place, setPlace] = useState<{ left: number; width: number; wrap: boolean } | null>(null)

  const [boardFilters, setBoardFilters] = useState<DatabaseFilter[]>([])
  const [boardSorts, setBoardSorts] = useState<DatabaseSort[]>([])
  const [frameFilters, setFrameFilters] = useState<DatabaseFilter[]>([])
  const [frameSorts, setFrameSorts] = useState<DatabaseSort[]>([])

  const filters = scope === 'board' ? boardFilters : frameFilters
  const sorts = scope === 'board' ? boardSorts : frameSorts
  const setFilters = scope === 'board' ? setBoardFilters : setFrameFilters
  const setSorts = scope === 'board' ? setBoardSorts : setFrameSorts

  // Always flush left with the mode select button (selected chip or phone dropdown)
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null)
      return
    }

    const sync = () => {
      const pill = document.querySelector('[data-edit-menu-pill]') as HTMLElement | null
      const bar = barRef.current
      const chips = chipsRef.current
      if (!pill || !bar || !chips) return

      const barR = bar.getBoundingClientRect()
      if (barR.width < 1) return

      const select =
        (document.querySelector('[data-edit-menu-select]') as HTMLElement | null) || pill
      const selectR = select.getBoundingClientRect()
      const selectLeft = selectR.left - barR.left
      const next = {
        left: selectLeft,
        width: Math.max(0, barR.width - selectLeft),
        wrap: true,
      }
      setPlace((prev) =>
        prev &&
        Math.abs(prev.left - next.left) < 0.5 &&
        Math.abs(prev.width - next.width) < 0.5 &&
        prev.wrap === next.wrap
          ? prev
          : next
      )
    }

    sync()
    const pill = document.querySelector('[data-edit-menu-pill]') as HTMLElement | null
    const select = document.querySelector('[data-edit-menu-select]') as HTMLElement | null
    const ro = new ResizeObserver(sync)
    if (pill) ro.observe(pill)
    if (select) ro.observe(select)
    if (barRef.current) ro.observe(barRef.current)
    window.addEventListener('resize', sync)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [open, openFilter, openSort, filters, sorts, scope, editMenuPillMode])

  const scopeLabel = useMemo(() => {
    if (scope === 'board') return 'Board'
    if (selectedCount === 1) return 'Frame'
    return `${selectedCount} frames`
  }, [scope, selectedCount])

  const sortPillLabel =
    sorts.length === 0 ? 'Sort' : sorts.length === 1 ? '1 sort' : `${sorts.length} sorts`

  const addFilter = () => {
    setFilters((prev) => [
      ...prev,
      { id: newId('f'), property: 'Property', operator: 'contains', value: '' },
    ])
  }

  const addSort = () => {
    setSorts((prev) => [
      ...prev,
      { id: newId('s'), property: 'Property', direction: 'asc' },
    ])
  }

  if (!open) return null

  const showSorts = openSort
  const showFilters = openFilter

  return (
    <div
      ref={barRef}
      data-filter-sort-bar
      className="relative w-full pointer-events-auto"
    >
      <div
        ref={chipsRef}
        className={cn(
          'flex items-center gap-2 px-0 py-1.5 min-h-[36px]',
          place?.wrap ? 'flex-wrap justify-start' : 'flex-nowrap justify-start'
        )}
        style={
          place
            ? {
                marginLeft: place.left,
                width: place.width,
                maxWidth: place.width,
              }
            : undefined
        }
      >
        <span className="sr-only">
          {scope === 'board' ? 'Board filters and sorts' : 'Frame filters and sorts'} ({scopeLabel})
        </span>

        {showSorts ? (
          <CriteriaPill
            icon={<ArrowUpDown className="h-3.5 w-3.5" />}
            label={sortPillLabel}
            title={sorts.length ? 'Edit sorts' : 'Add a sort'}
            onClick={addSort}
            rounded="full"
          />
        ) : null}

        {showSorts && showFilters ? (
          <span
            className="mx-0.5 h-5 w-px flex-shrink-0 bg-gray-200 dark:bg-gray-600"
            aria-hidden
          />
        ) : null}

        {showFilters ? (
          <>
            {filters.map((f) => (
              <CriteriaPill
                key={f.id}
                icon={<ListFilter className="h-3.5 w-3.5" />}
                label={filterChipLabel(f)}
                title="Edit filter (property menu later)"
              />
            ))}

            <button
              type="button"
              onClick={addFilter}
              className={cn(
                'inline-flex h-7 items-center gap-0.5 rounded-md px-1.5 text-[13px]',
                'text-gray-400 hover:bg-gray-100 hover:text-gray-600',
                'dark:hover:bg-[#2a2a2a] dark:hover:text-gray-300',
                focus === 'filter' && filters.length === 0 && 'text-gray-500'
              )}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
              <span>Filter</span>
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
