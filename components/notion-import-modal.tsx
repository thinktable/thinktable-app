'use client'

// Mindmap.so-style Notion page picker — tree with Add frame (boardLink on map) / Generate mindmap

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, CornerDownLeft, FileText, Search, Table2, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { cn } from '@/lib/utils'

export type NotionPickerNode = {
  id: string
  object: 'page' | 'database'
  title: string
  url?: string
  icon?: {
    type?: string
    emoji?: string
    external?: { url?: string }
    file?: { url?: string }
  } | null
  children: NotionPickerNode[]
}

export type NotionPickerSection = {
  id: string // recents | favorites | shared | private
  title: string // Notion sidebar heading
  nodes: NotionPickerNode[] // Pages under this heading
}

type VisibleRow =
  | { kind: 'section'; section: NotionPickerSection; rowKey: string }
  | { kind: 'page'; node: NotionPickerNode; depth: number; rowKey: string }

type NotionImportModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: (opts: { pageIds: string[]; mode: 'card' | 'mindmap'; signal?: AbortSignal }) => Promise<void>
}

function NotionIcon({ icon, object }: { icon?: NotionPickerNode['icon']; object: 'page' | 'database' }) {
  if (icon?.type === 'emoji' && icon.emoji) {
    return <span className="text-base leading-none w-5 text-center flex-shrink-0">{icon.emoji}</span>
  }
  const url = icon?.type === 'external' ? icon.external?.url : icon?.type === 'file' ? icon.file?.url : null
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="h-5 w-5 rounded-sm object-cover flex-shrink-0" />
  }
  return object === 'database' ? (
    <Table2 className="h-4 w-4 flex-shrink-0 text-blue-500" />
  ) : (
    <FileText className="h-4 w-4 flex-shrink-0 text-gray-400" />
  )
}

function flattenPages(
  nodes: NotionPickerNode[],
  expanded: Set<string>,
  depth: number,
  keyPrefix: string
): Array<{ node: NotionPickerNode; depth: number; rowKey: string }> {
  const out: Array<{ node: NotionPickerNode; depth: number; rowKey: string }> = []
  for (const node of nodes) {
    const rowKey = `${keyPrefix}${node.id}` // Prefix so Recents + Private can share a page id
    out.push({ node, depth, rowKey })
    if (node.children.length > 0 && expanded.has(rowKey)) {
      out.push(...flattenPages(node.children, expanded, depth + 1, keyPrefix))
    }
  }
  return out
}

function flattenPicker(
  sections: NotionPickerSection[],
  tree: NotionPickerNode[],
  expanded: Set<string>,
  query: string
): VisibleRow[] {
  const q = query.trim()
  if (q) {
    return flattenPages(filterTree(tree, q), expanded, 0, 'search:').map((row) => ({
      kind: 'page' as const,
      ...row,
    }))
  }
  const out: VisibleRow[] = []
  for (const section of sections) {
    const rowKey = `section:${section.id}` // Collapse key for Recents / Private / …
    out.push({ kind: 'section', section, rowKey })
    if (!expanded.has(rowKey)) continue // Private starts collapsed; Recents / Shared are pre-opened
    out.push(
      ...flattenPages(section.nodes, expanded, 1, `${section.id}:`).map((row) => ({
        kind: 'page' as const,
        ...row,
      }))
    )
  }
  return out
}

/** Recents + Shared start open (Notion-style); Private and nested pages stay collapsed. */
function defaultExpandedSections(sections: NotionPickerSection[]): Set<string> {
  const next = new Set<string>()
  for (const section of sections) {
    if (section.id === 'recents' || section.id === 'shared') {
      next.add(`section:${section.id}`) // Open these headings on first paint
    }
  }
  return next
}

function filterTree(nodes: NotionPickerNode[], query: string): NotionPickerNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes
  const filterNode = (node: NotionPickerNode): NotionPickerNode | null => {
    const childMatches = node.children.map(filterNode).filter(Boolean) as NotionPickerNode[]
    const selfMatch = node.title.toLowerCase().includes(q)
    if (selfMatch || childMatches.length > 0) {
      return { ...node, children: selfMatch ? node.children : childMatches }
    }
    return null
  }
  return nodes.map(filterNode).filter(Boolean) as NotionPickerNode[]
}

function collectExpandIds(nodes: NotionPickerNode[]): string[] {
  const ids: string[] = []
  const walk = (list: NotionPickerNode[]) => {
    for (const n of list) {
      if (n.children.length > 0) {
        ids.push(n.id)
        walk(n.children)
      }
    }
  }
  walk(nodes)
  return ids
}

