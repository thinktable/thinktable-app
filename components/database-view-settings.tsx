'use client'

// Database view settings panel — layout, property visibility/order, filter, sort,
// group, conditional color, sub-tasks. Thinktable chrome (not a Notion pixel clone).

import { memo, useMemo, useState } from 'react'
import {
  ArrowDownAZ,
  ArrowLeft,
  Calendar,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Filter,
  GripVertical,
  Hash,
  LayoutGrid,
  List,
  ListFilter,
  Map as MapIcon,
  Palette,
  Plus,
  Search,
  Settings2,
  Sigma,
  SlidersHorizontal,
  Table2,
  Trash2,
  Type,
  Users,
  X,
} from 'lucide-react'
import type { NotionDbProperty } from '@/lib/notion/database'
import {
  CONDITIONAL_COLORS,
  DATABASE_LAYOUTS,
  IMPLEMENTED_LAYOUTS,
  newId,
  type ConditionalColorRule,
  type DatabaseFilter,
  type DatabaseLayout,
  type DatabaseSort,
  type DatabaseViewSettings,
  type FilterOperator,
} from '@/lib/notion/database-view'
import { cn } from '@/lib/utils'

type Panel =
  | 'root'
  | 'layout'
  | 'properties'
  | 'filters'
  | 'sorts'
  | 'group'
  | 'colors'
  | 'subtasks'

type DatabaseViewSettingsProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: DatabaseViewSettings
  onChange: (next: DatabaseViewSettings) => void
  properties: NotionDbProperty[]
  sourceTitle?: string
}

function PropIcon({ type }: { type: string }) {
  if (type === 'number' || type === 'formula') return <Sigma className="h-3.5 w-3.5 opacity-50" />
  if (type === 'date' || type === 'created_time' || type === 'last_edited_time') {
    return <Calendar className="h-3.5 w-3.5 opacity-50" />
  }
  if (type === 'people') return <Users className="h-3.5 w-3.5 opacity-50" />
  if (type === 'select' || type === 'multi_select' || type === 'status') {
    return <ListFilter className="h-3.5 w-3.5 opacity-50" />
  }
  if (type === 'checkbox') return <Check className="h-3.5 w-3.5 opacity-50" />
  if (type === 'relation' || type === 'rollup') return <Hash className="h-3.5 w-3.5 opacity-50" />
  return <Type className="h-3.5 w-3.5 opacity-50" />
}

function LayoutIcon({ id }: { id: DatabaseLayout }) {
  if (id === 'table') return <Table2 className="h-5 w-5" />
  if (id === 'board') return <LayoutGrid className="h-5 w-5" />
  if (id === 'list') return <List className="h-5 w-5" />
  if (id === 'calendar') return <Calendar className="h-5 w-5" />
  if (id === 'map') return <MapIcon className="h-5 w-5" />
  return <LayoutGrid className="h-5 w-5" />
}

const OPERATORS: Array<{ id: FilterOperator; label: string }> = [
  { id: 'is', label: 'is' },
  { id: 'is_not', label: 'is not' },
  { id: 'contains', label: 'contains' },
  { id: 'does_not_contain', label: 'does not contain' },
  { id: 'is_empty', label: 'is empty' },
  { id: 'is_not_empty', label: 'is not empty' },
  { id: 'gt', label: '>' },
  { id: 'lt', label: '<' },
]

function RowButton({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  value?: string | number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-black/[0.04]"
      onClick={onClick}
    >
      <span className="text-gray-500">{icon}</span>
      <span className="flex-1">{label}</span>
      {value !== undefined && value !== '' ? (
        <span className="text-gray-400 tabular-nums">{value}</span>
      ) : null}
      <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
    </button>
  )
}

