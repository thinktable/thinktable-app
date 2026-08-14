'use client'

// View-bar Capture popover — search / filter / Capture view + selectable list + add to presentation/chat

import { useMemo, useState, useSyncExternalStore } from 'react' // Search, selection, store
import { useQueryClient } from '@tanstack/react-query' // Board path + frame text
import {
  ListFilter, // Filter control
  MessageSquare, // Add to chat
  Presentation, // Add to presentation
  Scan, // Capture view (4 disconnected rounded corners)
  Search, // Search field glyph
} from 'lucide-react'
import { Button } from '@/components/ui/button' // Ghost icon trigger
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu' // Anchored panel under the Scan control
import { useReactFlowContext } from '@/components/react-flow-context' // Current viewport
import { useSidebarContext } from '@/components/sidebar-context' // Open chat on add-to-chat
import {
  addCapturesToPresentation,
  attachCapturesToChat,
  createPresentation,
  filterCaptures,
  formatCaptureTimestamp,
  getCaptures,
  getPresentations,
  subscribeCaptures,
  takeBoardCapture,
} from '@/lib/captures' // Local capture/presentation store
import { cn } from '@/lib/utils' // Class merge

type CapturesMenuProps = {
  open: boolean // Controlled by editor-toolbar openDropdown
  onOpenChange: (open: boolean) => void // Keep only one toolbar dropdown open
  conversationId?: string // Current board — Capture view + this-board filter
  triggerVisible?: boolean // false when overflowed into More (still mount for controlled open)
}

