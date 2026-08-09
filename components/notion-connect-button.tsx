'use client'

// Top-bar Notion connect control — starts Mindmap.so-style OAuth hosted by Notion

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { NotionImportModal } from './notion-import-modal'
import { NotionMarkIcon } from './notion-mark-icon' // Monochrome — matches other top-bar icons
import { cn } from '@/lib/utils'

type NotionStatus = {
  configured: boolean // Whether server has OAuth secrets
  connected: boolean // Whether this user has a stored install
  workspaceName?: string | null // Connected workspace label
}

export function NotionConnectButton() {
  const pathname = usePathname() // Current board path for returnTo
  const router = useRouter() // Navigate after import
  const queryClient = useQueryClient() // Refresh note panels after import
  const [status, setStatus] = useState<NotionStatus | null>(null) // Connection state from API
  const [loading, setLoading] = useState(true) // Initial fetch in flight
  const [pickerOpen, setPickerOpen] = useState(false) // Import pages modal

  useEffect(() => {
    let cancelled = false // Avoid setState after unmount
    const load = async () => {
      try {
        const res = await fetch('/api/notion/status') // Server-safe status (no token)
        if (!res.ok) {
          if (!cancelled) setStatus({ configured: true, connected: false }) // Treat 401 as disconnected
          return
        }
        const data = (await res.json()) as NotionStatus // Typed payload
        if (!cancelled) setStatus(data) // Update UI
      } catch {
        if (!cancelled) setStatus({ configured: false, connected: false }) // Offline / misconfig
      } finally {
        if (!cancelled) setLoading(false) // Stop spinner state
      }
    }
    load() // Fetch on mount
    return () => {
      cancelled = true // Cleanup
    }
  }, [])

  // After OAuth connect, open the page picker (Mindmap.so-style)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const shouldOpen = params.get('notion') === 'connected' || params.get('picker') === '1'
    if (!shouldOpen || !status?.connected) return
    setPickerOpen(true)
    params.delete('notion')
    params.delete('picker')
    params.delete('imported')
    const next = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (next ? `?${next}` : ''))
  }, [status?.connected])

  const startConnect = () => {
    if (status?.configured === false) {
      window.alert(
        'Add NOTION_CLIENT_ID and NOTION_CLIENT_SECRET to .env.local from a Notion public connection (redirect URI: http://localhost:3031/api/notion/callback), then restart the dev server.'
      ) // Guide local setup when secrets are missing
      return
    }
    const returnTo = pathname || '/' // Come back to the board after Notion page picker
    window.location.href = `/api/notion/auth?returnTo=${encodeURIComponent(returnTo)}` // Full navigation for OAuth
  }

  const handleImport = async (opts: { pageIds: string[]; mode: 'card' | 'mindmap' }) => {
    const res = await fetch('/api/notion/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        returnTo: pathname || '/board',
        pageIds: opts.pageIds,
        mode: opts.mode,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      throw new Error(data.error || 'Failed to import Notion pages')
    }
    if (data.conversationId) {
      await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', data.conversationId] })
      await queryClient.invalidateQueries({ queryKey: ['panel-edges', data.conversationId] }) // Mindmap threads
      await queryClient.invalidateQueries({ queryKey: ['conversations'] }) // Refresh Pages menu nesting
      await queryClient.invalidateQueries({ queryKey: ['path-board-menu'] })
      await queryClient.invalidateQueries({ queryKey: ['edit-panel-title'] })
      if (!pathname?.includes(data.conversationId)) {
        router.push(`/board/${data.conversationId}?notion=connected&imported=${data.importedCount || 0}`)
      } else {
        await queryClient.refetchQueries({ queryKey: ['messages-for-panels', data.conversationId] })
        await queryClient.refetchQueries({ queryKey: ['panel-edges', data.conversationId] }) // Load new threads
        await queryClient.refetchQueries({ queryKey: ['conversations'] })
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('fit-view-start'))
        }, 300)
      }
    }
  }

  const disconnect = async () => {
    setLoading(true) // Disable UI while deleting
    try {
      await fetch('/api/notion/disconnect', { method: 'POST' }) // Remove stored tokens
      setStatus((prev) => ({ configured: prev?.configured ?? true, connected: false, workspaceName: null })) // Clear connected UI
      setPickerOpen(false)
    } finally {
      setLoading(false) // Re-enable
    }
  }

  return (
    <>
      {status?.connected ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 w-7 p-0 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] flex-shrink-0'
              )}
              title={status.workspaceName ? `Notion · ${status.workspaceName}` : 'Notion connected'}
              disabled={loading}
            >
              <NotionMarkIcon className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem disabled className="text-xs text-gray-500">
              Connected{status.workspaceName ? ` · ${status.workspaceName}` : ''}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setPickerOpen(true)}>Import pages</DropdownMenuItem>
            <DropdownMenuItem onClick={startConnect}>Reconnect / change pages</DropdownMenuItem>
            <DropdownMenuItem onClick={disconnect} className="text-red-600 focus:text-red-600">
              Disconnect Notion
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] flex-shrink-0"
          title={status?.configured === false ? 'Notion OAuth credentials missing — click for setup steps' : 'Connect Notion'}
          onClick={startConnect}
          disabled={loading}
        >
          <NotionMarkIcon className="h-3.5 w-3.5" />
        </Button>
      )}

      <NotionImportModal open={pickerOpen} onOpenChange={setPickerOpen} onImport={handleImport} />
    </>
  )
}
