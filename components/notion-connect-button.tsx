'use client'

// Notion connect host + More-menu Connections row (OAuth / import / disconnect)

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { LayoutGrid } from 'lucide-react' // Connections row icon (2×2 grid)
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from './ui/dropdown-menu'
import { NotionImportModal } from './notion-import-modal'
import { NotionMarkIcon } from './notion-mark-icon' // Monochrome — matches other top-bar icons
import { cn } from '@/lib/utils'

type NotionStatus = {
  configured: boolean // Whether server has OAuth secrets
  connected: boolean // Whether this user has a stored install
  workspaceName?: string | null // Connected workspace label
}

type NotionConnectApi = {
  status: NotionStatus | null // Latest /api/notion/status payload
  loading: boolean // Status fetch or disconnect in flight
  startConnect: () => void // Kick off hosted Notion OAuth
  disconnect: () => Promise<void> // Drop stored tokens
  openPicker: () => void // Open Import pages modal
}

const NotionConnectContext = createContext<NotionConnectApi | null>(null) // Shared by host + menu rows

/** Fetch status, own the import modal, and listen for AI-composer connect events. */
export function NotionConnectProvider({ children }: { children: React.ReactNode }) {
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

  const startConnect = useCallback(() => {
    if (status?.configured === false) {
      window.alert(
        'Add NOTION_CLIENT_ID and NOTION_CLIENT_SECRET to .env.local from a Notion public connection (redirect URI: http://localhost:3031/api/notion/callback), then restart the dev server.'
      ) // Guide local setup when secrets are missing
      return
    }
    const returnTo = pathname || '/' // Come back to the board after Notion page picker
    window.location.href = `/api/notion/auth?returnTo=${encodeURIComponent(returnTo)}` // Full navigation for OAuth
  }, [status?.configured, pathname])

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

  const disconnect = useCallback(async () => {
    setLoading(true) // Disable UI while deleting
    try {
      await fetch('/api/notion/disconnect', { method: 'POST' }) // Remove stored tokens
      setStatus((prev) => ({ configured: prev?.configured ?? true, connected: false, workspaceName: null })) // Clear connected UI
      setPickerOpen(false)
    } finally {
      setLoading(false) // Re-enable
    }
  }, [])

  const openPicker = useCallback(() => {
    setPickerOpen(true) // Import pages from More → Connections → Notion
  }, [])

  // AI composer Connection menu → open Notion connect / import
  useEffect(() => {
    const onOpen = () => {
      if (status?.connected) setPickerOpen(true)
      else startConnect()
    }
    window.addEventListener('thinktable-open-notion-connect', onOpen)
    return () => window.removeEventListener('thinktable-open-notion-connect', onOpen)
  }, [status?.connected, startConnect])

  const api = useMemo<NotionConnectApi>(
    () => ({ status, loading, startConnect, disconnect, openPicker }),
    [status, loading, startConnect, disconnect, openPicker]
  )

  return (
    <NotionConnectContext.Provider value={api}>
      {/* Hidden hit target so AI composer can still click [data-notion-connect] */}
      <button
        type="button"
        data-notion-connect
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onClick={() => {
          if (status?.connected) setPickerOpen(true)
          else startConnect()
        }}
      />
      {children}
      <NotionImportModal open={pickerOpen} onOpenChange={setPickerOpen} onImport={handleImport} />
    </NotionConnectContext.Provider>
  )
}

/** More → Connections row; right label is None or the connected workspace. */
export function NotionConnectMenuItems({ filterQuery = '' }: { filterQuery?: string }) {
  const api = useContext(NotionConnectContext) // Provider owns status / OAuth
  if (!api) return null
  const { status, loading, startConnect, disconnect, openPicker } = api
  const q = filterQuery.trim().toLowerCase() // Search actions… filter
  const hay = `connections notion ${status?.workspaceName || ''}` // Match row or Notion workspace
  if (q && !hay.toLowerCase().includes(q)) return null // Hide when search misses
  const rightLabel = status?.connected ? status.workspaceName || 'Notion' : 'None' // Screenshot-style status

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        disabled={loading}
        className={cn('text-sm', loading && 'opacity-50')}
        title={status?.connected ? `Connections · ${rightLabel}` : 'Connections'}
      >
        <LayoutGrid className="h-4 w-4 mr-2" />
        Connections
        <span className="ml-auto mr-1 text-xs text-gray-400">{rightLabel}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56">
        {status?.connected ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              className="text-sm"
              title={status.workspaceName ? `Notion · ${status.workspaceName}` : 'Notion connected'}
            >
              <NotionMarkIcon className="h-4 w-4 mr-2" />
              Notion
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              <DropdownMenuItem disabled className="text-xs text-gray-500">
                Connected{status.workspaceName ? ` · ${status.workspaceName}` : ''}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={openPicker}>Import pages</DropdownMenuItem>
              <DropdownMenuItem onClick={startConnect}>Reconnect / change pages</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void disconnect()} className="text-red-600 focus:text-red-600">
                Disconnect Notion
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : (
          <DropdownMenuItem
            disabled={loading}
            title={status?.configured === false ? 'Notion OAuth credentials missing — click for setup steps' : 'Connect Notion'}
            onClick={startConnect}
          >
            <NotionMarkIcon className="h-4 w-4 mr-2" />
            Notion
          </DropdownMenuItem>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