export function CapturesMenu({
  open,
  onOpenChange,
  conversationId,
  triggerVisible = true,
}: CapturesMenuProps) {
  const queryClient = useQueryClient() // Path + messages cache
  const { reactFlowInstance } = useReactFlowContext() // Viewport at Capture view
  const { setChatSidebarOpen } = useSidebarContext() // Reveal chat when attaching
  const captures = useSyncExternalStore(subscribeCaptures, getCaptures, getCaptures) // List
  const presentations = useSyncExternalStore(subscribeCaptures, getPresentations, getPresentations) // Select list
  const [query, setQuery] = useState('') // Search: board / date / words
  const [thisBoardOnly, setThisBoardOnly] = useState(false) // Filter: this board vs all
  const [filterOpen, setFilterOpen] = useState(false) // Filter panel
  const [selected, setSelected] = useState<Set<string>>(() => new Set()) // Row selection
  const [previewId, setPreviewId] = useState<string | null>(null) // Expanded JPEG overlay
  const [capturing, setCapturing] = useState(false) // Capture view in flight

  const items = useMemo(
    () =>
      filterCaptures(captures, query, {
        boardId: conversationId,
        thisBoardOnly: thisBoardOnly && Boolean(conversationId),
      }),
    [captures, query, conversationId, thisBoardOnly]
  )

  const presentationsByCapture = useMemo(() => {
    const map = new Map<string, { id: string; name: string }[]>() // capture id → presentations
    for (const p of presentations) {
      for (const captureId of p.captureIds) {
        const list = map.get(captureId) || []
        list.push({ id: p.id, name: p.name })
        map.set(captureId, list)
      }
    }
    return map
  }, [presentations])

  const hasSelection = selected.size > 0 // Footer actions need at least one
  const previewItem = previewId ? items.find((c) => c.id === previewId) : undefined // Overlay target

  const captureView = async () => {
    if (!conversationId || capturing) return // Need a board; ignore double-clicks
    setCapturing(true)
    try {
      const vp = reactFlowInstance?.getViewport() || { x: 0, y: 0, zoom: 1 } // Current camera
      const created = await takeBoardCapture(
        (key) => queryClient.getQueryData(key),
        conversationId,
        vp
      )
      setSelected((prev) => new Set(prev).add(created.id)) // Select the new row
    } finally {
      setCapturing(false)
    }
  }

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedIds = () => [...selected] // Selected capture ids (not only currently visible rows)

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery('')
          setFilterOpen(false)
          setPreviewId(null)
        }
        onOpenChange(next)
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] flex-shrink-0',
            !triggerVisible && 'hidden' // Overflow: keep mounted, hide the glyph
          )}
          title="Capture"
          aria-label="Capture"
        >
          <Scan className="h-4 w-4" /> {/* Four disconnected rounded corners */}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="relative w-[340px] rounded-xl border-gray-200 p-0 shadow-md overflow-hidden"
        onCloseAutoFocus={(e) => e.preventDefault()}
        onKeyDown={(e) => e.stopPropagation()} // Don't let board shortcuts eat typing
      >
        {/* Filter left of search · Capture view top right */}
        <div className="flex items-center gap-1 px-2 pt-2 pb-1.5">
          <div className="relative flex-shrink-0">
            <button
              type="button"
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100',
                (filterOpen || thisBoardOnly) && 'bg-gray-100 text-gray-900'
              )}
              title="Filter"
              aria-label="Filter"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setFilterOpen((v) => !v)}
            >
              <ListFilter className="h-4 w-4" />
            </button>
            {filterOpen && (
              <div className="absolute left-0 top-full z-10 mt-1 w-40 rounded-md border border-gray-200 bg-white py-1 shadow-md">
                <button
                  type="button"
                  className={cn(
                    'flex w-full px-2.5 py-1.5 text-left text-sm hover:bg-gray-50',
                    !thisBoardOnly && 'font-medium text-gray-900'
                  )}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setThisBoardOnly(false)
                    setFilterOpen(false)
                  }}
                >
                  All boards
                </button>
                <button
                  type="button"
                  className={cn(
                    'flex w-full px-2.5 py-1.5 text-left text-sm hover:bg-gray-50',
                    thisBoardOnly && 'font-medium text-gray-900',
                    !conversationId && 'opacity-40'
                  )}
                  disabled={!conversationId}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (!conversationId) return
                    setThisBoardOnly(true)
                    setFilterOpen(false)
                  }}
                >
                  This board
                </button>
              </div>
            )}
          </div>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search captures..."
              className="h-8 w-full rounded-md border border-gray-200 bg-white pl-7 pr-2 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300"
              onKeyDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            />
          </div>
          <button
            type="button"
            className="flex h-8 flex-shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-40"
            title="Capture view"
            aria-label="Capture view"
            disabled={!conversationId || capturing}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => void captureView()}
          >
            <Scan className="h-3.5 w-3.5" />
            Capture view
          </button>
        </div>

        <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto px-2 pb-1">
          {items.length === 0 ? (
            <div className="px-1 py-8 text-center text-xs text-gray-400">
              {captures.length === 0 ? 'No captures yet' : 'No captures match'}
            </div>
          ) : (
            items.map((item) => {
              const on = selected.has(item.id)
              const tags = presentationsByCapture.get(item.id) || []
              return (
                <div
                  key={item.id}
                  className={cn(
                    'flex w-full flex-col rounded-lg px-2 py-2 hover:bg-gray-50',
                    on && 'bg-gray-100 hover:bg-gray-100'
                  )}
                >
                  <div className="flex w-full items-start gap-2">
                    <button
                      type="button"
                      className={cn(
                        'mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border',
                        on ? 'border-gray-900 bg-gray-900' : 'border-gray-300 bg-white'
                      )}
                      aria-label={on ? 'Deselect capture' : 'Select capture'}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => toggleRow(item.id)}
                    >
                      {on && <span className="h-1.5 w-1.5 rounded-sm bg-white" />}
                    </button>
                    <button
                      type="button"
                      className="h-11 w-[4.5rem] flex-shrink-0 overflow-hidden rounded-md border border-gray-200 bg-gray-50"
                      title="Preview capture"
                      aria-label="Preview capture"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => {
                        if (item.imageDataUrl) setPreviewId(item.id)
                      }}
                    >
                      {item.imageDataUrl ? (
                        <img
                          src={item.imageDataUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-gray-300">
                          <Scan className="h-4 w-4" />
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => toggleRow(item.id)}
                    >
                      <span className="block text-[13px] font-medium text-gray-900">
                        {formatCaptureTimestamp(item.createdAt)}
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-gray-500">
                        {item.boardPath}
                      </span>
                    </button>
                  </div>
                  {tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex max-w-full items-center gap-0.5 truncate rounded-md bg-gray-200/80 px-1.5 py-0.5 text-[10px] font-medium text-gray-700"
                          title={tag.name}
                        >
                          <Presentation className="h-2.5 w-2.5 flex-shrink-0 text-gray-500" />
                          <span className="truncate">{tag.name}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {previewItem?.imageDataUrl && (
          <button
            type="button"
            className="absolute inset-0 z-20 flex flex-col bg-white p-2 text-left"
            aria-label="Close preview"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setPreviewId(null)}
          >
            <img
              src={previewItem.imageDataUrl}
              alt=""
              className="min-h-0 w-full flex-1 rounded-md object-contain bg-gray-50"
            />
            <span className="mt-1.5 text-[12px] font-medium text-gray-900">
              {formatCaptureTimestamp(previewItem.createdAt)}
            </span>
            <span className="truncate text-[11px] text-gray-500">{previewItem.boardPath}</span>
          </button>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-2 py-2">
          <button
            type="button"
            className={cn(
              'flex h-8 items-center gap-1 rounded-md px-2 text-sm font-medium',
              hasSelection ? 'text-gray-800 hover:bg-gray-100' : 'pointer-events-none opacity-40'
            )}
            disabled={!hasSelection}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              if (!hasSelection) return
              attachCapturesToChat(selectedIds())
              setChatSidebarOpen(true)
              onOpenChange(false)
            }}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Add to chat
          </button>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              className={cn(
                'flex h-8 items-center gap-1 rounded-md px-2 text-sm font-medium',
                hasSelection
                  ? 'text-gray-800 hover:bg-gray-100'
                  : 'pointer-events-none opacity-40'
              )}
              disabled={!hasSelection}
              onPointerDown={(e) => {
                if (!hasSelection) e.preventDefault()
              }}
            >
              <Presentation className="h-3.5 w-3.5" />
              Add to presentation
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44 p-1" side="left" sideOffset={6}>
              <DropdownMenuItem
                onSelect={() => {
                  createPresentation(selectedIds())
                }}
              >
                Create new
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={presentations.length === 0}>
                  Select
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-56 w-48 overflow-y-auto p-1" side="left" sideOffset={6}>
                  {presentations.length === 0 ? (
                    <div className="px-2 py-2 text-xs text-gray-400">No presentations yet</div>
                  ) : (
                    presentations.map((p) => (
                      <DropdownMenuItem
                        key={p.id}
                        onSelect={() => {
                          addCapturesToPresentation(p.id, selectedIds())
                        }}
                      >
                        {p.name}
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
