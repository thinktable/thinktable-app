'use client'

// Thread title dropdown with All / This board filter inside the same menu
import { useEffect, useState } from 'react' // State
import type { AiThread } from '@/lib/ai/types' // Thread type
import { cn } from '@/lib/utils' // className merge
import { Check, ChevronDown, Filter } from 'lucide-react' // Icons
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu' // Menu chrome

export type AiThreadFilter = 'all' | 'board' // Filter modes

interface AiThreadPickerProps {
  boardId?: string // Current board for filter
  thread: AiThread | null // Active thread
  filter: AiThreadFilter // Current filter
  onFilterChange: (f: AiThreadFilter) => void // Filter setter
  onSelect: (thread: AiThread) => void // Switch thread
  onNew: () => void // Start blank (clears active until first send)
  refreshKey?: number // Bump to refetch
}

export function AiThreadPicker({
  boardId,
  thread,
  filter,
  onFilterChange,
  onSelect,
  onNew,
  refreshKey = 0,
}: AiThreadPickerProps) {
  const [threads, setThreads] = useState<AiThread[]>([]) // Listed threads
  const [loading, setLoading] = useState(false) // Fetch flag

  useEffect(() => {
    let cancelled = false // Unmount guard
    const load = async () => {
      setLoading(true) // Start
      try {
        const params = new URLSearchParams() // Query
        params.set('filter', filter) // all | page
        if (filter === 'board' && boardId) params.set('boardId', boardId) // Scope
        const res = await fetch(`/api/ai/threads?${params.toString()}`) // List
        if (!res.ok) return // Soft fail
        const data = await res.json() // Parse
        if (!cancelled) setThreads(data.threads || []) // Apply
      } finally {
        if (!cancelled) setLoading(false) // Done
      }
    }
    void load() // Fire
    return () => {
      cancelled = true // Cancel
    }
  }, [filter, boardId, refreshKey]) // Refetch deps

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full max-w-full min-w-0 items-center rounded-md px-1.5 py-1 text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
          title={thread?.title || 'Chat sessions'} // Full title on hover when truncated
        >
          {/* Title + caret as one group so the chevron sits beside the name, not at the far right */}
          <span className="inline-flex max-w-full min-w-0 items-center gap-1">
            <span className="min-w-0 truncate text-left">
              {thread?.title || 'New AI chat'}
            </span>
            <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-gray-500 dark:text-gray-400" />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 max-h-80 overflow-y-auto">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <Filter className="h-3.5 w-3.5 text-gray-500 dark:text-gray-400" />
            <span className="flex-1">
              {filter === 'board' ? 'This board' : 'All chats'}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault() // Keep chat list open while filter refreshes
                onFilterChange('all')
              }}
              className={cn(filter === 'all' && 'bg-black/[0.04] dark:bg-white/[0.06]')}
            >
              <span className="flex-1">All chats</span>
              {filter === 'all' && <Check className="h-3.5 w-3.5" />}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault() // Keep chat list open while filter refreshes
                onFilterChange('board')
              }}
              disabled={!boardId}
              className={cn(filter === 'board' && 'bg-black/[0.04] dark:bg-white/[0.06]')}
            >
              <span className="flex-1">This board</span>
              {filter === 'board' && <Check className="h-3.5 w-3.5" />}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onNew}>New AI chat</DropdownMenuItem>
        <DropdownMenuSeparator />
        {loading && (
          <div className="px-2 py-1.5 text-xs text-gray-500">Loading…</div>
        )}
        {!loading && threads.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-gray-500">No chats yet</div>
        )}
        {threads.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onClick={() => onSelect(t)}
            className={cn(thread?.id === t.id && 'bg-black/[0.04] dark:bg-white/[0.06]')}
          >
            <span className="truncate">{t.title}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
