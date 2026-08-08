'use client'

// Mindmap.so-style Notion page picker — tree with Add frame (body in one frame) / Generate mindmap

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, CornerDownLeft, FileText, Search, X } from 'lucide-react'
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

type NotionImportModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: (opts: { pageIds: string[]; mode: 'card' | 'mindmap' }) => Promise<void>
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
  return <FileText className={cn('h-4 w-4 flex-shrink-0', object === 'database' ? 'text-blue-500' : 'text-gray-400')} />
}

function flattenVisible(
  nodes: NotionPickerNode[],
  expanded: Set<string>,
  depth = 0
): Array<{ node: NotionPickerNode; depth: number }> {
  const out: Array<{ node: NotionPickerNode; depth: number }> = []
  for (const node of nodes) {
    out.push({ node, depth })
    if (node.children.length > 0 && expanded.has(node.id)) {
      out.push(...flattenVisible(node.children, expanded, depth + 1))
    }
  }
  return out
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [activeIndex, setActiveIndex] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const loadPages = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/notion/pages')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load pages')
      const nextTree = (data.tree || []) as NotionPickerNode[]
      setTree(nextTree)
      // Expand first level by default so the tree reads like Notion
      setExpanded(new Set(nextTree.filter((n) => n.children.length > 0).map((n) => n.id)))
      setActiveIndex(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load pages')
      setTree([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void loadPages()
    const t = window.setTimeout(() => searchRef.current?.focus(), 50)
    return () => window.clearTimeout(t)
  }, [open, loadPages])

  const filteredTree = useMemo(() => filterTree(tree, query), [tree, query])

  useEffect(() => {
    if (!query.trim()) return
    // Auto-expand matches while searching
    setExpanded(new Set(collectExpandIds(filteredTree)))
  }, [query, filteredTree])

  const visible = useMemo(() => flattenVisible(filteredTree, expanded), [filteredTree, expanded])

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

  const runImport = async (pageId: string, mode: 'card' | 'mindmap') => {
    setBusyId(pageId)
    try {
      await onImport({ pageIds: [pageId], mode })
      onOpenChange(false)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusyId(null)
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
      if (row?.node.children.length) {
        e.preventDefault()
        setExpanded((prev) => new Set(prev).add(row.node.id))
      }
      return
    }
    if (e.key === 'ArrowLeft') {
      const row = visible[activeIndex]
      if (row && expanded.has(row.node.id)) {
        e.preventDefault()
        setExpanded((prev) => {
          const next = new Set(prev)
          next.delete(row.node.id)
          return next
        })
      }
      return
    }
    if (e.key === 'Enter') {
      const row = visible[activeIndex]
      if (!row) return
      e.preventDefault()
      void runImport(row.node.id, e.shiftKey ? 'mindmap' : 'card')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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

        <div className="px-4 pt-3 pb-1">
          <h3 className="text-sm font-semibold text-gray-900">Available pages</h3>
        </div>

        <div ref={listRef} className="max-h-[420px] overflow-y-auto px-2 pb-2">
          {loading && <div className="px-3 py-8 text-sm text-gray-500 text-center">Loading Notion pages…</div>}
          {error && !loading && <div className="px-3 py-8 text-sm text-red-600 text-center">{error}</div>}
          {!loading && !error && visible.length === 0 && (
            <div className="px-3 py-8 text-sm text-gray-500 text-center">No pages found</div>
          )}

          {!loading &&
            visible.map(({ node, depth }, index) => {
              const hasChildren = node.children.length > 0
              const isExpanded = expanded.has(node.id)
              const isActive = index === activeIndex
              const isBusy = busyId === node.id

              return (
                <div
                  key={node.id}
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
                      toggleExpand(node.id)
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
                      'flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity',
                      isActive && 'opacity-100'
                    )}
                  >
                    <button
                      type="button"
                      disabled={!!busyId}
                      onClick={() => void runImport(node.id, 'card')}
                      className="text-xs text-gray-500 hover:text-gray-800 px-1.5 py-1"
                    >
                      {isBusy ? 'Adding…' : 'Add frame'}
                    </button>
                    <button
                      type="button"
                      disabled={!!busyId}
                      onClick={() => void runImport(node.id, 'mindmap')}
                      className="text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md px-2.5 py-1.5"
                    >
                      Generate mindmap
                    </button>
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