export function NotionImportModal({ open, onOpenChange, onImport }: NotionImportModalProps) {
  const [tree, setTree] = useState<NotionPickerNode[]>([])
  const [sections, setSections] = useState<NotionPickerSection[]>([]) // Recents / Shared / Private
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set()) // Empty = all sections + pages collapsed
  const [activeIndex, setActiveIndex] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busyMode, setBusyMode] = useState<'card' | 'mindmap' | null>(null) // Adding vs generating label
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const wasSearching = useRef(false) // Detect search → empty so we restore Recents / Shared open
  const abortRef = useRef<AbortController | null>(null) // In-flight Add frame / Generate mindmap

  const loadPages = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/notion/pages')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load pages')
      const nextTree = (data.tree || []) as NotionPickerNode[]
      const nextSections = (data.sections || []) as NotionPickerSection[]
      setTree(nextTree)
      setSections(nextSections)
      setExpanded(defaultExpandedSections(nextSections)) // Recents / Shared open; Private collapsed
      setActiveIndex(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load pages')
      setTree([])
      setSections([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('') // Fresh search box each open
    void loadPages()
    const t = window.setTimeout(() => searchRef.current?.focus(), 50)
    return () => window.clearTimeout(t)
  }, [open, loadPages])

  const filteredTree = useMemo(() => filterTree(tree, query), [tree, query])

  useEffect(() => {
    const searching = Boolean(query.trim())
    if (searching) {
      wasSearching.current = true
      // Auto-expand matches while searching
      setExpanded(new Set(collectExpandIds(filteredTree).map((id) => `search:${id}`)))
      return
    }
    if (wasSearching.current) {
      wasSearching.current = false
      setExpanded(defaultExpandedSections(sections)) // Back to Recents / Shared open, Private collapsed
    }
  }, [query, filteredTree])

  const visible = useMemo(
    () => flattenPicker(sections, tree, expanded, query),
    [sections, tree, expanded, query]
  )

  useEffect(() => {
    if (activeIndex >= visible.length) setActiveIndex(Math.max(0, visible.length - 1))
  }, [visible.length, activeIndex])

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-picker-index="${activeIndex}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const cancelImport = () => {
    abortRef.current?.abort() // Stop the fetch + server walk
    abortRef.current = null
    setBusyId(null) // Unlock the row immediately
    setBusyMode(null)
  }

  const runImport = async (pageId: string, mode: 'card' | 'mindmap') => {
    abortRef.current?.abort() // One import at a time
    const ac = new AbortController() // Token for this Add frame / Generate mindmap
    abortRef.current = ac
    setBusyId(pageId)
    setBusyMode(mode)
    try {
      await onImport({ pageIds: [pageId], mode, signal: ac.signal })
      if (ac.signal.aborted) return // Cancelled — keep the picker open
      onOpenChange(false)
    } catch (e) {
      const aborted =
        ac.signal.aborted ||
        (e instanceof DOMException && e.name === 'AbortError') ||
        (e instanceof Error && e.name === 'AbortError')
      if (aborted) return // User hit Cancel — no error toast
      window.alert(e instanceof Error ? e.message : 'Import failed')
    } finally {
      if (abortRef.current === ac) abortRef.current = null
      setBusyId(null)
      setBusyMode(null)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onOpenChange(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, visible.length - 1)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'ArrowRight') {
      const row = visible[activeIndex]
      const canExpand =
        row?.kind === 'section' || (row?.kind === 'page' && row.node.children.length > 0)
      if (canExpand) {
        e.preventDefault()
        setExpanded((prev) => new Set(prev).add(row.rowKey)) // Expand section or nested page
      }
      return
    }
    if (e.key === 'ArrowLeft') {
      const row = visible[activeIndex]
      if (row && expanded.has(row.rowKey)) {
        e.preventDefault()
        setExpanded((prev) => {
          const next = new Set(prev)
          next.delete(row.rowKey)
          return next
        })
      }
      return
    }
    if (e.key === 'Enter') {
      const row = visible[activeIndex]
      if (!row) return
      e.preventDefault()
      if (row.kind === 'section') {
        toggleExpand(row.rowKey) // Enter on a heading opens Recents / Private
        return
      }
      void runImport(row.node.id, e.shiftKey ? 'mindmap' : 'card')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busyId) cancelImport() // Closing the picker aborts an in-flight import
        onOpenChange(next)
      }}
    >
      <DialogContent
        className="max-w-[560px] p-0 gap-0 overflow-hidden rounded-xl border-gray-200 shadow-2xl"
        onKeyDown={onKeyDown}
      >
        <DialogTitle className="sr-only">Import Notion pages</DialogTitle>
        <DialogDescription className="sr-only">
          Search and pick Notion pages to add as frames (with page contents) or generate a mindmap
        </DialogDescription>

        <div className="p-4 pb-3 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-400" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActiveIndex(0)
              }}
              placeholder="Search notion pages"
              className="h-11 pl-9 pr-9 rounded-lg border-blue-300 focus-visible:ring-blue-400 focus-visible:border-blue-400"
            />
            {query && (
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-blue-600/80">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1">
              <span className="font-mono text-[10px]">↑↓</span> Select
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1">
              <CornerDownLeft className="h-3 w-3" /> Confirm
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1">
              <span className="font-mono text-[10px]">Esc</span> Close
            </span>
          </div>
        </div>

        {query.trim() ? (
          <div className="px-4 pt-3 pb-1">
            <h3 className="text-xs font-semibold text-gray-500">Best matches</h3>
          </div>
        ) : null}

        <div ref={listRef} className={cn('max-h-[420px] overflow-y-auto px-2 pb-2', !query.trim() && 'pt-2')} >
          {loading && <div className="px-3 py-8 text-sm text-gray-500 text-center">Loading Notion pages…</div>}
          {error && !loading && <div className="px-3 py-8 text-sm text-red-600 text-center">{error}</div>}
          {!loading && !error && visible.length === 0 && (
            <div className="px-3 py-8 text-sm text-gray-500 text-center">No pages found</div>
          )}

          {!loading &&
            visible.map((row, index) => {
              const isActive = index === activeIndex
              if (row.kind === 'section') {
                const isExpanded = expanded.has(row.rowKey)
                return (
                  <button
                    key={row.rowKey}
                    type="button"
                    data-picker-index={index}
                    className={cn(
                      'flex w-full items-center gap-1 rounded-lg px-1 py-1.5 text-left transition-colors',
                      isActive ? 'bg-gray-100' : 'hover:bg-gray-50'
                    )}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => toggleExpand(row.rowKey)}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 flex-shrink-0 text-gray-400" />
                    ) : (
                      <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-400" />
                    )}
                    <span className="truncate text-xs font-semibold text-gray-500">
                      {row.section.title}
                    </span>
                  </button>
                )
              }

              const { node, depth, rowKey } = row
              const hasChildren = node.children.length > 0
              const isExpanded = expanded.has(rowKey)
              const isBusy = busyId === node.id

              return (
                <div
                  key={rowKey}
                  data-picker-index={index}
                  className={cn(
                    'group flex items-center gap-1 rounded-lg px-1 py-1.5 transition-colors',
                    isActive ? 'bg-gray-100' : 'hover:bg-gray-50'
                  )}
                  style={{ paddingLeft: 8 + depth * 16 }}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <button
                    type="button"
                    className={cn(
                      'h-6 w-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 flex-shrink-0',
                      !hasChildren && 'invisible'
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleExpand(rowKey)
                    }}
                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  >
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>

                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => setActiveIndex(index)}
                    onDoubleClick={() => void runImport(node.id, 'card')}
                  >
                    <NotionIcon icon={node.icon} object={node.object} />
                    <span className="truncate text-sm text-gray-900">{node.title}</span>
                  </button>

                  <div
                    className={cn(
                      'flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap',
                      isBusy || isActive
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100 transition-opacity'
                    )}
                  >
                    {isBusy && busyMode === 'card' ? (
                      <>
                        <span className="text-xs font-medium text-blue-700 whitespace-nowrap">
                          Adding…
                        </span>
                        <button
                          type="button"
                          onClick={cancelImport}
                          className="text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md px-2.5 py-1.5 flex-shrink-0"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={!!busyId}
                        onClick={() => void runImport(node.id, 'card')}
                        className="text-xs text-gray-500 hover:text-gray-800 px-1.5 py-1 disabled:opacity-40"
                      >
                        Add frame
                      </button>
                    )}
                    {isBusy && busyMode === 'mindmap' ? (
                      <>
                        <span className="text-xs font-medium text-blue-700 whitespace-nowrap">
                          Generating…
                        </span>
                        <button
                          type="button"
                          onClick={cancelImport}
                          className="text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md px-2.5 py-1.5 flex-shrink-0"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={!!busyId}
                        onClick={() => void runImport(node.id, 'mindmap')}
                        className="text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md px-2.5 py-1.5 disabled:opacity-40"
                      >
                        Generate mindmap
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
        </div>

        <div className="border-t border-gray-100 px-4 py-3">
          <a
            href="https://www.notion.so/new"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded border border-gray-200 text-gray-500">
              ↑
            </span>
            Create new page in notion
          </a>
        </div>
      </DialogContent>
    </Dialog>
  )
}
