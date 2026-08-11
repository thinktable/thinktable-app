'use client'

// Thread title dropdown + page filter (All / This board) for universal AI history
import { useEffect, useState } from 'react' // State
import type { AiThread } from '@/lib/ai/types' // Thread type
import { cn } from '@/lib/utils' // className merge
import { ChevronDown, Filter } from 'lucide-react' // Icons
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
    <div className="flex items-center gap-1 min-w-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 min-w-0 rounded-md px-1.5 py-1 text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
            title="Chat sessions"
          >
            <span className="truncate">{thread?.title || 'New AI chat'}</span>
            <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-gray-500 dark:text-gray-400" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 max-h-80 overflow-y-auto">
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

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="w-7 h-7 rounded-md flex items-center justify-center text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
            title={filter === 'board' ? 'Showing this board' : 'Showing all chats'}
            aria-label="Filter chats by page"
          >
            <Filter className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem
            onClick={() => onFilterChange('all')}
            className={cn(filter === 'all' && 'bg-black/[0.04] dark:bg-white/[0.06]')}
          >
            All chats
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onFilterChange('board')}
            disabled={!boardId}
            className={cn(filter === 'board' && 'bg-black/[0.04] dark:bg-white/[0.06]')}
          >
            This board
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
