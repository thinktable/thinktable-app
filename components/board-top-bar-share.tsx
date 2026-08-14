'use client'

// Top-bar cluster right of Share: copy link, favorite, More (Import / Export / Connections)

import { useCallback, useEffect, useState } from 'react' // Copy flash + favorite toggle
import { Check, Download, Link2, MoreHorizontal, Star, Upload } from 'lucide-react' // Share cluster + Import/Export
import { Button } from '@/components/ui/button' // Ghost icon buttons
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu' // More menu
import { createClient } from '@/lib/supabase/client' // Persist favorite on conversations.metadata
import { useQueryClient } from '@tanstack/react-query' // Keep Boards list in sync
import { cn } from '@/lib/utils' // Class merge
import { NotionConnectMenuItems, NotionConnectProvider } from './notion-connect-button' // Connections → Notion

type BoardTopBarShareProps = {
  conversationId?: string // Board id; copy/favorite wait until the board is saved
}

const iconBtn =
  'h-7 w-7 p-0 text-gray-700 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0' // Same weight as Share lock

export function BoardTopBarShare({ conversationId }: BoardTopBarShareProps) {
  const queryClient = useQueryClient() // Patch conversations cache after favorite
  const [copied, setCopied] = useState(false) // Brief checkmark after copy
  const [favorited, setFavorited] = useState(false) // Star fill from metadata.favorite

  useEffect(() => {
    if (!conversationId) {
      setFavorited(false) // Unsaved board cannot be a favorite yet
      return
    }
    let cancelled = false // Ignore stale fetches on board switch
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('conversations')
        .select('metadata')
        .eq('id', conversationId)
        .single()
      if (cancelled) return
      const meta = (data?.metadata as Record<string, unknown> | null) || {}
      setFavorited(meta.favorite === true) // Board-level favorite flag
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [conversationId])

  const copyLink = useCallback(async () => {
    if (!conversationId || typeof window === 'undefined') return
    const url = `${window.location.origin}/board/${conversationId}` // Same URL as board right-click Copy link
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600) // Match Share-panel flash
    } catch {
      setCopied(false)
    }
  }, [conversationId])

  const toggleFavorite = useCallback(async () => {
    if (!conversationId) return
    const next = !favorited // Optimistic fill
    setFavorited(next)
    try {
      const supabase = createClient()
      const { data: row, error: fetchError } = await supabase
        .from('conversations')
        .select('metadata')
        .eq('id', conversationId)
        .single()
      if (fetchError) throw fetchError
      const existing = (row?.metadata as Record<string, unknown> | null) || {}
      const updated = { ...existing, favorite: next } // Merge so icon/parent_id stay
      const { error } = await supabase
        .from('conversations')
        .update({ metadata: updated })
        .eq('id', conversationId)
      if (error) throw error
      queryClient.setQueryData(['conversations'], (old: Array<{ id: string; metadata?: Record<string, unknown> }> | undefined) => {
        if (!old) return old
        return old.map((c) => (c.id === conversationId ? { ...c, metadata: updated } : c))
      })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    } catch (err) {
      setFavorited(!next) // Revert star if persist failed
      console.error('Failed to update favorite:', err)
    }
  }, [conversationId, favorited, queryClient])

  return (
    <NotionConnectProvider>
      <div className="flex items-center gap-1 flex-shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className={iconBtn}
          title={copied ? 'Copied' : 'Copy link'}
          type="button"
          disabled={!conversationId}
          onClick={() => void copyLink()}
        >
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Link2 className="h-4 w-4" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={iconBtn}
          title={favorited ? 'Remove from favorites' : 'Add to favorites'}
          type="button"
          disabled={!conversationId}
          aria-pressed={favorited}
          onClick={() => void toggleFavorite()}
        >
          <Star className={cn('h-4 w-4', favorited && 'fill-current')} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={iconBtn}
              title="More"
              type="button"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem>
              <Download className="h-4 w-4 mr-2" />
              Import
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Upload className="h-4 w-4 mr-2" />
              Export
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <NotionConnectMenuItems />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </NotionConnectProvider>
  )
}