function PanelChrome({
  title,
  onBack,
  onClose,
  children,
}: {
  title: string
  onBack?: () => void
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col max-h-[min(480px,70vh)] w-[300px]">
      <div className="flex items-center gap-1 px-2 py-2 border-b border-gray-100">
        {onBack ? (
          <button
            type="button"
            className="rounded p-1 hover:bg-black/[0.04]"
            onClick={onBack}
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : (
          <span className="w-6" />
        )}
        <div className="flex-1 text-center text-[13px] font-semibold">{title}</div>
        <button
          type="button"
          className="rounded-full p-1 hover:bg-black/[0.04]"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="h-4 w-4 text-gray-500" />
        </button>
      </div>
      <div className="overflow-y-auto p-2">{children}</div>
    </div>
  )
}

/** Full view-settings popover body with nested sub-panels. */
export function DatabaseViewSettingsPanel({
  open,
  onOpenChange,
  settings,
  onChange,
  properties,
  sourceTitle,
}: DatabaseViewSettingsProps) {
  const [panel, setPanel] = useState<Panel>('root')
  const [propSearch, setPropSearch] = useState('')
  const [groupSearch, setGroupSearch] = useState('')
  const [dragProp, setDragProp] = useState<string | null>(null)

  const byName = useMemo(() => new Map(properties.map((p) => [p.name, p])), [properties])

  if (!open) return null

  const patch = (partial: Partial<DatabaseViewSettings>) => onChange({ ...settings, ...partial })

  const moveProperty = (from: string, to: string) => {
    if (from === to) return
    const order = [...settings.propertyOrder]
    const fi = order.indexOf(from)
    const ti = order.indexOf(to)
    if (fi < 0 || ti < 0) return
    order.splice(fi, 1)
    order.splice(ti, 0, from)
    patch({ propertyOrder: order })
  }

  const shown = settings.propertyOrder.filter((n) => !settings.hiddenProperties.includes(n))
  const hidden = settings.propertyOrder.filter((n) => settings.hiddenProperties.includes(n))
  const q = propSearch.trim().toLowerCase()
  const filterNames = (names: string[]) =>
    q ? names.filter((n) => n.toLowerCase().includes(q)) : names

  const close = () => {
    onOpenChange(false)
    setPanel('root')
  }

  return (
    <div
      className="absolute right-0 top-full mt-1 z-[220] rounded-lg border border-gray-200 bg-white shadow-lg"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {panel === 'root' ? (
        <PanelChrome title="View settings" onClose={close}>
          <div className="mb-2 flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1.5">
            <Table2 className="h-4 w-4 text-gray-500" />
            <input
              className="flex-1 bg-transparent text-[13px] outline-none"
              value={settings.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>
          <div className="space-y-0.5">
            <RowButton
              icon={<LayoutGrid className="h-4 w-4" />}
              label="Layout"
              value={DATABASE_LAYOUTS.find((l) => l.id === settings.layout)?.label}
              onClick={() => setPanel('layout')}
            />
            <RowButton
              icon={<Eye className="h-4 w-4" />}
              label="Property visibility"
              value={shown.length}
              onClick={() => setPanel('properties')}
            />
            <RowButton
              icon={<Filter className="h-4 w-4" />}
              label="Filter"
              value={settings.filters.length || undefined}
              onClick={() => setPanel('filters')}
            />
            <RowButton
              icon={<ArrowDownAZ className="h-4 w-4" />}
              label="Sort"
              value={settings.sorts.length || undefined}
              onClick={() => setPanel('sorts')}
            />
            <RowButton
              icon={<List className="h-4 w-4" />}
              label="Group"
              value={settings.groupBy || undefined}
              onClick={() => setPanel('group')}
            />
            <RowButton
              icon={<Palette className="h-4 w-4" />}
              label="Conditional color"
              value={settings.conditionalColors.length || undefined}
              onClick={() => setPanel('colors')}
            />
            <RowButton
              icon={<ListFilter className="h-4 w-4" />}
              label="Sub-tasks"
              value={settings.subTasks.enabled ? 'On' : undefined}
              onClick={() => setPanel('subtasks')}
            />
          </div>
          <div className="mt-3 border-t border-gray-100 pt-2 space-y-0.5">
            <div className="px-2 py-1 text-[11px] font-medium text-gray-400 uppercase tracking-wide">
              Data source
            </div>
            <div className="flex items-center gap-2 px-2 py-1.5 text-[13px] text-gray-600">
              <Settings2 className="h-4 w-4" />
              <span className="truncate">{sourceTitle || 'Database'}</span>
            </div>
          </div>
        </PanelChrome>
      ) : null}

      {panel === 'layout' ? (
        <PanelChrome title="Layout" onBack={() => setPanel('root')} onClose={close}>
          <div className="grid grid-cols-3 gap-1.5 mb-3">
            {DATABASE_LAYOUTS.map((l) => {
              const implemented = IMPLEMENTED_LAYOUTS.has(l.id)
              const selected = settings.layout === l.id
              return (
                <button
                  key={l.id}
                  type="button"
                  disabled={!implemented}
                  title={implemented ? l.label : `${l.label} — coming soon`}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-md border p-2 text-[11px]',
                    selected
                      ? 'border-blue-500 text-blue-600 bg-blue-50'
                      : 'border-gray-200 text-gray-600',
                    !implemented && 'opacity-40 cursor-not-allowed'
                  )}
                  onClick={() => patch({ layout: l.id })}
                >
                  <LayoutIcon id={l.id} />
                  {l.label}
                </button>
              )
            })}
          </div>
          <div className="space-y-2 border-t border-gray-100 pt-2">
            {(
              [
                ['showDataSourceTitle', 'Show data source title'],
                ['showVerticalLines', 'Show vertical lines'],
                ['showPageIcon', 'Show page icon'],
                ['wrapAllContent', 'Wrap all content'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between px-1 text-[13px]">
                <span>{label}</span>
                <input
                  type="checkbox"
                  className="accent-blue-500"
                  checked={settings.layoutOptions[key]}
                  onChange={(e) =>
                    patch({
                      layoutOptions: { ...settings.layoutOptions, [key]: e.target.checked },
                    })
                  }
                />
              </label>
            ))}
            <label className="flex items-center justify-between px-1 text-[13px]">
              <span>Open pages in</span>
              <select
                className="rounded border border-gray-200 text-[12px] px-1 py-0.5"
                value={settings.layoutOptions.openPagesIn}
                onChange={(e) =>
                  patch({
                    layoutOptions: {
                      ...settings.layoutOptions,
                      openPagesIn: e.target.value as 'side_peek' | 'center_peek' | 'full_page',
                    },
                  })
                }
              >
                <option value="side_peek">Side peek</option>
                <option value="center_peek">Center peek</option>
                <option value="full_page">Full page</option>
              </select>
            </label>
          </div>
        </PanelChrome>
      ) : null}

      {panel === 'properties' ? (
        <PanelChrome title="Property visibility" onBack={() => setPanel('root')} onClose={close}>
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              className="w-full rounded-md border border-blue-400 pl-7 pr-2 py-1.5 text-[13px] outline-none"
              placeholder="Search for a property..."
              value={propSearch}
              onChange={(e) => setPropSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="text-[11px] font-medium text-gray-400">Shown in table</span>
            <button
              type="button"
              className="text-[11px] text-blue-600"
              onClick={() =>
                patch({
                  hiddenProperties: [
                    ...new Set([...settings.hiddenProperties, ...shown]),
                  ].filter((n) => n !== properties.find((p) => p.type === 'title')?.name),
                })
              }
            >
              Hide all
            </button>
          </div>
          <div className="space-y-0.5 mb-3">
            {filterNames(shown).map((name) => {
              const prop = byName.get(name)
              if (!prop) return null
              return (
                <div
                  key={name}
                  draggable
                  onDragStart={() => setDragProp(name)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragProp) moveProperty(dragProp, name)
                    setDragProp(null)
                  }}
                  className="flex items-center gap-1 rounded px-1 py-1 hover:bg-black/[0.03] cursor-grab"
                >
                  <GripVertical className="h-3.5 w-3.5 text-gray-300" />
                  <PropIcon type={prop.type} />
                  <span className="flex-1 text-[13px] truncate">{name}</span>
                  <button
                    type="button"
                    className="p-0.5"
                    disabled={prop.type === 'title'}
                    onClick={() =>
                      patch({ hiddenProperties: [...settings.hiddenProperties, name] })
                    }
                    aria-label={`Hide ${name}`}
                  >
                    <Eye className="h-3.5 w-3.5 text-gray-600" />
                  </button>
                </div>
              )
            })}
          </div>
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="text-[11px] font-medium text-gray-400">Hidden in table</span>
            <button
              type="button"
              className="text-[11px] text-blue-600"
              onClick={() => patch({ hiddenProperties: [] })}
            >
              Show all
            </button>
          </div>
          <div className="space-y-0.5">
            {filterNames(hidden).map((name) => {
              const prop = byName.get(name)
              if (!prop) return null
              return (
                <div
                  key={name}
                  className="flex items-center gap-1 rounded px-1 py-1 hover:bg-black/[0.03]"
                >
                  <GripVertical className="h-3.5 w-3.5 text-gray-200" />
                  <PropIcon type={prop.type} />
                  <span className="flex-1 text-[13px] truncate text-gray-500">{name}</span>
                  <button
                    type="button"
                    className="p-0.5"
                    onClick={() =>
                      patch({
                        hiddenProperties: settings.hiddenProperties.filter((n) => n !== name),
                      })
                    }
                    aria-label={`Show ${name}`}
                  >
                    <EyeOff className="h-3.5 w-3.5 text-gray-400" />
                  </button>
                </div>
              )
            })}
          </div>
        </PanelChrome>
      ) : null}

      {panel === 'filters' ? (
        <PanelChrome title="Filters" onBack={() => setPanel('root')} onClose={close}>
          <div className="space-y-2">
            {settings.filters.map((filter, index) => (
              <FilterRow
                key={filter.id}
                filter={filter}
                properties={properties}
                onChange={(next) => {
                  const filters = [...settings.filters]
                  filters[index] = next
                  patch({ filters })
                }}
                onRemove={() =>
                  patch({ filters: settings.filters.filter((f) => f.id !== filter.id) })
                }
                onMove={(dir) => {
                  const filters = [...settings.filters]
                  const j = index + dir
                  if (j < 0 || j >= filters.length) return
                  ;[filters[index], filters[j]] = [filters[j], filters[index]]
                  patch({ filters })
                }}
              />
            ))}
          </div>
          <button
            type="button"
            className="mt-2 flex w-full items-center justify-center gap-1 rounded-md bg-gray-100 py-1.5 text-[13px] hover:bg-gray-200"
            onClick={() => {
              const prop = properties[0]?.name || 'Name'
              patch({
                filters: [
                  ...settings.filters,
                  { id: newId('f'), property: prop, operator: 'contains', value: '' },
                ],
              })
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add filter
          </button>
        </PanelChrome>
      ) : null}

      {panel === 'sorts' ? (
        <PanelChrome title="Sort" onBack={() => setPanel('root')} onClose={close}>
          <div className="space-y-2">
            {settings.sorts.map((sort, index) => (
              <div key={sort.id} className="flex items-center gap-1">
                <button
                  type="button"
                  className="p-0.5 text-gray-300 cursor-grab"
                  onClick={() => {
                    if (index === 0) return
                    const sorts = [...settings.sorts]
                    ;[sorts[index - 1], sorts[index]] = [sorts[index], sorts[index - 1]]
                    patch({ sorts })
                  }}
                  aria-label="Move sort up"
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </button>
                <select
                  className="flex-1 rounded border border-gray-200 text-[12px] px-1 py-1"
                  value={sort.property}
                  onChange={(e) => {
                    const sorts = [...settings.sorts]
                    sorts[index] = { ...sort, property: e.target.value }
                    patch({ sorts })
                  }}
                >
                  {properties.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select
                  className="rounded border border-gray-200 text-[12px] px-1 py-1"
                  value={sort.direction}
                  onChange={(e) => {
                    const sorts = [...settings.sorts]
                    sorts[index] = {
                      ...sort,
                      direction: e.target.value as 'asc' | 'desc',
                    }
                    patch({ sorts })
                  }}
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
                <button
                  type="button"
                  className="p-1 text-gray-400 hover:text-red-500"
                  onClick={() =>
                    patch({ sorts: settings.sorts.filter((s) => s.id !== sort.id) })
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="flex flex-1 items-center justify-center gap-1 rounded-md bg-gray-100 py-1.5 text-[13px]"
              onClick={() =>
                patch({
                  sorts: [
                    ...settings.sorts,
                    {
                      id: newId('s'),
                      property: properties[0]?.name || 'Name',
                      direction: 'asc',
                    },
                  ],
                })
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add sort
            </button>
            {settings.sorts.length ? (
              <button
                type="button"
                className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[13px] text-red-600 hover:bg-red-50"
                onClick={() => patch({ sorts: [] })}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            ) : null}
          </div>
        </PanelChrome>
      ) : null}

      {panel === 'group' ? (
        <PanelChrome title="Group by" onBack={() => setPanel('root')} onClose={close}>
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              className="w-full rounded-md border border-blue-400 pl-7 pr-2 py-1.5 text-[13px] outline-none"
              placeholder="Search for a property..."
              value={groupSearch}
              onChange={(e) => setGroupSearch(e.target.value)}
            />
          </div>
          <button
            type="button"
            className={cn(
              'flex w-full items-center justify-between rounded px-2 py-1.5 text-[13px] hover:bg-black/[0.04]',
              !settings.groupBy && 'bg-black/[0.04]'
            )}
            onClick={() => patch({ groupBy: null })}
          >
            None
            {!settings.groupBy ? <Check className="h-3.5 w-3.5" /> : null}
          </button>
          {properties
            .filter((p) =>
              groupSearch
                ? p.name.toLowerCase().includes(groupSearch.toLowerCase())
                : true
            )
            .map((p) => (
              <button
                key={p.id}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-black/[0.04]',
                  settings.groupBy === p.name && 'bg-black/[0.04]'
                )}
                onClick={() => patch({ groupBy: p.name })}
              >
                <PropIcon type={p.type} />
                <span className="flex-1 text-left">{p.name}</span>
                {settings.groupBy === p.name ? <Check className="h-3.5 w-3.5" /> : null}
              </button>
            ))}
        </PanelChrome>
      ) : null}

      {panel === 'colors' ? (
        <PanelChrome title="Conditional color" onBack={() => setPanel('root')} onClose={close}>
          <div className="space-y-2">
            {settings.conditionalColors.map((rule, index) => (
              <ColorRuleCard
                key={rule.id}
                rule={rule}
                properties={properties}
                onChange={(next) => {
                  const conditionalColors = [...settings.conditionalColors]
                  conditionalColors[index] = next
                  patch({ conditionalColors })
                }}
                onRemove={() =>
                  patch({
                    conditionalColors: settings.conditionalColors.filter((r) => r.id !== rule.id),
                  })
                }
              />
            ))}
          </div>
          <button
            type="button"
            className="mt-2 flex w-full items-center justify-center gap-1 rounded-md bg-gray-100 py-1.5 text-[13px]"
            onClick={() =>
              patch({
                conditionalColors: [
                  ...settings.conditionalColors,
                  {
                    id: newId('c'),
                    property: properties.find((p) => p.type === 'status' || p.type === 'select')?.name ||
                      properties[0]?.name ||
                      'Status',
                    operator: 'is',
                    value: '',
                    color: 'green',
                    applyTo: 'row',
                  },
                ],
              })
            }
          >
            <Plus className="h-3.5 w-3.5" /> Add another
          </button>
        </PanelChrome>
      ) : null}

      {panel === 'subtasks' ? (
        <PanelChrome title="Sub-tasks" onBack={() => setPanel('root')} onClose={close}>
          <label className="flex items-center justify-between px-1 mb-3 text-[13px]">
            <span>Enable sub-tasks</span>
            <input
              type="checkbox"
              className="accent-blue-500"
              checked={settings.subTasks.enabled}
              onChange={(e) =>
                patch({ subTasks: { ...settings.subTasks, enabled: e.target.checked } })
              }
            />
          </label>
          <div className="space-y-2 text-[13px]">
            <label className="block px-1">
              <span className="text-gray-500 text-[11px]">Display</span>
              <select
                className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5"
                value={settings.subTasks.display}
                onChange={(e) =>
                  patch({
                    subTasks: {
                      ...settings.subTasks,
                      display: e.target.value as 'nested' | 'flat',
                    },
                  })
                }
              >
                <option value="nested">Nested in toggle</option>
                <option value="flat">Flat</option>
              </select>
            </label>
            <label className="block px-1">
              <span className="text-gray-500 text-[11px]">Filter</span>
              <select
                className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5"
                value={settings.subTasks.filterMode}
                onChange={(e) =>
                  patch({
                    subTasks: {
                      ...settings.subTasks,
                      filterMode: e.target.value as 'parents_and_subs' | 'matching_only',
                    },
                  })
                }
              >
                <option value="parents_and_subs">Parents and sub-items</option>
                <option value="matching_only">Matching only</option>
              </select>
              <p className="mt-1 text-[11px] text-gray-400">
                All parents and sub-items that match the filters will show up.
              </p>
            </label>
            <label className="block px-1">
              <span className="text-gray-500 text-[11px]">Parent relation property</span>
              <select
                className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5"
                value={settings.subTasks.relationProperty || ''}
                onChange={(e) =>
                  patch({
                    subTasks: {
                      ...settings.subTasks,
                      relationProperty: e.target.value || null,
                    },
                  })
                }
              >
                <option value="">None</option>
                {properties
                  .filter((p) => p.type === 'relation' || /parent|sub.?task/i.test(p.name))
                  .map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                {/* Also allow any property as fallback */}
                {properties
                  .filter((p) => p.type !== 'relation' && !/parent|sub.?task/i.test(p.name))
                  .map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            {settings.subTasks.enabled ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-red-600 hover:bg-red-50"
                onClick={() =>
                  patch({
                    subTasks: { ...settings.subTasks, enabled: false, relationProperty: null },
                  })
                }
              >
                <Trash2 className="h-3.5 w-3.5" /> Turn off sub-tasks
              </button>
            ) : null}
          </div>
        </PanelChrome>
      ) : null}
    </div>
  )
}

function FilterRow({
  filter,
  properties,
  onChange,
  onRemove,
  onMove,
}: {
  filter: DatabaseFilter
  properties: NotionDbProperty[]
  onChange: (f: DatabaseFilter) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const needsValue = filter.operator !== 'is_empty' && filter.operator !== 'is_not_empty'
  const prop = properties.find((p) => p.name === filter.property)
  return (
    <div className="flex flex-col gap-1 rounded-md border border-gray-100 bg-gray-50 p-2">
      <div className="flex items-center gap-1">
        <button type="button" className="text-gray-300" onClick={() => onMove(-1)}>
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <select
          className="flex-1 rounded border border-gray-200 text-[12px] px-1 py-1"
          value={filter.property}
          onChange={(e) => onChange({ ...filter, property: e.target.value })}
        >
          {properties.map((p) => (
            <option key={p.id} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          className="rounded border border-gray-200 text-[12px] px-1 py-1"
          value={filter.operator}
          onChange={(e) =>
            onChange({ ...filter, operator: e.target.value as FilterOperator })
          }
        >
          {OPERATORS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="button" className="p-1 text-gray-400" onClick={onRemove}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {needsValue ? (
        prop?.options?.length ? (
          <select
            className="rounded border border-gray-200 text-[12px] px-2 py-1"
            value={filter.value}
            onChange={(e) => onChange({ ...filter, value: e.target.value })}
          >
            <option value="">Select…</option>
            {prop.options.map((o) => (
              <option key={o.id || o.name} value={o.name}>
                {o.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="rounded border border-gray-200 text-[12px] px-2 py-1"
            value={filter.value}
            placeholder="Value"
            onChange={(e) => onChange({ ...filter, value: e.target.value })}
          />
        )
      ) : null}
    </div>
  )
}

function ColorRuleCard({
  rule,
  properties,
  onChange,
  onRemove,
}: {
  rule: ConditionalColorRule
  properties: NotionDbProperty[]
  onChange: (r: ConditionalColorRule) => void
  onRemove: () => void
}) {
  const prop = properties.find((p) => p.name === rule.property)
  const swatch = CONDITIONAL_COLORS.find((c) => c.id === rule.color)
  return (
    <div className="rounded-md border border-gray-100 bg-gray-50 p-2 space-y-2">
      <div className="flex items-center gap-1">
        <select
          className="rounded border border-gray-200 text-[12px] px-1 py-1"
          value={rule.property}
          onChange={(e) => onChange({ ...rule, property: e.target.value })}
        >
          {properties.map((p) => (
            <option key={p.id} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          className="rounded border border-gray-200 text-[12px] px-1 py-1"
          value={rule.operator}
          onChange={(e) => onChange({ ...rule, operator: e.target.value as FilterOperator })}
        >
          {OPERATORS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="button" className="ml-auto p-1 text-gray-400" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {prop?.options?.length ? (
        <select
          className="w-full rounded border border-gray-200 text-[12px] px-2 py-1"
          value={rule.value}
          onChange={(e) => onChange({ ...rule, value: e.target.value })}
        >
          <option value="">Select…</option>
          {prop.options.map((o) => (
            <option key={o.id || o.name} value={o.name}>
              {o.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="w-full rounded border border-gray-200 text-[12px] px-2 py-1"
          value={rule.value}
          placeholder="Value (e.g. Today)"
          onChange={(e) => onChange({ ...rule, value: e.target.value })}
        />
      )}
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-gray-500">Page background</span>
        <select
          className="rounded border border-gray-200 px-1 py-0.5"
          value={rule.color}
          onChange={(e) => onChange({ ...rule, color: e.target.value })}
        >
          {CONDITIONAL_COLORS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2 text-[12px]">
        <span
          className="inline-block h-3 w-3 rounded-sm border border-black/10"
          style={{ background: swatch?.bg }}
        />
        <span className="text-gray-500">Apply to</span>
        <span className="font-medium">Entire row</span>
      </div>
    </div>
  )
}

/** Compact toolbar: search + filter/sort/settings triggers. */
export const DatabaseViewToolbar = memo(function DatabaseViewToolbar({
  settings,
  onChange,
  properties,
  sourceTitle,
  className,
}: {
  settings: DatabaseViewSettings
  onChange: (next: DatabaseViewSettings) => void
  properties: NotionDbProperty[]
  sourceTitle?: string
  className?: string
}) {
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div
      className={cn(
        'relative flex items-center gap-1 px-1 py-1 bg-transparent',
        className
      )}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="relative flex-1 min-w-[120px]">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
        <input
          className="w-full rounded-md border border-transparent bg-gray-50 pl-7 pr-2 py-1 text-[12px] outline-none focus:border-blue-400 focus:bg-white"
          placeholder="Search…"
          value={settings.searchQuery}
          onChange={(e) => onChange({ ...settings, searchQuery: e.target.value })}
        />
      </div>
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] hover:bg-black/[0.04]',
          settings.filters.length && 'text-blue-600 bg-blue-50'
        )}
        onClick={() => setSettingsOpen(true)}
        title="Filters"
      >
        <Filter className="h-3.5 w-3.5" />
        {settings.filters.length || null}
      </button>
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] hover:bg-black/[0.04]',
          settings.sorts.length && 'text-blue-600 bg-blue-50'
        )}
        onClick={() => setSettingsOpen(true)}
        title="Sort"
      >
        <ArrowDownAZ className="h-3.5 w-3.5" />
        {settings.sorts.length || null}
      </button>
      <button
        type="button"
        className="rounded px-1.5 py-1 hover:bg-black/[0.04]"
        onClick={() => setSettingsOpen((o) => !o)}
        title="View settings"
      >
        <SlidersHorizontal className="h-3.5 w-3.5 text-gray-600" />
      </button>
      <DatabaseViewSettingsPanel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onChange={onChange}
        properties={properties}
        sourceTitle={sourceTitle}
      />
    </div>
  )
})
